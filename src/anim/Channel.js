import * as THREE from 'three';
import { EASE } from './ease.js';
import { D2R } from '../util/math.js';

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _e = new THREE.Euler();

/** 文档欧拉角（度，XYZ）→ 四元数。 */
export const quatFromDeg = (v, out = new THREE.Quaternion()) => out.setFromEuler(_e.set(v[0] * D2R, v[1] * D2R, v[2] * D2R, 'XYZ'));

/**
 * 一条属性的关键帧序列（文档 keys 的只读视图）：evaluate(t) → 值。
 * - 'vec3'：逐分量线性插值（pos / scale），返回 [x,y,z]；
 * - 'quat'：欧拉角度数 → 四元数 → slerp（rot），返回 THREE.Quaternion（只在最终写入 root 时才转回欧拉）；
 * - 'number'：线性插值（fov）。
 * t 在首键前取首键，末键后取末键；ease 作用于"从该键出发"的那一段。纯函数，无内部状态。
 */
export class Channel {
  /** @param {{t:number, value:any, ease:string}[]} keys 严格递增（已校验） @param {'vec3'|'quat'|'number'} kind */
  constructor(keys, kind) {
    this.keys = keys;
    this.kind = kind;
    this._quats = kind === 'quat' ? keys.map((k) => quatFromDeg(k.value)) : null;
  }

  /** 最后一个 t ≤ 给定时刻的键下标（t 早于首键时为 -1）。 */
  _index(t) {
    const k = this.keys;
    let lo = 0, hi = k.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (k[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  /** @param {number} t 秒 @param {THREE.Quaternion} [out] quat 通道的输出对象 */
  evaluate(t, out) {
    const k = this.keys;
    const i = this._index(t);
    let a, b, u;
    if (i < 0) { a = b = 0; u = 0; }
    else if (i >= k.length - 1) { a = b = k.length - 1; u = 0; }
    else {
      a = i; b = i + 1;
      u = EASE[k[a].ease]((t - k[a].t) / (k[b].t - k[a].t));
    }
    if (this.kind === 'quat') {
      out = out || new THREE.Quaternion();
      if (a === b || u === 0) return out.copy(this._quats[a]);
      return out.slerpQuaternions(_qa.copy(this._quats[a]), _qb.copy(this._quats[b]), u);
    }
    const va = k[a].value, vb = k[b].value;
    if (this.kind === 'number') return va + (vb - va) * u;
    return [0, 1, 2].map((n) => va[n] + (vb[n] - va[n]) * u);
  }
}
