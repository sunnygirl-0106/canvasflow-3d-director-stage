import { el } from '../../util/dom.js';
import { GUTTER } from './TimelinePanel.js';

const MAJOR_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120]; // 秒
const MIN_LABEL_PX = 64;  // 两个秒标签之间至少这么宽
const MIN_FRAME_PX = 6;   // 帧刻度间距 ≥ 此值才画

/** 标签文案：整秒 "3s"，否则 "1.5s"。 */
const label = (t) => (Math.abs(t - Math.round(t)) < 1e-6 ? Math.round(t) + 's' : +t.toFixed(2) + 's');

/**
 * 标尺：canvas 只画可见区间（横向 sticky，宽 = 可见宽度），按缩放选择秒刻度与帧刻度的密度。
 * 点击 / 拖动标尺 = 拖播放头。
 */
export class Ruler {
  /** @param {import('./TimelinePanel.js').TimelinePanel} panel */
  constructor(panel) {
    this.panel = panel;
    this.canvas = el('canvas', { class: 'tl-ruler' });
    this.ctx = this.canvas.getContext('2d');
    this._w = 0;
    this._h = 0;
    panel.bindScrub(this.canvas);
  }

  /** 可见宽度变化时调整 canvas 尺寸（按 devicePixelRatio 出清晰刻度）。 */
  resize(w, h) {
    const dpr = window.devicePixelRatio || 1;
    if (w === this._w && h === this._h && this._dpr === dpr) return;
    this._w = w; this._h = h; this._dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  draw() {
    const { panel, ctx } = this;
    const w = this._w, h = this._h, dpr = this._dpr || 1;
    if (!w) return;
    const { pps } = panel;
    const { duration, fps } = panel.app.timeline;
    const css = getComputedStyle(this.canvas);
    const dim = css.getPropertyValue('--dim').trim() || '#7d7d86';
    const dim2 = css.getPropertyValue('--dim2').trim() || '#56565d';
    const txt = css.getPropertyValue('--txt').trim() || '#ececf0';

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const t0 = (panel.scrollLeft - GUTTER) / pps; // canvas 左缘对应的时刻（秒，可为负）
    const t1 = Math.min(duration, t0 + w / pps);
    const ts = Math.max(0, t0);
    const x = (t) => (t - t0) * pps + 0.5;

    // 时长之外压暗
    const endX = x(duration);
    if (endX < w) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(Math.max(0, endX), 0, w - endX, h); }

    // 帧刻度
    if (pps / fps >= MIN_FRAME_PX) {
      ctx.strokeStyle = dim2;
      ctx.beginPath();
      for (let f = Math.ceil(ts * fps); f / fps <= t1 + 1e-9; f++) {
        const xx = Math.round(x(f / fps)) + 0.5;
        ctx.moveTo(xx, h - 4); ctx.lineTo(xx, h);
      }
      ctx.stroke();
    }

    // 秒刻度（主刻度带标签，半刻度短线）
    const major = MAJOR_STEPS.find((s) => s * pps >= MIN_LABEL_PX) || MAJOR_STEPS.at(-1);
    ctx.strokeStyle = dim;
    ctx.fillStyle = txt;
    ctx.font = '10.5px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.textBaseline = 'top';
    ctx.beginPath();
    const half = major / 2;
    for (let i = Math.floor(ts / half); i * half <= t1 + 1e-9; i++) {
      const t = i * half;
      if (t < ts - 1e-9) continue;
      const xx = Math.round(x(t)) + 0.5;
      const isMajor = i % 2 === 0;
      ctx.moveTo(xx, isMajor ? h - 10 : h - 6); ctx.lineTo(xx, h);
      if (isMajor) ctx.fillText(label(t), xx + 3, 3);
    }
    ctx.stroke();
  }
}
