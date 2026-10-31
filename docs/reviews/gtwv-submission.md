# GTWV 本地提交审查

本次基于 `feature/captcha-sdk` 的 SDK 实现，在独立工作区 `feature/gtwv` 补齐自动版本门禁。原仓库目录的未跟踪 `web/` 内容未修改。按用户要求仅本地提交，不推送、不创建 PR、不操作远端标签或 Release。

## Security（安全）

本次审查未发现问题。`.github/workflows/ci.yml:63` 的标签作业仅允许主线 push 或人工触发；写权限只授予该作业。`scripts/forge-api.mjs` 通过参数化 API 请求创建标签引用，不更新已有引用，不输出令牌和上游响应正文。普通 PR 测试不使用真实云凭据。

## Defect（缺陷）

`.github/workflows/ci.yml:62` 与 `.gitea/workflows/version-tag.yml:62` 均要求版本/Go 与前端两组检查成功后才打标。版本规则沿用 Aliyun-SMS，完整复用并运行 14 项版本/平台契约测试，覆盖 PR 标签、历史基线、MAJOR 确认、事件边界、同提交重试与同名冲突。

`scripts/version-tag.mjs:74` 最后检查主线与创建标签之间存在平台跨引用非原子窗口；不能保证标签创建瞬间 main 仍指向原提交。已在 `docs/version-control.md` 明确此边界：标签固定绑定通过门禁并得到确认的作业 SHA，不覆盖旧标签；主线需要严格冻结时必须额外限制写入。未以删除标签或强推方式掩盖窗口。

除此之外，本次审查未发现问题。未实际运行远端工作流，令牌、保护规则及 Gitea runner 可用性仍需平台启用后验证。

## Style（风格）

本次审查未发现问题。文件头、函数说明和新增文档使用简体中文；脚本无 SMS/YoHub 业务依赖，测试临时目录采用验证码 SDK 前缀；Go 模块路径与 SDK API 不变。该任务不涉及数据库、业务领域生成或 HTTP 错误契约变更。

## 验证记录

- 版本与平台契约测试：14 项通过，使用隔离 Git 仓库及模拟平台 API，未创建真实远端标签。
- Go：`go test ./...`、`go vet ./...`、`go build ./...` 通过，工具链 Go 1.26.9。
- 前端：冻结锁文件离线安装、10 项测试、TypeScript 检查、ESM/IIFE 构建和 `scripts/verify-dist.mjs` 通过。
- `node scripts/version.mjs` 成功输出开发版本身份；`git diff --check` 通过。
- GitHub/Gitea 工作流完成静态审查，未执行远端 CI；未发布 npm 或 Release。
