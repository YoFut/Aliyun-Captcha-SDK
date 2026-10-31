# Aliyun Captcha SDK

阿里云验证码 2.0 通用 SDK，分为可供任意 Go 服务调用的 `captcha` 包，以及由 Vite 构建的 React / 浏览器组件库。配置方式效仿 Aliyun-SMS：默认阿里云环境变量凭据链，或由调用方配置管理器解析配置后通过 `WithConfig` 注入；无需依赖 Gin、数据库或特定账号系统。

## 五种验证形态

| SDK kind / Go 常量 | 阿里云控制台形态 |
|---|---|
| `traceless` / `captcha.Traceless` | 无痕验证 |
| `one-click` / `captcha.OneClick` | 一点即过 |
| `slider` / `captcha.Slider` | 滑块验证 |
| `puzzle` / `captcha.Puzzle` | 拼图验证 |
| `image-restore` / `captcha.ImageRestore` | 图像复原 |

每种形态配置对应的真实 `SceneId`，前端选择形态后使用对应场景。形态由阿里云控制台决定，SDK 不通过伪造参数改变场景类型。可仅配置需要的子集；要在演示页切换全部五种形态，必须配置五个对应场景。无痕验证只支持 `popup`，其他四种可以选择 `popup` 或 `embed`。无痕验证的二次挑战形态在控制台配置。

## Go 调用

本地服务可先执行 `go mod edit -replace=github.com/YoFut/Aliyun-Captcha-SDK=D:/GitHub/future-yo/Aliyun-Captcha-SDK`，导入下面的包后执行 `go mod tidy`；仓库发布后再使用对应的模块版本。

```go
import (
    "context"
    "errors"
    "github.com/YoFut/Aliyun-Captcha-SDK/captcha"
)

client, err := captcha.NewClient(captcha.WithConfig(captcha.Config{
    Region: "cn",
    Prefix: "你的身份标",
    Scenes: map[captcha.Kind]string{
        captcha.OneClick: "控制台的一点即过场景ID",
    },
    TimeoutMS: 5000,
}))
if err != nil {
    // 配置或凭据初始化失败，不能放行业务。
    return err
}
err = client.Verify(context.Background(), captcha.OneClick, captchaVerifyParam)
if errors.Is(err, captcha.ErrRejected) {
    // 验证明确不通过；向用户返回安全提示。
}
if err != nil {
    return err
}
// 只有此处才能继续密码验证、短信发送等业务。
```

`Verify` 原样传递 `CaptchaVerifyParam`，并由服务端配置选择 `SceneId`；仅当响应状态、业务状态和 `Result.VerifyResult` 都明确通过时返回 nil。配置、输入、服务拒绝、传输及异常响应可用 `errors.Is` 分类；取消和超时保留 `context.Canceled/DeadlineExceeded`。SDK 不记录令牌或原始供应商错误，不自动重试或在服务异常时放行。

### 配置来源和优先级

`WithClient` 注入官方客户端或实现 `captcha.Caller` 的客户端；否则使用 `WithCredential`，再使用 `WithConfig` 中的 AK/STS/RAM 角色配置，最后使用阿里云默认凭据链。配置中残缺或相互冲突的凭据会被拒绝，不静默退回其他身份。

- 默认凭据链读取 `ALIBABA_CLOUD_ACCESS_KEY_ID`、`ALIBABA_CLOUD_ACCESS_KEY_SECRET`、`ALIBABA_CLOUD_SECURITY_TOKEN` 等官方变量，支持部署环境的 RAM Role。
- 不传 `WithConfig` 时，`NewClient()` 自动读取下列项目环境变量；也可显式调用 `captcha.ConfigFromEnv()`。
- 传入 `WithConfig` 后，调用方配置整体覆盖项目环境变量；其中凭据字段留空仍走默认凭据链。SDK 不自行读取某个固定配置文件。
- `WithEndpoint` 优先于配置中的 Endpoint；已知官方上海、新加坡接入点必须与 Region 对齐。
- 配置文件使用 `timeout_ms`；程序调用也可使用 `Timeout: 5*time.Second`，两者不能同时设置。

| 环境变量 | 用途 |
|---|---|
| `ALIYUN_CAPTCHA_REGION` | `cn`（默认）或 `sgp` |
| `ALIYUN_CAPTCHA_PREFIX` | 控制台身份标 |
| `ALIYUN_CAPTCHA_ENDPOINT` | 可选的服务接入点覆盖，填写主机名而不是 URL |
| `ALIYUN_CAPTCHA_TIMEOUT_MS` | 请求总超时毫秒数，默认 5000 |
| `ALIYUN_CAPTCHA_SCENE_TRACELESS` | 无痕场景 ID |
| `ALIYUN_CAPTCHA_SCENE_ONE_CLICK` | 一点即过场景 ID |
| `ALIYUN_CAPTCHA_SCENE_SLIDER` | 滑块场景 ID |
| `ALIYUN_CAPTCHA_SCENE_PUZZLE` | 拼图场景 ID |
| `ALIYUN_CAPTCHA_SCENE_IMAGE_RESTORE` | 图像复原场景 ID |

调用方可用自己的 TOML、YAML、JSON 配置管理器解码 `captcha.Config`，再传入 `captcha.WithConfig(cfg)`。示例见 [configs/config.toml.example](configs/config.toml.example)。中国内地默认接入上海，新加坡使用对应端点；服务端与前端地域由同一公开配置保持一致。

`client.FrontendConfig()` 返回仅含 `region`、`prefix`、`scenes` 的独立副本，可作为公开配置返回；不要把完整 `Config` 序列化给浏览器。

## React 组件与普通 JS 接入

方案可行：Vite 在这里是构建工具，输出可被宿主应用加载的库，不要求调用方另启一个 React 网站。

- React 宿主使用 ESM 包的 `AliyunCaptcha` 组件，复用宿主 React。
- Vue、原生页面或其他前端通过独立 IIFE 使用 `mountAliyunCaptcha`。IIFE 自带所需运行时，不要求宿主安装 React。
- 形态选择、渲染方式、回调与后端请求由调用方配置，SDK 不绑定固定的生产业务地址。

在本仓库执行 `pnpm --dir web install --frozen-lockfile`、`pnpm --dir web build` 后生成：

| 文件 | 用途 |
|---|---|
| `web/dist/aliyun-captcha.js` | ESM，React 为外部 peer dependency |
| `web/dist/aliyun-captcha.iife.js` | 普通 script 加载，暴露 `window.AliyunCaptchaSDK` |
| `web/dist/*.d.ts` | TypeScript 类型声明 |

React 调用示例（本地包尚未发布 npm，可使用本地路径依赖）：

```tsx
import { AliyunCaptcha } from '@yofut/aliyun-captcha-react'

<AliyunCaptcha
  {...publicConfig}
  kind="one-click"
  mode="embed"
  onVerify={async (param, kind) => {
    const response = await fetch('/captcha/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, captcha_verify_param: param }),
    })
    if (!response.ok) throw new Error('服务端验证未通过')
    return response.json()
  }}
  onVerified={() => setMessage('服务端验签通过')}
/>
```

普通 JS 调用示例：

```html
<div id="captcha"></div>
<script src="/assets/aliyun-captcha.iife.js"></script>
<script>
  // publicConfig 来自宿主服务；verifyOnServer 由宿主实现。
  const handle = window.AliyunCaptchaSDK.mountAliyunCaptcha(
    document.getElementById('captcha'),
    {
      ...publicConfig,
      kind: 'one-click',
      mode: 'embed',
      onVerify: verifyOnServer,
      onVerified: () => showVerifiedMessage(),
    },
  );
  // 切换形态：handle.update({...publicConfig, kind:'puzzle', onVerify:verifyOnServer})
  // 重新验证：handle.reset()；页面卸载：handle.destroy()
</script>
```

Vue 可在 `onMounted` 中挂载，并在 `onBeforeUnmount` 中调用 `destroy()`。完整接口见 [web/README.md](web/README.md)。`onToken` 只表示客户端获得参数；只有调用方的 `onVerify` 返回 `{verified:true}` 才触发 `onVerified`，未提供后端验签回调时不会自动成功。

### 生命周期与使用边界

页面同一时间仅允许一个活动验证实例，第二次挂载明确报错；销毁后可再次挂载。阿里云脚本全页只加载一次，首次初始化后 `region/prefix` 不得在同页改为其他实例。`reset/update/destroy` 会关闭旧弹窗、使旧回调失效；重新验证使用重新初始化，不依赖 V2 私有刷新方法。React 回调变化不重置在途验证，支持 StrictMode 清理。

阿里云的 JS 必须从官方地址运行时加载，不会被本项目下载打包或本地替代。未配置身份标、场景或后端验证时，Demo 不模拟验证成功。实际交互需要网络可达、正确的控制台场景及已开通服务。

## 本地端到端演示

在两个终端分别启动服务端和前端。以下为 PowerShell 的公开配置示例，真实云凭据通过部署凭据链提供，不填写到前端 `.env`：

```powershell
$env:ALIYUN_CAPTCHA_REGION = 'cn'
$env:ALIYUN_CAPTCHA_PREFIX = '你的身份标'
$env:ALIYUN_CAPTCHA_SCENE_ONE_CLICK = '一点即过场景ID'
# 要使用另外四种形态，继续配置环境变量表中对应的场景 ID。
go run ./example

# 另一个终端，在 SDK 根目录执行：
pnpm --dir web install --frozen-lockfile
pnpm --dir web dev
```

Go 示例只监听 `127.0.0.1:8080`，提供 `GET /captcha/config` 和 `POST /captcha/verify`。Vite 页面默认通过代理连接它；也可复制 `web/.env.example` 为 `.env` 填写公开配置。Demo 可选择五种形态，缺少的场景会提示不可真实验证。参数和验签失败不会显示为成功，提供重新验证按钮。

示例接口契约见 [OpenAPI 文档](docs/openapi.yaml)。成功验签返回 `{"verified":true}`；失败固定返回 `code`、`message`、`data:null`、`request_id`，以非 2xx 状态区分输入错误、验证拒绝、超限及依赖故障，不透传上游正文。响应头 `X-Request-ID` 与错误体标识一致。

示例是链路演示，不是身份认证系统。真实服务应在注册、登录、短信发送等实际业务请求中调用 `Verify`，并在服务端选择允许的 kind；不要相信浏览器上报的 `verified` 或允许客户端选择比业务要求更弱的场景。若将验签拆成业务票据，票据的一次性消费、用途绑定、风控与账号权限由宿主服务负责。

## 验证与交付

版本由 [GTWV 自动版本门禁](docs/version-control.md) 管理：`fix` 升 PATCH、`feat` 升 MINOR、破坏性变更需精确 SHA 确认 MAJOR。仅 `main` 在 Go、前端和版本测试全部通过后自动创建附注标签，Release 保留人工启动；`make version` 可查看本地开发版身份。

```powershell
go test ./...
go vet ./...
go build ./...
pnpm --dir web test
pnpm --dir web exec tsc --noEmit
pnpm --dir web build
```

Go 测试覆盖响应判定、场景固定、环境配置、公开配置隔离，以及本地 TLS 服务上的真实 SDK 传输、取消与超时。前端测试使用模拟厂商脚本覆盖五种形态、加载失败重试、一次性回调、销毁、StrictMode 与 React 重渲染。测试不使用真实云凭据，不调用付费阿里云验证接口；真实五场景联调需由调用方配置自己的实例后进行。

## 官方资料

- [接入指引](https://help.aliyun.com/zh/captcha/captcha2-0/user-guide/quick-start)
- [Web/H5 V3 客户端](https://help.aliyun.com/zh/captcha/captcha2-0/user-guide/new-architecture-for-web-and-h5-client-access)
- [服务端 VerifyIntelligentCaptcha](https://help.aliyun.com/zh/captcha/captcha2-0/user-guide/server-access)
- [场景管理](https://help.aliyun.com/zh/captcha/captcha2-0/user-guide/scene-management)

本项目对服务异常采用明确报错策略，由宿主决定业务降级；不会把阿里云容灾回调或 HTTP 成功直接当作业务通过。
