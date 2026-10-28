// 视口拾取共用的小工具：指针 → NDC、射线换到局部坐标求地面点、命中实体回溯、选中键标识。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { pointerNDC } from '../src/util/dom.js';
import { framePlanePoint, safePathPlanePoint } from '../src/core/pathPicking.js';
import { pickEntityId, footprintRadius } from '../src/core/Selection.js';
import { keyId, parseKeyId } from '../src/ui/timeline/TrackRows.js';

const element = { getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 200 }) };

test('pointerNDC：元素四角与中心映射到 [-1, 1]，y 向上；可写入传入对象', () => {
  assert.deepEqual(pointerNDC(element, 100, 50), { x: -1, y: 1 });
  assert.deepEqual(pointerNDC(element, 500, 250), { x: 1, y: -1 });
  assert.deepEqual(pointerNDC(element, 300, 150), { x: 0, y: 0 });
  const out = new THREE.Vector2();
  assert.equal(pointerNDC(element, 200, 100, out), out);
  assert.deepEqual(out.toArray(), [-0.5, 0.5]);
});

test('framePlanePoint：世界射线换到局部坐标后求交，结果与直接在局部坐标求交一致', () => {
  const frame = new THREE.Group();
  frame.position.set(2, 0.5, -1);
  frame.rotation.y = Math.PI / 6;
  frame.scale.setScalar(2);
  frame.updateMatrixWorld(true);
  const localOrigin = new THREE.Vector3(0, 3, 6), localTarget = new THREE.Vector3(1, 0, 1), localFocus = new THREE.Vector3(0, 0, 0);
  const expected = safePathPlanePoint(localOrigin, localTarget.clone().sub(localOrigin).normalize(), 0, localFocus, localOrigin.distanceTo(localFocus));
  const origin = frame.localToWorld(localOrigin.clone());
  const ray = new THREE.Ray(origin, frame.localToWorld(localTarget.clone()).sub(origin).normalize());
  assert.deepEqual(framePlanePoint(ray, frame, 0, frame.localToWorld(localFocus.clone())), expected);
  assert.deepEqual(expected, [1, 0, 1]);
});

test('pickEntityId：跳过被隐藏祖先遮住的命中，回溯到挂 entityId 的 root', () => {
  const box = () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  const hidden = new THREE.Group();
  hidden.userData.entityId = 'hidden';
  const inner = new THREE.Group();
  inner.visible = false;
  hidden.add(inner);
  inner.add(box());
  hidden.position.z = 2; // 离射线起点更近
  const shown = new THREE.Group();
  shown.userData.entityId = 'shown';
  const child = box();
  shown.add(new THREE.Group().add(child));
  const roots = [hidden, shown];
  for (const r of roots) r.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1));
  assert.equal(pickEntityId(ray, roots), 'shown');
  shown.visible = false;
  assert.equal(pickEntityId(ray, roots), null);
  assert.equal(pickEntityId(new THREE.Raycaster(new THREE.Vector3(5, 0, 10), new THREE.Vector3(0, 0, -1)), roots), null);
});

test('footprintRadius：最小 0.4 m，否则覆盖水平包围盒并留 0.12 m', () => {
  assert.equal(footprintRadius({ x: 0.1, y: 2, z: 0.1 }), 0.4);
  assert.ok(Math.abs(footprintRadius({ x: 3, y: 0, z: 4 }) - 2.62) < 1e-12);
});

test('parseKeyId 是 keyId 的反解（轨道 id 里含 @ 也按最后一个分隔）', () => {
  assert.deepEqual(parseKeyId(keyId('abc12345', 1.25)), { trackId: 'abc12345', t: 1.25 });
  assert.deepEqual(parseKeyId(keyId('a@b', 0)), { trackId: 'a@b', t: 0 });
});
