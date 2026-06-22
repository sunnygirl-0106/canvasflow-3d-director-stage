import { el } from '../util/dom.js';
import { sliderRow, tripleRow, colorRow, toggleRow, toHex } from './widgets.js';

const D2R = Math.PI / 180;

// 右侧「3D场景」级属性面板（未选中对象时显示）。
export class ScenePanel {
  constructor(container, app) {
    this.app = app;
    this.container = container;
    this.render();
  }

  render() {
    const app = this.app;
    const s = app.sceneState;
    const root = el('div', { class: 'rp rp-pad' });

    root.appendChild(el('h2', { text: '3D场景' }));

    // ---- 3D场景：缩放 / 平移 / 旋转 ----
    const sec1 = el('div', { class: 'sec' });
    sec1.appendChild(sliderRow({
      label: '场景缩放', min: 10, max: 300, step: 1, value: s.scale * 100,
      format: (v) => Math.round(v) + '%', onInput: (v) => app.setSceneScale(v / 100),
    }).el);
    sec1.appendChild(tripleRow({
      label: '场景平移',
      axes: ['x', 'y', 'z'].map((k) => ({ key: k, get: () => s.pos[k], set: (v) => app.setScenePos(k, v) })),
    }).el);
    sec1.appendChild(tripleRow({
      label: '场景旋转', deg: true,
      axes: ['x', 'y', 'z'].map((k) => ({ key: k, get: () => s.rot[k], set: (v) => app.setSceneRot(k, v) })),
    }).el);
    root.appendChild(sec1);

    // ---- 全景背景 ----
    const sec2 = el('div', { class: 'sec' });
    sec2.appendChild(el('div', { class: 'sec-title', text: '全景背景' }));
    sec2.appendChild(el('div', { class: 'field' }, [
      el('label', { text: '已连接全景图' }),
      el('div', { class: 'placeholder-box', html: '<span>⃝</span><span>请将图片节点连接到导演台左侧输入口</span>' }),
    ]));
    sec2.appendChild(colorRow({ label: '天空颜色', hex: toHex(s.sky), onChange: (h) => app.setSkyColor(h) }).el);
    root.appendChild(sec2);

    // ---- 全景球（占位，无全景图时不可用）----
    const sec3 = el('div', { class: 'sec' });
    sec3.appendChild(el('div', { class: 'sec-title', text: '全景球' }));
    sec3.appendChild(sliderRow({ label: '水平旋转', min: 0, max: 360, value: 0, disabled: true, format: (v) => Math.round(v) + '°' }).el);
    sec3.appendChild(sliderRow({ label: '球形半径', min: 10, max: 200, value: 60, disabled: true, format: (v) => Math.round(v) }).el);
    root.appendChild(sec3);

    // ---- 角色标签 / 网格吸附 ----
    const sec4 = el('div', { class: 'sec' });
    sec4.appendChild(toggleRow({ label: '角色标签', checked: s.labels, onChange: (v) => app.setLabelsVisible(v) }).el);
    root.appendChild(sec4);

    const sec5 = el('div', { class: 'sec' });
    sec5.appendChild(toggleRow({ label: '网格吸附', checked: s.snap, onChange: (v) => app.setSnap(v) }).el);
    root.appendChild(sec5);

    // ---- 地面 ----
    const sec6 = el('div', { class: 'sec' });
    sec6.appendChild(toggleRow({ label: '地面', checked: s.ground.visible, onChange: (v) => app.setGroundVisible(v) }).el);
    sec6.appendChild(sliderRow({
      label: '透明度', min: 0, max: 1, step: 0.01, value: s.ground.opacity,
      format: (v) => v.toFixed(2), onInput: (v) => app.setGroundOpacity(v),
    }).el);
    sec6.appendChild(sliderRow({
      label: '高度', min: -2, max: 2, step: 0.01, value: s.ground.height,
      format: (v) => v.toFixed(1), onInput: (v) => app.setGroundHeight(v),
    }).el);
    root.appendChild(sec6);

    this.container.innerHTML = '';
    this.container.appendChild(root);
  }
}
