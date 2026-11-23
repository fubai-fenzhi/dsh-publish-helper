#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { checkPlugin, resolveRepo, searchTopic } from '../lib/discover.mjs';

const USAGE = `dsh-publish-helper — DSH plugin publishing checks

Usage:
  dsh-publish-helper discover [<query>] [--limit 20] [--json]
  dsh-publish-helper check <owner/repo> [--name <package>] [--token <github-token>] [--json]
  dsh-publish-helper workflow <package-dir>

  discover searches GitHub repositories carrying the dsh-plugin topic.
  check verifies topic, dsh.bundle, npm publication, repository backlink,
  the awesome-dsh-plugin entry and the format-1 market index.
  workflow writes .github/workflows/release.yml (trusted publishing template).
`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const equals = body.indexOf('=');
    if (equals >= 0) {
      flags[body.slice(0, equals)] = body.slice(equals + 1);
      continue;
    }
    if (index + 1 < argv.length && !argv[index + 1].startsWith('--')) {
      flags[body] = argv[index + 1];
      index += 1;
      continue;
    }
    flags[body] = true;
  }
  return { positional, flags };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const command = positional[0];

if (!command || command === 'help' || flags.help) {
  process.stdout.write(USAGE);
} else if (command === 'discover') {
  const query = positional.slice(1).join(' ').trim();
  const result = await searchTopic({
    query,
    token: typeof flags.token === 'string' ? flags.token : undefined,
    limit: Number.parseInt(String(flags.limit ?? '20'), 10) || 20,
  });
  if (flags.json) {
    printJson(result);
  } else {
    process.stdout.write(`topic:dsh-plugin ${query} -> ${result.total} repo(s)\n`);
    for (const item of result.items) {
      process.stdout.write(`${item.stars}\t${item.fullName}\t${item.description.slice(0, 90)}\n`);
    }
  }
} else if (command === 'check') {
  const input = positional[1];
  if (!input) {
    process.stderr.write('check needs <owner/repo> or <npm-package>\n');
    process.exitCode = 2;
  } else {
    try {
      const resolved = await resolveRepo({ input });
      const name = typeof flags.name === 'string'
        ? flags.name
        : (resolved.fromPackage ?? resolved.repo.split('/')[1]);
      const result = await checkPlugin({
        repo: resolved.repo,
        name,
        token: typeof flags.token === 'string' ? flags.token : undefined,
      });
      if (flags.json) {
        printJson(result);
      } else {
        process.stdout.write(`${result.repo} (${result.name}) ${result.stars}★\n`);
        for (const check of result.checks) {
          process.stdout.write(`${check.ok ? 'OK  ' : 'FAIL'}\t${check.id}\t${check.detail}\n`);
        }
        process.stdout.write(result.ok ? 'status: ready\n' : 'status: needs fixes\n');
      }
    } catch (error) {
      process.stderr.write(`${error}\n`);
      process.exitCode = 1;
    }
  }
} else if (command === 'workflow') {
  const dir = positional[1];
  if (!dir) {
    process.stderr.write('workflow needs <package-dir>\n');
    process.exitCode = 2;
  } else {
    try {
      if (!existsSync(join(dir, 'package.json'))) throw new Error(`no package.json in ${dir}`);
      const template = readFileSync(new URL('../templates/release.yml', import.meta.url), 'utf8');
      const target = join(dir, '.github', 'workflows', 'release.yml');
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, template, 'utf8');
      process.stdout.write(`wrote ${target}\n`);
    } catch (error) {
      process.stderr.write(`${error}\n`);
      process.exitCode = 1;
    }
  }
} else {
  process.stderr.write(`unknown command: ${command}\n\n${USAGE}`);
  process.exitCode = 2;
}
