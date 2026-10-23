import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitPathToDuration } from '../src/anim/pathGen.js';
import { setPath, addCharacter } from '../src/doc/edit.js';
import { createEmptyDocument } from '../src/doc/schema.js';
import { fakeApp, addProp, closeVec } from './helpers.mjs';
import { Path, WALK_RAMP } from '../src/anim/Path.js';

const points = [[0, 0, 0], [20, 0, 0], [40, 0, 0]];

test('时间轴节点反映真实到达时刻，支持缓入缓出、停顿、闭合回到起点', () => {
  for (const extra of [{}, { stops: [1], stopTimes: [2] }, { closed: true }]) {
    const path = new Path({ points: [[0, 0, 0], [1, 0, 0], [1, 0, 4]], interpolation: 'polyline', start: 3, duration: 8, speed: 'smooth', closed: false, ...extra }, { ramp: WALK_RAMP });
    assert.equal(path.vertexTime(0), 3);
    assert.equal(path.vertexTime(extra.closed ? 3 : 2), 11);
    assert.ok(Math.abs(path.distanceAt(path.vertexTime(1)) - path.vertexDistance(1)) < 1e-7);
    if (extra.stops) assert.ok(Math.abs(path.vertexTime(1) - 5) < 1e-5);
  }
});

test('超时轨迹保留路线与起点时间，停顿按比例缩放；较短轨迹保持原速', () => {
  const path = { points, start: 2, duration: 20, stops: [1], stopTimes: [10], closed: false };
  const fitted = fitPathToDuration(path, 10);
  assert.equal(fitted.start, 2);
  assert.equal(fitted.duration, 8);
  assert.deepEqual(fitted.stopTimes, [4]);
  assert.deepEqual(fitted.points, points);
  assert.equal(path.duration, 20);
  assert.equal(fitPathToDuration(fitted, 15), fitted);
});

test('人物长轨迹适配剩余时间，重画保留时长', () => {
  const doc = createEmptyDocument();
  const ent = addCharacter(doc, { name: '角色', body: 'male' });
  const path = setPath(doc, ent.id, points, { start: 3 }).path;
  assert.equal(path.start + path.duration, 10);
  assert.deepEqual(path.points, points);
  const short = setPath(doc, ent.id, [[0, 0, 0], [1, 0, 0]]).path;
  assert.equal(short.duration, 7);
  const redrawn = setPath(doc, ent.id, points).path;
  assert.equal(redrawn.start + redrawn.duration, 10);
});

test('新增 / 编辑 / 缩短总时长都适配轨迹，结束帧到达完整终点', () => {
  const app = fakeApp(), ent = addProp(app);
  const path = app.timeline.addPath({ target: ent.id, points, start: 2, duration: 20 });
  assert.equal(path.duration, 8);
  const edited = app.timeline.updatePath(path.id, { duration: 30, stops: [1], stopTimes: [15] });
  assert.equal(edited.duration, 8);
  assert.deepEqual(edited.stopTimes, [4]);
  app.timeline.setDuration(1);
  const fitted = app.timeline.paths[0];
  assert.ok(fitted.start < 1);
  assert.equal(fitted.start + fitted.duration, 1);
  assert.deepEqual(fitted.points, points);
  app.timeline.evaluate(1);
  assert.ok(closeVec(ent.transformJSON().pos, points.at(-1)));
  assert.throws(() => app.timeline.updatePath(path.id, { start: 1 }), /开始时间/);
});

test('非UI公共API保留步速估算；显式时长仍优先', () => {
  const doc = createEmptyDocument();
  const ent = addCharacter(doc, { name: '角色', body: 'male' });
  const points = [[0, 0, 0], [2.4, 0, 0]];
  const path = setPath(doc, ent.id, points).path;
  assert.ok(Math.abs(path.duration - 1.7) < 0.01);
  assert.equal(setPath(doc, ent.id, points, { set: { duration: 6 } }).path.duration, 6);
});
