window.__ModuleLoader__.load({
  id: 'dsh-publish-helper',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const store = { open: false, subs: new Set() };
    function setStoreOpen(value) {
      store.open = value;
      for (const listener of store.subs) listener();
    }
    function useOpen() {
      const [open, setOpen] = React.useState(store.open);
      React.useEffect(() => {
        const listener = () => setOpen(store.open);
        store.subs.add(listener);
        return () => store.subs.delete(listener);
      }, []);
      return [open, (value) => setStoreOpen(value)];
    }

    function sourceLabel(source) {
      if (!source || source === 'none') return '';
      if (source === 'gh') return 'gh CLI';
      if (source === 'npmrc') return '~/.npmrc';
      if (source === 'saved') return '本机保存';
      if (source === 'config') return '插件配置';
      if (source.startsWith('env:')) return source.slice(4);
      return source;
    }

    function shouldPoll(queue, reviewBusy) {
      return Boolean(reviewBusy) || (Array.isArray(queue) && queue.some((item) => !item.reviewed));
    }

    function queueHint(queue, polling) {
      if (!Array.isArray(queue)) return '';
      if (polling) return '有未审项，每 3 分钟自动刷新';
      if (queue.length === 0) return '暂无待审项';
      return '全部已审，自动刷新已停止';
    }

    function Panel() {
      const [tokenInfo, setTokenInfo] = React.useState(null);
      const [npmUser, setNpmUser] = React.useState('');
      const [npmUserSaved, setNpmUserSaved] = React.useState('');
      const [npmTokenInfo, setNpmTokenInfo] = React.useState(null);
      const [audit, setAudit] = React.useState(null);
      const [auditBusy, setAuditBusy] = React.useState(false);
      const [auditError, setAuditError] = React.useState('');
      const [pubDir, setPubDir] = React.useState('');
      const [pubTag, setPubTag] = React.useState('latest');
      const [pubOtp, setPubOtp] = React.useState('');
      const [pubBusy, setPubBusy] = React.useState(false);
      const [pubChecks, setPubChecks] = React.useState(null);
      const [pubResult, setPubResult] = React.useState(null);
      const [pubError, setPubError] = React.useState('');
      const [recallName, setRecallName] = React.useState('');
      const [recallVersion, setRecallVersion] = React.useState('');
      const [recallMessage, setRecallMessage] = React.useState('');
      const [recallBusy, setRecallBusy] = React.useState(false);
      const [recallResult, setRecallResult] = React.useState('');
      const [recallError, setRecallError] = React.useState('');
      const [queue, setQueue] = React.useState(null);
      const [queueBusy, setQueueBusy] = React.useState(false);
      const [queueError, setQueueError] = React.useState('');
      const [selectedPr, setSelectedPr] = React.useState(null);
      const [reviewBusy, setReviewBusy] = React.useState(false);
      const [reviewReport, setReviewReport] = React.useState('');

      React.useEffect(() => {
        fetch('/dsh-publish-helper/config')
          .then((response) => response.json())
          .then((data) => {
            setTokenInfo(data);
            setNpmUser(data.npmUser ?? '');
            setNpmTokenInfo({ hasNpmToken: data.hasNpmToken, valid: data.npmTokenValid, source: data.npmTokenSource });
          })
          .catch(() => setTokenInfo({ hasToken: false }));
      }, []);

      const loadQueue = async () => {
        setQueueBusy(true);
        setQueueError('');
        try {
          const response = await fetch('/dsh-publish-helper/review-queue');
          const data = await response.json();
          if (!response.ok) throw new Error(String(data.error ?? `HTTP ${response.status}`));
          setQueue(data.items ?? []);
        } catch (cause) {
          setQueueError(String(cause));
        } finally {
          setQueueBusy(false);
        }
      };

      React.useEffect(() => {
        loadQueue();
      }, []);

      const polling = shouldPoll(queue, reviewBusy);
      React.useEffect(() => {
        if (!polling) return undefined;
        const timer = setInterval(loadQueue, 180000);
        return () => clearInterval(timer);
      }, [polling]);

      const runReview = async (pr) => {
        setSelectedPr(pr);
        setReviewBusy(true);
        setReviewReport('');
        try {
          const response = await fetch('/dsh-publish-helper/review', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pr }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(String(data.error ?? `HTTP ${response.status}`));
          setReviewReport(data.report ?? '');
          await loadQueue();
        } catch (cause) {
          setReviewReport('失败：' + String(cause));
        } finally {
          setReviewBusy(false);
        }
      };

      const saveNpmUser = async () => {
        const value = npmUser.trim();
        if (!value) return;
        setNpmUserSaved('');
        try {
          const response = await fetch('/dsh-publish-helper/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ npmUser: value }),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          setNpmUserSaved('已保存');
        } catch (cause) {
          setAuditError(String(cause));
        }
      };

      const scan = async () => {
        setAuditBusy(true);
        setAuditError('');
        setAudit(null);
        try {
          const url = npmUser.trim()
            ? `/dsh-publish-helper/audit?user=${encodeURIComponent(npmUser.trim())}`
            : '/dsh-publish-helper/audit';
          const response = await fetch(url);
          const data = await response.json();
          if (!response.ok) throw new Error(String(data.error ?? `HTTP ${response.status}`).replace(/^Error:\s*/, ''));
          setAudit(data);
        } catch (cause) {
          setAuditError(String(cause));
        } finally {
          setAuditBusy(false);
        }
      };

      // One click: preflight against the submission spec, then publish the same package.
      const publish = async () => {
        setPubBusy(true);
        setPubError('');
        setPubResult(null);
        setPubChecks(null);
        try {
          const dir = pubDir.trim();
          const pre = await fetch(`/dsh-publish-helper/preflight?dir=${encodeURIComponent(dir)}`).then((response) => response.json());
          setPubChecks(pre);
          if (!pre.ok) {
            setPubError('自检未通过：按上面的 FAIL 项修好再发');
            return;
          }
          const response = await fetch('/dsh-publish-helper/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dir,
              tag: pubTag.trim() || 'latest',
              ...(pubOtp.trim() ? { otp: pubOtp.trim() } : {}),
            }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(String(data.error ?? `HTTP ${response.status}`).replace(/^Error:\s*/, ''));
          setPubResult(data);
        } catch (cause) {
          setPubError(String(cause));
        } finally {
          setPubBusy(false);
        }
      };

      const recall = async (action) => {
        setRecallBusy(true);
        setRecallError('');
        setRecallResult('');
        try {
          const response = await fetch('/dsh-publish-helper/recall', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: recallName.trim(),
              version: recallVersion.trim(),
              action,
              ...(recallMessage.trim() ? { message: recallMessage.trim() } : {}),
            }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(String(data.error ?? `HTTP ${response.status}`).replace(/^Error:\s*/, ''));
          setRecallResult(`${data.action} ${data.name}@${data.version}\n${data.output ?? ''}`);
        } catch (cause) {
          setRecallError(String(cause));
        } finally {
          setRecallBusy(false);
        }
      };

      const mono = { fontFamily: 'monospace', fontSize: '12px' };
      const summary = { cursor: 'pointer', fontSize: '13px', opacity: 0.85 };
      const githubLine = tokenInfo?.hasToken
        ? `GitHub：已连接（${sourceLabel(tokenInfo.tokenSource)}${tokenInfo.tokenValid === false ? '，无效' : ''}）`
        : 'GitHub：未连接 · 终端运行 gh auth login';
      const npmLine = npmTokenInfo?.hasNpmToken
        ? `npm：已连接（${sourceLabel(npmTokenInfo.source)}${npmTokenInfo.valid === false ? '，无效' : ''}）`
        : 'npm：未连接 · 终端运行 npm login';

      return h('div', { style: { padding: '16px', display: 'grid', gap: '12px' } },
        h('h3', { style: { margin: 0 } }, 'Publish Helper'),
        h('p', { style: { margin: 0, opacity: 0.7, fontSize: '13px' } },
          '一个包一次：先按提交规范自检，通过后一键发到 npm。'),
        h('div', { style: { ...mono, opacity: 0.8 } }, githubLine),
        h('div', { style: { ...mono, opacity: 0.8 } }, npmLine),

        h('details', { open: true, style: { borderTop: '1px solid rgba(127,127,127,.3)', paddingTop: '8px' } },
          h('summary', { style: summary },
            '审核队列' + (queue ? '（' + queue.length + '）' : '') + (queueBusy ? ' · 刷新中…' : '')),
          h('div', { style: { display: 'grid', gap: '6px', marginTop: '8px' } },
            h('div', { style: { display: 'flex', gap: '8px' } },
              h('button', { onClick: loadQueue, disabled: queueBusy }, queueBusy ? '刷新中…' : '刷新队列'),
              h('span', { style: { fontSize: '12px', opacity: 0.6, alignSelf: 'center' } },
                queueHint(queue, polling))),
            queueError ? h('p', { style: { color: 'crimson', margin: 0 } }, queueError) : null,
            queue === null && queueBusy ? h('div', { style: { ...mono, opacity: 0.7 } }, '读取中…') : null,
            queue && queue.length === 0 ? h('div', { style: { ...mono, opacity: 0.7 } }, '暂无待审 PR') : null,
            ...(queue ?? []).map((item) => h('div', {
              key: item.pr,
              style: { display: 'grid', gap: '2px', padding: '6px 0', borderTop: '1px solid rgba(127,127,127,.15)' },
            },
              h('div', { style: { fontSize: '13px' } }, '#' + item.pr + ' ' + item.title),
              h('div', { style: { ...mono, opacity: 0.7 } },
                item.author + ' · ' + item.sha.slice(0, 7) + ' · CI ' + item.checks + ' · ' + (item.reviewed ? '已审' : '未审')),
              h('div', { style: { display: 'flex', gap: '8px', marginTop: '4px' } },
                h('button', { onClick: () => runReview(item.pr), disabled: reviewBusy },
                  reviewBusy && selectedPr === item.pr ? '审核中…' : '运行审核'),
                h('a', {
                  href: item.url,
                  target: '_blank',
                  rel: 'noreferrer',
                  style: { fontSize: '12px', alignSelf: 'center' },
                }, '打开 PR')),
              selectedPr === item.pr && (reviewBusy || reviewReport)
                ? h('div', { style: { ...mono, whiteSpace: 'pre-wrap', maxHeight: '200px', overflow: 'auto', marginTop: '4px' } },
                  reviewBusy ? '审核中（下载代码 + preflight）…' : reviewReport)
                : null,
            ))),
        ),

        h('div', { style: { display: 'grid', gap: '8px', borderTop: '1px solid rgba(127,127,127,.3)', paddingTop: '10px' } },
          h('div', { style: { display: 'flex', gap: '8px' } },
            h('input', {
              value: pubDir,
              placeholder: '包目录（含 package.json）',
              onChange: (event) => setPubDir(event.target.value),
              style: { flex: 1, padding: '6px 8px' },
            }),
            h('button', { onClick: publish, disabled: pubBusy || !pubDir.trim() },
              pubBusy ? '处理中…' : '自检并发布')),
          pubError ? h('p', { style: { color: 'crimson', margin: 0, whiteSpace: 'pre-wrap' } }, pubError) : null,
          pubChecks
            ? h('div', { style: { display: 'grid', gap: '3px' } },
              ...pubChecks.checks.map((entry) => h('div', {
                key: entry.id,
                style: { ...mono, color: entry.ok ? 'inherit' : 'crimson' },
              }, `${entry.ok ? 'OK  ' : 'FAIL'} ${entry.id} — ${entry.detail}`)))
            : null,
          pubResult
            ? h('div', { style: { ...mono, whiteSpace: 'pre-wrap', maxHeight: '160px', overflow: 'auto' } },
              `published ${pubResult.name}@${pubResult.version}\n${pubResult.output ?? ''}`)
            : null),

        h('details', { style: { borderTop: '1px solid rgba(127,127,127,.3)', paddingTop: '8px' } },
          h('summary', { style: summary }, '高级：tag / 扫描'),
          h('div', { style: { display: 'grid', gap: '8px', marginTop: '8px' } },
            h('div', { style: { display: 'flex', gap: '8px' } },
              h('input', {
                value: pubTag,
                placeholder: 'tag（默认 latest）',
                onChange: (event) => setPubTag(event.target.value),
                style: { flex: 1, padding: '6px 8px' },
              }),
              h('input', {
                value: pubOtp,
                placeholder: 'OTP（可选）',
                onChange: (event) => setPubOtp(event.target.value),
                style: { flex: 1, padding: '6px 8px' },
              })),

            h('div', { style: { fontSize: '12px', opacity: 0.75 } }, 'npm 用户名（扫描用）'),
            h('div', { style: { display: 'flex', gap: '8px' } },
              h('input', {
                value: npmUser,
                placeholder: 'npm 用户名',
                onChange: (event) => setNpmUser(event.target.value),
                style: { flex: 1, padding: '6px 8px' },
              }),
              h('button', { onClick: saveNpmUser, disabled: !npmUser.trim() }, '保存用户名')),
            npmUserSaved ? h('div', { style: { fontSize: '12px', opacity: 0.8 } }, npmUserSaved) : null,
            h('button', { onClick: scan, disabled: auditBusy }, auditBusy ? '扫描中…' : '扫描我的包'),
            auditError ? h('p', { style: { color: 'crimson', margin: 0 } }, auditError) : null,
            audit
              ? h('div', { style: { display: 'grid', gap: '4px' } },
                h('div', { style: { ...mono, opacity: 0.8 } }, `npm user: ${audit.user ?? '(none)'}`),
                ...audit.results.map((entry) => h('div', {
                  key: entry.repo ?? entry.name,
                  style: { ...mono, color: entry.status === 'ready' ? 'inherit' : 'crimson' },
                }, `${entry.status}\t${entry.repo ?? '-'}\t${entry.name}${entry.version ? `@${entry.version}` : ''}`)))
              : null)),

        h('details', { style: { borderTop: '1px solid rgba(127,127,127,.3)', paddingTop: '8px' } },
          h('summary', { style: summary }, '撤回（发布后出问题再用）'),
          h('div', { style: { display: 'grid', gap: '8px', marginTop: '8px' } },
            h('div', { style: { fontSize: '12px', opacity: 0.75 } },
              '只对具体版本生效；unpublish 仅 72 小时内可用，deprecate 随时可用'),
            h('div', { style: { display: 'flex', gap: '8px' } },
              h('input', {
                value: recallName,
                placeholder: '包名',
                onChange: (event) => setRecallName(event.target.value),
                style: { flex: 1, padding: '6px 8px' },
              }),
              h('input', {
                value: recallVersion,
                placeholder: '版本，如 0.1.0',
                onChange: (event) => setRecallVersion(event.target.value),
                style: { width: '130px', padding: '6px 8px' },
              })),
            h('div', { style: { display: 'flex', gap: '8px' } },
              h('input', {
                value: recallMessage,
                placeholder: '撤回说明（deprecate 必填）',
                onChange: (event) => setRecallMessage(event.target.value),
                style: { flex: 1, padding: '6px 8px' },
              }),
              h('button', {
                onClick: () => recall('deprecate'),
                disabled: recallBusy || !recallName.trim() || !recallVersion.trim(),
              }, '打警告'),
              h('button', {
                onClick: () => recall('unpublish'),
                disabled: recallBusy || !recallName.trim() || !recallVersion.trim(),
              }, '下架')),
            recallError ? h('p', { style: { color: 'crimson', margin: 0, whiteSpace: 'pre-wrap' } }, recallError) : null,
            recallResult ? h('div', { style: { ...mono, whiteSpace: 'pre-wrap' } }, recallResult) : null)),
      );
    }

    function FooterAction() {
      const [, setOpen] = useOpen();
      return h('button', {
        title: 'Publish Helper',
        onClick: () => setOpen(true),
        style: {
          padding: '4px 8px',
          fontSize: '12px',
          borderRadius: '6px',
          border: '1px solid rgba(127,127,127,.4)',
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
        },
      }, 'Publish');
    }

    function Overlay() {
      const [open, setOpen] = useOpen();
      if (!open) return null;
      return h('div', {
        style: {
          position: 'fixed',
          top: '48px',
          right: '24px',
          width: '520px',
          maxHeight: '80vh',
          overflow: 'auto',
          background: 'rgba(28,28,30,0.98)',
          border: '1px solid rgba(127,127,127,.4)',
          borderRadius: '12px',
          zIndex: 9999,
          boxShadow: '0 12px 40px rgba(0,0,0,.45)',
          color: 'inherit',
        },
      },
      h('div', {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 14px',
          borderBottom: '1px solid rgba(127,127,127,.3)',
        },
      },
      h('strong', null, 'Publish Helper'),
      h('button', { onClick: () => setOpen(false) }, '关闭')),
      h(Panel));
    }

    return {
      inject: ['slots'],
      Panel,
      __internals: { sourceLabel, shouldPoll, queueHint },
      apply(ctx) {
        ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
          name: 'settings.plugins.tab',
          id: 'publish-helper',
          order: 50,
          label: 'Publish Helper',
        }, Panel));
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'publish-helper',
          order: 50,
          label: 'Publish Helper',
        }, FooterAction));
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'publish-helper-overlay',
          order: 50,
        }, Overlay));
      },
    };
  },
});
