import assert from 'node:assert/strict';
import test from 'node:test';

import { SKILL_CONTENT, SKILL_REGISTRATION } from '../lib/skill.mjs';

test('skill registration exposes a loadable summary', () => {
  assert.equal(SKILL_REGISTRATION.name, 'publish-release');
  assert.ok(SKILL_REGISTRATION.description.length > 20);
  assert.equal(SKILL_REGISTRATION.source, 'custom');
  assert.ok(SKILL_REGISTRATION.whenToUse.includes('publish'));
});

test('skill content covers the release steps', () => {
  for (const step of ['publish_preflight', 'publish_check', 'publish_repo', 'publish_npm', 'publish_entry', 'publish_pr', 'publish_recall']) {
    assert.ok(SKILL_CONTENT.includes(step), `missing ${step}`);
  }
  assert.ok(SKILL_CONTENT.includes('deprecate'));
  assert.ok(SKILL_CONTENT.length < 8000);
});
