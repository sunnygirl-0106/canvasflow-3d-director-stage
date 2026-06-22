import * as THREE from 'three';
import { el } from '../util/dom.js';

// 滑条行：label 在上，[====蓝色填充滑条====] [数值框]
export function sliderRow({ label, min, max, step = 1, value = 0, disabled = false, format = (v) => String(v), onInput }) {
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
  const row = el('div', { class: 'field' }, [
    label != null ? el('label', { text: label }) : null,
    el('div', { class: 'slider-row' }, [input, valbox]),
  ]);
  return { el: row, set(v) { input.value = v; setFill(v); valbox.textContent = format(v); } };
}

// 三元 XYZ 行。axes: [{key:'x', get:()=>num, set:(v)=>{}}]; deg=true 时显示整数度
export function tripleRow({ label, axes, deg = false }) {
  const fx = (v) => (deg ? String(Math.round(v)) : (Math.round(v * 100) / 100).toFixed(2));
  const inputs = {};
  const fields = axes.map(({ key, get, set }) => {
    const input = el('input', { value: fx(get()) });
    input.addEventListener('input', () => { const v = parseFloat(input.value); if (!isNaN(v)) set(v); });
    inputs[key] = { input, get };
    return el('div', { class: 'fld' }, [el('span', { class: 'ax', text: key.toUpperCase() }), input]);
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

// 颜色行：色块 + #hex 文本
export function colorRow({ label = '颜色', hex, onChange }) {
  const picker = el('input', { type: 'color', value: hex });
  const swatch = el('div', { class: 'swatch' }, [picker]);
  swatch.style.background = hex;
  const text = el('input', { value: hex.replace('#', '') });
  const apply = (h) => { swatch.style.background = h; picker.value = h; onChange(h); };
  picker.addEventListener('input', () => { text.value = picker.value.replace('#', ''); apply(picker.value); });
  text.addEventListener('change', () => {
    const v = text.value.trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(v)) apply(v[0] === '#' ? v : '#' + v);
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
