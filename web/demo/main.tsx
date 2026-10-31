// 文件类型：React 演示入口；用途：展示五种场景、公开配置及服务端验签。
// 用法：运行 pnpm dev，并按 README 启动示例服务或填写公开配置。
import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AliyunCaptcha, type CaptchaConfig, type CaptchaKind, type CaptchaScenes } from '../src';
import './style.css';

const kinds: { value: CaptchaKind; label: string }[] = [{ value: 'traceless', label: '无痕验证' }, { value: 'one-click', label: '一点即过' }, { value: 'slider', label: '滑块验证' }, { value: 'puzzle', label: '拼图验证' }, { value: 'image-restore', label: '图像复原' }];
// 填入阿里云控制台各场景对应的真实 SceneId；形态由场景配置决定。
const scenes: CaptchaScenes = { traceless: import.meta.env.VITE_SCENE_TRACELESS, 'one-click': import.meta.env.VITE_SCENE_ONE_CLICK, slider: import.meta.env.VITE_SCENE_SLIDER, puzzle: import.meta.env.VITE_SCENE_PUZZLE, 'image-restore': import.meta.env.VITE_SCENE_IMAGE_RESTORE };
// App 连接演示配置与验签接口，让用户切换场景或重新开始验证。
function App() {
  const [kind, setKind] = useState<CaptchaKind>('slider');
  const [mode, setMode] = useState<'popup' | 'embed'>('popup');
  const [retry, setRetry] = useState(0);
  const [config, setConfig] = useState<CaptchaConfig>({ region: import.meta.env.VITE_CAPTCHA_REGION === 'sgp' ? 'sgp' : 'cn', prefix: import.meta.env.VITE_CAPTCHA_PREFIX ?? '', scenes });
  const [message, setMessage] = useState('请选择已配置的场景。未配置 SceneID 时不可真实验证。');
  useEffect(() => { const controller = new AbortController(); fetch('/captcha/config', { signal: controller.signal }).then(async response => { if (!response.ok) throw new Error('配置接口不可用'); return response.json() as Promise<CaptchaConfig>; }).then(setConfig).catch(() => {}); return () => controller.abort(); }, []);
  const onToken = useCallback(() => setMessage('客户端已获得验证参数；尚未进行后端验签。'), []);
  const onError = useCallback((error: unknown) => setMessage(error instanceof Error ? error.message : JSON.stringify(error)), []);
  const onVerify = useCallback(async (param: string, selected: CaptchaKind) => { const response = await fetch('/captcha/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: selected, captcha_verify_param: param }) }); if (!response.ok) throw new Error('后端验签请求失败'); const result = await response.json() as { verified: boolean }; if (result.verified !== true) setMessage('后端验签未通过。'); return result; }, []);
  const onVerified = useCallback(() => setMessage('后端验签通过。'), []);
  return <main><h1>阿里云验证码 SDK</h1><p>选择的场景必须与阿里云控制台的验证形态一致。演示优先加载后端公开配置，验证结果由后端决定。</p><label>验证形态 <select value={kind} onChange={e => { const next = e.target.value as CaptchaKind; setKind(next); if (next === 'traceless') setMode('popup'); }}>{kinds.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</select></label><label>显示方式 <select value={mode} onChange={e => setMode(e.target.value as 'popup' | 'embed')}><option value="popup">弹出式</option><option value="embed" disabled={kind === 'traceless'}>嵌入式</option></select></label><section><AliyunCaptcha key={retry} {...config} kind={kind} mode={mode} onToken={onToken} onVerify={onVerify} onVerified={onVerified} onError={onError} onFail={() => setMessage('验证未通过，请重试。')}/><button type="button" onClick={() => { setMessage('已重新初始化，请再次验证。'); setRetry(value => value + 1); }}>重新验证</button></section><p role="status">{message}</p></main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
