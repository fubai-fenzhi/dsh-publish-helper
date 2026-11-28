import assert from 'node:assert/strict';
import test from 'node:test';

import { WORKFLOW_MODES, workflowText } from '../lib/workflow.mjs';

test('trusted mode has no NODE_AUTH_TOKEN and requests OIDC', () => {
  const text = workflowText('trusted');
  assert.ok(text.includes('id-token: write'));
  assert.ok(!text.includes('NODE_AUTH_TOKEN:'));
  assert.ok(!text.includes('secrets.NPM_TOKEN'));
  assert.ok(text.includes('--provenance'));
  assert.ok(!text.includes('__NODE_AUTH_ENV__'));
  assert.ok(!text.includes('__PUBLISH_CMD__'));
});

test('token mode injects the NPM_TOKEN secret', () => {
  const text = workflowText('token');
  assert.ok(text.includes('NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}'));
  assert.ok(text.includes('--provenance'));
});

test('stage option switches to npm stage publish', () => {
  assert.ok(workflowText('trusted', { stage: true }).includes('npm stage publish'));
  assert.ok(workflowText('trusted').includes('npm publish'));
});

test('re-running a tag for an already published version skips publish', () => {
  const text = workflowText('trusted', { stage: true });
  assert.ok(text.includes('Skip publish when this version already exists'));
  assert.ok(text.includes("steps.published.outputs.skip != 'true'"));
});

test('unknown mode is rejected', () => {
  assert.throws(() => workflowText('nope'), /unknown mode/);
  assert.deepEqual(WORKFLOW_MODES, ['trusted', 'token']);
});
