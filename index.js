import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { auditPackages, npmWhoami } from './lib/audit.mjs';
import { readLocalConfig, writeLocalConfig } from './lib/config.mjs';
import { readNpmrcToken } from './lib/credentials.mjs';
import { checkPlugin, repoFromUrl, resolveRepo, searchTopic } from './lib/discover.mjs';
import { AGENT_GUIDE, SECTION_NAME, SUBMISSION_SPEC } from './lib/guide.mjs';
import { appendPublishLog } from './lib/log.mjs';
import { npmrcLine, publishArgs, recallArgs } from './lib/npm.mjs';
import { DEFAULT_ORG, orgArgs } from './lib/org.mjs';
import { preflightPackage } from './lib/preflight.mjs';
import { listReviewQueue, readReviews, saveReview } from './lib/reviews.mjs';
import { releasePackage } from './lib/release.mjs';
import { prepareManifest } from './lib/manifest.mjs';
import { DEFAULT_SUBMISSIONS_REPO, reviewPullRequest, submitPackage } from './lib/submissions.mjs';
import { DEFAULT_REGISTRY_REPO, forkAndOpenPr, generateEntry } from './lib/publish.mjs';
import { ensureRepo, getLogin, uploadFiles } from './lib/repo.mjs';
import { probeNpmToken, probeToken } from './lib/token.mjs';

export const name = 'dsh-publish-helper';
export const inject = ['tools', 'webServer', 'systemPrompt', 'agents'];

function normalize(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    token: typeof source.token === 'string' && source.token.trim()
      ? source.token.trim()
      : (process.env.DSH_PUBLISH_HELPER_TOKEN ?? process.env.GH_TOKEN ?? ''),
    registryRepo: typeof source.registryRepo === 'string' && source.registryRepo.trim()
      ? source.registryRepo.trim()
      : DEFAULT_REGISTRY_REPO,
    guide: source.guide !== false,
    publishingMode: source.publishingMode === 'author' ? 'author' : 'maintainer',
    maintainer: typeof source.maintainer === 'string' && source.maintainer.trim()
      ? source.maintainer.trim()
      : 'fubai-fenzhi',
  };
}

function isMaintainerMode(cfg) {
  return cfg.publishingMode === 'maintainer';
}

/** In maintainer mode, publishing/submitting must run under the configured maintainer identity. */
async function enforceGithubMaintainer(cfg, token) {
  if (!isMaintainerMode(cfg)) return;
  const login = await getLogin({ token });
  if (login !== cfg.maintainer) {
    throw new Error(`此部署只允许用维护者账号 ${cfg.maintainer} 提交/发布（当前 GitHub 登录：${login}）`);
  }
}

async function enforceNpmMaintainer(cfg) {
  if (!isMaintainerMode(cfg)) return;
  const { token } = resolveNpmToken();
  if (!token) throw new Error('npm token not found: run npm login (writes ~/.npmrc), or set NPM_TOKEN');
  const user = await npmWhoami({ token });
  if (user !== cfg.maintainer) {
    throw new Error(`此部署只允许用维护者账号 ${cfg.maintainer} 发布 npm（当前 npm 登录：${user ?? 'unknown'}）`);
  }
}

/**
 * GitHub credential resolution: explicit config -> env -> saved file -> `gh auth token`.
 * The value is only used for API calls; it is never printed or returned.
 */
async function resolveGithubToken(cfg) {
  if (cfg.token) return { token: cfg.token, source: 'config' };
  for (const name of ['DSH_PUBLISH_HELPER_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']) {
    if (process.env[name]) return { token: process.env[name], source: `env:${name}` };
  }
  const saved = readLocalConfig().token;
  if (saved) return { token: saved, source: 'saved' };
  const result = await runCommand('gh', ['auth', 'token'], { cwd: process.cwd() });
  const token = result.code === 0 ? String(result.stdout ?? '').trim() : '';
  if (token) return { token, source: 'gh' };
  return { token: '', source: 'none' };
}

function syncText(sync) {
  if (!sync || !(sync.behind > 0)) return '';
  return sync.merged
    ? `\nfork synced with upstream (was behind ${sync.behind})`
    : `\nfork sync skipped (behind ${sync.behind})`;
}

const textOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['text'],
    properties: {
      text: { type: 'string' },
    },
  },
  render: (_args, value) => [{ type: 'text', text: value.text }],
};

const present = (title) => (args) => ({ card: 'generic', title, kind: 'other', rawInput: args });

function objectSchema(properties, required = []) {
  return { type: 'object', additionalProperties: false, properties, required };
}

function runCommand(command, args, { cwd, env, timeoutMs = 300000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, shell: process.platform === 'win32' });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}${error}` });
    });
  });
}

/**
 * npm credential resolution: explicit config -> env -> ~/.npmrc (written by `npm login`).
 * The value is only used for npm commands; it is never printed or returned.
 */
function resolveNpmToken() {
  const saved = readLocalConfig().npmToken;
  if (saved) return { token: saved, source: 'saved' };
  if (process.env.NPM_TOKEN) return { token: process.env.NPM_TOKEN, source: 'env:NPM_TOKEN' };
  const fromNpmrc = readNpmrcToken();
  if (fromNpmrc) return { token: fromNpmrc, source: 'npmrc' };
  return { token: '', source: 'none' };
}

/** Run one npm command with a throwaway .npmrc and a workspace-local cache (the user npm cache may be read-only). */
async function withNpmAuth(args, { cwd, token }) {
  const tempRoot = mkdtempSync(join(tmpdir(), 'dsh-publish-npm-'));
  const userconfig = join(tempRoot, 'npmrc');
  const cache = join(tempRoot, 'cache');
  mkdirSync(cache, { recursive: true });
  writeFileSync(userconfig, npmrcLine(token), 'utf8');
  try {
    return await runCommand('npm', [...args, '--userconfig', userconfig, '--cache', cache], {
      cwd,
      env: { ...process.env, NODE_AUTH_TOKEN: token },
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function npmOutput(result) {
  return `${result.stdout}\n${result.stderr}`.trim();
}

/** One-click publish: preflight the submission spec, then npm publish with the saved token. */
async function publishDirectory({ dir, tag = 'latest', otp, force = false } = {}) {
  const directory = String(dir ?? '');
  if (!directory) throw new Error('package directory is required');
  const manifest = join(directory, 'package.json');
  if (!existsSync(manifest)) throw new Error(`no package.json in ${directory}`);
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  if (pkg.private === true) throw new Error('package.json has private:true; remove it before publishing');
  const preflight = preflightPackage(directory);
  if (!preflight.ok && force !== true) {
    const failed = preflight.checks
      .filter((check) => !check.ok)
      .map((check) => `${check.id}: ${check.detail}`)
      .join('\n');
    throw new Error(`preflight failed:\n${failed}`);
  }
  const { token } = resolveNpmToken();
  if (!token) throw new Error('npm token not found: run npm login (writes ~/.npmrc), or set NPM_TOKEN');
  const result = await withNpmAuth(publishArgs({ tag, otp }), { cwd: directory, token });
  const output = npmOutput(result);
  if (result.code !== 0) throw new Error(`npm publish exited ${result.code}\n${output.slice(-4000)}`);
  appendPublishLog({ kind: 'publish', name: pkg.name, version: pkg.version, dir: directory, tag: tag || 'latest' });
  return { name: pkg.name, version: pkg.version, output: output.slice(-2000) };
}

async function runOrg({ action, org = DEFAULT_ORG, user, role, otp } = {}) {
  const args = orgArgs({ action, org, user, role, otp });
  const { token } = resolveNpmToken();
  if (!token) throw new Error('npm token not found: run npm login (writes ~/.npmrc), or set NPM_TOKEN');
  const result = await withNpmAuth(args, { cwd: process.cwd(), token });
  const output = npmOutput(result);
  if (result.code !== 0) {
    const hint = /403/.test(output)
      ? '\n提示：npm token 需要「组织」权限（创建 token 时「组织 → 权限」不能是「无法访问」，至少选「读取」，邀请/移除要「读取和写入」）。'
      : '';
    throw new Error(`npm org ${action} exited ${result.code}\n${output.slice(-4000)}${hint}`);
  }
  return { action, org, output: output.slice(-3000) };
}

/** Withdraw exactly one version: deprecate (warning) or unpublish (72-hour window). */
async function recallPackage({ name, version, action = 'unpublish', message } = {}) {
  const args = recallArgs({ name, version, action, message });
  const { token } = resolveNpmToken();
  if (!token) throw new Error('npm token not found: run npm login (writes ~/.npmrc), or set NPM_TOKEN');
  const result = await withNpmAuth(args, { cwd: process.cwd(), token });
  const output = npmOutput(result);
  if (result.code !== 0) throw new Error(`npm ${action} exited ${result.code}\n${output.slice(-4000)}`);
  appendPublishLog({ kind: action, name, version, message: message ?? '' });
  return { name, version, action, output: output.slice(-2000) };
}

function walkFiles(root, current = root, out = []) {
  for (const entry of readdirSync(current)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = join(current, entry);
    if (statSync(full).isDirectory()) walkFiles(root, full, out);
    else out.push(relative(root, full).replaceAll('\\', '/'));
  }
  return out;
}

export function apply(ctx, rawConfig) {
  const cfg = normalize(rawConfig);

  // Every agent running with this plugin sees the submission contract without asking.
  if (cfg.guide) {
    const attached = new Set();
    const attach = (agent) => {
      if (!agent || attached.has(agent.id)) return;
      try {
        agent.ctx.systemPrompt.section({ name: SECTION_NAME, order: 810, text: AGENT_GUIDE });
        attached.add(agent.id);
      } catch {
        // an agent without a system prompt (or already disposed) simply gets no section
      }
    };
    ctx.effect(() => {
      for (const agent of ctx.agents.list()) attach(agent);
      const off = ctx.on('agent/created', ({ agent }) => attach(agent));
      return () => off();
    });
  }

  ctx.tools.register({
    name: 'publish_discover',
    description: 'Search GitHub repositories carrying the dsh-plugin topic, ranked by stars. Use it to find plugins or to confirm a plugin is discoverable by topic.',
    parameters: objectSchema({
      query: { type: 'string', description: 'Search words; empty lists the top-starred DSH plugins.' },
      limit: { type: 'integer', description: 'Maximum results (default 10).' },
    }),
    output: textOutput,
    async execute(args) {
      const result = await searchTopic({
        query: args.query ?? '',
        limit: args.limit ?? 10,
        token: (await resolveGithubToken(cfg)).token,
      });
      const lines = [`topic:dsh-plugin ${result.total} repo(s)`];
      for (const item of result.items) lines.push(`${item.stars}\t${item.fullName}\t${item.description.slice(0, 90)}`);
      return { text: lines.join('\n') };
    },
    presentCall: present('Discover DSH plugins'),
  });

  ctx.tools.register({
    name: 'publish_check',
    description: 'Check whether a DSH plugin repository is ready for market listing: dsh-plugin topic, dsh.bundle, npm publication, npm repository backlink, awesome-dsh-plugin entry and the format-1 index.',
    parameters: objectSchema({
      repo: { type: 'string', description: 'Repository as owner/name, or a bare npm package name.' },
      name: { type: 'string', description: 'npm package name; defaults to the repository name.' },
      directory: { type: 'string', description: 'Monorepo subdirectory that holds the plugin package.' },
    }, ['repo']),
    output: textOutput,
    async execute(args) {
      const resolved = await resolveRepo({ input: args.repo });
      const packageName = args.name ?? resolved.fromPackage ?? resolved.repo.split('/')[1];
      const result = await checkPlugin({
        repo: resolved.repo,
        name: packageName,
        directory: args.directory ?? resolved.directory ?? null,
        token: (await resolveGithubToken(cfg)).token,
      });
      const lines = [
        `${result.repo} (${result.name}) ${result.stars}★`,
        ...result.checks.map((check) => `${check.ok ? 'OK' : 'FAIL'}\t${check.id}\t${check.detail}`),
        result.ok ? 'status: ready' : 'status: needs fixes',
      ];
      return { text: lines.join('\n') };
    },
    presentCall: present('Check plugin listing'),
  });

  ctx.tools.register({
    name: 'publish_entry',
    description: 'Generate the awesome-dsh-plugin entry YAML for a repository without submitting anything.',
    parameters: objectSchema({
      repo: { type: 'string', description: 'Repository as owner/name.' },
      en: { type: 'string', description: 'Factual one-line English description ending with a period.' },
      zh: { type: 'string', description: 'Optional Chinese description.' },
      category: { type: 'string', description: 'Registry category (default: tools).' },
    }, ['repo', 'en']),
    output: textOutput,
    async execute(args) {
      return { text: generateEntry({ repo: args.repo, en: args.en, zh: args.zh, category: args.category ?? 'tools' }) };
    },
    presentCall: present('Generate registry entry'),
  });

  ctx.tools.register({
    name: 'publish_pr',
    description: 'Fork awesome-dsh-plugin/awesome-dsh-plugin (syncing the fork with upstream first when it is behind), add this repository entry and open a pull request. Requires a GitHub token with repo scope in the plugin config or DSH_PUBLISH_HELPER_TOKEN.',
    parameters: objectSchema({
      repo: { type: 'string', description: 'Repository as owner/name.' },
      en: { type: 'string', description: 'Factual one-line English description.' },
      zh: { type: 'string', description: 'Optional Chinese description.' },
      category: { type: 'string', description: 'Registry category (default: tools).' },
      title: { type: 'string', description: 'Pull request title.' },
    }, ['repo', 'en']),
    output: textOutput,
    async execute(args) {
      const entry = generateEntry({
        repo: args.repo,
        en: args.en,
        zh: args.zh,
        category: args.category ?? 'tools',
      });
      const result = await forkAndOpenPr({
        repo: args.repo,
        token: (await resolveGithubToken(cfg)).token,
        entry,
        title: args.title,
        registryRepo: cfg.registryRepo,
      });
      return { text: `PR #${result.pr.number} ${result.pr.state}\n${result.pr.url}\nfile: ${result.file}${syncText(result.sync)}` };
    },
    presentCall: present('Open registry pull request'),
  });

  ctx.tools.register({
    name: 'publish_audit',
    description: 'Audit the npm packages of one user (or explicit repos) and report which are missing from the awesome-dsh-plugin registry, which wait for the format-1 index, and which are ready.',
    parameters: objectSchema({
      user: { type: 'string', description: 'npm username; omitted uses the configured token account.' },
      repos: { type: 'string', description: 'Comma-separated owner/repo overrides.' },
    }),
    output: textOutput,
    async execute(args) {
      const { token } = await resolveGithubToken(cfg);
      const repos = typeof args.repos === 'string' && args.repos.trim()
        ? args.repos.split(',').map((item) => item.trim()).filter(Boolean)
        : [];
      let user = typeof args.user === 'string' && args.user.trim() ? args.user.trim() : null;
      if (!user) user = readLocalConfig().npmUser || null;
      if (!user) user = await npmWhoami({ token });
      if (!user && repos.length === 0) throw new Error('publish_audit needs a npm user, repos, or a saved token');
      const result = await auditPackages({ user, repos, token });
      const lines = [`npm user: ${result.user ?? '(none)'}`];
      for (const item of result.results) {
        lines.push(`${item.status}\t${item.repo ?? '-'}\t${item.name}${item.version ? `@${item.version}` : ''}`);
      }
      return { text: lines.join('\n') };
    },
    presentCall: present('Audit published packages'),
  });

  ctx.tools.register({
    name: 'publish_npm',
    description: 'Publish a package directory to npm now with the resolved npm token (npm publish --access public). Use it after bumping the version; pass otp when the token does not bypass 2FA.',
    parameters: objectSchema({
      dir: { type: 'string', description: 'Absolute package directory to publish.' },
      tag: { type: 'string', description: 'npm dist-tag (default: latest).' },
      otp: { type: 'string', description: 'Optional 2FA one-time code.' },
      force: { type: 'boolean', description: 'Publish even when preflight fails (only after manual review).' },
    }, ['dir']),
    output: textOutput,
    async execute(args) {
      await enforceNpmMaintainer(cfg);
      const result = await publishDirectory({ dir: args.dir, tag: args.tag, otp: args.otp, force: args.force === true });
      return { text: `${result.name}@${result.version}\n${result.output || 'published'}` };
    },
    presentCall: present('Publish package to npm'),
  });

  ctx.tools.register({
    name: 'publish_preflight',
    description: 'Run the local preflight against the submission spec: package fields, dsh.bundle, README/LICENSE, install scripts, binaries, secrets and hardcoded paths.',
    parameters: objectSchema({
      dir: { type: 'string', description: 'Absolute package directory.' },
    }, ['dir']),
    output: textOutput,
    async execute(args) {
      const result = preflightPackage(String(args.dir));
      const lines = [`${result.ok ? 'PASS' : 'FAIL'} ${result.dir}`];
      for (const check of result.checks) {
        lines.push(`${check.ok ? 'OK  ' : 'FAIL'}\t${check.id}\t${check.detail}`);
      }
      return { text: lines.join('\n') };
    },
    presentCall: present('Preflight submission'),
  });

  ctx.tools.register({
    name: 'publish_recall',
    description: 'Withdraw one published version: deprecate it (warning, package stays) or unpublish it (only within npm 72 hours). Needs an npm token with publish rights (npm login / NPM_TOKEN).',
    parameters: objectSchema({
      name: { type: 'string', description: 'npm package name.' },
      version: { type: 'string', description: 'Exact version to withdraw.' },
      action: { type: 'string', enum: ['deprecate', 'unpublish'], description: 'deprecate (warn) or unpublish (remove).' },
      message: { type: 'string', description: 'Reason shown by deprecate.' },
    }, ['name', 'version']),
    output: textOutput,
    async execute(args) {
      const result = await recallPackage({
        name: args.name,
        version: args.version,
        action: args.action ?? 'unpublish',
        message: args.message,
      });
      return { text: `${result.action} ${result.name}@${result.version}\n${result.output || 'done'}` };
    },
    presentCall: present('Recall a published version'),
  });

  ctx.tools.register({
    name: 'publish_tag',
    description: 'Bump the package version, upload the directory to its GitHub repository and create a vX.Y.Z tag to trigger the release workflow.',
    parameters: objectSchema({
      dir: { type: 'string', description: 'Absolute package directory.' },
      repo: { type: 'string', description: 'Repository as owner/name; defaults to the package.json repository.' },
      bump: { type: 'string', enum: ['patch', 'minor', 'major'], description: 'Version bump (default patch).' },
      version: { type: 'string', description: 'Explicit version instead of a bump.' },
    }, ['dir']),
    output: textOutput,
    async execute(args) {
      const { token } = await resolveGithubToken(cfg);
      if (!token) throw new Error('run gh auth login, or save a GitHub token first');
      const result = await releasePackage({
        dir: args.dir,
        token,
        repo: args.repo,
        bump: args.bump ?? 'patch',
        version: args.version,
      });
      return {
        text: `released ${result.repo} ${result.tag}\ncommit: ${result.commit.slice(0, 7)}\nCI 已触发；staging 版本需要在 npm 页面 Approve`,
      };
    },
    presentCall: present('Tag a release'),
  });

  ctx.tools.register({
    name: 'publish_org',
    description: 'Manage npm org members: list, verify one user, invite (org set ... developer/admin) or remove. Needs an org-owner npm token.',
    parameters: objectSchema({
      action: { type: 'string', enum: ['list', 'verify', 'invite', 'remove'], description: 'Operation.' },
      org: { type: 'string', description: 'Organization name (default dsh-fubai).' },
      user: { type: 'string', description: 'npm username (needed except for list).' },
      role: { type: 'string', enum: ['developer', 'admin', 'owner'], description: 'Role for invite (default developer).' },
      otp: { type: 'string', description: '2FA code if npm asks for one.' },
    }, ['action']),
    output: textOutput,
    async execute(args) {
      const result = await runOrg({ action: args.action, org: args.org, user: args.user, role: args.role, otp: args.otp });
      return { text: `${result.action} ${result.org}\n${result.output || 'done'}` };
    },
    presentCall: present('Manage npm org'),
  });

  ctx.tools.register({
    name: 'publish_workflow',
    description: 'Write the GitHub Actions trusted-publishing workflow into a local package directory (.github/workflows/release.yml).',
    parameters: objectSchema({
      dir: { type: 'string', description: 'Absolute package directory.' },
    }, ['dir']),
    output: textOutput,
    async execute(args) {
      const directory = String(args.dir);
      if (!existsSync(join(directory, 'package.json'))) throw new Error(`no package.json in ${directory}`);
      const template = readFileSync(new URL('./templates/release.yml', import.meta.url), 'utf8');
      const target = join(directory, '.github', 'workflows', 'release.yml');
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, template, 'utf8');
      return { text: `wrote ${target}` };
    },
    presentCall: present('Write release workflow'),
  });

  ctx.tools.register({
    name: 'publish_prepare',
    description: 'Add repository/homepage fields to a local package.json and bump its patch version.',
    parameters: objectSchema({
      dir: { type: 'string', description: 'Absolute package directory.' },
      repo: { type: 'string', description: 'GitHub owner/name; defaults to the repository already declared.' },
    }, ['dir']),
    output: textOutput,
    async execute(args) {
      const directory = String(args.dir);
      const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
      const currentRepo = repoFromUrl(pkg.repository?.url ?? '') ?? null;
      const repo = args.repo ?? currentRepo;
      if (!repo) throw new Error('repository owner/name is required');
      const next = prepareManifest(pkg, { repo });
      writeFileSync(join(directory, 'package.json'), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      return {
        text: `bumped ${pkg.version} -> ${next.version}\nrepository: ${next.repository.url}\nhomepage: ${next.homepage}`,
      };
    },
    presentCall: present('Prepare package manifest'),
  });

  ctx.tools.register({
    name: 'publish_repo',
    description: 'Create a GitHub repository (if missing) and upload a local package directory through the API. Uses the resolved GitHub token (gh auth token / GH_TOKEN / config).',
    parameters: objectSchema({
      dir: { type: 'string', description: 'Absolute local package directory.' },
      repo: { type: 'string', description: 'Repository name; defaults to package.json name.' },
      description: { type: 'string', description: 'Repository description.' },
      private: { type: 'boolean', description: 'Create a private repository.' },
    }, ['dir']),
    output: textOutput,
    async execute(args) {
      const { token } = await resolveGithubToken(cfg);
      if (!token) throw new Error('run gh auth login, or save a GitHub token first');
      const directory = String(args.dir);
      const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
      const name = args.repo ?? pkg.name;
      const login = await getLogin({ token });
      const created = await ensureRepo({
        token,
        owner: login,
        name,
        description: args.description ?? pkg.description ?? '',
        isPrivate: args.private === true,
      });
      const files = walkFiles(directory).map((path) => ({
        path,
        content: readFileSync(join(directory, path)).toString('base64'),
      }));
      const workflowPath = '.github/workflows/release.yml';
      if (!files.some((file) => file.path === workflowPath)) {
        const template = readFileSync(new URL('./templates/release.yml', import.meta.url), 'utf8');
        files.push({ path: workflowPath, content: Buffer.from(template, 'utf8').toString('base64') });
      }
      const written = await uploadFiles({ token, owner: login, name, files, message: `Upload ${name}` });
      return {
        text: `repo ${login}/${name}\nbranch ${created.defaultBranch}\n${written.length} file(s): ${written.join(', ')}`,
      };
    },
    presentCall: present('Create repository and upload'),
  });

  ctx.tools.register({
    name: 'publish_submit',
    description: 'Submit a local package to dsh-plugin-submissions: preflight, push a branch to your fork and open a pull request. Uses the resolved GitHub token.',
    parameters: objectSchema({
      dir: { type: 'string', description: 'Absolute package directory (must contain SUBMISSION.md).' },
      title: { type: 'string', description: 'Pull request title.' },
      body: { type: 'string', description: 'Pull request body.' },
    }, ['dir']),
    output: textOutput,
    async execute(args) {
      const { token } = await resolveGithubToken(cfg);
      if (!token) throw new Error('run gh auth login, or save a GitHub token first');
      await enforceGithubMaintainer(cfg, token);
      const result = await submitPackage({ dir: args.dir, token, title: args.title, body: args.body });
      return { text: `PR #${result.pr.number} ${result.pr.state}\n${result.pr.url}\nbranch: ${result.branch}\nfiles: ${result.files}` };
    },
    presentCall: present('Submit plugin'),
  });

  ctx.tools.register({
    name: 'publish_review',
    description: 'Review a submission PR: download the changed submissions, run preflight and post the report as a PR comment.',
    parameters: objectSchema({
      pr: { type: 'integer', description: 'Pull request number.' },
      repo: { type: 'string', description: 'Submissions repository (owner/name).' },
      comment: { type: 'boolean', description: 'Post the report as a PR comment (default true).' },
    }, ['pr']),
    output: textOutput,
    async execute(args) {
      const { token } = await resolveGithubToken(cfg);
      if (!token) throw new Error('run gh auth login, or save a GitHub token first');
      const result = await reviewPullRequest({
        pr: args.pr,
        repo: typeof args.repo === 'string' && args.repo.trim() ? args.repo.trim() : DEFAULT_SUBMISSIONS_REPO,
        token,
        comment: args.comment !== false,
      });
      return { text: result.report };
    },
    presentCall: present('Review submission'),
  });

  ctx.tools.register({
    name: 'publish_spec',
    description: 'Return the DSH plugin submission spec: required package fields, forbidden patterns, publish flow and recall rules.',
    parameters: objectSchema({}),
    output: textOutput,
    async execute() {
      return { text: SUBMISSION_SPEC };
    },
    presentCall: present('Submission spec'),
  });

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-publish-helper/check',
    resource: async (request) => {
      const url = new URL(request.url);
      const input = url.searchParams.get('repo') ?? '';
      let resolved;
      try {
        resolved = await resolveRepo({ input });
      } catch (error) {
        return Response.json({ error: String(error) }, { status: 400 });
      }
      const name = url.searchParams.get('name') ?? resolved.fromPackage ?? resolved.repo.split('/')[1];
      const directory = url.searchParams.get('directory') ?? resolved.directory ?? null;
      try {
        return Response.json(await checkPlugin({ repo: resolved.repo, name, directory, token: (await resolveGithubToken(cfg)).token }));
      } catch (error) {
        return Response.json({ error: String(error) }, { status: 500 });
      }
    },
  }));

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-publish-helper/audit',
    resource: async (request) => {
      const url = new URL(request.url);
      const { token } = await resolveGithubToken(cfg);
      const repos = (url.searchParams.get('repos') ?? '').split(',').map((item) => item.trim()).filter(Boolean);
      let user = url.searchParams.get('user')?.trim() || readLocalConfig().npmUser || null;
      if (!user) user = await npmWhoami({ token });
      if (!user && repos.length === 0) {
        return Response.json({ error: 'set a npm user in the settings page, or save a GitHub token first' }, { status: 400 });
      }
      try {
        return Response.json(await auditPackages({ user, repos, token }));
      } catch (error) {
        return Response.json({ error: String(error) }, { status: 500 });
      }
    },
  }));

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-publish-helper/preflight',
    resource: async (request) => {
      const url = new URL(request.url);
      return Response.json(preflightPackage(url.searchParams.get('dir') ?? ''));
    },
  }));

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-publish-helper/publish',
    handler: async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end(JSON.stringify({ error: 'method not allowed' }));
        return;
      }
      let raw = '';
      for await (const chunk of req) raw += chunk;
      let body;
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'invalid JSON body' }));
        return;
      }
      try {
        res.end(JSON.stringify({ ok: true, ...(await publishDirectory({ dir: body?.dir, tag: body?.tag, otp: body?.otp, force: body?.force === true })) }));
      } catch (error) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: String(error).replace(/^Error:\s*/, '') }));
      }
    },
  }));

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-publish-helper/recall',
    handler: async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end(JSON.stringify({ error: 'method not allowed' }));
        return;
      }
      let raw = '';
      for await (const chunk of req) raw += chunk;
      let body;
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'invalid JSON body' }));
        return;
      }
      try {
        res.end(JSON.stringify({
          ok: true,
          ...(await recallPackage({
            name: body?.name,
            version: body?.version,
            action: body?.action ?? 'unpublish',
            message: body?.message,
          })),
        }));
      } catch (error) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: String(error).replace(/^Error:\s*/, '') }));
      }
    },
  }));

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-publish-helper/review-queue',
    resource: async (request) => {
      const url = new URL(request.url);
      const local = readLocalConfig();
      const param = url.searchParams.get('repos');
      const repos = (param ? param.split(',') : local.reviewRepos)
        .map((item) => item.trim())
        .filter(Boolean);
      const targets = repos.length ? repos : [DEFAULT_SUBMISSIONS_REPO];
      const { token } = await resolveGithubToken(cfg);
      if (!token) return Response.json({ error: 'run gh auth login first' }, { status: 400 });
      try {
        const items = await listReviewQueue({ repos: targets, token, reviews: readReviews() });
        return Response.json({ repos: targets, items });
      } catch (error) {
        return Response.json({ error: String(error) }, { status: 500 });
      }
    },
  }));

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-publish-helper/review-history',
    resource: async () => {
      const items = readReviews()
        .slice()
        .sort((left, right) => String(right.at).localeCompare(String(left.at)))
        .slice(0, 50);
      return Response.json({ items });
    },
  }));

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-publish-helper/review',
    handler: async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      const { token } = await resolveGithubToken(cfg);
      if (!token) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'run gh auth login first' }));
        return;
      }
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET') {
        const pr = Number(url.searchParams.get('pr'));
        const repo = url.searchParams.get('repo') || DEFAULT_SUBMISSIONS_REPO;
        const record = readReviews().find((item) => item.repo === repo && item.pr === pr);
        if (!record) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'no stored review for this PR' }));
          return;
        }
        res.end(JSON.stringify({ ok: true, ...record }));
        return;
      }
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end(JSON.stringify({ error: 'method not allowed' }));
        return;
      }
      let raw = '';
      for await (const chunk of req) raw += chunk;
      let body;
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'invalid JSON body' }));
        return;
      }
      const pr = Number(body.pr);
      if (!pr) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'pr is required' }));
        return;
      }
      try {
        const repo = typeof body.repo === 'string' && body.repo.trim() ? body.repo.trim() : DEFAULT_SUBMISSIONS_REPO;
        const result = await reviewPullRequest({ pr, repo, token, comment: body.comment !== false });
        const record = saveReview({
          repo,
          pr,
          sha: result.sha,
          ok: result.reports.every((item) => item.result.ok),
          report: result.report,
        });
        res.end(JSON.stringify({ ok: true, ...record }));
      } catch (error) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: String(error) }));
      }
    },
  }));

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-publish-helper/config',
    handler: async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET') {
        const local = readLocalConfig();
        const github = await resolveGithubToken(cfg);
        const npmInfo = resolveNpmToken();
        const token = github.token;
        const npmToken = npmInfo.token;
        let tokenInfo = { valid: null, expiresAt: null, daysLeft: null, neverExpires: null };
        if (token) {
          try {
            tokenInfo = await probeToken({ token });
          } catch {
            // keep unknown: the network or GitHub may be unreachable
          }
        }
        let npmTokenValid = null;
        if (npmToken) {
          try {
            npmTokenValid = await probeNpmToken({ token: npmToken });
          } catch {
            npmTokenValid = null;
          }
        }
        res.end(JSON.stringify({
          hasToken: Boolean(token),
          tokenSource: github.source,
          tokenValid: tokenInfo.valid,
          tokenExpiresAt: tokenInfo.expiresAt,
          tokenDaysLeft: tokenInfo.daysLeft,
          tokenNeverExpires: tokenInfo.neverExpires,
          hasNpmToken: Boolean(npmToken),
          npmTokenSource: npmInfo.source,
          npmTokenValid,
          registryRepo: cfg.registryRepo,
          localRegistryRepo: local.registryRepo || null,
          npmUser: local.npmUser || '',
          reviewRepos: local.reviewRepos || [],
        }));
        return;
      }
      if (req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        try {
          const patch = JSON.parse(body || '{}');
          writeLocalConfig({
            ...(typeof patch.token === 'string' ? { token: patch.token.trim() } : {}),
            ...(typeof patch.registryRepo === 'string' ? { registryRepo: patch.registryRepo.trim() } : {}),
            ...(typeof patch.npmUser === 'string' ? { npmUser: patch.npmUser.trim() } : {}),
            ...(typeof patch.npmToken === 'string' ? { npmToken: patch.npmToken.trim() } : {}),
            ...(Array.isArray(patch.reviewRepos)
              ? {
                reviewRepos: patch.reviewRepos
                  .filter((item) => typeof item === 'string')
                  .map((item) => item.trim())
                  .filter(Boolean),
              }
              : {}),
          });
          res.end(JSON.stringify({ ok: true }));
        } catch (error) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: String(error) }));
        }
        return;
      }
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'method not allowed' }));
    },
  }));
}
