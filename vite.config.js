import { defineConfig, loadEnv } from 'vite';
import { readFileSync } from 'node:fs';
import { localAiPlugin } from './scripts/local-ai.mjs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// 只构建 index.html。calib.html（骨骼档案校准）是开发工具：npm run dev 时直接访问 /calib.html，不进生产包。
// 资产放在 public/assets 下，构建后原样拷贝到 dist/assets。
export default defineConfig(({ mode, command, isPreview }) => {
  // 自测不读取本机凭据；静态产物使用浏览器设置，不能绑定仅在本机存在的代理。
  const env = mode === 'test' ? {} : loadEnv(mode, process.cwd(), 'AI_');
  const localModel = command === 'serve' && !isPreview && env.AI_API_KEY && env.AI_BASE_URL && env.AI_MODEL;
  return {
    plugins: [localAiPlugin(env)],
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version), // 场景文档 meta.app 用
      __LOCAL_AI_MODEL__: JSON.stringify(localModel || ''),
    },
    server: {
      open: true,
    },
    build: {
      target: 'es2020',
      chunkSizeWarningLimit: 1500, // three 较大，提高警告阈值避免噪音
    },
  };
});
