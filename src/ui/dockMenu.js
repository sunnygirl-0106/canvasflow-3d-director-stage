import { el, clear } from '../util/dom.js';

// 可复用的 Dock 弹出菜单管理（§3.0）：
// - 同一时刻只开一个菜单（打开新菜单先关旧菜单）
// - 点击空白处统一关闭
// - 菜单内容按 build() 在每次打开时重建，保证「打勾/状态」实时
export class DockMenu {
  /** @param {HTMLElement} container Dock 容器（#dock），作为弹层的定位父级。 */
  constructor(container) {
    this.container = container;
    this.items = [];
    this.openItem = null;
    this._docClick = (e) => {
      if (!this.openItem) return;
      const it = this.openItem;
      if (it.el.contains(e.target) || it.anchor.contains(e.target)) return;
      this.close();
    };
    document.addEventListener('click', this._docClick);
  }

  /**
   * 注册一个挂在 anchor 按钮上的弹出菜单。
   * @param {{anchor:HTMLElement, build:()=>(HTMLElement|null)[], className?:string, minWidth?:string}} opts
   * @returns {{anchor, el, open, close, toggle}}
   */
  create({ anchor, build, className = '', minWidth }) {
    const body = el('div', {});
    const menuEl = el('div', { class: 'dockmenu' + (className ? ' ' + className : '') }, [body]);
    if (minWidth) menuEl.style.minWidth = minWidth;
    menuEl.style.display = 'none';
    this.container.appendChild(menuEl);
    const item = {
      anchor, el: menuEl, body, build,
      open: () => this._open(item),
      close: () => { if (this.openItem === item) this.close(); },
      toggle: () => (this.openItem === item ? this.close() : this._open(item)),
    };
    this.items.push(item);
    return item;
  }

  _open(item) {
    if (this.openItem && this.openItem !== item) this.close();
    clear(item.body);
    for (const node of item.build()) if (node) item.body.appendChild(node);
    // 居中对齐到 anchor 按钮正上方
    const cx = item.anchor.offsetLeft + item.anchor.offsetWidth / 2;
    item.el.style.left = cx + 'px';
    item.el.style.transform = 'translateX(-50%)';
    item.el.style.display = 'block';
    item.el.classList.add('open');
    item.anchor.classList.add('on');
    this.openItem = item;
    // 防溢出：测量后水平夹取到视口内
    requestAnimationFrame(() => this._clamp(item));
  }

  _clamp(item) {
    if (this.openItem !== item) return;
    const r = item.el.getBoundingClientRect();
    const pad = 8;
    let dx = 0;
    if (r.left < pad) dx = pad - r.left;
    else if (r.right > window.innerWidth - pad) dx = window.innerWidth - pad - r.right;
    item.el.style.transform = dx ? `translateX(calc(-50% + ${dx}px))` : 'translateX(-50%)';
  }

  close() {
    if (!this.openItem) return;
    this.openItem.el.classList.remove('open');
    this.openItem.el.style.display = 'none';
    this.openItem.anchor.classList.remove('on');
    this.openItem = null;
  }
}
