import { readFileSync } from 'node:fs';

export const WORKFLOW_MODES = ['trusted', 'token'];

const TEMPLATE = readFileSync(new URL('../templates/release.yml', import.meta.url), 'utf8');

/**
 * Render the release workflow.
 * mode trusted: no NODE_AUTH_TOKEN; npm uses GitHub OIDC (Trusted Publisher must be configured on npm).
 * mode token: inject NODE_AUTH_TOKEN from the repository secret NPM_TOKEN.
 * stage: run `npm stage publish`; the package stays private until a maintainer approves it with 2FA.
 */
export function workflowText(mode = 'trusted', { stage = false } = {}) {
  if (!WORKFLOW_MODES.includes(mode)) throw new Error(`unknown mode: ${mode} (use ${WORKFLOW_MODES.join(' or ')})`);
  const env = mode === 'token'
    ? '        env:\n          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n'
    : '';
  const publishCommand = stage ? 'npm stage publish' : 'npm publish';
  return TEMPLATE
    .replace('__PUBLISH_CMD__', publishCommand)
    .replace('__NODE_AUTH_ENV__\n', env);
}
