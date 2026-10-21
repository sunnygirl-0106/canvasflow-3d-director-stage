import { el } from '../util/dom.js';
import { sliderRow, tripleRow, colorRow, toggleRow, toHex } from './widgets.js';

// 右侧「3D场景」级属性面板（未选中对象时显示）。
export class ScenePanel {
  constructor(container, app) {
    this.app = app;
    this.container = container;
    app.on('scene', () => this.render());
    this.render();
  }

  render() {
    const app = this.app;
    const s = app.sceneState;
    const preview = { preview: true };
    const commit = () => app.commitScenePreview();
    const pano = app.panorama;
    const root = el('div', { class: 'rp rp-pad' });

    root.appendChild(el('h2', { text: '3D场景' }));

    // ---- 3D场景：缩放 / 平移 / 旋转 ----
    const sec1 = el('div', { class: 'sec' });
    sec1.appendChild(sliderRow({
      label: '场景缩放', min: 10, max: 300, step: 1, value: s.scale * 100,
      format: (v) => Math.round(v) + '%', onInput: (v) => app.setSceneScale(v / 100, preview), onChange: commit,
    }).el);
    sec1.appendChild(tripleRow({
      label: '场景平移', onCommit: commit,
      axes: ['x', 'y', 'z'].map((k) => ({ key: k, get: () => app.sceneState.pos[k], set: (v) => app.setScenePos(k, v, preview) })),
    }).el);
    sec1.appendChild(tripleRow({
      label: '场景旋转', deg: true, onCommit: commit,
      axes: ['x', 'y', 'z'].map((k) => ({ key: k, get: () => app.sceneState.rot[k], set: (v) => app.setSceneRot(k, v, preview) })),
    }).el);
    root.appendChild(sec1);

    // ---- 全景背景 ----
    const sec2 = el('div', { class: 'sec' });
    sec2.appendChild(el('div', { class: 'sec-title', text: '全景背景' }));
    const panoField = el('div', { class: 'field' }, [el('label', { text: '已连接全景图' })]);
    if (pano.active && pano.info) {
      const thumb = el('div', { class: 'pano-connected' }, [
        el('div', { class: 'pano-preview' }),
        el('div', { class: 'pano-meta' }, [
          el('div', { class: 'pano-title', text: pano.info.title || '全景图' }),
          el('button', { class: 'pano-remove', text: '移除', onclick: () => pano.clear() }),
        ]),
      ]);
      thumb.querySelector('.pano-preview').style.backgroundImage = `url(${pano.info.thumb})`;
      panoField.appendChild(thumb);
    } else {
      panoField.appendChild(el('div', { class: 'placeholder-box', html: '<span>⃝</span><span>左侧「全景」按钮：本地上传或选历史记录</span>' }));
    }
    sec2.appendChild(panoField);
    sec2.appendChild(colorRow({ label: '天空颜色', hex: toHex(s.sky), onChange: (h) => app.setSkyColor(h, preview), onCommit: commit }).el);
    root.appendChild(sec2);

    // ---- 全景球（有全景图时可用）----
    const sec3 = el('div', { class: 'sec' });
    sec3.appendChild(el('div', { class: 'sec-title', text: '全景球' }));
    sec3.appendChild(sliderRow({ label: '水平旋转', min: 0, max: 360, value: pano.rotation, disabled: !pano.active, format: (v) => Math.round(v) + '°', onInput: (v) => app.sceneEdit((scene) => { scene.panorama.rotation = v; }, preview), onChange: commit }).el);
    sec3.appendChild(sliderRow({ label: '球形半径', min: 3, max: 200, value: pano.radius, disabled: !pano.active, format: (v) => Math.round(v), onInput: (v) => app.sceneEdit((scene) => { scene.panorama.radius = v; }, preview), onChange: commit }).el);
    root.appendChild(sec3);

    // ---- 角色标签 ----
    const sec4 = el('div', { class: 'sec' });
    sec4.appendChild(toggleRow({ label: '角色标签', checked: s.labels, onChange: (v) => app.setLabelsVisible(v) }).el);
    root.appendChild(sec4);

    // ---- 地面 ----
    const sec6 = el('div', { class: 'sec' });
    sec6.appendChild(toggleRow({ label: '地面', checked: s.ground.visible, onChange: (v) => app.setGroundVisible(v) }).el);
    sec6.appendChild(sliderRow({
      label: '透明度', min: 0, max: 1, step: 0.01, value: s.ground.opacity,
      format: (v) => v.toFixed(2), onInput: (v) => app.setGroundOpacity(v, preview), onChange: commit,
    }).el);
    sec6.appendChild(sliderRow({
      label: '高度', min: -2, max: 2, step: 0.01, value: s.ground.height,
      format: (v) => v.toFixed(1), onInput: (v) => app.setGroundHeight(v, preview), onChange: commit,
    }).el);
    root.appendChild(sec6);

    this.container.replaceChildren(root);
  }
}
