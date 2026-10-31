# Git Tag With Version

SDK 使用 `dev` 集成、`main` 发布。GitHub 入口为 `.github/workflows/ci.yml`，Gitea 入口为 `.gitea/workflows/version-tag.yml`，二者共用 `scripts/` 下的版本脚本。工作流名称均为 **Git Tag With Version**。

## 版本规则

| 语义 | 结果 |
| --- | --- |
| `fix(captcha): 修复验签结果判定` | PATCH |
| `feat(captcha): 新增配置入口` | MINOR |
| 标题含 `!` 或正文含 `BREAKING CHANGE:` | MAJOR，等待人工确认 |
| `docs`、`chore` 等其他提交 | 默认不升级 |

`hotfix:` 本身不是 PATCH 触发语义；兼容性修复应写 `fix(...)`。发布范围内取最高升级级别，与分支名称、提交数量无关。PR 可以设置一个 `semver:major/minor/patch/none` 标签，覆盖该 PR 对应的提交；冲突标签或重叠覆盖会拒绝打标。

基线为 `main` 可达的最高正式 `vMAJOR.MINOR.PATCH` 标签，无标签从 `v0.0.0` 起算。首次启用会分析全部未发布历史，不能仅根据当前 CI 提交类型判断版本。历史标签保持原样，新正式标签必须是附注标签。

## 自动流程

所有分支 push、PR 和人工触发先运行以下检查：

1. Node.js 24 版本契约测试、Go 编译、vet 与单元测试。
2. 前端冻结锁文件安装、单元测试、TypeScript 检查、ESM/IIFE 构建和无 Node 环境的独立产物检查。
3. 仅 `main` 的 push 或人工触发，在两组检查全部成功后自动推导并创建正式标签。PR 和普通开发分支不打标。

MAJOR 候选只输出版本和完整 SHA。维护者在 Actions → **Git Tag With Version** → Run workflow 选择 `main`，在 `approved_sha` 中填写该提交的完整 SHA。确认值必须匹配当前作业 SHA；检查时若主线已经前进，作业拒绝打标，需对新提交重新确认。

打标作业串行执行，创建前重新读取远端主线和标签；检查时发现过期、脏工作区和浅克隆均拒绝执行。同提交重试安全，其他提交占用同名标签时失败，禁止强推或覆盖标签。脚本不创建 Release、不上传附件、不发布 npm、不部署；Release 仍由人工启动。

平台 API 无法将“检查 main”与“创建标签”合并为跨引用原子事务：若主线恰在最后检查之后前进，标签仍可能指向本次已通过门禁的旧提交，而非创建瞬间的主线顶端。标签始终绑定作业确认的 SHA；后续作业按远端标签重新推导，不能覆盖已有标签。需要严格冻结主线顶端时，应在发布期间限制主线写入，不能仅依赖打标作业并发组。

## 本地检查

```bash
make version       # 输出开发版身份，不写标签
make version-test  # 运行版本及平台契约测试
make test
make build
```

没有 Make 时可直接执行 `node scripts/version.mjs` 和 `node --test scripts/version.test.mjs scripts/forge-api.test.mjs`。开发身份如 `v0.1.0-dev.5+sha.abcdef0.dirty`；本地候选仅按提交推导，最终 CI 还会读取 PR 标签。

Go 模块版本由 Git 标签提供。前端 `web/package.json` 中的 npm 包版本及 npm 发布不属于本次 GTWV；不会为了创建 Git 标签反向提交或手动修改版本文件。SDK 的 Go/React 接口和运行时行为保持原有契约。

## 平台配置与启用

GitHub 默认使用短期 `GITHUB_TOKEN`，仅打标作业申请 `contents: write` 和 `pull-requests: read`。Gitea 使用 `GITEA_TOKEN`，打标申请 `code: write` 和 `pull-requests: read`。保护规则要求机器人时设置仓库密钥 `VERSION_BOT_TOKEN`；权限不足时明确失败，不绕过保护规则。建议保护 `main` 与 `v*` 标签，并限制 `semver:*` 标签编辑权限。

平台地址、仓库和事件由运行上下文注入，无固定仓库名。脚本支持 `VERSION_PLATFORM=github|gitea`、`VERSION_BRANCH`（默认 `main`）、`VERSION_REMOTE`（默认 `origin`）；修改发布分支须同步工作流的条件及并发组。GitHub Enterprise 可配置 `GITHUB_API_URL`，Gitea 使用 `GITEA_SERVER_URL`。Gitea runner 需能下载标准 Actions、Go 工具链与 pnpm 依赖，内网镜像由部署环境管理。

合入 `main` 且平台 Actions/runner 与令牌权限就绪后才会执行真实打标。Go 版本直接读取 `go.mod`。本次交付仅本地提交，未推送、未创建 PR、未创建真实标签；平台 CI 未实际运行。

规则参考：[自动化语义版本与标签发布工作流](https://www.waveyo.cn/blog/automated-semver-version-tag-release-workflow)。
