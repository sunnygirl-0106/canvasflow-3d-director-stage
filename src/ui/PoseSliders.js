import { el, clear } from '../util/dom.js';
import { JOINT_SCHEMA, groupJoints } from '../rig/jointSchema.js';

// 从语义关节表 JOINT_SCHEMA 按 group/side 分组渲染滑条（0 = 自然站立）。
// input → 写 character.values[key] → applyPose()。
export class PoseSliders {
  constructor(container, character, onChange, onCommit) {
    this.container = container;
    this.character = character;
    this.onCommit = onCommit;
    this.onChange = onChange; // 可选：每次摆姿后回调（群众组用于广播到全部成员）
    this.sliderEls = {}; // key → {input, valSpan}
    this.render();
  }

  render() {
    clear(this.container);
    this.sliderEls = {};
    const ch = this.character;
    const wrap = el('div', { class: 'sliders' });
    const missing = new Set(ch.missingJoints || []); // 模型缺少骨头的关节：滑条置灰禁用

    for (const g of groupJoints(JOINT_SCHEMA)) {
      wrap.appendChild(el('h4', { text: g.group }));
      for (const s of g.sides) {
        if (s.side) wrap.appendChild(el('div', { class: 'sideLab', text: s.side }));
        for (const j of s.joints) {
          const val = ch.values[j.key] || 0;
          const valSpan = el('span', { class: 'v', text: Math.round(val) + '°' });
          const input = el('input', {
            type: 'range', min: j.min, max: j.max, step: 1, value: val,
            onchange: () => this.onCommit?.(),
            oninput: (e) => {
              const v = parseFloat(e.target.value);
              ch.values[j.key] = v;
              valSpan.textContent = Math.round(v) + '°';
              ch.currentPreset = null; // 手动微调取消预设高亮
              ch.applyPose();
              this.onChange && this.onChange();
            },
          });
          const off = missing.has(j.key);
          input.disabled = off;
          const row = el('div', { class: off ? 'sld disabled' : 'sld', title: off ? '该模型缺少此关节' : null }, [
            el('div', { class: 'lab' }, [el('b', { text: j.label }), valSpan]),
            input,
          ]);
          this.sliderEls[j.key] = { input, valSpan };
          wrap.appendChild(row);
        }
      }
    }
    this.container.appendChild(wrap);
  }

  /** 外部（如套用预设/复位）改了 values 后，刷新滑条 UI 到当前值。 */
  syncFromValues() {
    const ch = this.character;
    for (const j of JOINT_SCHEMA) {
      const slot = this.sliderEls[j.key];
      if (!slot) continue;
      const v = ch.values[j.key] || 0;
      slot.input.value = v;
      slot.valSpan.textContent = Math.round(v) + '°';
    }
  }
}
