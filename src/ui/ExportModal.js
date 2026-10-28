import { el, toast } from '../util/dom.js';
import { icon } from './icons.js';
import { downloadURL } from '../app/ShotManager.js';
import { onKey, KEY_PRIORITY } from '../util/keys.js';
import {
  EXPORT_RESOLUTIONS, exportSize, frameCount, exportCamera, hasWebCodecs, isExportSupported, UNSUPPORTED_MSG,
} from '../app/exportSpec.js';

const FPS_OPTIONS = [24, 25, 30, 60];
const fmtSec = (s) => String(+s.toFixed(2));
const fmtClock = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

/**
 * 「导出视频」弹层（沿用 HistoryModal 的弹层样式）：分辨率 / 帧率 / 范围 / 名牌 / 预览名牌 → 开始导出 →
 * 进度（帧 i/N、已用时、预计剩余）+ 取消；完成自动下载并提示文件大小。
 * 导出中锁住整个界面（body.exporting：时间轴 / 面板 / Dock 置灰、不响应），Esc = 取消。
 * 表单是会话态（再次打开保留上次选择，帧率默认跟时间轴），不进文档。
 */
export class ExportModal {
  constructor(app) {
    this.app = app;
    this.overlay = null;
    this.form = { short: 1080, fps: null, whole: true, t0: 0, t1: null, labels: true };
    this._abort = null;
    this._onKey = (e) => {
      if (!this.app.exporting && !this.overlay) return;
      if (e.key === 'Escape') {
        if (this._abort) this._abort.abort(); else this.close();
      }
      // 导出中 / 弹层打开时快捷键（撤销、删除、变换模式…）一律不响应
      e.stopImmediatePropagation();
      if (this.app.exporting) e.preventDefault();
    };
    onKey(this._onKey, { priority: KEY_PRIORITY.modal });
  }

  get busy() { return !!this._abort; }

  open() {
    if (this.overlay) return;
    const tl = this.app.timeline;
    if (this.form.fps == null || !FPS_OPTIONS.includes(this.form.fps)) this.form.fps = FPS_OPTIONS.includes(tl.fps) ? tl.fps : 30;
    this.overlay = el('div', { class: 'hm-overlay export-overlay' });
    this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay && !this.busy) this.close(); });
    this.box = el('div', { class: 'hm-box export-box' });
    this.overlay.appendChild(this.box);
    document.body.appendChild(this.overlay);
    this._render();
  }

  close() {
    if (this.busy) return;
    this.overlay?.remove();
    this.overlay = null;
    this.app.setLabelPreview(false);
  }

  /** 当前表单 → 导出参数（含校验错误）。 */
  params() {
    const app = this.app, f = this.form;
    const D = app.timeline.duration;
    const { width, height } = exportSize(app.ratio, f.short);
    const range = f.whole ? [0, D] : [f.t0, f.t1 ?? D];
    const cam = exportCamera(app);
    let error = null;
    if (!cam) error = '请先添加机位';
    else if (!(range[1] > range[0])) error = '结束时间须大于开始时间';
    else if (range[0] < 0 || range[1] > D + 1e-9) error = `范围须在 0–${fmtSec(D)} 秒内`;
    const n = error ? 0 : frameCount(range, f.fps);
    return { width, height, fps: f.fps, range, labels: f.labels, cam, n, error };
  }

  _render() {
    const app = this.app, f = this.form;
    const p = this.params();
    const D = app.timeline.duration;
    const head = el('div', { class: 'hm-head' }, [
      el('div', { class: 'hm-title', text: '导出视频' }),
      el('button', { class: 'hm-close', html: icon('close', 20), title: '关闭', onclick: () => this.close() }),
    ]);

    const camLine = !p.cam
      ? el('div', { class: 'ex-cam err', text: '请先添加机位' })
      : el('div', { class: 'ex-cam' }, [
        el('span', { class: 'ex-cam-tag' + (p.cam.source === 'main' ? ' main' : ''), text: p.cam.source === 'main' ? '主机位' : '当前机位' }),
        el('span', { text: p.cam.ent.name }),
        p.cam.source === 'main' ? null : el('span', { class: 'ex-dim', text: '（未设主机位）' }),
      ]);

    const select = (options, value, onChange) => {
      const s = el('select', { class: 'dropdown' });
      for (const o of options) {
        const opt = el('option', { value: String(o.value) });
        opt.textContent = o.label;
        if (o.value === value) opt.selected = true;
        s.appendChild(opt);
      }
      s.addEventListener('change', () => { onChange(s.value); this._render(); });
      return s;
    };
    const row = (label, ...ctrls) => el('div', { class: 'ex-row' }, [el('label', { text: label }), el('div', { class: 'ex-ctrl' }, ctrls)]);
    const check = (label, checked, onChange, name) => {
      const inp = el('input', { type: 'checkbox' });
      inp.checked = checked;
      inp.dataset.name = name;
      inp.addEventListener('change', () => { onChange(inp.checked); this._render(); });
      return el('label', { class: 'ex-check' }, [inp, el('span', { text: label })]);
    };
    const num = (value, onChange, name) => {
      const inp = el('input', { class: 'num-input', type: 'number', step: 0.1, min: 0, max: D, value: fmtSec(value) });
      inp.dataset.name = name;
      inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (Number.isFinite(v)) onChange(v); this._render(); });
      return inp;
    };

    const res = select(EXPORT_RESOLUTIONS.map((r) => {
      const s = exportSize(app.ratio, r.short);
      return { value: r.short, label: `${r.label} · ${s.width}×${s.height}` };
    }), f.short, (v) => { f.short = +v; });
    res.dataset.name = 'res';
    const fps = select(FPS_OPTIONS.map((v) => ({ value: v, label: `${v} fps` })), f.fps, (v) => { f.fps = +v; });
    fps.dataset.name = 'fps';
    const rangeSel = select([{ value: 'all', label: `全程（0–${fmtSec(D)} s）` }, { value: 'custom', label: '自定义' }], f.whole ? 'all' : 'custom', (v) => {
      f.whole = v === 'all';
      if (!f.whole && f.t1 == null) f.t1 = D;
    });
    rangeSel.dataset.name = 'range';
    const custom = f.whole ? null : el('div', { class: 'ex-range' }, [
      num(f.t0, (v) => { f.t0 = v; }, 't0'), el('span', { class: 'ex-dim', text: '–' }),
      num(f.t1 ?? D, (v) => { f.t1 = v; }, 't1'), el('span', { class: 'ex-dim', text: '秒' }),
    ]);

    const body = el('div', { class: 'ex-body' }, [
      camLine,
      row('分辨率', res),
      el('div', { class: 'ex-note', text: `宽高比跟随取景比例（${app.ratio === 'auto' ? 'Auto = 16:9' : app.ratio}）` }),
      row('帧率', fps),
      row('范围', rangeSel, custom),
      row('名牌', check('画进视频', f.labels, (v) => { f.labels = v; }, 'labels'),
        check('视口预览', !!app.labelPreview, (v) => app.setLabelPreview(v), 'preview')),
      el('div', { class: 'ex-est' + (p.error ? ' err' : ''), text: p.error || `${p.width}×${p.height} · ${p.n} 帧 · 时长 ${fmtSec(p.n / p.fps)} s` }),
    ]);

    this.progressEl = el('div', { class: 'ex-progress', hidden: true }, [
      el('div', { class: 'ex-bar' }, [el('div', { class: 'ex-fill' })]),
      el('div', { class: 'ex-ptext' }),
    ]);
    this.startBtn = el('button', { class: 'minibtn primary ex-start', text: '开始导出', onclick: () => this.start() });
    this.cancelBtn = el('button', { class: 'minibtn ex-cancel', text: '取消', hidden: true, onclick: () => this._abort?.abort() });
    this.unsupEl = el('div', { class: 'ex-unsup', hidden: true, text: UNSUPPORTED_MSG });
    const foot = el('div', { class: 'ex-foot' }, [this.unsupEl, this.startBtn, this.cancelBtn]);

    this.box.replaceChildren(head, body, this.progressEl, foot);
    this.startBtn.disabled = !!p.error;
    this._checkSupport(p);
  }

  /** 能力检测：不支持则禁用「开始导出」并显示提示。 */
  async _checkSupport(p) {
    const button = this.startBtn;
    const ok = hasWebCodecs() && (p.error || await isExportSupported(p.width, p.height, p.fps));
    // 改规格或重新打开弹层会重建按钮；旧请求不能覆盖新表单的检测结果。
    if (!this.overlay || this.startBtn !== button) return;
    this.unsupEl.hidden = !!ok;
    if (!ok) {
      this.unsupEl.textContent = hasWebCodecs() ? `当前浏览器不支持 ${p.width}×${p.height} 的 H.264 编码` : UNSUPPORTED_MSG;
      this.startBtn.disabled = true;
    }
  }

  async start() {
    if (this.busy) return;
    const p = this.params();
    if (p.error) { toast(p.error); return; }
    if (!hasWebCodecs()) { toast(UNSUPPORTED_MSG); return; }
    const ac = (this._abort = new AbortController());
    const t0 = performance.now();
    this._lock(true);
    const fill = this.progressEl.querySelector('.ex-fill');
    const text = this.progressEl.querySelector('.ex-ptext');
    const onProgress = (i, n) => {
      fill.style.width = `${(i / n) * 100}%`;
      const used = performance.now() - t0;
      text.textContent = `帧 ${i}/${n} · 已用 ${fmtClock(used)} · 预计剩余 ${fmtClock(i ? (used / i) * (n - i) : 0)}`;
    };
    onProgress(0, p.n || 1);
    try {
      const { exportVideo } = await import('../app/VideoExporter.js'); // 编码 / 封装（含 mp4-muxer）只在导出时加载
      const out = await exportVideo(this.app, { ...p, signal: ac.signal, onProgress });
      if (ac.signal.aborted) throw new DOMException('导出已取消', 'AbortError');
      const url = URL.createObjectURL(out.blob);
      downloadURL(url, out.filename);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      this.lastResult = { filename: out.filename, size: out.blob.size, frames: out.frames };
      toast(`已导出 ${out.filename}（${fmtSize(out.blob.size)}）`, { duration: 4000 });
      this._abort = null;
      this._lock(false);
      this.close();
      return;
    } catch (err) {
      if (err?.name === 'AbortError') toast('已取消导出');
      else { console.warn(err); toast('导出失败：' + (err?.message || err)); }
    }
    this._abort = null;
    this._lock(false);
  }

  _lock(on) {
    document.body.classList.toggle('exporting', on);
    this.progressEl.hidden = !on;
    this.startBtn.hidden = on;
    this.cancelBtn.hidden = !on;
    for (const n of this.box.querySelectorAll('.ex-body select, .ex-body input, .hm-close')) n.disabled = on;
  }
}
