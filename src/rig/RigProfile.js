import { JOINT_SCHEMA } from './jointSchema.js';
import { buildBoneMap, findBone } from '../util/boneUtil.js';

/**
 * 按档案把语义关节解析到模型骨头。
 * 档案里没写的关节、或写了但模型里找不到骨头的关节，都计入 missing。
 * @param {THREE.Object3D} model
 * @param {object} profile 档案对象（见 src/rig/profiles）
 * @param {Map<string, THREE.Bone>} [boneMap] 已建好的归一化骨骼表（省一次遍历）
 * @returns {{bones: Map<string, THREE.Bone>, missing: string[]}} missing 为空才算完整兼容
 */
export function resolveRig(model, profile, boneMap = buildBoneMap(model)) {
  const bones = new Map();
  const missing = [];
  for (const { key } of JOINT_SCHEMA) {
    const def = profile?.joints?.[key];
    const bone = def ? findBone(boneMap, def.bone) : null;
    if (bone) bones.set(key, bone);
    else missing.push(key);
  }
  return { bones, missing };
}
