import { el } from '../util/dom.js';

// 内联图标
const IC = {
  pointer: '<path d="M5 3l15 8-6 1.6L11 19z"/>',
  person: '<circle cx="12" cy="5.5" r="2.4"/><path d="M12 8.4c-2.4 0-4 1.6-4 4v3M12 8.4c2.4 0 4 1.6 4 4v3M9 21v-5M15 21v-5"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/>',
  video: '<rect x="3" y="6" width="12" height="12" rx="2"/><path d="M15 10l6-3v10l-6-3"/>',
  frame: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/>',
  shot: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.2"/>',
  send: '<rect x="3" y="4" width="14" height="14" rx="2"/><path d="M7 14l3-3 3 3M21 8v9a2 2 0 0 1-2 2h-9"/>',
  expand: '<path d="M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6"/>',
  upload: '<path d="M12 16V5M8 9l4-4 4 4M5 19h14"/>',
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 3v18M4 7.5l8 4.5 8-4.5"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
};
const svg = (name, w = 21) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${IC[name]}</svg>`;

// 与截图一致的素体清单（按现有模型映射）
const CHARACTERS = [
  ['Xbot', 'Xbot 素体'],
  ['Soldier', 'Soldier 士兵'],
  ['Robot', 'Robot 机器人'],
];
const GEO = [['box', '方块'], ['cylinder', '圆柱'], ['sphere', '球体'], ['mannequin', '人体素模']];

// 底部悬浮工具坞：选择/添加/旋转/机位/取景/截图/发送/全屏
export class Dock {
  constructor(container, app) {
    this.app = app;
    this.container = container;
    this.modeBtns = {};
    this.render();
  }

  _btn(icon, title, onClick, key) {
    const b = el('button', { class: 'dockbtn', title, html: svg(icon), onclick: onClick });
    if (key) this.modeBtns[key] = b;
    return b;
  }

  render() {
    const app = this.app;
    const c = this.container;
    c.innerHTML = '';

    // 1 选择/移动
    const move = this._btn('pointer', '选择 / 移动 (V)', () => app.setTransformMode('translate'), 'translate');
    move.classList.add('on');

    // 2 添加（菜单）
    const addBtn = this._btn('person', '添加角色 / 模型', (e) => { e.stopPropagation(); this._toggleMenu(); });
    this.addBtn = addBtn;

    // 3 旋转
    const rot = this._btn('rotate', '旋转 (R)', () => app.setTransformMode('rotate'), 'rotate');
    // 缩放（键盘 S 亦可）：长按/右键？这里给个隐性入口——双击旋转键切缩放
    rot.addEventListener('dblclick', () => app.setTransformMode('scale'));

    // 4 机位视角
    const cam = this._btn('video', '机位视角', () => app.toggleCameraView());
    this.camBtn = cam;

    // 5 取景比例
    const frame = this._btn('frame', '取景比例（循环 16:9 / 9:16 / 1:1 / 自由）', () => app.cycleRatio());

    // 6 截图
    const shot = this._btn('shot', '截图', () => app.captureShot());

    // 7 发送到画布
    const send = this._btn('send', '发送到画布', () => app.sendLatestShot());

    // 8 全屏
    const full = this._btn('expand', '全屏', () => this._toggleFullscreen());

    c.append(move, addBtn, rot, cam, this._sep(), frame, shot, send, this._sep(), full);
    c.appendChild(this._buildMenu());

    if (!this._docClick) {
      this._docClick = (e) => { if (this.menu && !this.menu.contains(e.target) && e.target !== this.addBtn) this._closeMenu(); };
      document.addEventListener('click', this._docClick);
    }
  }

  _sep() { return el('div', { class: 'dock-sep' }); }

  _buildMenu() {
    const app = this.app;
    const items = [];

    // 本地上传
    const fileInput = el('input', { type: 'file', accept: '.glb,.gltf' });
    fileInput.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) app.addCharacterFromFile(f);
      e.target.value = '';
      this._closeMenu();
    });
    const upload = el('label', { class: 'menu-item' }, [
      el('span', { class: 'mi-ic', html: svg('upload', 17) }),
      el('span', { text: '本地上传' }),
      fileInput,
    ]);
    items.push(upload);
    items.push(el('div', { class: 'menu-sep' }));

    // 角色素体
    for (const [key, label] of CHARACTERS) {
      items.push(el('div', { class: 'menu-item', onclick: () => { app.addCharacter(key); this._closeMenu(); } }, [
        el('span', { class: 'mi-ic', html: svg('person', 17) }),
        el('span', { text: label }),
      ]));
    }
    items.push(el('div', { class: 'menu-sep' }));

    // 几何模型 ▸ 子菜单
    const sub = el('div', { class: 'submenu' }, GEO.map(([kind, label]) =>
      el('div', { class: 'menu-item', onclick: () => { app.addProp(kind); this._closeMenu(); } }, [
        el('span', { class: 'mi-ic', html: svg('cube', 16) }),
        el('span', { text: label }),
      ])
    ));
    items.push(el('div', { class: 'menu-item has-sub' }, [
      el('span', { class: 'mi-ic', html: svg('cube', 17) }),
      el('span', { text: '几何模型' }),
      el('span', { class: 'mi-arrow', html: svg('chevron', 14) }),
      sub,
    ]));

    this.menu = el('div', { class: 'dockmenu' }, items);
    return this.menu;
  }

  _toggleMenu() {
    const open = this.menu.classList.toggle('open');
    this.addBtn.classList.toggle('on', open);
  }
  _closeMenu() { this.menu.classList.remove('open'); this.addBtn.classList.remove('on'); }

  _toggleFullscreen() {
    const vp = this.app.stage.viewport;
    if (!document.fullscreenElement) vp.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  reflectMode(mode) {
    Object.entries(this.modeBtns).forEach(([k, b]) => b.classList.toggle('on', k === mode));
  }
  reflectCameraView(on) { this.camBtn.classList.toggle('on', on); }
}
