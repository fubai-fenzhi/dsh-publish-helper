const API = 'https://api.github.com';
export const DEFAULT_REGISTRY_REPO = 'awesome-dsh-plugin/awesome-dsh-plugin';

function yamlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Generate the registry entry file; descriptions with `: ` stay valid because they are quoted. */
export function generateEntry({ repo, name, category = 'tools', en, zh, tarball } = {}) {
  const lines = [
    `url: https://github.com/${repo}`,
    `name: ${name ?? repo}`,
    `category: ${category}`,
    'description:',
    `  en: ${yamlQuote(en ?? '')}`,
  ];
  if (zh) lines.push(`  zh: ${yamlQuote(zh)}`);
  if (tarball) lines.push(`tarball: ${tarball}`);
  return `${lines.join('\n')}\n`;
}

async function api(url, { token, method = 'GET', body, fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    let detail = '';
    try {
      detail = JSON.stringify(await response.json());
    } catch {
      // status-only message
    }
    throw new Error(`GitHub ${response.status} ${url}${detail ? `: ${detail}` : ''}`);
  }
  return response.json();
}

/**
 * Fork the registry, write the entry file on the fork's main branch and open a pull request.
 * Never touches any other entry.
 */
export async function forkAndOpenPr({
  repo,
  token,
  entry,
  title,
  body = '',
  registryRepo = DEFAULT_REGISTRY_REPO,
  fetchImpl,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = 10,
} = {}) {
  if (!token) throw new Error('publish_pr needs a GitHub token with repo scope');
  const user = await api(`${API}/user`, { token, fetchImpl });
  const owner = user.login;
  const forkRepo = `${owner}/${registryRepo.split('/').pop()}`;

  try {
    await api(`${API}/repos/${registryRepo}/forks`, { token, method: 'POST', fetchImpl });
  } catch {
    // An existing fork answers 422; the fork is still usable.
  }

  let ready = null;
  for (let index = 0; index < attempts; index += 1) {
    try {
      ready = await api(`${API}/repos/${forkRepo}`, { token, fetchImpl });
      break;
    } catch {
      await sleep(2000);
    }
  }
  if (!ready) throw new Error(`fork ${forkRepo} did not become available`);

  // Best effort: bring the fork up to date before adding the entry, so the PR is not
  // written on top of a stale base (conflicts when the entry already exists upstream).
  const sync = { behind: 0, merged: false };
  try {
    const compare = await api(`${API}/repos/${registryRepo}/compare/main...${owner}:main`, { token, fetchImpl });
    sync.behind = compare.behind_by ?? 0;
    if (sync.behind > 0) {
      await api(`${API}/repos/${forkRepo}/merge-upstream`, {
        token,
        method: 'POST',
        fetchImpl,
        body: { branch: 'main' },
      });
      sync.merged = true;
    }
  } catch {
    // A failed compare/sync must not block the entry PR.
  }

  const file = `data/plugins/${repo.replace('/', '__')}.yml`;
  let sha;
  try {
    const existing = await api(`${API}/repos/${forkRepo}/contents/${file}`, { token, fetchImpl });
    sha = existing.sha;
  } catch {
    sha = undefined;
  }

  await api(`${API}/repos/${forkRepo}/contents/${file}`, {
    token,
    method: 'PUT',
    fetchImpl,
    body: {
      message: `Add ${repo}`,
      content: Buffer.from(entry, 'utf8').toString('base64'),
      ...(sha ? { sha } : {}),
    },
  });

  const pull = await api(`${API}/repos/${registryRepo}/pulls`, {
    token,
    method: 'POST',
    fetchImpl,
    body: {
      title: title ?? `Add ${repo}`,
      head: `${owner}:main`,
      base: 'main',
      body,
    },
  });

  return { fork: forkRepo, file, sync, pr: { number: pull.number, url: pull.html_url, state: pull.state } };
}
