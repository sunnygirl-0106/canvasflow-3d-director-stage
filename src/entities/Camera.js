import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Entity } from './Entity.js';
import { round6, xyz, D2R, R2D } from '../util/math.js';
import { CAMERA_FOV } from '../config.js';

const FRUSTUM_COLOR = 0x8297a6; // 低强调蓝灰视锥线
const VIZ_FAR = 4; // 无有效前向目标时的有限缺省长度
const SIDE_STEPS = 32; // 分段绘制穿过观察相机近平面的视锥长边

// 紧凑电影摄影机，镜头朝 -Z；细节保持米制尺度，所有附件随 body 一起显隐。
function buildCameraBody() {
  const g = new THREE.Group();
  // 背光面保留柔和亮度，使机身轮廓和材质层次在导演台背景上清晰可辨。
  const material = (color, roughness, metalness) => new THREE.MeshStandardMaterial({
    color, roughness, metalness, fog: false, emissive: color, emissiveIntensity: 0.18,
  });
  const shell = material(0x9aabba, 0.48, 0.22);
  const rubber = material(0x3a4654, 0.88, 0.04);
  const metal = material(0xd4dfe8, 0.3, 0.45);
  const recess = material(0x101923, 0.72, 0.12);
  const brass = material(0xb49a60, 0.33, 0.6);
  const red = material(0xc74a40, 0.42, 0.2);
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x23566f, metalness: 0.35, roughness: 0.1,
    clearcoat: 1, clearcoatRoughness: 0.06,
    emissive: 0x23516b, emissiveIntensity: 0.25, fog: false,
  });
  const display = material(0x244b59, 0.28, 0.15);
  const screenInk = new THREE.MeshBasicMaterial({ color: 0x84b4ba, fog: false });
  const add = (geometry, mat, x, y, z) => {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  const box = (w, h, d, mat, x, y, z, radius = 0.003) =>
    add(radius <= 0.001 ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, 2, radius), mat, x, y, z);
  const barrel = (radius, depth, mat, z) => {
    const mesh = add(new THREE.CylinderGeometry(radius, radius, depth, 48), mat, 0, 0, z);
    mesh.rotation.x = Math.PI / 2;
    return mesh;
  };
  const ring = (radius, tube, mat, z) =>
    add(new THREE.TorusGeometry(radius, tube, 8, 48), mat, 0, 0, z);

  // 分体外壳、前端卡口面板、背部电池及锁扣。
  box(0.17, 0.125, 0.19, shell, 0, 0, 0.015, 0.009);
  box(0.157, 0.112, 0.012, metal, 0, 0, -0.083, 0.006);
  box(0.145, 0.1, 0.008, recess, 0, 0, 0.113);
  box(0.134, 0.106, 0.048, rubber, 0, 0, 0.138, 0.007);
  box(0.112, 0.078, 0.004, shell, 0, 0, 0.163);
  box(0.03, 0.012, 0.009, metal, 0, 0.05, 0.165);
  for (let i = 0; i < 4; i++) box(0.008, 0.003, 0.002, i < 3 ? screenInk : recess, -0.017 + i * 0.011, 0.022, 0.166, 0.0005);

  // 两侧嵌入面板、散热百叶、固定螺钉与录制按钮。
  for (const side of [-1, 1]) {
    box(0.006, 0.086, 0.13, rubber, side * 0.086, -0.003, 0.014);
    box(0.003, 0.063, 0.105, shell, side * 0.09, -0.002, 0.014);
    for (let i = 0; i < 7; i++) box(0.002, 0.027, 0.004, recess, side * 0.092, 0.006, -0.022 + i * 0.01, 0.0008);
    for (const y of [-0.035, 0.034]) for (const z of [-0.04, 0.069]) {
      const screw = add(new THREE.CylinderGeometry(0.0032, 0.0032, 0.002, 8), metal, side * 0.091, y, z);
      screw.rotation.z = Math.PI / 2;
      box(0.001, 0.0008, 0.0036, recess, side * 0.0925, y, z, 0.0002);
    }
  }
  const record = add(new THREE.CylinderGeometry(0.008, 0.008, 0.004, 24), red, 0.094, -0.022, -0.021);
  record.rotation.z = Math.PI / 2;
  box(0.002, 0.005, 0.025, metal, 0.092, -0.023, 0.025, 0.001);

  // 镂空提手与橡胶握持区；底部快装板和双导轨。
  for (const z of [-0.04, 0.066]) box(0.026, 0.031, 0.021, metal, 0, 0.077, z);
  box(0.034, 0.019, 0.146, metal, 0, 0.101, 0.014);
  box(0.038, 0.022, 0.082, rubber, 0, 0.103, 0.013);
  for (let i = 0; i < 6; i++) box(0.039, 0.002, 0.003, shell, 0, 0.115, -0.018 + i * 0.012, 0.0008);
  box(0.112, 0.017, 0.123, recess, 0, -0.071, 0.012);
  box(0.125, 0.009, 0.143, metal, 0, -0.084, 0.005);
  for (const x of [-0.043, 0.043]) {
    const rod = barrel(0.005, 0.3, metal, -0.027);
    rod.position.set(x, -0.093, -0.027);
  }

  // 多级镜筒、卡口金属环、双齿圈和距离刻度。
  barrel(0.05, 0.016, recess, -0.094);
  ring(0.048, 0.0025, metal, -0.101);
  barrel(0.045, 0.091, rubber, -0.146);
  for (const z of [-0.124, -0.165]) {
    barrel(0.05, 0.019, recess, z);
    for (let i = 0; i < 40; i++) {
      const angle = i * Math.PI / 20;
      const tooth = box(0.003, 0.004, 0.018, rubber, Math.sin(angle) * 0.05, Math.cos(angle) * 0.05, z, 0.0006);
      tooth.rotation.z = -angle;
    }
    ring(0.048, 0.0012, metal, z + 0.011);
  }
  barrel(0.047, 0.013, shell, -0.143);
  for (let i = -5; i <= 5; i++) {
    const angle = i * Math.PI / 16;
    const tick = box(0.0009, 0.001, i % 2 === 0 ? 0.007 : 0.004, metal,
      Math.sin(angle) * 0.0475, Math.cos(angle) * 0.0475, -0.143, 0.0002);
    tick.rotation.z = -angle;
  }
  barrel(0.052, 0.014, rubber, -0.188);
  ring(0.048, 0.0016, brass, -0.194);
  barrel(0.043, 0.004, recess, -0.197);
  barrel(0.039, 0.003, glass, -0.2);
  ring(0.0395, 0.001, metal, -0.202);
  // 镀膜镜片使用浅弧面捕捉现有灯光，不依赖外部贴图或环境资源。
  const lens = add(new THREE.SphereGeometry(0.039, 40, 20), glass, 0, 0, -0.202);
  lens.scale.z = 0.09;

  // 镂空遮光斗及向前伸出的遮光旗。
  const hood = new THREE.Shape();
  hood.moveTo(-0.074, -0.054); hood.lineTo(0.074, -0.054);
  hood.lineTo(0.074, 0.054); hood.lineTo(-0.074, 0.054); hood.closePath();
  const aperture = new THREE.Path();
  aperture.moveTo(-0.06, -0.042); aperture.lineTo(-0.06, 0.042);
  aperture.lineTo(0.06, 0.042); aperture.lineTo(0.06, -0.042); aperture.closePath();
  hood.holes.push(aperture);
  add(new THREE.ExtrudeGeometry(hood, { depth: 0.024, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 1, steps: 1 }), rubber, 0, 0, -0.235);
  const flag = box(0.157, 0.003, 0.062, shell, 0, 0.06, -0.242, 0.001);
  flag.rotation.x = -0.16;
  for (const x of [-0.077, 0.077]) box(0.004, 0.088, 0.03, shell, x, 0, -0.22, 0.001);

  // 顶部监视器朝向操作者，带铰链、遮光边框与简单取景标记。
  box(0.013, 0.025, 0.019, metal, 0.069, 0.081, 0.025);
  box(0.049, 0.008, 0.019, metal, 0.084, 0.096, 0.025);
  box(0.112, 0.073, 0.014, rubber, 0.093, 0.14, 0.025, 0.005);
  box(0.1, 0.061, 0.002, metal, 0.093, 0.14, 0.033, 0.002);
  box(0.093, 0.053, 0.002, display, 0.093, 0.14, 0.0345, 0.001);
  for (const x of [-1, 1]) for (const y of [-1, 1]) {
    box(0.012, 0.0007, 0.0005, screenInk, 0.093 + x * 0.031, 0.14 + y * 0.017, 0.036, 0.0001);
    box(0.0007, 0.007, 0.0005, screenInk, 0.093 + x * 0.037, 0.14 + y * 0.014, 0.036, 0.0001);
  }
  box(0.006, 0.0007, 0.0005, screenInk, 0.093, 0.14, 0.036, 0.0001);
  box(0.0007, 0.006, 0.0005, screenInk, 0.093, 0.14, 0.036, 0.0001);

  // 静态零件按材质合并：齿纹、螺钉等细节不逐件增加 draw call。
  const batches = new Map();
  for (const mesh of g.children) {
    mesh.updateMatrix();
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrix);
    if (!batches.has(mesh.material)) batches.set(mesh.material, []);
    batches.get(mesh.material).push(geometry);
    mesh.geometry.dispose();
  }
  g.clear();
  for (const [mat, geometries] of batches) {
    g.add(new THREE.Mesh(mergeGeometries(geometries), mat));
    geometries.forEach(geometry => geometry.dispose());
  }
  return g;
}

// 把 CameraHelper 的多彩线框改为单色，匹配截图的青蓝视锥。
function tintHelper(helper, color) {
  helper.material.vertexColors = false;
  helper.material.color = new THREE.Color(color);
  helper.material.transparent = true;
  helper.material.opacity = 0.23;
  helper.material.depthTest = false;
  helper.material.depthWrite = false;
  helper.renderOrder = 1;
  helper.material.needsUpdate = true;
}

/**
 * 相机实体：真实 PerspectiveCamera + 摄影机模型 + CameraHelper 视锥。
 * - cam/body 作为 root 子节点，随 gizmo 变换；
 * - helper 必须挂到 scene（非 root），每帧 update()。
 */
export class CameraEntity extends Entity {
  constructor(name, { fov = CAMERA_FOV, aspect = 16 / 9, near = 0.1, far = 1000, scene, id } = {}) {
    const root = new THREE.Group();
    super('camera', name, root, id);
    this._scene = scene || null;

    // 真实相机（作为 root 子节点，继承位姿；far 保留供二期 POV 渲染）
    this.cam = new THREE.PerspectiveCamera(fov, aspect, near, far);
    root.add(this.cam);

    // 可视化专用相机：同步真实投影，far 仅延伸到注视区域。
    this._viz = new THREE.PerspectiveCamera(fov, aspect, 0.05, VIZ_FAR);
    root.add(this._viz);

    // 摄影机模型（参与 raycast 选择）
    this.body = buildCameraBody();
    root.add(this.body);

    // 视锥可视化（读 _viz.matrixWorld，必须在 scene 下）
    this.helper = new THREE.CameraHelper(this._viz);
    tintHelper(this.helper, FRUSTUM_COLOR);
    // 原 helper 保留近/远端矩形；四条侧边分段，避免正面观察时因跨近平面消失。
    this.helper.geometry.setDrawRange(0, 16);
    const sideGeometry = new THREE.BufferGeometry();
    sideGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * SIDE_STEPS * 2 * 3), 3));
    this._frustumSides = new THREE.LineSegments(sideGeometry, this.helper.material);
    this._frustumSides.frustumCulled = false;
    this._frustumSides.renderOrder = this.helper.renderOrder;
    this.helper.add(this._frustumSides);
    this._updateFrustumSides();
    if (this._scene) this._scene.add(this.helper);

    this.rollRad = 0;    // 荷兰角（弧度），aimAt 时叠加
    this._helpersOn = true; // 相机体+视锥是否允许显示（机位视角/截图时关闭）
    this.lookTarget = new THREE.Vector3(0, 0, -1); // 注视坐标（世界系约定）
  }

  get fov() { return this.cam.fov; }

  /** 视锥 helper 挂到场景（从文档重建时延后到入场那一刻，避免新视锥提前出现在画面里）。 */
  attachScene(scene) {
    if (this._scene === scene) return;
    if (this._scene) this._scene.remove(this.helper);
    this._scene = scene;
    scene.add(this.helper);
  }

  // ---- 场景文档 ----
  // transform 为准（rot 已含荷兰角）；lookAt 只回写面板显示，不触发重新瞄准；roll 供之后改注视坐标时叠加。
  toJSON({ base = null } = {}) {
    return {
      type: 'camera', id: this.id, name: this.name, visible: this.root.visible,
      transform: this.transformJSON(base || this.root), fov: round6(base ? base.fov : this.cam.fov),
      roll: round6(this.rollRad * R2D), lookAt: xyz(this.lookTarget),
    };
  }

  static async fromJSON(json, { app }) {
    const c = new CameraEntity(json.name, { fov: json.fov, aspect: app.viewportAspect(), id: json.id });
    c.applyTransform(json.transform);
    c.rollRad = json.roll * D2R;
    c.lookTarget.fromArray(json.lookAt);
    c.setVisible(json.visible);
    return c;
  }

  canApply(json) { return json.type === 'camera'; }

  applyJSON(json) {
    this.name = json.name;
    if (this.cam.fov !== json.fov) this.setFov(json.fov);
    this.applyTransform(json.transform);
    this.rollRad = json.roll * D2R;
    this.lookTarget.fromArray(json.lookAt);
    this.setVisible(json.visible);
    this.update();
  }

  labelTargets() { return [this]; }
  labelOffset() { return 0.2; }

  /** 一次性对准某点：root 的 -Z 指向 point，并叠加 Dutch roll。 */
  aimAt(point) {
    this.lookTarget.copy(point);
    const m = new THREE.Matrix4().lookAt(this.root.position, point, new THREE.Vector3(0, 1, 0));
    this.root.quaternion.setFromRotationMatrix(m);
    if (this.rollRad) this.root.rotateZ(this.rollRad);
    this.root.updateMatrixWorld(true);
    this.update();
  }

  setFov(deg) {
    this.cam.fov = deg;
    this.cam.updateProjectionMatrix();
    this._viz.fov = deg;
    this._viz.updateProjectionMatrix();
    this.helper.update();
    this._updateFrustumSides();
  }

  _updateFrustumSides() {
    const source = this.helper.geometry.getAttribute('position');
    const target = this._frustumSides.geometry.getAttribute('position');
    let index = 0;
    for (let edge = 0; edge < 4; edge++) {
      const start = 16 + edge * 2, end = start + 1;
      for (let step = 0; step < SIDE_STEPS; step++) {
        for (let endpoint = 0; endpoint < 2; endpoint++) {
          const t = (step + endpoint) / SIDE_STEPS;
          target.setXYZ(index++,
            THREE.MathUtils.lerp(source.getX(start), source.getX(end), t),
            THREE.MathUtils.lerp(source.getY(start), source.getY(end), t),
            THREE.MathUtils.lerp(source.getZ(start), source.getZ(end), t),
          );
        }
      }
    }
    target.needsUpdate = true;
  }

  /** 把视锥同步到真实相机当前世界矩阵（渲染前调用）。 */
  update() {
    this.root.updateWorldMatrix(true, true);
    const localTarget = this.lookTarget.clone().applyMatrix4(this.cam.matrixWorld.clone().invert());
    const depth = -localTarget.z;
    const far = Number.isFinite(depth) && depth > 0.1 ? THREE.MathUtils.clamp(depth * 1.08, 0.5, 40) : 4;
    if (this._viz.fov !== this.cam.fov || this._viz.aspect !== this.cam.aspect || Math.abs(this._viz.far - far) > 1e-6) {
      this._viz.fov = this.cam.fov;
      this._viz.aspect = this.cam.aspect;
      this._viz.far = far;
      this._viz.updateProjectionMatrix();
      this.helper.update();
      this._updateFrustumSides();
    }
  }

  setVisible(v) {
    super.setVisible(v);
    this._syncHelpers();
  }

  setHelpersVisible(v) {
    this._helpersOn = v;
    this._syncHelpers();
  }

  /** 默认机位不显示机身和近/远端方框；显式编辑时恢复完整辅助几何。 */
  setMinimalHelpers(on) {
    this.minimalHelpers = on;
    this.helper.geometry.setDrawRange(0, on ? 0 : 16);
  }

  /** 观察点靠近机身时隐藏它，避免遮挡；隐藏实体不参与拾取。 */
  syncBodyVisibility(observer) {
    const eye = observer.getWorldPosition(new THREE.Vector3());
    this.root.worldToLocal(eye);
    this.body.visible = this.visible && this._helpersOn && !this.minimalHelpers && eye.lengthSq() > 2 ** 2;
  }

  _syncHelpers() {
    const show = this.visible && this._helpersOn;
    this.body.visible = show && !this.minimalHelpers;
    this.helper.visible = show;
  }

  dispose() {
    if (this._scene) this._scene.remove(this.helper);
    this.helper.dispose();
    this._frustumSides.geometry.dispose();
    super.dispose();
  }
}
