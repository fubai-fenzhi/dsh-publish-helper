/** Bump the patch component; a prerelease suffix is dropped. */
export function bumpPatch(version) {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/);
  if (!match) return '0.1.0';
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

/** Add repository/homepage and bump the patch version, without touching other fields. */
export function prepareManifest(pkg, { repo } = {}) {
  const next = { ...pkg };
  next.version = bumpPatch(pkg.version);
  next.repository = { type: 'git', url: `git+https://github.com/${repo}.git` };
  next.homepage = `https://github.com/${repo}#readme`;
  return next;
}
