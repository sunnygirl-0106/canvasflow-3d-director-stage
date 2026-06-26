import * as THREE from 'three';

// 量一个对象的世界包围盒。角色优先用骨骼（避免被 SkinnedMesh 撑大），
// 量不到就退回普通包围盒。返回 THREE.Box3。
export function worldBox(root, { useBones = false } = {}) {
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  let measured = false;
  root.updateMatrixWorld(true);
  if (useBones) {
    root.traverse((o) => {
      if (o.isBone) { o.getWorldPosition(p); box.expandByPoint(p); measured = true; }
    });
  }
  if (!measured) box.setFromObject(root);
  return box;
}
