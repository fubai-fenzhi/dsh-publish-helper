import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  listReviewQueue,
  readReviews,
  reviewsPath,
  saveReview,
  summarizeChecks,
} from '../lib/reviews.mjs';

function response(status, data) {
  return { status, ok: status >= 200 && status < 300, async json() { return data; } };
}

test('summarizeChecks reflects pending, failure and success', () => {
  assert.equal(summarizeChecks([]), 'none');
  assert.equal(summarizeChecks([{ status: 'in_progress', conclusion: null }]), 'pending');
  assert.equal(summarizeChecks([{ status: 'completed', conclusion: 'failure' }]), 'failure');
  assert.equal(summarizeChecks([{ status: 'completed', conclusion: 'success' }]), 'success');
});

test('listReviewQueue joins PRs, checks and local review records', async () => {
  const fake = async (url) => {
    if (url.includes('/pulls?')) {
      return response(200, [{
        number: 7,
        title: 'Submit dsh-demo',
        user: { login: 'u' },
        head: { sha: 'abc' },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
        draft: false,
      }]);
    }
    if (url.includes('/check-runs')) {
      return response(200, { check_runs: [{ status: 'completed', conclusion: 'success' }] });
    }
    return response(404, {});
  };

  const items = await listReviewQueue({
    repo: 'o/r',
    token: 't',
    fetchImpl: fake,
    reviews: [{ repo: 'o/r', pr: 7, sha: 'abc', at: '2026-01-03T00:00:00Z' }],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].checks, 'success');
  assert.equal(items[0].reviewed, true);
  assert.equal(items[0].author, 'u');
});

test('review records are stored per PR', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-ph-reviews-'));
  const file = join(root, 'reviews.json');
  assert.equal(reviewsPath(root), join(root, '.dsh', 'publish-helper-reviews.json'));
  saveReview({ repo: 'o/r', pr: 7, sha: 'a', report: 'first' }, file);
  saveReview({ repo: 'o/r', pr: 7, sha: 'b', report: 'second' }, file);
  const list = readReviews(file);
  assert.equal(list.length, 1);
  assert.equal(list[0].report, 'second');
  rmSync(root, { recursive: true, force: true });
});
