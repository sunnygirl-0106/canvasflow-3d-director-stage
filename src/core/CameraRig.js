import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { worldBox } from '../util/measure.js';

// OrbitControls + 自动取景 + 取景比例 overlay + 重置视角
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

    this.ratio = null;            // 当前取景比例（null=自由）
    this.frameRect = null;        // 当前取景框 CSS 像素矩形（自由模式为 null=全幅）
    this._buildFrameExtras();     // 三分构图网格 overlay + 开关
    this.setRatio('free');
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

  /** 推进阻尼；返回相机是否仍在移动。 */
  update() {
    return this.controls.update();
  }

  /**
   * 自动取景：把主体（角色/道具，跳过相机）拉到占满画面，使其成为主角、背景退为陪衬。
   * 关键点——**宽度只按主体「身体中心跨度 + 身宽余量」算，忽略 T-pose 张开的手臂**，
   * 这样相机能贴得足够近、人物足够大；张开的手臂允许裁出画面边缘（电影常规构图）。
   * 高度用骨骼盒全高。结果设为 home（「重置视角」回到此构图）。
   * insetRight：视口右侧被遮住的宽度占比（AI 抽屉打开时）。> 0 时按剩余宽度取景、主体居中在左侧可用区域，
   * 并保证每个主体的包围盒（角色用骨骼盒）投影都落在可用区域内（不够就再拉远）。
   */
  frameAll(entities, { margin = 1.06, bodyPad = 0.32, insetRight = 0 } = {}) {
    const box = new THREE.Box3();        // 垂直 + 中心（角色用骨骼盒）
    const boxes = [];
    let any = false;
    let minX = Infinity, maxX = -Infinity; // 主体「中心」的水平跨度（忽略张开手臂）
    for (const e of entities) {
      if (!e || e.type === 'camera' || !e.visible) continue;
      const b = worldBox(e.root, { useBones: e.type === 'character' });
      if (!b.isEmpty()) { box.union(b); boxes.push(b); any = true; }
      const c = e.root.getWorldPosition(new THREE.Vector3());
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
    }
    if (!any || box.isEmpty()) return;

    const free = 1 - Math.min(Math.max(insetRight, 0), 0.8); // 可用宽度占比
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const tanFull = Math.tan(vfov / 2) * this.camera.aspect;
    const hfov = 2 * Math.atan(tanFull * free);
    const halfH = size.y * 0.5;
    const halfW = (maxX - minX) * 0.5 + bodyPad; // 中心跨度 + 身宽，不含手臂
    const dH = halfH / Math.tan(vfov / 2);
    const dW = halfW / Math.tan(hfov / 2);
    let dist = Math.max(dH, dW) * margin;
    dist = Math.max(this.controls.minDistance, Math.min(dist, this.controls.maxDistance));

    const dir = new THREE.Vector3().subVectors(this.camera.position, center); // 视线方向保持（从主体中心看过来）
    if (dir.lengthSq() < 1e-6) dir.set(0, 0.12, 1);
    dir.normalize();
    const right = new THREE.Vector3().crossVectors(this.camera.up, dir).normalize(); // 相机右方
    const place = (d) => {
      // 可用区域的中心在 NDC x = −insetRight：注视点向右偏 insetRight × 半画幅宽，主体就落在左侧区域中央
      this.controls.target.copy(center).addScaledVector(right, (1 - free) * d * tanFull);
      this.camera.position.copy(this.controls.target).addScaledVector(dir, d);
      this.controls.update();
    };
    place(dist);
    if (free < 1) {
      const xMax = 1 - 2 * (1 - free), p = new THREE.Vector3();
      const inside = () => {
        this.camera.updateMatrixWorld(true);
        for (const b of boxes) {
          for (let i = 0; i < 8; i++) {
            p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(this.camera);
            if (p.x < -0.98 || p.x > xMax - 0.02 || Math.abs(p.y) > 0.98) return false;
          }
        }
        return true;
      };
      for (let i = 0; i < 40 && !inside() && dist < this.controls.maxDistance; i++) {
        dist = Math.min(dist * 1.06, this.controls.maxDistance);
        place(dist);
      }
    }

    this.saveHome(); // 重置视角回到该自动取景
  }

  /** 把当前视角记为「重置视角」的目标。 */
  saveHome() {
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
