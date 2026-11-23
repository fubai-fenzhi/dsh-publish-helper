import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { appendPublishLog, publishLogPath, readPublishLog } from '../lib/log.mjs';

test('publish history is appended and readable', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-ph-log-'));
  const file = join(root, '.dsh', 'publish-helper-log.json');
  assert.equal(publishLogPath(root), file);
  assert.deepEqual(readPublishLog(file), []);
  appendPublishLog({ kind: 'publish', name: 'p', version: '1.0.0' }, file);
  appendPublishLog({ kind: 'unpublish', name: 'p', version: '1.0.0' }, file);
  const list = readPublishLog(file);
  assert.equal(list.length, 2);
  assert.equal(list[0].kind, 'publish');
  assert.equal(list[1].kind, 'unpublish');
  assert.ok(list[0].at, 'each record gets a timestamp');
  rmSync(root, { recursive: true, force: true });
});
