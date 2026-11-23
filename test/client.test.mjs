import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const code = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function makeReact() {
  const states = [];
  let cursor = 0;
  return {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], (value) => { states[index] = value; }];
    },
    useEffect: () => { cursor += 1; },
    useCallback: (fn) => fn,
  };
}

function loadClient(react) {
  let exported;
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load: ({ factory }) => {
          exported = factory(() => react);
        },
      },
    },
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    fetch: () => Promise.reject(new Error('fetch is not available in tests')),
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return exported;
}

function texts(node, out = []) {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((item) => texts(item, out));
  else if (node && typeof node === 'object') {
    for (const child of node.children ?? []) texts(child, out);
  }
  return out;
}

function placeholders(node, out = []) {
  if (Array.isArray(node)) node.forEach((item) => placeholders(item, out));
  else if (node && typeof node === 'object') {
    if (typeof node.props?.placeholder === 'string') out.push(node.props.placeholder);
    for (const child of node.children ?? []) placeholders(child, out);
  }
  return out;
}

test('client pure helpers', () => {
  const { __internals } = loadClient({ createElement: () => null });

  assert.equal(__internals.sourceLabel('gh'), 'gh CLI');
  assert.equal(__internals.sourceLabel('npmrc'), '~/.npmrc');
  assert.equal(__internals.sourceLabel('env:GH_TOKEN'), 'GH_TOKEN');
  assert.equal(__internals.sourceLabel('none'), '');

  assert.equal(__internals.shouldPoll([{ reviewed: false }], false), true);
  assert.equal(__internals.shouldPoll([{ reviewed: true }], false), false);
  assert.equal(__internals.shouldPoll([], false), false);
  assert.equal(__internals.shouldPoll([{ reviewed: true }], true), true);

  assert.equal(__internals.queueHint([], false), '暂无待审项');
  assert.equal(__internals.queueHint([{ reviewed: true }], false), '全部已审，自动刷新已停止');
  assert.equal(__internals.queueHint([{ reviewed: false }], true), '有未审项，每 3 分钟自动刷新');
});

test('Panel renders the main sections', () => {
  const { Panel } = loadClient(makeReact());
  const tree = Panel();
  const rendered = texts(tree).join('\n');
  const fields = placeholders(tree).join('\n');

  assert.match(rendered, /审核队列/);
  assert.match(rendered, /自检并发布/);
  assert.match(rendered, /高级：tag \/ 扫描/);
  assert.match(rendered, /撤回（发布后出问题再用）/);
  assert.match(fields, /包目录（含 package\.json）/);
  assert.match(fields, /tag（默认 latest）/);
  assert.match(fields, /包名/);
});
