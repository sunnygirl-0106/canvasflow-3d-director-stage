// 路径停顿 stops / stopTimes（收尾 1）：校验器、改动后的维护（fitStops 等）。node --test tests/pathStops.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitStops, stopsAfterInsert, stopsAfterDelete, stopsAfterReverse, toggleStop } from '../src/anim/pathGen.js';
import { Path } from '../src/anim/Path.js';
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
