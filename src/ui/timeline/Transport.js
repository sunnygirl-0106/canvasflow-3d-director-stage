import { el, toastError } from '../../util/dom.js';
import { icon } from '../icons.js';

const FPS_OPTIONS = [24, 25, 30, 60];

/** 主显示保留两位小数；编辑和采样精度不受格式化影响。 */
export function fmtTime(t) { return Math.max(0, t).toFixed(2); }

/**
 * 播放条：⏮ ◀ ▶/⏸ ⏹ ▶| ⏭ ｜ 当前时刻 / 时长 ｜ 循环 ｜ 吸附 ｜ 自动打键 ｜ fps ｜ 时长 ｜ 主机位 ｜ 折叠。
 * 只发命令、只显示状态；数据一律从 timeline / playback 读，写经 timeline API。
 */
export class Transport {
  /** @param {import('./TimelinePanel.js').TimelinePanel} panel */
  constructor(panel) {
    this.panel = panel;
    const { app } = panel;
    const tl = app.timeline, pb = app.playback;

    const btn = (name, title, onclick, cls = '') => el('button', { class: 'tl-btn ' + cls, title, 'aria-label': title, html: icon(name, 15, 1.5), onclick });
    this.playBtn = btn('play', '播放 / 暂停（Space）', () => panel.togglePlay(), 'tl-play');
    this.loopBtn = btn('loop', '循环播放：播到结尾后从头继续', () => panel.setPref('loop', !pb.loop));
    this.snapBtn = btn('magnet', '吸附到帧：拖动播放头和关键帧时对齐到完整帧', () => panel.setPref('snap', !panel.snap));
    this.autoKeyBtn = btn('record', '自动打键：时间轴激活时，修改没有轨道的属性也会新建轨道并打键', () => panel.setPref('autoKey', !panel.autoKey), 'tl-autokey');
    this.timeEl = el('span', { class: 'tl-time', title: '当前播放时间（秒）', text: '0.00' });

    this.fpsSel = el('select', { class: 'tl-sel', title: '帧率（吸附与导出）' }, FPS_OPTIONS.map((n) => el('option', { value: n, text: n + ' 帧/秒' })));
    this.fpsSel.addEventListener('change', () => { try { tl.setFps(+this.fpsSel.value); } catch (e) { toastError(e); this.reflectTimeline(); } });

    this.durInput = el('input', { class: 'tl-num', type: 'number', min: 0.1, step: 0.5, title: '场景总时长（秒）：超出的轨迹会自动加速适配，保留完整路线', 'aria-label': '场景总时长（秒）' });
    this.durInput.addEventListener('change', () => {
      const v = parseFloat(this.durInput.value);
      if (!(v > 0)) { this.reflectTimeline(); return; }
      try { tl.setDuration(Math.round(v * 1000) / 1000); } catch (e) { toastError(e); this.reflectTimeline(); }
    });

    this.camSel = el('select', { class: 'tl-sel tl-cam', title: '主机位：机位视角下播放 / 拖播放头时透过它看（成片预览）' });
    this.camSel.addEventListener('change', () => { try { tl.setMainCamera(this.camSel.value || null); } catch (e) { toastError(e); this.reflectCameras(); } });

    this.foldBtn = btn('timelinePanel', '折叠 / 展开时间轴', () => panel.toggleCollapsed(), 'tl-fold');

    this.removeBtn = el('button', { class: 'tl-track-action', title: '新建轨道', text: '＋ 新建轨道', onclick: (e) => panel.selectedAnimation ? panel.removeSelectedAnimation() : panel.addTrackMenu(e) });
    this.zoom = el('input', { type: 'range', min: 0, max: 100, value: 0, title: '时间轴缩放：向右拖动放大，查看更精细的时间和关键帧', class: 'tl-zoom' });
    this.zoom.addEventListener('input', () => panel.setZoom(panel._fitPps() * Math.pow(1500 / panel._fitPps(), +this.zoom.value / 100)));
    const fit = el('button', { class: 'tl-addkey', text: '显示全长', title: '适配完整时长', onclick: () => panel.setZoom(panel._fitPps()) });
    const exp = el('button', { class: 'tl-export', text: '导出视频', onclick: () => app.emit('exportVideo') });
    this.tools = el('div', { class: 'tl-tools' }, [fit, this.zoom, this.fpsSel, exp, this.foldBtn]);
    const menu = el('details', { class: 'tl-more' }, [
      el('summary', { text: '···', title: '帧操作与时间轴设置' }),
      el('div', { class: 'tl-settings' }, [
        btn('toStart', '回到开头（Home）', () => panel.seek(0)),
        btn('prevFrame', '上一帧（←）', () => panel.stepFrames(-1)),
        btn('stop', '停止并回到手动值（Esc）', () => app.stopPreview()),
        btn('nextFrame', '下一帧（→）', () => panel.stepFrames(1)),
        btn('toEnd', '跳到结尾（End）', () => panel.seek(tl.duration)),
        this.snapBtn, this.autoKeyBtn,
        el('label', { class: 'tl-field' }, [el('span', { text: '主机位' }), this.camSel]),
      ]),
    ]);
    this.el = el('div', { class: 'tl-transport' }, [
      this.playBtn, btn('stopwatch', '回到开头（Home）', () => panel.seek(0)), this.loopBtn,
      el('span', { class: 'tl-clock' }, [this.timeEl, el('span', { class: 'tl-time-separator', text: '/' }), this.durInput, el('span', { class: 'tl-unit', text: 's' })]),
      this.removeBtn, menu,
    ]);
    this.reflectAll();
  }

  reflectAll() {
    this.reflectState();
    this.reflectTime(this.panel.app.playback.time);
    this.reflectTimeline();
    this.reflectCameras();
    this.reflectPrefs();
  }

  reflectState() {
    const playing = this.panel.app.playback.playing;
    this.playBtn.innerHTML = icon(playing ? 'pause' : 'play', 15, 1.5);
    this.playBtn.classList.toggle('on', playing);
  }

  reflectTime(t) { this.timeEl.textContent = fmtTime(t); }

  reflectTimeline() {
    const tl = this.panel.app.timeline;
    if (document.activeElement !== this.durInput) this.durInput.value = fmtTime(tl.duration);
    if (!FPS_OPTIONS.includes(tl.fps) && !this.fpsSel.querySelector(`option[value="${tl.fps}"]`)) {
      this.fpsSel.appendChild(el('option', { value: tl.fps, text: tl.fps + ' 帧/秒' })); // 导入文档的非常规帧率
    }
    this.fpsSel.value = String(tl.fps);
    this.reflectCameras();
  }

  reflectCameras() {
    const { app } = this.panel;
    const cur = app.timeline.mainCameraId;
    const opts = [el('option', { value: '', text: '无' }), ...app.cameras.map((c) => el('option', { value: c.id, text: c.name }))];
    this.camSel.replaceChildren(...opts);
    this.camSel.value = cur && app.findCamera(cur) ? cur : '';
  }

  reflectPrefs() {
    const { panel } = this;
    this.loopBtn.classList.toggle('on', panel.app.playback.loop);
    this.snapBtn.classList.toggle('on', panel.snap);
    this.autoKeyBtn.classList.toggle('on', panel.autoKey);
    this.foldBtn.classList.toggle('up', panel.collapsed);
  }
}
