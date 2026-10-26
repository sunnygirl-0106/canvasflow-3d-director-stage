import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresetScene, SCENE_PRESETS } from '../src/ai/presets.js';
import { validate } from '../src/doc/schema.js';
import { Path, pathOptionsFor } from '../src/anim/Path.js';

const at = (doc, name) => {
  const ent = doc.entities.find(e => e.name === `角色${name}`);
  const json = doc.paths.find(p => p.target === ent.id);
  return new Path(json, pathOptionsFor('character'));
};
const xz = (path, t) => {
  const p = path.positionAt(path.distanceAt(t));
  return [p.x, p.z];
};
const close = (a, b, tolerance = 0.04) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance, `${a} ≠ ${b}`);

test('八个模板都有固定时长、主机位、独立身份颜色和合法动画', () => {
  assert.equal(SCENE_PRESETS.length, 8);
  for (let i = 0; i < 8; i++) {
    const doc = createPresetScene(i);
    assert.deepEqual(validate(doc), { ok: true, errors: [] });
    assert.equal(doc.timeline.mainCameraId, doc.scene.activeCameraId);
    assert.equal(doc.meta.name, SCENE_PRESETS[i].title);
    const chars = doc.entities.filter(e => e.type === 'character');
    assert.equal(new Set(chars.map(e => e.trailColor)).size, chars.length);
    assert.deepEqual(chars.map(e => e.name), chars.map((_, n) => `角色${String.fromCharCode(65 + n)}`));
    assert.equal(doc.timeline.tracks.filter(t => t.property === 'pos' && chars.some(c => c.id === t.target)).length, 0);
  }
});

test('欲言又止：A 停顿后再靠近，B 延迟后退且停步结束步态', () => {
  const doc = createPresetScene(0), a = at(doc, 'A'), b = at(doc, 'B');
  close(xz(a, 3.1), xz(a, 4.4));
  close(xz(a, 8), [-0.2, 0.8]);
  close(xz(b, 5.9), [0.9, -0.2]);
  close(xz(b, 8), [1.1, -0.5]);
  assert.equal(a.speedAt(3.8), 0);
  assert.equal(b.speedAt(5.9), 0);
});

test('告别有两段离开和中间驻足；群像按指定时刻陆续抵达', () => {
  const farewell = createPresetScene(1), b = at(farewell, 'B');
  close(xz(b, 6.5), [2.8, 0.8]);
  assert.equal(b.speedAt(7), 0);
  close(xz(b, 12), [4, -0.8]);
  const group = createPresetScene(7);
  for (const [name, time, end] of [
    ['A', 6, [0, 1.2]], ['B', 6.5, [-1.4, 0.4]], ['C', 7, [1.4, 0.2]],
    ['D', 7.2, [-2.7, -0.8]], ['E', 7.8, [2.7, -0.9]], ['F', 8, [0.5, -1.5]],
  ]) close(xz(at(group, name), time), end);
});

test('主机位按节点时刻经过中间点，经过时仍有连续速度', () => {
  const doc = createPresetScene(2);
  const cam = doc.entities.find(e => e.type === 'camera');
  const path = new Path(doc.paths.find(p => p.target === cam.id));
  close(xz(path, 5), [5, 6], 0.04);
  assert.ok(path.speedAt(5 - 0.001) > 0);
  assert.ok(Math.abs(path.speedAt(5 - 0.001) - path.speedAt(5 + 0.001)) < 0.02);
});
