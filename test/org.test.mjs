import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_ORG, orgArgs } from '../lib/org.mjs';

test('orgArgs builds list/verify/invite/remove commands', () => {
  assert.equal(DEFAULT_ORG, 'dsh-fubai');
  assert.deepEqual(orgArgs({ action: 'list', org: 'dsh-fubai' }), ['org', 'ls', 'dsh-fubai']);
  assert.deepEqual(
    orgArgs({ action: 'verify', org: 'dsh-fubai', user: 'alice' }),
    ['org', 'ls', 'dsh-fubai', 'alice'],
  );
  assert.deepEqual(
    orgArgs({ action: 'invite', org: 'dsh-fubai', user: 'alice' }),
    ['org', 'set', 'dsh-fubai', 'alice', 'developer'],
  );
  assert.deepEqual(
    orgArgs({ action: 'invite', org: 'dsh-fubai', user: 'alice', role: 'admin', otp: '123456' }),
    ['org', 'set', 'dsh-fubai', 'alice', 'admin', '--otp', '123456'],
  );
  assert.deepEqual(
    orgArgs({ action: 'remove', org: 'dsh-fubai', user: 'alice' }),
    ['org', 'rm', 'dsh-fubai', 'alice'],
  );
});

test('orgArgs validates inputs', () => {
  assert.throws(() => orgArgs({ action: 'list' }), /org is required/);
  assert.throws(() => orgArgs({ action: 'invite', org: 'x' }), /user is required/);
  assert.throws(() => orgArgs({ action: 'nope', org: 'x' }), /unknown org action/);
});
