# 前端 SDK

安装依赖后运行 `pnpm dev`，示例通过代理访问 `http://localhost:8080/captcha/config` 和 `/captcha/verify`。也可将 `.env.example` 复制为 `.env` 填入公开配置；场景 ID 必须来自控制台，验证形态由对应场景决定。未配置场景不能真实验证。

页面同一时间仅允许一个活动实例；调用 `destroy()` 或卸载组件后可创建下一个。阿里云脚本是页面级资源，首次使用后 region 和 prefix 在本页面固定；切换需要刷新页面。`reset()` 会重新初始化，`show()` 不适用于无痕验证。

`onToken` 只表示客户端获得验证参数，不能作为安全放行依据。`onVerify` 是调用方提供的异步服务端验签函数，只有返回 `{ verified: true }` 才触发 `onVerified`。实际业务服务必须在业务接口内部验签，不能信任客户端可伪造的 verified 字段。演示接口仅用于展示验签流程。

React 项目使用包的 ESM 入口，以宿主 React 渲染组件。Vue 或原生页面可通过 script 引入 `dist/aliyun-captcha.iife.js`，使用 `window.AliyunCaptchaSDK.mountAliyunCaptcha`；IIFE 内置 React，请勿用其组件与宿主 React 混用。验证完成或服务端验签失败后，调用 `reset()` 重新初始化才能再次验证。
