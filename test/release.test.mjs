import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const template = readFileSync(new URL('../templates/release.yml', import.meta.url), 'utf8');

test('release template triggers on tags and uses trusted publishing', () => {
  assert.match(template, /tags:\s*\n\s*- 'v\*'/);
  assert.match(template, /id-token: write/);
  assert.match(template, /npm publish --provenance --access public/);
  assert.match(template, /Verify the tag matches package\.json/);
});
