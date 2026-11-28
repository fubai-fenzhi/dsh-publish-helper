export function coordinationUrl() {
  return process.env.DSH_COORD_URL || 'http://127.0.0.1:3099';
}

async function readState({ url = coordinationUrl(), fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${url}/api/state`);
  if (!response.ok) throw new Error(`workbench returned HTTP ${response.status} (${url})`);
  return response.json();
}

/** Find an approved (but not yet published) release request for pkg@version. */
export async function findApprovedRelease({ pkg, version, url, fetchImpl = fetch } = {}) {
  const state = await readState({ url, fetchImpl });
  return (state.releases ?? []).find((item) => (
    item.pkg === pkg
    && item.version === version
    && item.status === 'approved'
  )) ?? null;
}

/**
 * Hard gate: a version may only be released after the workbench approved it.
 * allowUnapproved is an explicit, logged exception (keep it for emergencies).
 */
export async function assertReleaseApproved({ pkg, version, allowUnapproved = false, url, fetchImpl = fetch } = {}) {
  let approved = null;
  let unreachable = null;
  try {
    approved = await findApprovedRelease({ pkg, version, url, fetchImpl });
  } catch (error) {
    unreachable = error;
  }
  if (approved) return approved;
  if (allowUnapproved) return { overridden: true, unreachable: unreachable ? String(unreachable) : null };
  const where = url ?? coordinationUrl();
  const reason = unreachable
    ? `workbench unreachable: ${String(unreachable)}`
    : `no approved release request for ${pkg}@${version}`;
  throw new Error(
    `release blocked: ${reason}. Open ${where}, submit a release request and approve it first `
      + '(or pass allowUnapproved=true for an explicit exception).',
  );
}

/** Mark the request as published after a successful release. */
export async function markReleasePublished({ id, pkg, version, url, fetchImpl = fetch } = {}) {
  if (!id) return { ok: false, skipped: 'no release request id' };
  const response = await fetchImpl(`${url ?? coordinationUrl()}/api/release`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'published', id, pkg, version }),
  });
  if (!response.ok) return { ok: false, status: response.status };
  return response.json();
}
