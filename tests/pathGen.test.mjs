import test from 'node:test';
import assert from 'node:assert/strict';
import { Path, WALK_RAMP } from '../src/anim/Path.js';
import { rectangle, arcPoints, defaultDuration, line, arc, polar, toward, simplify, pathLength, WALK_PACE } from '../src/anim/pathGen.js';
import { createEmptyDocument, validate } from '../src/doc/schema.js';
import { addCharacter, setPath } from '../src/doc/edit.js';


const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

test('line：两点、拷贝不共享引用', () => {
  const a = [0, 0, 0], b = [3, 0, 4];
  const pts = line(a, b);
  assert.deepEqual(pts, [[0, 0, 0], [3, 0, 4]]);
  assert.notEqual(pts[0], a);
});

test('arc：点数、半径、角度约定（逆时针为正）', () => {
  const center = [1, 0, -2];
  const { points, closed } = arc({ center, radius: 2, startDeg: 0, sweepDeg: 180, y: 0.3 });
  assert.equal(closed, false);
  assert.equal(points.length, 9); // segments=8 → 9 点
  for (const p of points) { assert.ok(close(dist2(p, center), 2)); assert.equal(p[1], 0.3); }
  assert.deepEqual(points[0], [3, 0.3, -2]);           // 0° = +X
  assert.ok(close(points[4][0], 1) && close(points[4][2], -4)); // 90° = −Z（从上往下看逆时针）
  assert.ok(close(points[8][0], -1) && close(points[8][2], -2)); // 180° = −X
});

test('arc：负 sweep 顺时针', () => {
  const { points, closed } = arc({ center: [0, 0, 0], radius: 1, startDeg: 0, sweepDeg: -90, y: 0, segments: 2 });
  assert.equal(closed, false);
  assert.equal(points.length, 3);
  assert.ok(close(points[2][0], 0) && close(points[2][2], 1)); // −90° = +Z
  const mid = polar([0, 0, 0], points[1]);
  assert.ok(close(mid.deg, -45) && close(mid.radius, 1));
});

test('arc：|sweep| ≥ 360 闭合、不重复首点', () => {
  for (const sweep of [360, -360, 720]) {
    const { points, closed } = arc({ center: [0, 0, 0], radius: 1.5, startDeg: 30, sweepDeg: sweep, y: 0 });
    assert.equal(closed, true, `sweep=${sweep}`);
    assert.equal(points.length, 8);
    for (const p of points) assert.ok(close(Math.hypot(p[0], p[2]), 1.5));
  }
  const open = arc({ center: [0, 0, 0], radius: 1, startDeg: 0, sweepDeg: 359, y: 0 });
  assert.equal(open.closed, false);
});

test('polar：与 arc 互逆', () => {
  const c = [2, 0, 1];
  const { points } = arc({ center: c, radius: 0.7, startDeg: -120, sweepDeg: 90, y: 0, segments: 3 });
  const p = polar(c, points[0]);
  assert.ok(close(p.radius, 0.7) && close(p.deg, -120, 1e-4));
});

test('toward：停在目标前 stopDistance、方向在连线上，y 取起点', () => {
  const from = [0, 0, 0], target = [3, 0.5, 4]; // 水平距离 5
  const pts = toward(from, target);
  assert.equal(pts.length, 2);
  assert.ok(close(dist2(pts[1], target), 0.8));
  assert.equal(pts[1][1], 0);
  const ang = Math.atan2(pts[1][2], pts[1][0]) - Math.atan2(4, 3);
  assert.ok(Math.abs(ang) < 1e-6);
  const p2 = toward(from, target, { stopDistance: 2 });
  assert.ok(close(dist2(p2[1], target), 2));
});

test('toward：太近返回 null（含恰好等于 stopDistance）', () => {
  assert.equal(toward([0, 0, 0], [0.5, 0, 0]), null);
  assert.equal(toward([0, 0, 0], [0.8, 0, 0]), null);
  assert.equal(toward([0, 0, 0], [0, 3, 0]), null); // 正上方：水平距离 0
  assert.notEqual(toward([0, 0, 0], [0.81, 0, 0]), null);
});

test('simplify：直线上的点全部去掉、首尾保留', () => {
  const pts = Array.from({ length: 50 }, (_, i) => [i * 0.1, 0, 0]);
  assert.deepEqual(simplify(pts), [[0, 0, 0], [4.9, 0, 0]]);
});

test('simplify：容差 —— 偏差小于容差的拐点去掉，大于的保留', () => {
  const small = [[0, 0, 0], [1, 0, 0.04], [2, 0, 0]];
  const big = [[0, 0, 0], [1, 0, 0.06], [2, 0, 0]];
  assert.equal(simplify(small, 0.05).length, 2);
  assert.equal(simplify(big, 0.05).length, 3);
  assert.equal(simplify(small, 0.01).length, 3);
});

test('simplify：原采样点到简化折线的最大偏差 < 容差（S 形密集采样）', () => {
  const pts = [];
  for (let i = 0; i <= 400; i++) { const x = i / 100; pts.push([x, 0, 0.6 * Math.sin(x * Math.PI / 2)]); }
  const s = simplify(pts, 0.05);
  assert.ok(s.length >= 5 && s.length <= 40, `点数 ${s.length}`);
  let max = 0;
  for (const p of pts) {
    let best = Infinity;
    for (let i = 0; i + 1 < s.length; i++) {
      const a = s[i], b = s[i + 1];
      const abx = b[0] - a[0], abz = b[2] - a[2];
      const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[2] - a[2]) * abz) / (abx * abx + abz * abz)));
      best = Math.min(best, Math.hypot(p[0] - a[0] - abx * u, p[2] - a[2] - abz * u));
    }
    max = Math.max(max, best);
  }
  assert.ok(max < 0.05, `最大偏差 ${max}`);
});

test('simplify：≤ 2 点原样返回（拷贝）', () => {
  const one = [[1, 2, 3]];
  assert.deepEqual(simplify(one), [[1, 2, 3]]);
  assert.notEqual(simplify(one)[0], one[0]);
});

test('defaultDuration：匀速段速度 = 步速（含 0.4 s 起步 / 收步），向上取 0.1 s，最短 1 s', () => {
  assert.ok(close(pathLength(line([0, 0, 0], [6, 0, 0])), 6, 1e-6));
  assert.equal(defaultDuration(line([0, 0, 0], [6.8, 0, 0])), 5.2);            // 第五轮：6.8/1.44 + 0.4，向上取 0.1 s
  assert.equal(defaultDuration(line([0, 0, 0], [6, 0, 0]), { speed: 3 }), 2.4); // 2 + 0.4
  assert.equal(defaultDuration(line([0, 0, 0], [6.5, 0, 0]), { speed: 1, ramp: 0 }), 6.5); // 机位：长 ÷ 速度
  assert.equal(defaultDuration(line([0, 0, 0], [1.2, 0, 0]), { speed: 1 }), 1.6); // 1.2 ≥ 0.4 → 1.2 + 0.4
  assert.equal(defaultDuration(line([0, 0, 0], [1.02, 0, 0]), { speed: 1.7, ramp: 0.8 }), 1.2); // 0.6 < 0.8 → 2×0.6 = 1.2
  assert.equal(defaultDuration(line([0, 0, 0], [0.3, 0, 0])), 1);              // 最短 1 s
  assert.equal(defaultDuration([[0, 0, 0]]), 1);
  { // 生成的时长下，匀速段速度 ≈ 步速（只差向上取整）
    const pts = line([0, 0, 0], [10, 0, 0]), D = defaultDuration(pts);
    const v = new Path({ points: pts, closed: false, start: 0, duration: D, speed: 'smooth' }, { ramp: WALK_RAMP }).speedAt(D / 2);
    assert.ok(v <= WALK_PACE + 1e-9 && v > WALK_PACE - 0.05, `匀速 ${v}`);
  }
  const ring = arc({ center: [0, 0, 0], radius: 1, startDeg: 0, sweepDeg: 360, y: 0 });
  const L = pathLength(ring.points, true);
  assert.ok(Math.abs(L - 2 * Math.PI) < 0.05, `整圆长 ${L}`);
  assert.equal(defaultDuration(ring.points, { closed: true }), Math.ceil((L / WALK_PACE + WALK_RAMP) * 10 - 1e-9) / 10);
});


test('rectangle uses exact edges, closure, unequal lengths and correct insertion indices', () => {
  const points = rectangle([0, 2, 0], [3, 99, 4]);
  const json = { points, closed: true, interpolation: 'polyline', start: 0, duration: 14, speed: 'linear' };
  const p = new Path(json);
  assert.equal(p.length, 14);
  assert.deepEqual(p.positionAt(3).toArray(), [3, 2, 0]);
  assert.deepEqual(p.positionAt(7).toArray(), [3, 2, 4]);
  assert.deepEqual(p.positionAt(14).toArray(), [0, 2, 0]);
  assert.equal(p.edgeAt(5), 1);
  for (let s = 0; s <= 14; s += .01) {
    const v = p.positionAt(s);
    assert.ok(v.x >= 0 && v.x <= 3 && v.z >= 0 && v.z <= 4);
    assert.ok(v.x === 0 || v.x === 3 || v.z === 0 || v.z === 4);
  }
  assert.equal(rectangle([0, 0, 0], [.01, 0, 4]), null);
  assert.equal(defaultDuration(points, { closed: true, interpolation: 'polyline', speed: 1, ramp: 0 }), 14);
});


test('polyline validates and survives JSON; legacy curves unchanged; redraw clears interpolation', () => {
  const d = createEmptyDocument();
  const e = addCharacter(d, { body: 'male' });
  const points = rectangle([0, 0, 0], [3, 0, 4]);
  setPath(d, e.id, points, { closed: true, set: { interpolation: 'polyline' } });
  assert.equal(validate(d).ok, true, JSON.stringify(validate(d).errors));
  const p = new Path(d.paths[0]);
  const q = new Path(JSON.parse(JSON.stringify(d)).paths[0]);
  assert.deepEqual(p.positionAt(4).toArray(), q.positionAt(4).toArray());
  const legacy = { ...d.paths[0] }; delete legacy.interpolation;
  assert.deepEqual(new Path(legacy).positionAt(3).toArray(), new Path({...legacy, interpolation:'centripetal'}).positionAt(3).toArray());
  setPath(d, e.id, [[0,0,0],[1,0,0]]);
  assert.equal(d.paths[0].interpolation, undefined);
  d.paths[0].interpolation = 'bad'; assert.equal(validate(d).ok, false);
});


test('circle is full 360 degrees and closes without duplicate endpoint', () => {
  const r = arcPoints({kind:'arc',center:[0,0,0],radius:2,startDeg:0,sweepDeg:360}, 0);
  assert.equal(r.closed, true);
  const p = new Path({...r,start:0,duration:10,speed:'linear'});
  assert.ok(Math.abs(p.length - 4 * Math.PI) < .03);
  assert.ok(p.positionAt(0).distanceTo(p.positionAt(p.length)) < 1e-9);
});
