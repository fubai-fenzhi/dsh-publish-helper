export const SKILL_NAME = 'example-task';

export const SKILL_CONTENT = `# Example task workflow

Use this skill when the user asks for the example task.

1. Check the preconditions with the example tool.
2. Do the work with the tool.
3. Verify the result and report the identifier.
`;

export const SKILL_REGISTRATION = {
  name: SKILL_NAME,
  description: 'Short, invocation-neutral description of when this workflow applies.',
  whenToUse: 'when the user asks for the example task',
  source: 'custom',
  content: SKILL_CONTENT,
};
