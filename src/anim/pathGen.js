// @ts-check
import { Path, WALK_RAMP, isWalker } from './Path.js';
import { D2R, R2D, round6, round4 } from '../util/math.js';
import { endpointSchedule, pathCurve, stopEntries, captionEntries, scheduleSegments } from './schedule.js';

// 路径生成器：纯函数，不依赖 DOM。输入 / 输出都是文档口径的 [x,y,z]（实体父坐标系，角色 / 组的 y = 地面高度）。
// 同时是运镜预设、AI 生成的积木（词汇表：line / arc / toward）。点的 y 一律由调用方给。
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

/** 路径曲线全长（米）；显示层沿用停顿处分段的几何口径。 */
export function pathLength(points, closed = false, markers = null, interpolation) {
  if (points.length < 2) return 0;
  const path = { points, closed, interpolation, start: 0, duration: 1 };
  path.schedule = markedSchedule(path, markers || []);
  return new Path(path).length;
}

/** Marked arrivals use distance allocation unless explicit arrival times are supplied. */
export function markedSchedule(path, markers = [], times, curve = 'linear') {
  const schedule = endpointSchedule(path.points, path.closed, path.duration, curve);
  if (times) delete schedule[0].allocation;
  schedule.splice(1, 0, ...markers.map((i, j) => ({ i, t: times?.[j] ?? 0, stop: true,
    ...(times ? { captionTime: true } : {}) })));
  if (!times && markers.length) {
    const model = new Path({ ...path, schedule });
    schedule.slice(1, -1).forEach((entry, index) => { entry.t = model.segmentTimes[index]; });
  }
  return schedule;
}

/** Scale the one time column; callers retain their existing rounding precision. */
export function scaleSchedule(schedule, ratio, roundTime = round4) {
  return schedule.map(entry => ({ ...entry, t: roundTime(entry.t * ratio) }));
}

/** Explicit intervals and dwell use the same ordered arrival/departure entries. */
export function intervalSchedule(path, sections) {
/** @type {import('../types/contracts.js').PathDocument['schedule']} */
  const schedule = [{ i: 0, t: 0, curve: pathCurve(path), segmented: true }];
  for (const [index, section] of sections.entries()) {
    if (section.start > schedule.at(-1).t) schedule.push({ i: section.from, t: section.start });
    schedule.push({ i: section.to, t: section.end, curve: section.curve,
      ...(index < sections.length - 1 ? { stop: true } : {}), ...(section.inherited ? { inherited: true } : {}),
      ...(section.closed !== undefined ? { closed: section.closed } : {}) });
  }
  if (schedule.at(-1).t < path.duration) schedule.push({ i: schedule.at(-1).i, t: path.duration });
  return schedule;
}

/** All vertex edits and timing adjustments share one remapping operation.
 * map returns the new vertex index, or null for a removed vertex. Reverse
 * preserves the established time semantics of explicitly authored motion.
 */
/** @param {object} old @param {object} patch @param {{map?:(i:number)=>number|null,reverse?:boolean,stop?:{index:number,on:boolean},roundTime?:(t:number)=>number}} [options] */
export function remapSchedule(old, patch, { map, reverse = false, stop, roundTime = round4 } = {}) {
  const out = { ...old, ...patch };
  const first = old.schedule[0], curve = pathCurve(old);
  const changedCount = out.points.length !== old.points.length;
  let schedule = (patch.schedule || old.schedule).map(entry => ({ ...entry }));
  const captions = captionEntries(old);
  let marks = stopEntries(old).map(entry => entry.i);
  let times = captions.length ? captions.map(entry => entry.t)
    : first.allocation === 'distance' || first.segmented || first.curve === 'cubic' ? null : stopEntries(old).map(entry => entry.t);
  if (map && !first.segmented) {
    const keep = marks.map(index => map(index) != null);
    marks = marks.filter((_, i) => keep[i]).map(map);
    if (times) times = times.filter((_, i) => keep[i]);
    if (reverse) { marks.reverse(); if (times) times = times.map(t => round4(old.duration - t)).reverse(); }
  }
  if (stop) {
    const { index, on } = stop;
    if (first.segmented) {
      const sections = scheduleSegments(old), boundary = sections.findIndex(section => section.to === index);
      if (!on && boundary >= 0 && boundary < sections.length - 1) {
        const left = sections[boundary], right = sections[boundary + 1];
        sections.splice(boundary, 2, { from: left.from, to: right.to, start: left.start, end: right.end, curve: 'smooth' });
      } else if (on && boundary < 0) {
        const at = sections.findIndex(section => section.from < index && index < section.to);
        if (at >= 0) {
          const section = sections[at], time = round6(new Path(old).vertexTime(index) - old.start);
          sections.splice(at, 1,
            { from: section.from, to: index, start: section.start, end: time, curve: 'smooth' },
            { from: index, to: section.to, start: time, end: section.end, curve: 'smooth' });
        }
      }
      schedule = intervalSchedule(out, sections);
    } else {
      const at = marks.indexOf(index);
      if (!on && at >= 0) { marks.splice(at, 1); times?.splice(at, 1); }
      if (on && at < 0) {
        const next = marks.findIndex(i => i > index), insert = next < 0 ? marks.length : next;
        marks.splice(insert, 0, index);
        if (times) {
          const arrival = new Path(old).vertexTime(index) - old.start;
          times.splice(insert, 0, round4(Math.min(Math.max(arrival, (insert ? times[insert - 1] : 0) + 0.05), (times[insert] ?? old.duration) - 0.05)));
        }
      }
    }
  }
  if (!patch.schedule && changedCount && !map) { marks = []; times = null; }
  const last = out.points.length - (out.closed ? 0 : 1);
  const keep = marks.map(i => i > 0 && i < last);
  marks = marks.filter((_, i) => keep[i]);
  if (times) times = times.filter((_, i) => keep[i]);
  if (!patch.schedule && out.duration !== old.duration) {
    const ratio = out.duration / old.duration;
    schedule = scaleSchedule(schedule, ratio, roundTime);
    if (times) times = times.map(t => roundTime(t * ratio));
  }
  if (times && !times.every((t, i) => t > 0 && t < out.duration && (!i || t > times[i - 1]))) times = null;
  if (!patch.schedule) {
    if (first.segmented && !changedCount) {
      if (patch.points) {
        const entries = schedule.filter(entry => !entry.caption);
        for (let i = 1; i < entries.length; i++) {
          if (entries[i].closed && JSON.stringify(out.points[entries[i - 1].i]) !== JSON.stringify(out.points[entries[i].i])) entries[i].closed = false;
        }
      }
    } else if (first.curve === 'cubic' && !changedCount) {
      schedule = schedule.filter(entry => !entry.caption).map(entry => {
        delete entry.stop;
        return marks.includes(entry.i) ? { ...entry, stop: true } : entry;
      });
      if (times) schedule.push(...marks.map((i, j) => ({ i, t: times[j], caption: true })));
    } else schedule = markedSchedule(out, first.segmented ? [] : marks, first.segmented ? null : times, curve);
  }
  out.schedule = schedule;
  return out;
}

/** 固定场景时长：保留完整路线，将超时路径加速到终点；整段在场景外时按比例前移。 */
export function fitPathToDuration(path, total) {
  const end = path.start + path.duration;
  if (!(total > 0) || !Number.isFinite(total) || !(path.start >= 0) || !(path.duration > 0) || !Number.isFinite(end) || end <= total) return path;
  const start = path.start >= total ? round6(path.start * total / end) : path.start;
  return remapSchedule(path, { start, duration: round6(total - start) });
}

/** 默认步速（m/s）：匀速段的速度。角色新路径比原先的 1.2 m/s 提高 20%。 */
export const WALK_PACE = 1.44;

/** 机位和道具沿用原速度；只调整新建角色/群众路径。 */
export const paceFor = type => isWalker(type) ? WALK_PACE : 1.2;

/**
 * 默认时长：让匀速段的速度 = speed（m/s）。smooth 角色路径有起步 / 收步（ramp 秒，Path 的 ramp 选项），
 * 匀速 V = 长 / (时长 − r)、r = min(ramp, 时长/2) → 时长 = 长/speed + ramp（很短时 = 2·长/speed）；ramp=0 即 长 ÷ speed。
 * 向上取 0.1 s，最短 1 s。
 */
/** @param {number[][]} points @param {{speed?:number,closed?:boolean,ramp?:number,interpolation?:string}} [options] */
export function defaultDuration(points, { speed = WALK_PACE, closed = false, ramp = WALK_RAMP, interpolation } = {}) {
  const length = pathLength(points, closed, null, interpolation);
  const base = length / speed;
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

/** Local XZ rectangle, first corner equals the entity base position. */
export function rectangle(start, opposite) {
  if (Math.abs(start[0] - opposite[0]) < 0.1 || Math.abs(start[2] - opposite[2]) < 0.1) return null;
  return [start.slice(), [opposite[0], start[1], start[2]], [opposite[0], start[1], opposite[2]], [start[0], start[1], opposite[2]]];
}
