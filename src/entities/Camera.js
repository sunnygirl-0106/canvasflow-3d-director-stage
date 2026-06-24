import * as THREE from 'three';
import { Entity } from './Entity.js';

const BODY_COLOR = 0xff8a3d;   // 橙色相机体（对齐截图）
const FRUSTUM_COLOR = 0x35a7ff; // 青蓝色视锥线
const VIZ_FAR = 0.5;            // 视锥可视化深度（紧凑小锥体，避免读真实相机 far=1000 拉成射线）

// 橙色相机造型（机身 + 镜头 + 胶片盘）。镜头朝 -Z，与 PerspectiveCamera 朝向一致。
// 尺度参照角色（约 1.7 单位）：相机为小道具，机身约 0.13 高。
function buildCameraBody() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: BODY_COLOR, roughness: 0.5, metalness: 0.1, emissive: 0x3a1600, emissiveIntensity: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.11, 0.2), mat);
  g.add(body);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.052, 0.08, 18), mat);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, 0, -0.135);
  g.add(lens);
  const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.025, 18), mat);
  reel.rotation.x = Math.PI / 2;
  reel.position.set(0.03, 0.085, 0.02);
  g.add(reel);
  g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  return g;
}

// 把 CameraHelper 的多彩线框改为单色，匹配截图的青蓝视锥。
function tintHelper(helper, color) {
  helper.material.vertexColors = false;
  helper.material.color = new THREE.Color(color);
  helper.material.transparent = true;
  helper.material.opacity = 0.85;
  helper.material.needsUpdate = true;
}

/**
 * 相机实体（§4.1）：真实 PerspectiveCamera + 橙色相机体 + CameraHelper 视锥。
 * - cam/body 作为 root 子节点，随 gizmo 变换；
 * - helper 必须挂到 scene（非 root），每帧 update()。
 */
export class CameraEntity extends Entity {
  constructor(name, { fov = 40, aspect = 16 / 9, near = 0.1, far = 1000, scene } = {}) {
    const root = new THREE.Group();
    super('camera', name, root);
    this._scene = scene || null;

    // 真实相机（作为 root 子节点，继承位姿；far 保留供二期 POV 渲染）
    this.cam = new THREE.PerspectiveCamera(fov, aspect, near, far);
    root.add(this.cam);

    // 可视化专用相机：同 fov/aspect 但 far 很短，让视锥呈紧凑小锥体（非长射线）
    this._viz = new THREE.PerspectiveCamera(fov, aspect, 0.05, VIZ_FAR);
    root.add(this._viz);

    // 橙色相机体（参与 raycast 选择）
    this.body = buildCameraBody();
    root.add(this.body);

    // 视锥可视化（读 _viz.matrixWorld，必须在 scene 下）
    this.helper = new THREE.CameraHelper(this._viz);
    tintHelper(this.helper, FRUSTUM_COLOR);
    if (this._scene) this._scene.add(this.helper);

    this.labelEl = null;
    this.height = 0.2; // 名牌锚点参考偏移
    this._roll = 0;    // 荷兰角（弧度），aimAt 时叠加
    this.lookTarget = new THREE.Vector3(0, 0, -1); // 注视坐标（世界系约定）
  }

  get fov() { return this.cam.fov; }

  /** 一次性对准某点：root 的 -Z 指向 point，并叠加 Dutch roll。 */
  aimAt(point) {
    this.lookTarget.copy(point);
    const m = new THREE.Matrix4().lookAt(this.root.position, point, new THREE.Vector3(0, 1, 0));
    this.root.quaternion.setFromRotationMatrix(m);
    if (this._roll) this.root.rotateZ(this._roll);
    this.root.updateMatrixWorld(true);
    this.update();
  }

  setFov(deg) {
    this.cam.fov = deg;
    this.cam.updateProjectionMatrix();
    this._viz.fov = deg;
    this._viz.updateProjectionMatrix();
    this.helper.update();
  }

  setAspect(a) {
    this.cam.aspect = a;
    this.cam.updateProjectionMatrix();
    this._viz.aspect = a;
    this._viz.updateProjectionMatrix();
    this.helper.update();
  }

  /** 每帧把视锥同步到真实相机当前世界矩阵。 */
  update() {
    this.helper.update();
  }

  setVisible(v) {
    super.setVisible(v);
    this.helper.visible = v;
  }

  /** 名牌锚点（相机体上方一点）的世界坐标。 */
  getLabelAnchor(out = new THREE.Vector3()) {
    this.body.getWorldPosition(out);
    out.y += 0.16;
    return out;
  }

  dispose() {
    if (this._scene) this._scene.remove(this.helper);
    this.helper.dispose();
    super.dispose();
  }
}
