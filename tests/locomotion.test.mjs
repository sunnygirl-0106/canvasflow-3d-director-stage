// 程序化步态单测：步幅缩放、周期性、左右相差半周期、相位连续（无跳变）、骨盆只降不升、速度 0 = 原姿势。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gaitPose, locomotionPose, strideScale, STRIDE_MIN, applyLocomotion, GAIT_CYCLES_PER_SECOND } from '../src/anim/Locomotion.js';

// 真实人偶的站立腿部几何（Character.legGeom，从浏览器里导出；换模型后重新导出）
const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures/legGeom.json', import.meta.url), 'utf8'));
const GEOM = FIXTURE.male;
const LEG_KEYS = ['LegFwd', 'Knee', 'Foot'];

test('起步短步缩放：随速度单调、夹在 [STRIDE_MIN, 1]', () => {
  assert.equal(strideScale(0), STRIDE_MIN);
  assert.equal(strideScale(100), 1);
  let prev = 0;
  for (let v = 0; v <= 3; v += 0.1) { const s = strideScale(v); assert.ok(s >= prev); prev = s; }
});

test('周期为 1；左腿在 φ 的角度 = 右腿在 φ + 0.5 的角度', () => {
  for (const speed of [1.6, 5]) {
    for (const ph of [0.1, 0.37, 0.8]) {
      const a = gaitPose(GEOM, ph, speed).values, b = gaitPose(GEOM, ph + 1, speed).values;
      for (const key of Object.keys(a)) assert.ok(Math.abs(a[key] - b[key]) < 1e-6, `${key} 周期`);
      const c = gaitPose(GEOM, ph + 0.5, speed).values;
      // 骨盆高度按离散采样求（左右采样点不完全对称），允许 0.5° 误差
      for (const j of LEG_KEYS) assert.ok(Math.abs(a['l' + j] - c['r' + j]) < 0.5, `${j} 左右：${a['l' + j]} vs ${c['r' + j]}`);
    }
  }
});

// 跳变 vs 快速变化：步长减半时真跳变的差值不变，连续变化（含脚着地时的转折）差值跟着减小。
test('相位连续（男 / 女，走 / 起步 / 加速走）：没有跳变，骨盆不高于站立', () => {
  const H = 1 / 400;
  for (const body of ['male', 'female']) {
    for (const speed of [1.4, 0.3, 3.5]) {
      const G = FIXTURE[body];
      for (let i = 0; i < 800; i++) {
        const ph = i * H;
        const a = gaitPose(G, ph, speed), b = gaitPose(G, ph + H, speed), m = gaitPose(G, ph + H / 2, speed);
        for (const key of Object.keys(a.values)) {
          const d1 = Math.abs(b.values[key] - a.values[key]);
          const d2 = Math.max(Math.abs(m.values[key] - a.values[key]), Math.abs(b.values[key] - m.values[key]));
          assert.ok(!(d1 > 1 && d2 > 0.9 * d1), `${body} ${key} 在 φ=${ph.toFixed(4)} 跳变 ${d1.toFixed(2)}°（v=${speed}）`);
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

// 已有路径被压缩时长后仍保持舒缓步频，不随位移速度快速倒腿。
test('高速路径仍为走路，迈腿频率保持舒缓上限', () => {
  for (const geom of Object.values(FIXTURE)) {
    for (const speed of [1.1, 1.2, 1.8, 2.2, 2.6, 4, 6, 12]) {
      for (let i = 0; i < 32; i++) {
        const phase = i / 32;
        const walk = locomotionPose({}, geom, { speed: 1.6, phase });
        const fast = locomotionPose({}, geom, { speed, phase });
        assert.deepEqual(fast, walk);
        assert.equal(fast.values.lFore, 12);
        assert.equal(fast.values.spineX, 0);
      }
    }
  }
});


test('步频只随时间推进，不受路径速度、角色身高与缩放影响', () => {
  for (const speed of [0.05, 0.3, 1.1, 6]) for (const scale of [0.5, 1, 2]) {
    const ch = { height: 1.75, legGeom: null, values: {}, model: { position: { y: 0 } }, standModelY: 0, baseScale: 1, applyPose() {} };
    const phaseAt = (gaitTime) => applyLocomotion(ch, {}, { speed, gaitTime }, scale).phase;
    assert.ok(Math.abs(phaseAt(3) - phaseAt(1) - 2 * GAIT_CYCLES_PER_SECOND) < 1e-9);

  }
});

test('正常行走不深蹲或过度屈膝，男女模型均保持适度抬脚', () => {
  for (const geom of Object.values(FIXTURE)) {
    for (let i = 0; i < 100; i++) {
      const pose = gaitPose(geom, i / 100, 1.2);
      assert.ok(pose.values.lKnee < 66 && pose.values.rKnee < 66);
      assert.ok(pose.drop > -0.075);
    }
  }
});
