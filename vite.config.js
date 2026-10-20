import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// 只构建 index.html。calib.html（骨骼档案校准）是开发工具：npm run dev 时直接访问 /calib.html，不进生产包。
// 资产放在 public/assets 下，构建后原样拷贝到 dist/assets。
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version), // 场景文档 meta.app 用
  },
  server: {
    open: true,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500, // three 较大，提高告警阈值避免噪音
  },
});
