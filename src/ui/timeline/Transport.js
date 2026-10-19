import { el, toast } from '../../util/dom.js';
import { icon } from '../icons.js';

const FPS_OPTIONS = [24, 25, 30, 60];

/** 秒 → "mm:ss.cc"。 */
export function fmtTime(t) {
  const cs = Math.round(Math.max(0, t) * 100);
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(m)}:${p(s)}.${p(c)}`;
}

/** timeline API 抛出的错误 → toast（DocumentError 逐条列出字段路径）。 */
export function toastError(err) {
  console.warn(err);
  toast(err?.errors?.length ? err.errors.slice(0, 3).join('\n') : (err?.message || String(err)));
}

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

    const btn = (name, title, onclick, cls = '') => el('button', { class: 'tl-btn ' + cls, title, html: icon(name, 16, 2), onclick });
    this.playBtn = btn('play', '播放 / 暂停（Space）', () => panel.togglePlay(), 'tl-play');
    this.loopBtn = btn('loop', '循环播放', () => panel.setPref('loop', !pb.loop));
    this.snapBtn = btn('magnet', '吸附到帧', () => panel.setPref('snap', !panel.snap));
    this.autoKeyBtn = btn('record', '自动打键：时间轴激活时，修改没有轨道的属性也会新建轨道并打键', () => panel.setPref('autoKey', !panel.autoKey), 'tl-autokey');
    this.timeEl = el('span', { class: 'tl-time', text: '00:00.00' });
    this.durEl = el('span', { class: 'tl-dur', text: '/ ' + fmtTime(tl.duration) });

    this.fpsSel = el('select', { class: 'tl-sel', title: '帧率（吸附与导出）' }, FPS_OPTIONS.map((n) => el('option', { value: n, text: n + ' fps' })));
    this.fpsSel.addEventListener('change', () => { try { tl.setFps(+this.fpsSel.value); } catch (e) { toastError(e); this.reflectTimeline(); } });

    this.durInput = el('input', { class: 'tl-num', type: 'number', min: 0.1, step: 0.5, title: '时长（秒）' });
    this.durInput.addEventListener('change', () => {
      const v = parseFloat(this.durInput.value);
      if (!(v > 0)) { this.reflectTimeline(); return; }
      try { tl.setDuration(Math.round(v * 1000) / 1000); } catch (e) { toastError(e); this.reflectTimeline(); }
    });

    this.camSel = el('select', { class: 'tl-sel tl-cam', title: '主机位：机位视角下播放 / 拖播放头时透过它看（成片预览）' });
    this.camSel.addEventListener('change', () => { try { tl.setMainCamera(this.camSel.value || null); } catch (e) { toastError(e); this.reflectCameras(); } });

    this.foldBtn = btn('chevron', '折叠 / 展开时间轴', () => panel.toggleCollapsed(), 'tl-fold');

    this.el = el('div', { class: 'tl-transport' }, [
      btn('toStart', '回到开头（Home）', () => panel.seek(0)),
      btn('prevFrame', '上一帧（←）', () => panel.stepFrames(-1)),
      this.playBtn,
      btn('stop', '停止并回到手动值（Esc）', () => pb.stop()),
      btn('nextFrame', '下一帧（→）', () => panel.stepFrames(1)),
      btn('toEnd', '跳到结尾（End）', () => panel.seek(tl.duration)),
      el('span', { class: 'tl-clock' }, [this.timeEl, this.durEl]),
      el('span', { class: 'tl-vsep' }),
      this.loopBtn, this.snapBtn, this.autoKeyBtn,
      el('span', { class: 'tl-vsep' }),
      this.fpsSel,
      el('label', { class: 'tl-field' }, [el('span', { text: '时长' }), this.durInput, el('span', { text: 's' })]),
      el('label', { class: 'tl-field' }, [el('span', { text: '主机位' }), this.camSel]),
      el('span', { class: 'tl-grow' }),
      this.foldBtn,
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
    this.playBtn.innerHTML = icon(playing ? 'pause' : 'play', 16, 2);
    this.playBtn.classList.toggle('on', playing);
  }

  reflectTime(t) { this.timeEl.textContent = fmtTime(t); }

  reflectTimeline() {
    const tl = this.panel.app.timeline;
    this.durEl.textContent = '/ ' + fmtTime(tl.duration);
    if (document.activeElement !== this.durInput) this.durInput.value = String(tl.duration);
    if (!FPS_OPTIONS.includes(tl.fps) && !this.fpsSel.querySelector(`option[value="${tl.fps}"]`)) {
      this.fpsSel.appendChild(el('option', { value: tl.fps, text: tl.fps + ' fps' })); // 导入文档的非常规帧率
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
