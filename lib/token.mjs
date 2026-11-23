const GITHUB = 'https://api.github.com';

/**
 * GitHub reports PAT expiry in the `GitHub-Authentication-Token-Expiration`
 * response header. Real values are either ISO 8601 or the space-separated
 * `2026-12-21 12:00:00 UTC` form; an absent header means no expiry.
 */
export function parseExpiryHeader(value) {
  if (!value) return null;
  const text = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/.test(text)
    ? `${text.slice(0, 10)}T${text.slice(11, 19)}Z`
    : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Validate the token and report its remaining lifetime. */
export async function probeToken({ token, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const response = await fetchImpl(`${GITHUB}/user`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (response.status === 401) return { valid: false, expiresAt: null, daysLeft: 0, neverExpires: false };
  if (!response.ok) return { valid: null, expiresAt: null, daysLeft: null, neverExpires: null };
  const header = response.headers?.get ? response.headers.get('github-authentication-token-expiration') : null;
  const expiresAt = parseExpiryHeader(header);
  if (!expiresAt) return { valid: true, expiresAt: null, daysLeft: null, neverExpires: true };
  return {
    valid: true,
    expiresAt,
    daysLeft: Math.max(0, Math.floor((Date.parse(expiresAt) - now()) / (24 * 60 * 60 * 1000))),
    neverExpires: false,
  };
}

/** Validate an npm token through the registry's whoami endpoint. */
export async function probeNpmToken({ token, fetchImpl = globalThis.fetch } = {}) {
  if (!token) return false;
  try {
    const response = await fetchImpl('https://registry.npmjs.org/-/whoami', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.ok === true;
  } catch {
    return false;
  }
}

