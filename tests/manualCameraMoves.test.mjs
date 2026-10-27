import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyDocument, validate } from '../src/doc/schema.js';
import { applyCameraMove } from '../src/doc/edit.js';
import { cameraMove, defaultParams, PANEL_DURATION } from '../src/anim/cameraMoves.js';
import { cameraMotionState, motionSignature } from '../src/doc/cameraMotionState.js';
import { DocumentStore } from '../src/doc/Store.js';
const position = [0, 1.6, 5], aim = [0, .85, 0];
function fixture() {
  const d = createEmptyDocument();
  d.entities.push({ type: 'camera', id: 'camera01', name: '机位', visible: true, transform: { pos: position, rot: [0, 0, 12], scale: [1, 1, 1] }, fov: 45, roll: 12, lookAt: aim });
  d.timeline.tracks.push({ id: 'fovtrack', target: 'camera01', property: 'fov', keys: [{ t: 0, value: 45, ease: 'linear' }, { t: 4, value: 50, ease: 'linear' }] });
  return d;
}
test('replace uses stable origin, preserves FOV, append requires explicit mode in manual flow', () => {
  const d = fixture(), fov = structuredClone(d.timeline.tracks[0]);
  const origin = { position, rot: [0, 0, 12], roll: 12, time: 0 };
  for (const amount of [1, 2, 3]) {
    applyCameraMove(d, 'camera01', { name: 'push_in', subject: aim, aim, params: { duration: 4, amount }, mode: 'replace', origin });
    assert.deepEqual(d.paths[0].points[0], position);
    assert.equal(d.paths[0].points.at(-1)[2], 5 - amount);
    assert.equal(d.paths.length, 1); assert.deepEqual(d.timeline.tracks[0], fov);
  }
  applyCameraMove(d, 'camera01', { name: 'crane', subject: aim, aim, params: { duration: 4, amount: 1 }, mode: 'append' });
  assert.equal(d.paths[0].duration, 8);
  assert.deepEqual(d.paths[0].points.at(-1), [0, 2.6, 2]);
  assert.deepEqual(validate(d).errors, []);
});
test('invalid replacement is atomic; serialized identity survives reload and invalidates after node edit', () => {
  const d = fixture(), origin = { position, rot: [0, 0, 12], roll: 12, time: 0 }, params = { duration: 6, sweep: 180, dir: 'ccw' };
  applyCameraMove(d, 'camera01', { name: 'half_orbit', subject: aim, aim, params, mode: 'replace', origin });
  d.meta.cameraMoves = { camera01: { signature: motionSignature(d, 'camera01'), segments: [{ name: 'half_orbit', subject: aim, aim, params, origin }] } };
  assert.deepEqual(validate(d).errors, []);
  const store = new DocumentStore(JSON.parse(JSON.stringify(d))), before = store.document;
  assert.ok(cameraMotionState(before, 'camera01'));
  assert.throws(() => store.transact('bad', draft => applyCameraMove(draft, 'camera01', { name: 'push_in', subject: aim, aim, params: { amount: 100 }, mode: 'replace', origin })));
  assert.equal(store.document, before);
  store.transact('node', draft => { draft.paths[0].points[0][0] += .5; });
  assert.equal(cameraMotionState(store.document, 'camera01'), null);
});
test('spiral rises continuously, maintains radius, retains real height and is open', () => {
  const m = cameraMove('spiral', { position, aim, params: { rise: 2, duration: 12 } });
  assert.equal(m.closed, false); assert.deepEqual(m.points[0], position);
  assert.deepEqual(m.points.at(-1), [0, 3.6, 5]);
  m.points.forEach((p, i) => { assert.ok(Math.abs(Math.hypot(p[0], p[2]) - 5) < 1e-5); if (i) assert.ok(p[1] > m.points[i - 1][1]); });
  assert.equal(defaultParams('circle', { position, aim }).duration, 8);
  assert.equal(PANEL_DURATION.circle, 2);
});

test('displacement replacement preserves user rotation and FOV keys; own pan can be replaced', () => {
  const d = fixture(), origin = { position, rot: [0, 0, 12], roll: 12, time: 0 };
  const rotation = { id: 'userrot1', target: 'camera01', property: 'rot', keys: [{ t: 0, value: [0, 10, 12], ease: 'smooth' }] };
  d.timeline.tracks.push(rotation);
  applyCameraMove(d, 'camera01', { name: 'truck', subject: aim, aim, mode: 'replace', origin });
  assert.deepEqual(d.timeline.tracks.find(t => t.property === 'rot'), rotation);
  applyCameraMove(d, 'camera01', { name: 'pan', subject: aim, aim, mode: 'replace', origin });
  assert.equal(d.paths.length, 0);
  assert.equal(d.timeline.tracks.find(t => t.property === 'rot').keys.length, 2);
  applyCameraMove(d, 'camera01', { name: 'circle', subject: aim, aim, mode: 'replace', origin, ownPan: true });
  assert.equal(d.timeline.tracks.some(t => t.property === 'rot'), false);
  assert.equal(d.timeline.tracks.filter(t => t.property === 'fov').length, 1);
  assert.equal(d.entities[0].roll, 12);
  assert.deepEqual(validate(d).errors, []);
});

test('constraint edits preserve valid preset context, but never rescue edited geometry', async () => {
  const { editCameraConstraints } = await import('../src/doc/cameraMotionState.js');
  const d = fixture(), origin = { position, rot: [0, 0, 12], roll: 12, time: 0 }, params = { duration: 6, sweep: 90, dir: 'ccw' };
  applyCameraMove(d, 'camera01', { name: 'half_orbit', subject: aim, aim, params, origin, mode: 'replace' });
  const segment = { name: 'half_orbit', subject: aim, aim, params, origin };
  d.meta.cameraMoves = { camera01: { signature: motionSignature(d, 'camera01'), segments: [structuredClone(segment)] } };
  const path = structuredClone(d.paths);
  editCameraConstraints(d, () => { d.constraints[0].subject = [3, 1, 2]; });
  assert.deepEqual(d.paths, path);
  assert.deepEqual(cameraMotionState(d, 'camera01').segments[0], segment);
  assert.ok(cameraMotionState(JSON.parse(JSON.stringify(d)), 'camera01'));
  d.paths[0].points[1][0] += 1;
  editCameraConstraints(d, () => { d.constraints = []; });
  assert.equal(cameraMotionState(d, 'camera01'), null);
});

test('manual replace, append and clear preserve independent constraints; absent look defaults to the preset subject', async () => {
  const { clearCameraMoves } = await import('../src/doc/edit.js');
  const d = fixture();
  d.constraints.push({ id: 'look0001', target: 'camera01', type: 'lookAt', subject: aim, offset: [0, 0, 0], start: 2, end: 4 });
  const constraints = structuredClone(d.constraints);
  for (const mode of ['replace', 'append']) {
    applyCameraMove(d, 'camera01', { name: 'crane', subject: aim, aim, params: { amount: .3, duration: 2 }, mode, preserveConstraints: true });
    assert.deepEqual(d.constraints, constraints);
  }
  clearCameraMoves(d, 'camera01', { preserveConstraints: true });
  assert.deepEqual(d.constraints, constraints);
  d.constraints = [];
  applyCameraMove(d, 'camera01', { name: 'crane', subject: aim, aim, preserveConstraints: true });
  assert.equal(d.constraints.length, 1);
  assert.equal(d.constraints[0].type, 'lookAt');
  assert.deepEqual(d.constraints[0].subject, aim);
});

test('camera position-key prefix may precede a path, but overlapping or disconnected motion is rejected atomically', () => {
  const d = fixture();
  d.timeline.tracks.push({ id: 'posprefix', target: 'camera01', property: 'pos', keys: [
    { t: 0, value: [0, 1.6, 6], ease: 'smooth' }, { t: 3, value: position, ease: 'linear' },
  ] });
  const prefix = structuredClone(d.timeline.tracks);
  applyCameraMove(d, 'camera01', { name: 'truck', subject: aim, aim, mode: 'append', preservePositionKeys: true, preserveConstraints: true,
    origin: { position, rot: [0, 0, 12], roll: 12, time: 3 } });
  assert.deepEqual(d.timeline.tracks, prefix);
  assert.deepEqual(validate(d).errors, []);
  const store = new DocumentStore(d), before = store.document;
  assert.throws(() => store.transact('overlap', draft => { draft.paths[0].start = 2; }));
  assert.equal(store.document, before);
  assert.throws(() => store.transact('jump', draft => { draft.paths[0].points[0][0] += 1; }));
  assert.equal(store.document, before);
});
