import * as THREE from 'three';
import { Path } from './Path.js';

const _p = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _e = new THREE.Euler();

/** 起步转身距离（米）：朝向从手动朝向插值到切线，走完这段完全跟切线。 */
export const TURN_IN_DIST = 0.6;

/** 角度差 b − a 规整到 (−π, π]（最短方向）。 */
const angleDiff = (a, b) => { const d = (b - a) % (2 * Math.PI); return d > Math.PI ? d - 2 * Math.PI : d <= -Math.PI ? d + 2 * Math.PI : d; };

/**
 * 实体沿路径移动：写位置；orient='tangent' 时把朝向的 yaw 换成切线方向（俯仰 / 滚转保留）。
 * 起步平滑转身：yaw = 手动朝向 yaw（进入路径前的 st，即 base / rot 轨道）→ 切线 yaw 的最短方向插值，
 * 进度 = 已走路程 ÷ TURN_IN_DIST（夹到 [0,1]）。按路程不按时间，evaluate(t) 仍是纯函数；
 * 所以 t ≤ start 时朝向 = 手动朝向，speed=smooth 起步慢、转身也慢。
 * 角色 / 组的路径点 y 是地面高度（= 文档 transform.pos.y），按实体 docOpts 换算成 root 值。
 * 朝前的轴：机位 −Z（镜头方向），其余 +Z（角色面朝 +Z）。
 * 把 { speed, distance } 记到状态上（st.motion），供 Locomotion 使用。
 */
export class PathTrack {
  constructor(json) {
    this.json = json;
    this.path = new Path(json);
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
        const k = Math.min(1, s / TURN_IN_DIST);
        _e.y = k >= 1 ? yaw : _e.y + angleDiff(_e.y, yaw) * k;
        st.quaternion.setFromEuler(_e);
        st.rotTouched = true;
      }
    }
    st.motion = { speed: path.speedAt(t), distance: s, gaitDistance: path.gaitDistanceAt(t) };
  }
}
