import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// 多页：index.html（应用）+ calib.html（骨骼档案校准，开发用）。
// 资产放在 public/assets 下，构建后原样拷贝到 dist/assets。
export default defineConfig({
  base: './',
  server: {
    open: true,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500, // three 较大，提高告警阈值避免噪音
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        calib: fileURLToPath(new URL('./calib.html', import.meta.url)),
      },
    },
  },
});
