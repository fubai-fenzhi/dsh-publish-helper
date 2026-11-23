import assert from 'node:assert/strict';
import test from 'node:test';

import { nextVersion, repoFromPackage } from '../lib/release.mjs';

test('nextVersion bumps patch, minor and major', () => {
  assert.equal(nextVersion('0.21.3', 'patch'), '0.21.4');
  assert.equal(nextVersion('0.21.3', 'minor'), '0.22.0');
  assert.equal(nextVersion('0.21.3', 'major'), '1.0.0');
  assert.equal(nextVersion('1.2.3-beta.1', 'patch'), '1.2.4');
  assert.throws(() => nextVersion('nope'), /invalid version/);
  assert.throws(() => nextVersion('1.0.0', 'huge'), /unknown bump/);
});

test('repoFromPackage handles git+https and https URLs', () => {
  assert.equal(repoFromPackage({ repository: { url: 'git+https://github.com/o/r.git' } }), 'o/r');
  assert.equal(repoFromPackage({ repository: 'https://github.com/o/r' }), 'o/r');
  assert.equal(repoFromPackage({ repository: { url: 'https://gitlab.com/o/r.git' } }), null);
});
