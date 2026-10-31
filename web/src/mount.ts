// 文件类型：TypeScript 浏览器适配层；用途：封装阿里云 V3 脚本与单实例生命周期。
// 用法：调用 mountAliyunCaptcha 挂载，并通过返回的句柄重置或销毁。
export type CaptchaKind = 'traceless' | 'one-click' | 'slider' | 'puzzle' | 'image-restore';
export type CaptchaScenes = Partial<Record<CaptchaKind, string>>;
export interface CaptchaConfig { region: 'cn' | 'sgp'; prefix: string; scenes: CaptchaScenes }
export interface CaptchaOptions extends CaptchaConfig {
  kind: CaptchaKind;
  mode?: 'popup' | 'embed';
  buttonText?: string;
  slideStyle?: { width: number; height: number };
  onToken?: (param: string, kind: CaptchaKind) => void;
  onVerify?: (param: string, kind: CaptchaKind) => Promise<{ verified: boolean }>;
  onVerified?: (param: string, kind: CaptchaKind) => void;
  onFail?: (reason: unknown) => void;
  onError?: (error: unknown) => void;
}
// CaptchaHandle 定义活动实例的控制契约；销毁后不可继续操作，show 在未就绪或无痕场景下抛错。
export interface CaptchaHandle { reset(): void; update(options: CaptchaOptions): void; destroy(): void; show(): void }
type VendorInstance = { show?: () => void; hide?: () => void };
type VendorOptions = { SceneId: string; mode: string; element: string; button: string; success: (param: string) => void; fail: (reason: unknown) => void; getInstance: (instance: VendorInstance) => void; onError: (error: unknown) => void; slideStyle?: { width: number; height: number } };
declare global { interface Window { AliyunCaptchaConfig?: {region: string; prefix: string}; initAliyunCaptcha?: (options: VendorOptions) => void; __wavesmanCaptchaLoader?: { config: {region: string; prefix: string}; promise: Promise<void> }; __wavesmanCaptchaLease?: symbol } }
const url = 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js';
let serial = 0;

// load 共享页面级脚本加载过程，并拒绝与已有地域或身份标不一致的配置。
function load(config: {region: string; prefix: string}): Promise<void> {
  const previous = window.__wavesmanCaptchaLoader;
  const existing = window.AliyunCaptchaConfig;
  if ((existing && (existing.region !== config.region || existing.prefix !== config.prefix)) || (previous && (previous.config.region !== config.region || previous.config.prefix !== config.prefix))) return Promise.reject(new Error('页面已配置不同的阿里云验证码 region 或 prefix'));
  if (previous) return previous.promise;
  if ((config.region !== 'cn' && config.region !== 'sgp') || !config.prefix.trim()) return Promise.reject(new Error('region 或 prefix 配置无效，不可真实验证'));
  window.AliyunCaptchaConfig = config;
  if (window.initAliyunCaptcha) return Promise.resolve();
  const script = document.querySelector<HTMLScriptElement>(`script[src="${url}"]`) ?? document.createElement('script');
  // 有限等待并移除监听器，失败后允许重新加载。
  const promise = new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); script.removeEventListener('load', onLoad); script.removeEventListener('error', onError); };
    const onLoad = () => { cleanup(); window.initAliyunCaptcha ? resolve() : reject(new Error('验证码脚本未提供初始化方法')); };
    const onError = () => { cleanup(); reject(new Error('验证码脚本加载失败')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('验证码脚本加载超时')); }, 15000);
    script.addEventListener('load', onLoad); script.addEventListener('error', onError);
    if (!script.isConnected) { script.src = url; script.async = true; document.head.appendChild(script); }
  }).catch(error => { script.remove(); delete window.__wavesmanCaptchaLoader; throw error; });
  window.__wavesmanCaptchaLoader = { config, promise };
  return promise;
}

// mountAliyunCaptcha 在容器内创建验证码并返回控制句柄。
// container 是挂载节点，initial 提供场景、地域及回调；页面已有活动实例时抛错。
// 调用 destroy 释放页面租约；前端回调取得的参数必须由服务端验签。
export function mountAliyunCaptcha(container: HTMLElement, initial: CaptchaOptions): CaptchaHandle {
  if (window.__wavesmanCaptchaLease) throw new Error('页面已有活动验证码实例，请先销毁该实例');
  const lease = Symbol('captcha'); window.__wavesmanCaptchaLease = lease;
  let options = initial, generation = 0, destroyed = false, instance: VendorInstance | undefined;
  const root = document.createElement('div'); container.appendChild(root);
  // initialize 为每一轮验证创建独立代次，使旧回调和在途验签结果失效。
  function initialize() {
    const current = ++generation, snapshot = options;
    instance?.hide?.(); instance = undefined; root.replaceChildren();
    let consumed = false;
    const element = document.createElement('div'), button = document.createElement('button');
    const id = `wavesman-captcha-${++serial}`; element.id = `${id}-element`; button.id = `${id}-button`; button.type = 'button'; button.textContent = snapshot.buttonText ?? '开始验证';
    root.append(element, button);
    const active = () => !destroyed && generation === current;
    const report = (error: unknown) => { if (active()) snapshot.onError?.(error); };
    const scene = snapshot.scenes[snapshot.kind];
    if (!scene?.trim()) { button.disabled = true; report(new Error('未配置 SceneID，不可真实验证')); return; }
    if (snapshot.kind === 'traceless' && snapshot.mode === 'embed') { button.disabled = true; report(new Error('无痕验证仅支持 popup 模式')); return; }
    void load({ region: snapshot.region, prefix: snapshot.prefix }).then(() => {
      if (!active()) return;
      window.initAliyunCaptcha!({ SceneId: scene, mode: snapshot.mode ?? 'popup', element: `#${element.id}`, button: `#${button.id}`, slideStyle: snapshot.slideStyle,
        // 一次初始化只消费一次参数；重试必须重新初始化。
        success: param => { if (!active() || consumed) return; consumed = true; snapshot.onToken?.(param, snapshot.kind); const verify = snapshot.onVerify; if (!active() || !verify) return; Promise.resolve().then(() => verify(param, snapshot.kind)).then(result => { if (!active()) return; if (result?.verified === true) snapshot.onVerified?.(param, snapshot.kind); else snapshot.onFail?.(new Error('后端验签未通过，请重试')); }).catch(report); },
        fail: reason => { if (active()) snapshot.onFail?.(reason); }, getInstance: value => { if (active()) instance = value; else value.hide?.(); }, onError: report });
    }).catch(report);
  }
  initialize();
  return { reset() { if (!destroyed) initialize(); }, update(next) { if (!destroyed) { options = next; initialize(); } }, destroy() { if (!destroyed) { destroyed = true; generation++; instance?.hide?.(); instance = undefined; root.remove(); if (window.__wavesmanCaptchaLease === lease) delete window.__wavesmanCaptchaLease; } }, show() { if (destroyed) throw new Error('验证码已销毁'); if (options.kind === 'traceless') throw new Error('无痕验证不支持 show'); if (!instance?.show) throw new Error('验证码尚未就绪或不支持 show'); instance.show(); } };
}
