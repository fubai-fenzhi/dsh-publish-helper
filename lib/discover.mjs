const GITHUB = 'https://api.github.com';
const REGISTRY = 'https://awesome-dsh-plugin.com/plugins.json';
const CATALOG = 'https://awesome-dsh-plugin.com/index.json';

function headers(token) {
  const result = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) result.Authorization = `Bearer ${token}`;
  return result;
}

async function getJson(url, { token, fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(url, { headers: headers(token) });
  if (!response.ok) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function getText(url, { fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(url);
  if (!response.ok) return null;
  return response.text();
}

/** Extract owner/repo from a GitHub URL (https, git+, or git@). */
export function repoFromUrl(url) {
  const match = String(url ?? '').match(/github\.com[/:]([^/]+)\/([^/#?]+)/i);
  if (!match) return null;
  return `${match[1]}/${match[2].replace(/\.git$/, '')}`;
}

/**
 * Accept either `owner/repo` or a bare npm package name. A package name is
 * resolved through its npm `repository` field, which is exactly the metadata
 * the registry needs to link the package anyway.
 */
export async function resolveRepo({ input, fetchImpl } = {}) {
  const value = String(input ?? '').trim();
  if (!value) throw new Error('repo is empty');
  if (value.includes('/')) return { repo: value, directory: null, fromPackage: null };
  const data = await getJson(`https://registry.npmjs.org/${encodeURIComponent(value)}`, { fetchImpl });
  if (!data) throw new Error(`npm package ${value} not found`);
  const latest = data['dist-tags']?.latest;
  const pkg = latest ? (data.versions?.[latest] ?? null) : null;
  const repository = pkg?.repository;
  const url = typeof repository === 'string' ? repository : (repository?.url ?? '');
  const directory = typeof repository === 'object' ? (repository?.directory ?? null) : null;
  const repo = repoFromUrl(url);
  if (!repo) {
    throw new Error(`npm package ${value} has no repository field; add it to package.json and publish a patch version`);
  }
  return { repo, directory, fromPackage: value };
}

/** Search GitHub repositories carrying the `dsh-plugin` topic, star-ranked. */
export async function searchTopic({ query = '', token, limit = 20, fetchImpl } = {}) {
  const q = encodeURIComponent(`topic:dsh-plugin ${query}`.trim());
  const data = await getJson(
    `${GITHUB}/search/repositories?q=${q}&sort=stars&order=desc&per_page=${limit}`,
    { token, fetchImpl },
  );
  if (!data) return { total: 0, items: [] };
  return {
    total: data.total_count ?? 0,
    items: (data.items ?? []).map((item) => ({
      fullName: item.full_name,
      stars: item.stargazers_count ?? 0,
      description: item.description ?? '',
      url: item.html_url,
    })),
  };
}

export async function repoInfo({ repo, token, fetchImpl } = {}) {
  const data = await getJson(`${GITHUB}/repos/${repo}`, { token, fetchImpl });
  if (!data) return null;
  return {
    fullName: data.full_name,
    stars: data.stargazers_count ?? 0,
    forks: data.forks_count ?? 0,
    topics: data.topics ?? [],
    createdAt: data.created_at,
    pushedAt: data.pushed_at,
    license: data.license?.spdx_id ?? null,
    description: data.description ?? '',
  };
}

export async function readManifest({ repo, directory, fetchImpl } = {}) {
  const prefix = directory ? `${String(directory).replace(/^\/+|\/+$/g, '')}/` : '';
  const text = await getText(`https://raw.githubusercontent.com/${repo}/HEAD/${prefix}package.json`, { fetchImpl });
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function npmInfo({ name, fetchImpl } = {}) {
  const data = await getJson(`https://registry.npmjs.org/${encodeURIComponent(name)}`, { fetchImpl });
  if (!data) return null;
  const latest = data['dist-tags']?.latest ?? null;
  return {
    latest,
    package: latest ? (data.versions?.[latest] ?? null) : null,
    time: latest ? (data.time?.[latest] ?? null) : null,
  };
}

/** True when the npm package's repository field points back at the GitHub repo. */
export function repositoryMatches(repository, repo) {
  const raw = typeof repository === 'string' ? repository : (repository?.url ?? '');
  const normalized = String(raw).replace(/^git\+/, '').replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase();
  return normalized === `https://github.com/${repo}`.toLowerCase();
}

export async function registryEntry({ name, fetchImpl } = {}) {
  const data = await getJson(REGISTRY, { fetchImpl });
  if (!data) return null;
  const list = Array.isArray(data) ? data : (data.plugins ?? data.items ?? []);
  return list.find((entry) => entry.name === name) ?? null;
}

export async function catalogEntry({ name, fetchImpl } = {}) {
  const data = await getJson(CATALOG, { fetchImpl });
  if (!data) return null;
  return (data.plugins ?? []).find((entry) => entry.name === name) ?? null;
}

/** Aggregate the checks a plugin should pass before and after it is listed. */
export async function checkPlugin({ repo, name, token, directory, fetchImpl } = {}) {
  const [info, manifest, npm, registry, catalog] = await Promise.all([
    repoInfo({ repo, token, fetchImpl }),
    readManifest({ repo, directory, fetchImpl }),
    npmInfo({ name, fetchImpl }),
    registryEntry({ name, fetchImpl }),
    catalogEntry({ name, fetchImpl }),
  ]);

  const topicOk = Boolean(info?.topics?.includes('dsh-plugin'));
  const repositoryOk = repositoryMatches(npm?.package?.repository, repo);

  const checks = [
    { id: 'repo', ok: Boolean(info), detail: info ? `${info.fullName} · ${info.stars}★` : 'repository not reachable' },
    { id: 'topic', ok: topicOk, detail: topicOk ? 'dsh-plugin' : `topics: ${info?.topics?.join(', ') || 'none'}` },
    { id: 'bundle', ok: Boolean(manifest?.dsh?.bundle), detail: manifest?.dsh?.bundle ? 'dsh.bundle present' : 'missing dsh.bundle in package.json' },
    { id: 'npm', ok: Boolean(npm?.latest), detail: npm?.latest ? `npm ${name}@${npm.latest}` : 'not published on npm' },
    { id: 'repository', ok: repositoryOk, detail: repositoryOk ? 'npm repository backlink ok' : 'npm repository does not point back' },
    { id: 'registry', ok: Boolean(registry), detail: registry ? `awesome entry · npm=${registry.npm ?? 'null'}` : 'not in awesome-dsh-plugin yet' },
    { id: 'catalog', ok: Boolean(catalog), detail: catalog ? `format-1 index · ${catalog.versions?.length ?? 0} version(s)` : 'not in the format-1 index yet (npm metadata may lag)' },
  ];

  return {
    repo,
    name,
    stars: info?.stars ?? 0,
    ok: checks.filter((check) => check.id !== 'catalog').every((check) => check.ok),
    checks,
  };
}
