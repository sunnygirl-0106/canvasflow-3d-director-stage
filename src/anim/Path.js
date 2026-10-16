import * as THREE from 'three';
import { EASE, smoothDeriv, clamp01 } from './ease.js';

const MIN_SEGMENTS = 200;
const SEGMENTS_PER_POINT = 64;

/**
 * 路径曲线（文档 Path 的只读视图）：centripetal Catmull-Rom + 弧长表，按弧长 s（米）取位置 / 切线。
 * 时间 → 弧长：progress(t) 把 (t − start) / duration 夹到 [0,1] 后按 speed 曲线映射（linear 匀速 / smooth 缓入缓出），
 * distanceAt(t) = progress × 全长。start 之前停在起点、结束之后停在终点。纯函数，无内部状态。
 */
export class Path {
  /** @param {object} json 文档 Path */
  constructor(json) {
    this.json = json;
    this.curve = new THREE.CatmullRomCurve3(json.points.map((p) => new THREE.Vector3(...p)), json.closed, 'centripetal');
    // 弧长表：均匀参数 u 采样，累计弦长
    const n = Math.max(MIN_SEGMENTS, json.points.length * SEGMENTS_PER_POINT);
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

  positionAt(s, out = new THREE.Vector3()) { return this.curve.getPoint(this.uAt(s), out); }

  /** 单位切线（全长为 0 时返回 null）。 */
  tangentAt(s, out = new THREE.Vector3()) {
    if (!(this.length > 0)) return null;
    return this.curve.getTangent(this.uAt(s), out).normalize();
  }

  /** t 时刻的进度 ∈ [0,1]。 */
  progress(t) {
    const { start, duration, speed } = this.json;
    return EASE[speed](clamp01((t - start) / duration));
  }

  /** t 时刻已走的路程（米）。 */
  distanceAt(t) { return this.progress(t) * this.length; }

  /** t 时刻的瞬时速度（米/秒）：弧长对时间的导数（解析式；区间外为 0）。 */
  speedAt(t) {
    const { start, duration, speed } = this.json;
    const x = (t - start) / duration;
    if (x < 0 || x > 1) return 0;
    return (speed === 'smooth' ? smoothDeriv(x) : 1) * this.length / duration;
  }
}
