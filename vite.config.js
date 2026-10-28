import { defineConfig, loadEnv } from 'vite';
import { readFileSync } from 'node:fs';
import { versionAssetsPlugin } from './scripts/version-assets.mjs';
import { buildReportPlugin } from './scripts/build-report.mjs';
import { localAiPlugin } from './scripts/local-ai.mjs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// 资产逻辑源放在 public/assets，生产由 versionAssetsPlugin 输出带哈希的文件。
export default defineConfig(({ mode, command, isPreview }) => {
  // 自测不读取本机凭据；静态产物使用浏览器设置，不能绑定仅在本机存在的代理。
  const env = mode === 'test' ? {} : loadEnv(mode, process.cwd(), 'AI_');
  const localModel = command === 'serve' && !isPreview && env.AI_API_KEY && env.AI_BASE_URL && env.AI_MODEL;
  return {
    plugins: [localAiPlugin(env), versionAssetsPlugin(), buildReportPlugin()],
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
      copyPublicDir: false, // assets 由 versionAssetsPlugin 生成哈希，不重复拷贝原名文件
      rollupOptions: { output: { manualChunks(id) {
        if (id.includes('/node_modules/three/')) return 'three';
        if (id.includes('/node_modules/immer/')) return 'immer';
      } } },
      chunkSizeWarningLimit: 1500, // three 较大，提高警告阈值避免噪音
    },
  };
});
