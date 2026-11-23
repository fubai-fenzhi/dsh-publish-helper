import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { preflightPackage } from './preflight.mjs';
import { ensureRepo, getLogin, uploadFiles } from './repo.mjs';

const API = 'https://api.github.com';

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

export function nextVersion(current, bump = 'patch') {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(current ?? ''));
  if (!match) throw new Error(`invalid version: ${current}`);
  let [major, minor, patch] = match.slice(1).map(Number);
  if (bump === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (bump === 'minor') {
    minor += 1;
    patch = 0;
  } else if (bump === 'patch') {
    patch += 1;
  } else {
    throw new Error(`unknown bump: ${bump}`);
  }
  return `${major}.${minor}.${patch}`;
}

export function repoFromPackage(pkg) {
  const value = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const match = /github\.com[/:]([^/]+)\/([^/#]+?)(?:\.git)?$/.exec(String(value ?? '').trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

function walk(root, current = root, out = []) {
  for (const entry of readdirSync(current)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = join(current, entry);
    if (statSync(full).isDirectory()) walk(root, full, out);
    else out.push(relative(root, full).replaceAll('\\', '/'));
  }
  return out;
}

function failedLines(preflight) {
  return preflight.checks
    .filter((check) => !check.ok)
    .map((check) => `${check.id}: ${check.detail}`)
    .join('\n');
}

/**
 * Bump the version, upload the directory to its repository and create a vX.Y.Z tag
 * so the release workflow publishes it.
 */
export async function releasePackage({
  dir,
  token,
  repo,
  bump = 'patch',
  version,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!token) throw new Error('publish_tag needs a GitHub token (run gh auth login or set GH_TOKEN)');
  const directory = String(dir ?? '');
  const manifest = join(directory, 'package.json');
  if (!existsSync(manifest)) throw new Error(`no package.json in ${directory}`);
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  const target = version ?? nextVersion(pkg.version, bump);

  pkg.version = target;
  writeFileSync(manifest, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

  const preflight = preflightPackage(directory);
  if (!preflight.ok) throw new Error(`preflight failed:\n${failedLines(preflight)}`);

  const login = await getLogin({ token, fetchImpl });
  const repoSpec = repo ?? repoFromPackage(pkg) ?? `${login}/${pkg.name}`;
  const [owner, name] = repoSpec.split('/');
  if (!owner || !name) throw new Error(`invalid repository: ${repoSpec}`);
  await ensureRepo({
    token,
    owner,
    name,
    description: typeof pkg.description === 'string' ? pkg.description : '',
    fetchImpl,
  });

  const files = walk(directory).map((path) => ({
    path,
    content: readFileSync(join(directory, path)).toString('base64'),
  }));
  const workflowPath = '.github/workflows/release.yml';
  if (!files.some((file) => file.path === workflowPath)) {
    const template = readFileSync(new URL('../templates/release.yml', import.meta.url), 'utf8');
    files.push({ path: workflowPath, content: Buffer.from(template, 'utf8').toString('base64') });
  }
  await uploadFiles({
    token,
    owner,
    name,
    files,
    message: `release v${target}`,
    fetchImpl,
  });

  const head = await api(`${API}/repos/${owner}/${name}/commits/main`, { token, fetchImpl });
  const tag = `v${target}`;
  let exists = false;
  try {
    await api(`${API}/repos/${owner}/${name}/git/ref/tags/${tag}`, { token, fetchImpl });
    exists = true;
  } catch (error) {
    if (!String(error).includes(' 404 ')) throw error;
  }
  if (exists) throw new Error(`tag ${tag} already exists in ${owner}/${name}`);

  await api(`${API}/repos/${owner}/${name}/git/refs`, {
    token,
    method: 'POST',
    fetchImpl,
    body: { ref: `refs/tags/${tag}`, sha: head.sha },
  });

  return { repo: `${owner}/${name}`, version: target, tag, commit: head.sha };
}
