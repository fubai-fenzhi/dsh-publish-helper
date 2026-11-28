# 发版请求（只写请求，不发布）

QQ 邮箱助手或其他会话**没有发版权限**。需要发版时，在这里写一份请求，然后告诉用户「已提交发版请求」；主会话读取后执行 `publish_tag`。

## 文件名

```text
release-requests/<包名>-<版本>.json
```

## 内容

```json
{
  "package": "dsh-publish-helper",
  "version": "0.23.6",
  "dir": "E:\\Documents\\deepseek-harness\\default-workspace\\publish-helper",
  "reason": "release guard + release lock",
  "requestedBy": "qq-mail-assistant",
  "at": "2026-11-28T13:00:00+08:00"
}
```

## 主会话收到后

1. 检查 `dir` 的 `package.json` 版本与 `version` 一致
2. 跑 `publish_preflight`
3. 执行 `publish_tag dir=<dir> version=<version>`
4. 把结果写回请求文件（`status`、`tag`、`commit`）

## 规则

- 助手只写请求，**不要执行** `publish_npm` / `publish_tag` / `npm publish`
- 一次一个请求；同一版本不要重复提交
- 发版仍由主会话/维护者人工确认
