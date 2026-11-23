import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { renderReport, reviewPullRequest, submitPackage } from '../lib/submissions.mjs';

function response(status, data) {
  return { status, ok: status >= 200 && status < 300, async json() { return data; } };
}

function makePackage(name = 'dsh-demo') {
  const root = mkdtempSync(join(tmpdir(), 'dsh-ph-submit-'));
  mkdirSync(join(root, 'lib'));
  writeFileSync(join(root, 'cordis.patch.yml'), '- insert: []\n');
  writeFileSync(join(root, 'README.md'), '# demo\n');
  writeFileSync(join(root, 'LICENSE'), 'MIT\n');
  writeFileSync(join(root, 'SUBMISSION.md'), '# submission\n');
  writeFileSync(join(root, 'lib', 'index.js'), 'export const name = "demo";\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name,
    version: '0.1.0',
    description: 'demo',
    license: 'MIT',
    repository: { type: 'git', url: 'git+https://github.com/o/r.git' },
    homepage: 'https://github.com/o/r',
    keywords: ['dsh', 'dsh-plugin'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2));
  return root;
}

test('submitPackage preflights, pushes a branch and opens a PR', async () => {
  const root = makePackage();
  const calls = [];
  const fake = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET' });
    if (url.endsWith('/user')) return response(200, { login: 'u' });
    if (url.endsWith('/forks')) return response(202, {});
    if (url.endsWith('/repos/u/dsh-plugin-submissions')) return response(200, { full_name: 'u/dsh-plugin-submissions' });
    if (url.endsWith('/git/ref/heads/main')) return response(200, { object: { sha: 'base' } });
    if (url.endsWith('/git/blobs')) return response(201, { sha: 'blob' });
    if (url.endsWith('/git/trees')) return response(201, { sha: 'tree' });
    if (url.endsWith('/git/commits')) return response(201, { sha: 'commit' });
    if (url.endsWith('/git/refs')) return response(201, { ref: 'refs/heads/x' });
    if (url.endsWith('/pulls')) return response(201, { number: 9, html_url: 'https://github.com/x/pull/9', state: 'open' });
    return response(404, {});
  };

  const result = await submitPackage({ dir: root, token: 't', fetchImpl: fake, sleep: async () => {} });
  assert.equal(result.pr.number, 9);
  assert.equal(result.files, 6);
  assert.ok(result.branch.startsWith('submit/dsh-demo-'));
  assert.ok(calls.some((call) => call.url.endsWith('/git/trees') && call.method === 'POST'));
  assert.ok(calls.some((call) => call.url.endsWith('/git/refs') && call.method === 'POST'));
  assert.ok(calls.some((call) => call.url.endsWith('/pulls') && call.method === 'POST'));
  rmSync(root, { recursive: true, force: true });
});

test('submitPackage refuses a package without SUBMISSION.md', async () => {
  const root = makePackage();
  rmSync(join(root, 'SUBMISSION.md'));
  await assert.rejects(
    () => submitPackage({ dir: root, token: 't', fetchImpl: async () => response(200, {}) }),
    /SUBMISSION.md is required/,
  );
  rmSync(root, { recursive: true, force: true });
});

test('reviewPullRequest downloads the submission, preflights it and comments', async () => {
  const calls = [];
  const pkg = {
    name: 'dsh-demo',
    version: '0.1.0',
    description: 'demo',
    license: 'MIT',
    repository: { type: 'git', url: 'git+https://github.com/o/r.git' },
    homepage: 'https://github.com/o/r',
    keywords: ['dsh', 'dsh-plugin'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  };
  const contents = {
    'submissions/dsh-demo/package.json': Buffer.from(JSON.stringify(pkg)).toString('base64'),
    'submissions/dsh-demo/cordis.patch.yml': Buffer.from('- insert: []\n').toString('base64'),
    'submissions/dsh-demo/README.md': Buffer.from('# demo\n').toString('base64'),
    'submissions/dsh-demo/LICENSE': Buffer.from('MIT\n').toString('base64'),
    'submissions/dsh-demo/SUBMISSION.md': Buffer.from('# sub\n').toString('base64'),
    'submissions/dsh-demo/lib/index.js': Buffer.from('export const name = "demo";\n').toString('base64'),
  };
  const fake = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET' });
    if (url.endsWith('/pulls/5')) {
      return response(200, {
        title: 'Submit dsh-demo',
        head: { sha: 'abc123', repo: { full_name: 'u/dsh-plugin-submissions' } },
      });
    }
    if (url.includes('/pulls/5/files')) {
      return response(200, Object.keys(contents).map((filename) => ({ filename })));
    }
    const match = /contents\/(submissions\/[^?]+)\?ref=abc123$/.exec(url);
    if (match) {
      const path = decodeURIComponent(match[1]);
      return response(200, { content: contents[path] });
    }
    if (url.endsWith('/issues/5/comments')) return response(201, { id: 1 });
    return response(404, {});
  };

  const result = await reviewPullRequest({ pr: 5, token: 't', fetchImpl: fake });
  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].result.ok, true);
  assert.match(result.report, /审核报告/);
  assert.match(result.report, /PASS/);
  assert.ok(calls.some((call) => call.url.endsWith('/issues/5/comments') && call.method === 'POST'));
});

test('renderReport lists failing checks', () => {
  const report = renderReport({
    pr: 1,
    pull: { title: 'x', head: { sha: 'abcdef1' } },
    reports: [{ dir: 'dsh-demo', result: { ok: false, checks: [{ id: 'name', ok: false, detail: 'required' }] } }],
  });
  assert.match(report, /FAIL/);
  assert.match(report, /name/);
});
