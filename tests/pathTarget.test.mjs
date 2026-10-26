import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathTarget, hasDisplacement } from '../src/core/pathTarget.js';

const doc = () => ({ entities: ['c1', 'c2', 'c3', 'hero', 'prop', 'group'].map(id => ({ id, type: id[0] === 'c' ? 'camera' : id === 'hero' ? 'character' : id, visible: true })), paths: [{ target: 'c3', points: [[0, 0, 0], [0, 2, 0]] }], timeline: { mainCameraId: 'c1', tracks: [] }, scene: { activeCameraId: 'c2' } });
test('director target priority, including camera with no displacement', () => {
  const d = doc();
  assert.equal(pathTarget(d), 'c1');
  assert.equal(pathTarget(d, { selectedId: 'c2' }), 'c2');
  d.timeline.mainCameraId = null; assert.equal(pathTarget(d), 'c2');
  d.scene.activeCameraId = null; assert.equal(pathTarget(d), 'c3');
  d.entities[2].visible = false; assert.equal(pathTarget(d), 'c1');
});
test('only explicit character selection overrides camera; props require edit intent', () => {
  const d = doc();
  assert.equal(pathTarget(d, { selectedId: 'hero' }), 'c1');
  assert.equal(pathTarget(d, { selectedId: 'hero', userSelectedId: 'hero' }), 'hero');
  assert.equal(pathTarget(d, { selectedId: 'prop', userSelectedId: 'prop' }), 'c1');
  assert.equal(pathTarget(d, { selectedId: 'prop', editingTarget: 'prop' }), 'prop');
  d.entities.find(e => e.id === 'hero').visible = false;
  assert.equal(pathTarget(d, { selectedId: 'hero', userSelectedId: 'hero' }), 'c1');
});
test('stationary position keys do not fabricate motion; vertical routes are displacement', () => {
  assert.equal(hasDisplacement({ keys: [{ value: [1, 2, 3] }, { value: [1, 2, 3] }] }), false);
  assert.equal(hasDisplacement({ points: [[1, 0, 3], [1, 2, 3]] }), true);
});
