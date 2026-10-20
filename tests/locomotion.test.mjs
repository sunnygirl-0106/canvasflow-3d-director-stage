// 程序化步态单测：步幅缩放、周期性、左右相差半周期、相位连续（无跳变）、骨盆只降不升、速度 0 = 原姿势。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gaitPose, locomotionPose, strideScale, runMix, STRIDE_MIN } from '../src/anim/Locomotion.js';

// 真实人偶的站立腿部几何（Character.legGeom，从浏览器里导出；换模型后重新导出）
const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures/legGeom.json', import.meta.url), 'utf8'));
const GEOM = FIXTURE.male;
const LEG_KEYS = ['LegFwd', 'Knee', 'Foot'];

test('起步短步缩放：随速度单调、夹在 [STRIDE_MIN, 1]', () => {
  assert.equal(strideScale(0), STRIDE_MIN);
  assert.equal(strideScale(100), 1);
  let prev = 0;
  for (let v = 0; v <= 3; v += 0.1) { const s = strideScale(v); assert.ok(s >= prev); prev = s; }
  assert.equal(runMix(1), 0);
  assert.equal(runMix(5), 1);
});

test('周期为 1；左腿在 φ 的角度 = 右腿在 φ + 0.5 的角度', () => {
  for (const k of [0, 1]) {
    for (const ph of [0.1, 0.37, 0.8]) {
      const a = gaitPose(GEOM, ph, k).values, b = gaitPose(GEOM, ph + 1, k).values;
      for (const key of Object.keys(a)) assert.ok(Math.abs(a[key] - b[key]) < 1e-6, `${key} 周期`);
      const c = gaitPose(GEOM, ph + 0.5, k).values;
      // 骨盆高度按离散采样求（左右采样点不完全对称），允许 0.5° 误差
      for (const j of LEG_KEYS) assert.ok(Math.abs(a['l' + j] - c['r' + j]) < 0.5, `${j} 左右：${a['l' + j]} vs ${c['r' + j]}`);
    }
  }
});

// 跳变 vs 快速变化：步长减半时真跳变的差值不变，连续变化（含脚着地时的转折）差值跟着减小。
test('相位连续（男 / 女，走 / 起步 / 跑）：没有跳变，骨盆不高于站立', () => {
  const H = 1 / 400;
  for (const body of ['male', 'female']) {
    for (const [k, speed] of [[0, 1.4], [0, 0.3], [1, 3.5]]) {
      const G = FIXTURE[body];
      for (let i = 0; i < 800; i++) {
        const ph = i * H;
        const a = gaitPose(G, ph, k, speed), b = gaitPose(G, ph + H, k, speed), m = gaitPose(G, ph + H / 2, k, speed);
        for (const key of Object.keys(a.values)) {
          const d1 = Math.abs(b.values[key] - a.values[key]);
          const d2 = Math.max(Math.abs(m.values[key] - a.values[key]), Math.abs(b.values[key] - m.values[key]));
          assert.ok(!(d1 > 1 && d2 > 0.9 * d1), `${body} ${key} 在 φ=${ph.toFixed(4)} 跳变 ${d1.toFixed(2)}°（k=${k} v=${speed}）`);
        }
        assert.ok(Math.abs(b.drop - a.drop) < 0.005, `${body} 骨盆在 φ=${ph.toFixed(4)} 跳变`);
        assert.ok(a.drop <= 1e-9);
      }
    }
  }
});

test('速度 0：完全是原姿势、骨盆不动', () => {
  const base = { lArmAbd: 10, spineX: 5 };
  const r = locomotionPose(base, GEOM, { speed: 0, phase: 0.3 });
  assert.equal(r.w, 0);
  assert.ok(r.drop === 0); // 可能是 −0
  assert.equal(r.values.lArmAbd, 10);
  assert.equal(r.values.spineX, 5);
  assert.equal(r.values.lKnee, 0);
});
