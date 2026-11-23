import assert from 'node:assert/strict';
import test from 'node:test';

import { bumpPatch, prepareManifest } from '../lib/manifest.mjs';

test('bumpPatch bumps the patch and drops a prerelease suffix', () => {
  assert.equal(bumpPatch('0.1.0'), '0.1.1');
  assert.equal(bumpPatch('1.2.3-preview.1'), '1.2.4');
  assert.equal(bumpPatch('bad'), '0.1.0');
});

test('prepareManifest adds repository/homepage and bumps the version', () => {
  const next = prepareManifest({ name: 'dsh-x', version: '0.1.0', license: 'MIT' }, { repo: 'o/r' });
  assert.equal(next.version, '0.1.1');
  assert.deepEqual(next.repository, { type: 'git', url: 'git+https://github.com/o/r.git' });
  assert.equal(next.homepage, 'https://github.com/o/r#readme');
  assert.equal(next.license, 'MIT');
});
