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

## 分阶段发布（staged publish）

若要让维护者保留「最后批准」这一关，工作流应使用 **`npm stage publish`** 而不是 `npm publish`：

- 需要 npm CLI **11.15.0+**、Node **22.14+**
- 包进入 npm 的 Staged Packages，保持**非公开**
- 维护者用 2FA 批准后才真正公开：
  - `npm stage approve <stage-id>`
  - 或 npmjs.com → Staged Packages 页面
- **每个 Trusted Publisher 配置可以单独设为「只分阶段」**（npm 更改日志原话：默认情况下每个可信发布设置都可以分阶段发布一个包，直接发布是每个配置的自选）。建议把所有配置都设为只分阶段：这样即使作者仓库里的工作流被改，也只能进 staging，没有维护者批准就不会上线
- 首次发布、包还不存在时，npm 会先发一个公共占位符版本 **`0.0.0-stage`**
- ⚠️ 尚未验证：所有者能否对**所有配置**强制「只分阶段」，以及**谁有权修改该设置**。这两点直接决定威胁模型，依赖前应先实测

## 工作流由维护者掌控

- 把 `.github/workflows/` 纳入分支保护 / 必需审核，作者无法改发布步骤
- Trusted Publisher 绑定「仓库 + 工作流文件名（+ 可选 environment）」，作者不接触工作流

## 无 GitHub 账号的作者

- npm 没有「无账号也能成为发布者」的机制；这种情况下由维护者仓库发布
- 署名靠 `package.json` 的 `author` / `contributors` + `SUBMISSION.md` 的约定，**不是注册表功能**
- 不要承诺「账号所有权转移」——npm 对这种情况的处理未经验证

## 维护者（你）的角色

- 提供 `release.yml` 模板、检查包质量、审核提交的 commit
- **不**接触作者的 npm token
- 发布记录由 GitHub Actions + provenance 自动生成（可追溯到仓库/commit/工作流）

## 与「统一代发」的关系

- 作者愿意交出 npm token 才能用「统一代发」——不推荐，但保留入口
- 默认建议：**作者自持账号 + Trusted Publishing**，我们只提供工具链和审核
