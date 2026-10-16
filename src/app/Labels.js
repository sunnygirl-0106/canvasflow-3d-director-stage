import * as THREE from 'three';
import { el } from '../util/dom.js';

// 3D 名牌层：为实体（及群众成员）建 DOM 名牌，渲染前投影到屏幕。
// 位置用 CSS translate（不触发布局），显隐仅在变化时写 DOM。
export class Labels {
  constructor(layerEl) {
    this.layer = layerEl;
    this.visible = true;
    this._tmp = new THREE.Vector3();
  }

  attach(ent) {
    for (const t of ent.labelTargets()) {
      if (t.labelEl) continue;
      t.labelEl = el('div', { class: 'label3d' + (t.type === 'camera' ? ' cam' : ''), text: t.name });
      t.labelEl._shown = true;
      this.layer.appendChild(t.labelEl);
    }
  }

  detach(ent) {
    for (const t of [ent, ...ent.labelTargets()]) {
      t.labelEl?.remove();
      t.labelEl = null;
    }
  }

  rename(ent) { if (ent.labelEl) ent.labelEl.textContent = ent.name; }

  setVisible(v) {
    this.visible = v;
    this.layer.style.display = v ? 'block' : 'none';
  }

  /**
   * @param {Entity[]} entities 顶层实体
   * @param {THREE.Camera} camera 当前渲染相机
   * @param {{worldScale:number, hideCameras:boolean}} opts
   */
  update(entities, camera, { worldScale, hideCameras }) {
    if (!this.visible) return;
    const W = this.layer.clientWidth, H = this.layer.clientHeight;
    const p = this._tmp;
    for (const ent of entities) {
      for (const t of ent.labelTargets()) {
        const lab = t.labelEl;
        if (!lab) continue;
        let show = t.visible && !(hideCameras && t.type === 'camera');
        if (show) {
          t.root.getWorldPosition(p);
          p.y += t.labelOffset() * worldScale;
          p.project(camera);
          show = p.z < 1; // 在相机前方
          if (show) lab.style.translate = `${(p.x * 0.5 + 0.5) * W}px ${(-p.y * 0.5 + 0.5) * H}px`;
        }
        if (lab._shown !== show) { lab._shown = show; lab.style.display = show ? '' : 'none'; }
      }
    }
  }
}
