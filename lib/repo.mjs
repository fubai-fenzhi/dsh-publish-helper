const API = 'https://api.github.com';

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

function contentUrl(owner, name, path) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${API}/repos/${owner}/${name}/contents/${encoded}`;
}

export async function getLogin({ token, fetchImpl } = {}) {
  const user = await api(`${API}/user`, { token, fetchImpl });
  return user.login;
}

/** Create the repository if missing (422 means it already exists) and return its default branch. */
export async function ensureRepo({ token, owner, name, description = '', isPrivate = false, fetchImpl } = {}) {
  try {
    await api(`${API}/user/repos`, {
      token,
      fetchImpl,
      method: 'POST',
      body: { name, description, private: isPrivate, auto_init: true },
    });
  } catch (error) {
    if (!String(error).includes(' 422 ')) throw error;
  }
  const repo = await api(`${API}/repos/${owner}/${name}`, { token, fetchImpl });
  return { owner, name, defaultBranch: repo.default_branch ?? 'main' };
}

/** Create or update each file; files carry base64 content. */
export async function uploadFiles({ token, owner, name, files, message, fetchImpl } = {}) {
  const written = [];
  for (const file of files) {
    let sha;
    try {
      const existing = await api(contentUrl(owner, name, file.path), { token, fetchImpl });
      sha = existing.sha;
    } catch {
      sha = undefined;
    }
    await api(contentUrl(owner, name, file.path), {
      token,
      fetchImpl,
      method: 'PUT',
      body: {
        message: message ?? `Add ${file.path}`,
        content: file.content,
        ...(sha ? { sha } : {}),
      },
    });
    written.push(file.path);
  }
  return written;
}
