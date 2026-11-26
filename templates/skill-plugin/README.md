# skill-plugin template

A DSH bundle that pairs **one tool** with **one on-demand skill**.

- Tool: `example_do_task` — the atomic action, registered with `ctx.tools.register`.
- Skill: `example-task` — the workflow and pitfalls, registered with `ctx.skills.register`.
- The skill is only loaded when the model needs it, so it adds no resident prompt tokens.

## Use it

1. Copy this directory into your workspace.
2. Rename `dsh-example-skill-plugin` / `example-skill-plugin` / `example_do_task` / `example-task` everywhere (package.json, cordis.patch.yml, index.js, lib/skill.mjs).
3. Replace the tool logic and the skill content.
4. Add LICENSE and a real README.
5. Install: `plugin_manager` `install_bundle` with this directory, or publish with `dsh-publish-helper`.

## Rules of thumb

- Put **capabilities** in the tool, **process and pitfalls** in the skill.
- Keep safety defaults in code (the tool); never rely on the skill text for hard constraints.
- One skill per workflow; do not bundle unrelated workflows into one skill.
- Skill content should be shorter than ~2k words; move long references to separate files loaded on demand.
