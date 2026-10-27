import { el, isTyping, toastError } from '../../util/dom.js';
import { Emitter } from '../../util/Emitter.js';
import { nameWidth, GUTTER } from './layout.js';
import { Transport } from './Transport.js';
import { Ruler } from './Ruler.js';
import { TrackRows, keyId, PROP_LABEL, CAMERA_PROP_LABEL } from './TrackRows.js';
import { dragKeys, dragBar } from './keyDrag.js';
import { popupMenu } from '../popupMenu.js';
import { toggleKey, propState } from './animState.js';
import { onKey, KEY_PRIORITY } from '../../util/keys.js';

const RULER_H = 30;
const PAD_R = 44;            // 时长之后留白（末尾的键 / 播放头不贴边）
const MAX_PPS = 1500;        // 最大缩放（px / 秒）
const PREF_KEY = 'director-stage.timeline';

/** 会话偏好（高度 / 折叠 / 自动打键 / 吸附 / 循环）：只存 localStorage，不进场景文档。 */
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* 隐私模式等：忽略 */ }
}


/**
 * 底部时间轴面板。
 * - 面板不持有文档状态：行在 timeline 'change' 时按 toJSON() 重建；写操作一律走 timeline API。
 * - 播放头在 playback 'tick' 时只改 transform，不重建行。
 * 事件：'collapse'(bool)。
 */
export class TimelinePanel extends Emitter {
  constructor(container, app) {
    super();
    this.app = app;
    this.container = container;
    this.nameWidth = nameWidth(container.clientWidth);
    const tl = app.timeline, pb = app.playback;

    const prefs = loadPrefs();
    this.collapsed = true; // 每次进入页面先收起，不沿用上次展开状态。
    this.height = Number.isFinite(prefs.height) ? prefs.height : null;
    this.autoKey = !!prefs.autoKey;
    app.autoKey = this.autoKey;
    this.snap = prefs.snap ?? true;
    pb.loop = prefs.loopDefaultVersion === 1 ? (prefs.loop ?? true) : true;
    if (prefs.loopDefaultVersion !== 1) savePrefs({ ...prefs, loop: true, loopDefaultVersion: 1 });

    this.pps = 100;          // px / 秒
    this.fit = true;
    this.scrollLeft = 0;
    this.selKeys = new Set(); // 选中的关键帧（keyId）

    this._build();
    if (this.height !== null) this.setHeight(this.height);
    this.setCollapsed(this.collapsed, { save: false });

    tl.on('change', () => this._onTimelineChange());
    pb.on('tick', (t) => this._onTick(t));
    pb.on('state', () => this.transport.reflectState());
    app.on('entities', () => { this.transport.reflectCameras(); this.rebuild(); }); // 改名 / 删除
    // 选择只更新行状态，不能在 pointerdown 中移除即将拖动的条/关键帧。
    app.on('selection', () => { this.applySelection(); this.trackRows.reflectValues(); });
    app.on('transform', () => this.trackRows.reflectValues());
    app.on('motionSelection', ref => {
      this.selKeys = ref?.kind === 'pos' && ref.keyTime != null ? new Set([keyId(ref.sourceId, ref.keyTime)]) : new Set();
      this.applySelection(); this.trackRows.reflectValues();
    });
    app.on('motionFocus', ref => {
      const source = app.pathEditor.source(ref);
      if (this.trackRows._folded(source.target)) {
        this.trackRows.collapsedEnts.delete(source.target); this.trackRows.expandedEnts.add(source.target); this.rebuild();
      }
      queueMicrotask(() => {
        if (this.collapsed) return;
        const selector = ref.kind === 'path' ? `[data-node-path="${ref.sourceId}"][data-node-index="${ref.arrival === 'end' ? source.points.length : ref.index}"]` : `.tl-key[data-track="${ref.sourceId}"][data-t="${ref.keyTime}"]`;
        this.rows.querySelector(selector)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    });
    app.on('motionPreview', preview => {
      if (preview?.ref.kind === 'path') {
        const model = app.timeline.pathModel(preview.source);
        for (const node of this.rows.querySelectorAll(`[data-node-path="${preview.ref.sourceId}"]`)) {
          const t = model.vertexTime(+node.dataset.nodeIndex);
          node.style.setProperty('--t', t); node.dataset.time = t;
        }
      } else if (!preview) {
        for (const node of this.rows.querySelectorAll('[data-node-path]')) {
          const path = app.timeline.paths.find(p => p.id === node.dataset.nodePath);
          if (path) { const t = app.timeline.pathModel(path).vertexTime(+node.dataset.nodeIndex); node.style.setProperty('--t', t); node.dataset.time = t; }
        }
      }
    });
    app.pathTool.on('commit', (path) => {
      this.trackRows.collapsedEnts.delete(path.target);
      this.trackRows.expandedEnts.add(path.target);
      this.rebuild();
    });
    onKey((e) => this._onKey(e), { priority: KEY_PRIORITY.timeline }); // 先于全局快捷键（Del 删键而非删实体）
    // 点面板以外的地方 = 取消选键（之后 Del 删的是实体而不是键）
    window.addEventListener('pointerdown', (e) => {
      const motion = e.target === app.stage.renderer.domElement && (app.gizmo.hitTest(e.clientX, e.clientY) || app.pathOverlay.hitTest(e.clientX, e.clientY));
      if (this.selKeys.size && !motion && !this.container.contains(e.target) && !e.target.closest?.('.tl-menu')) { this.selKeys.clear(); this.applySelection(); }
    }, true);
    new ResizeObserver(() => this._layout()).observe(this.scroll);
    new ResizeObserver(() => this._syncWorkspaceInset()).observe(this.container);
    window.addEventListener('resize', () => { if (this.height !== null) this.setHeight(this.height); });
  }

  // ---- DOM ----
  _build() {
    this.transport = new Transport(this);
    this.ruler = new Ruler(this);
    this.trackRows = new TrackRows(this);
    this.phHead = el('div', { class: 'tl-ph-head', title: '播放头：拖动查看不同时间的画面' });
    this.bindScrub(this.phHead);
    this.corner = el('div', { class: 'tl-corner', style: { width: this.nameWidth + 'px' } });
    this.corner.appendChild(el('span', { class: 'tl-column-title', text: '对象 / 动画' }));
    this.rulerRow = el('div', { class: 'tl-ruler-row', style: { height: RULER_H + 'px' } }, [this.corner, this.ruler.canvas, this.phHead]);
    this.rows = el('div', { class: 'tl-rows' });
    this.phLine = el('div', { class: 'tl-ph-line' });
    this.content = el('div', { class: 'tl-content' }, [this.rulerRow, this.rows, this.phLine]);
    this.scroll = el('div', { class: 'tl-scroll' }, [this.content]);
    this.scroll.style.setProperty('--name-w', this.nameWidth + 'px');
    this.scroll.style.setProperty('--gutter', GUTTER + 'px');
    this.scroll.addEventListener('scroll', () => { this.scrollLeft = this.scroll.scrollLeft; this._drawRuler(); });
    this.scroll.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    this.rows.addEventListener('pointerdown', (e) => this._onRowsPointer(e));
    this.rows.addEventListener('dblclick', (e) => this._onRowsDblClick(e));
    this.rows.addEventListener('contextmenu', (e) => this._onRowsContext(e));
    this.dragTip = el('div', { class: 'tl-dragtip' });
    document.body.appendChild(this.dragTip);
    const toolbar = el('div', { class: 'tl-toolbar' }, [this.transport.el, this.transport.tools]);
    this.resizeHandle = el('div', {
      class: 'tl-resize-handle', role: 'separator', tabindex: '0', 'aria-orientation': 'horizontal',
      'aria-label': '调整时间轴高度', title: '上下拖动调整时间轴高度 · 双击还原',
    });
    this.resizeHandle.addEventListener('pointerdown', (e) => this._beginResize(e));
    this.resizeHandle.addEventListener('dblclick', () => this.resetHeight());
    this.resizeHandle.addEventListener('keydown', (e) => {
      const [min, max] = this._heightBounds();
      const height = this.container.getBoundingClientRect().height;
      if (e.key === 'ArrowUp') this.setHeight(height + 24);
      else if (e.key === 'ArrowDown') this.setHeight(height - 24);
      else if (e.key === 'Home') this.setHeight(min);
      else if (e.key === 'End') this.setHeight(max);
      else return;
      e.preventDefault(); e.stopPropagation(); this._savePrefs();
    });
    this.container.replaceChildren(this.resizeHandle, toolbar, this.scroll);
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
    this.applySelection();
    this.trackRows.reflectValues();
  }

  /** 选中联动：选中实体的行高亮；选中键高亮。 */
  applySelection() {
    const alive = this.selectedAnimation && this.rows.querySelector(`[data-${this.selectedAnimation.kind}="${this.selectedAnimation.id}"]`);
    if (!alive || !this.app.selectedIds.has(alive.dataset.ent)) this.selectedAnimation = null;
    this.reflectTrackAction();
    const sel = this.app.selectedIds;
    for (const row of this.rows.querySelectorAll('.tl-row')) {
      row.classList.toggle('sel', row.classList.contains('tl-head') && sel.has(row.dataset.ent));
      row.classList.toggle('current', this.currentRow === `${row.dataset.ent}/${row.dataset.propertyRow}`);
    }
    for (const k of this.rows.querySelectorAll('.tl-key')) k.classList.toggle('sel', this.selKeys.has(keyId(k.dataset.track, k.dataset.t)));
  }

  /** 行区按下：键 = 选键（⇧ 多选）并可拖动；区间条 = 拖动；行其它位置 = 选中实体。 */
  _onRowsPointer(e) {
    if (e.button !== 0) return;
    const current = e.target.closest('.tl-track');
    this.currentRow = current ? `${current.dataset.ent}/${current.dataset.propertyRow}` : null;
    this.applySelection();
    const key = e.target.closest('.tl-key');
    if (key) { // 不 preventDefault：那会吞掉 mousedown，dblclick 就不再触发（user-select:none 已防选中文字）
      const id = keyId(key.dataset.track, key.dataset.t);
      const wasSel = this.selKeys.has(id);
      if (e.shiftKey) { if (wasSel) this.selKeys.delete(id); else this.selKeys.add(id); }
      else if (!wasSel) { this.selKeys.clear(); this.selKeys.add(id); }
      // 切换实体会清理旧空间节点；时间轴已选键由本次指针操作保留。
      const keys = this.selKeys;
      this._selectEntityOf(key);
      this.selKeys = keys;
      this.applySelection();
      this.syncMotionKey();
      if (this.selKeys.has(id)) dragKeys(this, e, key, { collapseOnClick: wasSel && this.selKeys.size > 1 });
      return;
    }
    const bar = e.target.closest('.tl-bar');
    if (bar) {
      this._selectEntityOf(bar);
      dragBar(this, e, bar, e.target.dataset.edge || 'mid');
      return;
    }
    if (e.target.closest('button, .tl-caret')) return;
    const row = e.target.closest('.tl-row');
    if (!e.shiftKey) this.selKeys.clear();
    if (row) this._selectEntityOf(row);
    this.applySelection();
  }

  syncMotionKey() {
    if (this.selKeys.size === 1) {
      const id = [...this.selKeys][0], at = id.lastIndexOf('@');
      const tr = this.app.timeline.tracks.find(t => t.id === id.slice(0, at));
      if (tr?.property === 'pos') {
        this.app.pathEditor.selectNode({ kind: 'pos', sourceId: tr.id, keyTime: +id.slice(at + 1) });
        return;
      }
    }
    // Multi-key selection belongs to the timeline; do not mutate that set via motionSelection.
    const keys = this.selKeys;
    this.app.pathOverlay.setSelectedVertex(null);
    this.selKeys = keys; this.applySelection();
  }

  /** 双击：键 = 选 ease；路径 / 约束条 = 打开 Inspector 对应段。 */
  _onRowsDblClick(e) {
    const key = e.target.closest('.tl-key');
    if (key) {
      const k = this._keyData(key);
      if (!k) return;
      const ease = (name, label) => ({
        label, checked: k.ease === name,
        onClick: () => { try { this.app.timeline.setKey(k.trackId, k.t, k.value, name); } catch (err) { toastError(err); } },
      });
      popupMenu(e.clientX, e.clientY, [ease('linear', '线性 linear'), ease('smooth', '缓入缓出 smooth'), ease('step', '阶跃 step')]);
      return;
    }
    const bar = e.target.closest('.tl-bar');
    if (bar) {
      const ent = bar.closest('.tl-row').dataset.ent;
      this.app.emit('inspect', { id: ent, section: bar.dataset.kind, constraintId: bar.dataset.kind === 'constraint' ? bar.dataset.id : undefined });
    }
  }

  /** 右键：轨道行 → 删除轨道 / 清空键；路径 / 约束行 → 删除。 */
  _onRowsContext(e) {
    const row = e.target.closest('.tl-track');
    if (!row) return;
    e.preventDefault();
    this._selectEntityOf(row);
    const tl = this.app.timeline;
    const run = (fn) => () => { try { fn(); } catch (err) { toastError(err); } };
    const { track, path, constraint } = row.dataset;
    let items;
    if (track) {
      const data = tl.toJSON().timeline.tracks.find((t) => t.id === track);
      if (!data) return;
      items = [
        { label: `删除轨道（${(this.app.findEntity(data.target)?.type === 'camera' ? CAMERA_PROP_LABEL : PROP_LABEL)[data.property]}）`, onClick: run(() => tl.removeTrack(track)) },
        { label: '清空键', disabled: !data.keys.length, onClick: run(() => { for (const k of data.keys) tl.removeKey(track, k.t); }) },
      ];
    } else if (path) items = [{ label: '删除路径', onClick: run(() => tl.removePath(path)) }];
    else if (constraint) items = [{ label: '删除约束', onClick: run(() => tl.removeConstraint(constraint)) }];
    if (items) popupMenu(e.clientX, e.clientY, items);
  }

  /** 键元素 → 文档里的键 { trackId, t, value, ease }。 */
  _keyData(node) {
    const tr = this.app.timeline.toJSON().timeline.tracks.find((t) => t.id === node.dataset.track);
    const k = tr?.keys.find((x) => String(x.t) === node.dataset.t);
    return k ? { trackId: tr.id, ...k } : null;
  }

  /** 删除选中的键（一次撤销）。 */
  deleteSelectedKeys() {
    const tl = this.app.timeline;
    const ids = [...this.selKeys];
    this.selKeys.clear();
    try {
      for (const id of ids) {
        const at = id.lastIndexOf('@');
        tl.removeKey(id.slice(0, at), +id.slice(at + 1));
      }
    } catch (err) { toastError(err); }
  }

  /** 面板级快捷键（由 _onKey 在播放类快捷键之后调用），返回是否已处理。 */
  handleKey(e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.app.pathEditor.timelineFocus) {
      if (this.selKeys.size) { this.deleteSelectedKeys(); return true; }
      return !!this.app.pathEditor.ref;
    }
    return false;
  }

  /** 拖动中的时刻提示（t = null 隐藏）。 */
  showDragTime(t, clientX) {
    if (t == null) { this.dragTip.style.display = 'none'; return; }
    const r = this.scroll.getBoundingClientRect();
    this.dragTip.textContent = t.toFixed(2) + 's';
    this.dragTip.style.display = 'block';
    this.dragTip.style.left = clientX + 'px';
    this.dragTip.style.top = r.top + 2 + 'px';
  }

  _selectEntityOf(node) {
    const row = node.closest('.tl-row');
    this.selectedAnimation = null;
    for (const kind of ['track', 'path', 'constraint']) {
      if (row?.dataset[kind]) this.selectedAnimation = { kind, id: row.dataset[kind] };
    }
    this.reflectTrackAction();
    const id = row?.dataset.ent;
    if (id && this.app.findEntity(id)) this.app.select(id, { user: true, preservePathEditing: true });
  }

  /** 删除某实体的全部动画（轨道 / 路径 / 以它为对象的约束），一次撤销。 */
  removeAllAnimation(entId) {
    const tl = this.app.timeline;
    const { timeline, paths, constraints } = tl.toJSON();
    this.app.store.batch('删除全部动画', () => {
    for (const t of timeline.tracks) if (t.target === entId) tl.removeTrack(t.id);
    for (const p of paths) if (p.target === entId) tl.removePath(p.id);
    for (const c of constraints) if (c.target === entId) tl.removeConstraint(c.id);
    });
  }

  reflectTrackAction() {
    const b = this.transport.removeBtn;
    b.disabled = !this.app.selected;
    b.textContent = this.selectedAnimation ? '－ 移除轨道' : '＋ 新建轨道';
    b.title = this.selectedAnimation ? '移除选中的动画轨道或路径（保留实体）' : '为选中对象新建轨道';
  }

  addTrackMenu(event) {
    const ent = this.app.selected;
    if (!ent) return;
    const properties = ent.type === 'camera' ? ['pos', 'rot', 'fov'] : ['pos', 'rot', 'scale'];
    popupMenu(event.clientX, event.clientY, properties.map(property => {
      const state = propState(this.app, this.app.timeline.view(), ent.id, property, this.app.playback.time);
      return { label: (ent.type === 'camera' ? CAMERA_PROP_LABEL : PROP_LABEL)[property], disabled: !!state.forced || !!state.track, onClick: () => {
        try { toggleKey(this.app, ent, property); this.trackRows.collapsedEnts.delete(ent.id); this.trackRows.expandedEnts.add(ent.id); this.rebuild(); } catch (err) { toastError(err); }
      } };
    }));
  }

  removeSelectedAnimation() {
    const selected = this.selectedAnimation;
    if (!selected) return;
    const method = { track: 'removeTrack', path: 'removePath', constraint: 'removeConstraint' }[selected.kind];
    this.app.timeline[method](selected.id);
    this.selectedAnimation = null;
    this.reflectTrackAction();
  }

  /** 尺寸 / 缩放 / 时长变化后重新排版：内容宽度、标尺、播放头、行内元素位置。 */
  _layout() {
    this.nameWidth = nameWidth(this.container.clientWidth);
    this.corner.style.width = this.nameWidth + 'px';
    this.scroll.style.setProperty('--name-w', this.nameWidth + 'px');
    if (this.collapsed) return;
    const [minHeight, maxHeight] = this._heightBounds();
    this.resizeHandle.setAttribute('aria-valuemin', String(minHeight));
    this.resizeHandle.setAttribute('aria-valuemax', String(Math.round(maxHeight)));
    this.resizeHandle.setAttribute('aria-valuenow', String(Math.round(this.container.getBoundingClientRect().height)));
    const vis = Math.max(0, this.scroll.clientWidth - this.nameWidth);
    if (this.fit) this.pps = this._fitPps();
    this.transport.zoom.value = 100 * Math.log(this.pps / this._fitPps()) / Math.log(MAX_PPS / this._fitPps());
    const { duration } = this.app.timeline;
    this.content.style.width = this.nameWidth + GUTTER + duration * this.pps + PAD_R + 'px';
    this.content.style.setProperty('--pps', this.pps);
    this.content.style.setProperty('--dur', duration);
    this.ruler.resize(Math.max(1, vis), RULER_H);
    this.scrollLeft = this.scroll.scrollLeft;
    this._drawRuler();
    this._placePlayhead(this.app.playback.time);
    this.emit('layout');
  }

  _fitPps() {
    const vis = Math.max(1, this.scroll.clientWidth - this.nameWidth - GUTTER - PAD_R);
    return Math.max(1, vis / this.app.timeline.duration);
  }

  _drawRuler() {
    if (this._rulerPending) return;
    this._rulerPending = true;
    requestAnimationFrame(() => { this._rulerPending = false; this.ruler.draw(); });
  }

  // ---- 坐标换算 ----
  /** 时刻 → 内容坐标 x（含左侧名列）。 */
  timeToX(t) { return this.nameWidth + GUTTER + t * this.pps; }

  /** 视口 clientX → 时刻（未夹取）。 */
  clientXToTime(clientX) {
    const r = this.scroll.getBoundingClientRect();
    return (clientX - r.left + this.scroll.scrollLeft - this.nameWidth - GUTTER) / this.pps;
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
    this.trackRows.reflectValues();
    if (this.app.playback.playing) this._follow(t);
  }

  /** 播放时播放头跑出可见区则翻页。 */
  _follow(t) {
    const x = GUTTER + t * this.pps;
    const vis = this.scroll.clientWidth - this.nameWidth;
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
    if (pb.playing) pb.pause(); else this.app.startPreview();
  }

  setPref(key, value) {
    if (key === 'loop') this.app.playback.loop = value;
    else this[key] = value;
    if (key === 'autoKey') this.app.autoKey = value;
    this._savePrefs();
    this.transport.reflectPrefs();
    this.emit('prefs');
  }

  _savePrefs() {
    savePrefs({ height: this.height, autoKey: this.autoKey, snap: this.snap, loop: this.app.playback.loop, loopDefaultVersion: 1 });
  }

  _heightBounds() { return [160, Math.max(160, Math.min(window.innerHeight * 0.7, window.innerHeight - 220))]; }

  // 时间轴覆盖底部画布，只给工具栏和侧栏预留空间，不改变 WebGL 视口尺寸。
  _syncWorkspaceInset() {
    const height = this.collapsed ? 0 : this.container.getBoundingClientRect().height;
    if (this._workspaceInset === height) return;
    this._workspaceInset = height;
    this.container.parentElement.style.setProperty('--timeline-visible-height', `${height}px`);
  }

  setHeight(height) {
    const [min, max] = this._heightBounds();
    this.height = Math.round(Math.min(max, Math.max(min, height)));
    this.container.style.setProperty('--timeline-height', `${this.height}px`);
    this.resizeHandle.setAttribute('aria-valuemin', String(min));
    this.resizeHandle.setAttribute('aria-valuemax', String(Math.round(max)));
    this.resizeHandle.setAttribute('aria-valuenow', String(this.height));
    this._syncWorkspaceInset();
    this._layout();
  }

  resetHeight() {
    this.height = null;
    this.container.style.removeProperty('--timeline-height');
    this.resizeHandle.removeAttribute('aria-valuenow');
    this._syncWorkspaceInset();
    this._savePrefs(); this._layout();
  }

  _beginResize(e) {
    if (e.button !== 0 || this.collapsed) return;
    e.preventDefault(); e.stopPropagation();
    const start = { y: e.clientY, height: this.container.getBoundingClientRect().height, saved: this.height };
    const handle = this.resizeHandle;
    handle.setPointerCapture(e.pointerId);
    this.container.classList.add('resizing');
    document.body.classList.add('resizing-timeline');
    const move = (event) => this.setHeight(start.height + start.y - event.clientY);
    const end = (event) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      this.container.classList.remove('resizing');
      document.body.classList.remove('resizing-timeline');
      if (event.type === 'pointercancel') {
        if (start.saved === null) this.resetHeight(); else this.setHeight(start.saved);
      } else this._savePrefs();
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  toggleCollapsed() { this.setCollapsed(!this.collapsed); }

  setCollapsed(v, { save = true } = {}) {
    this.collapsed = v;
    this.container.classList.toggle('collapsed', v);
    this._syncWorkspaceInset();
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
    this.setZoom(this.pps * Math.exp(-e.deltaY * 0.0025), e.clientX);
  }

  setZoom(value, clientX = this.scroll.getBoundingClientRect().left + this.nameWidth + GUTTER) {
    const r = this.scroll.getBoundingClientRect();
    const anchorT = this.clientXToTime(clientX);
    const minPps = this._fitPps();
    this.pps = Math.min(MAX_PPS, Math.max(minPps, value));
    this.fit = this.pps <= minPps + 1e-6;
    this._layout();
    this.scroll.scrollLeft = Math.max(0, this.nameWidth + GUTTER + anchorT * this.pps - (clientX - r.left));
  }

  _onKey(e) {
    if (e.target.closest?.('.ai-capsule, .ctxmenu, .tl-resize-handle')) return;
    if ([' ', 'Enter'].includes(e.key) && e.target.closest?.('.tl-key, .tl-path-node')) return;
    if (!this.app.ready || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
    const pb = this.app.playback;
    let handled = true;
    switch (e.key) {
      case ' ': this.togglePlay(); break;
      case 'ArrowLeft': if (e.shiftKey) this.seek(pb.time - 1); else this.stepFrames(-1); break;
      case 'ArrowRight': if (e.shiftKey) this.seek(pb.time + 1); else this.stepFrames(1); break;
      case 'Home': this.seek(0); break;
      case 'End': this.seek(this.app.timeline.duration); break;
      case 'Escape': if (this.app.timeline.active) this.app.stopPreview(); else handled = false; break;
      default: handled = this.handleKey(e);
    }
    if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
  }
}
