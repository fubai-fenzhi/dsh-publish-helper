import assert from 'node:assert/strict';
import test from 'node:test';

import { npmrcLine, publishArgs, recallArgs } from '../lib/npm.mjs';

test('npmrcLine authenticates against the registry host', () => {
  assert.equal(npmrcLine('npm_x'), '//registry.npmjs.org/:_authToken=npm_x\n');
  assert.equal(
    npmrcLine('npm_y', 'https://registry.npmmirror.com/'),
    '//registry.npmmirror.com/:_authToken=npm_y\n',
  );
});

test('publishArgs publishes publicly with no lifecycle scripts and an optional OTP', () => {
  assert.deepEqual(publishArgs(), ['publish', '--ignore-scripts', '--access', 'public', '--tag', 'latest']);
  assert.deepEqual(
    publishArgs({ tag: 'next' }),
    ['publish', '--ignore-scripts', '--access', 'public', '--tag', 'next'],
  );
  assert.deepEqual(
    publishArgs({ tag: 'latest', otp: '123456' }),
    ['publish', '--ignore-scripts', '--access', 'public', '--tag', 'latest', '--otp', '123456'],
  );
});

test('recallArgs is version-scoped and never removes a whole package', () => {
  assert.deepEqual(recallArgs({ name: 'p', version: '1.0.0' }), ['unpublish', 'p@1.0.0', '--force']);
  assert.deepEqual(
    recallArgs({ name: 'p', version: '1.0.0', action: 'deprecate', message: 'withdrawn' }),
    ['deprecate', 'p@1.0.0', 'withdrawn'],
  );
  assert.throws(() => recallArgs({ name: 'p' }), /version is required/);
  assert.throws(() => recallArgs({ name: 'p', version: '1.0.0', action: 'deprecate' }), /needs a message/);
  assert.throws(() => recallArgs({ name: 'p', version: '1.0.0', action: 'delete' }), /unknown recall action/);
});
