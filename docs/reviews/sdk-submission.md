# SDK 提交审查报告

日期：2026-10-31。依据 YoFut 通用 Skill，使用 `feature/captcha-sdk` 分支、中文原子提交及 PR 交付，由人类决定合并。

## 变更范围

提供框架无关的 Go 验签包、五种场景的 React / 浏览器组件、回环 HTTP 示例、配置模板、构建检查和集成说明。沿用现有初始化提交的 YoFut 模块路径及 Go 1.26.9 配置。

## Security（安全）

| 位置 | 结论 |
|---|---|
| `captcha/client.go:153` | 验证凭据配置及场景白名单；默认凭据链不复制到前端配置，残缺凭据明确失败 |
| `captcha/client.go:251` | 公开配置只返回 region、prefix、scenes 的独立副本 |
| `captcha/client.go:262` | 服务端固定场景，原样提交验证参数；状态不完整、验证不通过、取消或依赖故障均不放行 |
| `example/main.go:37` | 错误固定为 code、message、data:null、request_id，不返回上游正文或验证参数 |
| `example/main.go:54` | 限制请求体和 JSON 字段，方法及未知路径返回安全错误；关联标识由服务端生成 |
| `web/src/mount.ts:51` | 客户端成功与后端通过分离，未明确 verified=true 不触发最终通过；过期实例回调失效 |

本次检查未发现真实访问密钥、凭据文件或验证码令牌被纳入提交。云服务与实际业务的用途绑定、票据消费及限流由宿主服务承担。

## Defect（缺陷）

| 位置 | 处理 |
|---|---|
| `example/main.go:37` | 提交前修正原有纯文本及 verified=false 失败响应，统一四字段契约 |
| `example/main_test.go:1` | 增加错误字段、超限、未知路径、方法及上游信息不泄露的契约验证 |
| `web/src/mount.ts:26` | 脚本只加载一次，失败可重试，实例租约避免同页竞争 |
| `web/src/react.tsx:8` | 回调更新不重置在途验证，支持 StrictMode 生命周期 |

独立 IIFE 已在没有 Node process 的环境中实际加载，确认没有遗留 Node 全局依赖。

## Style（风格）

补齐中文文件头、公开接口契约及关键函数说明，并对 Go 源码执行 gofmt。只提交源码、锁文件、模板与说明；忽略实际配置、node_modules、构建缓存及生成的 dist。

本项目是 SDK 与无持久化回环示例，没有数据库、goddd 领域生成或 Wire 文件，相关数据库开发闭环与代码生成条目不适用。

## 验证结果

- `go test ./...`、`go vet ./...`、`go build ./...` 通过。
- Go 测试包含本地 TLS 服务上的官方 SDK 请求、取消及超时，不访问真实阿里云。
- 前端 10 项模拟与 React 生命周期测试通过，TypeScript 检查及双格式构建通过。
- `node scripts/verify-dist.mjs` 通过，ESM、IIFE 及类型入口有效。
- 提交前检查 diff 格式、敏感文件与生成物的暂存边界。

真实五场景验证需要调用方配置 prefix、对应 SceneId 及凭据，当前没有进行付费云接口联调。此次不执行合并或发布。
