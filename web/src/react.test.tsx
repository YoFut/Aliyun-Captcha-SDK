// @vitest-environment jsdom
// 文件类型：React 集成测试；用途：验证严格模式清理及回调重渲染。
// 用法：运行 pnpm test，使用模拟供应商验证在途验签。
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AliyunCaptcha } from './react';

it('严格模式清理旧实例，回调更新不重置在途验签', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  delete window.__wavesmanCaptchaLease; delete window.__wavesmanCaptchaLoader; delete window.AliyunCaptchaConfig;
  let config: any; const init = vi.fn(x => { config = x; }); window.initAliyunCaptcha = init;
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
  let resolve!: (v: {verified: boolean}) => void; const verified = vi.fn();
  const render = (callback: () => void) => <StrictMode><AliyunCaptcha region="cn" prefix="test" scenes={{slider:'scene'}} kind="slider" onToken={callback} onVerify={() => new Promise(r => { resolve = r; })} onVerified={verified}/></StrictMode>;
  await act(async () => { root.render(render(() => {})); });
  expect(init).toHaveBeenCalledTimes(1);
  await act(async () => { config.success('token'); });
  await act(async () => { root.render(render(() => {})); });
  expect(init).toHaveBeenCalledTimes(1);
  await act(async () => { resolve({verified:true}); }); expect(verified).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount()); expect(window.__wavesmanCaptchaLease).toBeUndefined(); container.remove();
});
