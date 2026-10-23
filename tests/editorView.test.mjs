import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEmptyDocument, validate } from '../src/doc/schema.js';
import { CameraRig } from '../src/core/CameraRig.js';

test('editorView fov is optional for old documents and rejects invalid projections', () => {
  const doc = createEmptyDocument();
  doc.meta.editorView = { pos: [0, 2.2, 10], target: [0, -.71, 0] };
  assert.equal(validate(doc).ok, true);
  doc.meta.editorView.fov = 50;
  assert.equal(validate(doc).ok, true);
  for (const value of [0, -1, 180, Infinity, NaN, '50', null]) {
    doc.meta.editorView.fov = value;
    assert.equal(validate(doc).ok, false, String(value));
  }
});

test('director home restores projection as well as position and target', () => {
  const rig = Object.create(CameraRig.prototype);
  rig.camera = new THREE.PerspectiveCamera(50, 1.6, .05, 1000);
  rig.camera.position.set(0, 2.2, 10);
  rig.controls = { target: new THREE.Vector3(0, -.71, 0), enableDamping: true, update() {} };
  rig._home = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 40 };
  rig.saveHome();
  rig.camera.fov = 80; rig.camera.position.set(4, 5, 6); rig.controls.target.set(1, 2, 3);
  rig.resetView();
  assert.equal(rig.camera.fov, 50);
  assert.deepEqual(rig.camera.position.toArray(), [0, 2.2, 10]);
  assert.deepEqual(rig.controls.target.toArray(), [0, -.71, 0]);
  assert.equal(rig.controls.enableDamping, true);
  assert.ok(Math.abs(rig.camera.projectionMatrix.elements[5] - 1 / Math.tan(25 * Math.PI / 180)) < 1e-12);
});
