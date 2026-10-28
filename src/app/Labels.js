import * as THREE from 'three';
import { el } from '../util/dom.js';

/** 名牌锚点（世界坐标）：实体根节点上方 labelOffset（头顶 / 机位上方），DOM 名牌与精灵名牌共用。 */
export function labelAnchor(t, worldScale, out) {
  t.root.getWorldPosition(out);
  out.y += t.labelOffset() * worldScale;
  return out;
}

const _camPos = new THREE.Vector3();

/** 名牌避让开关（selftest 对比用；平时恒开）。 */
export const labelLayout = { enabled: true };

/**
 * 名牌重叠避让（DOM 名牌与精灵名牌共用同一个函数，所以视口 / 截图 / 导出一致）。
 * items：{ x 名牌框底边中点屏幕 x, bottom 框底屏幕 y（向下为正）, w, h 框宽高, depth 到相机距离 }，单位一致即可。
 * 按屏幕 x 排序后，离相机近的先落位；后落位的（远的）与已落位的矩形相交就往上推，推开距离 = 重叠高度 + gap，
 * 直到与所有已落位的都不相交。结果写在 item.dy（向上推的距离，≥ 0）；没有重叠时 dy = 0，位置不变。
 */
export function layoutLabels(items, gap = 4) {
  const order = items.slice().sort((a, b) => a.x - b.x);
  for (const it of order) it.dy = 0;
  if (!labelLayout.enabled) return items;
  order.sort((a, b) => a.depth - b.depth); // 稳定排序：同距离按 x
  const placed = [];
  for (const it of order) {
    for (let moved = true; moved;) {
      moved = false;
      for (const o of placed) {
        if (Math.abs(it.x - o.x) * 2 >= it.w + o.w) continue;
        const bot = it.bottom - it.dy, oBot = o.bottom - o.dy;
        if (bot <= oBot - o.h || bot - it.h >= oBot) continue;
        it.dy += bot - (oBot - o.h) + gap; // 底边推到对方顶边之上 gap
        moved = true;
      }
    }
    placed.push(it);
  }
  return items;
}

// 3D 名牌层：为实体（及群众成员）建 DOM 名牌，渲染前投影到屏幕。
// 位置用 CSS translate（不触发布局），显隐仅在变化时写 DOM。
export class Labels {
  constructor(layerEl) {
    this.layer = layerEl;
    this.visible = true;      // scene.labels
    this.suppressed = false;  // 精灵名牌接管时（导出 / 预览名牌）隐藏 DOM 层，见 LabelSprites
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
    this._applyDisplay();
  }

  setSuppressed(v) {
    this.suppressed = v;
    this._applyDisplay();
  }

  _applyDisplay() { this.layer.style.display = this.visible && !this.suppressed ? 'block' : 'none'; }

  /**
   * @param {Entity[]} entities 顶层实体
   * @param {THREE.Camera} camera 当前渲染相机
   * @param {{worldScale:number, hideCameras:boolean}} opts
   */
  update(entities, camera, { worldScale, hideCameras }) {
    if (!this.visible || this.suppressed) return;
    const W = this.layer.clientWidth, H = this.layer.clientHeight;
    const p = this._tmp;
    const items = [];
    for (const ent of entities) {
      for (const t of ent.labelTargets()) {
        const lab = t.labelEl;
        if (!lab) continue;
        let show = t.visible && !((hideCameras || t.minimalHelpers) && t.type === 'camera');
        if (show) {
          labelAnchor(t, worldScale, p);
          const depth = p.distanceTo(_camPos.setFromMatrixPosition(camera.matrixWorld));
          p.project(camera);
          show = p.z < 1; // 在相机前方
          if (show) {
            if (lab._sizeText !== lab.textContent || !lab._w) { // 框尺寸按文字缓存（读 offset* 会触发布局）
              if (lab._shown === false) lab.style.display = '';
              lab._w = lab.offsetWidth; lab._h = lab.offsetHeight; lab._sizeText = lab.textContent;
            }
            // CSS transform translate(-50%, -135% / -160%)：框底在锚点上方 0.35h / 0.6h
            const ax = (p.x * 0.5 + 0.5) * W, ay = (-p.y * 0.5 + 0.5) * H;
            const lift = t.type === 'camera' ? 0.6 : 0.35;
            items.push({ lab, ax, ay, x: ax, bottom: ay - lift * lab._h, w: lab._w, h: lab._h, depth });
          }
        }
        if (lab._shown !== show) { lab._shown = show; lab.style.display = show ? '' : 'none'; }
      }
    }
    layoutLabels(items);
    for (const it of items) it.lab.style.translate = `${it.ax}px ${it.ay - it.dy}px`;
  }
}
