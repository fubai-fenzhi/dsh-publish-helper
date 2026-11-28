import { createServer } from 'node:http';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let STATE_FILE = '';
let STATE_BAK = '';
let initializedDir = '';

function ensureStateDir(dir) {
  mkdirSync(dir, { recursive: true });
  if (initializedDir !== dir) {
    initializedDir = dir;
    STATE_FILE = join(dir, 'state.json');
    STATE_BAK = join(dir, 'state.bak.json');
    if (!existsSync(STATE_FILE)) {
      writeFileSync(STATE_FILE, JSON.stringify(emptyState(), null, 2));
    }
  }
  return dir;
}

function emptyState() {
  return { messages: [], tasks: [], releases: [], activities: [], nextId: 1 };
}

function normalize(state) {
  const safe = { ...emptyState(), ...(state && typeof state === 'object' ? state : {}) };
  for (const key of ['messages', 'tasks', 'releases', 'activities']) {
    if (!Array.isArray(safe[key])) safe[key] = [];
  }
  // ids are shared by every collection: after a hand edit or restore, never hand out one twice
  const maxId = [...safe.messages, ...safe.tasks, ...safe.releases, ...safe.activities]
    .reduce((max, item) => Math.max(max, Number(item?.id) || 0), 0);
  safe.nextId = Math.max(1, Number(safe.nextId) || 1, maxId + 1);
  return safe;
}

function readState() {
  try {
    return normalize(JSON.parse(readFileSync(STATE_FILE, 'utf8')));
  } catch (error) {
    // never silently drop history: quarantine the bad file, then fall back to the last good copy
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const quarantined = join(STATE_DIR, `state.corrupt-${stamp}.json`);
    try {
      renameSync(STATE_FILE, quarantined);
      console.error(`[state] unreadable (${error.message}); moved to ${quarantined}`);
    } catch {
      /* file may already be gone */
    }
    if (existsSync(STATE_BAK)) {
      try {
        const restored = normalize(JSON.parse(readFileSync(STATE_BAK, 'utf8')));
        writeFileSync(STATE_FILE, JSON.stringify(restored, null, 2));
        console.error('[state] restored from state.bak.json');
        return restored;
      } catch {
        /* fall through to a fresh state */
      }
    }
    const fresh = normalize(emptyState());
    writeFileSync(STATE_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

function writeState(state) {
  const safe = normalize(state);
  if (existsSync(STATE_FILE)) {
    try {
      copyFileSync(STATE_FILE, STATE_BAK);
    } catch {
      /* backup is best effort */
    }
  }
  const tmp = `${STATE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(safe, null, 2));
  renameSync(tmp, STATE_FILE); // atomic on one volume: state.json is never half written
  return safe;
}

function now() {
  return new Date().toISOString();
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || '{}');
}

const PAGE = String.raw`<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>协作室</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif; background: #0f1115; color: #e6e6e6; }
  header { padding: 12px 16px; border-bottom: 1px solid #262a33; display: flex; gap: 12px; align-items: center; }
  header b { font-size: 15px; }
  .muted { opacity: .55; font-size: 12px; }
  nav { display: flex; gap: 6px; padding: 8px 12px; border-bottom: 1px solid #262a33; }
  nav button { background: #1a1e26; color: #ddd; border: 1px solid #2a303b; padding: 6px 12px; border-radius: 6px; cursor: pointer; }
  nav button.active { background: #2b6cff; border-color: #2b6cff; color: #fff; }
  main { padding: 12px; max-width: 980px; margin: 0 auto; }
  .panel { display: none; }
  .panel.active { display: block; }
  .log { height: 52vh; overflow: auto; background: #12161d; border: 1px solid #262a33; border-radius: 8px; padding: 10px; }
  .msg { margin: 6px 0; line-height: 1.45; }
  .msg .who { color: #7aa2ff; font-weight: 600; margin-right: 6px; }
  .msg .at { color: #667; font-size: 11px; margin-left: 6px; }
  .row { display: flex; gap: 8px; margin-top: 8px; }
  input, textarea, select { background: #12161d; color: #eee; border: 1px solid #2a303b; border-radius: 6px; padding: 8px; }
  textarea { flex: 1; resize: vertical; }
  button.primary { background: #2b6cff; color: #fff; border: 0; border-radius: 6px; padding: 8px 14px; cursor: pointer; }
  button.ghost { background: #1a1e26; color: #ddd; border: 1px solid #2a303b; border-radius: 6px; padding: 6px 10px; cursor: pointer; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { text-align: left; border-bottom: 1px solid #222834; padding: 6px; font-size: 13px; }
  th { color: #9aa4b2; font-weight: 500; }
  .tag { font-size: 11px; padding: 2px 6px; border-radius: 999px; background: #222834; }
  .tag.human { background: #3b2f7a; }
  .tag.agent { background: #1f4d3a; }
  .ok { color: #57d38c; }
  .warn { color: #ffb454; }
</style>
</head>
<body>
<header>
  <b>协作室</b>
  <span class="muted">你 + 多个 AI 会话 · 聊天 / 任务 / 发布请求</span>
  <span id="conn" class="muted">连接中…</span>
</header>
<nav>
  <button data-tab="chat" class="active">聊天</button>
  <button data-tab="tasks">任务板</button>
  <button data-tab="releases">发布请求</button>
  <button data-tab="activity">活动 <span id="actDot" class="tag warn" style="display:none">新</span></button>
</nav>
<main>
  <section class="panel active" id="panel-chat">
    <div class="log" id="log"></div>
    <div class="row">
      <select id="who">
        <option value="human">我（人类）</option>
        <option value="lead">lead（主会话）</option>
        <option value="qq-mail-assistant">QQ 邮箱助手</option>
        <option value="other">其他会话</option>
      </select>
      <textarea id="text" rows="2" placeholder="说点什么…（AI 会话需要轮询 /api/state 才能看到）"></textarea>
      <button class="primary" onclick="send()">发送</button>
    </div>
  </section>

  <section class="panel" id="panel-tasks">
    <div class="row">
      <input id="taskPkg" placeholder="插件/包名，如 dsh-publish-helper" style="flex:1" />
      <input id="taskVer" placeholder="版本（可选）" style="width:160px" />
      <input id="taskOwner" placeholder="负责人会话（如 lead）" style="width:180px" />
      <button class="primary" onclick="addTask()">添加任务</button>
    </div>
    <div class="row">
      <input id="taskGoal" placeholder="目标 / 备注" style="flex:1" />
    </div>
    <table><thead><tr><th>包</th><th>版本</th><th>负责人</th><th>状态</th><th>目标</th><th>更新</th><th></th></tr></thead><tbody id="taskRows"></tbody></table>
  </section>

  <section class="panel" id="panel-releases">
    <div class="row">
      <input id="relPkg" placeholder="包名" style="flex:1" />
      <input id="relVer" placeholder="版本" style="width:140px" />
      <input id="relBy" placeholder="请求者" style="width:160px" />
      <button class="primary" onclick="requestRelease()">提交发布请求</button>
    </div>
    <table><thead><tr><th>包</th><th>版本</th><th>请求者</th><th>状态</th><th>时间</th><th></th></tr></thead><tbody id="relRows"></tbody></table>
  </section>

  <section class="panel" id="panel-activity">
    <div class="muted" style="margin-bottom:8px">会话实时状态（AI 每做一步就上报；你也可以在聊天里问）</div>
    <table><thead><tr><th>会话</th><th>状态</th><th>在做什么</th><th>时间</th></tr></thead><tbody id="actRows"></tbody></table>
  </section>
</main>

<script>
let state = { messages: [], tasks: [], releases: [], activities: [] };
let lastActId = 0;
let lastMsgId = 0;
if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = (iso) => iso ? new Date(iso).toLocaleString() : '';

document.querySelectorAll('nav button').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('nav button').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
  };
});

async function api(path, body) {
  const options = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const response = await fetch(path, options);
  return response.json();
}

function render() {
  const log = document.getElementById('log');
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 40;
  log.innerHTML = state.messages.map((m) => '<div class="msg"><span class="who">' + esc(m.from) + '</span>' + esc(m.text) + '<span class="at">' + esc(fmt(m.at)) + '</span></div>').join('');
  if (atBottom) log.scrollTop = log.scrollHeight;

  document.getElementById('taskRows').innerHTML = (state.tasks ?? []).map((t) =>
    '<tr><td>' + esc(t.pkg) + '</td><td>' + esc(t.version ?? '') + '</td><td>' + esc(t.assignedTo ?? t.owner ?? '') + '</td><td><span class="tag">' + esc(t.status) + '</span></td><td>' + esc(t.goal ?? '') + '</td><td class="muted">' + esc(fmt(t.updatedAt)) + '</td><td>' +
    '<button class="ghost" onclick="claimTask(' + t.id + ')">认领</button> ' +
    '<button class="ghost" onclick="reportTask(' + t.id + ',\\'done\\')">完成</button> ' +
    '<button class="ghost" onclick="reportTask(' + t.id + ',\\'blocked\\')">阻塞</button>' +
    '</td></tr>'
  ).join('');

  document.getElementById('relRows').innerHTML = (state.releases ?? []).map((r) =>
    '<tr><td>' + esc(r.pkg) + '</td><td>' + esc(r.version) + '</td><td>' + esc(r.requestedBy ?? '') + '</td><td>' + esc(r.status) + '</td><td class="muted">' + esc(fmt(r.at)) + '</td><td>' +
    (r.status === 'pending' ? '<button class="ghost" onclick="releaseAction(' + r.id + ',\\'approve\\')">批准</button> <button class="ghost" onclick="releaseAction(' + r.id + ',\\'reject\\')">拒绝</button>' : '') +
    '</td></tr>'
  ).join('');

  const latestByAgent = new Map();
  for (const item of state.activities ?? []) {
    const current = latestByAgent.get(item.from);
    if (!current || item.id > current.id) latestByAgent.set(item.from, item);
  }
  const rows = [...latestByAgent.values()].sort((a, b) => b.id - a.id);
  document.getElementById('actRows').innerHTML = rows.map((item) =>
    '<tr><td>' + esc(item.from) + '</td><td><span class="tag">' + esc(item.status) + '</span></td><td>' + esc(item.text) + '</td><td class="muted">' + esc(fmt(item.at)) + '</td></tr>'
  ).join('') || '<tr><td colspan="4" class="muted">暂无活动</td></tr>';
}

async function refresh() {
  try {
    const previousAct = lastActId;
    const previousMsg = lastMsgId;
    state = await api('/api/state');
    document.getElementById('conn').textContent = '已连接';

    const newActivities = (state.activities ?? []).filter((item) => item.id > previousAct);
    const newMessages = (state.messages ?? []).filter((item) => item.id > previousMsg && item.from !== 'human');
    if (previousAct > 0 && newActivities.length > 0 && 'Notification' in window && Notification.permission === 'granted') {
      const latest = newActivities[newActivities.length - 1];
      new Notification(latest.from + ' · ' + latest.status, { body: latest.text });
    }
    if (previousMsg > 0 && newMessages.length > 0 && 'Notification' in window && Notification.permission === 'granted') {
      const latest = newMessages[newMessages.length - 1];
      new Notification(latest.from, { body: latest.text });
    }
    for (const item of state.activities ?? []) lastActId = Math.max(lastActId, item.id);
    for (const item of state.messages ?? []) lastMsgId = Math.max(lastMsgId, item.id);
    render();
  } catch (error) {
    document.getElementById('conn').textContent = '断开';
  }
}

async function send() {
  const text = document.getElementById('text').value.trim();
  if (!text) return;
  await api('/api/message', { from: document.getElementById('who').value, text });
  document.getElementById('text').value = '';
  await refresh();
}

async function addTask() {
  await api('/api/task', {
    action: 'add',
    pkg: document.getElementById('taskPkg').value.trim(),
    version: document.getElementById('taskVer').value.trim(),
    owner: document.getElementById('taskOwner').value.trim(),
    goal: document.getElementById('taskGoal').value.trim(),
  });
  await refresh();
}

async function claimTask(id) {
  const who = prompt('以谁的身份认领？', 'lead');
  if (!who) return;
  await api('/api/report', { taskId: id, from: who, status: 'started', text: '已认领，开始处理' });
  await refresh();
}

async function reportTask(id, status) {
  const who = prompt('以谁的身份汇报？', 'lead');
  if (!who) return;
  const text = prompt(status === 'done' ? '完成说明（结果/版本/链接）' : '阻塞原因', '');
  if (text === null) return;
  await api('/api/report', { taskId: id, from: who, status, text });
  await refresh();
}

async function nextTask(id) {
  const status = prompt('状态：planned / in_progress / ready / blocked / done', 'in_progress');
  if (!status) return;
  await api('/api/task', { action: 'update', id, status });
  await refresh();
}

async function requestRelease() {
  await api('/api/release', {
    action: 'request',
    pkg: document.getElementById('relPkg').value.trim(),
    version: document.getElementById('relVer').value.trim(),
    requestedBy: document.getElementById('relBy').value.trim() || 'human',
  });
  await refresh();
}

async function releaseAction(id, action) {
  await api('/api/release', { action, id });
  await refresh();
}

refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>`;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(PAGE);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const state = readState();
      const since = Number(url.searchParams.get('since') ?? 0);
      json(res, 200, {
        ...state,
        messages: since > 0 ? state.messages.filter((m) => m.id > since) : state.messages,
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      const state = readState();
      json(res, 200, {
        ok: true,
        pid: process.pid,
        uptimeSec: Math.round(process.uptime()),
        startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
        stateFile: STATE_FILE,
        counts: {
          messages: state.messages.length,
          tasks: state.tasks.length,
          releases: state.releases.length,
          activities: state.activities.length,
        },
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/message') {
      const body = await readBody(req);
      const text = String(body.text ?? '').trim();
      if (!text) return json(res, 400, { error: 'text required' });
      const state = readState();
      const id = state.nextId++;
      state.messages.push({ id, from: String(body.from ?? 'human'), text, at: now() });
      if (state.messages.length > 1000) state.messages = state.messages.slice(-1000);
      writeState(state);
      return json(res, 200, { ok: true, id });
    }
    if (req.method === 'GET' && url.pathname === '/api/tasks') {
      const state = readState();
      const owner = url.searchParams.get('owner');
      const tasks = owner
        ? state.tasks.filter((task) => task.assignedTo === owner || task.owner === owner)
        : state.tasks;
      return json(res, 200, { tasks });
    }
    if (req.method === 'POST' && url.pathname === '/api/report') {
      const body = await readBody(req);
      const state = readState();
      const task = state.tasks.find((item) => item.id === Number(body.taskId));
      if (!task) return json(res, 404, { error: 'task not found' });
      const from = String(body.from ?? 'unknown');
      const status = String(body.status ?? 'done');
      const text = String(body.text ?? '').trim();
      if (status === 'started') {
        task.status = 'in_progress';
        task.assignedTo = from;
      } else if (status === 'done') {
        task.status = 'done';
        task.assignedTo = from;
        task.result = text;
        task.reportedAt = now();
      } else {
        task.status = 'blocked';
        task.assignedTo = from;
        task.result = text;
        task.reportedAt = now();
      }
      task.updatedAt = now();
      const activityId = state.nextId++;
      state.activities.push({
        id: activityId,
        from,
        status: status === 'done' ? 'done' : status === 'started' ? 'working' : 'blocked',
        text: `task#${task.id} ${task.pkg}: ${text || status}`,
        pkg: task.pkg,
        at: now(),
      });
      writeState(state);
      return json(res, 200, { ok: true, task });
    }
    if (req.method === 'POST' && url.pathname === '/api/activity') {
      const body = await readBody(req);
      const text = String(body.text ?? '').trim();
      if (!text) return json(res, 400, { error: 'text required' });
      const state = readState();
      const id = state.nextId++;
      state.activities.push({
        id,
        from: String(body.from ?? 'unknown'),
        status: String(body.status ?? 'working'),
        text,
        pkg: body.pkg ? String(body.pkg) : null,
        at: now(),
      });
      // keep the activity log bounded
      if (state.activities.length > 500) state.activities = state.activities.slice(-500);
      writeState(state);
      return json(res, 200, { ok: true, id });
    }
    if (req.method === 'POST' && url.pathname === '/api/task') {
      const body = await readBody(req);
      const state = readState();
      if (body.action === 'add') {
        if (!body.pkg) return json(res, 400, { error: 'pkg required' });
        state.tasks.push({
          id: state.nextId++,
          pkg: String(body.pkg),
          version: body.version ? String(body.version) : null,
          owner: body.owner ? String(body.owner) : null,
          assignedTo: body.assignedTo ? String(body.assignedTo) : (body.owner ? String(body.owner) : null),
          goal: body.goal ? String(body.goal) : '',
          status: 'planned',
          updatedAt: now(),
        });
        writeState(state);
        return json(res, 200, { ok: true });
      }
      if (body.action === 'update') {
        const task = state.tasks.find((item) => item.id === Number(body.id));
        if (!task) return json(res, 404, { error: 'task not found' });
        if (body.status) task.status = String(body.status);
        if (body.owner !== undefined) task.owner = body.owner ? String(body.owner) : null;
        if (body.version !== undefined) task.version = body.version ? String(body.version) : null;
        if (body.goal !== undefined) task.goal = String(body.goal);
        task.updatedAt = now();
        writeState(state);
        return json(res, 200, { ok: true });
      }
      return json(res, 400, { error: 'unknown action' });
    }
    if (req.method === 'POST' && url.pathname === '/api/release') {
      const body = await readBody(req);
      const state = readState();
      if (body.action === 'request') {
        if (!body.pkg || !body.version) return json(res, 400, { error: 'pkg and version required' });
        state.releases.push({
          id: state.nextId++,
          pkg: String(body.pkg),
          version: String(body.version),
          requestedBy: String(body.requestedBy ?? 'human'),
          status: 'pending',
          at: now(),
        });
        writeState(state);
        return json(res, 200, { ok: true });
      }
      if (body.action === 'approve' || body.action === 'reject') {
        const release = state.releases.find((item) => item.id === Number(body.id));
        if (!release) return json(res, 404, { error: 'release not found' });
        release.status = body.action === 'approve' ? 'approved' : 'rejected';
        release.decidedAt = now();
        writeState(state);
        return json(res, 200, { ok: true });
      }
      if (body.action === 'published') {
        const release = state.releases.find((item) => item.id === Number(body.id));
        if (!release) return json(res, 404, { error: 'release not found' });
        release.status = 'published';
        release.publishedAt = now();
        writeState(state);
        return json(res, 200, { ok: true });
      }
      return json(res, 400, { error: 'unknown action' });
    }
    json(res, 404, { error: 'not found' });
  } catch (error) {
    json(res, 500, { error: String(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`coordination room: http://${HOST}:${PORT}`);
  console.log(`state: ${STATE_FILE}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`[room] ${signal} -> shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
