import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.browser },
    rules: {
      'no-unused-vars': ['error', { args: 'none' }],
    },
  },
  {
    files: ['selftest.mjs', 'eslint.config.js', 'vite.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
