export const SKILL_NAME = 'publish-release';

export const SKILL_DESCRIPTION = 'Publish a DSH plugin end to end: preflight, listing check, GitHub repo upload, npm publish with staging approval, registry entry and PR, plus rollback of a broken version.';

export const SKILL_CONTENT = `# DSH plugin release workflow

Use this skill when the user asks to publish, release, or list a DSH plugin on npm / GitHub / awesome-dsh-plugin.

## Preconditions

- The package directory is final: \`package.json\` has name, version, description, license, repository, homepage, keywords and \`dsh.bundle.patch\`; README and LICENSE exist.
- A GitHub token and an npm token are already stored locally. Never print them.
- npm publishing may land in the Staged queue (bypass-2FA granular tokens): the user has to approve the version on npmjs.com before it becomes \`latest\`.

## Steps

1. \`publish_preflight\` on the directory. Fix every FAIL before continuing.
2. \`publish_check\` with the repo and package name. Topics, bundle, npm backlink and registry entry are the usual failures.
3. If the GitHub repository does not exist, create/upload it with \`publish_repo\`.
4. Publish with \`publish_npm\`. If npm asks for a 2FA code, pass \`otp\`.
5. Ask the user to approve the staged version, then confirm with the registry that \`dist-tags.latest\` points at it.
6. Generate the registry entry with \`publish_entry\` and open the PR with \`publish_pr\`. The awesome repo's submission gate requires the repository to be at least one day old, so a fresh repo fails the first run and passes after the gate re-runs.
7. Add or update a format-1 index when the user maintains one (a \`index.json\` with a \`plugins\` list).
8. For a broken release: \`publish_recall\` with \`deprecate\` (always available) or \`unpublish\` (only within 72 hours and only with a token that satisfies npm's 2FA policy).

## Pitfalls

- A package name can already belong to someone else; check the registry before choosing, and rename both package and repository when needed.
- Writing files with PowerShell \`Set-Content -Encoding UTF8\` adds a BOM and breaks JSON parsing; write with the file-write tool or strip the BOM before publishing.
- A stale fork makes \`publish_pr\` include unrelated files; rebuild a clean branch from upstream HEAD and open a fresh PR with only the new entry.
- Granular tokens that bypass 2FA cannot unpublish and are restricted for account changes and direct publishing; prefer OTP or GitHub Actions trusted publishing for the long term.
- Publishing is irreversible enough to require a user confirmation before the npm publish step.
`;

export const SKILL_REGISTRATION = {
  name: SKILL_NAME,
  description: SKILL_DESCRIPTION,
  whenToUse: 'when the user asks to publish, release, or list a DSH plugin',
  source: 'custom',
  content: SKILL_CONTENT,
};
