import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { readLocalConfig, writeLocalConfig } from '../lib/config.mjs';

test('readLocalConfig is empty for a missing file', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-ph-config-'));
  assert.deepEqual(readLocalConfig(join(root, 'missing.json')), { token: '', registryRepo: '', npmUser: '', npmToken: '' });
  rmSync(root, { recursive: true, force: true });
});

test('writeLocalConfig writes and merges fields', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-ph-config-'));
  const file = join(root, 'publish-helper.json');
  writeLocalConfig({ token: 'ghp_x' }, file);
  assert.equal(readLocalConfig(file).token, 'ghp_x');
  writeLocalConfig({ registryRepo: 'o/r' }, file);
  const merged = readLocalConfig(file);
  assert.equal(merged.token, 'ghp_x');
  assert.equal(merged.registryRepo, 'o/r');
  rmSync(root, { recursive: true, force: true });
});
