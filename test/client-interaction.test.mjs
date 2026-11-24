import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const code = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function makeRenderer(fetchMock) {
  const states = [];
  let cursor = 0;
  let effects = [];

  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], (value) => {
        states[index] = typeof value === 'function' ? value(states[index]) : value;
      }];
    },
    useEffect: (fn) => { effects.push(fn); },
    useCallback: (fn) => fn,
  };

  let exported;
  const sandbox = {
    window: { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React); } } },
    console,
    fetch: fetchMock,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  function render() {
    cursor = 0;
    effects = [];
    const tree = exported.Panel();
    for (const effect of effects) effect();
    return tree;
  }

  return { render };
}

function findButtons(node, text, out = []) {
  if (Array.isArray(node)) node.forEach((item) => findButtons(item, text, out));
  else if (node && typeof node === 'object') {
    if (node.type === 'button' && node.children.includes(text)) out.push(node);
    for (const child of node.children ?? []) findButtons(child, text, out);
  }
  return out;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('clicks are wired to the host routes', async () => {
  const calls = [];
  const fetchMock = async (url) => {
    calls.push(url);
    if (url.includes('/config')) {
      return { ok: true, status: 200, json: async () => ({ hasToken: false, hasNpmToken: false }) };
    }
    if (url.includes('/review-queue')) {
      return { ok: true, status: 200, json: async () => ({ repo: 'o/r', items: [] }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const { render } = makeRenderer(fetchMock);
  const tree = render();
  await flush();

  assert.ok(calls.some((url) => url === '/dsh-publish-helper/config'));
  assert.ok(calls.some((url) => url.includes('/dsh-publish-helper/review-queue')));

  const refresh = findButtons(tree, '刷新队列');
  assert.equal(refresh.length, 1);
  refresh[0].props.onClick();
  await flush();

  const queueCalls = calls.filter((url) => url.includes('/review-queue'));
  assert.ok(queueCalls.length >= 2, 'refresh must re-fetch the queue');
});
