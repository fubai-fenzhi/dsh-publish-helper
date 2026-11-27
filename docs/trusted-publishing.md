# Trusted Publishing：不共享凭证的代发方式

> 来源：npm 官方 [Trusted publishing](https://docs.npmjs.com/trusted-publishers) 与 GitHub 社区讨论 #213917 的确认结论——npm **没有**「代理发布」功能；代发的官方正解是让作者自己的仓库通过 OIDC 发布。

## 为什么用它

| 方式 | 作者要不要交 token | 谁的身份发布 | 可控性 |
|---|---|---|---|
| 维护者代发（作者的 token） | 要（有泄露风险） | 维护者 | 差 |
| **Trusted Publishing（本方案）** | **不要** | **作者自己的 npm 账号** | 作者随时可撤销 |
| npm org | 不要 | 组织 | 中 |

## 配置步骤（作者侧，一次）

1. npmjs.com → 包页面 → Settings → **Trusted Publisher** → 选 **GitHub Actions**
2. 填：仓库 `owner/repo`、工作流 `release.yml`、可选 environment
3. 作者仓库里的工作流使用：
   ```yaml
   permissions:
     contents: read
     id-token: write   # OIDC + provenance
   ```
   发布步骤：`npm publish --provenance --access public --ignore-scripts`（NODE_AUTH_TOKEN 留空）
4. 推送 `v*` tag 或手动触发

`dsh-publish-helper` 的 `publish_workflow` 默认生成的就是这个工作流（`mode: trusted`）。

## 作者保留的权利

- 可随时在 npm 设置里**撤销** Trusted Publisher
- 可要求每次发布在 GitHub environment 上**人工审批**（environment reviewers）
- 可下架 / 转回自己发；维护者不持有任何长期凭证

## 维护者（你）的角色

- 提供 `release.yml` 模板、检查包质量、审核提交的 commit
- **不**接触作者的 npm token
- 发布记录由 GitHub Actions + provenance 自动生成（可追溯到仓库/commit/工作流）

## 与「统一代发」的关系

- 作者愿意交出 npm token 才能用「统一代发」——不推荐，但保留入口
- 默认建议：**作者自持账号 + Trusted Publishing**，我们只提供工具链和审核
