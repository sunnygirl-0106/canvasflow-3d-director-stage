import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { Path } from '../anim/Path.js';

const ACCENT = 0x3b82f6;
const LIFT = 0.01;            // 贴地抬高 1 cm，防 z-fighting
const SEG_PER_M = 64;         // 曲线采样：每米 64 段，最少 64、最多 2000 段
const MAX_SEG = 2000;
const ARROW_EVERY = 1;        // 方向箭头间隔（米）
const VERTEX_PX = 5;          // 顶点球屏幕半径（px，≈ 10px 直径）
const MARKER_PX = 11;         // 起止标记屏幕半径（px）
const DOT_PX = 4;             // 播放亮点屏幕半径（px）
const HIT_VERTEX_PX = 9;      // 命中测试：顶点
const HIT_LINE_PX = 6;        // 命中测试：曲线

const COLOR = { vertex: 0xffffff, hover: 0xa9c8ff, selected: ACCENT, dot: 0xbfe0ff };

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * 视口里的路径可视化（阶段 E）：每条路径一条等宽曲线（Line2）；选中实体的路径另画顶点球、起止标记、方向箭头。
 * 播放头所在位置画一个亮点。不持有文档状态：在 timeline 'change' / 选择 / 视角变化时按 toJSON() 重建，'tick' 时只挪亮点。
 *
 * 坐标：overlay 挂在 stage.world 下，路径点（文档口径 = 实体父坐标系）直接作为局部坐标。
 * 顶点球 / 标记 / 亮点用 onBeforeRender 按相机距离缩放，保持固定屏幕尺寸（不论场景缩放）。
 * 机位视角下整体隐藏（产品确认：从镜头里看不出现编辑标记）；洁净渲染（截图 / 机位预览）也隐藏。
 *
 * 拖动预览：setPreview(pathId, points) 只改 overlay 的曲线与顶点，不写文档；clearPreview() 回到文档。
 */
export class PathOverlay {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    this.group.name = 'PathOverlay';
    app.stage.add(this.group);

    this.hover = null;        // { pathId, index } 悬停顶点
    this.selVertex = null;    // { pathId, index } 选中顶点（Del 删除）
    this._preview = null;     // { pathId, points }
    this._items = [];         // [{ json, path, samples, dot, ... }]
    this._hidden = false;     // 洁净渲染时临时隐藏

    this._sphereGeo = new THREE.SphereGeometry(1, 16, 12);
    this._triGeo = flatShape([[0, 1.2], [-0.85, -0.7], [0.85, -0.7]]);
    this._squareGeo = flatShape([[-0.75, -0.75], [0.75, -0.75], [0.75, 0.75], [-0.75, 0.75]]);
    this._arrowGeo = flatShape([[0, 0.09], [-0.065, -0.05], [0, -0.02], [0.065, -0.05]]);
    this._mats = {
      vertex: handleMat(COLOR.vertex), hover: handleMat(COLOR.hover), selected: handleMat(COLOR.selected),
      marker: handleMat(ACCENT, 0.95), arrow: handleMat(ACCENT, 0.85), dot: handleMat(COLOR.dot),
    };
    this._lineMats = new Set();

    // 绘制中的草稿（PathTool 写入）：曲线 + 已落的点；吸附目标的高亮环。不随 rebuild 清空。
    this.draftGroup = new THREE.Group();
    this.group.add(this.draftGroup);
    this.snapRing = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    this.snapRing.renderOrder = 12;
    this.snapRing.visible = false;
    this.group.add(this.snapRing);

    app.timeline.on('change', () => this.rebuild());
    app.playback.on('tick', () => this._placeDots());
    app.on('selection', () => this.rebuild());
    app.on('view', () => this._applyVisible());
    app.stage.onViewportResize(() => this._syncResolution());
    this.rebuild();
  }

  // ---- 构建 ----
  rebuild() {
    for (const o of [...this.group.children]) {
      if (o === this.draftGroup || o === this.snapRing) continue;
      this.group.remove(o);
      this._disposeLine(o);
    }
    this._items = [];
    const { paths } = this.app.timeline.toJSON();
    const selIds = this.app.selectedIds;
    for (const json0 of paths) {
      const pv = this._preview?.pathId === json0.id ? this._preview : null;
      const json = pv ? { ...json0, points: pv.points } : json0;
      if (json.points.length < 2) continue;
      const selected = selIds.has(json.target);
      const item = { json, selected, path: new Path(json), vertices: [] };
      item.samples = this._sample(item.path);
      this.group.add(this._line(item.samples, selected));
      if (selected) this._handles(item);
      item.dot = this._screenMesh(this._sphereGeo, this._mats.dot, DOT_PX);
      item.dot.renderOrder = 12;
      this.group.add(item.dot);
      this._items.push(item);
    }
    this._placeDots();
    this._applyVisible();
    this.app.stage.invalidate();
  }

  /** 按弧长均匀采样曲线（局部坐标，已抬高 LIFT）。 */
  _sample(path) {
    const n = Math.min(MAX_SEG, Math.max(SEG_PER_M, Math.ceil(path.length * SEG_PER_M)));
    const out = [];
    for (let i = 0; i <= n; i++) {
      path.positionAt((i / n) * path.length, _v);
      out.push(_v.x, _v.y + LIFT, _v.z);
    }
    return out;
  }

  _disposeLine(o) {
    if (!o.isLine2) return;
    o.geometry.dispose();
    this._lineMats.delete(o.material);
    o.material.dispose();
  }

  _line(samples, selected, { color = ACCENT, opacity = selected ? 1 : 0.5 } = {}) {
    const geo = new LineGeometry();
    geo.setPositions(samples);
    const mat = new LineMaterial({
      color, linewidth: selected ? 2 : 1, transparent: true, opacity,
      depthWrite: false,
    });
    this._lineMats.add(mat);
    this._syncResolution(mat);
    const line = new Line2(geo, mat);
    line.computeLineDistances();
    line.renderOrder = 10;
    return line;
  }

  /** 选中实体的路径：顶点球、起点三角、终点方块、每 1 m 的方向箭头（orient='keep' 不画）。 */
  _handles(item) {
    const { json, path } = item;
    json.points.forEach((p, i) => {
      const m = this._screenMesh(this._sphereGeo, this._vertexMat(json.id, i), VERTEX_PX);
      m.position.set(p[0], p[1] + LIFT, p[2]);
      m.renderOrder = 13;
      m.userData.vertex = i;
      item.vertices.push(m);
      this.group.add(m);
    });
    const L = path.length;
    const flat = (geo, mat, s, px) => {
      path.positionAt(s, _v);
      const m = px ? this._screenMesh(geo, mat, px) : new THREE.Mesh(geo, mat);
      m.position.set(_v.x, _v.y + LIFT, _v.z);
      if (path.tangentAt(s, _w)) m.rotation.y = Math.atan2(_w.x, _w.z);
      m.renderOrder = 11;
      this.group.add(m);
      return m;
    };
    flat(this._triGeo, this._mats.marker, 0, MARKER_PX);
    if (!json.closed) flat(this._squareGeo, this._mats.marker, L, MARKER_PX);
    if (json.orient !== 'keep') {
      for (let s = ARROW_EVERY; s < L - ARROW_EVERY * 0.3; s += ARROW_EVERY) flat(this._arrowGeo, this._mats.arrow, s, 0);
    }
  }

  _vertexMat(pathId, i) {
    const is = (h) => h && h.pathId === pathId && h.index === i;
    return is(this.selVertex) ? this._mats.selected : is(this.hover) ? this._mats.hover : this._mats.vertex;
  }

  /** 固定屏幕尺寸的网格：渲染前按相机距离换算局部缩放。 */
  _screenMesh(geo, mat, px) {
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.onBeforeRender = (renderer, scene, camera) => {
      m.parent.updateWorldMatrix(true, false);
      _w.setFromMatrixPosition(m.matrixWorld);
      const h = renderer.getSize(_v).y || 1;
      const d = camera.isPerspectiveCamera ? _w.distanceTo(camera.getWorldPosition(_s)) : 1;
      const worldPerPx = camera.isPerspectiveCamera ? (2 * d * Math.tan((camera.fov * Math.PI) / 360)) / h : 0.01;
      const k = (px * worldPerPx) / (m.parent.getWorldScale(_s).y || 1);
      m.scale.setScalar(k);
      m.updateMatrixWorld(true);
      m.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, m.matrixWorld);
      m.normalMatrix.getNormalMatrix(m.modelViewMatrix);
    };
    return m;
  }

  _syncResolution(only) {
    const size = this.app.stage.renderer.getSize(new THREE.Vector2());
    for (const m of only ? [only] : this._lineMats) m.resolution.set(size.x, size.y);
  }

  // ---- 绘制草稿 / 吸附高亮（PathTool）----
  /** 草稿：已落的点 + 按同一种曲线画出的预览（points 为 null 清空）。 */
  setDraft(points, { closed = false, dots = true } = {}) {
    for (const o of [...this.draftGroup.children]) { this.draftGroup.remove(o); this._disposeLine(o); }
    if (points?.length >= 2) {
      const path = new Path({ points, closed, start: 0, duration: 1, speed: 'linear' });
      if (path.length > 1e-6) this.draftGroup.add(this._line(this._sample(path), true, { color: COLOR.hover, opacity: 0.9 }));
    }
    for (const p of dots ? points || [] : []) {
      const m = this._screenMesh(this._sphereGeo, this._mats.vertex, VERTEX_PX - 1);
      m.position.set(p[0], p[1] + LIFT, p[2]);
      m.renderOrder = 13;
      this.draftGroup.add(m);
    }
    this.app.stage.invalidate();
  }

  /** 吸附目标高亮环（局部坐标中心 + 半径；null 隐藏）。 */
  setSnap(center, radius = 0.5) {
    this.snapRing.visible = !!center;
    if (center) { this.snapRing.position.set(center[0], center[1] + LIFT, center[2]); this.snapRing.scale.setScalar(radius); }
    this.app.stage.invalidate();
  }

  // ---- 播放亮点 ----
  _placeDots() {
    const t = this.app.playback.time;
    for (const it of this._items) {
      it.path.positionAt(it.path.distanceAt(t), _v);
      it.dot.position.set(_v.x, _v.y + LIFT, _v.z);
    }
    if (this._items.length) this.app.stage.invalidate();
  }

  /** 播放亮点的局部坐标（selftest 用）。 */
  dotOf(pathId) {
    const it = this._items.find((x) => x.json.id === pathId);
    return it ? it.dot.position.toArray() : null;
  }

  // ---- 显隐 ----
  _applyVisible() {
    this.group.visible = !this._hidden && !this.app.cameraView;
    this.app.stage.invalidate();
  }

  /** 洁净渲染（截图 / 机位预览）期间临时隐藏。 */
  setHidden(v) { this._hidden = v; this._applyVisible(); }

  get visible() { return this.group.visible; }

  // ---- 交互状态（顶点编辑用，非文档状态）----
  setHover(h) {
    if (sameVertex(h, this.hover)) return;
    this.hover = h;
    this._recolor();
  }

  setSelectedVertex(v) {
    if (sameVertex(v, this.selVertex)) return;
    this.selVertex = v;
    this._recolor();
  }

  _recolor() {
    for (const it of this._items) for (const m of it.vertices) m.material = this._vertexMat(it.json.id, m.userData.vertex);
    this.app.stage.invalidate();
  }

  /** 拖动预览：只重画该路径（不写文档、不求值）。 */
  setPreview(pathId, points) {
    this._preview = { pathId, points };
    this.rebuild();
  }

  clearPreview() {
    if (!this._preview) return;
    this._preview = null;
    this.rebuild();
  }

  get previewing() { return !!this._preview; }

  // ---- 命中测试（屏幕空间）----
  /**
   * clientX/Y 处命中的路径元素：顶点优先于曲线。返回
   * { kind:'vertex', pathId, target, index } | { kind:'line', pathId, target, point:[x,y,z], seg } | null。
   * 只测选中实体的顶点；曲线对所有路径都测（点线 = 选中其实体）。
   */
  hitTest(clientX, clientY) {
    if (!this.group.visible || !this._items.length) return null;
    const cam = this.app.getRenderCamera();
    const rect = this.app.stage.renderer.domElement.getBoundingClientRect();
    this.group.updateWorldMatrix(true, false);
    const mw = this.group.matrixWorld;
    const toScreen = (x, y, z) => {
      _v.set(x, y, z).applyMatrix4(mw).project(cam);
      if (_v.z > 1) return null; // 相机背后
      return [rect.left + ((_v.x + 1) / 2) * rect.width, rect.top + ((1 - _v.y) / 2) * rect.height];
    };

    let best = null;
    for (const it of this._items) {
      if (!it.selected) continue;
      it.json.points.forEach((p, i) => {
        const s = toScreen(p[0], p[1] + LIFT, p[2]);
        if (!s) return;
        const d = Math.hypot(s[0] - clientX, s[1] - clientY);
        if (d <= HIT_VERTEX_PX && (!best || d < best.d)) best = { d, kind: 'vertex', pathId: it.json.id, target: it.json.target, index: i };
      });
    }
    if (best) { delete best.d; return best; }

    for (const it of this._items) {
      const S = it.samples;
      let prev = toScreen(S[0], S[1], S[2]);
      for (let i = 1; i < S.length / 3; i++) {
        const cur = toScreen(S[i * 3], S[i * 3 + 1], S[i * 3 + 2]);
        if (prev && cur) {
          const { d, u } = segPx(clientX, clientY, prev, cur);
          if (d <= HIT_LINE_PX && (!best || d < best.d)) best = { d, it, i, u };
        }
        prev = cur;
      }
    }
    if (!best) return null;
    const { it, i, u } = best;
    const S = it.samples;
    const lerp = (k) => S[(i - 1) * 3 + k] + (S[i * 3 + k] - S[(i - 1) * 3 + k]) * u;
    const n = S.length / 3 - 1;
    return {
      kind: 'line', pathId: it.json.id, target: it.json.target,
      point: [lerp(0), lerp(1) - LIFT, lerp(2)],
      s: ((i - 1 + u) / n) * it.path.length, // 命中处的弧长
    };
  }

  /** 选中实体路径的 Path（运行时只读视图），供插入顶点时按弧长定位。 */
  pathOf(pathId) { return this._items.find((x) => x.json.id === pathId)?.path || null; }
}

function handleMat(color, opacity = 1) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
}

/** XZ 平面上的多边形（朝 +Z 为"前"），单位尺寸。 */
function flatShape(pts2) {
  const shape = new THREE.Shape(pts2.map(([x, z]) => new THREE.Vector2(x, z)));
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(Math.PI / 2); // Shape 在 XY 平面：(x, y) → (x, 0, y)
  return geo;
}

function segPx(x, y, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const len = abx * abx + aby * aby;
  const u = len > 0 ? Math.min(1, Math.max(0, ((x - a[0]) * abx + (y - a[1]) * aby) / len)) : 0;
  return { d: Math.hypot(x - a[0] - abx * u, y - a[1] - aby * u), u };
}

const sameVertex = (a, b) => (a ? !!b && a.pathId === b.pathId && a.index === b.index : !b);
