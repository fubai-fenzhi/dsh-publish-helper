import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { npmrcPath, parseNpmrcToken, readNpmrcToken } from '../lib/credentials.mjs';

test('parses the registry token from .npmrc', () => {
  const text = [
    'registry=https://registry.npmjs.org/',
    '//registry.npmjs.org/:_authToken=npm_abc123',
    '//registry.npmmirror.com/:_authToken=npm_other',
    '',
  ].join('\n');
  assert.equal(parseNpmrcToken(text), 'npm_abc123');
});

test('falls back to a non-default registry token when the public one is missing', () => {
  const text = '//registry.npmmirror.com/:_authToken=npm_other\n';
  assert.equal(parseNpmrcToken(text), 'npm_other');
});

test('missing or empty files yield no token', () => {
  assert.equal(parseNpmrcToken(''), '');
  assert.equal(parseNpmrcToken('registry=https://registry.npmjs.org/'), '');
  assert.equal(readNpmrcToken('Z:/definitely/missing/.npmrc'), '');
  assert.equal(npmrcPath('C:/Users/x'), join('C:/Users/x', '.npmrc'));
});
