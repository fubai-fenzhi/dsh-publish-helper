import assert from 'node:assert/strict';
import test from 'node:test';

import { WORKFLOW_MODES, workflowText } from '../lib/workflow.mjs';

test('trusted mode has no NODE_AUTH_TOKEN and requests OIDC', () => {
  const text = workflowText('trusted');
  assert.ok(text.includes('id-token: write'));
  assert.ok(!text.includes('NODE_AUTH_TOKEN'));
  assert.ok(text.includes('--provenance'));
  assert.ok(!text.includes('__NODE_AUTH_ENV__'));
});

test('token mode injects the NPM_TOKEN secret', () => {
  const text = workflowText('token');
  assert.ok(text.includes('NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}'));
  assert.ok(text.includes('--provenance'));
});

test('unknown mode is rejected', () => {
  assert.throws(() => workflowText('nope'), /unknown mode/);
  assert.deepEqual(WORKFLOW_MODES, ['trusted', 'token']);
});
