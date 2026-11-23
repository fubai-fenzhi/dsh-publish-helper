import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureRepo, uploadFiles } from '../lib/repo.mjs';

function response(status, data) {
  return { status, ok: status >= 200 && status < 300, async json() { return data; } };
}

test('ensureRepo tolerates an existing repo (422) and returns the default branch', async () => {
  const fake = async (url) => {
    if (url.endsWith('/user/repos')) return response(422, { message: 'exists' });
    if (url.endsWith('/repos/u/r')) return response(200, { default_branch: 'main' });
    return response(404, {});
  };
  const repo = await ensureRepo({ token: 't', owner: 'u', name: 'r', fetchImpl: fake });
  assert.equal(repo.defaultBranch, 'main');
});

test('uploadFiles creates and updates a file', async () => {
  const methods = [];
  const fake = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    methods.push(method);
    if (method === 'GET') return response(200, { sha: 'abc' });
    return response(201, { content: {} });
  };
  const written = await uploadFiles({
    token: 't',
    owner: 'u',
    name: 'r',
    files: [{ path: 'lib/a.js', content: 'eA==' }],
    fetchImpl: fake,
  });
  assert.deepEqual(written, ['lib/a.js']);
  assert.deepEqual(methods, ['GET', 'PUT']);
});
