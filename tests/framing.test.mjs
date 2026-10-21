import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fitBounds } from '../src/core/framing.js';
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
