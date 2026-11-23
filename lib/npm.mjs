export const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org/';

/** The line npm needs in a throwaway .npmrc to authenticate against the registry. */
export function npmrcLine(token, registry = DEFAULT_NPM_REGISTRY) {
  const host = new URL(registry).host;
  return `//${host}/:_authToken=${token}\n`;
}

/** `npm publish` arguments; auth/userconfig/cache paths are appended by the caller. */
export function publishArgs({ tag = 'latest', otp } = {}) {
  const args = ['publish', '--access', 'public', '--tag', String(tag || 'latest')];
  if (otp) args.push('--otp', String(otp));
  return args;
}

/**
 * `npm deprecate <pkg>@<version> "<message>"` or `npm unpublish <pkg>@<version> --force`.
 * Recall is always version-scoped: never allow removing a whole package by accident.
 */
export function recallArgs({ name, version, action = 'unpublish', message } = {}) {
  if (!name) throw new Error('package name is required');
  if (!version) throw new Error('version is required (recall is always version-scoped)');
  const spec = `${name}@${version}`;
  if (action === 'deprecate') {
    const text = String(message ?? '').trim();
    if (!text) throw new Error('deprecate needs a message');
    return ['deprecate', spec, text];
  }
  if (action === 'unpublish') return ['unpublish', spec, '--force'];
  throw new Error(`unknown recall action: ${action}`);
}
