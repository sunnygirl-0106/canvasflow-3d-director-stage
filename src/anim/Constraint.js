import * as THREE from 'three';
import { EASE, clamp01 } from './ease.js';

// 约束（evaluate 的最后一步，作用在机位上）。坐标一律是场景根节点（stage.world）下的局部坐标，
// 与文档 transform 同一口径：机位都是顶层实体，subject 若是群众成员则经组的变换换算过来。
//
// - lookAt：机位 −Z 对准 subject 的注视点，再叠加机位自身的荷兰角 roll（与 CameraEntity.aimAt 一致）。
//   入场 / 退场混合（收尾 1）：start > 0 时在 [start, start+0.5 s] 内从"约束前的朝向"slerp 到注视朝向（进度 smoothstep）；
//   end 非空时在 [end−0.5 s, end] 内从注视朝向 slerp 回约束前的朝向。start 为 null / 0 时直接全量生效（t=0 之前没有"约束前"）。
//   接力：同一机位上一条 lookAt 的 end 恰好等于这条的 start 时，上一条不做退场，这一条从上一条的注视朝向转过来。
// - follow（产品确认为刚性跟随）：位置 = subject 锚点 + Ry(subject yaw)·offset；
//   朝向 = Ry(subject yaw) × 机位原朝向（关键帧 / 路径 / 手动值都按 subject yaw=0 的坐标系解释）。
//   follow 覆盖机位的 pos 轨道 / 路径；同时有 lookAt 时朝向由 lookAt 决定（follow 先于 lookAt）。
//
// 注视点 / 锚点：
//   character 注视点 = 脚底位置上方半个身高（站立包围盒中心，不随步态抖动），锚点 = 脚底位置；
//   prop 注视点 = 几何包围盒中心，锚点 = root 位置；camera 注视点 / 锚点 = 自身位置；
//   group 注视点 = 各成员注视点的平均，锚点 = 轴心位置；subject 为坐标 [x,y,z] 时两者都是该点、yaw = 0。

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);
const _box = new THREE.Box3();

/** 实体 root 在场景根节点坐标系下的矩阵（群众成员 = 组矩阵 × 成员矩阵）。 */
function worldMatrix(app, ent, out = new THREE.Matrix4()) {
  ent.root.updateMatrix();
  out.copy(ent.root.matrix);
  const parent = app.entities.find((e) => e.children.includes(ent));
  if (parent) { parent.root.updateMatrix(); out.premultiply(parent.root.matrix); }
  return out;
}

/** 道具几何在 root 局部坐标下的包围盒中心（与姿势无关，按实体缓存）。 */
const _propCenter = new WeakMap();
function propCenter(ent) {
  let c = _propCenter.get(ent);
  if (!c) {
    ent.root.updateMatrixWorld(true);
    _box.makeEmpty();
    _m.copy(ent.root.matrixWorld).invert();
    ent.root.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();
      _box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld).applyMatrix4(_m));
    });
    c = _box.isEmpty() ? new THREE.Vector3() : _box.getCenter(new THREE.Vector3());
    _propCenter.set(ent, c);
  }
  return c;
}

/** 角色脚底在 root 局部坐标下的位置（站立基准：root.y − _rootY0 为脚底，换成局部坐标）。 */
function charFoot(ent, out) {
  return out.set(0, -ent._rootY0 / ent.root.scale.y, 0);
}

/** subject 的注视点（场景根节点坐标）。 */
export function aimPoint(app, subject, out = new THREE.Vector3()) {
  if (Array.isArray(subject)) return out.fromArray(subject);
  const ent = app.findEntity(subject);
  if (!ent) return null;
  if (ent.type === 'group' || ent.type === 'crowd') {
    out.set(0, 0, 0);
    const ms = ent.children;
    for (const m of ms) out.add(aimPoint(app, m.id, new THREE.Vector3()));
    return ms.length ? out.divideScalar(ms.length) : out.setFromMatrixPosition(worldMatrix(app, ent, _m));
  }
  const M = worldMatrix(app, ent, new THREE.Matrix4());
  if (ent.type === 'character') {
    charFoot(ent, out);
    out.y += ent.height / ent.baseScale / 2; // 半个身高（root 局部单位）
    return out.applyMatrix4(M);
  }
  if (ent.type === 'prop') return out.copy(propCenter(ent)).applyMatrix4(M);
  return out.setFromMatrixPosition(M);
}

/** subject 的锚点（场景根节点坐标）与 yaw（弧度）。 */
export function anchorOf(app, subject) {
  if (Array.isArray(subject)) return { pos: new THREE.Vector3().fromArray(subject), yaw: 0 };
  const ent = app.findEntity(subject);
  if (!ent) return null;
  const M = worldMatrix(app, ent, new THREE.Matrix4());
  const pos = ent.type === 'character' ? charFoot(ent, new THREE.Vector3()).applyMatrix4(M) : new THREE.Vector3().setFromMatrixPosition(M);
  M.decompose(_v, _q, new THREE.Vector3());
  return { pos, yaw: _e.setFromQuaternion(_q, 'YXZ').y };
}

/** lookAt 入场 / 退场混合时长（秒）。 */
export const LOOK_BLEND = 0.5;

/** 机位在 pos 处注视 subject 的朝向（含荷兰角）；注视点与机位重合或 subject 不存在时返回 null。 */
function aimQuat(app, subject, pos, roll, out) {
  const p = aimPoint(app, subject, _v);
  if (!p || p.distanceToSquared(pos) < 1e-12) return null;
  _m.lookAt(pos, p, _up); // Matrix4.lookAt：−Z 指向 target（相机约定）
  out.setFromRotationMatrix(_m);
  if (roll) out.multiply(_q.setFromAxisAngle(_zAxis, roll));
  return out;
}

const _aim = new THREE.Quaternion();
const _from = new THREE.Quaternion();
const _zAxis = new THREE.Vector3(0, 0, 1);

/** 约束在 t 时刻是否生效。 */
export const constraintActive = (c, t) => (c.start == null || t >= c.start) && (c.end == null || t <= c.end);

/**
 * 应用一条约束到机位的求值状态 st（position / quaternion 为场景根节点坐标，机位是顶层实体）。
 * t / all（全部约束）给 lookAt 的入场 / 退场混合用；省略时全量生效。
 */
export function applyConstraint(app, c, st, t = null, all = null) {
  if (c.type === 'follow') {
    const a = anchorOf(app, c.subject);
    if (!a) return;
    _q.setFromAxisAngle(_up, a.yaw);
    st.position.copy(_v.fromArray(c.offset).applyQuaternion(_q).add(a.pos));
    st.quaternion.premultiply(_q);
    st.rotTouched = true;
  } else if (c.type === 'lookAt') {
    const roll = st.ent._roll || 0;
    if (!aimQuat(app, c.subject, st.position, roll, _aim)) return;
    let w = 1, from = st.quaternion; // 约束前的朝向（关键帧 / 路径 / follow 之后）
    if (t != null) {
      const sib = (all || []).filter((o) => o !== c && o.type === 'lookAt' && o.target === c.target);
      if (c.start > 0 && t < c.start + LOOK_BLEND) {
        w = EASE.smooth(clamp01((t - c.start) / LOOK_BLEND));
        const prev = sib.find((o) => o.end === c.start);
        if (prev && aimQuat(app, prev.subject, st.position, roll, _from)) from = _from;
      }
      if (c.end != null && t > c.end - LOOK_BLEND && !sib.some((o) => o.start === c.end)) {
        const wOut = EASE.smooth(clamp01((c.end - t) / LOOK_BLEND));
        if (wOut < w) { w = wOut; from = st.quaternion; }
      }
    }
    if (w >= 1) st.quaternion.copy(_aim);
    else st.quaternion.slerpQuaternions(from === st.quaternion ? _from.copy(from) : from, _aim, w);
    st.rotTouched = true;
  }
}
