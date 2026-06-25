import { el } from '../util/dom.js';
import { DockMenu } from './dockMenu.js';
import { HistoryModal } from './HistoryModal.js';
import { groupedPresets } from '../core/cameraPresets.js';
import { listCanvasAssets } from '../util/assetLibrary.js';
import { RATIO_OPTIONS, isPanoRatio, BODY_TYPES } from '../app/App.js';

// 内联图标
const IC = {
  pointer: '<path d="M5 3l15 8-6 1.6L11 19z"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="M12 3l-2.4 2.6M12 3l2.4 2.6M12 21l-2.4-2.6M12 21l2.4 2.6M3 12l2.6-2.4M3 12l2.6 2.4M21 12l-2.6-2.4M21 12l-2.6 2.4"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/>',
  scale: '<path d="M21 3h-6M21 3v6M21 3l-7 7"/><path d="M3 21h6M3 21v-6M3 21l7-7"/>',
  transform: '<path d="M12 3v18M3 12h18"/><path d="M12 3l-2.4 2.6M12 3l2.4 2.6M12 21l-2.4-2.6M12 21l2.4 2.6M3 12l2.6-2.4M3 12l2.6 2.4M21 12l-2.6-2.4M21 12l-2.6 2.4"/>',
  person: '<circle cx="12" cy="5.5" r="2.4"/><path d="M12 8.4c-2.4 0-4 1.6-4 4v3M12 8.4c2.4 0 4 1.6 4 4v3M9 21v-5M15 21v-5"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M21 16l-5-5-4 4-2-2-7 7"/>',
  video: '<rect x="3" y="6" width="12" height="12" rx="2"/><path d="M15 10l6-3v10l-6-3"/>',
  frame: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/>',
  shot: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.2"/>',
  send: '<rect x="3" y="4" width="14" height="14" rx="2"/><path d="M7 14l3-3 3 3M21 8v9a2 2 0 0 1-2 2h-9"/>',
  expand: '<path d="M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6"/>',
  upload: '<path d="M12 16V5M8 9l4-4 4 4M5 19h14"/>',
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 3v18M4 7.5l8 4.5 8-4.5"/>',
  group: '<circle cx="7" cy="7" r="2.1"/><circle cx="17" cy="7" r="2.1"/><circle cx="7" cy="17" r="2.1"/><circle cx="17" cy="17" r="2.1"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 4v4h4M12 7v5l3 2"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
};
const svg = (name, w = 21) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${IC[name]}</svg>`;

// 素体清单从体型注册表生成（单一事实来源，见 App.BODY_TYPES）
const CHARACTERS = Object.entries(BODY_TYPES).map(([key, v]) => [key, v.label]);
const GEO = [['box', '方块'], ['cylinder', '圆柱'], ['sphere', '球体'], ['mannequin', '人体素模']];
const TF_MODES = [['translate', 'move', '移动'], ['rotate', 'rotate', '旋转'], ['scale', 'scale', '缩放']];

// 底部悬浮工具坞（八按钮，§3）：变换 / 添加 / 全景图 / 机位 / 比例 / 截图 / 发送 / 全屏
export class Dock {
  constructor(container, app) {
    this.app = app;
    this.container = container;
    this.modeBtns = {};
    this._assets = [];
    listCanvasAssets().then((a) => { this._assets = a; });
    this._history = new HistoryModal({
      getAssets: () => this._assets,
      onPick: (a) => app.setPanoramaFromAsset(a),
      // 仅 2:1 图片可作全景；其余（非 2:1、视频）在弹层中置灰禁用
      isEligible: (a) => a.type === 'image' && isPanoRatio(a.w, a.h),
      ineligibleReason: (a) => (a.type !== 'image' ? '视频不可作全景' : '需 2:1 全景图'),
    });
    this.render();
  }

  _btn(icon, title, onClick, key) {
    const b = el('button', { class: 'dockbtn', title, html: svg(icon), onclick: onClick });
    if (key) this.modeBtns[key] = b;
    return b;
  }

  _sep() { return el('div', { class: 'dock-sep' }); }

  // 通用菜单项（可选打勾）
  _item(icon, label, onClick, checked = false, iconSize = 17) {
    return el('div', { class: 'menu-item', onclick: onClick }, [
      el('span', { class: 'mi-ic', html: icon ? svg(icon, iconSize) : '' }),
      el('span', { class: 'mi-label', text: label }),
      checked ? el('span', { class: 'mi-check', text: '✓' }) : null,
    ]);
  }

  render() {
    const app = this.app;
    const c = this.container;
    c.innerHTML = '';
    this.modeBtns = {};

    // 1 变换（移动/旋转/缩放）
    const tf = this._btn(this._modeIcon(app.transformMode), '变换（移动 / 旋转 / 缩放）', (e) => { e.stopPropagation(); this.transformMenu.toggle(); });
    tf.classList.add('on');
    this.transformBtn = tf;

    // 2 添加角色 / 模型
    const addBtn = this._btn('person', '添加角色 / 模型', (e) => { e.stopPropagation(); this.addMenu.toggle(); });
    this.addBtn = addBtn;

    // 3 全景图
    const pano = this._btn('image', '全景图（本地上传 / 历史记录）', (e) => { e.stopPropagation(); this.panoMenu.toggle(); });
    this.panoBtn = pano;

    // 4 添加机位
    const camAdd = this._btn('video', '添加机位（预设）', (e) => { e.stopPropagation(); this.camMenu.toggle(); });
    this.camAddBtn = camAdd;

    // 5 取景比例
    const frame = this._btn('frame', '选择画幅比例', (e) => { e.stopPropagation(); this.ratioMenu.toggle(); });
    this.ratioBtn = frame;

    // 6 截图
    const shot = this._btn('shot', '截图', () => app.captureShot());

    // 7 全屏（发送按钮已移除，职能迁移到右侧「摄像机截图」面板）
    const full = this._btn('expand', '全屏', () => this._toggleFullscreen());
    this.fullBtn = full;

    c.append(tf, addBtn, pano, camAdd, this._sep(), frame, shot, this._sep(), full);

    // ---- 菜单（统一由 DockMenu 管理）----
    this.menu = new DockMenu(c);

    this.transformMenu = this.menu.create({
      anchor: tf, minWidth: '150px',
      build: () => TF_MODES.map(([mode, icon, label]) =>
        this._item(icon, label, () => { app.setTransformMode(mode); this.menu.close(); }, app.transformMode === mode)),
    });

    this.addMenu = this.menu.create({ anchor: addBtn, build: () => this._buildAddItems() });
    this.panoMenu = this.menu.create({ anchor: pano, build: () => this._buildPanoItems() });
    this.camMenu = this.menu.create({ anchor: camAdd, className: 'cammenu', build: () => this._buildCamItems() });

    this.ratioMenu = this.menu.create({
      anchor: frame, minWidth: '150px',
      build: () => RATIO_OPTIONS.map(([val, label]) =>
        this._item(null, label, () => { app.setRatio(val); this.menu.close(); }, app.ratio === val)),
    });

    // 全屏态高亮
    if (!this._fsBound) {
      this._fsBound = true;
      document.addEventListener('fullscreenchange', () => this.fullBtn?.classList.toggle('on', !!document.fullscreenElement));
    }
  }

  // ---- 添加角色/模型菜单（§3.b，迁移到 helper）----
  _buildAddItems() {
    const app = this.app;
    const items = [];

    for (const [key, label] of CHARACTERS) {
      items.push(this._item('person', label, () => { app.addCharacter(key); this.menu.close(); }));
    }
    items.push(this._buildCrowdItem());
    items.push(el('div', { class: 'menu-sep' }));

    const sub = el('div', { class: 'submenu' }, GEO.map(([kind, label]) =>
      this._item('cube', label, () => { app.addProp(kind); this.menu.close(); }, false, 16)));
    items.push(el('div', { class: 'menu-item has-sub' }, [
      el('span', { class: 'mi-ic', html: svg('cube', 17) }),
      el('span', { class: 'mi-label', text: '几何模型' }),
      el('span', { class: 'mi-arrow', html: svg('chevron', 14) }),
      sub,
    ]));
    return items;
  }

  // ---- 群众阵列：菜单项 + 行列/间距表单（hover 展开侧栏）----
  _buildCrowdItem() {
    const app = this.app;
    const st = { rows: 3, cols: 3, spacing: 1.2 };
    const count = el('span', { class: 'crowd-count', text: '共9人' });
    const upd = () => { count.textContent = '共' + (st.rows * st.cols) + '人'; };

    const numField = (label, key, step, min, max) => {
      const inp = el('input', { class: 'crowd-inp', type: 'number', value: st[key], min, max, step });
      const fix = () => { let v = parseFloat(inp.value); if (isNaN(v)) return; v = Math.max(min, Math.min(max, v)); st[key] = v; upd(); };
      inp.addEventListener('input', fix);
      inp.addEventListener('click', (e) => e.stopPropagation());
      return el('div', { class: 'crowd-field' }, [el('span', { class: 'crowd-lab', text: label }), inp]);
    };

    const form = el('div', { class: 'submenu crowd-form', onclick: (e) => e.stopPropagation() }, [
      el('div', { class: 'crowd-head' }, [el('span', { text: '添加群众阵列' }), count]),
      el('div', { class: 'crowd-rc' }, [
        numField('行数', 'rows', 1, 1, 6),
        el('span', { class: 'crowd-x', text: '×' }),
        numField('列数', 'cols', 1, 1, 6),
      ]),
      numField('间距', 'spacing', 0.1, 0.5, 5),
      el('div', { class: 'crowd-btns' }, [
        el('button', { class: 'crowd-btn cancel', text: '取消', onclick: (e) => { e.stopPropagation(); this.menu.close(); } }),
        el('button', { class: 'crowd-btn add', text: '添加', onclick: (e) => { e.stopPropagation(); app.addCrowd(st.rows, st.cols, st.spacing); this.menu.close(); } }),
      ]),
    ]);

    return el('div', { class: 'menu-item has-sub' }, [
      el('span', { class: 'mi-ic', html: svg('group', 17) }),
      el('span', { class: 'mi-label', text: '群众 (3x3)' }),
      el('span', { class: 'mi-arrow', html: svg('chevron', 14) }),
      form,
    ]);
  }

  // ---- 全景图菜单（§3.c）----
  _buildPanoItems() {
    const app = this.app;
    const items = [];

    const fileInput = el('input', { type: 'file', accept: 'image/*' });
    fileInput.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) app.setPanoramaFromFile(f);
      e.target.value = '';
      this.menu.close();
    });
    items.push(el('label', { class: 'menu-item' }, [
      el('span', { class: 'mi-ic', html: svg('upload', 17) }),
      el('span', { class: 'mi-label', text: '本地上传' }),
      fileInput,
    ]));
    // 一期限制：仅支持 2:1 等距柱状全景，提前告知避免无效上传
    items.push(el('div', { class: 'menu-hint', text: '仅支持 2:1 全景图（如 2048×1024）' }));

    // 历史记录 → 打开全屏历史记录弹层（含预设全景资产）
    items.push(el('div', { class: 'menu-item', onclick: () => { this.menu.close(); this._openHistory(); } }, [
      el('span', { class: 'mi-ic', html: svg('history', 17) }),
      el('span', { class: 'mi-label', text: '历史记录' }),
      el('span', { class: 'mi-arrow', html: svg('chevron', 14) }),
    ]));

    if (app.panoActive) {
      items.push(el('div', { class: 'menu-sep' }));
      items.push(this._item(null, '移除全景', () => { app.clearPanorama(); this.menu.close(); }));
    }
    return items;
  }

  _openHistory() {
    if (!this._assets.length) { listCanvasAssets().then((a) => { this._assets = a; this._history.open(); }); return; }
    this._history.open();
  }

  // ---- 添加机位菜单（§3.d）----
  _buildCamItems() {
    const app = this.app;
    const items = [];
    for (const g of groupedPresets()) {
      items.push(el('div', { class: 'menu-group', text: g.name }));
      for (const p of g.items) {
        items.push(this._item('video', p.label, () => { app.addCamera(p.key); this.menu.close(); }, false, 16));
      }
    }
    return items;
  }

  _toggleFullscreen() {
    const vp = this.app.stage.viewport;
    if (!document.fullscreenElement) vp.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  _modeIcon(mode) { return mode === 'rotate' ? 'rotate' : mode === 'scale' ? 'scale' : 'pointer'; }

  reflectMode(mode) {
    if (this.transformBtn) this.transformBtn.innerHTML = svg(this._modeIcon(mode));
  }
  reflectCameraView(on) { /* 机位视角由 header viewtabs 体现，工具坞无独立按钮 */ }
}
