// 骨名归一化与骨骼表构建（§5.1）
// 新版 GLTFLoader 对 `mixamorig:Head` 的处理不确定：可能保留冒号，也可能被清洗成
// `mixamorigHead`。不要硬匹配字符串——统一用 norm() 归一化后再查表，jointConfig 里
// 写带冒号的 `mixamorig:LeftArm`，无论被怎么清洗都能命中。

/** 归一化：去掉所有非字母数字字符并转小写。mixamorig:Head / mixamorigHead → mixamorighead */
export function norm(s) {
  return (s || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/**
 * 遍历模型，构建归一化骨名 → Bone 的映射。
 * 同时记录原始 userData.name（GLTFLoader 有时把原名存这里）。
 * @returns {Map<string, THREE.Bone>}
 */
export function buildBoneMap(model) {
  const map = new Map();
  model.traverse((o) => {
    if (!o.isBone) return;
    const keys = new Set([o.name]);
    const orig = o.userData && o.userData.name;
    if (orig) keys.add(orig);
    for (const k of keys) {
      const nk = norm(k);
      if (nk && !map.has(nk)) map.set(nk, o);
    }
  });
  return map;
}

/** 在骨骼表里按 jointConfig 的 bone 名查找（自动归一化）。 */
export function findBone(boneMap, boneName) {
  return boneMap.get(norm(boneName)) || null;
}
