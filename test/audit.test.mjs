import assert from 'node:assert/strict';
import test from 'node:test';

import { auditPackages, listOwnerPackages, npmWhoami, repoFromUrl } from '../lib/audit.mjs';

function response(status, data) {
  return { status, ok: status >= 200 && status < 300, async json() { return data; } };
}

test('repoFromUrl extracts owner/repo from common forms', () => {
  assert.equal(repoFromUrl('https://github.com/o/r'), 'o/r');
  assert.equal(repoFromUrl('git+https://github.com/o/r.git'), 'o/r');
  assert.equal(repoFromUrl('git@github.com:o/r.git'), 'o/r');
  assert.equal(repoFromUrl('https://example.com/o/r'), null);
  assert.equal(repoFromUrl(''), null);
});

test('listOwnerPackages maps npm search results', async () => {
  const fake = async (url) => {
    if (url.includes('/v1/search')) {
      return response(200, {
        objects: [{
          package: {
            name: 'dsh-r',
            version: '1.0.0',
            links: { repository: 'https://github.com/o/r' },
          },
        }],
      });
    }
    return response(404, {});
  };
  const packages = await listOwnerPackages({ user: 'u', fetchImpl: fake });
  assert.deepEqual(packages, [{ name: 'dsh-r', version: '1.0.0', repository: 'https://github.com/o/r' }]);
});

test('npmWhoami needs a token and returns the username', async () => {
  const fake = async () => response(200, { username: 'u' });
  assert.equal(await npmWhoami({ token: 't', fetchImpl: fake }), 'u');
  assert.equal(await npmWhoami({ token: '', fetchImpl: fake }), null);
});

test('auditPackages marks unlisted repos as needs-registry', async () => {
  const fake = async () => response(404, {});
  const result = await auditPackages({ repos: ['o/r'], fetchImpl: fake });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].repo, 'o/r');
  assert.equal(result.results[0].status, 'needs-registry');
});
