// 文件类型：Vite 配置；用途：启动演示代理并构建外置 React 的 ESM 库。
// 用法：通过 pnpm dev 或 pnpm build 加载。
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], server: { proxy: { '/captcha': 'http://localhost:8080' } }, build: { lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'aliyun-captcha.js' }, rollupOptions: { external: ['react', 'react-dom', 'react/jsx-runtime'] }, emptyOutDir: false } });
