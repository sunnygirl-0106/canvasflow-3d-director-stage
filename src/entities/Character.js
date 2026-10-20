import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Entity, hexColor } from './Entity.js';
import { POSE_PRESET_MAP } from './posePresets.js';
import { JOINT_SCHEMA } from '../rig/jointSchema.js';
import { getProfile } from '../rig/profiles/index.js';
import { resolveRig } from '../rig/RigProfile.js';
import { Pose } from '../rig/Pose.js';
import { buildBoneMap, norm } from '../util/boneUtil.js';
import { worldBox } from '../util/measure.js';
import { round6 } from '../util/math.js';
import { bodySpec, CHARACTER_COLOR } from '../config.js';

const DEFAULT_HEIGHT = 1.7;
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

// 脚底采样点缓存：模型 url → [{ bone: 归一化骨名, foot: 0 左 / 1 右, p: [x,y,z] 骨骼局部坐标 }]（同源克隆的骨骼局部坐标相同）
const _soleCache = new Map();
const SOLE_BAND = 0.03;   // 静止位下离最低点 3cm 以内的脚部顶点视为脚底
const SOLE_MAX = 24;      // 每只脚最多保留的采样点数

// applyPose 复用的临时对象
const _q = new THREE.Quaternion();
const _wq = new THREE.Quaternion();
const _rootInv = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const BODY_AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

/**
 * 档案里的轴（身体坐标系）→ 该骨头的局部旋转轴。
 * 身体坐标系 = 角色 root：X 指向角色左侧，Y 向上，Z 指向角色前方。
 * - 'x'/'y'/'z'：取骨头在文件静止位(T-pose)下的世界朝向 W，局部轴 = W⁻¹·身体轴。
 *   于是 restQ × R(局部轴, a) 等价于"在身体坐标系里绕该轴转 a"，与骨头 roll / 局部朝向无关。
 * - 'twist'：沿骨头自身方向（指向第一个子骨头）自转。
 */
function localAxis(bone, axis, rootInv) {
  if (axis === 'twist') {
    const child = bone.children.find((c) => c.isBone);
    return child && child.position.lengthSq() > 0 ? child.position.clone().normalize() : new THREE.Vector3(0, 1, 0);
  }
  const w = bone.getWorldQuaternion(_wq).premultiply(rootInv);
  return BODY_AXES[axis].clone().applyQuaternion(w.invert());
}

/**
 * 角色：带骨骼 GLB + 全身 FK 摆姿。
 * 每个 Character 各自独立持有 bones / restQ / values / 材质；几何体在同源角色间共享。
 * 只认语义关节（JOINT_SCHEMA）；骨头 / 轴向 / 站立偏移来自骨骼档案（spec.profile）。
 */
export class Character extends Entity {
  /**
   * @param {string} name
   * @param {THREE.Object3D} model 已克隆的模型场景
   * @param {{url:string, profile?:object|string, height?:number, girth?:number, body?:string}} spec 加载规格（复制时据此重建）
   * @param {string} [id]
   */
  constructor(name, model, spec, id) {
    const root = new THREE.Group();
    super('character', name, root, id);
    this.spec = { ...spec };
    this.body = spec.body ?? null; // 体型 key（BODY_TYPES），场景文档据此重建
    // 体型参数：目标身高 + 横向围度（girth=X/Z 缩放）。由单一 Xbot 素体派生高/矮/胖/瘦。
    this.height = spec.height || DEFAULT_HEIGHT;
    this.girth = spec.girth || 1;

    this.model = model;
    root.add(model);

    // 统一素体材质（单色，扁平绿色素体观感）；SkinnedMesh 仍自动蒙皮。
    this.color = CHARACTER_COLOR;
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
    this._jointBones = rig.bones; // 语义关节 key → 骨头

    // 涉及骨头的静止四元数（restQ），以及 bone → 该骨头上的 [{key, local, sign}]（按 schema 顺序）
    // local：档案身体轴换算到该骨头的局部轴（在文件静止位下计算一次）
    root.updateMatrixWorld(true);
    root.getWorldQuaternion(_rootInv).invert();
    this.restQ = new Map();
    this.bonesUsed = new Map();
    for (const { key } of JOINT_SCHEMA) {
      const bone = rig.bones.get(key);
      if (!bone) continue;
      const { axis, sign = 1 } = this.profile.joints[key];
      if (!this.restQ.has(bone)) this.restQ.set(bone, bone.quaternion.clone());
      if (!this.bonesUsed.has(bone)) this.bonesUsed.set(bone, []);
      this.bonesUsed.get(bone).push({ key, local: localAxis(bone, axis, _rootInv), sign });
    }

    // 该角色独立的一份姿势（0 = 自然站立）；values 是 pose.values 的别名，滑条直接读写
    this.pose = Pose.create(JOINT_SCHEMA);
    this.values = this.pose.values;
    this.currentPreset = null; // 当前静态姿势预设 key（null=未选/已手动微调）
    // 自动贴地开关（见 _ground）。程序化步行时需关闭：走路抬脚时最低骨头逐帧变化，
    // 贴地会让模型上下跳，届时改由步行逻辑自行控制高度。现阶段恒为 true，行为不变。
    this.autoGround = true;

    this._normalize(); // 在文件静止位(T-pose)下量身高 / 落地
    this.rootY0 = root.position.y; // 站立基准：归一化后 root 的固有高度偏移（文档 pos.y=0 即站在地面）
    this._modelBaseY = model.position.y;
    this._groundY = this._lowestBoneY(); // 地面高度（root 局部坐标），自动贴地以此为准
    this._sole = this._buildSole();       // 脚底采样点（步态贴地用）
    this.applyPose();  // 默认即站立
    this.standModelY = this.model.position.y; // 站立（自动贴地后）的 model 高度：步态的骨盆起伏以此为零点
    this.legGeom = this._buildLegGeom();       // 站立腿部几何（步态 IK 用）
  }

  /** 异步加载工厂：模板缓存 + 克隆。 */
  static async load(name, spec, id) {
    const gltf = await loadTemplate(spec.url);
    return new Character(name, cloneSkinned(gltf.scene), spec, id);
  }

  // ---- 场景文档 ----
  // pos 相对站立基准（减去 rootY0），scale 相对素体自然尺寸（除以 baseScale·girth），二者都与模型文件单位无关。
  docTransformOpts() {
    const b = this.baseScale, g = this.girth;
    return { posOffset: [0, this.rootY0, 0], scaleDiv: [b * g, b, b * g] };
  }

  /** @param {{parent?:string|null, base?:object|null}} opts parent = 所属组 id（群众成员）；base 见 Entity */
  toJSON({ parent = null, base = null } = {}) {
    const values = {};
    const pose = base?.values ? new Pose(base.values) : this.pose;
    for (const [k, v] of Object.entries(pose.toJSON().values)) values[k] = round6(v);
    return {
      type: 'character', id: this.id, name: this.name, body: this.body,
      color: hexColor(this.color), visible: this.root.visible,
      transform: this.transformJSON(base || this.root),
      pose: { preset: this.currentPreset, values },
      parent,
    };
  }

  static async fromJSON(json) {
    const c = await Character.load(json.name, bodySpec(json.body), json.id);
    c.applyTransform(json.transform);
    c.setColor(json.color);
    Object.assign(c.values, Pose.fromJSON(json.pose).values); // values 是 pose.values 的别名，原地写入
    c.currentPreset = json.pose.preset;
    c.applyPose();
    c.setVisible(json.visible);
    return c;
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
    root.scale.set(scale * this.girth, scale, scale * this.girth); // 胖瘦只改 X/Z
    this.baseScale = scale;

    const box2 = worldBox(root, { useBones: true }); // worldBox 会先刷新 root 的世界矩阵
    if (!box2.isEmpty()) root.position.y -= box2.min.y; // 把最低骨头抬到 y≈0
    root.updateMatrixWorld(true);
  }

  /**
   * 全身 FK 摆姿：最终姿势 = restQ × Π 各轴旋转(setFromAxisAngle(local, a))，
   * 每轴角度 = sign × (neutralOffset[key] + values[key])，即站立偏移与姿势逐关节相加。
   * 同一骨头多个轴按 JOINT_SCHEMA 顺序依次 multiply：靠前的轴在外层（身体坐标系里后施加），
   * 例如肩 = 前举 × 外展 × 扭转 —— 先自转、再放下/抬起、最后前后摆。
   */
  applyPose() {
    const offset = this.profile.neutralOffset || {};
    for (const [bone, joints] of this.bonesUsed) {
      bone.quaternion.copy(this.restQ.get(bone));
      for (const j of joints) {
        const a = THREE.MathUtils.degToRad(j.sign * ((offset[j.key] || 0) + (this.values[j.key] || 0)));
        if (a === 0) continue;
        bone.quaternion.multiply(_q.setFromAxisAngle(j.local, a));
      }
    }
    this._ground();
  }

  /**
   * 自动贴地：摆姿后最低的骨头回到地面高度（如坐姿时整体下沉）。
   * 只平移 model（root 的子节点），root 的位置 / gizmo / 用户摆放不受影响。
   * 程序化步行时此逻辑要关闭（this.autoGround=false），否则抬脚帧会导致模型上下跳。
   */
  _ground() {
    this.model.position.y = this._modelBaseY;
    if (!this.autoGround) return;
    const min = this._lowestBoneY();
    if (Number.isFinite(min)) this.model.position.y += this._groundY - min;
  }

  /** 全部骨头在 root 局部坐标系里的最低 y（与 root 的位置 / 旋转无关）。 */
  _lowestBoneY() {
    this.root.updateMatrixWorld(true);
    _m.copy(this.root.matrixWorld).invert();
    let min = Infinity;
    this.model.traverse((o) => {
      if (o.isBone && (_v.setFromMatrixPosition(o.matrixWorld).applyMatrix4(_m).y < min)) min = _v.y;
    });
    return min;
  }

  /**
   * 脚底采样点：静止位下双脚（踝骨及其子骨主导的）蒙皮顶点里离最低点 SOLE_BAND 以内的，
   * 记成所属骨头的局部坐标；每只脚按前后均匀抽 SOLE_MAX 个。摆姿后用骨头世界矩阵变换即得脚底，
   * 脚跟 / 脚尖着地都能量准（骨头只有踝 / 趾关节，脚跟没有骨头）。缺脚骨的模型返回空表。
   */
  _buildSole() {
    const feet = ['lFoot', 'rFoot'].map((k) => this._jointBones.get(k)).filter(Boolean);
    if (!feet.length) return [];
    const resolve = (list) => list.map(({ bone, foot, p }) => ({ bone: this.bones.get(bone), foot, p: new THREE.Vector3(...p) })).filter((m) => m.bone);
    const cached = _soleCache.get(this.spec.url);
    if (cached) return resolve(cached);

    // 骨头 → 所属的脚（踝骨及其全部子骨）
    const footOf = new Map();
    feet.forEach((f, i) => f.traverse((b) => { if (b.isBone) footOf.set(b, i); }));
    this.root.updateMatrixWorld(true);
    _m.copy(this.root.matrixWorld).invert();
    const pts = feet.map(() => []); // [{ bone, local, y, z }]
    const inv = new THREE.Matrix4();
    this.model.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
      const n = o.geometry.attributes.position.count;
      for (let i = 0; i < n; i++) {
        let best = 0, bw = -1;
        for (let c = 0; c < 4; c++) { const w = sw.getComponent(i, c); if (w > bw) { bw = w; best = si.getComponent(i, c); } }
        const bone = o.skeleton.bones[best];
        const foot = footOf.get(bone);
        if (foot === undefined) continue;
        o.getVertexPosition(i, _v);       // 蒙皮后（静止位）的模型空间坐标
        o.localToWorld(_v);
        const local = _v.clone().applyMatrix4(inv.copy(bone.matrixWorld).invert());
        const r = _v.applyMatrix4(_m);    // root 局部
        pts[foot].push({ bone, foot, local, y: r.y, z: r.z });
      }
    });
    const out = [];
    for (const list of pts) {
      if (!list.length) continue;
      const minY = Math.min(...list.map((q) => q.y));
      const band = list.filter((q) => q.y <= minY + SOLE_BAND).sort((a, b) => a.z - b.z);
      const step = Math.max(1, (band.length - 1) / (SOLE_MAX - 1));
      for (let k = 0; k < band.length; k += step) out.push(band[Math.round(k)]);
      out.push(band[band.length - 1]); // 确保含最前（脚尖）与最后（脚跟）
    }
    const list = out.map((q) => ({ bone: norm(q.bone.name), foot: q.foot, p: q.local.toArray() }));
    _soleCache.set(this.spec.url, list);
    return resolve(list);
  }

  /**
   * 站立姿势下的腿部几何（矢状面 [y 上, z 前]，单位 = 相对素体自然尺寸的米，root 原点为参照）：
   * 每条腿的髋 / 膝 / 踝关节、脚底采样点，以及地面高度。
   * 缺腿部关节或脚底采样点的模型返回 null（不做步态）。
   */
  _buildLegGeom() {
    const sx = this.baseScale * this.girth, sy = this.baseScale;
    this.root.updateMatrixWorld(true);
    _m.copy(this.root.matrixWorld).invert();
    const yz = (v) => [v.y * sy, v.z * sx];
    const at = (bone) => yz(bone.getWorldPosition(_v).applyMatrix4(_m));
    const legs = [];
    for (const [i, side] of [[0, 'l'], [1, 'r']]) {
      const [hip, knee, ankle] = [`${side}LegFwd`, `${side}Knee`, `${side}Foot`].map((k) => this._jointBones.get(k));
      const sole = this._sole.filter((q) => q.foot === i).map((q) => yz(q.p.clone().applyMatrix4(q.bone.matrixWorld).applyMatrix4(_m)));
      if (!hip || !knee || !ankle || !sole.length) return null;
      legs.push({ hip: at(hip), knee: at(knee), ankle: at(ankle), sole });
    }
    const ground = Math.min(...this._sole.map((q) => q.p.clone().applyMatrix4(q.bone.matrixWorld).applyMatrix4(_m).y)) * sy;
    return { legs, ground, height: this.height };
  }

  /** 当前姿势下脚底最低点在 root 局部坐标里的 y（含 model 偏移）；没有脚底采样点时退回最低骨头。 */
  lowestSoleY() {
    if (!this._sole.length) return this._lowestBoneY();
    this.root.updateMatrixWorld(true);
    _m.copy(this.root.matrixWorld).invert();
    let min = Infinity;
    for (const { bone, p } of this._sole) {
      const y = _v.copy(p).applyMatrix4(bone.matrixWorld).applyMatrix4(_m).y;
      if (y < min) min = y;
    }
    return min;
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
