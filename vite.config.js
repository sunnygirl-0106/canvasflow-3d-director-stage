import { defineConfig } from 'vite';

// 单页应用，资产放在 public/assets 下，构建后原样拷贝到 dist/assets。
export default defineConfig({
  base: './',
  server: {
    open: true,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500, // three 较大，提高告警阈值避免噪音
  },
});
