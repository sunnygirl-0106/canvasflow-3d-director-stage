// cameraMoves 单元测试（阶段 F 第 1 步）：node 直接跑，不起浏览器。
// 运行：npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cameraMove, defaultParams, aimRotation, appendMove, lookAtWindows, pathEnd, MoveError, CAMERA_MOVES, MOVE_DURATION } from '../src/anim/cameraMoves.js';
import { Path } from '../src/anim/Path.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const hd = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const last = (a) => a[a.length - 1];

// 机位在主体 +Z 方向 5 m、高 1.6；主体注视点在原点上方 0.85
const CAM = [0, 1.6, 5];
const AIM = [0, 0.85, 0];

/** 机位朝向（欧拉度数）的 −Z 方向。 */
const forward = (rot) => new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(...rot.map((d) => d * Math.PI / 180)));

test('词汇表：7 个预设、默认时长', () => {
  assert.deepEqual(CAMERA_MOVES.map(([n]) => n), ['push_in', 'pull_out', 'truck', 'crane', 'pan', 'half_orbit', 'circle']);
  for (const [n] of CAMERA_MOVES) assert.equal(defaultParams(n, { position: CAM, aim: AIM }).duration, MOVE_DURATION[n]);
  assert.throws(() => cameraMove('zoom', { position: CAM, aim: AIM }), MoveError);
});

test('push_in：沿连线靠近 40%、高度不变、首点 = 当前位置', () => {
  const m = cameraMove('push_in', { position: CAM, aim: AIM });
  assert.equal(m.points.length, 2);
  assert.deepEqual(m.points[0], CAM);
  assert.ok(close(hd(last(m.points), AIM), 5 * 0.6));
  assert.equal(last(m.points)[1], 1.6);
  assert.ok(close(last(m.points)[0], 0)); // 仍在连线上
  assert.equal(m.duration, 3);
  assert.equal(m.rotKeys, null);
});

test('push_in：推过头抛错；amount 可自定义', () => {
  assert.throws(() => cameraMove('push_in', { position: CAM, aim: AIM, params: { amount: 4.9 } }), MoveError);
  const m = cameraMove('push_in', { position: CAM, aim: AIM, params: { amount: 1 } });
  assert.ok(close(hd(last(m.points), AIM), 4));
});

test('pull_out：反向远离 60%', () => {
  const m = cameraMove('pull_out', { position: CAM, aim: AIM });
  assert.ok(close(hd(last(m.points), AIM), 5 * 1.6));
  assert.ok(last(m.points)[2] > CAM[2]);
  assert.equal(last(m.points)[1], 1.6);
});

test('truck：垂直于连线、y 不变；left 以机位视角为准', () => {
  // 机位在 +Z 看向 −Z：机位左边 = −X
  const L = cameraMove('truck', { position: CAM, aim: AIM });
  const R = cameraMove('truck', { position: CAM, aim: AIM, params: { dir: 'right', amount: 1 } });
  const d = [last(L.points)[0] - CAM[0], last(L.points)[2] - CAM[2]];
  const u = [AIM[0] - CAM[0], AIM[2] - CAM[2]];
  assert.ok(close(d[0] * u[0] + d[1] * u[1], 0));           // 垂直
  assert.ok(close(Math.hypot(...d), 2));                      // 默认 2 m
  assert.ok(close(last(L.points)[0], -2));                    // 向左 = −X
  assert.ok(close(last(R.points)[0], 1));
  assert.equal(last(L.points)[1], 1.6);
});

test('crane：只有 y 变化', () => {
  const up = cameraMove('crane', { position: CAM, aim: AIM });
  const down = cameraMove('crane', { position: CAM, aim: AIM, params: { dir: 'down', amount: 0.5 } });
  assert.deepEqual(last(up.points), [0, 2.6, 5]);
  assert.deepEqual(last(down.points), [0, 1.1, 5]);
});

test('pan：无路径、两键（起 = 当前朝向，止 = 对准主体）', () => {
  const rot = [0, 40, 0]; // 当前朝左前方
  const m = cameraMove('pan', { position: CAM, rot, aim: AIM });
  assert.equal(m.points, null);
  assert.equal(m.duration, 2);
  assert.equal(m.rotKeys.length, 2);
  assert.deepEqual(m.rotKeys[0], rot);
  const f = forward(m.rotKeys[1]);
  const want = new THREE.Vector3(...AIM).sub(new THREE.Vector3(...CAM)).normalize();
  assert.ok(f.angleTo(want) < 1e-5);
});

test('pan：保留荷兰角（与 aimRotation 一致）', () => {
  const m = cameraMove('pan', { position: CAM, rot: [0, 0, 0], roll: 10, aim: AIM });
  assert.deepEqual(m.rotKeys[1], aimRotation(CAM, AIM, 10));
  assert.ok(close(m.rotKeys[1][2], 10, 0.5)); // 正对时 roll ≈ 欧拉 z
});

test('half_orbit：圆上点、半径 = 当前水平距离、高度不变、扫 180°', () => {
  const m = cameraMove('half_orbit', { position: CAM, aim: AIM });
  assert.equal(m.closed, false);
  assert.deepEqual(m.points[0], CAM);
  for (const p of m.points) { assert.ok(close(hd(p, AIM), 5)); assert.equal(p[1], 1.6); }
  assert.ok(close(last(m.points)[0], 0) && close(last(m.points)[2], -5)); // 对面
});

test('half_orbit：dir 方向（俯视逆时针 ccw / 顺时针 cw）', () => {
  // 从 +Z（角度 −90°）出发：ccw 先经过 +X（0°），cw 先经过 −X
  const ccw = cameraMove('half_orbit', { position: CAM, aim: AIM, params: { dir: 'ccw' } });
  const cw = cameraMove('half_orbit', { position: CAM, aim: AIM, params: { dir: 'cw' } });
  const mid = (m) => m.points[Math.floor(m.points.length / 2)];
  assert.ok(mid(ccw)[0] > 4.9);
  assert.ok(mid(cw)[0] < -4.9);
});

test('half_orbit：沿曲线求值（Catmull-Rom）水平半径恒定 ± 1 cm', () => {
  const m = cameraMove('half_orbit', { position: [1, 1.6, 3.5], aim: [-0.3, 0.9, 0.2] });
  const path = new Path({ points: m.points, closed: false, start: 0, duration: 5, speed: 'smooth' });
  const R = hd(m.points[0], [-0.3, 0, 0.2]);
  for (let i = 0; i <= 200; i++) {
    const p = path.positionAt((path.length * i) / 200);
    assert.ok(Math.abs(Math.hypot(p.x + 0.3, p.z - 0.2) - R) < 0.01, `i=${i} r=${Math.hypot(p.x + 0.3, p.z - 0.2)} R=${R}`);
    assert.ok(Math.abs(p.y - 1.6) < 1e-3);
  }
});

test('circle：闭合、不重复首点、整圈', () => {
  const m = cameraMove('circle', { position: CAM, aim: AIM });
  assert.equal(m.closed, true);
  assert.equal(m.duration, 8);
  assert.ok(hd(m.points[0], last(m.points)) > 0.5);
  for (const p of m.points) assert.ok(close(hd(p, AIM), 5));
});

test('appendMove：接缝重合、duration 相加、首点去重', () => {
  const a = cameraMove('push_in', { position: CAM, aim: AIM });
  const pathA = { id: 'p1', target: 'c1', points: a.points, closed: false, start: 0, duration: a.duration, speed: 'smooth', orient: 'keep' };
  const b = cameraMove('half_orbit', { position: pathEnd(pathA), aim: AIM });
  const ab = appendMove(pathA, b);
  assert.equal(ab.points.length, a.points.length + b.points.length - 1);
  assert.deepEqual(ab.points[a.points.length - 1], last(a.points)); // 接缝点
  assert.equal(ab.duration, 8);
  assert.equal(ab.closed, false);
  assert.equal(ab.id, 'p1');
  assert.equal(ab.orient, 'keep');
});

test('appendMove：闭合路径展开后接续；起点不在终点抛错', () => {
  const c = cameraMove('circle', { position: CAM, aim: AIM });
  const pathC = { points: c.points, closed: true, start: 1, duration: 8 };
  assert.deepEqual(pathEnd(pathC), CAM);
  const p = cameraMove('push_in', { position: pathEnd(pathC), aim: AIM });
  const cp = appendMove(pathC, p);
  assert.equal(cp.points.length, c.points.length + 1 + 1); // 首点闭合回来 + push 终点
  assert.deepEqual(cp.points[c.points.length], CAM);
  assert.equal(cp.closed, false);
  assert.equal(cp.start, 1);
  assert.throws(() => appendMove(pathC, cameraMove('push_in', { position: [9, 1.6, 9], aim: AIM })), MoveError);
});

test('lookAtWindows：异主体截断、同主体合并、窗口不重叠', () => {
  // 第一段 [0, 全程] 注视 A
  const first = lookAtWindows([], { subject: 'A', cut: 0, start: 0 });
  assert.deepEqual(first, { remove: [], patch: [], add: { subject: 'A', start: 0, end: null } });
  const list = [{ id: 'k1', subject: 'A', start: 0, end: null }];
  // 第二段 3 s 起注视 B：k1 截到 3，新增 [3, 全程]
  const diff = lookAtWindows(list, { subject: 'B', cut: 3, start: 3 });
  assert.deepEqual(diff.patch, [{ id: 'k1', end: 3 }]);
  assert.deepEqual(diff.add, { subject: 'B', start: 3, end: null });
  // 同主体：合并（不新增，沿用 k1）
  const same = lookAtWindows(list, { subject: 'A', cut: 3, start: 3 });
  assert.deepEqual(same, { remove: [], patch: [], add: null });
  // 自定义点主体按值比较
  assert.equal(lookAtWindows([{ id: 'k', subject: [1, 2, 3], start: 0, end: null }], { subject: [1, 2, 3], cut: 2, start: 2 }).add, null);
});

test('lookAtWindows：pan 的空档不合并、起点在 cut 之后的旧约束删除', () => {
  const list = [{ id: 'k1', subject: 'A', start: 0, end: null }, { id: 'k2', subject: 'C', start: 6, end: 7 }];
  const d = lookAtWindows(list, { subject: 'A', cut: 4, start: 6 }); // pan 4→6
  assert.deepEqual(d.patch, [{ id: 'k1', end: 4 }]);
  assert.deepEqual(d.remove, ['k2']);
  assert.deepEqual(d.add, { subject: 'A', start: 6, end: null });
});

// ---- 收尾 1 · 停顿 stops / stopTimes ----
test('appendMove 停顿：推 3 s + 半环绕 5 s —— 接缝加 stop、stopTimes = [3]；t=3 速度 < 0.05、0–3 s 在推的线段上、总 8 s', () => {
  const a = cameraMove('push_in', { position: CAM, aim: AIM });
  const pathA = { id: 'p1', target: 'c1', points: a.points, closed: false, start: 0, duration: a.duration, speed: 'smooth', orient: 'keep' };
  const ab = appendMove(pathA, cameraMove('half_orbit', { position: pathEnd(pathA), aim: AIM }));
  assert.deepEqual(ab.stops, [a.points.length - 1]);
  assert.deepEqual(ab.stopTimes, [3]);
  const P = new Path(ab);
  assert.ok(P.speedAt(3) < 0.05, `t=3 速度 ${P.speedAt(3)}`);
  assert.equal(ab.duration, 8);
  const [p0, p1] = [a.points[0], last(a.points)];
  const L = hd(p0, p1), ux = (p1[0] - p0[0]) / L, uz = (p1[2] - p0[2]) / L;
  let maxOff = 0;
  for (let i = 0; i <= 90; i++) {
    const q = P.positionAt(P.distanceAt(i / 30));
    const along = (q.x - p0[0]) * ux + (q.z - p0[2]) * uz;
    const off = Math.hypot(q.x - (p0[0] + ux * along), q.y - p0[1], q.z - (p0[2] + uz * along));
    maxOff = Math.max(maxOff, off, along < -1e-9 ? -along : 0, along > L + 1e-9 ? along - L : 0);
  }
  assert.ok(maxOff < 0.02, `偏离推的线段 ${maxOff} m`);
  assert.ok(close(P.positionAt(P.distanceAt(3)).distanceTo(new THREE.Vector3(...p1)), 0, 1e-6));
  assert.ok(P.speedAt(1.5) > 0.1 && P.speedAt(5.5) > 0.1); // 两段中间都在动
  // 再追加一段：已有停顿沿用、时刻按名义时长
  const abc = appendMove(ab, cameraMove('push_in', { position: pathEnd(ab), aim: AIM, params: { duration: 2 } }));
  assert.deepEqual(abc.stopTimes, [3, 8]);
  assert.equal(abc.stops.length, 2);
  assert.equal(abc.duration, 10);
});

test('Path 停顿：无 stops 的数值与之前逐项相同；stops 无 stopTimes 时按弧长比例分时长', () => {
  const pts = [[0, 0, 0], [2, 0, 0], [2, 0, 3], [5, 0, 3]];
  const base = { points: pts, closed: false, start: 1, duration: 6, speed: 'smooth' };
  const P0 = new Path(base), P1 = new Path({ ...base, stops: [] });
  for (let t = 0; t <= 8; t += 0.25) {
    assert.equal(P0.distanceAt(t), P1.distanceAt(t));
    assert.equal(P0.speedAt(t), P1.speedAt(t));
  }
  const S = new Path({ ...base, stops: [1, 2] });
  const T = S.segmentTimes; // 2 m / 3 m / 3 m → 6 s 按 2:3:3
  assert.ok(close(T[0], 1.5, 1e-3) && close(T[1], 3.75, 1e-3) && T[2] === 6, JSON.stringify(T));
  assert.ok(S.speedAt(1 + T[0]) < 1e-9 && S.speedAt(1 + T[1]) < 1e-9);
  assert.ok(close(S.positionAt(S.distanceAt(1 + T[1])).distanceTo(new THREE.Vector3(2, 0, 3)), 0, 1e-6));
  assert.ok(close(S.vertexDistance(2), 5, 1e-3));
});

test('appending retains closed tangents and linear custom prefix at every old frame', () => {
  for (const name of ['circle', 'truck']) for (const speed of ['smooth', 'linear']) {
    const move = cameraMove(name, { position: CAM, aim: AIM });
    const json = { ...move, start: 1, speed, orient: 'keep' };
    const path = new Path(json);
    const appended = new Path(appendMove(json, cameraMove('circle', { position: pathEnd(json), aim: AIM })));
    for (let t = 1; t <= 1 + move.duration; t += 1 / 30) {
      assert.ok(path.positionAt(path.distanceAt(t)).distanceTo(appended.positionAt(appended.distanceAt(t))) < 1e-8, `${name}/${speed} at ${t}`);
    }
  }
});

test('timed appended loops still support stop editing and independent endpoint editing', async () => {
  const { toggleStop, fitStops } = await import('../src/anim/pathGen.js');
  const move = cameraMove('circle', { position: CAM, aim: AIM });
  const prefix = { ...move, start: 0, speed: 'smooth', orient: 'keep' };
  const json = appendMove(prefix, cameraMove('truck', { position: pathEnd(prefix), aim: AIM }));
  const stopped = { ...json, ...toggleStop(json, 4, true) };
  assert.equal(stopped.timedSegments.length, 3);
  assert.equal(new Path(stopped).speedAt(stopped.timedSegments[0].end), 0);
  assert.deepEqual(stopped.timedSegments.at(-1), json.timedSegments.at(-1));
  const resumed = { ...stopped, ...toggleStop(stopped, 4, false) };
  assert.equal(resumed.timedSegments.length, 2);
  const points = structuredClone(json.points); points[0][0] += .5;
  const edited = fitStops(json, { ...json, points }, { points });
  assert.equal(edited.timedSegments[0].closed, false);
  assert.deepEqual(edited.points.at(-1), json.points.at(-1));
});
