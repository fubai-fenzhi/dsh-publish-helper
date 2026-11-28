import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  acquireReleaseLock,
  assertReleaseTag,
  evaluateTags,
  githubRepoFromRepository,
  readPackage,
  releaseReleaseLock,
} from '../lib/release-policy.mjs';

function packageDir(version = '1.2.3', repository = 'https://github.com/acme/plugin') {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-policy-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-acme',
    version,
    repository,
  }));
  return dir;
}

test('githubRepoFromRepository handles string and object forms', () => {
  assert.equal(githubRepoFromRepository('https://github.com/acme/plugin'), 'acme/plugin');
  assert.equal(githubRepoFromRepository('git+https://github.com/acme/plugin.git'), 'acme/plugin');
  assert.equal(githubRepoFromRepository({ type: 'git', url: 'git+ssh://git@github.com/acme/plugin.git' }), 'acme/plugin');
  assert.equal(githubRepoFromRepository(undefined), null);
  assert.equal(githubRepoFromRepository('https://gitlab.com/acme/plugin'), null);
});

test('evaluateTags passes when the version tag exists or the repo has no tags', () => {
  assert.deepEqual(evaluateTags({ version: '1.2.3', tags: ['v1.2.3'] }).ok, true);
  assert.deepEqual(evaluateTags({ version: '1.2.3', tags: [] }).bootstrap, true);
  assert.equal(evaluateTags({ version: '1.2.3', tags: ['v1.2.2'] }).ok, false);
});

test('assertReleaseTag refuses untagged publish and allows explicit override', async () => {
  const dir = packageDir('1.2.3');
  const fetchImpl = async () => ({ ok: true, json: async () => [{ name: 'v1.2.2' }] });
  await assert.rejects(() => assertReleaseTag({ dir, token: 't', fetchImpl }), /refusing untagged publish/);
  const allowed = await assertReleaseTag({ dir, token: 't', fetchImpl, allowUntagged: true });
  assert.equal(allowed.overridden, true);
  rmSync(dir, { recursive: true, force: true });
});

test('assertReleaseTag skips repositories without GitHub URL', async () => {
  const dir = packageDir('1.2.3', 'https://gitlab.com/acme/plugin');
  const result = await assertReleaseTag({ dir, token: 't' });
  assert.equal(result.ok, true);
  assert.match(result.skipped, /no GitHub repository/);
  rmSync(dir, { recursive: true, force: true });
});

test('release lock blocks a second acquisition and can be released', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lock-'));
  const path = join(dir, 'release.lock');
  const handle = acquireReleaseLock({ path, meta: { tool: 'test' } });
  assert.throws(() => acquireReleaseLock({ path, meta: { tool: 'second' } }), /another release is in progress/);
  releaseReleaseLock(handle.path);
  const again = acquireReleaseLock({ path, meta: { tool: 'third' }, now: Date.now() });
  again.release();
  rmSync(dir, { recursive: true, force: true });
});

test('stale release locks are reclaimed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lock-stale-'));
  const path = join(dir, 'release.lock');
  const old = Date.now() - 3 * 60 * 60 * 1000;
  writeFileSync(path, JSON.stringify({ tool: 'old', at: new Date(old).toISOString() }));
  const handle = acquireReleaseLock({ path, meta: { tool: 'new' } });
  handle.release();
  rmSync(dir, { recursive: true, force: true });
});

test('readPackage reads name, version and repository', () => {
  const dir = packageDir('9.9.9', 'https://github.com/acme/plugin');
  assert.deepEqual(readPackage(dir), {
    name: 'dsh-acme',
    version: '9.9.9',
    repository: 'https://github.com/acme/plugin',
  });
  rmSync(dir, { recursive: true, force: true });
});
