import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Entity } from './Entity.js';
import { JOINTS } from './jointConfig.js';
import { POSE_PRESET_MAP } from './posePresets.js';
import { buildBoneMap, findBone } from '../util/boneUtil.js';

// 统一目标身高（单位），多角色视觉一致（§5.2）
const TARGET_HEIGHT = 1.7;
const DEFAULT_COLOR = 0x34c759; // 截图同款素体绿

const _loader = new GLTFLoader();

/**
 * 角色：带骨骼 GLB 加载 + 全身 FK 摆姿 + 预设动画。
 * 每个 Character 各自独立持有 bones / restQ / values / mixer（§5.6）。
 */
export class Character extends Entity {
  constructor(name, gltf, opts = {}) {
    const root = new THREE.Group();
    super('character', name, root);

    // 体型参数：目标身高 + 横向围度（girth=X/Z 缩放）。由单一 Xbot 素体派生高/矮/胖/瘦。
    this._targetHeight = opts.height || TARGET_HEIGHT;
    this._girth = opts.girth || 1;

    this.model = gltf.scene;
    root.add(this.model);

    // 统一素体材质（单色，贴合截图的扁平绿色素体观感）；SkinnedMesh 仍自动蒙皮。
    this.color = DEFAULT_COLOR;
    this._mats = [];
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
        const m = new THREE.MeshStandardMaterial({ color: this.color, roughness: 0.62, metalness: 0.05 });
        o.material = m;
        this._mats.push(m);
      }
    });

    // 骨骼表（§5.1 归一化匹配）
    this.bones = buildBoneMap(this.model);

    // jointConfig 涉及骨头的静止四元数（restQ），按 bone 对象存（§5.3）
    this.restQ = new Map();
    // bone 对象 → 该骨头上的 joint 列表（applyPose 用）
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

    // 预设动画
    this.mixer = new THREE.AnimationMixer(this.model);
    this.clips = {};
    (gltf.animations || []).forEach((a) => { this.clips[a.name] = a; });
    this.currentClip = null;     // 当前播放的预设名（null=未播放）
    this.currentPreset = null;   // 当前选中的静态姿势预设 key（null=未选/已手动微调）
    this.poseMode = 'preset';    // 'preset' | 'manual'

    // 归一化身高 + 落地对齐
    this._normalize();

    this.labelEl = null; // 名牌 DOM，由 App 的 label 层管理
  }

  /** 异步加载工厂：返回 Promise<Character>。 */
  static async load(name, url, opts = {}) {
    const gltf = await _loader.loadAsync(url);
    return new Character(name, gltf, opts);
  }

  get clipNames() {
    return Object.keys(this.clips);
  }

  // §5.2：Mixamo 资产常有 100× 建模 + 0.01 缩放，setFromObject 会量错。
  // 用骨骼世界坐标量真实包围盒，把 root 缩放到统一身高，再落地（脚底贴 y=0）。
  _normalize() {
    const root = this.root;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    let hasBone = false;
    this.model.traverse((o) => {
      if (o.isBone) { o.getWorldPosition(p); box.expandByPoint(p); hasBone = true; }
    });
    if (!hasBone || box.isEmpty()) box.setFromObject(this.model);

    const size = box.getSize(new THREE.Vector3());
    const height = size.y || Math.max(size.x, size.z) || TARGET_HEIGHT;
    const scale = this._targetHeight / height;
    root.scale.setScalar(scale);
    // 横向围度：胖→加宽、瘦→收窄（仅 X/Z，不改身高与落地）
    root.scale.x *= this._girth;
    root.scale.z *= this._girth;
    this.baseScale = scale;

    // 重新量缩放后的最低点，落地对齐
    root.updateMatrixWorld(true);
    const box2 = new THREE.Box3();
    let has2 = false;
    this.model.traverse((o) => {
      if (o.isBone) { o.getWorldPosition(p); box2.expandByPoint(p); has2 = true; }
    });
    if (has2 && !box2.isEmpty()) {
      root.position.y -= box2.min.y; // 把最低骨头抬到 y≈0
    }
    root.updateMatrixWorld(true);
    this.height = TARGET_HEIGHT;
  }

  /**
   * 全身 FK 摆姿（§5.3）：最终姿势 = restQ × Σ 各轴增量(setFromAxisAngle)。
   * 同一骨头多个轴按 jointConfig 顺序依次 multiply。
   */
  applyPose() {
    for (const [bone, joints] of this.bonesUsed) {
      const rest = this.restQ.get(bone);
      if (!rest) continue;
      bone.quaternion.copy(rest);
      for (const j of joints) {
        const a = THREE.MathUtils.degToRad(this.values[j.key] || 0);
        if (a === 0) continue;
        const ax = new THREE.Vector3(j.axis === 'x' ? 1 : 0, j.axis === 'y' ? 1 : 0, j.axis === 'z' ? 1 : 0);
        bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(ax, a));
      }
    }
  }

  /** 应用一个静态姿势预设（静止 FK，不启动动画）。 */
  applyPosePreset(presetKey) {
    const preset = POSE_PRESET_MAP[presetKey];
    if (!preset) return;
    // 1) 先清零再写入该预设的非零关节（保证从干净状态叠加）
    for (const j of JOINTS) this.values[j.key] = 0;
    for (const [k, v] of Object.entries(preset.values || {})) {
      if (k in this.values) this.values[k] = v;
    }
    // 2) 退出动画态（停 mixer，置 manual）
    this.enterManual();
    // 3) FK 摆姿
    this.applyPose();
    this.currentPreset = presetKey; // 记录当前选中预设，供 UI 高亮（须在 enterManual 之后赋值）
  }

  /** 进入手动摆姿态：停掉所有预设动画（与手动互斥，§4）。 */
  enterManual() {
    if (this.poseMode === 'preset' && this.mixer) this.mixer.stopAllAction();
    this.poseMode = 'manual';
    this.currentClip = null;
  }

  /** 复位所有受控骨头到静止姿势。 */
  setRest() {
    for (const [bone, rest] of this.restQ) bone.quaternion.copy(rest);
  }

  /** 复位姿势：values 清零 + 回到静止 + 停动画。 */
  resetPose() {
    for (const j of JOINTS) this.values[j.key] = 0;
    if (this.mixer) this.mixer.stopAllAction();
    this.setRest();
    this.poseMode = 'preset';
    this.currentClip = null;
    this.currentPreset = null;
  }

  /** 播放预设动画；与手动摆姿互斥（先清零滑条）。 */
  playClip(name) {
    const clip = this.clips[name];
    if (!clip || !this.mixer) return;
    for (const j of JOINTS) this.values[j.key] = 0;
    this.mixer.stopAllAction();
    const act = this.mixer.clipAction(clip);
    act.reset();
    // 短姿势片段（如 sad_pose / sneak_pose 仅 2 帧）若循环，会在 rest↔pose 间高频闪烁；
    // 改为播放一次并定格到末帧姿势。其余动画正常循环。
    const isPose = clip.duration <= 0.25 || /pose/i.test(name);
    act.setLoop(isPose ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    act.clampWhenFinished = isPose;
    act.play();
    this.poseMode = 'preset';
    this.currentClip = name;
  }

  stopClip() {
    if (this.mixer) this.mixer.stopAllAction();
    this.setRest();
    this.poseMode = 'preset';
    this.currentClip = null;
  }

  /** 每帧更新（仅预设动画态推进 mixer，§5.6）。 */
  update(dt) {
    if (this.mixer && this.poseMode === 'preset' && this.currentClip) {
      this.mixer.update(dt);
    }
  }

  /** 给整个素体着色。 */
  setColor(hex) {
    const c = new THREE.Color(hex);
    this._mats.forEach((m) => m.color.copy(c));
    this.color = c.getHex();
  }

  /** 名牌锚点（头顶上方）的世界坐标。 */
  getLabelAnchor(out = new THREE.Vector3()) {
    this.root.getWorldPosition(out);
    out.y += this.height + 0.16;
    return out;
  }

  dispose() {
    if (this.mixer) this.mixer.stopAllAction();
    super.dispose();
  }
}
