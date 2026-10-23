import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fitBounds, startupFraming } from '../src/core/framing.js';
import { addCharacter } from '../src/doc/edit.js';
import { createEmptyDocument } from '../src/doc/schema.js';

test('fitBounds keeps every corner within the requested screen fraction at wide and narrow aspects', () => {
  for (const aspect of [0.8, 1.2, 1.67, 2.2]) for (const width of [0.7, 5.5, 12]) {
    const box = new THREE.Box3(new THREE.Vector3(-width / 2, 0, -2), new THREE.Vector3(width / 2, 2, 2));
    const fit = fitBounds(box, { fov: 48, aspect, occupancy: 0.72 });
    const cam = new THREE.PerspectiveCamera(48, aspect, 0.01, 1000);
    cam.position.copy(fit.position); cam.lookAt(fit.target); cam.updateMatrixWorld();
    for (const x of [box.min.x, box.max.x]) for (const y of [0, 2]) for (const z of [-2, 2]) {
      const p = new THREE.Vector3(x, y, z).project(cam);
      assert.ok(Math.abs(p.x) <= 0.720001 && Math.abs(p.y) <= 0.720001 && p.z < 1);
    }
  }
});
test('new character defaults follow body type and preserve explicit colors', () => {
  const doc = createEmptyDocument();
  assert.equal(addCharacter(doc, { name: 'A', body: 'female' }).color, '#ff6b7a');
  assert.equal(addCharacter(doc, { name: 'B', body: 'female' }).color, '#ff6b7a');
  assert.equal(addCharacter(doc, { name: 'C', body: 'male', color: '#abcdef' }).color, '#abcdef');
});

test('fitBounds rejects invalid projection inputs and handles degenerate view directions', () => {
  const box = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
  const original = box.clone();
  for (const options of [{ fov: 0, aspect: 1 }, { fov: 48, aspect: 0 }, { fov: 48, aspect: 1, occupancy: 0 }]) {
    assert.throws(() => fitBounds(box, options), RangeError);
  }
  assert.throws(() => fitBounds(new THREE.Box3(), { fov: 48, aspect: 1 }), RangeError);
  for (const direction of [new THREE.Vector3(), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0)]) {
    const before = direction.clone();
    const fit = fitBounds(box, { fov: 48, aspect: 1, direction });
    assert.ok(fit.position.toArray().every(Number.isFinite));
    assert.ok(fit.position.distanceTo(fit.target) >= 1.5);
    assert.ok(direction.equals(before));
  }
  assert.ok(box.equals(original));
});

test('startup director framing is independent of the unchanged filming camera', () => {
  for (const aspect of [0.3, 0.8, 1.34, 1.78, 2.2]) {
    const { director, shot } = startupFraming();
    const cameras = [director, shot].map(view => {
      const camera = new THREE.PerspectiveCamera(view.fov, aspect, .05, 1000);
      camera.position.copy(view.position); camera.lookAt(view.target); camera.updateMatrixWorld();
      return camera;
    });
    assert.deepEqual(director.position.toArray(), [0, 2.2, 7.5]);
    assert.deepEqual(director.target.toArray(), [0, 0.45, 0]);
    assert.deepEqual(shot.position.toArray(), [0, 2.2, 10]);
    assert.deepEqual(shot.target.toArray(), [0, 1.2, 0]);
    assert.equal(shot.fov, 50);
    assert.equal(director.fov, 50);
    assert.ok(cameras[0].getWorldDirection(new THREE.Vector3()).distanceTo(new THREE.Vector3(0, -1.75, -7.5).normalize()) < 1e-9);
    const height = camera => (new THREE.Vector3(0, 1.75, 0).project(camera).y
      - new THREE.Vector3(0, 0, 0).project(camera).y) / 2;
    assert.ok(height(cameras[0]) > .24 && height(cameras[0]) < .27);
    assert.ok(height(cameras[1]) > .18 && height(cameras[1]) < .20);
    for (const x of [-.7, .7]) for (const y of [0, 1.75]) {
      const p = new THREE.Vector3(x, y, 0);
      assert.ok(Math.abs(p.clone().project(cameras[1]).y) < 1);
      assert.ok(Math.abs(p.clone().project(cameras[0]).y) < 1);
    }
  }
});
