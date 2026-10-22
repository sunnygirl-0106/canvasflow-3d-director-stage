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
test('new character palette follows creation order and preserves explicit colors', () => {
  const doc = createEmptyDocument();
  assert.equal(addCharacter(doc, { name: 'A', body: 'female' }).color, '#468de5');
  assert.equal(addCharacter(doc, { name: 'B', body: 'female' }).color, '#e35e61');
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

test('startup view matches reference scale and gentle downward angle while both characters remain in the shot', () => {
  const box = new THREE.Box3(new THREE.Vector3(-0.98, 0, -0.05), new THREE.Vector3(0.96, 1.75, 0.25));
  for (const aspect of [0.3, 0.8, 1.34, 1.78, 2.2]) {
    const { director, shot } = startupFraming(box, { fov: 40, aspect });
    const camera = new THREE.PerspectiveCamera(40, aspect, 0.05, 1000);
    camera.position.copy(director.position); camera.lookAt(director.target); camera.updateMatrixWorld();
    const center = box.getCenter(new THREE.Vector3());
    const foot = new THREE.Vector3(center.x, box.min.y, center.z).project(camera);
    const head = new THREE.Vector3(center.x, box.max.y, center.z).project(camera);
    const height = (head.y - foot.y) / 2;
    assert.ok(height >= (aspect < .5 ? .18 : .19) && height <= .22);
    assert.ok((1 - foot.y) / 2 >= .64 && (1 - foot.y) / 2 <= .68);
    assert.ok(Math.abs(foot.x) < 1e-9);
    const pitch = Math.atan2(director.position.y - director.target.y, director.position.z - director.target.z);
    assert.ok(Math.abs(pitch - THREE.MathUtils.degToRad(5)) < 1e-9);
    assert.ok(shot.position.equals(director.position));
    assert.ok(shot.target.equals(director.target));
    assert.equal(shot.fov, camera.fov);
    assert.equal(shot.position.x, shot.target.x);
    camera.fov = shot.fov; camera.position.copy(shot.position); camera.lookAt(shot.target);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const p = new THREE.Vector3(x, y, z).project(camera);
      assert.ok(Math.abs(p.x) < .8 && Math.abs(p.y) < .85 && p.z < 1, `aspect ${aspect}: both actors must stay in frame`);
    }
  }
});
