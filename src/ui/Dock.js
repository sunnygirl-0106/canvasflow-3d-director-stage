import { el, toast } from '../util/dom.js';
import { DockMenu } from './dockMenu.js';
import { HistoryModal } from './HistoryModal.js';
import { CAMERA_PRESETS } from '../core/cameraPresets.js';
import { listCanvasAssets } from '../util/assetLibrary.js';
import { isPanoRatio, BODY_TYPES, PROP_KINDS, RATIO_OPTIONS } from '../config.js';
import { icon } from './icons.js';
import { exportScene, pickAndImportScene } from '../app/SceneFile.js';
import { hasWebCodecs, UNSUPPORTED_MSG } from '../app/exportSpec.js';
import { onKey, KEY_PRIORITY } from '../util/keys.js';

const svg = (name, w = 21) => icon(name, w);

// 素体清单从体型注册表生成（单一事实来源，见 config.js）
const CHARACTERS = Object.entries(BODY_TYPES).map(([key, v]) => [key, v.label]);
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const KEY_UNDO = IS_MAC ? '⌘Z' : 'Ctrl+Z';
const KEY_REDO = IS_MAC ? '⇧⌘Z' : 'Ctrl+Y';
const TF_MODES = [['translate', 'move', '移动'], ['rotate', 'rotate', '旋转'], ['scale', 'scale', '缩放']];

// 导航共用左栏；底部保留变换、截图和时间轴，场景与变换使用弹出菜单。
export class Dock {
  constructor(container, app, { timelinePanel, exportModal, aiPanel } = {}) {
    this.app = app;
    this.timelinePanel = timelinePanel;
    this.exportModal = exportModal;
    this.aiPanel = aiPanel;
    this.container = container;
    this._assets = [];
    listCanvasAssets().then((a) => { this._assets = a; });
    this._history = new HistoryModal({
      getAssets: () => this._assets,
      onPick: (a) => app.panorama.setFromAsset(a),
      // 仅 2:1 图片可作全景；其余（非 2:1、视频）在弹层中置灰禁用
      isEligible: (a) => a.type === 'image' && isPanoRatio(a.w, a.h),
      ineligibleReason: (a) => (a.type !== 'image' ? '视频不可作全景' : '需 2:1 全景图'),
    });
    this.render();
    app.on('mode', (mode) => this.reflectMode(mode));
    app.store.on('change', () => {
      if (this.activePanel === 'ratio') this._reflectRatio();
      if (this.activePanel === 'panorama') this._showPanel('panorama');
    });
    onKey(e => {
      if (e.key !== 'Escape' || this.activePanel === 'scene' || app.pathTool.mode || app.pathEditor.drag) return;
      e.stopImmediatePropagation();
      const trigger = this.panelButtons[this.activePanel];
      this._showPanel('scene'); trigger?.focus();
    }, { priority: KEY_PRIORITY.popup - 1 });
  }

  _btn(iconName, title, onClick) {
    return el('button', { class: 'dockbtn', title, 'aria-label': title, html: svg(iconName), onclick: onClick });
  }

  // 通用菜单项（可选打勾 / 快捷键提示 / 禁用）
  _item(iconName, label, onClick, checked = false, iconSize = 17, { key, disabled } = {}) {
    return el('button', { type: 'button', disabled: disabled || undefined, class: 'menu-item' + (disabled ? ' disabled' : ''), onclick: onClick }, [
      el('span', { class: 'mi-ic', html: iconName ? svg(iconName, iconSize) : '' }),
      el('span', { class: 'mi-label', text: label }),
      checked ? el('span', { class: 'mi-check', text: '✓' }) : null,
      key ? el('span', { class: 'mi-key', text: key }) : null,
    ]);
  }

  render() {
    const app = this.app;
    const c = this.container;
    c.innerHTML = '';

    // 1 变换（移动/旋转/缩放）
    const tf = this._btn(this._modeIcon(app.transformMode), '移动（点击选择移动 / 旋转 / 缩放）', (e) => { e.stopPropagation(); this.transformMenu.toggle(); });
    tf.classList.add('on');
    this.transformBtn = tf;

    // 2 添加角色 / 模型
    const addBtn = this._btn('person', '添加角色 / 模型', (e) => { e.stopPropagation(); this._showPanel('characters'); });

    // 3 全景图
    const pano = this._btn('panorama', '全景图（本地上传 / 历史记录）', (e) => { e.stopPropagation(); this._showPanel('panorama'); });

    // 4 添加机位
    const camAdd = this._btn('video', '添加机位（预设）', (e) => { e.stopPropagation(); this._showPanel('cameras'); });

    // 6 截图
    const shot = this._btn('shot', '截图', () => app.shots.captureShot());
    shot.dataset.tooltip = '截图：拍下当前画面，保存到摄像机截图列表';

    // 7 场景：撤销 / 重做 / 导出 / 导入 / 导出视频
    const scene = this._btn('scene', '场景（撤销 / 重做 / 导出 / 导入 / 导出视频）', (e) => { e.stopPropagation(); this.sceneMenu.toggle(); });

    // 8 时间轴（展开 / 折叠底部面板）
    const tlp = this.timelinePanel;
    const tlBtn = tlp ? this._btn('timelinePanel', '时间轴（展开 / 折叠）：编辑关键帧、人物轨迹和机位动画', () => tlp.toggleCollapsed()) : null;
    if (tlBtn) {
      tlBtn.classList.toggle('on', !tlp.collapsed);
      if (!this._tlBound) { this._tlBound = true; tlp.on('collapse', (v) => this.tlBtn?.classList.toggle('on', !v)); }
    }
    this.tlBtn = tlBtn;

    c.append(...[tf, shot, tlBtn].filter(Boolean));
    const rail = document.getElementById('sideRail');
    const sceneTab = this._btn('layers', '场景列表', () => this._showPanel('scene'));
    const ratio = this._btn('ratio', '选择画幅比例', (e) => { e.stopPropagation(); this._showPanel('ratio'); });
    const image = this._btn('imageScan', '识图导入', () => { this._showPanel('image'); this.aiPanel.openImageImport(); });
    rail.replaceChildren(sceneTab, addBtn, camAdd, pano, ratio, image);
    document.getElementById('sceneActions').replaceChildren(scene);
    // ---- 菜单（统一由 DockMenu 管理）----
    this.menu = new DockMenu(document.body);

    this.transformMenu = this.menu.create({
      anchor: tf, minWidth: '150px',
      build: () => TF_MODES.map(([mode, icon, label]) =>
        this._item(icon, label, () => { app.setTransformMode(mode); this.menu.close(); }, app.transformMode === mode)),
    });

    this.panelButtons = { scene: sceneTab, characters: addBtn, cameras: camAdd, panorama: pano, ratio, image };
    const sidebar = document.querySelector('.side.left');
    this.sceneContent = el('div', { class: 'sidebar-scene' });
    this.sceneContent.append(...[...sidebar.children].filter(node => node.tagName !== 'HEADER'));
    this.panelContent = el('section', { class: 'sidebar-tool', hidden: true });
    sidebar.append(this.sceneContent, this.panelContent);
    this.activePanel = 'scene';
    this._showPanel('scene');
    this.sceneMenu = this.menu.create({ anchor: scene, minWidth: '170px', build: () => this._buildSceneItems() });

  }

  _showPanel(key) {
    this.activePanel = key;
    this.menu.close();
    document.getElementById('app').classList.remove('left-collapsed');
    for (const [name, button] of Object.entries(this.panelButtons)) {
      button.classList.toggle('on', name === key); button.setAttribute('aria-pressed', String(name === key));
    }
    this.sceneContent.hidden = key !== 'scene'; this.panelContent.hidden = key === 'scene';
    if (key === 'scene') return;
    const title = { characters: '添加角色', cameras: '添加机位', panorama: '全景图', ratio: '选择画幅比例', image: '识图导入' }[key];
    const nodes = key === 'characters' ? this._buildAddItems() : key === 'cameras' ? this._buildCamItems() : key === 'panorama' ? this._buildPanoItems() : key === 'ratio' ? this._buildRatioItems() : [
      this._item('imageScan', '选择图片', () => this.aiPanel.openImageImport()),
    ];
    this.panelContent.replaceChildren(el('h3', { text: title }), el('div', { class: 'sidebar-content' }, nodes));
    this._reflectRatio();
  }

  async _add(button, action) {
    if (this._adding) return;
    this._adding = true; button.setAttribute('aria-busy', 'true');
    const error = this.panelContent.querySelector('.sidebar-error');
    if (error) error.textContent = '';
    try {
      const entity = await action();
      if (!entity && error) error.textContent = '加载失败，请重试';
    } catch (err) { if (error) error.textContent = err.message || '加载失败，请重试'; }
    finally { this._adding = false; button.removeAttribute('aria-busy'); }
  }

  _buildAddItems() {
    const items = CHARACTERS.map(([key, label]) => {
      const button = this._item('person', label, () => this._add(button, () => this.app.addCharacter(key)));
      button.dataset.body = key;
      return button;
    });
    items.push(this._buildCrowdItem());
    items.push(el('details', { class: 'sidebar-subgroup' }, [
      el('summary', { html: svg('cube', 18) + '<span>几何模型</span>' + svg('chevron', 14) }),
      ...PROP_KINDS.map(([kind, label]) => this._item('cube', label, () => this.app.addProp(kind))),
    ]));
    items.push(el('p', { class: 'sidebar-error', role: 'status' }));
    return items;
  }

  _buildRatioItems() {
    return [el('div', { class: 'sidebar-cards' }, RATIO_OPTIONS.map(([value, label]) => {
      const [w, h] = value === 'auto' ? [1.5, 1] : value.split(':').map(Number);
      const scale = Math.min(42 / w, 32 / h);
      const width = w * scale, height = h * scale;
      return el('button', { class: 'sidebar-card ratio-card', 'data-ratio': value, onclick: () => this.app.setRatio(value) }, [
        el('span', { class: 'card-art', html: `<svg width="68" height="44" viewBox="0 0 68 44" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="${(68-width)/2}" y="${(44-height)/2}" width="${width}" height="${height}" rx="2"/></svg>` }),
        el('span', { text: label }),
      ]);
    }))];
  }

  _reflectRatio() {
    for (const card of this.panelContent.querySelectorAll('[data-ratio]')) {
      const selected = card.dataset.ratio === this.app.ratio;
      card.classList.toggle('selected', selected); card.setAttribute('aria-pressed', String(selected));
    }
  }

  // ---- 群众阵列：可展开的行列/间距表单 ----
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

    const form = el('div', { class: 'crowd-form', onclick: (e) => e.stopPropagation() }, [
      el('div', { class: 'crowd-head' }, [el('span', { text: '添加群众阵列' }), count]),
      el('div', { class: 'crowd-rc' }, [
        numField('行数', 'rows', 1, 1, 6),
        el('span', { class: 'crowd-x', text: '×' }),
        numField('列数', 'cols', 1, 1, 6),
      ]),
      numField('间距', 'spacing', 0.1, 0.5, 5),
      el('div', { class: 'crowd-btns' }, [
        el('button', { class: 'crowd-btn cancel', text: '取消', onclick: (e) => { e.stopPropagation(); e.currentTarget.closest('details').open = false; } }),
        el('button', { class: 'crowd-btn add', text: '添加', onclick: (e) => { e.stopPropagation(); this._add(e.currentTarget, () => app.addCrowd(st.rows, st.cols, st.spacing)); } }),
      ]),
    ]);

    return el('details', { class: 'sidebar-subgroup' }, [
      el('summary', { html: svg('group', 18) + '<span>群众</span>' + svg('chevron', 14) }), form,
    ]);
  }

  // ---- 全景图菜单 ----
  _buildPanoItems() {
    const app = this.app;
    const items = [];

    const fileInput = el('input', { type: 'file', accept: 'image/*' });
    fileInput.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) app.panorama.setFromFile(f);
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

    if (app.panorama.active) {
      items.push(el('div', { class: 'menu-sep' }));
      items.push(this._item(null, '移除全景', () => { app.panorama.clear(); this.menu.close(); }));
    }
    return items;
  }

  _openHistory() {
    if (!this._assets.length) { listCanvasAssets().then((a) => { this._assets = a; this._history.open(); }); return; }
    this._history.open();
  }

  // ---- 添加机位菜单 ----
  _buildCamItems() {
    return [el('div', { class: 'sidebar-cards' }, CAMERA_PRESETS.map(p => {
      const close = /close/.test(p.key), high = /high|bird/.test(p.key), low = /low/.test(p.key), shoulder = /ots/.test(p.key);
      const scale = close ? 1.5 : /full|wide/.test(p.key) ? .7 : 1;
      const art = `<svg width="78" height="46" viewBox="0 0 78 46" fill="none" stroke="currentColor" stroke-width="1.5"><path opacity=".5" d="M7 13V5h12M59 5h12v8M71 33v8H59M19 41H7v-8"/><g transform="translate(${/side/.test(p.key) ? 46 : 39} ${high ? 28 : low ? 17 : 23}) rotate(${p.key === 'dutch' ? 16 : 0}) scale(${scale})"><circle cy="-8" r="4"/><path d="M-8 12v-6a8 8 0 0 1 16 0v6M0 2v13"/></g>${high ? '<path d="m17 10 11 9m-1-5 1 5-5-1"/>' : low ? '<path d="m17 35 11-9m-5 1 5-1-1 5"/>' : ''}${shoulder ? `<path stroke-width="4" d="M${p.key === 'ots_right' ? 60 : 18} 40v-10a8 8 0 0 0-8-8"/>` : ''}</svg>`;
      return el('button', { class: 'sidebar-card', 'data-preset': p.key, onclick: e => {
        this.app.addCamera(p.key);
        for (const card of this.panelContent.querySelectorAll('[data-preset]')) card.classList.toggle('recent', card === e.currentTarget);
      } }, [el('span', { class: 'card-art', html: art }), el('span', { text: p.label })]);
    }))];
  }

  // ---- 场景菜单 ----
  _buildSceneItems() {
    const h = this.app.history;
    return [
      this._item('undo', '撤销', () => { this.menu.close(); h.undo(); }, false, 17, { key: KEY_UNDO, disabled: !h.canUndo }),
      this._item('redo', '重做', () => { this.menu.close(); h.redo(); }, false, 17, { key: KEY_REDO, disabled: !h.canRedo }),
      el('div', { class: 'menu-sep' }),
      this._item('download', '导出场景', () => { this.menu.close(); exportScene(this.app); }),
      this._item('upload', '导入场景', () => { this.menu.close(); pickAndImportScene(this.app); }),
      el('div', { class: 'menu-sep' }),
      this._exportItem(),
      this._item('expand', '全屏', () => { this.menu.close(); this._toggleFullscreen(); }),
    ];
  }

  /** 「导出视频…」：没有 WebCodecs（Safari / Firefox）时置灰，点击只提示。 */
  _exportItem() {
    const ok = hasWebCodecs();
    const item = this._item('video', '导出视频…', () => {
      this.menu.close();
      if (!ok) { toast(UNSUPPORTED_MSG); return; }
      this.exportModal?.open();
    });
    if (!ok) { item.classList.add('unsupported'); item.title = UNSUPPORTED_MSG; }
    return item;
  }

  _toggleFullscreen() {
    const vp = document.documentElement;
    if (!document.fullscreenElement) vp.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  _modeIcon(mode) { return mode === 'rotate' ? 'rotate' : mode === 'scale' ? 'scale' : 'pointer'; }

  reflectMode(mode) {
    if (this.transformBtn) { this.transformBtn.innerHTML = svg(this._modeIcon(mode)); this.transformBtn.title = `${TF_MODES.find(([m]) => m === mode)?.[2]}（点击选择移动 / 旋转 / 缩放）`; }
  }
}
