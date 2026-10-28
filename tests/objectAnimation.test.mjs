import test from 'node:test';
import assert from 'node:assert/strict';
import { objectAnimationRange, retimeObjectAnimation } from '../src/anim/objectAnimation.js';
import { createPresetScene } from '../src/ai/presets.js';
import { validate } from '../src/doc/schema.js';
import { newId } from '../src/doc/edit.js';
import { DocumentStore } from '../src/doc/Store.js';
import { Path, pathOptionsFor } from '../src/anim/Path.js';
import { Channel } from '../src/anim/Channel.js';

const fixture = () => {
  const doc = createPresetScene(4), id = doc.entities.find(e => e.type === 'character').id;
  return { doc, id, path: doc.paths.find(p => p.target === id), rot: doc.timeline.tracks.find(t => t.target === id && t.property === 'rot') };
};

test('大量关键帧的范围计算不受函数参数数量上限影响', () => {
  const doc = { paths: [], timeline: { tracks: ['pos', 'rot', 'scale'].map(property => ({
    target: 'object', property, keys: Array.from({ length: 50000 }, (_, i) => ({ t: i / 10000 })),
  })) } };
  assert.deepEqual(objectAnimationRange(doc, 'object'), { start: 0, end: 4.9999 });
});

test('范围忽略非有限键时刻、FOV 与其他对象；不改变输入', () => {
  const keys = Object.freeze([NaN, Infinity, -Infinity, 3, 1].map(t => Object.freeze({ t })));
  const doc = { paths: [], timeline: { tracks: [
    { target: 'object', property: 'pos', keys },
    { target: 'object', property: 'fov', keys: [{ t: 10 }] },
    { target: 'other', property: 'rot', keys: [{ t: 9 }] },
  ] } };
  assert.deepEqual(objectAnimationRange(doc, 'object'), { start: 1, end: 3 });
  doc.timeline.tracks[0].keys = keys.slice(0, 3);
  assert.equal(objectAnimationRange(doc, 'object'), null);
});
test('越过门槛：对象 0–6，路径 0–5，末秒原地转身', () => {
  const { doc, id, path, rot } = fixture();
  assert.deepEqual(objectAnimationRange(doc, id), { start: 0, end: 6 });
  assert.equal(path.start + path.duration, 5);
  const model = new Path(path, pathOptionsFor('character'));
  assert.deepEqual(model.positionAt(model.distanceAt(5)).toArray(), model.positionAt(model.distanceAt(6)).toArray());
  const ch = new Channel(rot.keys, 'quat');
  assert.ok(ch.evaluate(5).angleTo(ch.evaluate(6)) > .1);
});
test('范围取绝对起止、所有变换子轨道；空动画和单点不制造时长', () => {
  const { doc, id, path, rot } = fixture();
  const scale = { id: newId(doc), target: id, property: 'scale', keys: [{ t: 8, value: [1, 1, 1], ease: 'linear' }] };
  doc.timeline.tracks.push(scale);
  assert.deepEqual(objectAnimationRange(doc, id), { start: 0, end: 8 });
  scale.keys = []; path.start = 3; path.duration = 5; rot.keys = rot.keys.filter(k => k.t >= 1); rot.keys[0].t = 1;
  assert.deepEqual(objectAnimationRange(doc, id), { start: 1, end: 8 });
  doc.paths = doc.paths.filter(p => p.target !== id);
  assert.deepEqual(objectAnimationRange(doc, id), { start: 1, end: 6 });
  rot.keys.at(-1).t = 9;
  assert.equal(objectAnimationRange(doc, id).end, 9);
  rot.keys.pop(); assert.equal(objectAnimationRange(doc, id).end, rot.keys.at(-1).t);
  rot.keys = [{ ...rot.keys[0], t: 2 }];
  assert.deepEqual(objectAnimationRange(doc, id), { start: 2, end: 2 });
  retimeObjectAnimation(doc, id, 4, 4); assert.equal(rot.keys[0].t, 2);
  assert.deepEqual(objectAnimationRange(doc, id), { start: 4, end: 4 });
  assert.throws(() => retimeObjectAnimation(doc, id, 4, 5));
  doc.timeline.tracks = []; assert.equal(objectAnimationRange(doc, id), null);
});
test('整体平移、左右缩放只调整目标时间；关键帧值/缓动/路径形状和其他对象不变', () => {
  for (const [start, end, pathStart, pathDuration] of [[2, 8, 2, 5], [0, 12, 0, 10], [3, 6, 3, 2.5]]) {
    const { doc, id, path, rot } = fixture(); doc.timeline.duration = 14;
    const other = JSON.stringify({ paths: doc.paths.filter(p => p.target !== id), tracks: doc.timeline.tracks.filter(t => t.target !== id), entities: doc.entities });
    retimeObjectAnimation(doc, id, start, end);
    const nextPath = doc.paths.find(p => p.target === id), nextRot = doc.timeline.tracks.find(t => t.id === rot.id);
    assert.equal(nextPath.start, pathStart); assert.equal(nextPath.duration, pathDuration);
    assert.equal(nextRot.keys.at(-1).t, end);
    assert.deepEqual(nextPath.points, path.points);
    assert.deepEqual(nextRot.keys.map(({ value, ease }) => ({ value, ease })), rot.keys.map(({ value, ease }) => ({ value, ease })));
    assert.equal(other, JSON.stringify({ paths: doc.paths.filter(p => p.target !== id), tracks: doc.timeline.tracks.filter(t => t.target !== id), entities: doc.entities }));
    assert.deepEqual(validate(doc), { ok: true, errors: [] });
    assert.deepEqual(objectAnimationRange(JSON.parse(JSON.stringify(doc)), id), { start, end });
  }
});
test('路径 stopTimes / waypointTimes / timedSegments 只缩放一次，平移保持相对时间', () => {
  for (const timing of [{ stops: [1], stopTimes: [2] }, { waypointTimes: [0, 2, 5] }, { timedSegments: [{ from: 0, to: 1, start: 0, end: 2 }, { from: 1, to: 2, start: 3, end: 5 }] }]) {
    const { doc, id, path } = fixture(); doc.timeline.duration = 20;
    delete path.timedSegments; delete path.waypointTimes;
    path.points = [[0, 0, 0], [1, 0, 0], [2, 0, 1]]; Object.assign(path, timing);
    retimeObjectAnimation(doc, id, 2, 14);
    const next = doc.paths.find(p => p.target === id);
    assert.equal(next.start, 2); assert.equal(next.duration, 10);
    if (timing.stopTimes) assert.deepEqual(next.stopTimes, [4]);
    if (timing.waypointTimes) assert.deepEqual(next.waypointTimes, [0, 4, 10]);
    if (timing.timedSegments) assert.deepEqual(next.timedSegments.map(s => [s.start, s.end]), [[0, 4], [6, 10]]);
    assert.deepEqual(validate(doc), { ok: true, errors: [] });
  }
});
test('边界和精度不足拒绝整个事务；不会覆盖或丢失关键帧/停顿', () => {
  const { doc, id, rot } = fixture();
  rot.keys = [{ t: 0, value: [0, 0, 0], ease: 'linear' }, { t: .000001, value: [0, 1, 0], ease: 'smooth' }, { t: 6, value: [0, 90, 0], ease: 'step' }];
  const store = new DocumentStore(doc), before = store.document;
  for (const [s, e] of [[-1, 5], [0, 11], [0, .01], [0, 1]]) {
    assert.throws(() => store.transact('缩放', d => retimeObjectAnimation(d, id, s, e)));
    assert.equal(store.document, before);
  }
  store.transact('平移', d => retimeObjectAnimation(d, id, 2, 8));
  assert.equal(store.document.timeline.tracks.find(t => t.id === rot.id).keys.length, 3);
});

test('位置键也参与总范围和变换；群组只变换自身，不动成员', () => {
  const { doc, id, rot } = fixture();
  doc.paths = []; doc.timeline.tracks = [rot];
  const pos = { id: newId(doc), target: id, property: 'pos', keys: [{ t: 9, value: [2, 0, 0], ease: 'linear' }] };
  doc.timeline.tracks.push(pos);
  assert.equal(objectAnimationRange(doc, id).end, 9);
  retimeObjectAnimation(doc, id, 1, 10);
  assert.equal(doc.timeline.tracks.find(t => t.id === pos.id).keys[0].t, 10);
  const own = { id: newId(doc), target: 'group001', property: 'scale', keys: [{ t: 2, value: [1, 1, 1], ease: 'linear' }] };
  doc.timeline.tracks.push(own);
  const children = JSON.stringify(doc.timeline.tracks.filter(t => t.target === id));
  assert.deepEqual(objectAnimationRange(doc, 'group001'), { start: 2, end: 2 });
  retimeObjectAnimation(doc, 'group001', 4, 4);
  assert.equal(JSON.stringify(doc.timeline.tracks.filter(t => t.target === id)), children);
});
