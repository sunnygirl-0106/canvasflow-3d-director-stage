import { el } from '../../util/dom.js';
import { Emitter } from '../../util/Emitter.js';
import { Transport } from './Transport.js';
import { Ruler } from './Ruler.js';
import { TrackRows, keyId } from './TrackRows.js';

export const NAME_W = 184;   // 左侧行名列宽
export const GUTTER = 12;    // 0 秒距名列的留白（t=0 的键不被名列遮住）
const RULER_H = 24;
const PAD_R = 24;            // 时长之后留白（末尾的键 / 播放头不贴边）
const MAX_PPS = 1500;        // 最大缩放（px / 秒）
const PREF_KEY = 'director-stage.timeline';
const SHORT_WINDOW = 900;    // 窗口低于此高度时默认折叠

/** 会话偏好（折叠 / 自动打键 / 吸附 / 循环）：只存 localStorage，不进场景文档。 */
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* 隐私模式等：忽略 */ }
}

const isTyping = (t) => t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/**
 * 底部时间轴面板（阶段 D）。
 * - 面板不持有文档状态：行在 timeline 'change' 时按 toJSON() 重建；写操作一律走 timeline API。
 * - 播放头在 playback 'tick' 时只改 transform，不重建行。
 * 事件：'collapse'(bool)。
 */
export class TimelinePanel extends Emitter {
  constructor(container, app) {
    super();
    this.app = app;
    this.container = container;
    const tl = app.timeline, pb = app.playback;

    const prefs = loadPrefs();
    this.collapsed = prefs.collapsed ?? (window.innerHeight < SHORT_WINDOW);
    this.autoKey = !!prefs.autoKey;
    this.snap = prefs.snap ?? true;
    pb.loop = !!prefs.loop;

    this.pps = 100;          // px / 秒
    this.fit = true;         // 未手动缩放：时长铺满可见宽度
    this.scrollLeft = 0;
    this.selKeys = new Set(); // 选中的关键帧（keyId）

    this._build();
    this.setCollapsed(this.collapsed, { save: false });

    tl.on('change', () => this._onTimelineChange());
    pb.on('tick', (t) => this._onTick(t));
    pb.on('state', () => this.transport.reflectState());
    app.on('entities', () => { this.transport.reflectCameras(); this.rebuild(); }); // 改名 / 删除
    app.on('selection', () => this._applySelection());
    window.addEventListener('keydown', (e) => this._onKey(e), true); // 捕获阶段：先于全局快捷键（Del 删键而非删实体）
    new ResizeObserver(() => this._layout()).observe(this.scroll);
  }

  // ---- DOM ----
  _build() {
    this.transport = new Transport(this);
    this.ruler = new Ruler(this);
    this.trackRows = new TrackRows(this);
    this.phHead = el('div', { class: 'tl-ph-head' });
    this.bindScrub(this.phHead);
    this.corner = el('div', { class: 'tl-corner', style: { width: NAME_W + 'px' } });
    this.rulerRow = el('div', { class: 'tl-ruler-row', style: { height: RULER_H + 'px' } }, [this.corner, this.ruler.canvas, this.phHead]);
    this.rows = el('div', { class: 'tl-rows' });
    this.phLine = el('div', { class: 'tl-ph-line' });
    this.content = el('div', { class: 'tl-content' }, [this.rulerRow, this.rows, this.phLine]);
    this.scroll = el('div', { class: 'tl-scroll' }, [this.content]);
    this.scroll.style.setProperty('--name-w', NAME_W + 'px');
    this.scroll.style.setProperty('--gutter', GUTTER + 'px');
    this.scroll.addEventListener('scroll', () => { this.scrollLeft = this.scroll.scrollLeft; this._drawRuler(); });
    this.scroll.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    this.rows.addEventListener('pointerdown', (e) => this._onRowsPointer(e));
    this.container.replaceChildren(this.transport.el, this.scroll);
    this._rebuildNow();
  }

  /** 行全量重建（同一同步流程内多次触发只重建一次，在下一帧绘制之前完成）。 */
  rebuild() {
    if (this._rebuildQueued) return;
    this._rebuildQueued = true;
    queueMicrotask(() => { this._rebuildQueued = false; this._rebuildNow(); });
  }

  _rebuildNow() {
    this.rows.replaceChildren(this.trackRows.build());
    // 丢掉已不存在的选中键
    const alive = new Set();
    for (const g of this.trackRows.groups) for (const r of g.rows) if (r.kind === 'track') for (const k of r.data.keys) alive.add(keyId(r.data.id, k.t));
    for (const id of [...this.selKeys]) if (!alive.has(id)) this.selKeys.delete(id);
    this._applySelection();
  }

  /** 选中联动：选中实体的行高亮；选中键高亮。 */
  _applySelection() {
    const sel = this.app.selectedIds;
    for (const row of this.rows.querySelectorAll('.tl-row')) row.classList.toggle('sel', sel.has(row.dataset.ent));
    for (const k of this.rows.querySelectorAll('.tl-key')) k.classList.toggle('sel', this.selKeys.has(keyId(k.dataset.track, k.dataset.t)));
  }

  /** 行区点击：点键 = 选键（⇧ 多选）；点行其它位置 = 选中实体。 */
  _onRowsPointer(e) {
    if (e.button !== 0) return;
    const key = e.target.closest('.tl-key');
    if (key) {
      const id = keyId(key.dataset.track, key.dataset.t);
      if (e.shiftKey) { if (this.selKeys.has(id)) this.selKeys.delete(id); else this.selKeys.add(id); }
      else if (!this.selKeys.has(id)) { this.selKeys.clear(); this.selKeys.add(id); }
      this._selectEntityOf(key);
      this._applySelection();
      return;
    }
    if (e.target.closest('.tl-op, .tl-caret')) return;
    const row = e.target.closest('.tl-row');
    if (!e.shiftKey) this.selKeys.clear();
    if (row) this._selectEntityOf(row);
    this._applySelection();
  }

  _selectEntityOf(node) {
    const id = node.closest('.tl-row')?.dataset.ent;
    if (id && this.app.selectedId !== id && this.app.findEntity(id)) this.app.select(id);
  }

  /** 删除某实体的全部动画（轨道 / 路径 / 以它为对象的约束），一次撤销。 */
  removeAllAnimation(entId) {
    const tl = this.app.timeline;
    const { timeline, paths, constraints } = tl.toJSON();
    for (const t of timeline.tracks) if (t.target === entId) tl.removeTrack(t.id);
    for (const p of paths) if (p.target === entId) tl.removePath(p.id);
    for (const c of constraints) if (c.target === entId) tl.removeConstraint(c.id);
  }

  /** 尺寸 / 缩放 / 时长变化后重新排版：内容宽度、标尺、播放头、行内元素位置。 */
  _layout() {
    if (this.collapsed) return;
    const vis = Math.max(0, this.scroll.clientWidth - NAME_W);
    if (this.fit) this.pps = this._fitPps();
    const { duration } = this.app.timeline;
    this.content.style.width = NAME_W + GUTTER + duration * this.pps + PAD_R + 'px';
    this.content.style.setProperty('--pps', this.pps);
    this.content.style.setProperty('--dur', duration);
    this.ruler.resize(vis, RULER_H);
    this.scrollLeft = this.scroll.scrollLeft;
    this._drawRuler();
    this._placePlayhead(this.app.playback.time);
    this.emit('layout');
  }

  _fitPps() {
    const vis = Math.max(1, this.scroll.clientWidth - NAME_W - GUTTER - PAD_R);
    return Math.max(1, vis / this.app.timeline.duration);
  }

  _drawRuler() {
    if (this._rulerPending) return;
    this._rulerPending = true;
    requestAnimationFrame(() => { this._rulerPending = false; this.ruler.draw(); });
  }

  // ---- 坐标换算 ----
  /** 时刻 → 内容坐标 x（含左侧名列）。 */
  timeToX(t) { return NAME_W + GUTTER + t * this.pps; }

  /** 视口 clientX → 时刻（未夹取）。 */
  clientXToTime(clientX) {
    const r = this.scroll.getBoundingClientRect();
    return (clientX - r.left + this.scroll.scrollLeft - NAME_W - GUTTER) / this.pps;
  }

  /** 吸附开启时按帧取整。 */
  snapTime(t) { return this.snap ? this.app.playback.snap(t) : t; }

  clampTime(t) { return Math.min(Math.max(t, 0), this.app.timeline.duration); }

  // ---- 播放头 ----
  _placePlayhead(t) {
    const x = this.timeToX(t);
    this.phHead.style.transform = `translateX(${x}px)`;
    this.phLine.style.transform = `translateX(${x}px)`;
  }

  _onTick(t) {
    this.transport.reflectTime(t);
    if (this.collapsed) return;
    this._placePlayhead(t);
    if (this.app.playback.playing) this._follow(t);
  }

  /** 播放时播放头跑出可见区则翻页。 */
  _follow(t) {
    const x = GUTTER + t * this.pps;
    const vis = this.scroll.clientWidth - NAME_W;
    if (x < this.scroll.scrollLeft || x > this.scroll.scrollLeft + vis - 8) this.scroll.scrollLeft = Math.max(0, x - 8);
  }

  /** 让某元素成为"拖播放头"的把手：按下即跳转，拖动跟随；吸附开启时按帧取整。 */
  bindScrub(node) {
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const pb = this.app.playback;
      if (pb.playing) pb.pause();
      const go = (ev) => this.seek(this.clientXToTime(ev.clientX));
      go(e);
      node.setPointerCapture(e.pointerId);
      const move = (ev) => go(ev);
      const up = () => {
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', up);
        node.removeEventListener('pointercancel', up);
      };
      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', up);
      node.addEventListener('pointercancel', up);
    });
  }

  // ---- 命令 ----
  seek(t) { this.app.playback.seek(this.clampTime(this.snapTime(t))); }

  /** 前后 n 帧（落在帧格上）。 */
  stepFrames(n) {
    const { fps } = this.app.timeline;
    const f = Math.round(this.app.playback.time * fps) + n;
    this.app.playback.seek(this.clampTime(f / fps));
  }

  togglePlay() {
    const pb = this.app.playback;
    if (pb.playing) pb.pause(); else pb.play();
  }

  setPref(key, value) {
    if (key === 'loop') this.app.playback.loop = value;
    else this[key] = value;
    this._savePrefs();
    this.transport.reflectPrefs();
    this.emit('prefs');
  }

  _savePrefs() {
    savePrefs({ collapsed: this.collapsed, autoKey: this.autoKey, snap: this.snap, loop: this.app.playback.loop });
  }

  toggleCollapsed() { this.setCollapsed(!this.collapsed); }

  setCollapsed(v, { save = true } = {}) {
    this.collapsed = v;
    this.container.classList.toggle('collapsed', v);
    if (save) this._savePrefs();
    this.transport.reflectPrefs();
    if (!v) requestAnimationFrame(() => this._layout());
    this.emit('collapse', v);
  }

  // ---- 事件 ----
  _onTimelineChange() {
    const pb = this.app.playback;
    const { duration } = this.app.timeline;
    // 时长变短 / 导入 / 撤销后：播放头夹到新时长内
    if (pb.time > duration) {
      if (this.app.timeline.active) pb.seek(duration);
      else pb.time = duration;
    }
    this.transport.reflectTimeline();
    this._layout();
    this.rebuild();
  }

  /** ⌘ / Ctrl + 滚轮缩放（以光标处时刻为锚点）；普通滚轮交给浏览器滚动。 */
  _onWheel(e) {
    if (!(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    const r = this.scroll.getBoundingClientRect();
    const anchorT = this.clientXToTime(e.clientX);
    const minPps = this._fitPps();
    const pps = Math.min(MAX_PPS, Math.max(minPps, this.pps * Math.exp(-e.deltaY * 0.0025)));
    this.fit = pps <= minPps + 1e-6;
    this.pps = pps;
    this._layout();
    this.scroll.scrollLeft = Math.max(0, NAME_W + GUTTER + anchorT * pps - (e.clientX - r.left));
  }

  _onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
    const pb = this.app.playback;
    let handled = true;
    switch (e.key) {
      case ' ': this.togglePlay(); break;
      case 'ArrowLeft': if (e.shiftKey) this.seek(pb.time - 1); else this.stepFrames(-1); break;
      case 'ArrowRight': if (e.shiftKey) this.seek(pb.time + 1); else this.stepFrames(1); break;
      case 'Home': this.seek(0); break;
      case 'End': this.seek(this.app.timeline.duration); break;
      case 'Escape': if (this.app.timeline.active) pb.stop(); else handled = false; break;
      default: handled = this.handleKey?.(e) || false;
    }
    if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
  }
}
