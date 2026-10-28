// @ts-check
import * as THREE from 'three';
import { line, arc, polar } from './pathGen.js';
import { Path } from './Path.js';
import { D2R, R2D, round6 } from '../util/math.js';

// 运镜预设：纯函数，不依赖 DOM / App。输入机位当前位姿 + 主体注视点 + 参数，输出文档口径的
// 路径点 / 旋转关键帧，由调用方写成 path + lookAt 约束（+ pan 的 rot 轨道）。
// 预设名与参数名是 AI 词汇表（定了不改）：push_in / pull_out / truck / crane / pan / half_orbit / circle；
// amount / dir / sweep / subject / duration。手动面板额外支持 spiral / rise，身份与参数由调用方持久化。
//
// 几何约定：
// - "距离 / 连线"一律取水平分量（机位→主体注视点投到水平面）：除 crane / spiral 外路径点 y = 机位当前高度。
// - truck 的 left / right 以机位视角为准：机位往自己左边移 = left。
// - 环绕：圆心 = 主体注视点的水平位置，半径 = 当前水平距离，高度 = 机位当前高度；
//   dir 以俯视为准，ccw = 逆时针（pathGen.arc 的正方向），cw = 顺时针。
// - pan：机位不动，生成两个 rot 关键帧（起 = 当前朝向，止 = 对准主体并保留荷兰角 roll，与 Constraint lookAt 一致）。

/** 预设表：[name, 中文名]（顺序即 Inspector 下拉顺序）。 */
export const CAMERA_MOVES = [
  ['push_in', '推'],
  ['pull_out', '拉'],
  ['truck', '横移'],
  ['crane', '升降'],
  ['pan', '摇'],
  ['half_orbit', '半环绕'],
  ['circle', '环绕'],
];
export const MOVE_LABEL = Object.fromEntries(CAMERA_MOVES);
export const PANEL_LABEL = { ...MOVE_LABEL, push_in: '推近', pull_out: '拉远', half_orbit: '半弧', pan: '摇镜头', spiral: '螺旋上升' };

// Manual panel defaults are explicit; legacy AI defaults below stay unchanged.
export const PANEL_MOVES = ['circle', 'half_orbit', 'push_in', 'pull_out', 'crane', 'truck', 'spiral'];
export const PANEL_DURATION = { circle: 2, half_orbit: 2, push_in: 2, pull_out: 2, crane: 2, truck: 2, spiral: 2, pan: 2 };

/** 默认时长（秒）。 */
export const MOVE_DURATION = { push_in: 3, pull_out: 3, truck: 3, crane: 3, pan: 2, half_orbit: 5, circle: 8 };

/** 各预设的参数（Inspector 按它显示输入项）。 */
export const MOVE_PARAMS = {
  push_in: ['amount'],
  pull_out: ['amount'],
  truck: ['amount', 'dir'],
  crane: ['amount', 'dir'],
  pan: [],
  half_orbit: ['sweep', 'dir'],
  circle: ['sweep', 'dir'],
};

export const PANEL_PARAMS = { ...MOVE_PARAMS, spiral: ['sweep', 'rise', 'dir'] };

/** dir 的取值：[value, 中文]。 */
export const MOVE_DIRS = {
  truck: [['left', '向左'], ['right', '向右']],
  crane: [['up', '升'], ['down', '降']],
  half_orbit: [['ccw', '逆时针'], ['cw', '顺时针']],
  circle: [['ccw', '逆时针'], ['cw', '顺时针']],
  spiral: [['ccw', '逆时针'], ['cw', '顺时针']],
};

export const MIN_SUBJECT_DIST = 0.3; // 推镜头至少离主体保留的水平距离（米）
// 环绕每段角度（比路径工具的 22.5° 细一倍）。开放弧两端另在 ¼ 段处各加一点：Catmull-Rom 端点按直线外推，
// 端段偏离圆最多（5 m 半径均匀 11.25° 时 1.4 cm），加点后 0.25 cm（验收要求半径恒定 ± 1 cm）。
const ORBIT_STEP = 11.25;
const MIN_RADIUS = 0.1;
const hdist = (a, b) => Math.hypot(b[0] - a[0], b[2] - a[2]);

/** 运镜参数不合法 / 几何上做不出来（文案直接给用户看）。 */
export class MoveError extends Error {}

/**
 * 预设默认参数（含 duration）。
 * @param {string} name 预设名
 * @param {{position:number[], aim:number[]}} ctx 机位位置与主体注视点（文档口径）
 */
export function defaultParams(name, { position, aim }) {
  const d = hdist(position, aim);
  const p = { duration: MOVE_DURATION[name] };
  switch (name) {
    case 'push_in': p.amount = d * 0.4; break;
    case 'pull_out': p.amount = d * 0.6; break;
    case 'truck': p.amount = 2; p.dir = 'left'; break;
    case 'crane': p.amount = 1; p.dir = 'up'; break;
    case 'half_orbit': p.sweep = 180; p.dir = 'ccw'; break;
    case 'circle': p.sweep = 360; p.dir = 'ccw'; break;
    case 'spiral': p.duration = 12; p.sweep = 360; p.rise = 1; p.dir = 'ccw'; break;
    case 'pan': break;
    default: throw new MoveError(`未知运镜：${name}`);
  }
  return p;
}

/** 机位在 position 处对准 aim 的朝向（文档口径：XYZ 欧拉角度数），叠加荷兰角 rollDeg。与 CameraEntity.aimAt / lookAt 约束同一算法。 */
export function aimRotation(position, aim, rollDeg = 0) {
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(...position), new THREE.Vector3(...aim), new THREE.Vector3(0, 1, 0));
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  if (rollDeg) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rollDeg * D2R));
  const e = new THREE.Euler().setFromQuaternion(q);
  return [e.x, e.y, e.z].map((v) => round6(v * R2D));
}

/** 水平单位方向 position → aim（太近 / 正上方时抛错）。 */
function horizDir(position, aim) {
  const dx = aim[0] - position[0], dz = aim[2] - position[2];
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) throw new MoveError('机位在主体正上方或正下方，无法确定运镜方向');
  return [dx / d, dz / d, d];
}

/**
 * 生成一个运镜。
 * @param {string} name 预设名
 * @param {{position:number[], rot?:number[], roll?:number, aim:number[], params?:object}} ctx
 *   position / rot = 机位当前位置与朝向（文档口径，rot 为欧拉度数），roll = 荷兰角（度），aim = 主体注视点；
 *   params 缺省项取 defaultParams。
 * @returns {{points:number[][]|null, closed:boolean, duration:number, rotKeys:number[][]|null}}
 *   带路径的预设 points 首点 = 机位当前位置；pan 的 points = null、rotKeys = [起, 止]。
 */
export function cameraMove(name, { position, rot = [0, 0, 0], roll = 0, aim, params = {} }) {
  const p = { ...defaultParams(name, { position, aim }), ...params };
  for (const k of ['duration', 'amount', 'sweep', 'rise']) if (p[k] != null && !Number.isFinite(p[k])) throw new MoveError('参数必须是有限数值');
  if (MOVE_DIRS[name] && !MOVE_DIRS[name].some(([v]) => v === p.dir)) throw new MoveError('请选择有效方向');
  if (!(p.duration > 0)) throw new MoveError('时长必须大于 0');
  const out = { points: null, closed: false, duration: p.duration, rotKeys: null };
  const [x, y, z] = position;
  switch (name) {
    case 'push_in':
    case 'pull_out': {
      const [ux, uz, d] = horizDir(position, aim);
      if (!(p.amount > 0)) throw new MoveError('距离必须大于 0');
      const k = name === 'push_in' ? p.amount : -p.amount;
      const minimum = Math.max(MIN_SUBJECT_DIST, p.minSubjectDist || 0);
      if (d - k < minimum) throw new MoveError(`推进距离过大：离主体至少保留 ${+minimum.toFixed(2)} m（当前 ${d.toFixed(2)} m）`);
      out.points = line(position, [x + ux * k, y, z + uz * k]);
      break;
    }
    case 'truck': {
      const [ux, uz] = horizDir(position, aim);
      if (!(p.amount > 0)) throw new MoveError('距离必须大于 0');
      const s = p.dir === 'right' ? -p.amount : p.amount; // 机位左方 = 前方 (ux,uz) 绕 +Y 转 90° = (uz, −ux)
      out.points = line(position, [x + uz * s, y, z - ux * s]);
      break;
    }
    case 'crane': {
      if (!(p.amount > 0)) throw new MoveError('距离必须大于 0');
      out.points = line(position, [x, y + (p.dir === 'down' ? -p.amount : p.amount), z]);
      break;
    }
    case 'pan': {
      const dx = aim[0] - x, dy = aim[1] - y, dz = aim[2] - z;
      if (Math.hypot(dx, dy, dz) < 1e-3) throw new MoveError('主体与机位重合，无法摇镜头');
      out.rotKeys = [rot.map(round6), aimRotation(position, aim, roll)];
      break;
    }
    case 'spiral':
    case 'half_orbit':
    case 'circle': {
      const center = [aim[0], y, aim[2]];
      const { radius, deg } = polar(center, position);
      if (radius < MIN_RADIUS) throw new MoveError('机位离主体太近，无法环绕');
      if (!(p.sweep > 0)) throw new MoveError('扫过角度必须大于 0');
      const sweep = Math.min(360, p.sweep) * (p.dir === 'cw' ? -1 : 1);
      const segments = Math.max(2, Math.ceil(Math.abs(sweep) / ORBIT_STEP));
      const r = arc({ center, radius, startDeg: deg, sweepDeg: sweep, y, segments });
      if (!r.closed) {
        const q = sweep / segments / 4;
        const at = (a) => arc({ center, radius, startDeg: a, sweepDeg: 0, y, segments: 1 }).points[0];
        r.points.splice(1, 0, at(deg + q));
        r.points.splice(r.points.length - 1, 0, at(deg + sweep - q));
      }
      r.points[0] = position.map(round6); // 首点 = 机位当前位置（消除 cos/sin 的舍入差）
      if (name === 'spiral') {
        if (!(p.rise > 0)) throw new MoveError('升高量必须大于 0');
        if (r.closed) r.points.push(position.map(round6));
        r.points = r.points.map((point, i, list) => [point[0], round6(y + p.rise * i / (list.length - 1)), point[2]]);
        r.closed = false;
      }
      out.points = r.points;
      out.closed = r.closed;
      break;
    }
    default: throw new MoveError(`未知运镜：${name}`);
  }
  return out;
}

/** 路径终点（闭合路径回到首点）。 */
export function pathEnd(path) {
  const pts = path.points;
  return (path.closed ? pts[0] : pts[pts.length - 1]).slice();
}

/** 闭合路径展开成首尾相接的开放点列（追加时用）。 */
const openPoints = (points, closed) => (closed ? [...points, points[0]] : points).map((q) => q.slice());

/**
 * 追加拼接：next 接在 path 后面。next 的首点必须与 path 的终点重合（运镜从路径终点生成）。
 * → 新的 path 字段：points 接续（去掉 next 首点；闭合的两边先展开）、duration 累加、closed = false，
 *   接缝顶点加一个停顿（stops），各段时长按名义时长分配（stopTimes：推 3 s + 半环绕 5 s → 接缝在 3 s）。
 * start / speed / orient 等其余字段保持。
 */
export function appendMove(path, next) {
  const end = pathEnd(path);
  const head = next.points[0];
  if (Math.hypot(head[0] - end[0], head[1] - end[1], head[2] - end[2]) > 1e-4) throw new MoveError('追加的运镜必须从现有路径的终点开始');
  const prev = openPoints(path.points, path.closed);
  const points = [...prev, ...openPoints(next.points, next.closed).slice(1)];
  if (path.timedSegments) return { ...path, points, closed: false, duration: round6(path.duration + next.duration),
    timedSegments: [...path.timedSegments, { from: prev.length - 1, to: points.length - 1, start: path.duration, end: round6(path.duration + next.duration), speed: 'smooth', ...(next.closed ? { closed: true } : {}) }] };
  if (path.waypointTimes) {
    const model = new Path({ ...next, start: 0, speed: 'smooth', orient: 'keep' });
    return { ...path, points, closed: false, duration: round6(path.duration + next.duration),
      stops: [...(path.stops || []), prev.length - 1],
      waypointTimes: [...path.waypointTimes, ...points.slice(prev.length).map((_, i) => round6(path.duration + model.vertexTime(i + 1)))] };
  }
  // A closed curve must retain its cyclic tangents; a linear prefix must not be
  // silently eased by the new seam. The existing timed segments carry both facts.
  if ((path.closed || path.speed === 'linear') && !path.stops?.length || next.closed) {
    const cuts = [0, ...(path.stops || []), prev.length - 1];
    const times = [0, ...new Path(path).segmentTimes];
    const timedSegments = cuts.slice(0, -1).map((from, i) => ({ from, to: cuts[i + 1], start: times[i], end: times[i + 1],
      speed: path.stops?.length ? 'smooth' : path.speed || 'smooth', ...(path.closed && cuts.length === 2 ? { closed: true } : {}) }));
    timedSegments.push({ from: prev.length - 1, to: points.length - 1, start: path.duration, end: round6(path.duration + next.duration), speed: 'smooth', ...(next.closed ? { closed: true } : {}) });
    const result = { ...path, points, closed: false, duration: round6(path.duration + next.duration), timedSegments };
    delete result.stops; delete result.stopTimes;
    return result;
  }
  // 已有停顿沿用（闭合路径展开后索引不变）；没有 stopTimes 的按当前（弧长比例）分配取到达时刻
  const stops = [...(path.stops || [])];
  const times = path.stops?.length ? (path.stopTimes?.length ? path.stopTimes.slice() : new Path(path).segmentTimes.slice(0, -1).map(round6)) : [];
  stops.push(prev.length - 1);
  times.push(round6(path.duration));
  return { ...path, points, closed: false, duration: round6(path.duration + next.duration), stops, stopTimes: times };
}

const sameSubject = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 新运镜段的注视窗口怎么并入机位已有的 lookAt 约束（只看 lookAt；时间单位秒）。
 * 新段的注视从 start 开始、一直保持到全程结束（end = null：运镜结束后继续盯着主体）。
 * cut = 已有注视在哪一刻让位给新段（带路径的段 cut = start；pan 的 cut = 摇的起点、start = 摇完那一刻）。
 * - 起点 ≥ cut 的旧约束整条删除（被新段覆盖）；
 * - 跨过 cut 的旧约束：同主体且 cut = start（中间无空档）→ 合并（沿用旧约束，end 改为 null，不新增）；否则 end 截到 cut。
 * @param {{id:string, subject, start:number|null, end:number|null}[]} lookAts 机位已有的 lookAt 约束
 * @param {{subject, cut:number, start:number}} seg
 * @returns {{remove:string[], patch:{id:string, end:number|null}[], add:{subject, start:number, end:null}|null}}
 */
export function lookAtWindows(lookAts, { subject, cut, start }) {
  const out = { remove: [], patch: [], add: { subject, start, end: null } };
  for (const c of lookAts) {
    const s0 = c.start ?? 0;
    if (s0 >= cut) { out.remove.push(c.id); continue; }
    const covers = c.end == null || c.end > cut;
    if (!covers) continue;
    if (out.add && cut === start && sameSubject(c.subject, subject)) {
      if (c.end != null) out.patch.push({ id: c.id, end: null });
      out.add = null;
    } else out.patch.push({ id: c.id, end: cut });
  }
  return out;
}
