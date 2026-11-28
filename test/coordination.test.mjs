import assert from 'node:assert/strict';
import test from 'node:test';

import { assertReleaseApproved, findApprovedRelease } from '../lib/coordination.mjs';

function fakeFetch(state, status = 200) {
  return async () => ({ ok: status === 200, status, json: async () => state });
}

test('findApprovedRelease finds a matching approved request', async () => {
  const found = await findApprovedRelease({
    pkg: 'dsh-publish-helper',
    version: '0.23.6',
    fetchImpl: fakeFetch({
      releases: [
        { id: 1, pkg: 'dsh-publish-helper', version: '0.23.6', status: 'pending' },
        { id: 2, pkg: 'dsh-publish-helper', version: '0.23.6', status: 'approved' },
      ],
    }),
  });
  assert.equal(found.id, 2);
});

test('findApprovedRelease ignores pending and other versions', async () => {
  const found = await findApprovedRelease({
    pkg: 'pkg',
    version: '1.0.0',
    fetchImpl: fakeFetch({
      releases: [
        { id: 1, pkg: 'pkg', version: '1.0.0', status: 'pending' },
        { id: 2, pkg: 'pkg', version: '2.0.0', status: 'approved' },
      ],
    }),
  });
  assert.equal(found, null);
});

test('assertReleaseApproved blocks without approval and allows explicit override', async () => {
  const fetchImpl = fakeFetch({ releases: [] });
  await assert.rejects(
    () => assertReleaseApproved({ pkg: 'pkg', version: '1.0.0', fetchImpl }),
    /release blocked/,
  );
  const overridden = await assertReleaseApproved({
    pkg: 'pkg',
    version: '1.0.0',
    fetchImpl,
    allowUnapproved: true,
  });
  assert.equal(overridden.overridden, true);
});

test('assertReleaseApproved reports an unreachable workbench', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(
    () => assertReleaseApproved({ pkg: 'pkg', version: '1.0.0', fetchImpl }),
    /workbench unreachable/,
  );
});
