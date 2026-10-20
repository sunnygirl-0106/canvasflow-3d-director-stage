import { Path, WALK_RAMP } from './Path.js';
import { D2R, R2D, round6, round4 } from '../util/math.js';

// 路径生成器（阶段 E）：纯函数，不依赖 DOM。输入 / 输出都是文档口径的 [x,y,z]（实体父坐标系，角色 / 组的 y = 地面高度）。
// 同时是阶段 F 运镜预设、阶段 H AI 生成的积木（词汇表：line / arc / toward）。点的 y 一律由调用方给。
//
// 角度约定（arc）：从 +X 轴起算，从上往下看（−Y 方向）逆时针为正：θ → (cx + r·cosθ, y, cz − r·sinθ)。

const pt = (x, y, z) => [round6(x), round6(y), round6(z)];

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
export function toward(from, target, { stopDistance = TOWARD_STOP.default } = {}) {
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

/** 路径曲线全长（米）：与求值同一条 centripetal Catmull-Rom（复用 Path 的弧长表；有 stops 时按段）。 */
export function pathLength(points, closed = false, stops = null) {
  if (points.length < 2) return 0;
  return new Path({ points, closed, start: 0, duration: 1, speed: 'linear', ...(stops?.length ? { stops } : {}) }).length;
}

// ---- 停顿 stops / stopTimes（收尾 1）：文档口径的纯函数 ----

/**
 * 路径改动后让 stops / stopTimes 仍然合法（Timeline.updatePath / edit.setPath 用）：
 * - patch 没给 stops 而顶点数变了 → 去掉停顿（索引对不上了）；越界的停顿（闭合 ↔ 开放切换）去掉；
 * - patch 没给 stopTimes 而时长变了 → 各停顿时刻按比例缩放；
 * - stops 为空 → 两个字段都删掉（没有停顿的路径与旧文档逐字段相同）。
 * @param {object|null} old 改动前的路径（新建时为 null） @param {object} next 合并后的路径 @param {object} patch
 */
export function fitStops(old, next, patch = {}) {
  const out = { ...next };
  let stops = 'stops' in patch ? patch.stops : out.stops;
  let times = 'stopTimes' in patch ? patch.stopTimes : out.stopTimes;
  if (old && !('stops' in patch) && patch.points && patch.points.length !== old.points.length) stops = times = undefined;
  if (stops?.length) {
    const last = out.closed ? out.points.length - 1 : out.points.length - 2;
    const keep = stops.map((i) => i >= 1 && i <= last);
    if (keep.some((k) => !k)) {
      stops = stops.filter((_, j) => keep[j]);
      if (times?.length === keep.length) times = times.filter((_, j) => keep[j]);
    }
    if (times?.length && old && !('stopTimes' in patch) && out.duration !== old.duration) times = times.map((t) => round4(t * out.duration / old.duration));
    if (times && (times.length !== stops.length || times.some((t, j) => !(t > 0 && t < out.duration && (j === 0 || t > times[j - 1]))))) times = undefined;
  }
  delete out.stops; delete out.stopTimes;
  if (stops?.length) {
    out.stops = stops.slice();
    if (times?.length) out.stopTimes = times.slice();
  }
  return out;
}

/** 插入顶点（新顶点下标 index）后的停顿：之后的索引 +1。 */
export function stopsAfterInsert(path, index) {
  if (!path.stops?.length) return {};
  return { stops: path.stops.map((i) => (i >= index ? i + 1 : i)), ...(path.stopTimes ? { stopTimes: path.stopTimes.slice() } : {}) };
}

/** 删除顶点 index 后的停顿：删掉该顶点上的停顿，之后的索引 −1。 */
export function stopsAfterDelete(path, index) {
  if (!path.stops?.length) return {};
  const keep = path.stops.map((i) => i !== index);
  return {
    stops: path.stops.filter((_, j) => keep[j]).map((i) => (i > index ? i - 1 : i)),
    ...(path.stopTimes ? { stopTimes: path.stopTimes.filter((_, j) => keep[j]) } : {}),
  };
}

/** 反向（顶点倒序）后的停顿：索引 i → n−1−i，时刻 t → duration − t，整体倒序（闭合路径落到首点的停顿由 fitStops 去掉）。 */
export function stopsAfterReverse(path) {
  if (!path.stops?.length) return {};
  const n = path.points.length;
  return {
    stops: path.stops.map((i) => n - 1 - i).reverse(),
    ...(path.stopTimes ? { stopTimes: path.stopTimes.map((t) => round4(path.duration - t)).reverse() } : {}),
  };
}

/**
 * 在顶点 index 处加 / 去停顿。已有 stopTimes 时新停顿的时刻 = 当前时间分配下到达该顶点的时刻（其余段不变）。
 * @returns {{stops:number[], stopTimes?:number[]}} 交给 updatePath 的 patch（stops 为空时 fitStops 会删掉字段）
 */
export function toggleStop(path, index, on) {
  const stops = (path.stops || []).slice(), times = path.stopTimes ? path.stopTimes.slice() : null;
  const j = stops.indexOf(index);
  if (!on) {
    if (j < 0) return { stops };
    stops.splice(j, 1);
    if (times) times.splice(j, 1);
    return times ? { stops, stopTimes: times } : { stops };
  }
  if (j >= 0) return times ? { stops, stopTimes: times } : { stops };
  const at = stops.findIndex((i) => i > index);
  const k = at < 0 ? stops.length : at;
  stops.splice(k, 0, index);
  if (!times) return { stops };
  const P = new Path(path);
  const s = P.vertexDistance(index);
  let lo = 0, hi = path.duration; // 到达该顶点的时刻：distanceAt 单调，二分
  for (let n = 0; n < 50; n++) { const mid = (lo + hi) / 2; if (P.distanceAt(path.start + mid) < s) lo = mid; else hi = mid; }
  const lo2 = k ? times[k - 1] : 0, hi2 = k < times.length ? times[k] : path.duration;
  times.splice(k, 0, round4(Math.min(Math.max(hi, lo2 + 0.05), hi2 - 0.05)));
  return { stops, stopTimes: times };
}

/** 默认步速（m/s）：匀速段的速度。1.7 = 快一点的正常走（纯走上限 1.8，再快就开始混跑）。 */
export const WALK_PACE = 1.7;

/**
 * 默认时长：让匀速段的速度 = speed（m/s）。smooth 角色路径有起步 / 收步（ramp 秒，Path 的 ramp 选项），
 * 匀速 V = 长 / (时长 − r)、r = min(ramp, 时长/2) → 时长 = 长/speed + ramp（很短时 = 2·长/speed）；ramp=0 即 长 ÷ speed。
 * 向上取 0.1 s，最短 1 s。
 */
export function defaultDuration(points, { speed = WALK_PACE, closed = false, ramp = WALK_RAMP } = {}) {
  const base = pathLength(points, closed) / speed;
  const t = base >= ramp ? base + ramp : 2 * base;
  return Math.max(1, Math.ceil(t * 10 - 1e-9) / 10);
}

// ---- 绘制方式（界面路径工具与 AI 共用的词汇）----
/** 五种绘制方式：[key, 文案]。key 与 AI 词汇表一致（points / freehand / line / arc / toward）。 */
export const PATH_MODES = [
  ['points', '点击落点'],
  ['freehand', '手绘'],
  ['line', '直线'],
  ['arc', '环绕'],
  ['toward', '走到'],
];

/** 走到 / 推到：停在目标前的水平距离（米）。 */
export const TOWARD_STOP = { default: 0.8, camera: 1.5 };
/** 环绕默认扫过角度、每段角度。 */
export const ARC_SWEEP = 180;
export const ARC_SEG_DEG = 22.5;

/** 环绕参数 → 生成结果（Inspector 改三参数时也用它）：每 22.5° 一段，180° = 8 段。 */
export function arcPoints({ center, radius, startDeg, sweepDeg }, y) {
  const segments = Math.max(2, Math.ceil(Math.min(360, Math.abs(sweepDeg)) / ARC_SEG_DEG));
  return arc({ center, radius, startDeg, sweepDeg, y, segments });
}
