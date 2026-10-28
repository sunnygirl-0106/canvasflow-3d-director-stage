import { round4 } from '../util/math.js';

// 浅角度射线接近地平线时，极小的屏幕位移会变成巨大的地面位移。
const MIN_INCIDENCE = Math.sin(6 * Math.PI / 180);

/** 坐标均为场景局部坐标。拒绝不稳定或远离当前观察区域的落点，不把它夹到边界上。 */
export function safePathPlanePoint(origin, direction, y, focus, viewDistance) {
  if (![origin.x, origin.y, origin.z, direction.x, direction.y, direction.z, y, focus.x, focus.z, viewDistance].every(Number.isFinite)) return null;
  if (Math.abs(direction.y) < MIN_INCIDENCE) return null;
  const t = (y - origin.y) / direction.y;
  if (!(t > 0)) return null;
  const x = origin.x + direction.x * t;
  const z = origin.z + direction.z * t;
  const radius = Math.max(6, Math.min(100, viewDistance * 1.25));
  if (Math.hypot(x - focus.x, z - focus.z) > radius) return null;
  return [round4(x), y, round4(z)];
}

/**
 * 世界坐标射线换到 frame 的局部坐标后与水平面 y 求交（规则同 safePathPlanePoint）；focus 为世界坐标的观察中心。
 * 调用方负责先更新 frame 的世界矩阵。
 */
export function framePlanePoint(ray, frame, y, focus) {
  const inv = frame.matrixWorld.clone().invert();
  const origin = ray.origin.clone().applyMatrix4(inv);
  const direction = ray.direction.clone().transformDirection(inv);
  const localFocus = focus.clone().applyMatrix4(inv);
  return safePathPlanePoint(origin, direction, y, localFocus, origin.distanceTo(localFocus));
}
