import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Entity } from './Entity.js';
import { round6, xyz } from '../util/math.js';
import { CAMERA_FOV } from '../config.js';

const FRUSTUM_COLOR = 0x8297a6; // 低强调蓝灰视锥线
const VIZ_FAR = 4; // 无有效前向目标时的有限缺省长度
const SIDE_STEPS = 32; // 分段绘制穿过观察相机近平面的视锥长边

// 紧凑数字摄影机：倒角机身、镜筒、遮光斗和提手。镜头朝 -Z。
// 保持真实道具尺度；浅灰外壳配中灰结构，保证深色画布上的辨识度。
function buildCameraBody() {
  const g = new THREE.Group();
  // 少量同色自发光为背光面提供亮度下限，避免旋转视角后再次融入背景。
  const material = (color, roughness, metalness) => new THREE.MeshStandardMaterial({
    color, roughness, metalness, fog: false, emissive: color, emissiveIntensity: 0.12,
  });
  const shell = material(0xaab7c5, 0.7, 0.12);
  const rubber = material(0x596978, 0.86, 0.04);
  const metal = material(0xd0dbe5, 0.45, 0.32);
  const glass = material(0x38677a, 0.18, 0.3);
  const add = (geometry, mat, x, y, z) => {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  const box = (w, h, d, mat, x, y, z, radius = 0.003) =>
    add(new RoundedBoxGeometry(w, h, d, 2, radius), mat, x, y, z);
  const barrel = (radius, depth, mat, z) => {
    const mesh = add(new THREE.CylinderGeometry(radius, radius, depth, 24), mat, 0, 0, z);
    mesh.rotation.x = Math.PI / 2;
    return mesh;
  };

  box(0.17, 0.125, 0.19, shell, 0, 0, 0.015, 0.009);
  box(0.145, 0.105, 0.044, rubber, 0, 0, 0.122, 0.006); // 电池
  box(0.009, 0.078, 0.114, rubber, 0.086, -0.003, 0.025);
  box(0.009, 0.062, 0.085, metal, -0.086, 0, 0.023);
  // 提手保留中间镂空，缩小后仍能读出摄影机轮廓。
  box(0.025, 0.025, 0.018, metal, 0, 0.074, -0.038);
  box(0.025, 0.025, 0.018, metal, 0, 0.074, 0.064);
  box(0.032, 0.018, 0.135, metal, 0, 0.094, 0.013);
  box(0.11, 0.016, 0.11, metal, 0, -0.069, 0.012); // 快装底座

  barrel(0.047, 0.095, rubber, -0.123);
  barrel(0.049, 0.012, metal, -0.098); // 镜头卡口
  barrel(0.051, 0.019, shell, -0.143); // 对焦环
  barrel(0.053, 0.014, rubber, -0.174);
  barrel(0.041, 0.004, glass, -0.184);

  // 遮光斗使用镂空框，前后观察都能看见镜片。
  const hood = new THREE.Shape();
  hood.moveTo(-0.071, -0.05); hood.lineTo(0.071, -0.05);
  hood.lineTo(0.071, 0.05); hood.lineTo(-0.071, 0.05); hood.closePath();
  const aperture = new THREE.Path();
  aperture.moveTo(-0.057, -0.038); aperture.lineTo(-0.057, 0.038);
  aperture.lineTo(0.057, 0.038); aperture.lineTo(0.057, -0.038); aperture.closePath();
  hood.holes.push(aperture);
  add(new THREE.ExtrudeGeometry(hood, { depth: 0.026, bevelEnabled: false, steps: 1 }), shell, 0, 0, -0.215);
  box(0.15, 0.006, 0.046, shell, 0, 0.053, -0.204);
  g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
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
      roll: round6(this.rollRad * 180 / Math.PI), lookAt: xyz(this.lookTarget),
    };
  }

  static async fromJSON(json, { app }) {
    const c = new CameraEntity(json.name, { fov: json.fov, aspect: app.viewportAspect(), id: json.id });
    c.applyTransform(json.transform);
    c.rollRad = json.roll * Math.PI / 180;
    c.lookTarget.fromArray(json.lookAt);
    c.setVisible(json.visible);
    return c;
  }

  canApply(json) { return json.type === 'camera'; }

  applyJSON(json) {
    this.name = json.name;
    if (this.cam.fov !== json.fov) this.setFov(json.fov);
    this.applyTransform(json.transform);
    this.rollRad = json.roll * Math.PI / 180;
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
