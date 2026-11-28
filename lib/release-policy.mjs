import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';

/** Read the package name/version/repository without running anything. */
export function readPackage(dir) {
  const file = join(dir, 'package.json');
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  return { name: pkg.name, version: pkg.version, repository: pkg.repository };
}

/** Normalize package.json repository (string or object) into owner/name. */
export function githubRepoFromRepository(value) {
  const raw = typeof value === 'string' ? value : value?.url;
  if (!raw) return null;
  const cleaned = String(raw)
    .replace(/^git\+/, '')
    .replace(/^github:/, '')
    .replace(/\.git$/, '');
  const match = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)/);
  return match ? `${match[1]}/${match[2]}` : null;
}

export function expectedTag(version) {
  return `v${version}`;
}

/** Pure decision: is this version covered by a release tag? */
export function evaluateTags({ version, tags }) {
  if (!Array.isArray(tags) || tags.length === 0) {
    return { ok: true, bootstrap: true, reason: 'repository has no tags yet (first publish)' };
  }
  const tag = expectedTag(version);
  if (tags.includes(tag)) return { ok: true, tag };
  return { ok: false, tag, reason: `missing tag ${tag}` };
}

export async function fetchReleaseTags({ repo, token, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/tags?per_page=100`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dsh-publish-helper',
    },
  });
  if (!response.ok) throw new Error(`cannot list tags for ${repo}: HTTP ${response.status}`);
  const data = await response.json();
  return data.map((item) => item.name);
}

/**
 * Refuse an untagged direct publish when the repository already uses tags.
 * First publishes (no tags) and repositories without a GitHub URL stay allowed.
 */
export async function assertReleaseTag({ dir, token, allowUntagged = false, fetchImpl = fetch }) {
  const pkg = readPackage(dir);
  const repo = githubRepoFromRepository(pkg.repository);
  if (!repo) return { ok: true, skipped: 'no GitHub repository' };
  if (!token) return { ok: true, skipped: 'no GitHub token' };
  const tags = await fetchReleaseTags({ repo, token, fetchImpl });
  const result = evaluateTags({ version: pkg.version, tags });
  if (result.ok) return { ...result, repo, name: pkg.name, version: pkg.version };
  if (allowUntagged) return { ...result, ok: true, overridden: true, repo };
  throw new Error(
    `refusing untagged publish: ${pkg.name}@${pkg.version} has no ${result.tag} in ${repo}. `
      + 'Use publish_tag (tag -> CI) instead, or pass allowUntagged=true for an explicit exception.',
  );
}

/**
 * One release at a time across sessions. Stale locks older than staleMs are reclaimed.
 * Returns a handle; always call releaseReleaseLock in a finally block.
 */
export function acquireReleaseLock({ path, meta = {}, staleMs = 2 * 60 * 60 * 1000, now = Date.now() }) {
  const payload = JSON.stringify({ ...meta, at: new Date(now).toISOString() });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(path, 'wx');
      writeSync(fd, payload);
      closeSync(fd);
      return { path, release: () => releaseReleaseLock(path) };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let holder = null;
      try {
        holder = JSON.parse(readFileSync(path, 'utf8'));
      } catch {
        holder = null;
      }
      const age = holder?.at ? now - Date.parse(holder.at) : Number.POSITIVE_INFINITY;
      if (age > staleMs) {
        try {
          unlinkSync(path);
        } catch {
          // another process reclaimed it first; retry below
        }
        continue;
      }
      throw new Error(`another release is in progress: ${JSON.stringify(holder ?? { path })}`);
    }
  }
  throw new Error(`could not acquire release lock at ${path}`);
}

export function releaseReleaseLock(path) {
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // already gone
    }
  }
}
