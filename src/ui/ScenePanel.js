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
    const panoField = el('div', { class: 'field' }, [el('label', { text: '已连接全景图' })]);
    if (app.panoActive && app.panoramaInfo) {
      const thumb = el('div', { class: 'pano-connected' }, [
        el('div', { class: 'pano-preview' }),
        el('div', { class: 'pano-meta' }, [
          el('div', { class: 'pano-title', text: app.panoramaInfo.title || '全景图' }),
          el('button', { class: 'pano-remove', text: '移除', onclick: () => app.clearPanorama() }),
        ]),
      ]);
      thumb.querySelector('.pano-preview').style.backgroundImage = `url(${app.panoramaInfo.thumb})`;
      panoField.appendChild(thumb);
    } else {
      panoField.appendChild(el('div', { class: 'placeholder-box', html: '<span>⃝</span><span>底部「全景图」按钮：本地上传或选历史记录</span>' }));
    }
    sec2.appendChild(panoField);
    sec2.appendChild(colorRow({ label: '天空颜色', hex: toHex(s.sky), onChange: (h) => app.setSkyColor(h) }).el);
    root.appendChild(sec2);

    // ---- 全景球（有全景图时可用，§3.c）----
    const sec3 = el('div', { class: 'sec' });
    sec3.appendChild(el('div', { class: 'sec-title', text: '全景球' }));
    const pano = app.panoActive;
    sec3.appendChild(sliderRow({ label: '水平旋转', min: 0, max: 360, value: s.panoRot, disabled: !pano, format: (v) => Math.round(v) + '°', onInput: (v) => app.setPanoramaRotation(v) }).el);
    sec3.appendChild(sliderRow({ label: '球形半径', min: 10, max: 200, value: s.panoRadius, disabled: !pano, format: (v) => Math.round(v), onInput: (v) => app.setPanoramaRadius(v) }).el);
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
