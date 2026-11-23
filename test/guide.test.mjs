import assert from 'node:assert/strict';
import test from 'node:test';

import { AGENT_GUIDE, SECTION_NAME, SUBMISSION_SPEC } from '../lib/guide.mjs';

test('agent guide states the contract without the full manual', () => {
  assert.equal(SECTION_NAME, 'publish-helper');
  for (const word of ['package.json', 'install', '72', 'publish_check', 'publish_spec']) {
    assert.ok(AGENT_GUIDE.includes(word), `guide should mention ${word}`);
  }
  assert.ok(AGENT_GUIDE.length < 900, 'the injected section must stay small');
});

test('submission spec covers handover, flow and recall', () => {
  for (const word of ['SUBMISSION.md', 'node_modules', 'dsh.bundle', 'unpublish', 'dist-tag', '拒收']) {
    assert.ok(SUBMISSION_SPEC.includes(word), `spec should mention ${word}`);
  }
});
