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
 * @param {{duration?:number, action?:{label:string, onClick:()=>void},
 *          actions?:{label:string, onClick?:()=>void, secondary?:boolean}[]}} [opts]
 *   action：带一个按钮（点了即关闭）；actions：多个按钮（确认 / 取消类，secondary 为次要样式）。
 *   没点按钮就消失（超时 / 被下一条提示顶掉）= 什么都不做，确认类提示据此等同"取消"。
 */
export function toast(msg, { duration, action, actions } = {}) {
  if (!toastEl) toastEl = document.getElementById('toast');
  if (!toastEl) return;
  const btns = actions || (action ? [action] : []);
  toastEl.textContent = msg;
  toastEl.classList.toggle('has-action', btns.length > 0);
  const close = () => { clearTimeout(toastTimer); toastEl.classList.remove('show'); };
  for (const b of btns) {
    toastEl.appendChild(el('button', {
      class: 'toast-action' + (b.secondary ? ' secondary' : ''), text: b.label,
      onclick: () => { close(); b.onClick?.(); },
    }));
  }
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration ?? (btns.length ? 10000 : 1700));
}
