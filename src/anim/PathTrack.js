import * as THREE from 'three';
import { Path } from './Path.js';

const _p = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _e = new THREE.Euler();

/**
 * 实体沿路径移动：写位置；orient='tangent' 时把朝向的 yaw 换成切线方向（俯仰 / 滚转保留）。
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
        _e.y = yaw;
        st.quaternion.setFromEuler(_e);
        st.rotTouched = true;
      }
    }
    st.motion = { speed: path.speedAt(t), distance: s, gaitDistance: path.gaitDistanceAt(t) };
  }
}
