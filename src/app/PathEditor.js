import * as THREE from 'three';
import { sameKeyTime } from '../anim/keyframes.js';
import { framePlanePoint } from '../core/pathPicking.js';
import { el, toast, toastError, isTyping, CLICK_PX, pointerNDC } from '../util/dom.js';
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
    this.proxy = new THREE.Object3D();
    this.proxy.name = 'MotionPointProxy';
    this.drag = null; // 开始快照、版本、候选来源与指针状态；不写 Store
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
    dom.addEventListener('pointercancel', () => { this._lineDown = null; this.cancel(); });
    dom.addEventListener('pointerleave', () => { if (!this.drag) this._setHover(null); });
    onKey((e) => this._onEscape(e), { priority: KEY_PRIORITY.pathDrag });                  // 拖动中 Esc：先于时间轴的 Esc = 停止
    window.addEventListener('keyup', e => { if (['Delete', 'Backspace'].includes(e.key)) this._pathDeleteHeld = false; });
    window.addEventListener('blur', () => { this._pathDeleteHeld = false; this.cancel(); });
    onKey((e) => this._onDelete(e), { priority: KEY_PRIORITY.pathDrag }); // 轨迹聚焦时先于时间轴和实体删除
    this.barTitle = el('span', { class: 'path-edit-title' });
    this.bar = el('div', { class: 'path-edit-bar', hidden: true, role: 'toolbar', 'aria-label': '轨迹编辑' }, [
      this.barTitle,
      el('span', { class: 'path-edit-help', text: 'XYZ 轴调整高度与位置 · 直接拖点保持高度 · ⇧ 整体平移' }),
      el('button', { class: 'path-edit-delete', title: '删除整条轨迹，保留人物（Backspace）', onclick: () => this.deletePath() }, ['删除轨迹 ', el('kbd', { text: '⌫' })]),
      el('button', { class: 'path-edit-done', title: '退出轨迹编辑（Esc）', onclick: () => app.pathOverlay.setSelectedPath(null) }, ['完成 ', el('kbd', { text: 'esc' })]),
    ]);
    app.stage.viewport.appendChild(this.bar);
    const sync = () => this._syncSelection();
    app.on('pathSelection', sync);
    app.on('motionSelection', () => this._bindPoint());
    app.timeline.on('change', () => {
      if (this.drag && this.source(this.drag.ref) !== this.drag.source) { this.cancel(); toast('动画已变化，已取消本次拖动'); }
      this._bindPoint(); this._syncSelection();
    });
    app.store.on('change', () => { if (this.drag && app.store.revision !== this.drag.revision) { this.cancel(); toast('场景已变化，已取消本次拖动'); } });
    app.playback.on('tick', () => { if (this.hasPoint && !this.drag) app.syncGizmo(); });
    app.on('pathVisibility', sync);
    app.on('selection', sync);
    app.on('view', () => { this.cancel(); sync(); });
    app.pathTool.on('mode', () => { this.cancel(); sync(); });
    // 时间轴接手焦点后，删除键由时间轴处理。
    document.addEventListener('pointerdown', e => {
      this.timelineFocus = !!e.target.closest?.('#timeline, .tl-menu');
    }, true);
  }

  /** 视口点选是否应跳过（本次按下落在路径元素上 / 正在拖顶点）。 */
  get busy() { return this._consumed || !!this.drag; }

  get _enabled() { return !this.app.cameraView && !this.app.pathTool.mode; }

  _hit(e) { return this._enabled ? this.app.pathOverlay.hitTest(e.clientX, e.clientY) : null; }

  get ref() { return this.app.pathOverlay.selection; }
  source(ref = this.ref) { return ref && this.app.pathOverlay.source(ref.sourceId); }
  index(ref = this.ref, source = this.source(ref)) {
    return ref?.kind === 'path' ? ref.index : source?.keys.findIndex(k => sameKeyTime(k.t, ref.keyTime));
  }
  point(ref = this.ref, source = this.source(ref)) {
    const i = this.index(ref, source);
    return ref?.kind === 'path' ? source?.points[i] : source?.keys[i]?.value;
  }
  nodeTime(ref = this.ref, source = this.source(ref)) {
    return ref.kind === 'path' ? this.app.timeline.pathModel(source).vertexTime(ref.arrival === 'end' ? source.points.length : ref.index) : ref.keyTime;
  }
  get hasPoint() { return !!this.point(); }

  selectNode(ref) {
    const source = this.source(ref);
    if (!source || !this.point(ref, source)) return false;
    if (!this.app.pathOverlay.editable(source, this.nodeTime(ref, source))) { toast('位置受跟随控制，不能编辑运动节点'); return false; }
    if (JSON.stringify(ref) === JSON.stringify(this.ref) && !this.app.playback.playing && this.app.timeline.active && sameKeyTime(this.app.playback.time, this.nodeTime(ref, source))) return true;
    this.cancel();
    if (this.app.selectedId !== source.target) this.app.select(source.target);
    this.app.playback.pause();
    this.app.pathOverlay.setSelectedPath(source.id);
    this.app.pathOverlay.setSelection({ ...ref });
    this.app.playback.seek(this.nodeTime(ref, source));
    this.app.emit('motionFocus', ref);
    return true;
  }

  _bindPoint() {
    if (this.drag) return;
    const source = this.source(), point = this.point();
    if (this.ref && (this.ref.index != null || this.ref.keyTime != null) && !point) {
      this.app.pathOverlay.setSelectedVertex(null); return;
    }
    if (this.hasPoint && !this.app.pathOverlay.editable(source, this.nodeTime(this.ref, source))) {
      this.app.pathOverlay.setSelectedVertex(null); return;
    }
    if (point) {
      const parent = this.app.findEntity(source.target)?.root.parent;
      parent?.add(this.proxy);
      this.proxy.position.fromArray(point);
      this.proxy.updateMatrixWorld(true);
    } else this.proxy.removeFromParent();
    this.app.syncGizmo();
  }

  _syncSelection() {
    if (this.drag && this.ref?.sourceId !== this.drag.ref.sourceId) this.cancel();
    const ov = this.app.pathOverlay;
    this.bar.hidden = !ov.selectedPathId || !ov.visible || !!this.app.pathTool.mode;
    const forced = this.source() && !ov.editable(this.source());
    this.barTitle.textContent = `${this.app.selected?.name || '对象'} · ${forced ? '受跟随控制（不可编辑）' : this.ref?.kind === 'pos' ? '位置关键帧' : '轨迹'}`;
    this.app.syncGizmo();
    this.app.selection.setRingVisible(!ov.selectedPathId && !this.app._cleanDepth);
  }

  /** One transaction for either direct dragging or the shared TransformControls. */
  begin(kind, all = false) {
    if (!this.hasPoint || this.drag) return;
    this.app.playback.pause();
    const source = this.source();
    this.drag = { kind, ref: { ...this.ref }, source, revision: this.app.store.revision,
      time: this.app.playback.time, active: this.app.timeline.active, all,
      orig: this.app.pathOverlay.points(source), index: this.index(), candidate: source, moved: false };
    this.app.rig.controls.enabled = false;
    return this.drag;
  }

  onGizmoDrag(dragging, cancelled) {
    if (dragging) { const d = this.begin('gizmo', this._shiftDown); if (d) Object.assign(d, this._pointerDown); }
    else if (cancelled) this.cancel();
    else this.finish();
  }

  onGizmoChange() {
    if (this.drag?.kind === 'gizmo' && this.drag.pointerMoved) this.candidate(this.proxy.position.toArray());
  }

  candidate(value) {
    const d = this.drag;
    if (!d || !value.every(Number.isFinite)) return;
    const original = d.orig[d.index], delta = value.map((v, i) => v - original[i]);
    const points = d.orig.map((p, i) => i === d.index || d.all ? p.map((v, n) => Math.abs(delta[n]) < 1e-7 ? v : round4(v + delta[n])) : p);
    if (!points.every(p => p.every(Number.isFinite))) return;
    d.moved = points.some((p, i) => p.some((v, n) => Math.abs(v - d.orig[i][n]) > 1e-6));
    d.candidate = d.ref.kind === 'path' ? { ...d.source, points } : { ...d.source, keys: d.source.keys.map((k, i) => ({ ...k, value: points[i] })) };
    if (!this._frame) this._frame = requestAnimationFrame(() => { this._frame = null; this.preview(); });
  }

  flushPreview() {
    if (!this._frame) return;
    cancelAnimationFrame(this._frame); this._frame = null;
    this.preview();
  }

  preview() {
    const d = this.drag;
    if (!d) return;
    this.proxy.position.fromArray(this.point(d.ref, d.candidate));
    this.app.pathOverlay.setPreview(d.ref.sourceId, d.candidate);
    this.app.playback.seek(this.nodeTime(d.ref, d.candidate), { kind: d.ref.kind, source: d.candidate });
    this.app.emit('motionPreview', { ref: d.ref, source: d.candidate });
  }

  _clearDrag() {
    if (!this.drag) return null;
    if (this._frame) cancelAnimationFrame(this._frame);
    this._frame = null;
    const d = this.drag; this.drag = null;
    this.app.pathOverlay.clearPreview();
    this.app.rig.controls.enabled = !this.app.cameraView && !this.app.pathTool.busy;
    this.dom.style.cursor = '';
    if (d?.pointerId != null && this.dom.hasPointerCapture(d.pointerId)) this.dom.releasePointerCapture(d.pointerId);
    return d;
  }

  cancel() {
    if (this.app.gizmo.dragging && this.drag?.kind === 'gizmo') { this.app.gizmo.cancel(); return; }
    const d = this._clearDrag();
    if (!d) return;
    if (d.active) this.app.playback.seek(d.time);
    else { this.app.playback.stop(); this.app.playback.time = d.time; this.app.timeline.time = d.time; }
    this.app.emit('motionPreview', null);
    this._bindPoint();
  }

  finish() {
    const d = this.drag;
    if (!d) return;
    if (d.revision !== this.app.store.revision || this.source(d.ref) !== d.source) { this.cancel(); toast('场景已变化，已取消本次拖动'); return; }
    this._clearDrag();
    try {
      if (d.moved) {
        if (d.ref.kind === 'path') this.app.timeline.updatePath(d.ref.sourceId, { points: d.candidate.points });
        else this.app.store.batch('移动位置关键帧', () => {
          d.candidate.keys.forEach((k, i) => { if (d.all || i === d.index) this.app.timeline.setKey(d.ref.sourceId, k.t, k.value, k.ease); });
        });
      }
      this.app.playback.seek(this.nodeTime(d.ref, this.source(d.ref)));
    } catch (err) { toastError(err); this.app.playback.seek(d.time); }
    this.app.emit('motionPreview', null);
    this._bindPoint();
  }

  _plane(e, y) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointerNDC(this.dom, e.clientX, e.clientY), this.app.getRenderCamera());
    this.proxy.parent.updateWorldMatrix(true, false);
    return framePlanePoint(ray.ray, this.proxy.parent, y, this.app.rig.controls.target);
  }

  // ---- 指针 ----
  _onDown(e) {
    if (this.drag) return;
    this._consumed = false;
    this._lineDown = null;
    if (e.button !== 0 || !this._enabled) return;
    this._shiftDown = e.shiftKey;
    this._pointerDown = { x: e.clientX, y: e.clientY };
    if (this.app.gizmo.hitTest(e.clientX, e.clientY)) { this._consumed = true; this._axisDown = true; this.app.rig.controls.enabled = false; return; }
    const hit = this._hit(e);
    if (hit?.kind === 'vertex') {
      e.stopImmediatePropagation(); // 不让 gizmo / 环绕接手
      e.preventDefault();
      this._consumed = true;
      this.selectNode(hit.sourceKind === 'pos' ? { kind: 'pos', sourceId: hit.pathId, keyTime: hit.keyTime } : { kind: 'path', sourceId: hit.pathId, index: hit.index });
      this._beginDrag(e, hit);
      return;
    }
    if (hit?.kind === 'line' && (!this.app.gizmo.visible || !this.app.gizmo.overAxis)) {
      this._consumed = true; // 不 stopPropagation：拖动仍是环绕，松手不动才算点线
      this._lineDown = { hit, x: e.clientX, y: e.clientY };
    }
  }

  _beginDrag(e) {
    const v = this.point();
    if (!v) return;
    const g = this._plane(e, v[1]);
    const d = this.begin('direct', e.shiftKey);
    Object.assign(d, { offset: g ? [v[0] - g[0], v[2] - g[2]] : [0, 0], x: e.clientX, y: e.clientY, pointerId: e.pointerId });
    this.dom.setPointerCapture(e.pointerId);
  }

  _onMove(e) {
    const d = this.drag;
    if (!d) { if (!e.buttons) this._hoverAt(e); return; }
    if (d.kind === 'gizmo') { if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_PX) d.pointerMoved = true; return; }
    if (d.kind !== 'direct' || Math.hypot(e.clientX - d.x, e.clientY - d.y) <= CLICK_PX && !d.moved) return;
    const v = d.orig[d.index], g = this._plane(e, v[1]);
    if (!g) return;
    this.dom.style.cursor = 'grabbing';
    this.proxy.position.set(g[0] + d.offset[0], v[1], g[2] + d.offset[1]);
    this.candidate(this.proxy.position.toArray());
  }

  _onUp(e) {
    if (this._axisDown) { this._axisDown = false; if (!this.app.gizmo.dragging) this.app.rig.controls.enabled = !this.app.cameraView; }
    if (this.drag) { if (this.drag.kind === 'direct') this.finish(); return; }
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
    if (this.drag) this.cancel(); // 先取消本次拖动，保留轨迹选择
    else this.app.pathOverlay.setSelectedPath(null);
  }

  _onDelete(e) {
    if (this.timelineFocus) return;
    if (!['Delete', 'Backspace'].includes(e.key) || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || !this._enabled) return;
    const ov = this.app.pathOverlay;
    if (!ov.selectedPathId && !(e.repeat && this._pathDeleteHeld)) return;
    this._pathDeleteHeld = true;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (this.drag || !ov.selectedPathId) return; // 拖动期间不提交删除，长按时不落到实体
    if (this.ref?.kind === 'pos' && this.hasPoint) { this.app.timeline.removeKey(this.ref.sourceId, this.ref.keyTime); ov.setSelectedVertex(null); return; }
    if (e.key === 'Delete' && ov.selVertex) this.deleteVertex(ov.selVertex.pathId, ov.selVertex.index);
    else this.deletePath();
  }

  deletePath() {
    const id = this.app.pathOverlay.selectedPathId;
    if (!id || this.drag) return;
    try {
      if (this.ref?.kind === 'pos') this.app.timeline.removeTrack(id);
      else this.app.timeline.removePath(id);
      toast('已删除轨迹 · 可用 ⌘Z / Ctrl+Z 撤销');
    } catch (err) { toastError(err); }
  }

  // ---- 编辑命令（selftest 也走这里）----
  /** 在弧长 s 处插入顶点（点在当前曲线上，插在其所在的两个顶点之间）。 */
  insertAt(pathId, s) {
    const json = this.app.timeline.paths.find((p) => p.id === pathId);
    if (!json || !Number.isFinite(s)) return null;
    // 时间轴也能插点，不能依赖当前视口是否绘制了这条路径。
    const path = this.app.timeline.pathModel(json);
    if (path.length < 1e-6) return null;
    s = Math.max(0, Math.min(path.length, s));
    const p = path.positionAt(s);
    const existing = json.points.findIndex(point => Math.hypot(point[0] - p.x, point[1] - p.y, point[2] - p.z) < 1e-4);
    if (existing >= 0) {
      this.app.pathOverlay.setSelectedVertex({ pathId, index: existing });
      return { index: existing, inserted: false };
    }
    const index = path.edgeAt(s) + 1;
    const pts = json.points.slice();
    pts.splice(index, 0, [round4(p.x), round4(p.y), round4(p.z)]);
    if (!this._write(pathId, { points: pts, ...stopsAfterInsert(json, index) })) return null;
    this.app.pathOverlay.setSelectedVertex({ pathId, index });
    return { index, inserted: true };
  }

  deleteVertex(pathId, index) {
    const json = this.app.timeline.paths.find((p) => p.id === pathId);
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
