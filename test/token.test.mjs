import assert from 'node:assert/strict';
import test from 'node:test';

import { parseExpiryHeader, probeNpmToken, probeToken } from '../lib/token.mjs';

test('parseExpiryHeader accepts ISO and GitHub space-separated UTC forms', () => {
  assert.equal(parseExpiryHeader('2026-12-21T12:00:00Z'), '2026-12-21T12:00:00.000Z');
  assert.equal(parseExpiryHeader('2026-12-21 12:00:00 UTC'), '2026-12-21T12:00:00.000Z');
  assert.equal(parseExpiryHeader(''), null);
  assert.equal(parseExpiryHeader('not a date'), null);
});

test('probeToken reports remaining days from the expiry header', async () => {
  const fake = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'github-authentication-token-expiration': '2026-12-21 12:00:00 UTC' }),
  });
  const result = await probeToken({ token: 't', fetchImpl: fake, now: () => Date.parse('2026-11-21T12:00:00Z') });
  assert.equal(result.valid, true);
  assert.equal(result.daysLeft, 30);
  assert.equal(result.neverExpires, false);
});

test('probeToken flags an expired token and one without a header', async () => {
  const expired = async () => ({ ok: false, status: 401, headers: new Headers() });
  assert.equal((await probeToken({ token: 't', fetchImpl: expired })).valid, false);

  const forever = async () => ({ ok: true, status: 200, headers: new Headers() });
  const result = await probeToken({ token: 't', fetchImpl: forever });
  assert.equal(result.valid, true);
  assert.equal(result.neverExpires, true);
});

test('probeNpmToken checks the registry whoami endpoint', async () => {
  const good = async () => ({ ok: true, status: 200 });
  const bad = async () => ({ ok: false, status: 401 });
  assert.equal(await probeNpmToken({ token: 't', fetchImpl: good }), true);
  assert.equal(await probeNpmToken({ token: 't', fetchImpl: bad }), false);
  assert.equal(await probeNpmToken({ token: '', fetchImpl: good }), false);
});
