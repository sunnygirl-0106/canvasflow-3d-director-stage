import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TransformGizmo } from '../src/core/TransformGizmo.js';

globalThis.window = new EventTarget();

function fixture(camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000)) {
  const dom = { clientHeight: 600, style: {}, addEventListener() {}, removeEventListener() {} };
  const scene = new THREE.Scene();
  const root = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.5));
  scene.add(root);
  const gizmo = new TransformGizmo(camera, dom, scene, { enabled: true });
  camera.position.set(0, 0, 10);
  gizmo.attach(root);
  // 用真实 TransformControls 的手柄矩阵测屏幕长度，不重复尺寸计算公式。
  const measure = () => {
    gizmo.updateSize();
    scene.updateMatrixWorld(true);
    const handle = gizmo.translateHandle('x');
    const start = handle.position.clone().project(camera);
    const end = handle.position.clone().add(new THREE.Vector3(0.6 * handle.scale.x, 0, 0)).project(camera);
    return Math.abs(end.x - start.x) * dom.clientHeight / 2;
  };
  return { camera, dom, root, gizmo, measure };
}

test('远处人物手柄收敛，近处有上限；对象自身缩小也生效', () => {
  const { camera, root, measure } = fixture();
  const normal = measure();
  camera.position.z = 50;
  const far = measure();
  camera.position.z = 5;
  const close = measure();
  camera.position.z = 2;
  const near = measure();
  assert.ok(far < normal && normal < close && close < near);
  assert.ok(Math.abs(far - 28.8) < 1e-6);
  assert.ok(Math.abs(near - 100.8) < 1e-6);
  camera.position.z = 10;
  root.scale.setScalar(0.1);
  assert.ok(Math.abs(measure() - far) < 1e-6);
});

test('FOV、zoom 与离轴位置不突破视口比例上限', () => {
  const { camera, root, dom, measure } = fixture();
  root.scale.setScalar(10);
  for (const height of [400, 900]) {
    dom.clientHeight = height;
    for (const fov of [25, 80]) {
      for (const zoom of [0.5, 2]) {
        camera.fov = fov;
        camera.zoom = zoom;
        camera.updateProjectionMatrix();
        root.position.x = 3;
        assert.ok(Math.abs(measure() - height * 0.28 * 0.6) < 1e-6);
      }
    }
  }
});

test('正交相机缩放和拖拽期间尺寸稳定', () => {
  const { camera, gizmo, measure } = fixture(new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 1000));
  const normal = measure();
  camera.zoom = 0.2;
  camera.updateProjectionMatrix();
  assert.ok(measure() < normal);
  const size = gizmo.control.size;
  gizmo.control.dragging = true;
  camera.zoom = 4;
  camera.updateProjectionMatrix();
  gizmo.updateSize();
  assert.equal(gizmo.control.size, size);
  gizmo.control.dragging = false;
  assert.ok(Math.abs(measure() - 100.8) < 1e-6);
});
