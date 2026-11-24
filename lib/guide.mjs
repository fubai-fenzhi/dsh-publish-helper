export const SECTION_NAME = 'publish-helper';

/**
 * Injected into every agent that runs with this plugin active.
 * Keep it short: it is the contract, not the full manual.
 */
export const AGENT_GUIDE = `DSH 插件提交与发布规范（publish-helper 已装）：
- 提交物 = 可直接发布的包目录/zip + SUBMISSION.md；或直接向 fubai-fenzhi/dsh-plugin-submissions 开 PR（submissions/<包名>/）。package.json 含 name/version/description/license/repository/homepage/keywords、dsh.bundle.patch；README、LICENSE 齐全；不得含 node_modules/二进制/构建产物/密钥/绝对路径。
- 禁止：preinstall/install/postinstall/prepare 脚本、混淆代码、无人维护或近似包名的依赖；依赖必须锁定。
- 流程：提交用 publish_submit（本地包 → 开 PR）；审核用 publish_review（拉 PR + preflight + 回贴报告）；发布前 publish_preflight PASS → publish_check →（本地目录）publish_prepare → publish_workflow 或 publish_npm → publish_entry → publish_pr；只发审核过的 commit，发布前人工审核。
- 不保存他人的账号或 token；token 只存本机。
- 账号：有 GitHub 可自助提交（author 模式）；没有则走无账号入口（文件交维护者，由维护者代提代发，署名写作者）。
- 账号：有 GitHub 自己开 PR，没有则文件交接由维护者代提（PR 作者为维护者，署名写作者）；npm 同理可授权代发；不代注册账号。
- 撤回：deprecate（随时，打警告）/ unpublish（仅该版本发布 72 小时内）/ dist-tag 回滚到干净版本（无时间限制）。
- 完整规范：调用 publish_spec 工具。`;

/** Full checklist returned by the publish_spec tool. */
export const SUBMISSION_SPEC = `# DSH 插件提交规范

## 1. 提交物（一个目录或 zip，解压即可发布）
- package.json：
  - name、version、description（中英各一句）
  - license（MIT / Apache-2.0）
  - repository（指向源码仓库）、homepage、bugs
  - keywords 含 dsh、dsh-plugin、deepseek-harness
  - dsh.bundle.patch 指向 patch 文件
- README.md：安装、用法、权限说明、License
- LICENSE 文件
- 不含：node_modules、.git、构建产物、二进制、任何 token/密钥/绝对路径
- 没有 preinstall / install / postinstall / prepare 脚本
- 依赖版本锁定，无无人维护或近似包名（typosquat）依赖

## 2. 提交方式
- 本地/私聊：包目录或 zip + SUBMISSION.md
- 或向 https://github.com/fubai-fenzhi/dsh-plugin-submissions 开 PR：新增 submissions/<包名>/（包 + SUBMISSION.md），CI 自动跑 preflight
- 有账号（自助）：
  - GitHub：自己运行 publish_submit 开 PR
  - npm：自己 publish；或 npm owner add fubai-fenzhi 给维护者撤回权
- 无账号（入口）：
  - 作者把包/zip + SUBMISSION.md 交给维护者（接收渠道见 dsh-plugin-submissions 仓库 README）
  - 维护者：publish_preflight → 人工审 → publish_submit（维护者 GitHub）→ publish_npm（维护者 npm）
- 账号是平台要求：不代注册、不代管账号

## 3. 交接单 SUBMISSION.md
- 作者与联系方式
- 账号状态：是否有 GitHub / npm 账号（含 handle）
- 源码仓库
- npm 包名（是否使用 org scope）
- 许可证
- 提交方式：自己开 PR / 请维护者代提
- 发布方式：自己发 / 授权维护者代发（org 或维护者账号）/ 暂不发布
- 代提/代发授权（选「请维护者」时必填）：允许代开 PR、代发 npm、保留署名、可下架/转回
- 撤回联系人

## 4. 审核与发布（维护者）
0. 收到提交先跑 publish_preflight；PASS 才进入人工审核
1. publish_check 检查（topic / dsh.bundle / npm / repository / registry / catalog）
2. 本地目录：publish_prepare 补字段并升版
3. 发布：publish_workflow（CI + trusted publishing）或 publish_npm（一键直发）
4. 上架：publish_entry 生成 entry → publish_pr 开 PR
5. 只发审核过的 commit；发布/撤回记录写入 ~/.dsh/publish-helper-log.json

## 5. 撤回
- deprecate：随时，安装时看到警告
- unpublish：仅该版本发布 72 小时内
- dist-tag 回滚：把 latest 指回干净版本，无时间限制
- 恶意/侵权：向 npm 举报，必要时走 npm support

## 6. 拒收红线
- 任何 install 钩子、二进制、混淆代码
- 读取或上传密钥、SSH、.npmrc、环境变量
- 无许可证、无源码仓库、无法对应到具体 commit
- 只在作者本机可用的硬编码路径
`;
