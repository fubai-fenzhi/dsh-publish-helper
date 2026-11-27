import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { workflowText } from '../lib/workflow.mjs';

const template = readFileSync(new URL('../templates/release.yml', import.meta.url), 'utf8');

test('release template triggers on tags and keeps publish placeholders', () => {
  assert.match(template, /tags:\s*\n\s*- 'v\*'/);
  assert.match(template, /id-token: write/);
  assert.match(template, /__PUBLISH_CMD__ --provenance --access public/);
  assert.match(template, /Verify the tag matches package\.json/);
  assert.match(template, /__NODE_AUTH_ENV__/);
});

test('rendered trusted workflow has no static npm token', () => {
  const text = workflowText('trusted');
  assert.doesNotMatch(text, /__NODE_AUTH_ENV__/);
  assert.doesNotMatch(text, /__PUBLISH_CMD__/);
  assert.doesNotMatch(text, /NODE_AUTH_TOKEN:/);
  assert.doesNotMatch(text, /secrets\.NPM_TOKEN/);
  assert.match(text, /npm publish --provenance/);
});

test('rendered token workflow injects the secret', () => {
  const text = workflowText('token');
  assert.match(text, /NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/);
});

test('staged mode runs npm stage publish', () => {
  const text = workflowText('trusted', { stage: true });
  assert.match(text, /npm stage publish --provenance/);
  assert.doesNotMatch(text, /npm publish --provenance/);
});
