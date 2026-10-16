import { Path } from './Path.js';

// 路径生成器（阶段 E）：纯函数，不依赖 DOM。输入 / 输出都是文档口径的 [x,y,z]（实体父坐标系，角色 / 组的 y = 地面高度）。
// 同时是阶段 F 运镜预设、阶段 H AI 生成的积木（词汇表：line / arc / toward）。点的 y 一律由调用方给。
//
// 角度约定（arc）：从 +X 轴起算，从上往下看（−Y 方向）逆时针为正：θ → (cx + r·cosθ, y, cz − r·sinθ)。

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const r6 = (x) => { const v = Math.round(x * 1e6) / 1e6; return v === 0 ? 0 : v; };
const pt = (x, y, z) => [r6(x), r6(y), r6(z)];

/** 直线：[from, to]。 */
export function line(from, to) {
  return [pt(...from), pt(...to)];
}

/**
 * 圆弧采样点。sweepDeg 可负（顺时针）；|sweepDeg| ≥ 360 时为整圆：closed = true，不重复首点。
 * segments = 整段扫过角度分几段（整圆时点数 = segments）。
 * @returns {{points:number[][], closed:boolean}}
 */
export function arc({ center, radius, startDeg, sweepDeg, y, segments = 8 }) {
  const closed = Math.abs(sweepDeg) >= 360;
  const sweep = closed ? Math.sign(sweepDeg) * 360 : sweepDeg;
  const n = Math.max(1, Math.round(segments));
  const count = closed ? n : n + 1;
  const points = [];
  for (let i = 0; i < count; i++) {
    const a = (startDeg + (sweep * i) / n) * D2R;
    points.push(pt(center[0] + radius * Math.cos(a), y, center[2] - radius * Math.sin(a)));
  }
  return { points, closed };
}

/** arc 的反算：点 p 相对中心的水平半径与角度（度，约定同 arc）。 */
export function polar(center, p) {
  const dx = p[0] - center[0], dz = p[2] - center[2];
  return { radius: Math.hypot(dx, dz), deg: Math.atan2(-dz, dx) * R2D };
}

/**
 * 走到：从 from 沿水平连线走向 target，停在 target 前 stopDistance（水平距离）处；终点 y 取 from 的 y。
 * from 与 target 水平距离 ≤ stopDistance 时返回 null（已经够近，不必走）。
 */
export function toward(from, target, { stopDistance = 0.8 } = {}) {
  const dx = target[0] - from[0], dz = target[2] - from[2];
  const d = Math.hypot(dx, dz);
  if (d <= stopDistance) return null;
  const k = (d - stopDistance) / d;
  return [pt(...from), pt(from[0] + dx * k, from[1], from[2] + dz * k)];
}

/** 点到线段的距离（三维）。 */
function segDist(p, a, b) {
  let lenSq = 0, dot = 0;
  for (let i = 0; i < 3; i++) { const ab = b[i] - a[i]; lenSq += ab * ab; dot += (p[i] - a[i]) * ab; }
  const u = lenSq > 0 ? Math.min(1, Math.max(0, dot / lenSq)) : 0;
  let s = 0;
  for (let i = 0; i < 3; i++) { const d = p[i] - (a[i] + (b[i] - a[i]) * u); s += d * d; }
  return Math.sqrt(s);
}

/**
 * Douglas-Peucker 简化（手绘用）：保留首尾，去掉到简化折线距离 < tolerance 的点。
 * 迭代实现（手绘采样可能上千点，不用递归）。
 */
export function simplify(points, tolerance = 0.05) {
  if (points.length <= 2) return points.map((p) => pt(...p));
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    let max = -1, idx = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const d = segDist(points[i], points[i0], points[i1]);
      if (d > max) { max = d; idx = i; }
    }
    if (idx >= 0 && max >= tolerance) {
      keep[idx] = 1;
      stack.push([i0, idx], [idx, i1]);
    }
  }
  return points.filter((_, i) => keep[i]).map((p) => pt(...p));
}

/** 路径曲线全长（米）：与求值同一条 centripetal Catmull-Rom（复用 Path 的弧长表）。 */
export function pathLength(points, closed = false) {
  if (points.length < 2) return 0;
  return new Path({ points, closed, start: 0, duration: 1, speed: 'linear' }).length;
}

/** 默认时长：曲线长度 ÷ 速度（m/s），向上取 0.5 s 整，最短 1 s。 */
export function defaultDuration(points, { speed = 1.3, closed = false } = {}) {
  const t = pathLength(points, closed) / speed;
  return Math.max(1, Math.ceil(t * 2 - 1e-9) / 2);
}
