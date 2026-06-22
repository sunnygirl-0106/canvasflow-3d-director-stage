import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// OrbitControls + 聚焦选中 + 取景比例 overlay + 重置视角（§4 / §5.2）
export class CameraRig {
  constructor(camera, domElement, viewportEl, frameEl) {
    this.camera = camera;
    this.viewport = viewportEl;
    this.frameEl = frameEl;

    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0.95, 0);
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 40;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02; // 不穿到地面以下
    this.controls.update();

    // 默认视角，供 resetView 用
    this._home = {
      pos: camera.position.clone(),
      target: this.controls.target.clone(),
    };

    this.ratio = 16 / 9;          // 当前取景比例（null=自由）
    this.frameRect = null;        // 当前取景框 CSS 像素矩形（自由模式为 null=全幅）
    this.setRatio('16:9');
  }

  update() {
    this.controls.update();
  }

  /** 用实体包围盒设 target 与相机距离（角色用骨骼世界坐标量真实尺寸，§5.2）。 */
  focus(entity) {
    if (!entity) return;
    const root = entity.root;
    root.updateMatrixWorld(true);

    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    let measured = false;
    if (entity.type === 'character') {
      // SkinnedMesh 静态包围盒会被放大，改用骨骼世界坐标
      root.traverse((o) => {
        if (o.isBone) { o.getWorldPosition(p); box.expandByPoint(p); measured = true; }
      });
    }
    if (!measured) {
      box.setFromObject(root);
      if (box.isEmpty()) return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const h = Math.max(size.x, size.y, size.z) || 1.7;

    this.controls.target.copy(center);
    const fitDist = (h * 0.5) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5));
    const dist = fitDist * 1.8;

    // 保持当前观察方向，仅调整距离与朝向中心
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
    if (dir.lengthSq() < 1e-6) dir.set(0.3, 0.2, 1).normalize();
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.controls.update();
  }

  resetView() {
    this.camera.position.copy(this._home.pos);
    this.controls.target.copy(this._home.target);
    this.controls.update();
  }

  /** 设取景比例并重排取景框。ratioStr ∈ '16:9'|'9:16'|'1:1'|'free' */
  setRatio(ratioStr) {
    if (ratioStr === 'free') {
      this.ratio = null;
      this.frameEl.style.display = 'none';
      this.frameRect = null;
      return;
    }
    const [w, h] = ratioStr.split(':').map(Number);
    this.ratio = w / h;
    this.frameEl.style.display = 'block';
    this.layoutFrame();
  }

  /** 根据当前比例在视口中央排一个取景框，并记录裁剪矩形。 */
  layoutFrame() {
    if (this.ratio == null) { this.frameRect = null; return; }
    const W = this.viewport.clientWidth;
    const H = this.viewport.clientHeight;
    let fw = W * 0.7;
    let fh = fw / this.ratio;
    if (fh > H * 0.82) { fh = H * 0.82; fw = fh * this.ratio; }
    const x = (W - fw) / 2;
    const y = (H - fh) / 2;
    this.frameRect = { x, y, w: fw, h: fh };
    this.frameEl.style.left = x + 'px';
    this.frameEl.style.top = y + 'px';
    this.frameEl.style.width = fw + 'px';
    this.frameEl.style.height = fh + 'px';
  }

  onResize() {
    if (this.ratio != null) this.layoutFrame();
  }
}
