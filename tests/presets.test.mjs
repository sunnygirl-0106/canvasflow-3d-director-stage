import test from 'node:test';
import assert from 'node:assert/strict';
import { Path, pathOptionsFor } from '../src/anim/Path.js';
import { validate } from '../src/doc/schema.js';
import { createPresetScene, SCENE_PRESETS } from '../src/ai/presets.js';


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
  const json = path.json, i = json.waypointTimes.indexOf(5);
  assert.ok(i > 0);
  close(xz(path, 5), [json.points[i][0], json.points[i][2]], 1e-6);
  assert.ok(path.speedAt(5 - 0.001) > 0);
  assert.ok(Math.abs(path.speedAt(5 - 0.001) - path.speedAt(5 + 0.001)) < 0.02);
});


test('all camera phase boundaries hold or move continuously; append preserves every prefix sample', async () => {
  const { appendMove, cameraMove } = await import('../src/anim/cameraMoves.js');
  const holds = [[[0, 4.5], [10.5, 12]], [[0, 2], [6, 8], [12, 14]], [[10, 12]], [[5.5, 6.5], [11, 12]], [[0, 2], [8, 10]], [[10.5, 12]], [[0, 3], [11, 14]], [[10, 12]]];
  for (let i = 0; i < 8; i++) {
    const d = createPresetScene(i), cam = d.entities.find(e => e.type === 'camera');
    const json = d.paths.find(p => p.target === cam.id), path = new Path(json);
    for (const [a, b] of holds[i]) {
      assert.ok(path.positionAt(path.distanceAt(a)).distanceTo(path.positionAt(path.distanceAt(b))) < 1e-6, `scene ${i} hold ${a}-${b}`);
      assert.equal(path.speedAt((a + b) / 2), 0);
    }
    for (const t of json.waypointTimes) {
      assert.ok(path.positionAt(path.distanceAt(t - .001)).distanceTo(path.positionAt(path.distanceAt(t + .001))) < .02);
      assert.ok(Math.abs(path.speedAt(t - .00001) - path.speedAt(t + .00001)) < .01);
    }
    const next = appendMove(json, cameraMove('crane', { position: json.points.at(-1), aim: [0, 1, 0], params: { duration: 2, amount: .4 } }));
    d.paths = d.paths.map(p => p.id === json.id ? next : p); d.timeline.duration += 2;
    assert.deepEqual(validate(d).errors, []);
    const appended = new Path(next);
    for (let t = 0; t <= json.duration; t += .05) assert.ok(path.positionAt(path.distanceAt(t)).distanceTo(appended.positionAt(appended.distanceAt(t))) < 1e-7, `scene ${i} prefix ${t}`);
    assert.equal(d.meta.cameraMoves, undefined);
  }
});

test('timed custom prefix retains holds and times when appending', async () => {
  const { appendMove, cameraMove } = await import('../src/anim/cameraMoves.js');
  const json = { points: [[0, 1, 5], [1, 1, 5], [2, 1, 5]], start: 1, duration: 8, closed: false, speed: 'smooth', orient: 'keep', timedSegments: [{ from: 0, to: 1, start: 0, end: 2 }, { from: 1, to: 2, start: 4, end: 6 }] };
  const path = new Path(json), next = new Path(appendMove(json, cameraMove('crane', { position: json.points.at(-1), aim: [0, 1, 0] })));
  for (let t = 0; t <= 9; t += .05) assert.ok(path.positionAt(path.distanceAt(t)).distanceTo(next.positionAt(next.distanceAt(t))) < 1e-8);
});


test('fallback fixture contains two separate 10-second paths starting at the actors', async () => {
  const { readFile } = await import('node:fs/promises');
  const d = JSON.parse(await readFile(new URL('./fixtures/round4-default.json', import.meta.url), 'utf8'));
  assert.equal(validate(d).ok, true);
  assert.equal(d.entities.length,3); assert.equal(d.paths.length,2);
  assert.equal(d.timeline.duration,10); assert.equal(d.timeline.fps,30);
  for (const p of d.paths) {
    const e=d.entities.find(e=>e.id===p.target);
    assert.deepEqual(p.points[0],e.transform.pos);
    assert.deepEqual(p.points[1],[e.transform.pos[0],0,-.8]);
    assert.equal(p.duration,10);
  }
});
