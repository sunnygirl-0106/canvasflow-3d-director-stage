import * as THREE from 'three';
import { EASE, smoothDeriv, clamp01 } from './ease.js';
import { cycleFactor } from './Locomotion.js';

const MIN_SEGMENTS = 200;
const SEGMENTS_PER_POINT = 64;
const GAIT_SAMPLES = 512; // 步态相位积分表的采样数

/**
 * 角色 / 组 speed=smooth 的起步 / 收步时长（秒）。整段 smoothstep 会把加速拉满全程（5 s 的路第 1 s 才到均速，
 * 步频跟着减半 = 慢动作），人起步 1 秒内就到步速，所以改成「加速 RAMP → 匀速 → 减速 RAMP」。机位不用（整段缓入缓出是运镜手感）。
 */
export const WALK_RAMP = 0.8;

/** 实体类型 → Path 的 ramp 选项。 */
export const rampFor = (type) => (type === 'camera' ? 0 : WALK_RAMP);

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

/** 一段 centripetal Catmull-Rom 曲线 + 弧长表（均匀参数 u 采样，累计弦长）。 */
class Curve {
  constructor(points, closed) {
    this.curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed, 'centripetal');
    this.edges = closed ? points.length : points.length - 1; // 顶点间的边数
    const n = Math.max(MIN_SEGMENTS, points.length * SEGMENTS_PER_POINT);
    this._s = new Float64Array(n + 1);
    const prev = this.curve.getPoint(0), cur = new THREE.Vector3();
    for (let i = 1; i <= n; i++) {
      this.curve.getPoint(i / n, cur);
      this._s[i] = this._s[i - 1] + cur.distanceTo(prev);
      prev.copy(cur);
    }
    this._n = n;
    this.length = this._s[n];
  }

  /** 曲线参数 u → 弧长（弧长表线性插值）。 */
  sAt(u) {
    const x = Math.min(Math.max(u, 0), 1) * this._n, i = Math.min(Math.floor(x), this._n - 1);
    return this._s[i] + (this._s[i + 1] - this._s[i]) * (x - i);
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
    return (lo + (seg > 0 ? (s - S[lo]) / seg : 0)) / n;
  }
}

/**
 * 路径曲线（文档 Path 的只读视图）：centripetal Catmull-Rom + 弧长表，按弧长 s（米）取位置 / 切线。
 * 时间 → 弧长：progress(t) 把 (t − start) / duration 夹到 [0,1] 后按 speed 曲线映射（linear 匀速 / smooth 缓入缓出），
 * distanceAt(t) = progress × 全长。start 之前停在起点、结束之后停在终点。纯函数，无内部状态。
 *
 * 停顿 stops（收尾 1，可选）：顶点索引升序、不含首尾。有 stops 时路径在这些顶点处断成几段，
 * 每段是独立的 Catmull-Rom（停顿处速度为 0，允许折角，所以推镜头那段是严格的直线）；
 * 每段各自缓入缓出（无论 speed），各段时长 = stopTimes（相对 start 的到达时刻，可选）或按弧长比例分配。
 * 起步 / 收步（ramp 选项，角色 / 组）：smooth 不再整段缓入缓出，而是 ramp 秒加速 → 匀速 → ramp 秒减速（见 profile）。
 * 闭合路径有 stops 时按 [p0 … pn−1, p0] 的开放点列处理。
 */
export class Path {
  /** @param {object} json 文档 Path @param {{ramp?:number}} [opts] ramp：smooth 的起步 / 收步秒数（0 = 整段缓入缓出；角色传 rampFor(type)） */
  constructor(json, { ramp = 0 } = {}) {
    this.json = json;
    this.ramp = ramp;
    const stops = json.stops?.length ? json.stops : null;
    if (!stops) {
      this.curves = [new Curve(json.points, json.closed)];
      this._vs = [0];
    } else {
      const pts = json.closed ? [...json.points, json.points[0]] : json.points;
      const cuts = [0, ...stops, pts.length - 1];
      this.curves = [];
      for (let i = 0; i + 1 < cuts.length; i++) this.curves.push(new Curve(pts.slice(cuts[i], cuts[i + 1] + 1), false));
      this._vs = cuts.slice(0, -1); // 各段首顶点的索引
    }
    // 各段起点弧长 S[k] 与（相对 start 的）起点时刻 T[k]，末项为全长 / 时长
    this._S = [0];
    for (const c of this.curves) this._S.push(this._S[this._S.length - 1] + c.length);
    this.length = this._S[this._S.length - 1];
    const D = json.duration;
    this._T = stops
      ? [0, ...(json.stopTimes?.length === stops.length ? json.stopTimes : this._S.slice(1, -1).map((s) => (this.length > 0 ? D * s / this.length : 0))), D]
      : [0, D];
    this.curve = this.curves[0].curve; // 兼容：无 stops 时就是整条曲线
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

  /** 各段到达终点的时刻（相对 start，秒；末项 = duration）。 */
  get segmentTimes() { return this._T.slice(1); }

  /** t 时刻的进度 ∈ [0,1]（已走弧长 / 全长）。 */
  progress(t) {
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
    if (this.curves.length === 1 && !this.ramp) return this.progress(t) * this.length;
    const [k, x, dt] = this._segTime(t);
    const ease = this.curves.length === 1 ? this.json.speed : 'smooth';
    return this._S[k] + profile(clamp01(x) * dt, dt, this._S[k + 1] - this._S[k], ease, this.ramp)[0];
  }

  /**
   * 步态路程：∫ v / cycleFactor(v) dt（从 start 积到 t）。除以身高即得相位（周期数）。
   * 纯走 / 纯跑时等于 路程 ÷ 周期系数；走跑混合时周期长度随速度变，积分保证相位单调、不倒退。
   * 积分表在首次调用时建（梯形法，GAIT_SAMPLES 段），之后线性插值 —— 只依赖文档，仍是纯函数。
   */
  gaitDistanceAt(t) {
    const { start, duration } = this.json;
    if (!this._gait) {
      const n = GAIT_SAMPLES, g = new Float64Array(n + 1);
      const f = (i) => { const v = this.speedAt(start + (i / n) * duration); return v / cycleFactor(v); };
      let prev = f(0);
      for (let i = 1; i <= n; i++) { const cur = f(i); g[i] = g[i - 1] + (prev + cur) / 2 * (duration / n); prev = cur; }
      this._gait = g;
    }
    const x = clamp01((t - start) / duration) * GAIT_SAMPLES;
    const i = Math.min(Math.floor(x), GAIT_SAMPLES - 1);
    return this._gait[i] + (this._gait[i + 1] - this._gait[i]) * (x - i);
  }

  /** t 时刻的瞬时速度（米/秒）：弧长对时间的导数（解析式；区间外为 0）。 */
  speedAt(t) {
    const { start, duration, speed } = this.json;
    const x = (t - start) / duration;
    if (x < 0 || x > 1) return 0;
    if (this.curves.length === 1 && !this.ramp) return (speed === 'smooth' ? smoothDeriv(x) : 1) * this.length / duration;
    const [k, u, dt] = this._segTime(t);
    const ease = this.curves.length === 1 ? speed : 'smooth';
    return dt > 0 ? profile(clamp01(u) * dt, dt, this._S[k + 1] - this._S[k], ease, this.ramp)[1] : 0;
  }
}
