import * as THREE from 'three';
import { worldBox } from '../util/measure.js';

// Raycaster 选择 + 高亮（§4 / §5）。
// 点击画布 → 命中后向上回溯到挂 userData.entityId 的 root → onSelect(id)；点空白取消选中。
export class Selection {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Camera} camera
   * @param {THREE.Scene} scene
   * @param {() => Entity[]} getEntities
   * @param {(id:string|null)=>void} onSelect
   */
  constructor(renderer, camera, scene, getEntities, onSelect) {
    this.renderer = renderer;
    this.camera = camera;
    this.scene = scene;
    this.getEntities = getEntities;
    this.onSelect = onSelect;

    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this._down = new THREE.Vector2();

    // 地面选中环（高亮指示）
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.46, 0.56, 48),
      new THREE.MeshBasicMaterial({ color: 0x4f8ef7, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.012;
    this.ring.visible = false;
    this.ring.renderOrder = 2;
    scene.add(this.ring);

    this.selectedEntity = null;
    this._shouldSkip = () => false; // 由外部注入（拖 gizmo 时跳过选择）

    const dom = renderer.domElement;
    dom.addEventListener('pointerdown', (e) => {
      this._down.set(e.clientX, e.clientY);
    });
    dom.addEventListener('pointerup', (e) => {
      // 只把"几乎没移动"的按下当作点选，避免与环绕/拖拽冲突
      const moved = Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y);
      if (moved > 4) return;
      if (this._shouldSkip()) return;
      this._pick(e);
    });
  }

  setSkipPredicate(fn) { this._shouldSkip = fn; }

  _pick(e) {
    const dom = this.renderer.domElement;
    const r = dom.getBoundingClientRect();
    this.ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.ray.setFromCamera(this.ndc, this.camera);

    const roots = this.getEntities().filter((en) => en.visible).map((en) => en.root);
    // Raycaster 不跳过 visible=false 的对象；须自行过滤，否则 POV 下被隐藏的
    // 出画相机 body/视锥仍会被命中（且罩在视口里），把点击角色错判成选中相机。
    const hits = this.ray.intersectObjects(roots, true).filter((h) => {
      for (let o = h.object; o; o = o.parent) if (o.visible === false) return false;
      return true;
    });
    if (!hits.length) { this.onSelect(null); return; }

    // 向上回溯到带 entityId 的 root
    let o = hits[0].object;
    while (o && o.userData.entityId == null) o = o.parent;
    this.onSelect(o ? o.userData.entityId : null);
  }

  /** 设置高亮目标（null=隐藏环）。 */
  highlight(entity) {
    this.selectedEntity = entity;
    this.ring.visible = !!entity;
    if (entity) this._sizeRing(entity);
  }

  _sizeRing(entity) {
    const box = worldBox(entity.root, { useBones: entity.type === 'character' });
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const rad = Math.max(0.4, 0.5 * Math.hypot(size.x, size.z) + 0.12);
    this.ring.scale.setScalar(rad / 0.5);
  }

  /** 每帧把环跟随到选中实体脚下。 */
  update() {
    if (!this.selectedEntity) return;
    const p = new THREE.Vector3();
    this.selectedEntity.root.getWorldPosition(p);
    this.ring.position.x = p.x;
    this.ring.position.z = p.z;
  }
}
