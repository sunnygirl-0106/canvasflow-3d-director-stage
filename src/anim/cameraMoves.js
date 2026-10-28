// @ts-check
import * as THREE from 'three';
import { line, arc, polar, markedSchedule, intervalSchedule } from './pathGen.js';
import { endpointSchedule, pathCurve, motionEntries, stopEntries, scheduleSegments } from './schedule.js';
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

/** 运镜目录：AI 顺序沿用词汇表；panelOrder 为面板顺序，null 表示不在面板中出现。
 * params 为两端共用的参数列；aiLabel=null 的预设仅供面板使用。
 * 保留 legacy AI defaults；面板默认时长仍全部为 2 秒。
 */
const MOVE_CATALOG = [
  { name: 'push_in', aiLabel: '推', panelLabel: '推近', aiDuration: 3, panelDuration: 2, params: ['amount'], panelOrder: 2 },
  { name: 'pull_out', aiLabel: '拉', panelLabel: '拉远', aiDuration: 3, panelDuration: 2, params: ['amount'], panelOrder: 3 },
  { name: 'truck', aiLabel: '横移', panelLabel: '横移', aiDuration: 3, panelDuration: 2, params: ['amount', 'dir'], panelOrder: 5 },
  { name: 'crane', aiLabel: '升降', panelLabel: '升降', aiDuration: 3, panelDuration: 2, params: ['amount', 'dir'], panelOrder: 4 },
  { name: 'pan', aiLabel: '摇', panelLabel: '摇镜头', aiDuration: 2, panelDuration: 2, params: [], panelOrder: null },
  { name: 'half_orbit', aiLabel: '半环绕', panelLabel: '半弧', aiDuration: 5, panelDuration: 2, params: ['sweep', 'dir'], panelOrder: 1 },
  { name: 'circle', aiLabel: '环绕', panelLabel: '环绕', aiDuration: 8, panelDuration: 2, params: ['sweep', 'dir'], panelOrder: 0 },
  { name: 'spiral', aiLabel: null, panelLabel: '螺旋上升', aiDuration: null, panelDuration: 2, params: ['sweep', 'rise', 'dir'], panelOrder: 6 },
];
const AI_MOVES = MOVE_CATALOG.filter(move => move.aiLabel !== null);
const PANEL_ORDER = [...MOVE_CATALOG].sort((a, b) => (a.panelOrder ?? Infinity) - (b.panelOrder ?? Infinity));
export const CAMERA_MOVES = AI_MOVES.map(move => [move.name, move.aiLabel]);
export const MOVE_LABEL = Object.fromEntries(CAMERA_MOVES);
export const MOVE_DURATION = Object.fromEntries(AI_MOVES.map(move => [move.name, move.aiDuration]));
export const MOVE_PARAMS = Object.fromEntries(AI_MOVES.map(move => [move.name, move.params]));
export const PANEL_LABEL = Object.fromEntries(MOVE_CATALOG.map(move => [move.name, move.panelLabel]));
export const PANEL_MOVES = PANEL_ORDER.filter(move => move.panelOrder !== null).map(move => move.name);
export const PANEL_DURATION = Object.fromEntries(PANEL_ORDER.map(move => [move.name, move.panelDuration]));
export const PANEL_PARAMS = Object.fromEntries(MOVE_CATALOG.map(move => [move.name, move.params]));

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

/** @typedef {{duration?:number, amount?:number, sweep?:number, rise?:number, dir?:string, minSubjectDist?:number}} MoveParams */

/**
 * 预设默认参数（含 duration）。
 * @param {string} name 预设名
 * @param {{position:number[], aim:number[]}} ctx 机位位置与主体注视点（文档口径）
 */
export function defaultParams(name, { position, aim }) {
  const d = hdist(position, aim);
  /** @type {MoveParams} */
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
 *   接缝顶点加一个停顿（stops），各段时长按名义时长分配（推 3 s + 半环绕 5 s → 接缝在 3 s）。
 * start / speed / orient 等其余字段保持。
 */
export function appendMove(path, next) {
  const end = pathEnd(path);
  const head = next.points[0];
  if (Math.hypot(head[0] - end[0], head[1] - end[1], head[2] - end[2]) > 1e-4) throw new MoveError('追加的运镜必须从现有路径的终点开始');
  const prev = openPoints(path.points, path.closed);
  const points = [...prev, ...openPoints(next.points, next.closed).slice(1)];
  const duration = round6(path.duration + next.duration), first = path.schedule[0];
  const result = { ...path, points, closed: false, duration };
  const tail = { from: prev.length - 1, to: points.length - 1, start: path.duration, end: duration, curve: 'smooth', closed: next.closed };
  if (first.segmented) return { ...result, schedule: intervalSchedule(result, [...scheduleSegments(path), tail]) };
  if (first.curve === 'cubic') {
    const model = new Path({ ...next, start: 0, schedule: endpointSchedule(next.points, next.closed, next.duration, 'smooth'), orient: 'keep' });
    const entries = motionEntries(path).map(entry => ({ ...entry }));
    entries.at(-1).stop = true;
    return { ...result, schedule: [...entries,
      ...points.slice(prev.length).map((_, i) => ({ i: prev.length + i, t: round6(path.duration + model.vertexTime(i + 1)) }))] };
  }
  const markers = stopEntries(path), curve = pathCurve(path);
  // Cyclic tangents and a linear prefix must survive appending a new motion.
  if ((path.closed || curve === 'linear') && !markers.length || next.closed) {
    const cuts = [0, ...markers.map(entry => entry.i), prev.length - 1];
    const times = [0, ...new Path(path).segmentTimes];
    const sections = cuts.slice(0, -1).map((from, i) => ({ from, to: cuts[i + 1], start: times[i], end: times[i + 1],
      curve: markers.length ? 'smooth' : curve || 'smooth', closed: path.closed && cuts.length === 2 }));
    return { ...result, schedule: intervalSchedule(result, [...sections, tail]) };
  }
  const times = markers.length ? (first.allocation === 'distance' ? new Path(path).segmentTimes.slice(0, -1).map(round6) : markers.map(entry => entry.t)) : [];
  return { ...result, schedule: markedSchedule(result, [...markers.map(entry => entry.i), prev.length - 1], [...times, round6(path.duration)], curve) };
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
