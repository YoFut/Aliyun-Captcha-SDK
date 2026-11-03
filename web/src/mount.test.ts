// @vitest-environment jsdom
// 文件类型：单元测试；用途：验证挂载、场景选择、脚本加载和异步回调隔离。
// 用法：运行 pnpm test，使用模拟供应商而不访问真实验证码服务。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountAliyunCaptcha, type CaptchaKind, type CaptchaOptions } from './mount';
const kinds: CaptchaKind[] = ['traceless', 'one-click', 'slider', 'puzzle', 'image-restore'];
const scenes = Object.fromEntries(kinds.map(k => [k, `scene-${k}`]));
const options = (kind: CaptchaKind = 'slider'): CaptchaOptions => ({ region: 'cn', prefix: 'test', scenes, kind });
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; delete window.__wavesmanCaptchaLoader; delete window.__wavesmanCaptchaLease; delete window.AliyunCaptchaConfig; delete window.initAliyunCaptcha; });
describe('验证码封装', () => {
  it('五种形态使用对应场景且共享脚本', async () => {
    const handle = mountAliyunCaptcha(document.body, options()); handle.reset();
    expect(document.querySelectorAll('script')).toHaveLength(1);
    const init = vi.fn(); window.initAliyunCaptcha = init; document.querySelector('script')!.dispatchEvent(new Event('load')); await tick();
    for (const kind of kinds) { handle.update(options(kind)); await tick(); }
    expect(init.mock.calls.slice(-5).map(call => call[0].SceneId)).toEqual(kinds.map(k => scenes[k])); expect(() => mountAliyunCaptcha(document.body, options())).toThrow(); handle.destroy();
  });
  it('无痕不允许嵌入，也不允许 show', () => { const onError = vi.fn(); const h = mountAliyunCaptcha(document.body, { ...options('traceless'), mode: 'embed', onError }); expect(onError).toHaveBeenCalled(); expect(() => h.show()).toThrow(); expect(document.querySelector('script')).toBeNull(); });
  it('脚本失败后可重试', async () => { const onError = vi.fn(); const h = mountAliyunCaptcha(document.body, { ...options(), onError }); document.querySelector('script')!.dispatchEvent(new Event('error')); await tick(); expect(onError).toHaveBeenCalled(); h.reset(); expect(document.querySelectorAll('script')).toHaveLength(1); });
  it('销毁使旧回调及异步验签失效', async () => { let config: any; window.initAliyunCaptcha = x => { config = x; }; const verified = vi.fn(); let resolve!: (v: {verified: boolean}) => void; const h = mountAliyunCaptcha(document.body, { ...options(), onVerify: () => new Promise(r => { resolve = r; }), onVerified: verified }); await tick(); config.success('token'); await tick(); h.destroy(); resolve({verified: true}); await tick(); config.success('old'); expect(verified).not.toHaveBeenCalled(); });
  it('重置后忽略旧的在途验签结果', async () => { let config: any; window.initAliyunCaptcha = x => { config = x; }; let resolve!: (v: {verified: boolean}) => void; const verified = vi.fn(); const h = mountAliyunCaptcha(document.body, {...options(), onVerify: () => new Promise(r => { resolve = r; }), onVerified: verified}); await tick(); config.success('token'); await tick(); h.reset(); resolve({verified:true}); await tick(); expect(verified).not.toHaveBeenCalled(); h.destroy(); });
  it('后端返回 false 不触发通过回调', async () => { let config: any; window.initAliyunCaptcha = x => { config = x; }; const verified = vi.fn(); mountAliyunCaptcha(document.body, { ...options(), onVerify: async () => ({verified: false}), onVerified: verified }); await tick(); config.success('token'); await tick(); expect(verified).not.toHaveBeenCalled(); });
  it('同一轮只处理一次成功并关闭旧实例', async () => { let config: any; const hide = vi.fn(); window.initAliyunCaptcha = x => { config = x; x.getInstance({hide}); }; const verified = vi.fn(), verify = vi.fn(async () => ({verified: true})); const h = mountAliyunCaptcha(document.body, {...options(), onVerify: verify, onVerified: verified}); await tick(); config.success('a'); config.success('a'); await tick(); expect(verify).toHaveBeenCalledTimes(1); expect(verified).toHaveBeenCalledTimes(1); const old = config; h.reset(); expect(hide).toHaveBeenCalledTimes(1); old.success('old'); await tick(); expect(verified).toHaveBeenCalledTimes(1); h.destroy(); expect(hide).toHaveBeenCalledTimes(2); });
  it('验签失败或抛错均不通过', async () => { let config: any; window.initAliyunCaptcha = x => { config = x; }; const verified = vi.fn(), fail = vi.fn(), error = vi.fn(); const h = mountAliyunCaptcha(document.body, {...options(), onVerify: async () => ({verified: false}), onVerified: verified, onFail: fail, onError: error}); await tick(); config.success('a'); await tick(); expect(fail).toHaveBeenCalledTimes(1); h.update({...options(), onVerify: async () => { throw new Error('失败'); }, onVerified: verified, onError: error}); await tick(); config.success('b'); await tick(); expect(error).toHaveBeenCalled(); expect(verified).not.toHaveBeenCalled(); h.destroy(); });
  it('超时可重试且配置无效不加载脚本', async () => { vi.useFakeTimers(); const error = vi.fn(); const h = mountAliyunCaptcha(document.body, {...options(), onError: error}); await vi.advanceTimersByTimeAsync(15000); expect(error).toHaveBeenCalled(); expect(document.querySelector('script')).toBeNull(); h.reset(); expect(document.querySelectorAll('script')).toHaveLength(1); h.destroy(); await vi.advanceTimersByTimeAsync(15000); vi.useRealTimers(); delete window.__wavesmanCaptchaLoader; delete window.AliyunCaptchaConfig; const bad = mountAliyunCaptcha(document.body, {...options(), prefix: '', onError: error}); await tick(); expect(document.querySelector('script')).toBeNull(); bad.destroy(); });
});

describe('宿主单次点击启动', () => {
  it('实例就绪后只启动一次，延迟和旧实例不会启动', async () => {
    let config: any; const init = vi.fn(x => { config = x; }); window.initAliyunCaptcha = init;
    const show = vi.fn(), hide = vi.fn();
    const handle = mountAliyunCaptcha(document.body, {...options(), autoStart: true});
    expect((document.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    await tick();
    expect(init).toHaveBeenCalledTimes(1); expect(show).not.toHaveBeenCalled();
    config.getInstance({show, hide}); config.getInstance({show, hide});
    expect(show).toHaveBeenCalledTimes(1);
    const old = config; handle.reset(); await tick();
    old.getInstance({show, hide}); expect(show).toHaveBeenCalledTimes(1);
    config.getInstance({show, hide}); expect(show).toHaveBeenCalledTimes(2);
    handle.destroy();
  });
  it('无痕形态调用专用启动方法，默认模式仍由按钮触发', async () => {
    let config: any; window.initAliyunCaptcha = x => { config = x; };
    const show = vi.fn(), start = vi.fn();
    const handle = mountAliyunCaptcha(document.body, {...options('traceless'), autoStart: true});
    await tick(); config.getInstance({show, startTracelessVerification: start});
    expect(start).toHaveBeenCalledTimes(1); expect(show).not.toHaveBeenCalled();
    handle.destroy();
    const manual = mountAliyunCaptcha(document.body, options());
    await tick(); config.getInstance({show});
    expect(show).not.toHaveBeenCalled(); manual.destroy();
  });
});
