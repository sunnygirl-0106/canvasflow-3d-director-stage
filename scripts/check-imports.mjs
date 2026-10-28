// 架构检查：src/ 的 import 图不能有环，且下层不能 import 上层。
// 分层（下 → 上）：util → config / rig / anim / doc / entities / core → ai / app → ui → main。CI 里随单测跑。
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve('src');
const LAYER = { util: 0, rig: 1, anim: 1, doc: 1, entities: 1, core: 1, ai: 2, app: 2, ui: 3 };
const layerOf = (f) => {
  const top = path.relative(SRC, f).split(path.sep)[0];
  return top.endsWith('.js') ? (top === 'config.js' ? 1 : 4) : LAYER[top] ?? 4;
};

const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } })(SRC);

const graph = new Map();
const problems = [];
for (const f of files) {
  const deps = [...fs.readFileSync(f, 'utf8').matchAll(/^import[^'"]*['"](\.[^'"]+)['"]/gm)].map((m) => path.resolve(path.dirname(f), m[1]));
  graph.set(f, deps);
  for (const d of deps) {
    if (layerOf(d) > layerOf(f)) problems.push(`分层倒置：${path.relative(SRC, f)} → ${path.relative(SRC, d)}`);
  }
}

const state = new Map();
const stack = [];
function dfs(f) {
  state.set(f, 1); stack.push(f);
  for (const d of graph.get(f) || []) {
    if (state.get(d) === 1) problems.push('循环依赖：' + [...stack.slice(stack.indexOf(d)), d].map((x) => path.relative(SRC, x)).join(' → '));
    else if (!state.get(d)) dfs(d);
  }
  state.set(f, 2); stack.pop();
}
for (const f of files) if (!state.get(f)) dfs(f);

for (const p of problems) console.log('❌ ' + p);
console.log(problems.length ? `\n${problems.length} 个问题` : `✅ ${files.length} 个模块：无循环依赖、无分层倒置`);
process.exit(problems.length ? 1 : 0);
