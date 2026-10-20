// 快捷键分发（util/keys.js）：优先级顺序、stopPropagation 吃掉按键、注销、捕获先于冒泡。node 里用 EventTarget 模拟 window。
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = new EventTarget();
const { onKey, KEY_PRIORITY } = await import('../src/util/keys.js');

const press = (key) => { const e = new Event('keydown'); e.key = key; window.dispatchEvent(e); return e; };

test('按优先级从高到低收到，与注册先后无关；捕获阶段先于冒泡阶段', () => {
  const seen = [];
  const offs = [
    onKey(() => seen.push('global'), { priority: KEY_PRIORITY.global, phase: 'bubble' }),
    onKey(() => seen.push('timeline'), { priority: KEY_PRIORITY.timeline }),
    onKey(() => seen.push('modal'), { priority: KEY_PRIORITY.modal }),
    onKey(() => seen.push('pathDraw'), { priority: KEY_PRIORITY.pathDraw }),
  ];
  press('a');
  assert.deepEqual(seen, ['modal', 'pathDraw', 'timeline', 'global']);
  offs.forEach((off) => off());
});

test('stopImmediatePropagation 吃掉按键，低优先级（含冒泡阶段）不再收到；注销后不再收到', () => {
  const seen = [];
  const offA = onKey((e) => { seen.push('a'); if (e.key === 'Escape') e.stopImmediatePropagation(); }, { priority: 50 });
  const offB = onKey(() => seen.push('b'), { priority: 10 });
  const offC = onKey(() => seen.push('c'), { phase: 'bubble' });
  press('Escape');
  assert.deepEqual(seen, ['a']);
  press('x');
  assert.deepEqual(seen, ['a', 'a', 'b', 'c']);
  offA(); offB(); offC();
  press('x');
  assert.deepEqual(seen, ['a', 'a', 'b', 'c']);
});
