import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const API = 'https://api.github.com';

async function api(url, { token, fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`GitHub ${response.status} ${url}`);
  return response.json();
}

/** Local cache of the latest review report per PR, so the panel can show it without GitHub. */
export function reviewsPath(home = homedir()) {
  return join(home, '.dsh', 'publish-helper-reviews.json');
}

export function readReviews(file = reviewsPath()) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function saveReview(entry, file = reviewsPath()) {
  const record = { at: new Date().toISOString(), ...entry };
  const list = readReviews(file).filter((item) => !(item.repo === record.repo && item.pr === record.pr));
  list.push(record);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
  return record;
}

export function summarizeChecks(checkRuns) {
  if (!Array.isArray(checkRuns) || checkRuns.length === 0) return 'none';
  if (checkRuns.some((run) => run.status !== 'completed')) return 'pending';
  if (checkRuns.some((run) => run.conclusion && !['success', 'neutral', 'skipped'].includes(run.conclusion))) {
    return 'failure';
  }
  return 'success';
}

/** Open submission PRs (one or more repositories) with CI status and review state. */
export async function listReviewQueue({ repo, repos, token, fetchImpl = globalThis.fetch, limit = 10, reviews = [] } = {}) {
  if (!token) throw new Error('review queue needs a GitHub token (run gh auth login)');
  const targets = Array.isArray(repos) && repos.length ? repos.filter(Boolean) : [repo].filter(Boolean);
  const items = [];
  for (const target of targets) {
    const pulls = await api(
      `${API}/repos/${target}/pulls?state=open&per_page=${limit}&sort=updated&direction=desc`,
      { token, fetchImpl },
    );
    for (const pull of pulls) {
      let checks = 'none';
      try {
        const runs = await api(`${API}/repos/${target}/commits/${pull.head.sha}/check-runs`, { token, fetchImpl });
        checks = summarizeChecks(runs.check_runs);
      } catch {
        // checks are best effort
      }
      const record = reviews.find((item) => item.repo === target && item.pr === pull.number);
      items.push({
        repo: target,
        pr: pull.number,
        title: pull.title,
        url: pull.html_url,
        author: pull.user?.login ?? '',
        sha: pull.head?.sha ?? '',
        createdAt: pull.created_at,
        updatedAt: pull.updated_at,
        draft: pull.draft === true,
        checks,
        reviewed: Boolean(record && record.sha === pull.head?.sha),
        reviewAt: record?.at ?? null,
      });
    }
  }
  return items;
}
