import assert from 'node:assert/strict';
import test from 'node:test';

import { forkAndOpenPr, generateEntry } from '../lib/publish.mjs';

function response(status, data) {
  return { status, ok: status >= 200 && status < 300, async json() { return data; } };
}

test('generateEntry writes a quoted, valid entry', () => {
  const entry = generateEntry({
    repo: 'o/r',
    en: 'Vision toolkit: OCR, grounding and pixel diff.',
    zh: '识图工具包：OCR、定位。',
    category: 'tools',
  });
  assert.match(entry, /^url: https:\/\/github\.com\/o\/r$/m);
  assert.match(entry, /^name: o\/r$/m);
  assert.match(entry, /^category: tools$/m);
  assert.match(entry, /en: 'Vision toolkit: OCR, grounding and pixel diff\.'/);
  assert.match(entry, /zh: '识图工具包：OCR、定位。'/);
  assert.equal(entry.includes('en: Vision toolkit: OCR'), false, 'unquoted description must not appear');
});

test('forkAndOpenPr creates the entry file and opens a pull request', async () => {
  const calls = [];
  const fake = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET' });
    if (url.endsWith('/user')) return response(200, { login: 'u' });
    if (url.endsWith('/forks')) return response(202, {});
    if (url.endsWith('/repos/u/awesome-dsh-plugin')) return response(200, { full_name: 'u/awesome-dsh-plugin' });
    if (url.endsWith('/compare/main...u:main')) return response(200, { behind_by: 3 });
    if (url.endsWith('/repos/u/awesome-dsh-plugin/merge-upstream')) return response(200, { message: 'merged' });
    if (url.includes('/contents/data/plugins/o__r.yml')) {
      if (init.method === 'PUT') return response(201, { content: {} });
      return response(404, {});
    }
    if (url.endsWith('/repos/awesome-dsh-plugin/awesome-dsh-plugin/pulls')) {
      return response(201, { number: 7, html_url: 'https://github.com/x/pull/7', state: 'open' });
    }
    return response(404, {});
  };

  const entry = generateEntry({ repo: 'o/r', en: 'A card tool.', category: 'tools' });
  const result = await forkAndOpenPr({
    repo: 'o/r',
    token: 't',
    entry,
    fetchImpl: fake,
    sleep: async () => {},
  });

  assert.equal(result.file, 'data/plugins/o__r.yml');
  assert.equal(result.pr.number, 7);
  assert.equal(result.pr.state, 'open');
  assert.deepEqual(result.sync, { behind: 3, merged: true });

  const put = calls.find((call) => call.method === 'PUT');
  assert.ok(put, 'the entry file must be written');
  const pr = calls.find((call) => call.url.endsWith('/pulls'));
  assert.ok(pr, 'a pull request must be opened');
  const merge = calls.find((call) => call.url.endsWith('/merge-upstream'));
  assert.ok(merge, 'the stale fork must be synced before the entry is written');
  const mergeIndex = calls.findIndex((call) => call.url.endsWith('/merge-upstream'));
  const putIndex = calls.findIndex((call) => call.method === 'PUT');
  assert.ok(mergeIndex >= 0 && mergeIndex < putIndex, 'sync must happen before the entry commit');
});

test('forkAndOpenPr leaves an up-to-date fork alone', async () => {
  const calls = [];
  const fake = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET' });
    if (url.endsWith('/user')) return response(200, { login: 'u' });
    if (url.endsWith('/forks')) return response(202, {});
    if (url.endsWith('/repos/u/awesome-dsh-plugin')) return response(200, { full_name: 'u/awesome-dsh-plugin' });
    if (url.endsWith('/compare/main...u:main')) return response(200, { behind_by: 0 });
    if (url.includes('/contents/data/plugins/o__r.yml')) {
      if (init.method === 'PUT') return response(201, { content: {} });
      return response(404, {});
    }
    if (url.endsWith('/repos/awesome-dsh-plugin/awesome-dsh-plugin/pulls')) {
      return response(201, { number: 8, html_url: 'https://github.com/x/pull/8', state: 'open' });
    }
    return response(404, {});
  };

  const result = await forkAndOpenPr({
    repo: 'o/r',
    token: 't',
    entry: generateEntry({ repo: 'o/r', en: 'A card tool.' }),
    fetchImpl: fake,
    sleep: async () => {},
  });

  assert.deepEqual(result.sync, { behind: 0, merged: false });
  assert.equal(calls.some((call) => call.url.endsWith('/merge-upstream')), false);
});
