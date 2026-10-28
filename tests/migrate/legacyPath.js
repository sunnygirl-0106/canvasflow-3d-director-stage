// Frozen numerical oracle from archive/before-slim-v3-phase2.
// @ts-check
import * as THREE from 'three';
import { EASE, smoothDeriv, clamp01 } from '../../src/anim/ease.js';

const MIN_SEGMENTS = 200;
const SEGMENTS_PER_POINT = 64;
const ARC_TOLERANCE = 1e-6; // 米；控制弧长反解的线性插值误差，尤其是起点和密集节点。

/**
 * 角色 / 组 speed=smooth 的起步 / 收步时长（秒）。整段 smoothstep 会把加速拉满全程（5 s 的路第 1 s 才到均速，
 * 步频跟着减半 = 慢动作），人起步 1 秒内就到步速，所以改成「加速 RAMP → 匀速 → 减速 RAMP」。机位不用（整段缓入缓出是运镜手感）。
 * 配合 Locomotion 的起步短步，步频从第一步起就正常。
 */
export const WALK_RAMP = 0.4;

/** 实体类型 → Path 的 ramp 选项。 */
export const rampFor = (type) => (type === 'camera' ? 0 : WALK_RAMP);

/** 角色 / 组沿路径步行：整段匀速，默认按步速估算时长。 */
export const isWalker = (type) => type === 'character' || type === 'group';

/** 人物整段按「总弧长 / 时长」匀速；旧文档的 smooth 也不再使人物加减速。 */
export const pathOptionsFor = (type) => ({ ramp: rampFor(type), uniform: isWalker(type) });

/**
 * 一段时长 dt、长 L 的位移曲线：x ∈ [0,dt] 秒 → [已走路程, 瞬时速度]。
 * linear 匀速；smooth 且 ramp=0：整段 smoothstep；smooth 且 ramp>0：smoothstep 速度爬升 r 秒 → 匀速 V → 对称减速，
 * r = min(ramp, dt/2)，V = L / (dt − r)（爬升段走 V·r/2：∫smoothstep = u³ − u⁴/2 在 1 处为 1/2）。两端速度为 0、全程 C¹。
 */
function profile(x, dt, L, ease, ramp) {
  if (!(dt > 0)) return [L, 0];
  x = Math.min(Math.max(x, 0), dt);
  if (ease !== 'smooth') return [L * x / dt, L / dt];
  if (!(ramp > 0)) { const u = x / dt; return [L * EASE.smooth(u), smoothDeriv(u) * L / dt]; }
  const r = Math.min(ramp, dt / 2), V = L / (dt - r);
  const F = (u) => u * u * u - u * u * u * u / 2;
  if (x < r) return [V * r * F(x / r), V * EASE.smooth(x / r)];
  const y = dt - x;
  if (y < r) return [L - V * r * F(y / r), V * EASE.smooth(y / r)];
  return [V * r / 2 + V * (x - r), V];
}

/** 一段 centripetal Catmull-Rom 曲线 + 自适应弧长表。 */
class Curve {
  constructor(points, closed) {
    this.curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed, 'centripetal');
    this.edges = closed ? points.length : points.length - 1; // 顶点间的边数
    const n = Math.max(MIN_SEGMENTS, points.length * SEGMENTS_PER_POINT);
    const parameters = [0], distances = [0];
    let prev = this.curve.getPoint(0);
    const append = (u0, p0, u1, p1, depth = 0) => {
      const mid = (u0 + u1) / 2, p = this.curve.getPoint(mid);
      // 仅检查弦长误差会漏掉直线上的非匀速参数化；同时控制参数中点的位置误差。
      if (depth < 12 && p.distanceTo(p0.clone().lerp(p1, 0.5)) > ARC_TOLERANCE) {
        append(u0, p0, mid, p, depth + 1);
        append(mid, p, u1, p1, depth + 1);
      } else {
        parameters.push(u1);
        distances.push(distances.at(-1) + p1.distanceTo(p0));
      }
    };
    for (let i = 1; i <= n; i++) {
      const cur = this.curve.getPoint(i / n);
      append((i - 1) / n, prev, i / n, cur);
      prev = cur;
    }
    this._u = new Float64Array(parameters);
    this._s = new Float64Array(distances);
    this._n = distances.length - 1;
    this.length = distances.at(-1);
  }

  /** 曲线参数 u → 弧长（弧长表线性插值）。 */
  sAt(u) {
    u = clamp01(u);
    let lo = 0, hi = this._n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this._u[mid] <= u) lo = mid; else hi = mid;
    }
    return this._s[lo] + (this._s[hi] - this._s[lo]) * (u - this._u[lo]) / (this._u[hi] - this._u[lo]);
  }

  /** 弧长 s → 曲线参数 u（二分 + 段内线性）。 */
  uAt(s) {
    const S = this._s, n = this._n;
    if (!(this.length > 0)) return 0;
    if (s <= 0) return 0;
    if (s >= this.length) return 1;
    let lo = 0, hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (S[mid] <= s) lo = mid; else hi = mid;
    }
    const seg = S[hi] - S[lo];
    return this._u[lo] + (this._u[hi] - this._u[lo]) * (seg > 0 ? (s - S[lo]) / seg : 0);
  }
}

/** Exact line segments; u assigns an equal interval to each edge, s uses true edge length. */
class Polyline {
  constructor(points, closed) {
    this.points = points.map(p => new THREE.Vector3(...p));
    if (closed) this.points.push(this.points[0].clone());
    this.edges = this.points.length - 1;
    this._s = [0];
    for (let i = 0; i < this.edges; i++) this._s.push(this._s[i] + this.points[i].distanceTo(this.points[i + 1]));
    this.length = this._s[this.edges];
    this.curve = {
      getPoint: (u, out = new THREE.Vector3()) => {
        const x = clamp01(u) * this.edges, i = Math.min(this.edges - 1, Math.floor(x));
        return out.copy(this.points[i]).lerp(this.points[i + 1], x - i);
      },
      getTangent: (u, out = new THREE.Vector3()) => {
        let i = Math.min(this.edges - 1, Math.floor(clamp01(u) * this.edges));
        while (i < this.edges - 1 && this._s[i + 1] === this._s[i]) i++;
        return out.subVectors(this.points[i + 1], this.points[i]).normalize();
      },
    };
  }
  sAt(u) {
    const x = clamp01(u) * this.edges, i = Math.min(this.edges - 1, Math.floor(x));
    return this._s[i] + (this._s[i + 1] - this._s[i]) * (x - i);
  }
  uAt(s) {
    if (!(this.length > 0) || s <= 0) return 0;
    if (s >= this.length) return 1;
    let i = 0;
    while (i < this.edges - 1 && s >= this._s[i + 1]) i++;
    return (i + (s - this._s[i]) / (this._s[i + 1] - this._s[i])) / this.edges;
  }
}

/**
 * 路径曲线（文档 Path 的只读视图）：centripetal Catmull-Rom + 弧长表，按弧长 s（米）取位置 / 切线。
 * 时间 → 弧长：progress(t) 把 (t − start) / duration 夹到 [0,1] 后按 speed 曲线映射（linear 匀速 / smooth 缓入缓出），
 * distanceAt(t) = progress × 全长。start 之前停在起点、结束之后停在终点。纯函数，无内部状态。
 *
 * 停顿 stops（可选）：顶点索引升序、不含首尾。有 stops 时路径在这些顶点处断成几段，
 * 每段是独立的 Catmull-Rom（停顿处速度为 0，允许折角，所以推镜头那段是严格的直线）；
 * 每段各自缓入缓出（无论 speed），各段时长 = stopTimes（相对 start 的到达时刻，可选）或按弧长比例分配。
 * 起步 / 收步（ramp 选项，角色 / 组）：smooth 不再整段缓入缓出，而是 ramp 秒加速 → 匀速 → ramp 秒减速（见 profile）。
 * 闭合路径有 stops 时按 [p0 … pn−1, p0] 的开放点列处理。
 */
export class Path {
  /** @param {object} json 文档 Path @param {{ramp?:number, uniform?:boolean}} [opts] uniform：人物匀速；显式停顿仍按段处理。 */
  constructor(json, { ramp = 0, uniform = false } = {}) {
    this.json = uniform && !json.timedSegments?.length ? { ...json, speed: 'linear' } : json;
    this.ramp = uniform && !json.stops?.length && !json.timedSegments?.length ? 0 : ramp;
    const geometry = (points, closed) => json.interpolation === 'polyline' || (!closed && points.length === 2)
      ? new Polyline(points, closed) : new Curve(points, closed);
    const timed = json.timedSegments;
    const stops = timed?.length ? timed.slice(0, -1).map(s => s.to) : json.stops?.length ? json.stops : null;
    if (!stops) {
      this.curves = [geometry(json.points, json.closed)];
      this._vs = [0];
    } else {
      const pts = json.closed ? [...json.points, json.points[0]] : json.points;
      const cuts = [0, ...stops, pts.length - 1];
      this.curves = [];
      for (let i = 0; i + 1 < cuts.length; i++) {
        const loop = !!timed?.[i].closed;
        this.curves.push(geometry(pts.slice(cuts[i], cuts[i + 1] + (loop ? 0 : 1)), loop));
      }
      this._vs = cuts.slice(0, -1); // 各段首顶点的索引
    }
    // 各段起点弧长 S[k] 与（相对 start 的）起点时刻 T[k]，末项为全长 / 时长
    this._S = [0];
    for (const c of this.curves) this._S.push(this._S[this._S.length - 1] + c.length);
    this.length = this._S[this._S.length - 1];
    this.timedSegments = timed || null;
    this.waypointTimes = json.waypointTimes || null;
    if (this.waypointTimes) {
      const T = this.waypointTimes;
      this._waypointS = T.map((_, i) => this.vertexDistance(i));
      const slopes = T.slice(0, -1).map((v, i) => (this._waypointS[i + 1] - this._waypointS[i]) / (T[i + 1] - v));
      this._waypointV = T.map((_, i) => i === 0 || i === T.length - 1 || json.stops?.includes(i) ? 0
        : slopes[i - 1] * slopes[i] <= 0 ? 0 : 2 * slopes[i - 1] * slopes[i] / (slopes[i - 1] + slopes[i]));
    }
    const D = json.duration;
    this._T = stops
      ? [0, ...(json.stopTimes?.length === stops.length ? json.stopTimes : this._S.slice(1, -1).map((s) => (this.length > 0 ? D * s / this.length : 0))), D]
      : [0, D];
  }

  /** 弧长 s 所在的段下标与段内弧长。 */
  _seg(s) {
    const S = this._S;
    let k = 0;
    while (k < this.curves.length - 1 && s > S[k + 1]) k++;
    return [k, s - S[k]];
  }

  /** 弧长 s → 曲线参数 u（无 stops 时整条曲线的 u；有 stops 时为所在段的 u）。 */
  uAt(s) { const [k, ls] = this._seg(s); return this.curves[k].uAt(ls); }

  /** 弧长 s 落在哪条边上（顶点 i → i+1 的 i；闭合路径最后一条边回到 0）。点击曲线插入顶点用。 */
  edgeAt(s) {
    const [k, ls] = this._seg(s);
    const c = this.curves[k];
    return this._vs[k] + Math.min(c.edges - 1, Math.floor(c.uAt(ls) * c.edges + 1e-9));
  }

  positionAt(s, out = new THREE.Vector3()) {
    const [k, ls] = this._seg(s);
    return this.curves[k].curve.getPoint(this.curves[k].uAt(ls), out);
  }

  /** 单位切线（全长为 0 时返回 null）。 */
  tangentAt(s, out = new THREE.Vector3()) {
    if (!(this.length > 0)) return null;
    let [k, ls] = this._seg(s);
    while (!(this.curves[k].length > 0) && k > 0) { k--; ls = this.curves[k].length; } // 零长段：取前一段末端
    const c = this.curves[k];
    return c.curve.getTangent(c.uAt(ls), out).normalize();
  }

  /** 顶点 i 处的弧长（米）。 */
  vertexDistance(i) {
    let k = this._vs.length - 1;
    while (k > 0 && this._vs[k] > i) k--;
    const c = this.curves[k];
    return this._S[k] + c.sAt((i - this._vs[k]) / c.edges);
  }

  /** 路径节点的实际到达时刻，反解运动曲线（含缓入缓出和停顿）。闭合末节点回到起点。 */
  vertexTime(i) {
    const { start, duration, points, closed } = this.json;
    if (i <= 0) return start;
    if (i >= points.length - (closed ? 0 : 1)) return start + duration;
    const distance = this.vertexDistance(i);
    let lo = start, hi = start + duration;
    for (let j = 0; j < 40; j++) {
      const mid = (lo + hi) / 2;
      if (this.distanceAt(mid) < distance) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** 各段到达终点的时刻（相对 start，秒；末项 = duration）。 */
  get segmentTimes() { return this._T.slice(1); }

  /** t 时刻的进度 ∈ [0,1]（已走弧长 / 全长）。 */
  progress(t) {
    if (this.waypointTimes) return this.length > 0 ? this.distanceAt(t) / this.length : 0;
    if (this.curves.length === 1 && !this.ramp) {
      const { start, duration, speed } = this.json;
      return EASE[speed](clamp01((t - start) / duration));
    }
    return this.length > 0 ? this.distanceAt(t) / this.length : clamp01((t - this.json.start) / this.json.duration);
  }

  /** 有 stops 时 t 所在的段与段内进度 x ∈ [0,1]（按段缓入缓出）。 */
  _segTime(t) {
    const T = this._T, x = t - this.json.start;
    let k = 0;
    while (k < T.length - 2 && x >= T[k + 1]) k++;
    const dt = T[k + 1] - T[k];
    return [k, dt > 0 ? (x - T[k]) / dt : 1, dt];
  }

  /** t 时刻已走的路程（米）。 */
  distanceAt(t) {
    if (this.waypointTimes) return this._waypointMotion(t)[0];
    if (this.timedSegments) {
      const x = t - this.json.start;
      for (let k = 0; k < this.timedSegments.length; k++) {
        const seg = this.timedSegments[k];
        if (x < seg.start) return this._S[k];
        if (x <= seg.end) return this._S[k] + profile(x - seg.start, seg.end - seg.start, this._S[k + 1] - this._S[k], seg.speed || this.json.speed, this.ramp)[0];
      }
      return this.length;
    }
    if (this.curves.length === 1 && !this.ramp) return this.progress(t) * this.length;
    const [k, x, dt] = this._segTime(t);
    const ease = this.curves.length === 1 ? this.json.speed : 'smooth';
    return this._S[k] + profile(clamp01(x) * dt, dt, this._S[k + 1] - this._S[k], ease, this.ramp)[0];
  }

  /** t 时刻的瞬时速度（米/秒）：弧长对时间的导数（解析式；区间外为 0）。 */
  speedAt(t) {
    if (this.waypointTimes) return this._waypointMotion(t)[1];
    if (this.timedSegments) {
      const x = t - this.json.start;
      const k = this.timedSegments.findIndex(s => x > s.start && x < s.end);
      if (k < 0) return 0;
      const seg = this.timedSegments[k];
      return profile(x - seg.start, seg.end - seg.start, this._S[k + 1] - this._S[k], seg.speed || this.json.speed, this.ramp)[1];
    }
    const { start, duration, speed } = this.json;
    const x = (t - start) / duration;
    if (x < 0 || x > 1) return 0;
    if (this.curves.length === 1 && !this.ramp) return (speed === 'smooth' ? smoothDeriv(x) : 1) * this.length / duration;
    const [k, u, dt] = this._segTime(t);
    const ease = this.curves.length === 1 ? speed : 'smooth';
    return dt > 0 ? profile(clamp01(u) * dt, dt, this._S[k + 1] - this._S[k], ease, this.ramp)[1] : 0;
  }

  /** 指定经过节点的时间，节点间使用单调三次 Hermite；内部节点速度连续且不停车。 */
  _waypointMotion(t) {
    const T = this.waypointTimes, x = t - this.json.start;
    if (x <= T[0]) return [0, 0];
    if (x >= T.at(-1)) return [this.length, 0];
    const S = this._waypointS, velocity = this._waypointV;
    let i = 0;
    while (i < T.length - 2 && x > T[i + 1]) i++;
    const dt = T[i + 1] - T[i], u = (x - T[i]) / dt, a = S[i], b = S[i + 1];
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u;
    const h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
    const distance = h00 * a + h10 * dt * velocity[i] + h01 * b + h11 * dt * velocity[i + 1];
    const speed = ((6 * u ** 2 - 6 * u) * a + (3 * u ** 2 - 4 * u + 1) * dt * velocity[i]
      + (-6 * u ** 2 + 6 * u) * b + (3 * u ** 2 - 2 * u) * dt * velocity[i + 1]) / dt;
    return [distance, Math.max(0, speed)];
  }
}
