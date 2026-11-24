import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { inboxDir, intakeZip, isSafeEntry, listInbox, safeExtractZip } from '../lib/intake.mjs';

test('isSafeEntry rejects traversal and absolute paths', () => {
  assert.equal(isSafeEntry('plugin/package.json'), true);
  assert.equal(isSafeEntry('plugin/README.md'), true);
  assert.equal(isSafeEntry('../evil.txt'), false);
  assert.equal(isSafeEntry('plugin/../../evil.txt'), false);
  assert.equal(isSafeEntry('/etc/passwd'), false);
  assert.equal(isSafeEntry('C:\\Windows\\x.txt'), false);
  assert.equal(isSafeEntry(''), false);
});

test('safeExtractZip validates entries before extraction', async () => {
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === '-tf') return { code: 0, stdout: 'plugin/package.json\nplugin/README.md\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const root = mkdtempSync(join(tmpdir(), 'dsh-intake-'));
  const count = await safeExtractZip({ zip: 'fake.zip', dest: join(root, 'pkg'), run });
  assert.equal(count, 2);
  assert.deepEqual(calls[0], ['tar', '-tf', 'fake.zip']);
  assert.deepEqual(calls[1], ['tar', '-xf', 'fake.zip', '-C', join(root, 'pkg')]);
  rmSync(root, { recursive: true, force: true });
});

test('safeExtractZip refuses traversal entries', async () => {
  const run = async (command, args) => (args[0] === '-tf'
    ? { code: 0, stdout: 'plugin/package.json\n../../evil.txt\n', stderr: '' }
    : { code: 0, stdout: '', stderr: '' });
  await assert.rejects(
    () => safeExtractZip({ zip: 'fake.zip', dest: join(tmpdir(), 'dsh-intake-x'), run }),
    /unsafe paths/,
  );
});

test('listInbox and inboxDir work on a temp directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-inbox-'));
  writeFileSync(join(root, 'demo.zip'), 'zip');
  const items = listInbox(root);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'demo.zip');
  assert.equal(inboxDir(root), join(root, '.dsh', 'publish-helper-inbox'));
  rmSync(root, { recursive: true, force: true });
});

test('intakeZip extracts and preflights', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-intake2-'));
  const run = async (command, args) => (args[0] === '-tf'
    ? { code: 0, stdout: 'package.json\n', stderr: '' }
    : { code: 0, stdout: '', stderr: '' });
  const zip = join(root, 'demo.zip');
  writeFileSync(zip, 'zip');
  const result = await intakeZip({
    zip,
    root,
    run,
    preflight: () => ({ ok: true, checks: [] }),
  });
  assert.equal(result.dir, join(root, 'demo'));
  assert.equal(result.preflight.ok, true);
  rmSync(root, { recursive: true, force: true });
});
