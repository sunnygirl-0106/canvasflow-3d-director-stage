import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { safePathPlanePoint } from '../src/core/pathPicking.js';

const origin = new Vector3(0, 3, 12);
const focus = new Vector3(0, 1, 0);
const pick = (target, distance = origin.distanceTo(focus), y = 0) => safePathPlanePoint(origin, target.clone().sub(origin).normalize(), y, focus, distance);

test('地平线附近和远处地面不会生成巨长路径，普通落点不偏移', () => {
  assert.deepEqual(pick(new Vector3(2, 0, 1)), [2, 0, 1]);
  assert.equal(pick(new Vector3(0, 0, -1000)), null);
  assert.equal(pick(new Vector3(100, 0, 0)), null);
  assert.equal(pick(new Vector3(0, 4, 0)), null);
  assert.equal(safePathPlanePoint(origin, new Vector3(0, 0, -1), 0, focus, 12), null);
});

test('保护区域跟随观察中心，缩放后可绘制更大范围，也支持机位高度平面', () => {
  assert.deepEqual(pick(new Vector3(1, 1.5, 3), 12, 1.5), [1, 1.5, 3]);
  const o = new Vector3(100, 30, 120), f = new Vector3(100, 0, 100);
  const d = new Vector3(110, 0, 95).sub(o).normalize();
  assert.deepEqual(safePathPlanePoint(o, d, 0, f, 40), [110, 0, 95]);
  assert.equal(safePathPlanePoint(origin, new Vector3(NaN, 0, 0), 0, focus, 12), null);
});
