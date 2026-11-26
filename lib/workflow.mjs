import { readFileSync } from 'node:fs';

export const WORKFLOW_MODES = ['trusted', 'token'];

const TEMPLATE = readFileSync(new URL('../templates/release.yml', import.meta.url), 'utf8');

/**
 * Render the release workflow.
 * trusted: no NODE_AUTH_TOKEN; npm uses GitHub OIDC (Trusted Publisher must be configured on npm).
 * token: inject NODE_AUTH_TOKEN from the repository secret NPM_TOKEN.
 */
export function workflowText(mode = 'trusted') {
  if (!WORKFLOW_MODES.includes(mode)) throw new Error(`unknown mode: ${mode} (use ${WORKFLOW_MODES.join(' or ')})`);
  const env = mode === 'token'
    ? '        env:\n          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n'
    : '';
  return TEMPLATE.replace('__NODE_AUTH_ENV__\n', env);
}
