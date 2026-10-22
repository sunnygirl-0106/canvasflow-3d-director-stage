import * as THREE from 'three';
import { Path } from './Path.js';
import { EASE, clamp01 } from './ease.js';

const _p = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _e = new THREE.Euler();

/** 机位 / 道具起步转身距离（米）：朝向从手动朝向插值到切线，走完这段完全跟切线。太短会转得过快（转身峰值需 ≤ 15°/帧）。 */
export const TURN_IN_DIST = 0.8;
const POSE_BLEND = 0.5; // 只衔接站姿与步态，不影响位移速度或步态相位。

/** 角度差 b − a 规整到 (−π, π]（最短方向）。 */
const angleDiff = (a, b) => { const d = (b - a) % (2 * Math.PI); return d > Math.PI ? d - 2 * Math.PI : d <= -Math.PI ? d + 2 * Math.PI : d; };

/**
 * 实体沿路径移动：写位置；orient='tangent' 时把朝向的 yaw 换成切线方向（俯仰 / 滚转保留）。
 * 角色 / 组立即面朝路径切线；机位 / 道具起步平滑转身：yaw = 手动朝向 yaw（进入路径前的 st，即 base / rot 轨道）→ 切线 yaw 的最短方向插值，
 * 进度 = 已走路程 ÷ TURN_IN_DIST（夹到 [0,1]）。按路程不按时间，evaluate(t) 仍是纯函数；
 * 角色在 t ≤ start 时已对齐出发方向，无需等待起步转身。
 * 角色 / 组的路径点 y 是地面高度（= 文档 transform.pos.y），按实体 docOpts 换算成 root 值。
 * 朝前的轴：机位 −Z（镜头方向），其余 +Z（角色面朝 +Z）。
 * 把 { speed, distance } 记到状态上（st.motion），供 Locomotion 使用。
 */
export class PathTrack {
  /** @param {object} json @param {number|object} [options] Path 选项，兼容旧的 ramp 数值。 */
  constructor(json, options = 0) {
    this.json = json;
    this.path = new Path(json, typeof options === 'number' ? { ramp: options } : options);
  }

  apply(t, st) {
    const { path } = this;
    const s = path.distanceAt(t);
    path.positionAt(s, _p);
    const off = st.opts.posOffset;
    st.position.set(_p.x + off[0], _p.y + off[1], _p.z + off[2]);

    if (this.json.orient === 'tangent' && path.tangentAt(s, _tan)) {
      const h = Math.hypot(_tan.x, _tan.z);
      if (h > 1e-6) { // 竖直段没有水平朝向：保留原 yaw
        const back = st.ent.type === 'camera';
        const yaw = back ? Math.atan2(-_tan.x, -_tan.z) : Math.atan2(_tan.x, _tan.z);
        _e.setFromQuaternion(st.quaternion, 'YXZ');
        const k = ['character', 'group'].includes(st.ent.type) ? 1 : Math.min(1, s / TURN_IN_DIST);
        _e.y = k >= 1 ? yaw : _e.y + angleDiff(_e.y, yaw) * k;
        st.quaternion.setFromEuler(_e);
        st.rotTouched = true;
      }
    }
    // 精确起止时刻呈现站姿；第一帧实际位移就使用整段匀速，不添加加减速区间。
    const moving = t > this.json.start && t < this.json.start + this.json.duration;
    const blend = EASE.smooth(clamp01(Math.min(t - this.json.start, this.json.start + this.json.duration - t) / POSE_BLEND));
    st.motion = { speed: moving ? path.speedAt(t) : 0, distance: s, gaitTime: Math.max(0, Math.min(t - this.json.start, this.json.duration)), blend };
  }
}
