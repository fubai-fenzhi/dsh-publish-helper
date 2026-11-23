import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { preflightPackage } from '../lib/preflight.mjs';

function makePackage(overrides = {}, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-ph-preflight-'));
  mkdirSync(join(root, 'lib'));
  mkdirSync(join(root, '.github'));
  writeFileSync(join(root, 'cordis.patch.yml'), '- insert: []\n');
  writeFileSync(join(root, 'README.md'), '# p\n');
  writeFileSync(join(root, 'LICENSE'), 'MIT\n');
  writeFileSync(join(root, 'lib', 'index.js'), 'export const name = "p";\n');
  const pkg = {
    name: 'dsh-tmp-plugin',
    version: '0.1.0',
    description: 'A test plugin.',
    license: 'MIT',
    repository: { type: 'git', url: 'git+https://github.com/o/r.git' },
    homepage: 'https://github.com/o/r',
    keywords: ['dsh', 'dsh-plugin', 'deepseek-harness'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    ...overrides,
  };
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2));
  for (const [file, content] of Object.entries(extra)) {
    const target = join(root, file);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

test('a well-formed plugin passes preflight', () => {
  const root = makePackage();
  const result = preflightPackage(root);
  assert.equal(result.ok, true, JSON.stringify(result.checks.filter((c) => !c.ok)));
  rmSync(root, { recursive: true, force: true });
});

test('missing fields, install scripts and binaries fail preflight', () => {
  const root = makePackage(
    { repository: undefined, scripts: { postinstall: 'node x.js' } },
    { 'tool.exe': 'MZ' },
  );
  const result = preflightPackage(root);
  assert.equal(result.ok, false);
  const failed = result.checks.filter((check) => !check.ok).map((check) => check.id).sort();
  assert.deepEqual(failed, ['binaries', 'install-scripts', 'repository']);
  rmSync(root, { recursive: true, force: true });
});

test('secrets and hardcoded runtime paths fail preflight', () => {
  const root = makePackage({}, {
    'lib/index.js': 'const token = "ghp_abcdefghijklmnopqrstuvwxyz012345"; const p = "E:\\\\scripts-ai";\n',
  });
  const result = preflightPackage(root);
  const failed = result.checks.filter((check) => !check.ok).map((check) => check.id).sort();
  assert.deepEqual(failed, ['absolute-paths', 'secrets']);
  rmSync(root, { recursive: true, force: true });
});

test('a missing dsh.bundle patch fails preflight', () => {
  const root = makePackage({ dsh: { bundle: { patch: './missing.yml' } } });
  const result = preflightPackage(root);
  assert.equal(result.ok, false);
  assert.ok(result.checks.some((check) => check.id === 'dsh.bundle' && !check.ok));
  rmSync(root, { recursive: true, force: true });
});
