import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Entity } from './Entity.js';
import { JOINTS } from './jointConfig.js';
import { POSE_PRESET_MAP } from './posePresets.js';
import { buildBoneMap, findBone } from '../util/boneUtil.js';
import { worldBox } from '../util/measure.js';

const DEFAULT_HEIGHT = 1.7;
const DEFAULT_COLOR = 0x34c759; // 截图同款素体绿

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
 */
export class Character extends Entity {
  /**
   * @param {string} name
   * @param {THREE.Object3D} model 已克隆的模型场景
   * @param {{url:string, height?:number, girth?:number}} spec 加载规格（复制时据此重建）
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

    // jointConfig 涉及骨头的静止四元数（restQ），以及 bone → 该骨头上的 joint 列表
    this.restQ = new Map();
    this.bonesUsed = new Map();
    for (const j of JOINTS) {
      const bone = findBone(this.bones, j.bone);
      if (!bone) continue;
      if (!this.restQ.has(bone)) this.restQ.set(bone, bone.quaternion.clone());
      if (!this.bonesUsed.has(bone)) this.bonesUsed.set(bone, []);
      this.bonesUsed.get(bone).push(j);
    }

    // 该角色独立的一份滑条角度
    this.values = {};
    for (const j of JOINTS) this.values[j.key] = 0;
    this.currentPreset = null; // 当前静态姿势预设 key（null=未选/已手动微调）

    this._normalize();
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
   * 全身 FK 摆姿：最终姿势 = restQ × Σ 各轴增量(setFromAxisAngle)。
   * 同一骨头多个轴按 jointConfig 顺序依次 multiply。
   */
  applyPose() {
    for (const [bone, joints] of this.bonesUsed) {
      bone.quaternion.copy(this.restQ.get(bone));
      for (const j of joints) {
        const a = THREE.MathUtils.degToRad(this.values[j.key] || 0);
        if (a === 0) continue;
        _axis.set(j.axis === 'x' ? 1 : 0, j.axis === 'y' ? 1 : 0, j.axis === 'z' ? 1 : 0);
        bone.quaternion.multiply(_q.setFromAxisAngle(_axis, a));
      }
    }
  }

  /** 应用一个静态姿势预设：清零后写入预设的非零关节。 */
  applyPosePreset(presetKey) {
    const preset = POSE_PRESET_MAP[presetKey];
    if (!preset) return;
    for (const j of JOINTS) this.values[j.key] = 0;
    for (const [k, v] of Object.entries(preset.values || {})) {
      if (k in this.values) this.values[k] = v;
    }
    this.applyPose();
    this.currentPreset = presetKey;
  }

  /** 复位姿势：values 清零 + 回到静止。 */
  resetPose() {
    for (const j of JOINTS) this.values[j.key] = 0;
    for (const [bone, rest] of this.restQ) bone.quaternion.copy(rest);
    this.currentPreset = null;
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
