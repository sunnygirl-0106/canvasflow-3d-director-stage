import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeApp, addProp, addCamera, closeVec, animatedPropFixture } from './helpers.mjs';
import { Path, WALK_RAMP } from '../src/anim/Path.js';
import { setPath, addCharacter, addCrowd } from '../src/doc/edit.js';
import { createEmptyDocument } from '../src/doc/schema.js';
import { fitPathToDuration } from '../src/anim/pathGen.js';


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

for (const [type, speed, initialDuration, redrawnDuration] of [
  ['character', 'linear', 2.1, 2.1],
  ['group', 'linear', 2.1, 2.1],
  ['camera', 'smooth', 2.5, 5],
  ['prop', 'smooth', 2.9, 5.4],
]) {
  test(`setPath ${type}：新建与重画的时长、速度及显式覆盖优先级`, () => {
    const doc = createEmptyDocument();
    let ent;
    if (type === 'character') ent = addCharacter(doc, { name: '角色', body: 'male' });
    else if (type === 'group') ent = addCrowd(doc, { rows: 1, cols: 1, memberName: () => '成员' }).group;
    else {
      ent = (type === 'camera' ? addCamera(fakeApp()) : addProp(fakeApp())).toJSON();
      doc.entities.push(ent);
    }

    const first = setPath(doc, ent.id, [[0, 0, 0], [3, 0, 0]], { start: 1 }).path;
    assert.deepEqual([first.speed, first.duration], [speed, initialDuration]);
    const longer = [[0, 0, 0], [6, 0, 0]];
    const redrawn = setPath(doc, ent.id, longer, { start: 2 }).path;
    assert.deepEqual([redrawn.id, redrawn.start, redrawn.duration], [first.id, 1, redrawnDuration]);

    const override = setPath(doc, ent.id, longer, { set: { start: 2, duration: 6, speed: 'smooth' } }).path;
    assert.deepEqual([override.start, override.duration, override.speed], [2, 6, speed]);
    const linear = setPath(doc, ent.id, longer, { set: { speed: 'linear' } }).path;
    assert.deepEqual([linear.speed, linear.duration], ['linear', type === 'character' || type === 'group' ? 6 : 5]);
  });
}


test('20% faster defaults only affect new character paths; saved timing and camera pace remain unchanged', () => {
  const doc=createEmptyDocument(); doc.timeline.duration=100;
  const actor=addCharacter(doc,{name:'角色A',body:'male'});
  const path=setPath(doc,actor.id,[[0,0,0],[72,0,0]]).path;
  assert.equal(path.duration,50); // 原 1.2 m/s 需要60秒。
  setPath(doc,actor.id,[[0,0,0],[36,0,0]]);
  assert.equal(doc.paths[0].duration,50);
  const {app,ent}=animatedPropFixture();
  const propDoc=structuredClone(app.store.document); propDoc.timeline.duration=100;
  assert.equal(setPath(propDoc,ent.id,[[0,0,0],[12,0,0]],{set:{speed:'linear'}}).path.duration,10);
});
