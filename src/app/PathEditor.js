import { el, toast, toastError, isTyping, CLICK_PX } from '../util/dom.js';
import { stopsAfterInsert, stopsAfterDelete } from '../anim/pathGen.js';
import { round4 } from '../util/math.js';
import { onKey, KEY_PRIORITY } from '../util/keys.js';


/**
 * 两层选择：选实体只显示轨迹线；点线选中轨迹，显示顶点 / 箭头并隐藏实体 gizmo。
 * 单击线只选中；双击线插点；拖点编辑，⇧ 拖点整体平移。预览不写文档，松手提交一次撤销。
 * Backspace 删除整条轨迹；Delete 删除选中顶点（未选顶点则删轨迹）；Esc 取消拖动或退出编辑。
 */
export class PathEditor {
  constructor(app) {
    this.app = app;
    this.drag = null;          // { pathId, index, orig, offset, all, moved, points }
    this._pathDeleteHeld = false; // 长按删除轨迹后，不让重复按键误删人物
    this._consumed = false;    // 本次按下落在路径元素上：视口点选跳过
    this._lineDown = null;     // 按下在曲线上：{ hit, x, y }，松手不动才算点击

    const dom = app.stage.renderer.domElement;
    this.dom = dom;
    // 捕获阶段：先于 TransformControls / OrbitControls（同一元素上捕获监听先执行）
    dom.addEventListener('pointerdown', (e) => this._onDown(e), true);
    dom.addEventListener('pointermove', (e) => this._onMove(e));
    dom.addEventListener('pointerup', (e) => this._onUp(e), true);
    dom.addEventListener('dblclick', (e) => this._onDoubleClick(e));
    dom.addEventListener('pointercancel', () => { this._lineDown = null; if (this.drag) this._endDrag(); });
    dom.addEventListener('pointerleave', () => { if (!this.drag) this._setHover(null); });
    onKey((e) => this._onEscape(e), { priority: KEY_PRIORITY.pathDrag });                  // 拖动中 Esc：先于时间轴的 Esc = 停止
    window.addEventListener('keyup', e => { if (['Delete', 'Backspace'].includes(e.key)) this._pathDeleteHeld = false; });
    window.addEventListener('blur', () => { this._pathDeleteHeld = false; });
    onKey((e) => this._onDelete(e), { priority: KEY_PRIORITY.pathDrag }); // 轨迹聚焦时先于时间轴和实体删除
    this.barTitle = el('span', { class: 'path-edit-title' });
    this.bar = el('div', { class: 'path-edit-bar', hidden: true, role: 'toolbar', 'aria-label': '轨迹编辑' }, [
      this.barTitle,
      el('span', { class: 'path-edit-help', text: '拖动点调整 · 双击线加点' }),
      el('button', { class: 'path-edit-delete', title: '删除整条轨迹，保留人物（Backspace）', onclick: () => this.deletePath() }, ['删除轨迹 ', el('kbd', { text: '⌫' })]),
      el('button', { class: 'path-edit-done', title: '退出轨迹编辑（Esc）', onclick: () => app.pathOverlay.setSelectedPath(null) }, ['完成 ', el('kbd', { text: 'esc' })]),
    ]);
    app.stage.viewport.appendChild(this.bar);
    const sync = () => this._syncSelection();
    app.on('pathSelection', sync);
    app.on('pathVisibility', sync);
    app.on('selection', sync);
    app.on('view', sync);
    app.pathTool.on('mode', sync);
    // 时间轴接手焦点后，删除键由时间轴处理。
    document.addEventListener('pointerdown', e => {
      if (e.target.closest?.('#timeline')) app.pathOverlay.setSelectedPath(null);
    }, true);
  }

  /** 视口点选是否应跳过（本次按下落在路径元素上 / 正在拖顶点）。 */
  get busy() { return this._consumed || !!this.drag; }

  get _enabled() { return !this.app.cameraView && !this.app.pathTool.mode; }

  _hit(e) { return this._enabled ? this.app.pathOverlay.hitTest(e.clientX, e.clientY) : null; }

  _syncSelection() {
    const ov = this.app.pathOverlay;
    this.bar.hidden = !ov.selectedPathId || !ov.visible || !!this.app.pathTool.mode;
    this.barTitle.textContent = `${this.app.selected?.name || '对象'} · 轨迹`;
    this.app.gizmo.setVisible(!this.drag && !this.app.pathTool.mode && this.app.gizmoShouldShow());
    this.app.selection.setRingVisible(!ov.selectedPathId && !this.app._cleanDepth);
  }

  // ---- 指针 ----
  _onDown(e) {
    this._consumed = false;
    this._lineDown = null;
    if (e.button !== 0 || !this._enabled) return;
    const ov = this.app.pathOverlay;
    const hit = this._hit(e);
    if (hit?.kind === 'vertex') {
      e.stopImmediatePropagation(); // 不让 gizmo / 环绕接手
      e.preventDefault();
      this._consumed = true;
      ov.setSelectedVertex({ pathId: hit.pathId, index: hit.index });
      this._beginDrag(e, hit);
      return;
    }
    ov.setSelectedVertex(null);
    if (hit?.kind === 'line' && (!this.app.gizmo.visible || !this.app.gizmo.overAxis)) {
      this._consumed = true; // 不 stopPropagation：拖动仍是环绕，松手不动才算点线
      this._lineDown = { hit, x: e.clientX, y: e.clientY };
    }
  }

  _beginDrag(e, hit) {
    const json = this.app.timeline.toJSON().paths.find((p) => p.id === hit.pathId);
    if (!json) return;
    const v = json.points[hit.index];
    const g = this.app.pathTool.planePoint(e, v[1]);
    this.drag = {
      pathId: hit.pathId, index: hit.index, orig: json.points, all: e.shiftKey, moved: false,
      offset: g ? [v[0] - g[0], v[2] - g[2]] : [0, 0], x: e.clientX, y: e.clientY, points: json.points,
    };
    this.dom.setPointerCapture(e.pointerId);
  }

  _onMove(e) {
    const d = this.drag;
    if (!d) { if (!e.buttons) this._hoverAt(e); return; }
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) <= CLICK_PX) return;
      d.moved = true;
      this.app.playback.pause(); // 播放中拖动会被逐帧求值覆盖
      this.app.gizmo.setVisible(false);
      this.dom.style.cursor = 'grabbing';
    }
    const v = d.orig[d.index];
    const g = this.app.pathTool.planePoint(e, v[1]);
    if (!g) return;
    const nx = g[0] + d.offset[0], nz = g[2] + d.offset[1];
    if (d.all) {
      const dx = nx - v[0], dz = nz - v[2];
      d.points = d.orig.map((p) => [round4(p[0] + dx), p[1], round4(p[2] + dz)]);
    } else {
      d.points = d.orig.map((p, i) => (i === d.index ? [round4(nx), p[1], round4(nz)] : p));
    }
    this.app.pathOverlay.setPreview(d.pathId, d.points);
  }

  _onUp(e) {
    if (this.drag) {
      const d = this.drag;
      this._endDrag();
      if (d.moved) this._write(d.pathId, { points: d.points });
      return;
    }
    const ld = this._lineDown;
    this._lineDown = null;
    if (!ld || e.button !== 0 || Math.hypot(e.clientX - ld.x, e.clientY - ld.y) > CLICK_PX) return;
    const { hit } = ld;
    if (this.app.selectedId !== hit.target) this.app.select(hit.target); // 点其它实体的路径线 = 选中它
    this.app.playback.pause();
    this.app.pathOverlay.setSelectedPath(hit.pathId);
  }

  _onDoubleClick(e) {
    if (e.button !== 0 || !this._enabled) return;
    const hit = this._hit(e);
    if (hit?.kind === 'line' && this.app.pathOverlay.selectedPathId === hit.pathId) {
      e.preventDefault();
      this.insertAt(hit.pathId, hit.s);
    }
  }

  _endDrag() {
    const d = this.drag;
    this.drag = null;
    this.app.pathOverlay.clearPreview();
    this.app.gizmo.setVisible(this.app.gizmoShouldShow());
    this.dom.style.cursor = '';
    return d;
  }

  _hoverAt(e) {
    const hit = this._hit(e);
    this._setHover(hit);
  }

  _setHover(hit) {
    this.app.pathOverlay.setHover(hit?.kind === 'vertex' ? { pathId: hit.pathId, index: hit.index } : null);
    if (!this.app.pathTool.mode) this.dom.style.cursor = hit?.kind === 'vertex' ? 'grab' : hit ? 'pointer' : '';
  }

  // ---- 键盘 ----
  _onEscape(e) {
    if (e.key !== 'Escape' || isTyping(e.target) || !this._enabled) return;
    if (!this.drag && !this.app.pathOverlay.selectedPathId) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (this.drag) this._endDrag(); // 先取消本次拖动，保留轨迹选择
    else this.app.pathOverlay.setSelectedPath(null);
  }

  _onDelete(e) {
    if (!['Delete', 'Backspace'].includes(e.key) || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || !this._enabled) return;
    const ov = this.app.pathOverlay;
    if (!ov.selectedPathId && !(e.repeat && this._pathDeleteHeld)) return;
    this._pathDeleteHeld = true;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (this.drag || !ov.selectedPathId) return; // 拖动期间不提交删除，长按时不落到实体
    if (e.key === 'Delete' && ov.selVertex) this.deleteVertex(ov.selVertex.pathId, ov.selVertex.index);
    else this.deletePath();
  }

  deletePath() {
    const id = this.app.pathOverlay.selectedPathId;
    if (!id || this.drag) return;
    try {
      this.app.timeline.removePath(id);
      toast('已删除轨迹 · 可用 ⌘Z / Ctrl+Z 撤销');
    } catch (err) { toastError(err); }
  }

  // ---- 编辑命令（selftest 也走这里）----
  /** 在弧长 s 处插入顶点（点在当前曲线上，插在其所在的两个顶点之间）。 */
  insertAt(pathId, s) {
    const json = this.app.timeline.toJSON().paths.find((p) => p.id === pathId);
    const path = this.app.pathOverlay.pathOf(pathId);
    if (!json || !path) return;
    const seg = path.edgeAt(s);
    const p = path.positionAt(s);
    const pts = json.points.slice();
    pts.splice(seg + 1, 0, [round4(p.x), json.points[seg][1], round4(p.z)]);
    if (this._write(pathId, { points: pts, ...stopsAfterInsert(json, seg + 1) })) this.app.pathOverlay.setSelectedVertex({ pathId, index: seg + 1 });
  }

  deleteVertex(pathId, index) {
    const json = this.app.timeline.toJSON().paths.find((p) => p.id === pathId);
    if (!json || !json.points[index]) { this.app.pathOverlay.setSelectedVertex(null); return; }
    if (json.points.length <= 2) { toast('路径至少需要 2 个顶点（Backspace 可删除整条轨迹）'); return; }
    const pts = json.points.filter((_, i) => i !== index);
    this.app.pathOverlay.setSelectedVertex(null);
    this._write(pathId, { points: pts, ...stopsAfterDelete(json, index) });
  }

  _write(pathId, patch) {
    try { this.app.timeline.updatePath(pathId, patch); return true; } catch (err) { toastError(err); return false; }
  }
}
