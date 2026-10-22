import * as THREE from 'three';
import { el, toast, toastError, confirmToast, isTyping, CLICK_PX } from '../util/dom.js';
import { Emitter } from '../util/Emitter.js';
import { safePathPlanePoint } from '../core/pathPicking.js';
import { worldBox } from '../util/measure.js';
import { line, polar, toward, simplify, PATH_MODES, rectangle, TOWARD_STOP, ARC_SWEEP, arcPoints, pathLength, defaultDuration } from '../anim/pathGen.js';
import { rampFor } from '../anim/Path.js';
import { PathTrack } from '../anim/PathTrack.js';
import { pathStartPoint, setPath } from '../doc/edit.js';
import { round4, clone } from '../util/math.js';
import { onKey, KEY_PRIORITY } from '../util/keys.js';

/** 某实体的绘制方式文案：机位的「走到」叫「推到」（同一个 toward）。 */
export function pathModes(ent) {
  return [['circle', '圆环路径'], ['line', '直线路径'], ['rectangle', '矩形路径'], ['freehand', '铅笔路径'], ['points', '钢笔路径'], ['toward', ent?.type === 'camera' ? '推到目标' : '走到目标']];
}

const ORBIT_HINT = '⌥拖动环绕视角';
const HINTS = {
  rectangle: '点击地面设置矩形对角点 · Esc 取消',
  circle: '点击地面或对象设置圆心 · Esc 取消',
  points: '点击地面落点 · 回车 / 双击结束 · Backspace 退一点 · Esc 取消',
  freehand: '按住左键在地面上拖动绘制，松手结束 · Esc 取消',
  line: '点击地面放置终点 · Esc 取消',
  arc: '点击地面或对象作为环绕中心 · Esc 取消',
  toward: '点击目标对象（⇧ + 点击地面取点）· Esc 取消',
};
const DBL_EPS = 0.05;     // 双击结束时，与上一点距离小于它的点视为双击的第二下，丢掉
const STROKE_STEP = 0.02; // 手绘采样间隔（米）
const SIMPLIFY_TOL = 0.05;
const MIN_RADIUS = 0.1;   // 环绕：当前位置离中心太近时无法定半径



/**
 * 路径绘制工具：Dock「路径」/ Inspector「新建路径」进入绘制态，在视口里画出 points[]，
 * 结束时一次写入（addPath 或替换现有路径的 updatePath，一次撤销）。
 *
 * 绘制态下视口左键归绘制：OrbitControls 的左键动作临时置空，⌥ + 左键拖动仍可环绕；
 * 右键平移、滚轮缩放不变。gizmo 隐藏、视口点选暂停。
 *
 * 起点规则：首点 = 实体当前手动值（Timeline base，active 时也不取动画瞬时值）投到绘制平面，所以创建后 t=0 不跳。
 * 绘制平面：角色 / 道具 / 组 = 地面（y = scene.ground.height）；机位 = 过机位当前位置的水平面（路径点 y = 机位高度）。
 * 机位路径默认 orient = keep（镜头不随切线转），「走到」对机位叫「推到」，停在目标前 1.5 m。
 * 坐标：一律文档口径（stage.world 局部坐标）。
 * 事件：'mode'(key | null) —— 进入 / 退出绘制态。
 */
export class PathTool extends Emitter {
  constructor(app) {
    super();
    this.app = app;
    this.mode = null;   // 当前绘制方式（null = 不在绘制态）
    this.ent = null;    // 绘制对象
    this.draft = [];    // 已落的点（含首点）
    this._down = null;  // { x, y, button }
    this._orbiting = false;
    this._ray = new THREE.Raycaster();

    this.hintEl = el('div', { class: 'path-hint', hidden: true });
    app.stage.viewport.appendChild(this.hintEl);

    const dom = app.stage.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => this._onDown(e), true); // 捕获：先于 OrbitControls
    dom.addEventListener('pointermove', (e) => this._onMove(e));
    window.addEventListener('pointerup', (e) => this._onUp(e));
    dom.addEventListener('dblclick', (e) => this._onDblClick(e));
    onKey((e) => this._onKey(e), { priority: KEY_PRIORITY.pathDraw }); // 先于时间轴 / 全局快捷键
    app.on('selection', (ent) => { if (this.mode && ent !== this.ent) this.cancel(); });
    app.on('view', (pov) => { if (this.mode && pov) this.cancel(); });
  }

  /** 实体能否画路径：角色 / 道具 / 组 / 机位。 */
  canDraw(ent) { return !!ent && ['character', 'prop', 'group', 'camera'].includes(ent.type); }

  // ---- 入口 ----
  /**
   * 从 Dock / Inspector 发起：先处理冲突（已有路径 → 替换？已有 pos 轨道 → 删除？），确认后进入绘制态。
   * 冲突的删除 / 替换在绘制完成时才执行，中途 Esc 文档不变。
   */
  request(mode, targetId = this.app.selected?.id) {
    if (![...PATH_MODES.map(([k]) => k), 'circle', 'rectangle'].includes(mode)) return;
    const { app } = this;
    const ent = app.findEntity(targetId);
    if (!this.canDraw(ent)) { toast('请先选中角色、道具、组或机位'); return; }
    app.playback.pause();
    app.setCameraView(false);
    app.select(ent.id);
    const anim = app.timeline.toJSON();
    const go = () => this.begin(mode, ent);
    if (anim.paths.some((p) => p.target === ent.id)) {
      confirmToast('重新绘制将替换现有路径', '替换', go);
    } else if (anim.timeline.tracks.some((t) => t.target === ent.id && t.property === 'pos')) {
      confirmToast('该对象已有位置关键帧，创建路径将删除它们', '删除并继续', go);
    } else go();
  }

  begin(mode, ent) {
    const { app } = this;
    if (this.mode) this._end();
    if (ent !== app.selected) return; // 确认期间换了选中
    this.mode = mode;
    this.ent = ent;
    this.start = this.startPoint(ent);
    this.planeY = this.start[1];
    this.draft = [this.start];
    this.cursor = null;
    app.playback.pause();
    app.gizmo.setVisible(false);
    app.rig.controls.mouseButtons.LEFT = -1; // 左键归绘制；⌥ 左键在 _onDown 里临时恢复环绕
    const hint = ent.type === 'camera' ? HINTS[mode].replaceAll('地面', '机位高度平面') : HINTS[mode];
    this._drawHint = `${hint} · ${ORBIT_HINT}`;
    this.hintEl.textContent = this._drawHint;
    this.hintEl.hidden = false;
    app.stage.viewport.classList.add('path-drawing');
    this._preview();
    this.emit('mode', mode);
  }

  cancel() { if (this.mode) this._end(); }

  _end() {
    const { app } = this;
    this.mode = null;
    this.ent = null;
    this.draft = [];
    this._down = null;
    app.rig.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    app.gizmo.setVisible(app.gizmoShouldShow());
    this.hintEl.hidden = true;
    app.stage.viewport.classList.remove('path-drawing');
    app.pathOverlay.setDraft(null);
    app.pathOverlay.setSnap(null);
    this.emit('mode', null);
  }

  /** 视口点选是否应暂停（绘制态 / 本次按下被工具消费）。 */
  get busy() { return !!this.mode; }

  // ---- 坐标 ----
  get groundY() { return this.app.sceneState.ground.height; }

  /** 实体当前手动值的位置投到绘制平面（文档口径）：机位保留自身高度，其余落到地面。 */
  startPoint(ent) {
    return pathStartPoint(ent.type, ent.transformJSON(this.app.timeline.baseOf(ent) || ent.root).pos, this.groundY);
  }

  _setRay(e) {
    const r = this.app.stage.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this._ray.setFromCamera(ndc, this.app.getRenderCamera());
  }

  /** 光标处的绘制平面点（文档口径：角色 / 道具 / 组 = 地面，机位 = 机位高度）；看不到平面时 null。 */
  groundPoint(e) {
    const point = this.planePoint(e, this.mode ? this.planeY : this.groundY);
    if (this.mode) this.hintEl.textContent = point ? this._drawHint : `此处太远或接近地平线，请向下调整视角或平移到目标区域 · ${ORBIT_HINT}`;
    return point;
  }

  /** 光标射线与 world 局部坐标里水平面 y 的交点（[x, y, z]，相机背后 / 平行时 null）。 */
  planePoint(e, y) {
    this._setRay(e);
    const world = this.app.stage.world;
    world.updateMatrixWorld(true);
    const inv = world.matrixWorld.clone().invert();
    const o = this._ray.ray.origin.clone().applyMatrix4(inv);
    const d = this._ray.ray.direction.clone().transformDirection(inv);
    const focus = this.app.rig.controls.target.clone().applyMatrix4(inv);
    return safePathPlanePoint(o, d, y, focus, o.distanceTo(focus));
  }

  /** 光标处的实体（不含绘制对象本身；群众成员归到组）。 */
  pickEntity(e) {
    const { app } = this;
    this._setRay(e);
    const roots = app.entities.filter((en) => en.visible && en !== this.ent).map((en) => en.root);
    const hit = this._ray.intersectObjects(roots, true).find((h) => {
      for (let o = h.object; o; o = o.parent) if (o.visible === false) return false;
      return true;
    });
    let o = hit?.object;
    while (o && o.userData.entityId == null) o = o.parent;
    const ent = o ? app.findEntity(o.userData.entityId) : null;
    return ent && ent !== this.ent ? ent : null;
  }

  /** 实体的吸附点（文档口径，y = 地面）：角色 / 组 = 脚底（轴心），其余 = 包围盒中心；附带高亮环半径。 */
  anchorOf(ent) {
    const world = this.app.stage.world;
    world.updateMatrixWorld(true);
    const box = worldBox(ent.root, { useBones: ent.type === 'character' });
    const c = ent.type === 'character' || ent.type === 'group' || box.isEmpty()
      ? ent.root.getWorldPosition(new THREE.Vector3())
      : box.getCenter(new THREE.Vector3());
    world.worldToLocal(c);
    const ws = world.getWorldScale(new THREE.Vector3()).y || 1;
    const size = box.isEmpty() ? new THREE.Vector3(0.6, 0, 0.6) : box.getSize(new THREE.Vector3());
    const radius = Math.max(0.4, 0.5 * Math.hypot(size.x, size.z) + 0.12) / ws;
    return { point: [round4(c.x), this.groundY, round4(c.z)], radius };
  }

  // ---- 指针 ----
  _onDown(e) {
    if (!this.mode) return;
    if (e.button === 0 && e.altKey) { // ⌥ 左键：本次拖动交还环绕
      this.app.rig.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
      this._orbiting = true;
      return;
    }
    if (e.button !== 0) return; // 右键平移 / 中键缩放照常
    this._down = { x: e.clientX, y: e.clientY };
    if (this.mode === 'freehand') {
      const g = this.groundPoint(e);
      this._stroke = g ? [g] : [];
    }
  }

  _onMove(e) {
    if (!this.mode || this._orbiting) return;
    if (this.mode === 'freehand') {
      if (!this._stroke) return;
      const g = this.groundPoint(e);
      const last = this._stroke[this._stroke.length - 1];
      if (g && (!last || dist2(g, last) >= STROKE_STEP)) {
        this._stroke.push(g);
        this.app.pathOverlay.setDraft(this._stroke, { dots: false });
      }
      return;
    }
    this._hover(e);
  }

  _onUp(e) {
    if (this._orbiting) {
      this._orbiting = false;
      if (this.mode) this.app.rig.controls.mouseButtons.LEFT = -1;
      return;
    }
    if (!this.mode || !this._down || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y);
    this._down = null;
    if (this.mode === 'freehand') { this._endStroke(); return; }
    if (moved <= CLICK_PX) this._click(e);
  }

  _onDblClick(e) {
    if (this.mode !== 'points') return;
    // 双击的两下各落了一点：第二下与第一下几乎重合，丢掉
    const d = this.draft;
    while (d.length > 2 && dist2(d[d.length - 1], d[d.length - 2]) < DBL_EPS) d.pop();
    this.finish();
    e.preventDefault();
  }

  _onKey(e) {
    if (e.target.closest?.('.ai-capsule, .ctxmenu')) return;
    if (!this.mode || e.metaKey || e.ctrlKey || isTyping(e.target)) return;
    let handled = true;
    if (e.key === 'Escape') this.cancel();
    else if (e.key === 'Enter') this.finish();
    else if (e.key === 'Backspace' || e.key === 'Delete') this._undoPoint();
    else handled = false;
    if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
  }

  // ---- 各方式 ----
  _click(e) {
    const g = this.groundPoint(e);
    switch (this.mode) {
      case 'points':
        if (g) { this.draft.push(g); this._preview(); }
        break;
      case 'rectangle': {
        const points = g && rectangle(this.start, g);
        if (points) this._commit(points, { closed: true, interpolation: 'polyline' });
        else if (g) toast('矩形的两条边均需至少 0.1 米');
        break;
      }
      case 'line':
        if (g) this._commit(line(this.start, g));
        break;
      case 'toward': {
        const target = this.pickEntity(e);
        const at = target ? this.anchorOf(target).point : e.shiftKey ? g : null;
        if (!at) { toast('请点击目标对象（⇧ + 点击地面可取地面点）'); return; }
        const stop = this._towardStop();
        const pts = toward(this.start, at, { stopDistance: stop });
        if (!pts) { toast(`离目标太近（≤ ${stop} m），不需要${this.ent.type === 'camera' ? '推过去' : '走过去'}`); return; }
        this._commit(pts);
        break;
      }
      case 'circle':
      case 'arc': {
        const target = this.pickEntity(e);
        const center = target ? this.anchorOf(target).point : g;
        if (!center) return;
        const meta = this._arcMeta(center);
        if (!meta) { toast('当前位置离中心太近，无法环绕（换个中心点）'); return; }
        this._commit(arcPoints(meta, this.planeY).points, { meta, closed: this.mode === 'circle' });
        break;
      }
    }
  }

  /** 环绕：中心 → 默认参数（半径与起始角由当前位置得出，扫过 180°）。太近返回 null。 */
  _arcMeta(center) {
    const { radius, deg } = polar(center, this.start);
    if (radius < MIN_RADIUS) return null;
    return { kind: 'arc', center: [center[0], this.planeY, center[2]], radius: round4(radius), startDeg: round4(deg), sweepDeg: this.mode === 'circle' ? 360 : ARC_SWEEP };
  }

  _towardStop() { return this.ent?.type === 'camera' ? TOWARD_STOP.camera : TOWARD_STOP.default; }

  /** 手绘松手：采样 → simplify；首点替换为当前位置。 */
  _endStroke() {
    const raw = this._stroke || [];
    this._stroke = null;
    const pts = simplify(raw, SIMPLIFY_TOL);
    let len = 0;
    for (let i = 1; i < raw.length; i++) len += dist2(raw[i], raw[i - 1]);
    if (pts.length < 2 || len < 0.1) {
      toast('路径太短，请按住左键在地面上拖动');
      this.app.pathOverlay.setDraft([this.start]);
      return;
    }
    pts[0] = this.start.slice();
    this.lastStroke = raw; // selftest 用：原采样点
    this._commit(pts);
  }

  /** 光标移动：草稿预览（橡皮筋）与吸附高亮。 */
  _hover(e) {
    const ov = this.app.pathOverlay;
    const g = this.groundPoint(e);
    if (this.mode === 'toward' || this.mode === 'arc' || this.mode === 'circle') {
      const target = this.pickEntity(e);
      const a = target ? this.anchorOf(target) : null;
      ov.setSnap(a?.point, a?.radius);
      if (this.mode === 'arc' || this.mode === 'circle') {
        const meta = this._arcMeta(a ? a.point : g || this.start);
        const r = meta && arcPoints(meta, this.planeY);
        ov.setDraft(r ? r.points : [this.start], { dots: false, closed: r?.closed || false });
        return;
      }
      const at = a ? a.point : e.shiftKey ? g : null;
      ov.setDraft((at && toward(this.start, at, { stopDistance: this._towardStop() })) || [this.start]);
      return;
    }
    this.cursor = g;
    this._preview();
  }

  _preview() {
    const pts = this.mode === 'points' || this.mode === 'line'
      ? [...(this.mode === 'line' ? [this.start] : this.draft), ...(this.cursor ? [this.cursor] : [])]
      : this.draft;
    if (this.mode === 'rectangle' && this.cursor) {
      const corners = rectangle(this.start, this.cursor);
      this.app.pathOverlay.setDraft(corners ? [...corners, corners[0]] : [this.start], { interpolation: 'polyline' });
    } else this.app.pathOverlay.setDraft(pts);
  }

  _undoPoint() {
    if (this.mode !== 'points' || this.draft.length <= 1) return;
    this.draft.pop();
    this._preview();
  }

  /** 回车 / 双击：结束点击落点。 */
  finish() {
    if (this.mode !== 'points') return;
    if (this.draft.length < 2) { toast('至少再点一个落点（Esc 取消）'); return; }
    this._commit(this.draft.slice());
  }

  /**
   * 写入文档（一次撤销），数据由 edit.setPath 生成（与 AI 同一份）：已有路径 → 替换 points / closed，按新长度重算时长，
   * 保留 speed / orient；否则删掉该实体的 pos 轨道（若有，request 时已确认）并新建路径：
   * 新建人物路径按正常步速估算时长，重画保留时长；新人物路径默认匀速、orient = tangent（机位 keep）。
   * @returns {string|null} 路径 id
   */
  _commit(points, { closed = false, meta = null, interpolation } = {}) {
    if (!points || points.length < 2 || !points.some(p => dist2(p, points[0]) > 0.01)) { toast('路径太短'); return null; }
    const { app } = this;
    const ent = this.ent;
    this._end();
    let path, old;
    try {
      app.store.transact('绘制路径', (doc) => {
        ({ path, replaced: old } = clone(setPath(doc, ent.id, points, { closed, set: { start: 0, ...(interpolation ? { interpolation } : {}) } })));
        // 同一事务保存出发朝向：idle 立即可见，撤销路径时也恢复原朝向。
        if (['character', 'group'].includes(ent.type) && path.orient === 'tangent') {
          const transform = doc.entities.find((e) => e.id === ent.id).transform;
          const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(...transform.rot.map((v) => v * Math.PI / 180)));
          new PathTrack(path).apply(path.start, { ent, quaternion, position: new THREE.Vector3(), opts: { posOffset: [0, 0, 0] } });
          const rotation = new THREE.Euler().setFromQuaternion(quaternion);
          transform.rot = [rotation.x, rotation.y, rotation.z].map((v) => round4(v * 180 / Math.PI));
        }
      });
    } catch (err) { toastError(err); return null; }
    if (meta) app.pathMeta[path.id] = meta; else delete app.pathMeta[path.id];
    const length = pathLength(path.points, path.closed, path.stops, path.interpolation);
    const natural = defaultDuration(path.points, { closed: path.closed, interpolation: path.interpolation, ramp: path.speed === 'smooth' ? rampFor(ent.type) : 0 });
    const fitted = !['character', 'group'].includes(ent.type) && path.duration < natural - 0.001 ? ' · 已自动加速适配总时长，可在运动轨迹中调整' : '';
    toast(`${old ? '已替换' : '已创建'}轨迹：${fmt(path.start)}–${fmt(path.start + path.duration)} s · 平均 ${(length / path.duration).toFixed(2)} m/s${fitted}`);
    app.pathOverlay.setSelectedPath(path.id);
    this.emit('commit', path);
    return path.id;
  }
}

const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const fmt = (s) => (Math.round(s * 10) / 10).toString();
