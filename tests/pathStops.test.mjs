// 路径停顿 stops / stopTimes（收尾 1）：校验器、改动后的维护（fitStops 等）。node --test tests/pathStops.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitStops, stopsAfterInsert, stopsAfterDelete, stopsAfterReverse, toggleStop } from '../src/anim/pathGen.js';
import { Path, WALK_RAMP } from '../src/anim/Path.js';
import { createEmptyDocument, validate } from '../src/doc/schema.js';

const PTS = [[0, 0, 0], [2, 0, 0], [2, 0, 3], [5, 0, 3], [5, 0, 6]];
const P = (extra = {}) => ({ id: 'pth00001', target: 'prp00001', points: PTS, closed: false, start: 0, duration: 8, speed: 'smooth', orient: 'tangent', ...extra });

function docWith(path) {
  const d = createEmptyDocument();
  d.entities.push({ type: 'prop', id: 'prp00001', name: '方块', kind: 'box', color: '#888888', visible: true, transform: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] } });
  d.paths.push(path);
  return validate(d).errors;
}

test('校验：缺省 / 合法的 stops + stopTimes 通过；越界 / 乱序 / 不等长 / 超时长被定位', () => {
  assert.deepEqual(docWith(P()), []);
  assert.deepEqual(docWith(P({ stops: [1, 3] })), []);
  assert.deepEqual(docWith(P({ stops: [1, 3], stopTimes: [2, 6] })), []);
  assert.deepEqual(docWith(P({ stops: [] })), []);
  const one = (extra, frag) => {
    const e = docWith(P(extra));
    assert.ok(e.length && e.some((x) => x.includes(frag)), `${JSON.stringify(extra)} → ${JSON.stringify(e)}`);
  };
  one({ stops: [0] }, 'paths[0].stops[0]');
  one({ stops: [4] }, 'paths[0].stops[0]'); // 末点
  one({ stops: [3, 2] }, 'paths[0].stops[1]');
  one({ stops: [1.5] }, 'paths[0].stops[0]');
  one({ stopTimes: [2] }, '需要同时给出 stops');
  one({ stops: [1, 3], stopTimes: [2] }, 'paths[0].stopTimes');
  one({ stops: [1, 3], stopTimes: [2, 8] }, 'paths[0].stopTimes[1]');
  one({ stops: [1, 3], stopTimes: [5, 3] }, 'paths[0].stopTimes[1]');
  assert.deepEqual(docWith(P({ closed: true, stops: [4] })), []); // 闭合路径可停在最后一个顶点（之后回到首点）
});

test('fitStops：顶点数变了去掉、越界去掉、时长变了按比例缩放、空的删字段', () => {
  const old = P({ stops: [1, 3], stopTimes: [2, 6] });
  assert.deepEqual(fitStops(old, { ...old, duration: 4 }, { duration: 4 }).stopTimes, [1, 3]);
  const fewer = fitStops(old, { ...old, points: PTS.slice(0, 4) }, { points: PTS.slice(0, 4) });
  assert.ok(!('stops' in fewer) && !('stopTimes' in fewer));
  const same = fitStops(old, { ...old, points: PTS.map((p) => [p[0] + 1, 0, p[2]]) }, { points: PTS });
  assert.deepEqual(same.stops, [1, 3]);
  const none = fitStops(old, { ...old }, { stops: [], stopTimes: undefined });
  assert.ok(!('stops' in none) && !('stopTimes' in none));
  assert.deepEqual(Object.keys(fitStops(null, P())), Object.keys(P())); // 无停顿：字段与旧文档相同
});

test('插入 / 删除 / 反向 / 勾选停顿后的索引与时刻', () => {
  const p = P({ stops: [1, 3], stopTimes: [2, 6] });
  assert.deepEqual(stopsAfterInsert(p, 2).stops, [1, 4]);
  assert.deepEqual(stopsAfterDelete(p, 1), { stops: [2], stopTimes: [6] });
  assert.deepEqual(stopsAfterDelete(p, 2).stops, [1, 2]);
  assert.deepEqual(stopsAfterReverse(p), { stops: [1, 3], stopTimes: [2, 6] }); // 5 点、[1,3] 对称
  assert.deepEqual(stopsAfterReverse(P({ stops: [1] })).stops, [3]);
  assert.deepEqual(toggleStop(P(), 2, true), { stops: [2] });
  const on = toggleStop(p, 2, true);
  assert.deepEqual(on.stops, [1, 2, 3]);
  assert.ok(on.stopTimes[1] > 2 && on.stopTimes[1] < 6, JSON.stringify(on.stopTimes));
  // 新停顿时刻 = 原时间分配下到达该顶点的时刻
  const S = new Path(p);
  const s2 = S.vertexDistance(2);
  assert.ok(Math.abs(S.distanceAt(on.stopTimes[1]) - s2) < 0.01);
  assert.deepEqual(toggleStop(on, 2, false), { stops: [1, 3], stopTimes: [2, 6] });
});

test('角色起步：ramp 秒内加到匀速，之后匀速；首尾速度 0、终点 = 全长、位移连续；机位（ramp=0）仍整段 smoothstep', () => {
  const json = { points: [[0, 0, 0], [13, 0, 0]], closed: false, start: 1, duration: 10, speed: 'smooth' };
  const P = new Path(json, { ramp: WALK_RAMP }), C = new Path(json);
  const V = 13 / (10 - WALK_RAMP);
  assert.equal(P.speedAt(1), 0);
  assert.ok(Math.abs(P.speedAt(1 + WALK_RAMP) - V) < 1e-9);
  assert.ok(Math.abs(P.speedAt(6) - V) < 1e-9);
  assert.ok(Math.abs(P.distanceAt(11) - 13) < 1e-9 && Math.abs(P.distanceAt(6) - 6.5) < 1e-9);
  let prev = 0;
  for (let i = 1; i <= 4000; i++) { // 数值导数 ≈ speedAt（C¹，无跳变）
    const t = 1 + i / 400, d = P.distanceAt(t);
    assert.ok(Math.abs((d - prev) * 400 - P.speedAt(t - 1 / 800)) < 1e-3);
    prev = d;
  }
  assert.ok(Math.abs(C.distanceAt(6) - 6.5) < 1e-9 && Math.abs(C.speedAt(6) - 1.5 * 1.3) < 1e-9);
  // 有 stops 时每段同样 ramp
  const S = new Path({ ...json, points: [[0, 0, 0], [6.5, 0, 0], [13, 0, 0]], stops: [1] }, { ramp: WALK_RAMP });
  assert.ok(S.speedAt(6) < 1e-12);
  assert.ok(Math.abs(S.speedAt(1 + WALK_RAMP) - 6.5 / (5 - WALK_RAMP)) < 1e-9);
});
