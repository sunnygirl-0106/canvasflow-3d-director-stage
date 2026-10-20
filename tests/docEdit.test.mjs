// 文档纯函数单元测试（阶段 H 第 2 步）：src/doc/edit.js —— 界面入口与 AI 共用的"数据部分"。
// 运行：npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as edit from '../src/doc/edit.js';
import { createEmptyDocument, validate } from '../src/doc/schema.js';
import { POSE_PRESET_MAP } from '../src/entities/posePresets.js';
import { BODY_TYPES } from '../src/config.js';
import { cameraMove } from '../src/anim/cameraMoves.js';

const ok = (doc) => { const r = validate(doc); assert.deepEqual(r.errors, []); };
let seq = 0;
const nextName = () => `角色${String.fromCharCode(65 + seq++)}`;

function camDoc() {
  const doc = createEmptyDocument();
  doc.entities.push({ type: 'camera', id: 'cam00001', name: '机位1', visible: true, transform: { pos: [0, 1.6, 5], rot: [0, 0, 0], scale: [1, 1, 1] }, fov: 40, roll: 0, lookAt: [0, 0.85, 0] });
  return doc;
}

test('posePreset：站立为空、普通预设取非 0 值、T 型 = −neutralOffset、null 不标记预设', () => {
  assert.deepEqual(edit.posePreset('male', 'stand'), { preset: 'stand', values: {} });
  assert.deepEqual(edit.posePreset('male', 'wave').values, POSE_PRESET_MAP.wave.values);
  const t = edit.posePreset('female', 'tpose');
  for (const [k, v] of Object.entries(BODY_TYPES.female.profile.neutralOffset)) if (v) assert.equal(t.values[k], -v);
  assert.deepEqual(edit.posePreset('male', null), { preset: null, values: {} });
});

test('addCharacter：默认落点 = spawnPoint(顶层实体数)、默认颜色、文档合法', () => {
  const doc = createEmptyDocument();
  const a = edit.addCharacter(doc, { name: 'A', body: 'male' });
  const b = edit.addCharacter(doc, { name: 'B', body: 'female', pos: [1, 0, 2], yaw: 90, pose: 'sit', color: '#ff0000' });
  assert.deepEqual(a.transform.pos, edit.spawnPoint(0).map((v) => Math.round(v * 1e6) / 1e6));
  assert.equal(a.color, '#34c759');
  assert.equal(a.pose.preset, null);
  assert.deepEqual(b.transform.rot, [0, 90, 0]);
  assert.equal(b.pose.preset, 'sit');
  ok(doc);
});

test('addCrowd：夹取行列、网格居中、轮换配色、成员紧跟组', () => {
  const doc = createEmptyDocument();
  const r = edit.addCrowd(doc, { rows: 9, cols: 2, spacing: 1, memberName: nextName });
  assert.equal(r.rows, 6);
  assert.equal(r.group.name, '群众 (6x2)');
  assert.equal(r.members.length, 12);
  assert.deepEqual(r.members[0].transform.pos, [-0.5, 0, -2.5]);
  assert.deepEqual(r.members[11].transform.pos, [0.5, 0, 2.5]);
  assert.notEqual(r.members[0].color, r.members[1].color);
  assert.deepEqual(doc.entities.map((e) => e.id), [r.group.id, ...r.group.members]);
  ok(doc);
});

test('groupCharacters：轴心 = 平均位置（或给定 pivot）、成员改相对坐标、删变换动画、移到组后面', () => {
  const doc = createEmptyDocument();
  const a = edit.addCharacter(doc, { name: 'A', body: 'male', pos: [0, 0, 0], yaw: 30 });
  edit.addCharacter(doc, { name: 'X', body: 'male', pos: [5, 0, 5] });
  const b = edit.addCharacter(doc, { name: 'B', body: 'male', pos: [2, 0, 4] });
  edit.setPath(doc, a.id, [[0, 0, 0], [1, 0, 0]]);
  doc.timeline.tracks.push({ id: 'trk00001', target: b.id, property: 'rot', keys: [] });
  assert.equal(edit.groupCharacters(doc, [a.id], { name: 'g' }), null);
  const r = edit.groupCharacters(doc, [a.id, b.id], { name: '组1' });
  assert.deepEqual(r.group.transform.pos, [1, 0, 2]);
  assert.deepEqual(a.transform.pos, [-1, 0, -2]);
  assert.deepEqual(a.transform.rot, [0, 30, 0]);
  assert.equal(a.parent, r.group.id);
  assert.deepEqual(doc.paths, []);
  assert.deepEqual(doc.timeline.tracks, []);
  assert.deepEqual(doc.entities.map((e) => e.name), ['X', '组1', 'A', 'B']);
  ok(doc);
  const doc2 = createEmptyDocument();
  const c = edit.addCharacter(doc2, { name: 'C', body: 'male', pos: [0, 0, 0] });
  const d = edit.addCharacter(doc2, { name: 'D', body: 'male', pos: [2, 0, 0], yaw: 150 });
  const r2 = edit.groupCharacters(doc2, [c.id, d.id], { name: 'g', pivot: [1, -0.03, 0] });
  assert.deepEqual(r2.group.transform.pos, [1, -0.03, 0]);
  assert.deepEqual(c.transform.pos, [-1, 0.03, 0]);
  assert.deepEqual(d.transform.rot, [-180, 30, -180]); // 与 Object3D.attach 一致：经四元数规整欧拉表示
});

test('setPath：新建删 pos 轨道并取默认值；替换保留 start / speed / orient、重算时长；set 覆盖', () => {
  const doc = camDoc();
  const a = edit.addCharacter(doc, { name: 'A', body: 'male', pos: [0, 0, 0] });
  doc.timeline.tracks.push({ id: 'trk00001', target: a.id, property: 'pos', keys: [] });
  const r1 = edit.setPath(doc, a.id, [[0, 0, 0], [2.6, 0, 0]], { start: 1 });
  assert.equal(r1.replaced, false);
  assert.deepEqual(doc.timeline.tracks, []);
  assert.deepEqual([r1.path.start, r1.path.duration, r1.path.speed, r1.path.orient], [1, 2.4, 'smooth', 'tangent']);
  const r2 = edit.setPath(doc, a.id, [[0, 0, 0], [1.3, 0, 0]], { start: 3 });
  assert.equal(r2.replaced, true);
  assert.equal(r2.path.id, r1.path.id);
  assert.deepEqual([r2.path.start, r2.path.duration], [1, 1.6]); // 1.3 m < 1.7×0.8：短路径 = 2·长/步速
  const r3 = edit.setPath(doc, a.id, [[0, 0, 0], [1.3, 0, 0]], { set: { start: 2, orient: 'keep', duration: 4 } });
  assert.deepEqual([r3.path.start, r3.path.duration, r3.path.orient], [2, 4, 'keep']);
  assert.equal(edit.setPath(doc, 'cam00001', [[0, 1.6, 5], [0, 1.6, 3]]).path.orient, 'keep');
  ok(doc);
  assert.equal(edit.removePath(doc, a.id), true);
  assert.equal(edit.removePath(doc, a.id), false);
});

test('applyCameraMove：路径 + 注视；追加接续并合并同主体注视；pan 写 rot 两键；清除', () => {
  const doc = camDoc();
  const aim = [0, 0.85, 0];
  const r1 = edit.applyCameraMove(doc, 'cam00001', { name: 'push_in', subject: [0, 0.85, 0], aim });
  assert.deepEqual(doc.paths[0].points, cameraMove('push_in', { position: [0, 1.6, 5], aim }).points);
  assert.equal(r1.start, 0);
  assert.equal(doc.constraints.length, 1);
  const r2 = edit.applyCameraMove(doc, 'cam00001', { name: 'half_orbit', subject: [0, 0.85, 0], aim });
  assert.equal(r2.start, 3);
  assert.equal(doc.paths.length, 1);
  assert.equal(doc.paths[0].duration, 8);
  assert.equal(doc.constraints.length, 1); // 同主体连续两段合并
  assert.deepEqual(r2.undo.path.duration, 3);
  ok(doc);
  assert.equal(edit.clearCameraMoves(doc, 'cam00001'), true);
  assert.deepEqual([doc.paths, doc.constraints], [[], []]);
  const r3 = edit.applyCameraMove(doc, 'cam00001', { name: 'pan', subject: [3, 0.85, 0], aim: [3, 0.85, 0] });
  assert.equal(doc.timeline.tracks[0].keys.length, 2);
  assert.equal(doc.constraints[0].start, 2); // 摇完才开始注视
  assert.ok(r3.undo.rotEnd);
  ok(doc);
  assert.throws(() => { edit.applyCameraMove(doc, 'cam00001', { name: 'push_in', subject: aim, aim }); edit.applyCameraMove(doc, 'cam00001', { name: 'pan', subject: aim, aim }); }, /摇镜头/);
});

test('nearestSubject / aheadPoint', () => {
  const doc = camDoc();
  assert.equal(edit.nearestSubject(doc, 'cam00001', [0, 1.6, 5], () => null), null);
  assert.deepEqual(edit.aheadPoint(doc.entities[0].transform), [0, 1.6, 2]);
  const a = edit.addCharacter(doc, { name: 'A', body: 'male', pos: [0, 0, 0] });
  const b = edit.addCharacter(doc, { name: 'B', body: 'male', pos: [0, 0, 3] });
  const aims = { [a.id]: [0, 0.9, 0], [b.id]: [0, 0.9, 3] };
  assert.equal(edit.nearestSubject(doc, 'cam00001', [0, 1.6, 5], (id) => aims[id]), b.id);
});
