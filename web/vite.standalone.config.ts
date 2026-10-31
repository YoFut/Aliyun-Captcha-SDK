// 文件类型：Vite 配置；用途：构建可由浏览器直接加载的独立脚本。
// 用法：通过 pnpm build 加载，产物供 Vue 或原生页面调用挂载接口。
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ define: { 'process.env.NODE_ENV': '"production"' }, plugins: [react()], build: { lib: { entry: 'src/index.ts', name: 'AliyunCaptchaSDK', formats: ['iife'], fileName: () => 'aliyun-captcha.iife.js' }, emptyOutDir: false } });
