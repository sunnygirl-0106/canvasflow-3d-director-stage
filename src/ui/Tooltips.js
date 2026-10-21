/** 全局轻量提示层：复用控件的 title/data-tooltip，支持动态面板、键盘焦点和屏幕边缘。 */
export function installTooltips() {
  const tip = document.createElement('div');
  tip.id = 'uiTooltip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.append(tip);
  let target = null, timer = null, previousDescription = null;
  const hide = () => {
    clearTimeout(timer);
    tip.hidden = true;
    if (target) {
      if (previousDescription) target.setAttribute('aria-describedby', previousDescription);
      else target.removeAttribute('aria-describedby');
    }
    target = null;
  };
  const show = (node, immediate = false) => {
    if (target === node) return;
    hide();
    if (!node) return;
    const text = node.dataset.tooltip || node.getAttribute('title');
    if (!text?.trim()) return;
    target = node;
    previousDescription = node.getAttribute('aria-describedby');
    timer = setTimeout(() => {
      if (!node.isConnected) { hide(); return; }
      const r = node.getBoundingClientRect();
      if (!r.width || !r.height) { hide(); return; }
      tip.textContent = text;
      tip.hidden = false;
      const box = tip.getBoundingClientRect();
      tip.style.left = Math.max(8, Math.min(innerWidth - box.width - 8, r.left + (r.width - box.width) / 2)) + 'px';
      tip.style.top = (r.top >= box.height + 16 ? r.top - box.height - 8 : Math.min(innerHeight - box.height - 8, r.bottom + 8)) + 'px';
      node.setAttribute('aria-describedby', [previousDescription, tip.id].filter(Boolean).join(' '));
    }, immediate ? 0 : 300);
  };
  const closest = node => node instanceof Element ? node.closest('[data-tooltip], [title]') : null;
  document.addEventListener('pointerover', e => show(closest(e.target)));
  document.addEventListener('pointerout', e => { if (target && !target.contains(e.relatedTarget)) hide(); });
  document.addEventListener('focusin', e => show(closest(e.target), true));
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); }, true);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
}
