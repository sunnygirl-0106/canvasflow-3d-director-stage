import { el } from '../util/dom.js';
import { tripleRow, sliderRow, colorRow, toHex } from './widgets.js';
import { PoseSliders } from './PoseSliders.js';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

// 右侧属性面板：道具属性 OR 角色（属性 + 姿势）。选中对象时显示。
export class Inspector {
  constructor(container, app) {
    this.app = app;
    this.container = container;
    this.tab = 'attr'; // 角色：'attr' | 'pose'
    this._syncFn = null;
    this.poseSliders = null;
  }

  show(entity) {
    this.entity = entity;
    this._syncFn = null;
    this.poseSliders = null;
    const root = el('div', { class: 'rp rp-pad' });

    if (!entity) { this.container.innerHTML = ''; return; }

    root.appendChild(el('h2', { text: entity.type === 'character' ? '角色' : '道具' }));

    if (entity.type === 'character') {
      const tabs = el('div', { class: 'ptabs' });
      const a = el('button', { text: '属性', class: this.tab === 'attr' ? 'on' : '', onclick: () => { this.tab = 'attr'; this.show(entity); } });
      const p = el('button', { text: '姿势', class: this.tab === 'pose' ? 'on' : '', onclick: () => { this.tab = 'pose'; this.show(entity); } });
      tabs.append(a, p);
      root.appendChild(tabs);
      if (this.tab === 'attr') this._attr(root, entity);
      else this._pose(root, entity);
    } else {
      this._attr(root, entity);
    }

    this.container.innerHTML = '';
    this.container.appendChild(root);
  }

  refreshName() {
    if (this._nameInput && this.entity) this._nameInput.value = this.entity.name;
  }

  // ---- 属性页（角色/道具通用）----
  _attr(root, ent) {
    const o = ent.root;

    // 名称
    const nameInput = el('input', { value: ent.name });
    nameInput.addEventListener('change', () => this.app.rename(ent.id, nameInput.value));
    this._nameInput = nameInput;
    root.appendChild(el('div', { class: 'field' }, [el('label', { text: '名称' }), el('div', { class: 'namefld' }, [nameInput])]));

    // 位置
    const pos = tripleRow({ label: '位置', axes: ['x', 'y', 'z'].map((k) => ({ key: k, get: () => o.position[k], set: (v) => { o.position[k] = v; } })) });
    root.appendChild(pos.el);

    // 旋转（度）
    const rot = tripleRow({ label: '旋转', deg: true, axes: ['x', 'y', 'z'].map((k) => ({ key: k, get: () => o.rotation[k] * R2D, set: (v) => { o.rotation[k] = v * D2R; } })) });
    root.appendChild(rot.el);

    // 缩放
    const scl = tripleRow({ label: '缩放', axes: ['x', 'y', 'z'].map((k) => ({ key: k, get: () => o.scale[k], set: (v) => { o.scale[k] = Math.max(0.05, v); } })) });
    root.appendChild(scl.el);

    // 统一缩放（以归一化基准为 1.0）
    const uni = sliderRow({
      label: '统一缩放', min: 0.2, max: 3, step: 0.01, value: o.scale.x / ent.baseScale,
      format: (v) => v.toFixed(1),
      onInput: (v) => { o.scale.setScalar(ent.baseScale * v); scl.syncAll(); },
    });
    root.appendChild(uni.el);

    // 颜色
    const col = colorRow({ label: '颜色', hex: toHex(ent.color), onChange: (h) => { ent.setColor(h); this.app.ui?.outliner?.refresh(); } });
    root.appendChild(col.el);

    this._syncFn = () => { pos.syncAll(); rot.syncAll(); scl.syncAll(); uni.set(o.scale.x / ent.baseScale); };
  }

  // ---- 姿势页（角色）----
  _pose(root, ent) {
    // 预设动作
    root.appendChild(el('div', { class: 'sec-title', text: '预设动作', style: { marginTop: '4px' } }));
    const clips = el('div', { class: 'clips' });
    const tpose = el('button', { text: 'T-Pose', class: ent.currentClip == null && ent.poseMode === 'preset' ? 'on' : '',
      onclick: () => { ent.resetPose(); this.poseSliders?.syncFromValues(); mark(null); } });
    clips.appendChild(tpose);
    const btns = { __rest__: tpose };
    for (const name of ent.clipNames) {
      const b = el('button', { text: name, class: ent.currentClip === name ? 'on' : '',
        onclick: () => { ent.playClip(name); this.poseSliders?.syncFromValues(); mark(name); } });
      btns[name] = b;
      clips.appendChild(b);
    }
    function mark(name) { Object.entries(btns).forEach(([k, b]) => b.classList.toggle('on', k === (name == null ? '__rest__' : name))); }
    root.appendChild(clips);
    if (!ent.clipNames.length) root.appendChild(el('div', { class: 'hint', text: '该模型无内置动画。' }));

    // 复位姿势
    root.appendChild(el('button', { class: 'minibtn', text: '⟲ 复位姿势', style: { marginTop: '12px' },
      onclick: () => { ent.resetPose(); this.poseSliders?.syncFromValues(); mark(null); } }));

    // 全身姿势滑条
    const host = el('div', {});
    root.appendChild(host);
    this.poseSliders = new PoseSliders(host, ent);
  }

  /** gizmo 拖动后回写数值。 */
  syncFromObject() { if (this._syncFn) this._syncFn(); }
}
