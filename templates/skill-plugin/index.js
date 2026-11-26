import { SKILL_REGISTRATION } from './lib/skill.mjs';

export const name = 'dsh-example-skill-plugin';
export const inject = ['tools'];

const textOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['text'],
    properties: { text: { type: 'string' } },
  },
  render: (_args, value) => [{ type: 'text', text: value.text }],
};

const present = (title) => (args) => ({ card: 'generic', title, kind: 'other', rawInput: args });

function objectSchema(properties, required = []) {
  return { type: 'object', additionalProperties: false, properties, required };
}

export function apply(ctx) {
  // Tool: the atomic action. Keep it small; the how-to lives in the skill.
  ctx.tools.register({
    name: 'example_do_task',
    description: 'Do one example task and return a short result.',
    parameters: objectSchema({
      input: { type: 'string', description: 'What to process.' },
    }, ['input']),
    output: textOutput,
    async execute(args) {
      return { text: `example result for: ${args.input}` };
    },
    presentCall: present('Run example task'),
  });

  // Skill: loaded on demand (no resident prompt cost), only when the task matches.
  const skills = ctx.get('skills');
  if (skills) ctx.effect(() => skills.register(SKILL_REGISTRATION));
}
