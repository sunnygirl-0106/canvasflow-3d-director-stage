import * as THREE from 'three';
import { el } from '../util/dom.js';

// 滑条行：label 在上，[====蓝色填充滑条====] [数值框]。onChange：松手时（一次操作结束）。
export function sliderRow({ label, min, max, step = 1, value = 0, disabled = false, format = (v) => String(v), onInput, onChange }) {
  const valbox = el('span', { class: 'valbox', text: format(value) });
  const input = el('input', { type: 'range', class: 'filled', min, max, step, value });
  if (disabled) input.disabled = true;
  const setFill = (v) => { const pct = ((v - min) / (max - min)) * 100; input.style.setProperty('--fill', pct + '%'); };
  setFill(value);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    setFill(v);
    valbox.textContent = format(v);
    onInput && onInput(v);
  });
  if (onChange) input.addEventListener('change', () => onChange(parseFloat(input.value)));
  const row = el('div', { class: 'field' }, [
    label != null ? el('label', { text: label }) : null,
    el('div', { class: 'slider-row' }, [input, valbox]),
  ]);
  return { el: row, set(v) { input.value = v; setFill(v); valbox.textContent = format(v); } };
}

// 轴标签 hover 左右拖动改值（scrubber）。
function attachScrub(elm, { get, set, step, after, end }) {
  let startX = 0, startV = 0, dragging = false;
  elm.classList.add('scrub');
  elm.addEventListener('pointerdown', (e) => {
    dragging = true; startX = e.clientX; startV = get();
    try { elm.setPointerCapture(e.pointerId); } catch { /* noop */ }
    e.preventDefault();
  });
  elm.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    set(startV + (e.clientX - startX) * step);
    after && after();
  });
  const stop = (e) => {
    if (!dragging) return;
    dragging = false;
    try { elm.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    if (e.clientX !== startX) end?.();
  };
  elm.addEventListener('pointerup', stop);
  elm.addEventListener('pointercancel', (e) => {
    if (!dragging) return;
    dragging = false;
    set(startV);
    after?.();
    try { elm.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  });
}

// 三元 XYZ 行。axes: [{key:'x', get:()=>num, set:(v)=>{}, step?}]; deg=true 显示整数度；
// 轴标签可左右拖动改值（每轴 step 可覆盖整体 step）。onCommit：一次修改结束（输入框 change / 轴标签拖动松手）。
export function tripleRow({ label, axes, deg = false, step, onCommit }) {
  const fx = (v) => (deg ? String(Math.round(v)) : (Math.round(v * 100) / 100).toFixed(2));
  const baseStep = step != null ? step : (deg ? 1 : 0.05);
  const inputs = {};
  const fields = axes.map(({ key, get, set, step: axStep }) => {
    const input = el('input', { value: fx(get()) });
    input.addEventListener('input', () => { const v = parseFloat(input.value); if (!isNaN(v)) set(v); });
    if (onCommit) input.addEventListener('change', () => onCommit());
    inputs[key] = { input, get };
    const ax = el('span', { class: 'ax', text: key.toUpperCase() });
    attachScrub(ax, { get, set, step: axStep != null ? axStep : baseStep, after: () => { input.value = fx(get()); }, end: onCommit });
    return el('div', { class: 'fld' }, [ax, input]);
  });
  const row = el('div', { class: 'field' }, [
    label != null ? el('label', { text: label }) : null,
    el('div', { class: 'triple' }, fields),
  ]);
  return {
    el: row,
    syncAll() {
      for (const k in inputs) {
        const { input, get } = inputs[k];
        if (document.activeElement === input) continue;
        input.value = fx(get());
      }
    },
  };
}

// 下拉行（注视目标 / 切换机位）。options: [{value,label}]
export function dropdownRow({ label, options, value, onChange }) {
  const sel = el('select', { class: 'dropdown' });
  for (const o of options) {
    const opt = el('option', { value: o.value });
    opt.textContent = o.label;
    if (o.value === value) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  const row = el('div', { class: 'field' }, [label != null ? el('label', { text: label }) : null, sel]);
  return { el: row, set(v) { sel.value = v; } };
}

// ⓘ 提示气泡（hover 显示）
export function infoTip(text) {
  const tip = el('span', { class: 'infotip', text: 'ⓘ' });
  tip.appendChild(el('span', { class: 'infotip-bubble', text }));
  return tip;
}

// 截图缩略卡片。
//  - 默认（摄像机截图 tab）：多选勾选态 + hover 全卡「发送到画布」气泡 + 删除/发送/全屏。
//  - compact（属性页内联相机截图）：无多选圈、无气泡，只有 hover 出现的删除/发送/全屏小按钮，
//    「发送到画布」由中间的 ⤴ 按钮（title 提示）触发。
export function shotCard({ shot, selected, onToggle, onDelete, onSend, onExpand, compact = false }) {
  const card = el('div', { class: 'shot-card' + (compact ? ' compact' : '') + (selected ? ' sel' : '') });
  const img = el('img', { src: shot.url, alt: shot.name });
  const ovChildren = [];
  if (!compact) ovChildren.push(el('div', { class: 'shot-send-bubble', text: '发送到画布', onclick: (e) => { e.stopPropagation(); onSend?.(); } }));
  ovChildren.push(el('div', { class: 'shot-ops' }, [
    el('button', { class: 'shot-op', title: '删除', text: '🗑', onclick: (e) => { e.stopPropagation(); onDelete?.(); } }),
    el('button', { class: 'shot-op', title: '发送到画布', text: '⤴', onclick: (e) => { e.stopPropagation(); onSend?.(); } }),
    el('button', { class: 'shot-op', title: '全屏扩大', text: '⤢', onclick: (e) => { e.stopPropagation(); onExpand?.(); } }),
  ]));
  const ov = el('div', { class: 'shot-ov' }, ovChildren);
  const nodes = [img];
  if (!compact) nodes.push(el('span', { class: 'shot-check', text: selected ? '✓' : '' }));
  nodes.push(ov, el('div', { class: 'shot-name', text: shot.name }));
  card.append(...nodes);
  // 多选态卡片整体点击切换勾选；compact 卡片不参与多选，操作走 hover 按钮。
  if (!compact) card.addEventListener('click', () => onToggle?.());
  return card;
}

// 颜色行：色块 + #hex 文本
export function colorRow({ label = '颜色', hex, onChange, onCommit }) {
  const picker = el('input', { type: 'color', value: hex });
  const swatch = el('div', { class: 'swatch' }, [picker]);
  swatch.style.background = hex;
  const text = el('input', { value: hex.replace('#', '') });
  const apply = (h) => { swatch.style.background = h; picker.value = h; onChange(h); };
  picker.addEventListener('input', () => { text.value = picker.value.replace('#', ''); apply(picker.value); });
  picker.addEventListener('change', () => onCommit?.());
  text.addEventListener('change', () => {
    const v = text.value.trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(v)) { apply(v[0] === '#' ? v : '#' + v); onCommit?.(); }
  });
  const row = el('div', { class: 'field' }, [
    el('label', { text: label }),
    el('div', { class: 'colorrow' }, [
      swatch,
      el('div', { class: 'hex' }, [el('span', { text: '#' }), text]),
    ]),
  ]);
  return { el: row, set(h) { swatch.style.background = h; picker.value = h; text.value = h.replace('#', ''); } };
}

// iOS 风格开关行
export function toggleRow({ label, checked = false, onChange }) {
  const input = el('input', { type: 'checkbox' });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const sw = el('label', { class: 'switch' }, [input, el('span', { class: 'slot' }), el('span', { class: 'knob' })]);
  const row = el('div', { class: 'toggle-row' }, [el('span', { class: 't-label', text: label }), sw]);
  return { el: row, set(v) { input.checked = v; } };
}

export const toHex = (n) => '#' + new THREE.Color(n).getHexString();

// 数值行：label + 数字输入框 + 可选单位。change 时回调（一次修改结束）；解析失败回填原值。
// allowEmpty：允许清空，清空时回调 null（placeholder 说明空值含义，如「全程」）。
export function numberRow({ label, value, step = 0.1, min, unit, placeholder, allowEmpty = false, onChange }) {
  const fmt = (v) => (v == null ? '' : String(+(+v).toFixed(4)));
  const input = el('input', { class: 'num-input', type: 'number', step, min, placeholder, value: fmt(value) });
  let cur = value;
  input.addEventListener('change', () => {
    const raw = input.value.trim();
    if (raw === '' && allowEmpty) { onChange(null); return; }
    const v = parseFloat(raw);
    if (!Number.isFinite(v) || (min != null && v < min)) { input.value = fmt(cur); return; }
    onChange(v);
  });
  const row = el('div', { class: 'field' }, [
    el('label', { text: label }),
    el('div', { class: 'num-row' }, [input, unit ? el('span', { class: 'num-unit', text: unit }) : null]),
  ]);
  return { el: row, set(v) { cur = v; if (document.activeElement !== input) input.value = fmt(v); } };
}
