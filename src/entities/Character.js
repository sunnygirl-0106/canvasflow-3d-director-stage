import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Entity } from './Entity.js';
import { POSE_PRESET_MAP } from './posePresets.js';
import { JOINT_SCHEMA } from '../rig/jointSchema.js';
import { getProfile } from '../rig/profiles/index.js';
import { resolveRig } from '../rig/RigProfile.js';
import { Pose } from '../rig/Pose.js';
import { buildBoneMap } from '../util/boneUtil.js';
import { worldBox } from '../util/measure.js';

const DEFAULT_HEIGHT = 1.7;
const DEFAULT_COLOR = 0x34c759; // 截图同款素体绿
const DEFAULT_PROFILE = 'xbot'; // spec 未指定档案时（Mixamo 命名）

const _loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
// 模板缓存：同一 url 只下载/解析一次，之后用 SkeletonUtils.clone 复制（几何体共享，不重复上传 GPU）。
const _templates = new Map(); // url → Promise<gltf>

function loadTemplate(url) {
  if (!_templates.has(url)) {
    _templates.set(url, _loader.loadAsync(url).catch((err) => { _templates.delete(url); throw err; }));
  }
  return _templates.get(url);
}

// applyPose 复用的临时对象
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * 角色：带骨骼 GLB + 全身 FK 摆姿。
 * 每个 Character 各自独立持有 bones / restQ / values / 材质；几何体在同源角色间共享。
 * 只认语义关节（JOINT_SCHEMA）；骨头 / 轴向 / 站立偏移来自骨骼档案（spec.profile）。
 */
export class Character extends Entity {
  /**
   * @param {string} name
   * @param {THREE.Object3D} model 已克隆的模型场景
   * @param {{url:string, profile?:object|string, height?:number, girth?:number}} spec 加载规格（复制时据此重建）
   */
  constructor(name, model, spec) {
    const root = new THREE.Group();
    super('character', name, root);
    this.spec = { ...spec };
    // 体型参数：目标身高 + 横向围度（girth=X/Z 缩放）。由单一 Xbot 素体派生高/矮/胖/瘦。
    this.height = spec.height || DEFAULT_HEIGHT;
    this._girth = spec.girth || 1;

    this.model = model;
    root.add(model);

    // 统一素体材质（单色，扁平绿色素体观感）；SkinnedMesh 仍自动蒙皮。
    this.color = DEFAULT_COLOR;
    this._mats = [];
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
        const m = new THREE.MeshStandardMaterial({ color: this.color, roughness: 0.62, metalness: 0.05 });
        o.material = m;
        this._mats.push(m);
      }
    });

    this.bones = buildBoneMap(model);
    this.profile = getProfile(spec.profile || DEFAULT_PROFILE);
    if (!this.profile) throw new Error('未知骨骼档案：' + spec.profile);

    // 语义关节 → 骨头；缺失的关节（missingJoints）不参与摆姿
    const rig = resolveRig(model, this.profile, this.bones);
    this.missingJoints = rig.missing;

    // 涉及骨头的静止四元数（restQ），以及 bone → 该骨头上的 [{key, axis, sign}]（按 schema 顺序）
    this.restQ = new Map();
    this.bonesUsed = new Map();
    for (const { key } of JOINT_SCHEMA) {
      const bone = rig.bones.get(key);
      if (!bone) continue;
      const { axis, sign = 1 } = this.profile.joints[key];
      if (!this.restQ.has(bone)) this.restQ.set(bone, bone.quaternion.clone());
      if (!this.bonesUsed.has(bone)) this.bonesUsed.set(bone, []);
      this.bonesUsed.get(bone).push({ key, axis, sign });
    }

    // 该角色独立的一份姿势（0 = 自然站立）；values 是 pose.values 的别名，滑条直接读写
    this.pose = Pose.create(JOINT_SCHEMA);
    this.values = this.pose.values;
    this.currentPreset = null; // 当前静态姿势预设 key（null=未选/已手动微调）

    this._normalize(); // 在文件静止位(T-pose)下量身高 / 落地
    this.applyPose();  // 默认即站立
  }

  /** 异步加载工厂：模板缓存 + 克隆。 */
  static async load(name, spec) {
    const gltf = await loadTemplate(spec.url);
    return new Character(name, cloneSkinned(gltf.scene), spec);
  }

  labelTargets() { return [this]; }

  /** 名牌在头顶上方；随角色自身缩放。 */
  labelOffset() { return this.height * (this.root.scale.y / this.baseScale) + 0.16; }

  // Mixamo 资产常有 100× 建模 + 0.01 缩放，setFromObject 会量错。
  // 用骨骼世界坐标量真实包围盒，把 root 缩放到目标身高，再落地（脚底贴 y=0）。
  _normalize() {
    const root = this.root;
    const box = worldBox(root, { useBones: true });
    const size = box.getSize(new THREE.Vector3());
    const measured = size.y || Math.max(size.x, size.z) || this.height;
    const scale = this.height / measured;
    root.scale.set(scale * this._girth, scale, scale * this._girth); // 胖瘦只改 X/Z
    this.baseScale = scale;

    const box2 = worldBox(root, { useBones: true }); // worldBox 会先刷新 root 的世界矩阵
    if (!box2.isEmpty()) root.position.y -= box2.min.y; // 把最低骨头抬到 y≈0
    root.updateMatrixWorld(true);
  }

  /**
   * 全身 FK 摆姿：最终姿势 = restQ × Π 各轴旋转(setFromAxisAngle)，
   * 每轴角度 = sign × (neutralOffset[key] + values[key])，即站立偏移与姿势逐关节相加。
   * 同一骨头多个轴按 JOINT_SCHEMA 顺序依次 multiply。
   */
  applyPose() {
    const offset = this.profile.neutralOffset || {};
    for (const [bone, joints] of this.bonesUsed) {
      bone.quaternion.copy(this.restQ.get(bone));
      for (const j of joints) {
        const a = THREE.MathUtils.degToRad(j.sign * ((offset[j.key] || 0) + (this.values[j.key] || 0)));
        if (a === 0) continue;
        _axis.set(j.axis === 'x' ? 1 : 0, j.axis === 'y' ? 1 : 0, j.axis === 'z' ? 1 : 0);
        bone.quaternion.multiply(_q.setFromAxisAngle(_axis, a));
      }
    }
  }

  /**
   * 应用一个静态姿势预设：清零（站立）后写入预设的非零关节。
   * special:'tpose' → values = -neutralOffset，与偏移相加后总角度为 0，回到文件静止位。
   */
  applyPosePreset(presetKey) {
    const preset = POSE_PRESET_MAP[presetKey];
    if (!preset) return;
    this._zeroValues();
    const values = preset.special === 'tpose'
      ? Object.fromEntries(Object.entries(this.profile.neutralOffset || {}).map(([k, v]) => [k, -v]))
      : preset.values || {};
    for (const [k, v] of Object.entries(values)) {
      if (k in this.values) this.values[k] = v;
    }
    this.applyPose();
    this.currentPreset = presetKey;
  }

  /** 复位姿势：values 清零 = 回到自然站立。 */
  resetPose() {
    this._zeroValues();
    this.applyPose();
    this.currentPreset = null;
  }

  _zeroValues() {
    for (const k in this.values) this.values[k] = 0;
  }

  /** 从另一个角色拷贝姿势。 */
  copyPoseFrom(other) {
    Object.assign(this.values, other.values);
    this.currentPreset = other.currentPreset;
    this.applyPose();
  }

  setColor(hex) {
    const c = new THREE.Color(hex);
    this._mats.forEach((m) => m.color.copy(c));
    this.color = c.getHex();
  }

  // 几何体与模板共享，不能销毁；只释放本角色独有的材质与骨骼贴图。
  dispose() {
    this._mats.forEach((m) => m.dispose());
    this.model.traverse((o) => { if (o.isSkinnedMesh) o.skeleton?.dispose?.(); });
  }
}
