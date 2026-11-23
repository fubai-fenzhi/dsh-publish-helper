import assert from 'node:assert/strict';
import test from 'node:test';

import { checkPlugin, repositoryMatches, resolveRepo, searchTopic } from '../lib/discover.mjs';

function response(status, data) {
  return { status, ok: status >= 200 && status < 300, async json() { return data; }, async text() { return JSON.stringify(data); } };
}

test('repositoryMatches accepts git+ and .git forms', () => {
  assert.equal(repositoryMatches('git+https://github.com/o/r.git', 'o/r'), true);
  assert.equal(repositoryMatches('https://github.com/o/r', 'o/r'), true);
  assert.equal(repositoryMatches('https://github.com/other/r', 'o/r'), false);
  assert.equal(repositoryMatches(undefined, 'o/r'), false);
});

test('searchTopic maps GitHub results', async () => {
  const fake = async () => response(200, {
    total_count: 2,
    items: [
      { full_name: 'o/a', stargazers_count: 9, description: 'A', html_url: 'https://github.com/o/a' },
      { full_name: 'o/b', stargazers_count: 3, description: 'B', html_url: 'https://github.com/o/b' },
    ],
  });
  const result = await searchTopic({ query: 'procedures', fetchImpl: fake });
  assert.equal(result.total, 2);
  assert.deepEqual(result.items.map((item) => item.fullName), ['o/a', 'o/b']);
});

test('resolveRepo accepts owner/repo and resolves a bare package name', async () => {
  assert.deepEqual(await resolveRepo({ input: 'o/r' }), { repo: 'o/r', directory: null, fromPackage: null });

  const withRepo = async () => response(200, {
    'dist-tags': { latest: '1.0.0' },
    versions: {
      '1.0.0': {
        repository: { type: 'git', url: 'git+https://github.com/o/r.git', directory: 'packages/plugin' },
      },
    },
  });
  assert.deepEqual(
    await resolveRepo({ input: 'dsh-r', fetchImpl: withRepo }),
    { repo: 'o/r', directory: 'packages/plugin', fromPackage: 'dsh-r' },
  );

  const withoutRepo = async () => response(200, { 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': {} } });
  await assert.rejects(() => resolveRepo({ input: 'dsh-r', fetchImpl: withoutRepo }), /no repository field/);
});

test('checkPlugin reads the manifest from a monorepo directory', async () => {
  const fake = async (url) => {
    if (url.includes('/repos/o/r')) {
      return response(200, { full_name: 'o/r', topics: ['dsh-plugin'], stargazers_count: 0, license: null, description: '' });
    }
    if (url.includes('raw.githubusercontent.com/o/r/HEAD/packages/plugin/package.json')) {
      return response(200, { name: 'dsh-r', dsh: { bundle: { patch: './cordis.patch.yml' } } });
    }
    if (url.includes('registry.npmjs.org')) return response(404, {});
    if (url.includes('awesome-dsh-plugin.com')) return response(404, {});
    return response(404, {});
  };
  const result = await checkPlugin({ repo: 'o/r', name: 'dsh-r', directory: 'packages/plugin', fetchImpl: fake });
  assert.equal(result.checks.find((check) => check.id === 'bundle').ok, true);
});

test('checkPlugin aggregates topic, bundle, npm, registry and catalog', async () => {
  const fake = async (url) => {
    if (url.includes('/search/repositories')) return response(200, { total_count: 0, items: [] });
    if (url.includes('/repos/o/r')) {
      return response(200, {
        full_name: 'o/r', stargazers_count: 5, forks_count: 1, topics: ['dsh-plugin'],
        created_at: '2026-01-01T00:00:00Z', pushed_at: '2026-01-02T00:00:00Z',
        license: { spdx_id: 'MIT' }, description: 'demo',
      });
    }
    if (url.includes('raw.githubusercontent.com/o/r/HEAD/package.json')) {
      return response(200, { name: 'dsh-r', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } });
    }
    if (url.includes('registry.npmjs.org/dsh-r')) {
      return response(200, {
        'dist-tags': { latest: '1.0.0' },
        versions: { '1.0.0': { repository: { type: 'git', url: 'git+https://github.com/o/r.git' } } },
        time: { '1.0.0': '2026-01-03T00:00:00Z' },
      });
    }
    if (url.includes('awesome-dsh-plugin.com/plugins.json')) {
      return response(200, [{ name: 'dsh-r', npm: 'dsh-r', version: '1.0.0' }]);
    }
    if (url.includes('awesome-dsh-plugin.com/index.json')) {
      return response(200, { format: 1, plugins: [{ name: 'dsh-r', versions: [{ version: '1.0.0' }] }] });
    }
    return response(404, {});
  };

  const result = await checkPlugin({ repo: 'o/r', name: 'dsh-r', fetchImpl: fake });
  assert.equal(result.ok, true);
  assert.deepEqual(result.checks.map((check) => [check.id, check.ok]), [
    ['repo', true],
    ['topic', true],
    ['bundle', true],
    ['npm', true],
    ['repository', true],
    ['registry', true],
    ['catalog', true],
  ]);
});

test('checkPlugin reports missing pieces', async () => {
  const fake = async (url) => {
    if (url.includes('/repos/o/r')) {
      return response(200, { full_name: 'o/r', topics: [], stargazers_count: 0, license: null, description: '' });
    }
    if (url.includes('raw.githubusercontent.com')) return response(404, {});
    if (url.includes('registry.npmjs.org')) return response(404, {});
    if (url.includes('awesome-dsh-plugin.com')) return response(404, {});
    return response(404, {});
  };

  const result = await checkPlugin({ repo: 'o/r', name: 'dsh-r', fetchImpl: fake });
  assert.equal(result.ok, false);
  const failed = result.checks.filter((check) => !check.ok).map((check) => check.id);
  assert.deepEqual(failed, ['topic', 'bundle', 'npm', 'repository', 'registry', 'catalog']);
});
