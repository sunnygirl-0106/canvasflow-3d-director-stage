import { toast } from '../util/dom.js';
import { toastError } from '../ui/timeline/Transport.js';
import { stopsAfterInsert, stopsAfterDelete } from '../anim/pathGen.js';

const CLICK_PX = 4;  // 按下到松开移动不超过它算点击（与 Selection 一致）
const isTyping = (t) => t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
const r4 = (x) => { const v = Math.round(x * 1e4) / 1e4; return v === 0 ? 0 : v; };

/**
 * 顶点编辑（阶段 E）：选中实体后直接在视口操作，不需要进绘制态。
 * - 拖顶点：在该顶点所在的水平面上投影拖动；拖动中只改 overlay 预览（不写文档、不求值），松手 updatePath 一次撤销。
 *   ⇧ 拖任意顶点 = 整条路径平移。拖动开始时暂停播放、隐藏 gizmo；Esc 取消拖动回到原位。
 * - 点击曲线：选中实体的路径 → 在该处插入顶点（插在最近两顶点之间，点落在曲线上）；其它实体的路径 → 选中该实体。
 * - 点击顶点 = 选中顶点；Del 删除（删后不足 2 点则拒绝）。Del 的优先级：选中键 > 选中顶点 > 实体。
 * 命中优先级：顶点 > gizmo 轴 > 曲线 > 实体（顶点只有 10px，点中了就是要拖它）。
 */
export class PathEditor {
  constructor(app) {
    this.app = app;
    this.drag = null;          // { pathId, index, orig, offset, all, moved, points }
    this._consumed = false;    // 本次按下落在路径元素上：视口点选跳过
    this._lineDown = null;     // 按下在曲线上：{ hit, x, y }，松手不动才算点击

    const dom = app.stage.renderer.domElement;
    this.dom = dom;
    // 捕获阶段：先于 TransformControls / OrbitControls（同一元素上捕获监听先执行）
    dom.addEventListener('pointerdown', (e) => this._onDown(e), true);
    dom.addEventListener('pointermove', (e) => this._onMove(e));
    dom.addEventListener('pointerup', (e) => this._onUp(e), true);
    dom.addEventListener('pointerleave', () => { if (!this.drag) this._setHover(null); });
    window.addEventListener('keydown', (e) => this._onEscape(e), true); // 拖动中 Esc：先于时间轴的 Esc = 停止
    window.addEventListener('keydown', (e) => this._onDelete(e));       // 冒泡：时间轴（捕获，选中键）之后、全局删实体之前
    app.on('selection', () => this.app.pathOverlay.setSelectedVertex(null));
  }

  /** 视口点选是否应跳过（本次按下落在路径元素上 / 正在拖顶点）。 */
  get busy() { return this._consumed || !!this.drag; }

  get _enabled() { return !this.app.cameraView && !this.app.pathTool.mode; }

  _hit(e) { return this._enabled ? this.app.pathOverlay.hitTest(e.clientX, e.clientY) : null; }

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
    if (hit?.kind === 'line' && !this.app.gizmo.overAxis) {
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
      d.points = d.orig.map((p) => [r4(p[0] + dx), p[1], r4(p[2] + dz)]);
    } else {
      d.points = d.orig.map((p, i) => (i === d.index ? [r4(nx), p[1], r4(nz)] : p));
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
    else this.insertAt(hit.pathId, hit.s);
  }

  _endDrag() {
    const d = this.drag;
    this.drag = null;
    this.app.pathOverlay.clearPreview();
    this.app.gizmo.setVisible(this.app._gizmoShouldShow());
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
    if (e.key !== 'Escape' || !this.drag) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this._endDrag(); // 回到原位：预览丢掉，文档没动过
  }

  _onDelete(e) {
    if (!(e.key === 'Delete' || e.key === 'Backspace') || e.metaKey || e.ctrlKey || isTyping(e.target)) return;
    const sv = this.app.pathOverlay.selVertex;
    if (!sv) return;
    e.preventDefault();
    e.stopImmediatePropagation(); // 不再删实体
    this.deleteVertex(sv.pathId, sv.index);
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
    pts.splice(seg + 1, 0, [r4(p.x), json.points[seg][1], r4(p.z)]);
    if (this._write(pathId, { points: pts, ...stopsAfterInsert(json, seg + 1) })) this.app.pathOverlay.setSelectedVertex({ pathId, index: seg + 1 });
  }

  deleteVertex(pathId, index) {
    const json = this.app.timeline.toJSON().paths.find((p) => p.id === pathId);
    if (!json || !json.points[index]) { this.app.pathOverlay.setSelectedVertex(null); return; }
    if (json.points.length <= 2) { toast('路径至少需要 2 个顶点（可在属性面板删除整条路径）'); return; }
    const pts = json.points.filter((_, i) => i !== index);
    this.app.pathOverlay.setSelectedVertex(null);
    this._write(pathId, { points: pts, ...stopsAfterDelete(json, index) });
  }

  _write(pathId, patch) {
    try { this.app.timeline.updatePath(pathId, patch); return true; } catch (err) { toastError(err); return false; }
  }
}
