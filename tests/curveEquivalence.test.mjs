import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Path } from '../src/anim/Path.js';

// 固定种子让替换门槛可复现；覆盖开放/闭合、长短边与两种速度曲线。
function paths() {
  let seed = 0x51a3;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  return Array.from({ length: 50 }, (_, index) => ({
    points: Array.from({ length: 3 + Math.floor(random() * 12) }, () => [
      (random() - .5) * 30, random() * 5, (random() - .5) * 30,
    ]),
    closed: index % 2 === 0, start: 0, duration: 10,
    speed: index % 3 ? 'linear' : 'smooth', interpolation: index % 5 ? 'centripetal' : 'polyline',
  }));
}

function nativeCurve(json, divisions) {
  const points = json.points.map(p => new THREE.Vector3(...p));
  if (json.interpolation !== 'polyline') {
    const curve = new THREE.CatmullRomCurve3(points, json.closed, 'centripetal');
    curve.arcLengthDivisions = divisions;
    return u => curve.getPointAt(u);
  }
  const curve = new THREE.CurvePath();
  const count = json.closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) curve.add(new THREE.LineCurve3(points[i], points[(i + 1) % points.length]));
  // CurvePath.getPoint 本身按每段真实长度分配参数，无需二次弧长反解。
  return u => curve.getPoint(u);
}

test('50 条随机路径 × 200 时刻：现行实现保持 1mm 精度，并量化原生替换误差', t => {
  let nativeError = 0, referenceError = 0, polylineError = 0;
  for (const json of paths()) {
    const path = new Path(json);
    const candidate = nativeCurve(json, Math.max(200, json.points.length * 64));
    const reference = nativeCurve(json, Math.max(20000, json.points.length * 2048));
    for (let i = 0; i < 200; i++) {
      const time = json.duration * i / 199;
      const progress = path.progress(time);
      const actual = path.positionAt(path.distanceAt(time));
      const error = actual.distanceTo(candidate(progress));
      nativeError = Math.max(nativeError, error);
      if (json.interpolation === 'polyline') polylineError = Math.max(polylineError, error);
      referenceError = Math.max(referenceError, actual.distanceTo(reference(progress)));
    }
  }
  t.diagnostic(`原生指定分辨率最大误差 ${(nativeError * 1000).toFixed(6)} mm；折线 ${(polylineError * 1000).toFixed(6)} mm；现行实现对高精度参考 ${(referenceError * 1000).toFixed(6)} mm`);
  t.diagnostic(nativeError <= .001 ? '原生位置精度通过替换门槛' : '原生位置精度未通过 1mm 门槛，保留自适应实现');
  // 原生候选未达标时不能将它冒充成功或留下失败测试；持续约束实际交付实现的精度。
  assert.ok(referenceError <= .001, `现行位置误差 ${referenceError} m 超过 1mm`);
});
