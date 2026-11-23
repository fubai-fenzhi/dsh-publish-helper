import { checkPlugin, repoFromUrl } from './discover.mjs';

export { repoFromUrl };

const NPM = 'https://registry.npmjs.org';

async function getJson(url, { token, fetchImpl = globalThis.fetch } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(url, { headers });
  if (!response.ok) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** npm username for a token, or null when the token is absent/invalid. */
export async function npmWhoami({ token, fetchImpl } = {}) {
  if (!token) return null;
  const data = await getJson(`${NPM}/-/whoami`, { token, fetchImpl });
  return data?.username ?? null;
}

/** Packages maintained by one npm user, with the repository link npm exposes. */
export async function listOwnerPackages({ user, fetchImpl, size = 250 } = {}) {
  if (!user) return [];
  const url = `${NPM}/-/v1/search?text=${encodeURIComponent(`maintainer:${user}`)}&size=${size}`;
  const data = await getJson(url, { fetchImpl });
  return (data?.objects ?? []).map((item) => ({
    name: item.package?.name ?? '',
    version: item.package?.version ?? '',
    repository: item.package?.links?.repository ?? '',
  }));
}

/**
 * Audit the user's npm packages (and any explicit repos): which are missing from the
 * awesome registry, which wait for the format-1 index, and which are ready.
 */
export async function auditPackages({ user, repos = [], token, fetchImpl } = {}) {
  const packages = user ? await listOwnerPackages({ user, fetchImpl }) : [];
  const entries = packages.map((pkg) => ({
    name: pkg.name,
    version: pkg.version,
    repo: repoFromUrl(pkg.repository),
  }));

  for (const repo of repos) {
    if (!repo) continue;
    if (entries.some((entry) => entry.repo === repo)) continue;
    entries.push({ name: repo.split('/')[1], version: '', repo });
  }

  const results = [];
  for (const entry of entries) {
    if (!entry.repo) {
      results.push({ ...entry, status: 'no-repository' });
      continue;
    }
    let check;
    try {
      check = await checkPlugin({ repo: entry.repo, name: entry.name, token, fetchImpl });
    } catch (error) {
      results.push({ ...entry, status: 'error', error: String(error) });
      continue;
    }
    const okOf = (id) => check.checks.find((item) => item.id === id)?.ok ?? false;
    const status = !okOf('registry')
      ? 'needs-registry'
      : (!okOf('catalog') ? 'needs-catalog' : 'ready');
    results.push({ ...entry, status, check });
  }

  return { user: user ?? null, results };
}
