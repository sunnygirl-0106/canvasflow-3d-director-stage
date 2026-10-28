import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Path, pathOptionsFor } from './migrate/pathModel.js';
import { PathTrack } from './migrate/pathModel.js';

test('人物及群众从首帧到末帧匀速，旧 smooth 路径也按总长 / 时长计算，步频固定', () => {
  for (const type of ['character', 'group']) {
    for (const length of [0.3, 6, 24]) {
      const json = { points: [[0, 0, 0], [length, 0, 0]], start: 2, duration: 4, closed: false, speed: 'smooth', orient: 'tangent' };
      const track = new PathTrack(json, pathOptionsFor(type));
      const state = { ent: { type }, opts: { posOffset: [0, 0, 0] }, position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
      const speed = length / json.duration;
      // 随机顺序求值，验证不依赖播放帧率或上一帧；包括起步和收步前的第一 / 最后一帧。
      for (const elapsed of [0, 1 / 60, 2.7, 4 - 1 / 60, 0.8, 4]) {
        track.apply(json.start + elapsed, state);
        assert.ok(Math.abs(state.position.x - speed * elapsed) < 2e-4);
        assert.ok(Math.abs(state.motion.speed - (elapsed > 0 && elapsed < 4 ? speed : 0)) < 1e-9);
        assert.ok(Math.abs(state.motion.gaitTime - elapsed) < 1e-8);
      }
      track.apply(json.start - 0.1, state);
      assert.equal(state.motion.speed, 0);
      assert.equal(state.position.x, 0);
      track.apply(json.start + json.duration + 0.1, state);
      assert.equal(state.motion.speed, 0);
      assert.ok(Math.abs(state.position.x - length) < 1e-9);
      assert.equal(json.speed, 'smooth'); // 运行兼容旧文档，不改写用户文件。
    }
  }
});

test('不等长折线路段按距离分配时间，转弯前后速度一致；曲线节点时刻与匀速播放一致', () => {
  const json = { points: [[0, 0, 0], [1, 0, 0], [1, 0, 4], [9, 0, 4]], start: 1, duration: 13, closed: false, speed: 'smooth' };
  const path = new Path({ ...json, interpolation: 'polyline' }, pathOptionsFor('character'));
  for (const [elapsed, expected] of [[0.01, [0.01, 0, 0]], [0.99, [0.99, 0, 0]], [1.01, [1, 0, 0.01]], [4.99, [1, 0, 3.99]], [5.01, [1.01, 0, 4]], [12.99, [8.99, 0, 4]]]) {
    assert.ok(path.positionAt(path.distanceAt(json.start + elapsed)).distanceTo(new THREE.Vector3(...expected)) < 1e-9);
    assert.equal(path.speedAt(json.start + elapsed), 1);
  }
  const curve = new Path(json, pathOptionsFor('character'));
  for (let i = 1; i < json.points.length - 1; i++) {
    const expected = json.start + curve.vertexDistance(i) / curve.length * json.duration;
    assert.ok(Math.abs(curve.vertexTime(i) - expected) < 1e-8);
  }
});

test('曲线节点疏密不均时，实际逐帧位移保持匀速，首尾和短边不再发生速度波动', () => {
  for (const points of [
    [[0, 0, 0], [1, 0, 0], [1, 0, 4], [9, 0, 4]],
    [[0, 0, 0], [0.01, 0, 0], [4, 0, 2], [5, 0, 8]],
  ]) {
    const path = new Path({ points, start: 0, duration: 6, speed: 'smooth', closed: false }, pathOptionsFor('character'));
    let prev = path.positionAt(0);
    const step = path.length / (6 * 240);
    for (let i = 1; i <= 6 * 240; i++) {
      const current = path.positionAt(path.distanceAt(i / 240));
      // 弯道上的两帧直线距离略短于弧长；误差控制在 0.6% 内（修复前可超过 20%）。
      assert.ok(Math.abs(current.distanceTo(prev) / step - 1) < 0.006, `第 ${i} 帧`);
      prev = current;
    }
  }
});

test('机位仍支持缓入缓出，不受人物匀速规则影响；显式停顿仍有效', () => {
  const json = { points: [[0, 0, 0], [3, 0, 0], [6, 0, 0]], start: 0, duration: 4, closed: false, speed: 'smooth' };
  const camera = new Path(json, pathOptionsFor('camera'));
  assert.equal(camera.speedAt(0), 0);
  assert.equal(camera.speedAt(4), 0);
  assert.ok(camera.speedAt(2) > camera.speedAt(0.1));
  const stopped = new Path({ ...json, stops: [1] }, pathOptionsFor('character'));
  assert.equal(stopped.speedAt(2), 0);
});
