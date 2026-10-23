// Timeline 单测：编辑 API 的校验与撤销记录、关键帧 / 路径 / 约束求值、idle ↔ active 的手动值保持。node 直接跑。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fakeApp, addProp, addCamera, closeVec, close } from './helpers.mjs';

const posOf = (ent) => ent.transformJSON().pos;

test('idle 时打键不碰实体；每次编辑记一步撤销并发 change', () => {
  const app = fakeApp();
  const box = addProp(app);
  let changes = 0;
  app.timeline.on('change', () => changes++);
  const tr = app.timeline.addTrack({ target: box.id, property: 'pos' });
  app.timeline.setKey(tr.id, 0, [0, 0, 0]);
  app.timeline.setKey(tr.id, 2, [2, 0, 0]);
  assert.equal(changes, 3);
  assert.equal(app.history.scheduled, 3);
  assert.equal(app.timeline.active, false);
  assert.deepEqual(posOf(box), [0, 0, 0]);
});

test('关键帧线性插值；求值无"上一帧"状态（先跳到别处再回来结果相同）', () => {
  const app = fakeApp();
  const box = addProp(app);
  const tr = app.timeline.addTrack({ target: box.id, property: 'pos' });
  app.timeline.setKey(tr.id, 0, [0, 0, 0]);
  app.timeline.setKey(tr.id, 2, [2, 0, 4]);
  app.timeline.evaluate(1);
  assert.ok(closeVec(posOf(box), [1, 0, 2]));
  const once = posOf(box);
  app.timeline.evaluate(1.7);
  app.timeline.evaluate(1);
  assert.deepEqual(posOf(box), once);
  app.timeline.evaluate(5); // 末键之后保持末键
  assert.ok(closeVec(posOf(box), [2, 0, 4]));
});

test('active 期间 baseOf = 手动值；stop() 写回手动值', () => {
  const app = fakeApp();
  const box = addProp(app, 'box', [3, 0, 0]);
  const tr = app.timeline.addTrack({ target: box.id, property: 'pos' });
  app.timeline.setKey(tr.id, 0, [0, 0, 0]);
  app.timeline.setKey(tr.id, 1, [1, 0, 0]);
  app.timeline.evaluate(0.5);
  assert.ok(closeVec(posOf(box), [0.5, 0, 0]));
  assert.deepEqual(box.transformJSON(app.timeline.baseOf(box)).pos, [3, 0, 0]);
  app.timeline.stop();
  assert.equal(app.timeline.active, false);
  assert.equal(app.timeline.baseOf(box), null);
  assert.deepEqual(posOf(box), [3, 0, 0]);
});

test('不合法的编辑抛错且数据不变（与导入同一套校验）', () => {
  const app = fakeApp();
  const box = addProp(app);
  const before = app.timeline.toJSON();
  assert.throws(() => app.timeline.setDuration(-1));
  assert.throws(() => app.timeline.addTrack({ target: 'nope0000', property: 'pos' }));
  assert.throws(() => app.timeline.setKey('nope0000', 0, [0, 0, 0]), /轨道不存在/);
  assert.throws(() => app.timeline.addTrack({ target: box.id, property: 'fov' })); // 道具没有 fov
  assert.deepEqual(app.timeline.toJSON(), before);
  assert.equal(app.history.scheduled, 0);
});

test('路径（匀速）：中点在路径中点，朝向切线', () => {
  const app = fakeApp();
  const box = addProp(app);
  app.timeline.addPath({ target: box.id, points: [[0, 0, 0], [4, 0, 0]], duration: 4, speed: 'linear', orient: 'tangent' });
  app.timeline.evaluate(2);
  assert.ok(closeVec(posOf(box), [2, 0, 0], 1e-4));
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(box.root.quaternion); // 实体前方 = +Z
  assert.ok(closeVec(fwd.toArray(), [1, 0, 0], 1e-4), JSON.stringify(fwd));
});

test('lookAt 约束：机位 −Z 对准道具几何中心；follow：位置 = 锚点 + 偏移', () => {
  const app = fakeApp();
  const box = addProp(app, 'box', [2, 0, 0]);
  const cam = addCamera(app, [0, 1.6, 5]);
  app.timeline.addConstraint({ type: 'lookAt', target: cam.id, subject: box.id });
  app.timeline.evaluate(0);
  box.root.updateMatrixWorld(true);
  const center = new THREE.Box3().setFromObject(box.root).getCenter(new THREE.Vector3());
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.root.quaternion);
  const want = center.clone().sub(cam.root.position).normalize();
  assert.ok(dir.angleTo(want) < 1e-6, `偏差 ${dir.angleTo(want)}`);

  app.timeline.stop();
  const f = app.timeline.addConstraint({ type: 'follow', target: cam.id, subject: box.id, offset: [0, 1, 3] });
  app.timeline.evaluate(0);
  assert.ok(closeVec(posOf(cam), [2, 1, 3], 1e-6));
  app.timeline.removeConstraint(f.id);
});

test('toJSON 深拷贝可随意改；view() 是同一份数据的只读引用；fromJSON 整体替换', () => {
  const app = fakeApp();
  const box = addProp(app);
  const tr = app.timeline.addTrack({ target: box.id, property: 'pos' });
  app.timeline.setKey(tr.id, 0, [0, 0, 0]);
  const j = app.timeline.toJSON();
  j.timeline.tracks[0].keys.push({ t: 9, value: [9, 9, 9], ease: 'linear' });
  assert.equal(app.timeline.view().timeline.tracks[0].keys.length, 1);
  assert.equal(app.timeline.view().timeline.tracks, app.timeline.tracks);
  const doc = app.exportDocument();
  Object.assign(doc, { timeline: { ...j.timeline, duration: 12 }, paths: j.paths, constraints: j.constraints });
  app.timeline.fromJSON(doc);
  assert.equal(app.timeline.duration, 12);
  assert.equal(app.timeline.tracks[0].keys.length, 2);
});

test('pruneEntities：删实体时清掉引用它的轨道 / 路径 / 约束', () => {
  const app = fakeApp();
  const box = addProp(app);
  const cam = addCamera(app);
  app.timeline.addTrack({ target: box.id, property: 'scale' }); // pos 轨道与路径不能共存
  app.timeline.addPath({ target: box.id, points: [[0, 0, 0], [1, 0, 0]] });
  app.timeline.addConstraint({ type: 'lookAt', target: cam.id, subject: box.id });
  app.timeline.pruneEntities([box.id]);
  const v = app.timeline.view();
  assert.equal(v.timeline.tracks.length + v.paths.length + v.constraints.length, 0);
  assert.ok(close(app.timeline.duration, 10));
});

test('局部三维路径候选复用模型求值，不改变 Store、时长、停顿或其它驱动', () => {
  const app = fakeApp(), box = addProp(app), other = addProp(app);
  const p = app.timeline.addPath({ target: box.id, points: [[0,0,0],[1,0,0],[4,0,0]], start: 1, duration: 6, speed: 'linear', orient: 'keep', interpolation: 'polyline' });
  const tr = app.timeline.addTrack({ target: other.id, property: 'pos' });
  app.timeline.setKey(tr.id, 0, [0,0,0]); app.timeline.setKey(tr.id, 6, [6,0,0]);
  app.timeline.updatePath(p.id, { stops:[1], stopTimes:[2] });
  const source = app.timeline.paths.find(j => j.id === p.id), doc = app.store.document, revision = app.store.revision;
  const candidate = { ...source, points: [[0,0,0],[1,2,0],[4,0,0]] };
  const model = app.timeline.pathModel(candidate), t = model.vertexTime(1);
  assert.equal(app.timeline.pathModel(candidate), model);
  app.timeline.evaluate(t, { kind: 'path', source: candidate });
  assert.ok(closeVec(posOf(box), [1,2,0]));
  assert.ok(close(posOf(other)[0], t));
  assert.equal(app.store.document, doc); assert.equal(app.store.revision, revision);
  assert.equal(candidate.duration, source.duration);
  assert.ok(close(t, app.timeline.pathModel(source).vertexTime(1)));
  assert.deepEqual(candidate.stopTimes, [2]);
  app.timeline.evaluate(t);
  assert.equal(posOf(box)[1], 0);
});

test('位置键候选遵循 Channel 的 linear/smooth/step，撤销预览恢复原值', () => {
  for (const ease of ['linear', 'smooth', 'step']) {
    const app = fakeApp(), box = addProp(app);
    const tr = app.timeline.addTrack({ target: box.id, property: 'pos' });
    app.timeline.setKey(tr.id, 0, [0,0,0], ease); app.timeline.setKey(tr.id, 4, [4,2,8]);
    const source = app.timeline.tracks[0], doc = app.store.document;
    const candidate = { ...source, keys: source.keys.map((k,i) => i ? { ...k, value: [8,4,12] } : k) };
    for (const t of [0, .25, 1, 2.5, 4]) {
      app.timeline.evaluate(t, { kind: 'pos', source: candidate });
      assert.ok(closeVec(posOf(box), app.timeline.positionChannel(candidate).evaluate(t)));
    }
    assert.equal(app.store.document, doc);
    assert.deepEqual(candidate.keys.map(k => [k.t,k.ease]), source.keys.map(k => [k.t,k.ease]));
    app.timeline.evaluate(4); assert.deepEqual(posOf(box), [4,2,8]);
  }
});
