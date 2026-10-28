import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { pathTarget, hasDisplacement } from './pathTarget.js';
import { Path } from '../anim/Path.js';

const ACCENT = 0x60a5fa;
const CAMERA_TRAIL = 0xc4b5fd;
const LIFT = 0.01;            // 贴地抬高 1 cm，防 z-fighting
const SEG_PER_M = 64;         // 曲线采样：每米 64 段，最少 64、最多 2000 段
const MAX_SEG = 2000;
const VERTEX_PX = 4;          // 扁平节点屏幕半径（px，8px 直径）
const MARKER_PX = 5;         // 起止标记屏幕半径（px）
const DOT_PX = 4;             // 播放亮点屏幕半径（px）
const HIT_VERTEX_PX = 12;      // 命中测试：顶点
const HIT_LINE_PX = 6;        // 命中测试：曲线

const COLOR = { hover: 0xa9c8ff };

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * 非播放时，视口按统一目标策略显示路径（Line2）；起止与方向始终可读；进入路径编辑时显示扁平节点。
 * 播放头所在位置画一个亮点。不持有文档状态：在 timeline 'change' / 选择 / 视角变化时按 toJSON() 重建，'tick' 时只挪亮点。
 *
 * 坐标：overlay 挂在 stage.world 下，路径点（文档口径 = 实体父坐标系）直接作为局部坐标。
 * 扁平节点 / 标记 / 亮点用 onBeforeRender 按相机距离缩放，保持固定屏幕尺寸（不论场景缩放）。
 * 机位视角下仅绘制期间显示草稿反馈；洁净渲染（截图 / 机位预览）始终隐藏。
 *
 * 拖动预览：setPreview 仅更新当前来源几何；角色由 PathEditor 通过 Playback 同步求值。
 */
export class PathOverlay {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    this.group.name = 'PathOverlay';
    app.stage.add(this.group);

    this.selection = null; // { kind, sourceId, index? / keyTime?, arrival? }
    this.hover = null;        // { pathId, index } 悬停顶点
    this._preview = null;     // { pathId, points }
    this._items = [];         // [{ json, path, samples, dot, ... }]
    this._hidden = false;     // 洁净渲染时临时隐藏

    this._discGeo = new THREE.PlaneGeometry(2, 2);

    this._mats = { vertex: discMat(ACCENT, 'node') };
    this._lineMats = new Set();
    this.nameHint = document.createElement('div');
    this.nameHint.className = 'path-name-hint';
    this.nameHint.hidden = true;
    app.stage.viewport.appendChild(this.nameHint);
    app.stage.viewport.addEventListener('pointermove', e => {
      if (e.target !== app.stage.renderer.domElement || !this.group.visible) { this.nameHint.hidden = true; return; }
      const hit = this.hitTest(e.clientX, e.clientY);
      if (this._hoverPathId !== hit?.pathId) { this._hoverPathId = hit?.pathId || null; this._recolor(); }
      const ent = hit && app.findEntity(hit.target);
      this.nameHint.hidden = !ent;
      if (ent) {
        this.nameHint.textContent = ent.name;
        const rect = app.stage.viewport.getBoundingClientRect();
        this.nameHint.style.left = `${e.clientX - rect.left + 12}px`;
        this.nameHint.style.top = `${e.clientY - rect.top + 12}px`;
      }
    });
    app.stage.viewport.addEventListener('pointerleave', () => { this.nameHint.hidden = true; this._hoverPathId = null; this._recolor(); });

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

    // 运镜预览（Inspector 运镜段写入）：将要生成的路径，虚线。不随 rebuild 清空。
    this.moveGroup = new THREE.Group();
    this.group.add(this.moveGroup);

    app.timeline.on('change', () => this.rebuild());
    app.playback.on('tick', () => this._placeDots());
    app.playback.on('state', () => { this._applyVisible(); app.emit('pathVisibility'); });
    app.on('selection', () => {
      if (!app._cleanDepth) this._hidden = false;
      this.rebuild();
    });
    app.on('view', () => this._applyVisible());
    app.on('scene', () => this.rebuild());
    app.on('entities', () => this.rebuild());
    app.store.on('change', ({ before, after }) => {
      if (before.scene.activeCameraId !== after.scene.activeCameraId) this.rebuild();
    });
    app.stage.onViewportResize(() => this._syncResolution());
    this.rebuild();
  }

  reset() {
    this.selection = null; this.hover = null; this._hoverPathId = null; this._preview = null;
    this.nameHint.hidden = true;
    this.setDraft(null); this.setMovePreview(null); this.setSnap(null);
  }

  /** 当前显示来源及节点的只读快照；不暴露可变的渲染对象。 */
  get displayState() {
    return {
      preview: !!this._preview,
      paths: this._items.map(it => ({
        source: structuredClone(it.json),
        nodes: it.vertices.map(m => ({ position: m.position.toArray(), geometry: m.geometry.type })),
        visible: it.group.visible,
        hasLine: !!it.line,
        resolution: it.line?.material.resolution.toArray(),
        matrix: it.group.matrixWorld.toArray(),
      })),
    };
  }

  // ---- 构建 ----
  get selectedPathId() { return this.selection?.sourceId || null; }
  get selVertex() {
    const s = this.selection;
    return s?.kind === 'path' && s.index != null ? { pathId: s.sourceId, index: s.index } : null;
  }
  source(id) { return this.app.timeline.paths.find(p => p.id === id) || this.app.timeline.tracks.find(t => t.id === id && t.property === 'pos'); }
  points(json) { return json.points || json.keys.map(k => k.value); }
  editable(json, t = this.app.playback.time) {
    return !!json && pathTarget(this.app.store.document, { editingTarget: json.target }) === json.target
      && this.app.timeline.forcedProps(json.target, t).get('pos') !== '跟随';
  }

  rebuild() {
    const sources = [...this.app.timeline.paths, ...this.app.timeline.tracks.filter(t => t.property === 'pos' && t.keys.length)];
    const editing = this.source(this.selectedPathId);
    if (editing && editing.target !== this.app.selectedId) this.setSelection(null);
    const target = pathTarget(this.app.store.document, { selectedId: this.app.selectedId, userSelectedId: this.app.userSelectedId, editingTarget: this.source(this.selectedPathId)?.target });
    const visible = sources.filter(j => j.target === target && (hasDisplacement(j) || j.id === this.selectedPathId && this.points(j).length));
    if (this.selection && !visible.some(j => j.id === this.selectedPathId)) this.setSelection(null);
    if (!visible.some(j => j.id === this._hoverPathId)) { this._hoverPathId = null; this.nameHint.hidden = true; }
    if (!visible.some(j => j.id === this.hover?.pathId)) this.hover = null;
    for (const it of this._items) {
      this.group.remove(it.group);
      it.group.traverse(o => {
        if (o.isLineSegments2) this._disposeLine(o);
        else if (o.material && !Object.values(this._mats).includes(o.material)) {
          o.material.map?.dispose(); o.material.dispose();
        }
      });
    }
    this._items = visible.map(json => this._buildItem(json));
    this._recolor(); this._placeDots(); this._applyVisible(); this.app.stage.invalidate();
  }

  _buildItem(json) {
    const kind = json.points ? 'path' : 'pos';
    const ent = this.app.findEntity(json.target);
    const color = new THREE.Color(ent?.type === 'camera' ? CAMERA_TRAIL : ent?.trailColor || '#4dd9ed').getHex();
    const item = { json, kind, color, lift: ent?.type === 'camera' ? 0 : LIFT, selected: this.selectedPathId === json.id, vertices: [], group: new THREE.Group() };
    item.group.matrixAutoUpdate = false;
    this._syncParent(item);
    this.group.add(item.group);
    this._updateItem(item, json);
    item.dot = this._screenMesh(this._discGeo, discMat(color, 'start'), DOT_PX);
    item.group.add(item.dot);
    return item;
  }

  _syncParent(item) {
    const parent = this.app.findEntity(item.json.target)?.root.parent;
    if (!parent) return;
    this.group.updateWorldMatrix(true, false); parent.updateWorldMatrix(true, false);
    item.group.matrix.copy(this.group.matrixWorld).invert().multiply(parent.matrixWorld);
    item.group.matrixWorldNeedsUpdate = true;
  }

  _updateItem(item, json) {
    item.json = json;
    item.path = item.kind === 'path' ? this.app.timeline.pathModel(json) : null;
    item.channel = item.kind === 'pos' ? this.app.timeline.positionChannel(json) : null;
    // Channel interpolates components along straight segments; step segments have no connecting motion.
    item.samples = !hasDisplacement(json) ? [] : item.path ? this._sample(item.path, item.lift) : json.keys.flatMap((k, i) => {
      const next = json.keys[i + 1];
      if (!next || k.ease === 'step') return [];
      const length = Math.hypot(...next.value.map((v, n) => v - k.value[n]));
      const count = Math.max(1, Math.min(Math.ceil(MAX_SEG / (json.keys.length - 1)), Math.ceil(length * SEG_PER_M)));
      const samples = [];
      for (let j = 0; j < count; j++) for (const t of [j / count, (j + 1) / count]) {
        samples.push(...k.value.map((v, n) => v + (next.value[n] - v) * t + (n === 1 ? item.lift : 0)));
      }
      return samples;
    });
    if (item.samples.length >= 6) {
      if (!item.line) { item.line = this._line(item.samples, item.selected, { segments: item.kind === 'pos', color: item.color }); item.group.add(item.line); }
      else {
        const segments = item.kind === 'pos';
        const count = segments ? item.samples.length / 6 : item.samples.length / 3 - 1;
        const buffer = item.line.geometry.attributes.instanceStart.data;
        if (buffer.array.length !== count * 6) {
          item.line.geometry.dispose();
          item.line.geometry = segments ? new LineSegmentsGeometry() : new LineGeometry();
          item.line.geometry.setPositions(item.samples);
        } else {
          if (segments) buffer.array.set(item.samples);
          else for (let i = 0; i < count; i++) for (let n = 0; n < 6; n++) buffer.array[i * 6 + n] = item.samples[i * 3 + n];
          buffer.needsUpdate = true;
          item.line.geometry.computeBoundingBox(); item.line.geometry.computeBoundingSphere();
        }
      }
    }
    const points = this.points(json);
    if (item.selected) {
      if (!item.vertices.length) points.forEach((p, i) => {
        const m = this._screenMesh(this._discGeo, this._vertexMat(json.id, i, item.color), VERTEX_PX);
        m.renderOrder = 13; m.userData.vertex = i; item.vertices.push(m); item.group.add(m);
      });
      item.vertices.forEach((m, i) => { m.position.fromArray(points[i]); });
    }
    if (!item.marks && item.samples.length) {
      item.marks = [];
      const closed = json.closed || points[0].every((v, i) => Math.abs(v - points.at(-1)[i]) < 1e-5);
      const types = closed ? ['loop'] : ['start', 'end'];
      types.push(...Array(12).fill('arrow'));
      for (const type of types) {
        const mark = this._screenMesh(this._discGeo, discMat(item.color, type, true), type === 'arrow' ? 4 : MARKER_PX);
        mark.userData.type = type; item.marks.push(mark); item.group.add(mark);
      }
    }
    if (item.line && !item.edge) {
      item.edge = this._line(item.samples, true, { segments: item.kind === 'pos', color: item.color, opacity: .1, edge: true });
      item.group.add(item.edge);
    }
    if (item.edge) {
      item.edge.geometry.dispose(); item.edge.geometry = item.line.geometry.clone();
      item.edge.visible = item.selected;
    }
    this.update();
  }

  /** Screen spacing is recalculated as the director camera moves; path coordinates never change. */
  update() {
    if (!this.group.visible) return;
    const cam = this.app.getRenderCamera(), rect = this.app.stage.renderer.domElement.getBoundingClientRect();
    this.group.updateWorldMatrix(true, true);
    for (const it of this._items) {
      const S = it.samples;
      if (S.length < 6) continue;
      const projected = [], lengths = [0];
      let total = 0;
      for (let i = 0; i < S.length; i += 3) {
        const v = new THREE.Vector3(S[i], S[i + 1], S[i + 2]).applyMatrix4(it.group.matrixWorld).project(cam);
        const q = new THREE.Vector2(v.x * rect.width / 2, v.y * rect.height / 2);
        const prev = projected.at(-1);
        if (prev) { total += !(it.kind === 'pos' && i / 3 % 2 === 0) && v.z >= -1 && v.z <= 1 && prev.visible ? q.distanceTo(prev.q) : 0; lengths.push(total); }
        projected.push({ q, visible: v.z >= -1 && v.z <= 1 });
      }
      const count = Math.min(12, Math.max(1, Math.round(total / 110) - 1));
      let arrow = 0;
      for (const m of it.marks || []) {
        const type = m.userData.type;
        if (type !== 'arrow') {
          const i = type === 'end' ? S.length - 3 : 0;
          m.position.set(S[i], S[i + 1], S[i + 2]); continue;
        }
        m.visible = arrow < count && total > 12;
        if (!m.visible) continue;
        const d = total * (++arrow / (count + 1));
        let i = lengths.findIndex(l => l >= d); i = Math.max(1, i);
        const u = (d - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1);
        m.position.set(...[0, 1, 2].map(k => S[(i - 1) * 3 + k] + (S[i * 3 + k] - S[(i - 1) * 3 + k]) * u));
        const delta = projected[i].q.clone().sub(projected[i - 1].q);
        m.userData.angle = Math.atan2(delta.y, delta.x);
      }
    }
  }

  /** 按弧长均匀采样曲线（局部坐标，已抬高 LIFT）。 */
  _sample(path, lift = LIFT) {
    const n = Math.min(MAX_SEG, Math.max(SEG_PER_M, Math.ceil(path.length * SEG_PER_M)));
    const out = [];
    const distances = Array.from({ length: n + 1 }, (_, i) => i / n * path.length);
    if (path.json.interpolation === 'polyline') {
      for (let i = 0; i < path.json.points.length; i++) distances.push(path.vertexDistance(i));
      distances.sort((a, b) => a - b);
    }
    for (const distance of distances) {
      path.positionAt(distance, _v);
      out.push(_v.x, _v.y + lift, _v.z);
    }
    out.distances = distances;
    return out;
  }

  _disposeLine(o) {
    if (!o.isLineSegments2) return;
    o.geometry.dispose();
    this._lineMats.delete(o.material);
    o.material.dispose();
  }

  _line(samples, selected, { color = ACCENT, opacity = selected ? 1 : 0.8, segments = false, edge = false } = {}) {
    const geo = segments ? new LineSegmentsGeometry() : new LineGeometry();
    geo.setPositions(samples);
    const mat = new LineMaterial({
      color, linewidth: selected ? 1 : 0, transparent: true, opacity, fog: false, toneMapped: false,
      depthWrite: false,
    });
    // 在 GPU 上按每段两端的真实观察距离计算，跨段连续且随相机实时更新。
    // 选中线宽 2–6 CSS px，未选中 1.5–4.5 px；拾取仍使用独立 HIT_LINE_PX。
    mat.vertexShader = 'varying float vPathNear;\n' + mat.vertexShader.replace('offset *= linewidth;', `
      float distanceToEye = length((position.y < 0.5 ? start : end).xyz);
      vPathNear = 1.0 / (1.0 + pow(distanceToEye / 8.0, 2.0));
      offset *= mix(mix(1.5, 4.5, vPathNear), mix(2.0, 6.0, vPathNear), linewidth) + ${edge ? "3.0" : "0.0"};
    `);
    mat.fragmentShader = 'varying float vPathNear;\n' + mat.fragmentShader.replace(
      'vec4 diffuseColor = vec4( diffuse, alpha );',
      'vec4 diffuseColor = vec4(diffuse * mix(0.65, 1.0, vPathNear), alpha);',
    );
    this._lineMats.add(mat);
    this._syncResolution(mat);
    const line = segments ? new LineSegments2(geo, mat) : new Line2(geo, mat);
    line.computeLineDistances();
    line.renderOrder = edge ? 9 : 10;
    // Three Line2 normally overwrites resolution with device pixels in onBeforeRender.
    line.onBeforeRender = () => this._syncResolution(mat);
    return line;
  }

  _vertexMat(pathId, i, color = ACCENT) {
    const is = (h) => h && h.pathId === pathId && h.index === i;
    const sel = this.selection;
    const index = sel?.kind === 'pos' && sel.sourceId === pathId ? this.source(pathId)?.keys.findIndex(k => k.t === sel.keyTime) : sel?.index;
    return discMat(color, sel?.sourceId === pathId && index === i ? 'selected' : is(this.hover) ? 'hover' : 'node');
  }

  /** 固定屏幕尺寸的网格：渲染前按相机距离换算局部缩放。 */
  _screenMesh(geo, mat, px) {
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.userData.px = px; m.userData.currentPx = px; m.userData.fromPx = px; m.userData.transitionStart = performance.now();
    m.onBeforeRender = (renderer, scene, camera) => {
      m.parent.updateWorldMatrix(true, false);
      _w.setFromMatrixPosition(m.matrixWorld);
      const h = renderer.getSize(_v).y || 1;
      const d = camera.isPerspectiveCamera ? Math.abs(_w.clone().applyMatrix4(camera.matrixWorldInverse).z) : 1;
      const worldPerPx = camera.isPerspectiveCamera ? (2 * d * Math.tan((camera.fov * Math.PI) / 360)) / h : 0.01;
      const t = Math.min(1, (performance.now() - m.userData.transitionStart) / 120);
      m.userData.currentPx = m.userData.fromPx + (m.userData.px - m.userData.fromPx) * t;
      if (Math.abs(m.userData.currentPx - m.userData.px) > .01) this.app.stage.invalidate();
      const k = (m.userData.currentPx * worldPerPx) / (m.parent.getWorldScale(_s).y || 1);
      m.scale.setScalar(k);
      const parentQ = m.parent.getWorldQuaternion(new THREE.Quaternion());
      m.quaternion.copy(parentQ.invert().multiply(camera.getWorldQuaternion(new THREE.Quaternion())));
      if (m.userData.angle) m.rotateZ(m.userData.angle);
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
  setDraft(points, { closed = false, dots = true, interpolation } = {}) {
    for (const o of [...this.draftGroup.children]) { this.draftGroup.remove(o); this._disposeLine(o); }
    if (points?.length >= 2) {
      const path = new Path({ points, closed, interpolation, start: 0, duration: 1, speed: 'linear' });
      if (path.length > 1e-6) this.draftGroup.add(this._line(this._sample(path), true, { color: COLOR.hover, opacity: 0.9 }));
    }
    for (const p of dots ? points || [] : []) {
      const m = this._screenMesh(this._discGeo, this._mats.vertex, VERTEX_PX - 1);
      m.position.set(p[0], p[1] + LIFT, p[2]);
      m.renderOrder = 13;
      this.draftGroup.add(m);
    }
    this._applyVisible();
  }

  /** 运镜预览：虚线画出将要生成的路径（points 为 null 清空）。 */
  setMovePreview(points, { closed = false } = {}) {
    for (const o of [...this.moveGroup.children]) { this.moveGroup.remove(o); this._disposeLine(o); }
    if (points?.length >= 2) {
      const path = new Path({ points, closed, start: 0, duration: 1, speed: 'linear' });
      if (path.length > 1e-6) {
        const line = this._line(this._sample(path), true, { color: COLOR.hover, opacity: 0.95 });
        Object.assign(line.material, { dashed: true, dashSize: 0.12, gapSize: 0.08 });
        line.material.needsUpdate = true;
        this.moveGroup.add(line);
      }
    }
    this.app.stage.invalidate();
  }

  /** 当前运镜预览的曲线采样点数（selftest 用；0 = 无预览）。 */
  get movePreviewSize() { return this.moveGroup.children.length; }

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
      this._syncParent(it);
      it.group.visible = !this.app.cameraView && this.editable(it.json, t);
      if (it.path) it.path.positionAt(it.path.distanceAt(t), _v);
      else _v.fromArray(it.channel.evaluate(t));
      it.dot.position.set(_v.x, _v.y + it.lift, _v.z);
      it.dot.visible = this.app.timeline.active;
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
    this.group.visible = !this._hidden && !this.app.playback.playing && (!this.app.cameraView || this.draftGroup.children.length > 0);
    for (const item of this._items) item.group.visible = !this.app.cameraView && this.editable(item.json);
    this.moveGroup.visible = !this.app.cameraView;
    if (!this.group.visible || this.app.cameraView) { this.nameHint.hidden = true; this._hoverPathId = null; this.hover = null; }
    this.app.stage.invalidate();
  }

  /** 洁净渲染（截图 / 机位预览）期间临时隐藏。 */
  setHidden(v) { this._hidden = v; this._applyVisible(); this.app.emit('pathVisibility'); }

  get visible() { return this.group.visible; }

  /** 当前画出的路径条数。 */
  get itemCount() { return this._items.length; }

  // ---- 交互状态（顶点编辑用，非文档状态）----
  /** 轨迹选择是会话状态；删路径、换实体时自动清除，不写入文档。 */
  setSelection(selection) {
    if (JSON.stringify(selection) === JSON.stringify(this.selection)) return;
    this.selection = selection;
    this.hover = null;
    this._recolor();
    this.app.emit('pathSelection', this.selectedPathId);
    this.app.emit('pathVertex', this.selVertex);
    this.app.emit('motionSelection', selection);
  }

  setSelectedPath(sourceId) {
    if (sourceId === this.selectedPathId) return;
    const json = this.source(sourceId);
    if (sourceId && !json) return;
    this.setSelection(json ? { kind: json.points ? 'path' : 'pos', sourceId } : null);
    this.rebuild();
    if (json) this.app.emit('inspect', { id: json.target, section: 'path' });
  }

  setHover(h) {
    if (sameVertex(h, this.hover)) return;
    this.hover = h;
    this._recolor();
  }

  setSelectedVertex(v) {
    if (v) this.app.pathEditor.selectNode({ kind: 'path', sourceId: v.pathId, index: v.index });
    else if (this.selection) this.setSelection({ kind: this.selection.kind, sourceId: this.selection.sourceId });
  }

  _recolor() {
    for (const it of this._items) {
      it.selected = this.selectedPathId === it.json.id;
      for (const m of it.vertices) {
        m.material.dispose();
        m.material = this._vertexMat(it.json.id, m.userData.vertex, it.color);
        const px = m.material.userData.kind === 'selected' ? 6 : m.material.userData.kind === 'hover' ? 5 : 4;
        if (px !== m.userData.px) { m.userData.fromPx = m.userData.currentPx; m.userData.transitionStart = performance.now(); m.userData.px = px; }
      }
      if (it.edge) it.edge.visible = it.selected;
      const focus = this._hoverPathId || this.selectedPathId;
      if (it.line) {
        it.line.material.opacity = focus && focus !== it.json.id ? 0.25 : focus === it.json.id ? 1 : 0.8;
        it.line.material.linewidth = focus === it.json.id ? 1 : 0;
      }
    }
    this.app.stage.invalidate();
  }

  /** 拖动预览：只重画该路径（不写文档、不求值）。 */
  setPreview(sourceId, candidate) {
    const json = Array.isArray(candidate) ? { ...this.source(sourceId), points: candidate } : candidate;
    this._preview = { sourceId, source: json };
    const it = this._items.find(it => it.json.id === sourceId);
    if (it) this._updateItem(it, json);
    this.app.stage.invalidate();
  }

  clearPreview() {
    const id = this._preview?.sourceId;
    this._preview = null;
    const it = this._items.find(it => it.json.id === id), json = this.source(id);
    if (it && json) this._updateItem(it, json);
  }

  // ---- 命中测试（屏幕空间）----
  /**
   * clientX/Y 处命中的路径元素：顶点优先于曲线。返回
   * { kind:'vertex', pathId, target, index } | { kind:'line', pathId, target, point:[x,y,z], seg } | null。
   * 只测选中实体的顶点；曲线只对当前显示的已选中实体路径检测。
   */
  hitTest(clientX, clientY) {
    if (!this.group.visible || this.app.cameraView || !this._items.length) return null;
    const cam = this.app.getRenderCamera();
    const rect = this.app.stage.renderer.domElement.getBoundingClientRect();
    this.group.updateWorldMatrix(true, false);
    let mw = this.group.matrixWorld;
    const toScreen = (x, y, z) => {
      _v.set(x, y, z).applyMatrix4(mw).project(cam);
      if (_v.z > 1 || _v.z < -1) return null; // 相机背后
      return [rect.left + ((_v.x + 1) / 2) * rect.width, rect.top + ((1 - _v.y) / 2) * rect.height, _v.z];
    };

    let best = null;
    for (const it of this._items) {
      if (!it.selected || !it.group.visible || !this.editable(it.json)) continue;
      it.group.updateWorldMatrix(true, false); mw = it.group.matrixWorld;
      this.points(it.json).forEach((p, i) => {
        const s = toScreen(p[0], p[1], p[2]);
        if (!s) return;
        const d = Math.hypot(s[0] - clientX, s[1] - clientY);
        if (d <= HIT_VERTEX_PX && (!best || d < best.d - .25 || Math.abs(d - best.d) <= .25 && s[2] < best.depth)) best = { d, depth: s[2], kind: 'vertex', pathId: it.json.id, target: it.json.target, index: i, sourceKind: it.kind, keyTime: it.json.keys?.[i]?.t };
      });
    }
    if (best) { delete best.d; return best; }

    for (const it of this._items) {
      if (!it.group.visible || !this.editable(it.json)) continue;
      it.group.updateWorldMatrix(true, false); mw = it.group.matrixWorld;
      const S = it.samples;
      let prev = toScreen(S[0], S[1], S[2]);
      for (let i = 1; i < S.length / 3; i++) {
        if (it.kind === 'pos' && i % 2 === 0) { prev = toScreen(S[i*3], S[i*3+1], S[i*3+2]); continue; }
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
    return {
      kind: 'line', pathId: it.json.id, target: it.json.target,
      point: [lerp(0), lerp(1) - it.lift, lerp(2)],
      s: S.distances ? S.distances[i - 1] + (S.distances[i] - S.distances[i - 1]) * u : null, // 命中处的弧长
    };
  }

  /** 选中实体路径的 Path（运行时只读视图），供插入顶点时按弧长定位。 */
  pathOf(pathId) { return this._items.find((x) => x.json.id === pathId)?.path || null; }
}

/** Anti-aliased flat glyphs; geometry is shared, colors stay in linear space. */
function discMat(color, kind, depth = false) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthTest: depth, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { tint: { value: new THREE.Color(color) } },
    vertexShader: `varying vec2 glyphUV; void main() { glyphUV = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 glyphUV; uniform vec3 tint;
      float segmentDistance(vec2 p, vec2 a, vec2 b) {
        vec2 ab = b - a; return length(p - a - ab * clamp(dot(p-a, ab) / dot(ab,ab), 0.0, 1.0));
      }
      void main() {
        vec2 p = glyphUV; float r = length(p); float alpha; vec3 color = tint;
        ${kind === 'hover' ? 'color = mix(tint, vec3(1.0), .3);' : ''}
        ${kind === 'arrow' ? `float d = min(segmentDistance(p, vec2(-.5,.55), vec2(.4,0.0)), segmentDistance(p, vec2(-.5,-.55), vec2(.4,0.0)));
          alpha = 1.0 - smoothstep(.10,.23,d);` : kind === 'end' ? `vec2 q = abs(p) - .55; float d = length(max(q,0.0)) + min(max(q.x,q.y),0.0) - .25; alpha = 1.0 - smoothstep(-.06,.06,d);` : `alpha = 1.0 - smoothstep(.87,1.0,r);
          ${['start','loop'].includes(kind) ? `alpha *= max(smoothstep(.55,.68,r), 1.0-smoothstep(.22,.32,r));` : kind === 'selected' ? `color = mix(tint,vec3(.95),smoothstep(.65,.76,r));` : `color = mix(vec3(.93,.94,.98),color,smoothstep(.55,.7,r));`}
          ${kind === 'loop' ? 'if(p.x > .1 && p.y > .55) alpha = 0.0;' : ''}`}
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  mat.userData.kind = kind;
  return mat;
}

function segPx(x, y, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const len = abx * abx + aby * aby;
  const u = len > 0 ? Math.min(1, Math.max(0, ((x - a[0]) * abx + (y - a[1]) * aby) / len)) : 0;
  return { d: Math.hypot(x - a[0] - abx * u, y - a[1] - aby * u), u };
}

const sameVertex = (a, b) => (a ? !!b && a.pathId === b.pathId && a.index === b.index : !b);
