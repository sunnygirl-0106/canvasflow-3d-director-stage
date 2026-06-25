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
    this._buildFrameExtras();     // 三分构图网格 overlay + 开关（§A）
    this.setRatio('16:9');
  }

  // 取景框内：三分构图网格（默认关）+ 右上角「⌗」开关
  _buildFrameExtras() {
    this.gridOn = false;
    this.gridEl = document.createElement('div');
    this.gridEl.className = 'frame-grid';
    this.gridEl.innerHTML = '<i class="v1"></i><i class="v2"></i><i class="h1"></i><i class="h2"></i>';
    this.frameEl.appendChild(this.gridEl);

    const btn = document.createElement('button');
    btn.className = 'frame-grid-toggle';
    btn.title = '三分构图网格';
    btn.textContent = '⌗';
    btn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleGrid(); });
    this.frameEl.appendChild(btn);
    this.gridBtn = btn;
  }

  toggleGrid() {
    this.gridOn = !this.gridOn;
    this.gridEl.classList.toggle('on', this.gridOn);
    this.gridBtn.classList.toggle('on', this.gridOn);
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

  /**
   * 自动取景：把主体（角色/道具，跳过相机）拉到占满画面，使其成为主角、背景退为陪衬。
   * 关键点——**宽度只按主体「身体中心跨度 + 身宽余量」算，忽略 T-pose 张开的手臂**，
   * 这样相机能贴得足够近、人物足够大；张开的手臂允许裁出画面边缘（电影常规构图）。
   * 高度用骨骼盒全高。结果设为 home（「重置视角」回到此构图）。
   */
  frameAll(entities, { margin = 1.06, bodyPad = 0.32 } = {}) {
    const box = new THREE.Box3();        // 垂直 + 中心（角色用骨骼盒）
    const p = new THREE.Vector3();
    let any = false;
    let minX = Infinity, maxX = -Infinity; // 主体「中心」的水平跨度（忽略张开手臂）
    for (const e of entities) {
      if (!e || e.type === 'camera' || !e.visible) continue;
      e.root.updateMatrixWorld(true);
      if (e.type === 'character') {
        e.root.traverse((o) => { if (o.isBone) { o.getWorldPosition(p); box.expandByPoint(p); any = true; } });
      } else {
        const b = new THREE.Box3().setFromObject(e.root);
        if (!b.isEmpty()) { box.union(b); any = true; }
      }
      const c = e.root.getWorldPosition(new THREE.Vector3());
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
    }
    if (!any || box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const halfH = size.y * 0.5;
    const halfW = (maxX - minX) * 0.5 + bodyPad; // 中心跨度 + 身宽，不含手臂
    const dH = halfH / Math.tan(vfov / 2);
    const dW = halfW / Math.tan(hfov / 2);
    let dist = Math.max(dH, dW) * margin;
    dist = Math.max(this.controls.minDistance, Math.min(dist, this.controls.maxDistance));

    this.controls.target.copy(center);
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0.12, 1);
    dir.normalize();
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.controls.update();

    // 重置视角回到该自动取景
    this._home.pos.copy(this.camera.position);
    this._home.target.copy(this.controls.target);
  }

  resetView() {
    this.camera.position.copy(this._home.pos);
    this.controls.target.copy(this._home.target);
    this.controls.update();
  }

  /** 设取景比例并重排取景框。ratioStr ∈ 'free' | 任意 'w:h'（21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 …） */
  setRatio(ratioStr) {
    if (ratioStr === 'free' || ratioStr === 'auto' || ratioStr == null) {
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
