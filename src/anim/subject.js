import * as THREE from 'three';

// 注视点 / 锚点的唯一定义。运行时（Constraint，读场景对象）与 AI 编译（ai/apply，读文档）共用这两个函数，
// 各自只提供一个"取数"适配器，保证两边口径一致：
//   注视点：character = 脚底上方半个身高；prop = 几何中心；camera = 自身位置；group = 各成员注视点的平均（空组 = 轴心）。
//   锚点（follow 用）：character = 脚底；其余 = root 位置；附带 yaw。
//   subject 为坐标 [x,y,z] 时两者都是该点、yaw = 0。坐标一律是场景根节点（文档）口径。
//
// 适配器 ad：
//   get(id) → node | null
//   type(node) → 'character' | 'prop' | 'camera' | 'group'
//   members(node) → node[]                      （group 的成员）
//   matrix(node, out: Matrix4) → out             （root 在场景根节点坐标系下的矩阵）
//   aimLocal(node, out: Vector3) → out           （root 局部坐标下的注视点；group 不会调用）
//   footLocal(node, out: Vector3) → out          （character 的脚底，root 局部坐标）

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/** subject 的注视点（写入 out 并返回；subject 不存在返回 null）。 */
export function aimPointWith(ad, subject, out = new THREE.Vector3()) {
  if (Array.isArray(subject)) return out.fromArray(subject);
  const node = ad.get(subject);
  return node ? aimOfNode(ad, node, out) : null;
}

function aimOfNode(ad, node, out) {
  if (ad.type(node) === 'group') {
    const ms = ad.members(node);
    if (!ms.length) return out.setFromMatrixPosition(ad.matrix(node, _m));
    const p = new THREE.Vector3();
    out.set(0, 0, 0);
    for (const m of ms) out.add(aimOfNode(ad, m, p));
    return out.divideScalar(ms.length);
  }
  const M = ad.matrix(node, new THREE.Matrix4());
  return ad.aimLocal(node, out).applyMatrix4(M);
}

/** subject 的锚点与 yaw（弧度）：{ pos: Vector3, yaw }；subject 不存在返回 null。 */
export function anchorWith(ad, subject) {
  if (Array.isArray(subject)) return { pos: new THREE.Vector3().fromArray(subject), yaw: 0 };
  const node = ad.get(subject);
  if (!node) return null;
  const M = ad.matrix(node, new THREE.Matrix4());
  const pos = ad.type(node) === 'character' ? ad.footLocal(node, new THREE.Vector3()).applyMatrix4(M) : new THREE.Vector3().setFromMatrixPosition(M);
  M.decompose(_s, _q, new THREE.Vector3());
  return { pos, yaw: _e.setFromQuaternion(_q, 'YXZ').y };
}
