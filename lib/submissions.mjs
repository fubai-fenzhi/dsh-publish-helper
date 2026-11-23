import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { preflightPackage } from './preflight.mjs';

const API = 'https://api.github.com';
export const DEFAULT_SUBMISSIONS_REPO = 'fubai-fenzhi/dsh-plugin-submissions';

async function api(url, { token, method = 'GET', body, fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    let detail = '';
    try {
      detail = JSON.stringify(await response.json());
    } catch {
      // status-only message
    }
    throw new Error(`GitHub ${response.status} ${url}${detail ? `: ${detail}` : ''}`);
  }
  return response.json();
}

function walk(root, current = root, out = []) {
  for (const entry of readdirSyncSafe(current)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = join(current, entry);
    const stat = statSyncSafe(full);
    if (!stat) continue;
    if (stat.isDirectory()) walk(root, full, out);
    else out.push(relative(root, full).replaceAll('\\', '/'));
  }
  return out;
}

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function statSyncSafe(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function submissionDirName(name) {
  return String(name).replaceAll('/', '__');
}

function failedLines(preflight) {
  return preflight.checks
    .filter((check) => !check.ok)
    .map((check) => `${check.id}: ${check.detail}`)
    .join('\n');
}

/**
 * Submit a local package to the submissions repository: preflight, push a branch on the
 * user's fork and open a pull request. The author's own GitHub token is used.
 */
export async function submitPackage({
  dir,
  token,
  submissionsRepo = DEFAULT_SUBMISSIONS_REPO,
  title,
  body = '',
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = 10,
} = {}) {
  if (!token) throw new Error('publish_submit needs a GitHub token (run gh auth login or set GH_TOKEN)');
  const directory = String(dir ?? '');
  if (!existsSync(join(directory, 'package.json'))) throw new Error(`no package.json in ${directory}`);
  const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));

  const preflight = preflightPackage(directory);
  if (!preflight.ok) throw new Error(`preflight failed:\n${failedLines(preflight)}`);
  if (!existsSync(join(directory, 'SUBMISSION.md'))) {
    throw new Error('SUBMISSION.md is required (template: publish-helper/templates/SUBMISSION.md)');
  }

  const user = await api(`${API}/user`, { token, fetchImpl });
  const owner = user.login;
  const forkRepo = `${owner}/${submissionsRepo.split('/').pop()}`;

  try {
    await api(`${API}/repos/${submissionsRepo}/forks`, { token, method: 'POST', fetchImpl });
  } catch {
    // an existing fork answers 422; it is still usable
  }

  let ready = null;
  for (let index = 0; index < attempts; index += 1) {
    try {
      ready = await api(`${API}/repos/${forkRepo}`, { token, fetchImpl });
      break;
    } catch {
      await sleep(2000);
    }
  }
  if (!ready) throw new Error(`fork ${forkRepo} did not become available`);

  const base = await api(`${API}/repos/${forkRepo}/git/ref/heads/main`, { token, fetchImpl });
  const baseSha = base.object.sha;

  const dirName = submissionDirName(pkg.name);
  const files = walk(directory);
  const tree = [];
  for (const file of files) {
    const content = readFileSync(join(directory, file)).toString('base64');
    const blob = await api(`${API}/repos/${forkRepo}/git/blobs`, {
      token,
      method: 'POST',
      fetchImpl,
      body: { content, encoding: 'base64' },
    });
    tree.push({
      path: `submissions/${dirName}/${file}`,
      mode: '100644',
      type: 'blob',
      sha: blob.sha,
    });
  }

  const treeResult = await api(`${API}/repos/${forkRepo}/git/trees`, {
    token,
    method: 'POST',
    fetchImpl,
    body: { base_tree: baseSha, tree },
  });
  const commit = await api(`${API}/repos/${forkRepo}/git/commits`, {
    token,
    method: 'POST',
    fetchImpl,
    body: { message: `Submit ${pkg.name}@${pkg.version}`, tree: treeResult.sha, parents: [baseSha] },
  });

  const branch = `submit/${dirName}-${Date.now().toString(36)}`;
  await api(`${API}/repos/${forkRepo}/git/refs`, {
    token,
    method: 'POST',
    fetchImpl,
    body: { ref: `refs/heads/${branch}`, sha: commit.sha },
  });

  const pull = await api(`${API}/repos/${submissionsRepo}/pulls`, {
    token,
    method: 'POST',
    fetchImpl,
    body: {
      title: title ?? `Submit ${pkg.name}@${pkg.version}`,
      head: `${owner}:${branch}`,
      base: 'main',
      body: body || `提交 ${pkg.name}@${pkg.version}\n\n预检：PASS（${preflight.checks.length} 项）`,
    },
  });

  return {
    fork: forkRepo,
    branch,
    files: tree.length,
    pr: { number: pull.number, url: pull.html_url, state: pull.state },
  };
}

/**
 * Review a submission PR: download the changed submission directories from the PR head,
 * run preflight, and by default post the report as a PR comment.
 */
export async function reviewPullRequest({
  pr,
  repo = DEFAULT_SUBMISSIONS_REPO,
  token,
  comment = true,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!token) throw new Error('publish_review needs a GitHub token (run gh auth login or set GH_TOKEN)');
  if (!pr) throw new Error('pull request number is required');

  const pull = await api(`${API}/repos/${repo}/pulls/${pr}`, { token, fetchImpl });
  const headRepo = pull.head?.repo?.full_name;
  const sha = pull.head?.sha;
  if (!headRepo || !sha) throw new Error('the pull request head repository is unavailable');

  const changed = await api(`${API}/repos/${repo}/pulls/${pr}/files?per_page=100`, { token, fetchImpl });
  const submissionPaths = changed
    .map((file) => file.filename)
    .filter((path) => path.startsWith('submissions/'));
  if (submissionPaths.length === 0) throw new Error('the pull request does not touch submissions/');

  const dirs = [...new Set(submissionPaths.map((path) => path.split('/')[1]))].filter(Boolean);
  const root = mkdtempSync(join(tmpdir(), 'dsh-review-'));
  const reports = [];
  try {
    for (const dir of dirs) {
      const prefix = `submissions/${dir}/`;
      for (const path of submissionPaths.filter((item) => item.startsWith(prefix))) {
        const encoded = encodeURIComponent(path).replaceAll('%2F', '/');
        const content = await api(`${API}/repos/${headRepo}/contents/${encoded}?ref=${sha}`, { token, fetchImpl });
        const target = join(root, dir, path.slice(prefix.length));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, Buffer.from(content.content ?? '', 'base64'));
      }
      reports.push({ dir, result: preflightPackage(join(root, dir)) });
    }

    const report = renderReport({ pr, pull, reports });
    if (comment) {
      await api(`${API}/repos/${repo}/issues/${pr}/comments`, {
        token,
        method: 'POST',
        fetchImpl,
        body: { body: report },
      });
    }
    return { pr, sha, report, reports };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function renderReport({ pr, pull, reports }) {
  const lines = [
    '## 审核报告（自动预检）',
    '',
    `PR #${pr} · ${pull.title}`,
    `commit: ${String(pull.head?.sha ?? '').slice(0, 7)}`,
    '',
  ];
  for (const { dir, result } of reports) {
    lines.push(`### submissions/${dir}`, '', result.ok ? '**PASS**' : '**FAIL**', '');
    if (result.ok) {
      lines.push('- 规范检查全部通过');
    } else {
      for (const check of result.checks.filter((item) => !item.ok)) {
        lines.push(`- FAIL \`${check.id}\`: ${check.detail}`);
      }
    }
    lines.push('');
  }
  lines.push('> 自动预检只覆盖规范项；逻辑后门、依赖投毒仍需人工逐文件审核。');
  return lines.join('\n');
}
