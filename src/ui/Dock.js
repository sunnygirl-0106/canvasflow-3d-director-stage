import { el } from '../util/dom.js';
import { DockMenu } from './dockMenu.js';
import { HistoryModal } from './HistoryModal.js';
import { groupedPresets } from '../core/cameraPresets.js';
import { listCanvasAssets } from '../util/assetLibrary.js';
import { isPanoRatio, BODY_TYPES, PROP_KINDS } from '../config.js';
import { icon } from './icons.js';
import { exportScene, pickAndImportScene } from '../app/SceneFile.js';
import { pathModes } from '../app/PathTool.js';
import { hasWebCodecs, UNSUPPORTED_MSG } from '../app/exportSpec.js';
import { toast } from '../util/dom.js';

const svg = (name, w = 21) => icon(name, w);

// 素体清单从体型注册表生成（单一事实来源，见 config.js）
const CHARACTERS = Object.entries(BODY_TYPES).map(([key, v]) => [key, v.label]);
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const KEY_UNDO = IS_MAC ? '⌘Z' : 'Ctrl+Z';
const KEY_REDO = IS_MAC ? '⇧⌘Z' : 'Ctrl+Y';
const TF_MODES = [['translate', 'move', '移动'], ['rotate', 'rotate', '旋转'], ['scale', 'scale', '缩放']];

// 底部悬浮工具坞：变换 / 添加 / 全景图 / 机位 / 比例 / 截图 / 场景（撤销·重做·导出·导入）/ 时间轴 / 全屏
export class Dock {
  constructor(container, app, { timelinePanel, exportModal, aiPanel } = {}) {
    this.app = app;
    this.timelinePanel = timelinePanel;
    this.exportModal = exportModal;
    this.aiPanel = aiPanel;
    this.container = container;
    this.modeBtns = {};
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
  }

  _btn(iconName, title, onClick, key) {
    const b = el('button', { class: 'dockbtn', title, 'aria-label': title, html: svg(iconName), onclick: onClick });
    if (key) this.modeBtns[key] = b;
    return b;
  }

  _sep() { return el('div', { class: 'dock-sep' }); }

  // 通用菜单项（可选打勾 / 快捷键提示 / 禁用）
  _item(iconName, label, onClick, checked = false, iconSize = 17, { key, disabled } = {}) {
    return el('div', { class: 'menu-item' + (disabled ? ' disabled' : ''), onclick: onClick }, [
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
    this.modeBtns = {};

    // 1 变换（移动/旋转/缩放）
    const tf = this._btn(this._modeIcon(app.transformMode), '移动（点击选择移动 / 旋转 / 缩放）', (e) => { e.stopPropagation(); this.transformMenu.toggle(); });
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

    // 4.5 路径（选中角色 / 道具 / 组 / 机位时可用）：五种绘制方式
    const pathBtn = this._btn('path', '路径（为选中对象绘制移动路径）', (e) => { e.stopPropagation(); this.pathMenu.toggle(); });
    this.pathBtn = pathBtn;
    if (!this._pathBound) {
      this._pathBound = true;
      app.pathTool.on('mode', (m) => this.pathBtn?.classList.toggle('on', !!m));
    }

    // 6 截图
    const shot = this._btn('shot', '截图', () => app.shots.captureShot());
    shot.dataset.tooltip = '截图：拍下当前画面，保存到摄像机截图列表';

    // 7 场景：撤销 / 重做 / 导出 / 导入 / 导出视频
    const scene = this._btn('scene', '场景（撤销 / 重做 / 导出 / 导入 / 导出视频）', (e) => { e.stopPropagation(); this.sceneMenu.toggle(); });
    this.sceneBtn = scene;

    // 8 时间轴（展开 / 折叠底部面板）
    const tlp = this.timelinePanel;
    const tlBtn = tlp ? this._btn('timeline', '时间轴（展开 / 折叠）：编辑关键帧、人物轨迹和机位动画', () => tlp.toggleCollapsed()) : null;
    if (tlBtn) {
      tlBtn.classList.toggle('on', !tlp.collapsed);
      if (!this._tlBound) { this._tlBound = true; tlp.on('collapse', (v) => this.tlBtn?.classList.toggle('on', !v)); }
    }
    this.tlBtn = tlBtn;

    c.append(...[tf, shot, tlBtn].filter(Boolean));
    const rail = document.getElementById('sideRail');
    const sceneTab = this._btn('layers', '场景列表', () => document.getElementById('app').classList.toggle('left-collapsed'));
    const propBtn = this._btn('cube', '添加道具', (e) => { e.stopPropagation(); this.propMenu.toggle(); });
    rail.replaceChildren(sceneTab, addBtn, camAdd, propBtn, pano);
    document.getElementById('sceneActions').replaceChildren(scene);
    // 路径菜单保留可见锚点；机位属性负责截图/导出画幅，场景菜单负责全屏。
    const settings = document.createElement('div');
    settings.className = 'scene-quick-tools';
    settings.append(pathBtn);
    document.querySelector('.side.left').append(settings);

    // ---- 菜单（统一由 DockMenu 管理）----
    this.menu = new DockMenu(document.body);

    this.transformMenu = this.menu.create({
      anchor: tf, minWidth: '150px',
      build: () => TF_MODES.map(([mode, icon, label]) =>
        this._item(icon, label, () => { app.setTransformMode(mode); this.menu.close(); }, app.transformMode === mode)),
    });

    this.propMenu = this.menu.create({ anchor: propBtn, build: () => PROP_KINDS.map(([kind, label]) => this._item('cube', label, () => { app.addProp(kind); this.menu.close(); })) });
    this.addMenu = this.menu.create({ anchor: addBtn, build: () => this._buildAddItems() });
    this.panoMenu = this.menu.create({ anchor: pano, build: () => this._buildPanoItems() });
    this.camMenu = this.menu.create({ anchor: camAdd, className: 'cammenu', build: () => this._buildCamItems() });
    this.pathMenu = this.menu.create({ anchor: pathBtn, minWidth: '150px', build: () => this._buildPathItems() });
    this.sceneMenu = this.menu.create({ anchor: scene, minWidth: '170px', build: () => this._buildSceneItems() });

  }

  // ---- 添加角色/模型菜单 ----
  _buildAddItems() {
    const app = this.app;
    const items = [];

    for (const [key, label] of CHARACTERS) {
      items.push(this._item('person', label, () => { app.addCharacter(key); this.menu.close(); }));
    }
    items.push(this._buildCrowdItem());
    items.push(el('div', { class: 'menu-sep' }));

    const sub = el('div', { class: 'submenu' }, PROP_KINDS.map(([kind, label]) =>
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

  // ---- 路径菜单 ----
  _buildPathItems() {
    const tool = this.app.pathTool;
    const ok = tool.canDraw(this.app.selected);
    const items = [el('div', { class: 'menu-group', text: ok ? '绘制路径' : '先选中角色 / 道具 / 组 / 机位' })];
    for (const [mode, label] of pathModes(this.app.selected)) {
      items.push(this._item(null, label, () => { this.menu.close(); tool.request(mode); }, tool.mode === mode, 17, { disabled: !ok }));
    }
    return items;
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
    const vp = this.app.stage.viewport;
    if (!document.fullscreenElement) vp.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  _modeIcon(mode) { return mode === 'rotate' ? 'rotate' : mode === 'scale' ? 'scale' : 'pointer'; }

  reflectMode(mode) {
    if (this.transformBtn) { this.transformBtn.innerHTML = svg(this._modeIcon(mode)); this.transformBtn.title = `${TF_MODES.find(([m]) => m === mode)?.[2]}（点击选择移动 / 旋转 / 缩放）`; }
  }
}
