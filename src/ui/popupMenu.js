import { el } from '../util/dom.js';
import { onKey, KEY_PRIORITY } from '../util/keys.js';

/** 小弹出菜单（ease 选择 / 右键菜单共用 .ctxmenu 样式）；点外面或 Esc 关闭。 */
export function popupMenu(x, y, items, { minWidth, anchor } = {}) {
  closePopup();
  const previousFocus = document.activeElement;
  const menu = el('div', { class: 'ctxmenu tl-menu', role: 'menu' }, items.map((it) => (it === '-' ? el('div', { class: 'ctx-sep' }) : el('div', {
    tabindex: it.disabled ? -1 : 0, role: 'menuitem',
    onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (!it.disabled) { closePopup(); it.onClick(); } } },
    class: 'ctx-item' + (it.disabled ? ' disabled' : ''),
    onclick: () => { if (it.disabled) return; closePopup(); it.onClick(); },
  }, [
    it.icon ? el('span', { html: it.icon, 'aria-hidden': 'true' }) : null,
    el('span', { class: 'ctx-label', text: it.label }),
    it.checked ? el('span', { class: 'tl-check', text: '✓' }) : null,
  ]))));
  if (minWidth) menu.style.minWidth = minWidth;
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  if (anchor) y = anchor.top > r.height + 8 ? anchor.top - r.height - 8 : anchor.bottom + 8;
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
  const close = (ev) => { if (!menu.contains(ev.target)) closePopup(); };
  const offKey = onKey((ev) => {
    if (ev.key === 'Escape') { ev.stopImmediatePropagation(); closePopup(); previousFocus?.focus(); }
    else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault(); ev.stopImmediatePropagation();
      const entries = [...menu.querySelectorAll('[tabindex="0"]')];
      const index = entries.indexOf(document.activeElement);
      entries[(index + (ev.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length]?.focus();
    }
  }, { priority: KEY_PRIORITY.popup });
  // 下一拍再监听点击关闭，避免打开菜单的这次点击立刻把它关掉；关得比这一拍还早时清掉定时器
  const timer = setTimeout(() => window.addEventListener('pointerdown', close, true), 0);
  _popup = { menu, close, offKey, timer };
  menu.querySelector('[tabindex="0"]')?.focus();
  return menu;
}

let _popup = null;
export function closePopup() {
  if (!_popup) return;
  _popup.menu.remove();
  clearTimeout(_popup.timer);
  window.removeEventListener('pointerdown', _popup.close, true);
  _popup.offKey();
  _popup = null;
}
