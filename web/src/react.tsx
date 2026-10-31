// 文件类型：React 组件；用途：将验证码实例绑定到组件生命周期。
// 用法：渲染 AliyunCaptcha 并传入场景配置和验签回调。
import { useEffect, useRef } from 'react';
import { mountAliyunCaptcha, type CaptchaOptions } from './mount';
export interface AliyunCaptchaProps extends CaptchaOptions { className?: string }
// AliyunCaptcha 渲染验证码容器；配置变化时重建实例，回调变化不会中断在途验证。
// 属性包含场景、展示方式及回调；组件卸载时释放页面实例租约。
export function AliyunCaptcha({ className, ...options }: AliyunCaptchaProps) {
  const element = useRef<HTMLDivElement>(null);
  const latest = useRef(options); latest.current = options;
  useEffect(() => {
    const proxy: CaptchaOptions = { ...latest.current,
      onToken: (param, kind) => latest.current.onToken?.(param, kind),
      get onVerify() { return latest.current.onVerify; },
      onVerified: (param, kind) => latest.current.onVerified?.(param, kind),
      onFail: reason => latest.current.onFail?.(reason),
      onError: error => latest.current.onError?.(error),
    };
    const handle = mountAliyunCaptcha(element.current!, proxy);
    return () => handle.destroy();
  }, [options.region, options.prefix, options.kind, options.mode, options.buttonText, options.scenes[options.kind], options.slideStyle?.width, options.slideStyle?.height]);
  return <div ref={element} className={className} />;
}
