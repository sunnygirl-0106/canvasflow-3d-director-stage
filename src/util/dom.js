// 小型 DOM helper

/** 创建元素：el('div', {class:'x', onclick:fn}, [child|string]) */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'style' && typeof v === 'object') {
      Object.assign(node.style, v);
    } else {
      node.setAttribute(k, v);
    }
  }
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

let toastEl = null;
let toastTimer = null;
/**
 * 轻提示。msg 中的换行会保留（多条错误逐行显示）。
 * @param {string} msg
 * @param {{duration?:number, action?:{label:string, onClick:()=>void}}} [opts] action：带一个按钮（点了即关闭）
 */
export function toast(msg, { duration, action } = {}) {
  if (!toastEl) toastEl = document.getElementById('toast');
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.toggle('has-action', !!action);
  if (action) {
    toastEl.appendChild(el('button', {
      class: 'toast-action', text: action.label,
      onclick: () => { toastEl.classList.remove('show'); action.onClick(); },
    }));
  }
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration ?? (action ? 10000 : 1700));
}
