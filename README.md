# dsh-publish-helper

DSH 插件上架 / 发布 / 撤回助手：发现、检查、生成 entry、开 PR、一键发布 npm、按版本撤回。

## 自带技能

插件在运行时注册 **`publish-release`** 技能（按需加载，不占常驻 token）：preflight → 收录检查 → 建仓库 → npm 发布（staging 审核）→ entry/PR → 撤回。含 BOM、占名、stale fork、2FA 限制等坑。

## 模板与指南

- `templates/skill-plugin/`：**技能 + 插件**搭配模板，复制即用
- `templates/release.yml`：GitHub Actions 发版工作流
- `docs/plugin-vs-skill.md`：插件 vs 技能选型一页指南

`publish_workflow` 默认写 **trusted publishing** 工作流（GitHub OIDC，无需长期 token）；需要 secret 时传 `mode: "token"`。

## 安装

```bash
dsh plugin install_bundle --target npm:dsh-publish-helper
```

装完重启 DSH。第一次使用前在终端完成一次认证，插件会自动读取，不需要手填 token：

```bash
gh auth login    # GitHub：提交/审核/开 PR
npm login        # npm：发布/撤回
```

## 工具

| 工具 | 作用 |
|---|---|
| `publish_discover` | 按 `dsh-plugin` topic 搜仓库（star 排序） |
| `publish_check` | 7 项上架检查：repo / topic / bundle / npm / repository / registry / catalog |
| `publish_entry` | 生成 `data/plugins/<owner>__<repo>.yml` |
| `publish_pr` | 复用或创建 fork（落后先同步）→ 写 entry → 开 PR |
| `publish_audit` | 扫一个 npm 用户的包，标出 `needs-registry` / `needs-catalog` / `no-repository` / `ready` |
| `publish_prepare` | 给 `package.json` 补 `repository` / `homepage` 并升 patch |
| `publish_repo` | GitHub API 建仓库并上传目录（不用 git） |
| `publish_npm` | 用本机保存的 npm token **直接发布**（先过 preflight，`--access public`，可带 OTP） |
| `publish_preflight` | 本地提交自检：字段 / dsh.bundle / README / LICENSE / install 脚本 / 二进制 / 密钥 / 绝对路径 |
| `publish_recall` | `deprecate` 打警告 / `unpublish` 下架**单个版本** |
| `publish_org` | 管理 npm org 成员：list / verify / invite / remove（owner token） |
| `publish_workflow` | 把 GitHub Actions 发布模板写进包目录 |
| `publish_submit` | 本地包 → 预检 → 推分支到 fork → 向 submissions 仓库开 PR |
| `publish_review` | 拉取提交 PR → 下载代码 → 预检 → 把报告贴回 PR |
| `publish_spec` | 返回完整提交规范（字段、禁项、流程、撤回） |

## 给 AI 的规范（装插件即生效）

插件激活时会向每个 agent 注入一段「DSH 插件提交与发布规范」，所以别人问 AI「怎么提交 / 怎么发」时，AI 已经知道标准，不需要你每次解释。完整规范可用 `publish_spec` 工具取。

交接物固定为：**包目录/zip + `SUBMISSION.md`**（模板见 [templates/SUBMISSION.md](templates/SUBMISSION.md)）。缺 `SUBMISSION.md` 不进入审核。

维护者只需要：审核 → `publish_check` → `publish_prepare` → `publish_npm`（或 CI）→ `publish_entry` → `publish_pr`。

规范要点：

- `package.json` 必须有 name/version/description/license/repository/homepage/keywords + `dsh.bundle.patch`
- README、LICENSE 齐全
- 禁止 install 脚本、二进制/构建产物、混淆代码、密钥、绝对路径
- 只发审核过的 commit；不保存他人账号

## 提交入口（B：GitHub PR）

[dsh-plugin-submissions](https://github.com/fubai-fenzhi/dsh-plugin-submissions)：每个插件一个目录，PR 提交，CI 自动跑 preflight，维护者合并即通过。

```text
submissions/<pkg>/
  package.json · README.md · LICENSE · SUBMISSION.md · 源码
```

- CI：`.github/workflows/preflight.yml`
- 审核报告模板：`docs/REVIEW.md`
- 合并后由作者自己发，或按 SUBMISSION.md 授权代发

## 审核队列（面板）

侧边栏 **Publish** → 顶部「审核队列」：

- 列出 `dsh-plugin-submissions` 的待审 PR：编号、标题、作者、commit、CI 状态、已审/未审
- 点「运行审核」：插件拉取 PR 代码 → preflight → 把报告贴回 PR，并在面板里直接显示结果
- 报告缓存到 `~/.dsh/publish-helper-reviews.json`，关掉面板也能再看
- 「打开 PR」跳到 GitHub 做最终 review / Merge

## 无账号入口（收件箱）

作者没有 GitHub 账号时，把 zip 放进收件箱目录即可：

```text
~/.dsh/publish-helper-inbox/
```

面板「提交入口（无账号）」或工具 `publish_intake`：

- 扫描收件箱
- 对 zip 做**安全解压**（先校验条目，拒绝 `..`/绝对路径/盘符）
- 自动跑 `publish_preflight`
- **只读，不执行任何包代码**

## 一键发布（面板）

一个包一次，点一下就完成「自检 + 发布」：

1. 侧边栏 **Publish** → 填包目录
2. 点 **自检并发布**：先跑规范自检（字段、dsh.bundle、README/LICENSE、install 脚本、二进制、密钥、绝对路径），PASS 才发 npm
3. 不看自检结果直接发布时，`publish_npm` 会拒绝；确需跳过要显式 `force`

token、tag、OTP、扫描都收在「高级」折叠里，默认界面只有包目录 + 一个按钮；上架检查交给 AI 的 `publish_check` 工具，不再占面板。

### 凭据：自动读取，不用手填

| 操作 | 来源 | 一次性准备 |
|---|---|---|
| GitHub | `gh auth token` → 环境变量 → 本机配置 | `gh auth login` |
| npm | `~/.npmrc` → `NPM_TOKEN` → 本机配置 | `npm login` |

面板只显示「已连接（gh CLI / ~/.npmrc）」，**不回显 token 值**；token 也不进对话。

## 发版（默认：tag → CI → npm）

在插件里一条命令完成「升版 + 上传仓库 + 打 tag + 触发 CI」：

```text
publish_tag dir=E:\path\to\my-plugin bump=patch
```

CI（`.github/workflows/release.yml`）会：

1. 校验 tag 与 `package.json` 版本一致
2. 跑 `test/*.test.mjs`
3. `npm publish --provenance --access public`

需要仓库 secret `NPM_TOKEN`（granular token，Read and write + Bypass 2FA）。

### Trusted Publishing（可选，替代 token）

如果 npm 账号能开 2FA，可在包页面 → **Settings → Trusted publishing** 绑定仓库 + `release.yml`，
然后把发布步骤的 `NODE_AUTH_TOKEN` 去掉，改用 OIDC（零 token、零 OTP）。

- 首次发布一般要先本地发一次把包建出来
- workflow 使用较新的 npm CLI（模板会 `npm install -g npm@latest`）

## 撤回

| 方式 | 何时用 | 命令 |
|---|---|---|
| `deprecate` | 随时，安装时看到警告 | `npm deprecate <pkg>@<ver> "<reason>"` |
| `unpublish` | **发布 72 小时内** | `npm unpublish <pkg>@<ver> --force` |

面板「撤回」或工具 `publish_recall`。需要 npm token 对该包有发布权限（自己的包 / org owner / `npm owner add` 的 co-owner）。

> 超 72 小时只能联系 npm support 或举报；所以发布后要尽快复查。

## 责任边界

- 插件**不存储他人的账号/密码**；token 只存本机 `~/.dsh/publish-helper.json`
- 发布前必须人工审核目标 commit；每次发布/撤回写入 `~/.dsh/publish-helper-log.json`（时间、包名、版本、目录）
- 撤回是事后手段，不能替代审核；恶意包的第一道闸门仍是「只发审过的代码」

## CLI

```bash
node bin/publish-helper.mjs discover dsh-procedures
node bin/publish-helper.mjs check fubai-fenzhi/dsh-procedures
node bin/publish-helper.mjs workflow ./my-plugin
```

## 设置页 / 面板

- 侧边栏底部 **Publish** 按钮 → 悬浮面板（自检并发布 / 撤回 / tag / 扫描）
- Settings → 插件 → **Publish Helper** 同一个界面

## 检查项

| id | 含义 |
|---|---|
| `repo` | 仓库可达，返回 star 数 |
| `topic` | 仓库带 `dsh-plugin` topic（被发现渠道检索的前提） |
| `bundle` | `package.json` 声明 `dsh.bundle`（可安装的前提） |
| `npm` | 已发布到 npm |
| `repository` | npm 包的 `repository` 回链该仓库（市场关联下载量的前提） |
| `registry` | 已被 `awesome-dsh-plugin` 收录 |
| `catalog` | 已进入 format-1 市场索引（npm 元数据可能滞后，单独提示） |

`catalog` 不计入整体 `ok`，因为它依赖注册表的每日构建。
