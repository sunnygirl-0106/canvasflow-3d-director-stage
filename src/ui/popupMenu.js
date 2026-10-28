import { el } from '../util/dom.js';

/** 原生自动弹层负责互斥、外部点击和 Esc；菜单只负责内容、定位及方向键。 */
export function createMenu({ anchor, build, className = 'dockmenu', minWidth, x = 0, y = 0 }) {
  const menu = el('div', { class: className, popover: 'auto', role: 'menu' });
  if (minWidth) menu.style.minWidth = minWidth;
  document.body.appendChild(menu);
  let wasOn = false;
  const position = () => {
    const rect = menu.getBoundingClientRect();
    const bounds = anchor?.getBoundingClientRect?.() || anchor;
    const left = anchor?.isConnected ? bounds.left + (bounds.width - rect.width) / 2 : x;
    const top = bounds ? (bounds.top > rect.height + (anchor?.isConnected ? 12 : 8) ? bounds.top - rect.height - 8 : bounds.bottom + 8) : y;
    menu.style.left = Math.max(8, Math.min(left, innerWidth - rect.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(top, innerHeight - rect.height - 8)) + 'px';
  };
  menu.addEventListener('beforetoggle', e => {
    if (e.newState === 'open') {
      menu.replaceChildren(...build().filter(Boolean));
      wasOn = anchor?.classList?.contains('on');
      anchor?.classList?.add('on');
    } else anchor?.classList?.toggle('on', wasOn);
  });
  menu.addEventListener('toggle', () => {
    if (menu.matches(':popover-open')) position();
    else if (!anchor?.isConnected) menu.remove();
  });
  menu.addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const entries = [...menu.querySelectorAll('button:not(:disabled), [tabindex="0"]')];
    const index = entries.indexOf(document.activeElement);
    entries[(index + (e.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length]?.focus();
  });
  if (anchor?.isConnected) anchor.popoverTargetElement = menu;
  return {
    open: () => { menu.showPopover(); position(); menu.querySelector('[tabindex="0"]')?.focus(); },
    close: () => menu.hidePopover(),
    el: menu,
  };
}

/** 小弹出菜单（ease 选择 / 右键菜单共用 .ctxmenu 样式）。 */
export function popupMenu(x, y, items, { minWidth, anchor } = {}) {
  const popup = createMenu({ x, y, anchor, minWidth, className: 'ctxmenu tl-menu', build: () => items.map(it => it === '-' ? el('div', { class: 'ctx-sep' }) : el('div', {
    tabindex: it.disabled ? -1 : 0, role: 'menuitem',
    onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (!it.disabled) { popup.close(); it.onClick(); } } },
    class: 'ctx-item' + (it.disabled ? ' disabled' : ''),
    onclick: () => { if (it.disabled) return; popup.close(); it.onClick(); },
  }, [
    it.icon ? el('span', { html: it.icon, 'aria-hidden': 'true' }) : null,
    el('span', { class: 'ctx-label', text: it.label }),
    it.checked ? el('span', { class: 'tl-check', text: '✓' }) : null,
  ])) });
  popup.open();
  return popup.el;
}

export function closePopup() {
  document.querySelector('[popover][role="menu"]:popover-open')?.hidePopover();
}
