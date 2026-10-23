import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'node_modules/', '.cache/', 'test-output/', '_assets_src/', '**/*.ts'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser, __LOCAL_AI_MODEL__: 'readonly' } },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': ['error', { destructuring: 'all', ignoreReadBeforeAssign: true }],
    },
  },
  {
    // node 侧：自测 / 单测 / 脚本 / 配置（selftest 里 page.evaluate 的回调跑在浏览器，两套全局都要）
    files: ['selftest.mjs', 'e2e/**', 'tests/**', 'scripts/**', '*.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
