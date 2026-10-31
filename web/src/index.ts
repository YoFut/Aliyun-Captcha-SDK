// 文件类型：TypeScript 公开入口；用途：统一导出组件、挂载函数与类型。
// 用法：从包入口导入 AliyunCaptcha 或 mountAliyunCaptcha。
export { mountAliyunCaptcha } from './mount';
export { AliyunCaptcha } from './react';
export type { CaptchaOptions, CaptchaHandle, CaptchaKind, CaptchaScenes, CaptchaConfig } from './mount';
export type { AliyunCaptchaProps } from './react';
