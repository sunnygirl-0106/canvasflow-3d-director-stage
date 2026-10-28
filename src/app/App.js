import * as THREE from 'three';
import { TransformGizmo } from '../core/TransformGizmo.js';
import { Selection } from '../core/Selection.js';
import { PathOverlay } from '../core/PathOverlay.js';
import { PathTool } from './PathTool.js';
import { PathEditor } from './PathEditor.js';
import { CameraMoveTool } from './CameraMoveTool.js';
import { RATIO_OPTIONS } from '../config.js';
import { DocumentController } from './DocumentController.js';
import { EntityActions } from './EntityActions.js';
import { updateDraft } from '../doc/Store.js';
import { Emitter } from '../util/Emitter.js';
import { el, toast, pointerNDC } from '../util/dom.js';
import { worldBox } from '../util/measure.js';
import { ShotManager } from './ShotManager.js';
import { Panorama } from './Panorama.js';
import { Labels } from './Labels.js';
import { LabelSprites } from './LabelSprites.js';
import * as edit from '../doc/edit.js';
import { round6, clone } from '../util/math.js';
import { History } from './History.js';
import { Timeline } from '../anim/Timeline.js';
import { Playback } from '../anim/Playback.js';

const GIZMO_PROP = { translate: 'pos', rotate: 'rot', scale: 'scale' };
const PROP_NAME = { pos: '位置', rot: '旋转', scale: '缩放', fov: '视野' };

/**
 * 应用状态：实体清单 / 选择 / 视角（导演 ↔ 机位 POV）/ 场景参数，统筹增删选改。
 * 不直接操作 UI —— 状态变化通过事件广播，UI 自行订阅：
 *   'entities'  实体增删、改名、显隐
 *   'selection' 选择变化
 *   'transform' gizmo 拖动导致选中对象变换
 *   'mode'      变换模式（移动/旋转/缩放）
 *   'view'      导演视角 / 机位视角切换
 *   'pov'       机位视角下出画机位变化（{ camera, main, unset }，见 _syncPov）
 *   'scene'     场景级参数（全景等）变化
 *   'shots'     截图增删、勾选
 *   'document'  整份场景文档被加载（导入 / 撤销 / 恢复）
 * 任何事件都意味着画面可能变化，emit 时自动请求重绘。
 */
export class App extends Emitter {
  constructor({ stage, rig, labelLayer }) {
    super();
    this.stage = stage;
    this.rig = rig;

    this.entities = [];
    this.selectedId = null;        // 主选实体（右侧面板 / gizmo 作用对象）
    this.selectedIds = new Set();  // 多选集合（Shift 点击；恒包含 selectedId）
    this.transformMode = 'translate';
    this.transformEditing = false; // 程序默认选择只显示属性；明确选取/工具操作才激活手柄。
    this.defaultCameraId = null;
    this.directorDetached = true;
    this.cameraView = false;
    this.povCameraId = null;       // 机位视角下此刻实际出画的机位
    this.mainPreview = false;     // 正透过主机位看成片（gizmo 隐藏）
    this.povUnset = false;        // 机位视角 active 但没设主机位（视口提示）
    this.labelPreview = false;     // 「预览名牌」：视口也用精灵名牌（会话态）
    this._cleanDepth = 0;          // 洁净渲染嵌套层数（>0 时 gizmo 等不显示）

    this.charSeq = 0; // 下一个自动角色名的序号（edit.charName）；AI 编译也从这里接着起名
    this._propCount = {};
    this._camCount = 0;
    this._groupCount = 0;

    this.documents = new DocumentController(this);
    this.store = this.documents.store;
    this.entityActions = new EntityActions(this);
    this.timeline = new Timeline(this);
    this.playback = new Playback(this.timeline, { invalidate: () => stage.invalidate(), beforePlay: () => this._preparePlayback() });
    this.autoKey = false;               // 自动打键（会话偏好，由时间轴面板写入）
    this.loadingDocument = false;       // 加载期间为 true：history 据此屏蔽
    this.history = new History(this);
    // 时间轴只驱动实体；导演相机从此保持用户的观察位置。
    this.timeline.on('active', () => { if (this.timeline.active) this.directorDetached = true; this._syncPov(); });
    this.playback.on('state', (state) => {
      if (state !== 'playing') this.endPreview();
      if (state === 'playing') this.pathTool?.cancel();
      else { this.playbackCameraId = null; this._hidePlaybackHint(); }
      this.gizmo?.setVisible(this.gizmoShouldShow());
    });
    this.timeline.on('change', () => this._syncPov());

    const dom = stage.renderer.domElement;
    this._bindPlaybackLock();
    this._bindDirectorZoom();
    this.gizmo = new TransformGizmo(stage.camera, dom, stage.scene, rig.controls, () => !this.cameraView);
    // gizmo：拖动中只改 root（实时显示）；松手时按时间轴状态归属（idle 改手动值 / active 打键或改 base，见 edited）
    this.gizmo.onObjectChange(() => { if (this.gizmo.attached === this.pathEditor?.proxy) { this.pathEditor.onGizmoChange(); return; } this._gizmoMoved = true; this.emit('transform'); });
    this.gizmo.onDragState((dragging, cancelled) => {
      if (this.gizmo.attached === this.pathEditor?.proxy) { this.pathEditor.onGizmoDrag(dragging, cancelled); return; }
      if (dragging) {
        this._gizmoMoved = false;
        this.playback.pause(); // 播放中拖动会被逐帧求值覆盖：先暂停
      } else if (!cancelled && this._gizmoMoved && this.selected) {
        this.edited(this.selected, new Set([GIZMO_PROP[this.gizmo.control.mode]]));
        this.emit('transform');
      }
    });
    this.gizmo.onChange(() => stage.invalidate());
    this.selection = new Selection(stage.renderer, stage.camera, stage.scene, () => this.entities, (id) => this.select(id, { user: true }));
    // OrbitControls 的 change 只有处于用户手势内才表示主动脱离；程序更新与视角切换不算。
    let orbitGesture = false;
    rig.controls.addEventListener('start', () => { orbitGesture = true; });
    rig.controls.addEventListener('end', () => { orbitGesture = false; });
    rig.controls.addEventListener('change', () => {
      if (orbitGesture && !this.cameraView) this.directorDetached = true;
      stage.invalidate();
    });
    this.pathOverlay = new PathOverlay(this); // 视口路径可视化
    this.pathTool = new PathTool(this);       // 路径绘制
    this.pathEditor = new PathEditor(this);   // 顶点编辑
    this.pathMeta = {};                       // 会话态：pathId → 生成器参数（环绕三参数），不进文档
    this.moveMeta = {};                       // 会话态：cameraId → 运镜段列表，不进文档
    this.cameraMoves = new CameraMoveTool(this); // 机位运镜
    this.selection.setSkipPredicate(() => this.gizmo.dragging || (this.gizmo.visible && this.gizmo.overAxis) || this.pathTool.busy || this.pathEditor.busy);

    this.labels = new Labels(labelLayer);
    this.labelSprites = new LabelSprites(this); // 3D 精灵名牌：截图 / 导出 / 「预览名牌」
    this.shots = new ShotManager(this);
    this.panorama = new Panorama(stage, {
      getSky: () => this.sceneState.sky,
      getRevision: () => this.store.revision,
      onChange: (applied, { silent, parameters } = {}) => {
        if (!silent) this.store.transact('全景背景', (doc) => {
          const p = this.panorama;
          updateDraft(doc.assets, p.active ? { [p.assetId]: p.asset } : {});
          const value = p.active ? { assetId: p.assetId, rotation: round6(p.rotation), radius: round6(p.radius) } : null;
          if (doc.scene.panorama && value) updateDraft(doc.scene.panorama, value); else doc.scene.panorama = value;
        });
        // 设背景后自动对准主体，避免主体被宏大背景比成小不点（仅导演视角；加载文档时不动视角）
        if (applied && !silent && !this.cameraView) this.frameSubjects();
        if (!parameters) this.emit('scene');
      },
    });
  }

  emit(type, payload) {
    this.stage.invalidate();
    super.emit(type, payload);
  }

  // ---- 查找 ----
  /** 按 id 查实体：顶层实体及其子实体（群众成员）。 */
  findEntity(id) {
    for (const e of this.entities) {
      if (e.id === id) return e;
      for (const c of e.children) if (c.id === id) return c;
    }
    return null;
  }

  findCamera(id) { return this.entities.find((e) => e.id === id && e.type === 'camera') || null; }

  get selected() { return this.findEntity(this.selectedId); }
  get cameras() { return this.entities.filter((e) => e.type === 'camera'); }
  getRenderCamera() { return this.stage.activeCamera || this.stage.camera; }

  viewportAspect() {
    const v = this.stage.viewport;
    return v.clientWidth / Math.max(1, v.clientHeight);
  }

  addCharacter(key) { return this.entityActions.addCharacter(key); }
  addProp(kind) { return this.entityActions.addProp(kind); }
  addCrowd(rows, cols, spacing) { return this.entityActions.addCrowd(rows, cols, spacing); }
  groupCharacters(ids) { return this.entityActions.groupCharacters(ids); }
  ungroupCrowd(id) { return this.entityActions.ungroupCrowd(id); }
  addCamera(preset) { return this.entityActions.addCamera(preset); }

  /** 切换所有相机的可视化（相机体 + 视锥）。机位视角/截图时隐藏。 */
  setCameraHelpersVisible(v) {
    for (const ent of this.entities) ent.setHelpersVisible(v);
  }

  /** 一次性把某机位对准某对象中心。返回对准点。 */
  aimCameraAtObject(camId, entId) {
    const cam = this.findCamera(camId);
    const target = this.findEntity(entId);
    if (!cam || !target) return null;
    const box = worldBox(target.root, { useBones: target.type === 'character' });
    const center = box.isEmpty() ? target.root.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());
    cam.aimAt(center);
    this.edited(cam, new Set(['rot']));
    this.stage.invalidate();
    return center;
  }

  // ---- 选择 ----
  select(id, { activateTransform = true, user = false, preservePathEditing = false } = {}) {
    if (user) {
      this.userSelectedId = id;
      if (!preservePathEditing || id !== this.selectedId) this.pathOverlay?.setSelectedPath(null);
    }
    if (id !== this.selectedId) this.pathEditor?.cancel();
    this.transformEditing = id != null && activateTransform;
    this.selectedId = id;
    this.selectedIds = id != null ? new Set([id]) : new Set();
    this._reflectPrimary();
  }

  /** Shift 多选：在多选集合中切换某实体；主选取为最后一次加入项。 */
  toggleSelect(id) {
    this.pathOverlay?.setSelectedPath(null);
    this.transformEditing = true;
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
      if (this.selectedId === id) this.selectedId = [...this.selectedIds].pop() ?? null;
    } else {
      this.selectedIds.add(id);
      this.selectedId = id;
    }
    this.userSelectedId = this.selectedId;
    this._reflectPrimary();
  }

  /** gizmo 是否应显示：有可见的主选实体，且不是「POV 下正在透过它看的出画机位」。 */
  gizmoShouldShow() {
    const ent = this.selected;
    if (this.pathEditor?.hasPoint && this.pathOverlay.editable(this.pathEditor.source()) && this.pathOverlay?.visible && !this.cameraView && !this.pathTool?.mode && !this.playback.playing && !this._cleanDepth) return true;
    if (!this.transformEditing || this.playback.playing || this.pathTool?.busy || this.pathEditor?.drag || !ent || !ent.visible || this.mainPreview || this._cleanDepth || this.pathOverlay?.selectedPathId) return false; // 透过主机位 = 成片预览，不显示 gizmo
    return !(this.cameraView && ent.id === this.povCameraId);
  }

  /** 把 gizmo / 高亮环同步到主选实体，并广播选择变化。 */
  syncGizmo() {
    const point = this.pathEditor?.hasPoint && this.selectedIds.has(this.pathEditor.source()?.target);
    const ent = this.selected, target = point ? this.pathEditor.proxy : ent?.root;
    const leavingPoint = !point && this.gizmo.attached === this.pathEditor?.proxy;
    if (target) {
      if (this.gizmo.attached !== target) {
        if (point) this._entityGizmoSpace = this.gizmo.control.space;
        this.gizmo.attach(target);
      }
      this.gizmo.setMode(point ? 'translate' : ent.type === 'camera' && this.transformMode === 'scale' ? 'rotate' : this.transformMode);
      this.gizmo.setSpace(point ? 'world' : leavingPoint ? this._entityGizmoSpace || 'local' : this.gizmo.control.space);
      this.gizmo.setVisible(this.gizmoShouldShow());
    } else this.gizmo.detach();
  }

  _reflectPrimary() {
    const ent = this.selected;
    this.syncGizmo();
    this.selection.highlight(ent);
    this.emit('selection', ent);
  }

  // ---- 批量操作（Outliner 右键菜单）----
  duplicateMany(ids) { return this.entityActions.duplicateMany(ids); }

  removeMany(ids) { this._removeEntities('批量删除', [...new Set(ids || [])]); }

  /** 批量显隐：有任一可见则全部隐藏，否则全部显示。 */
  toggleVisibleMany(ids) {
    const list = (ids || []).map((id) => this.findEntity(id)).filter(Boolean);
    if (!list.length) return;
    const target = !list.some((e) => e.visible);
    this.store.batch('批量显隐', () => { for (const e of list) if (e.visible !== target) this.toggleVisible(e.id); });
  }

  rename(id, name) {
    const ent = this.findEntity(id);
    const n = (name || '').trim();
    if (!ent || !n) return;
    this.store.transact('改名', (doc) => { doc.entities.find((e) => e.id === id).name = n; });
  }

  toggleVisible(id) {
    this.store.transact('显隐', (doc) => {
      const ent = doc.entities.find((e) => e.id === id);
      if (!ent) return;
      ent.visible = !ent.visible;
      if (ent.type === 'group') for (const member of doc.entities) if (member.parent === id) member.visible = ent.visible;
    });
  }

  remove(id) {
    const ent = this.findEntity(id);
    if (!ent) return;
    this._removeEntities('删除实体', [id]);
    toast('已删除：' + ent.name);
  }

  /** 删除实体（连同引用它们的动画）；机位视角下改用剩余的第一个机位出画，没有机位则退出机位视角。 */
  _removeEntities(label, ids) {
    this.store.transact(label, (doc) => {
      for (const id of ids) edit.removeEntity(doc, id);
      if (this.cameraView && !doc.scene.activeCameraId) doc.scene.activeCameraId = doc.entities.find((e) => e.type === 'camera')?.id ?? null;
    });
    this.shots.pruneOrphans();
    if (this.cameraView && !this.cameras.length) this.setCameraView(false);
  }

  // ---- 变换模式 ----
  setTransformMode(mode) {
    if (this.pathEditor?.hasPoint) { if (mode !== 'translate') toast('运动节点仅支持世界轴平移'); return; }
    if (mode === 'scale' && this.selected?.type === 'camera') { toast('相机不支持缩放'); return; }
    this.transformEditing = true;
    this.transformMode = mode;
    if (this.selected) { this.gizmo.setMode(mode); this.gizmo.setVisible(this.gizmoShouldShow()); }
    this.emit('mode', mode);
  }

  // ---- 视角 / 取景比例 ----
  // 取景框规则：'auto' = 全幅，不画取景框；仅当显式选定某比例时才显示对应取景框。
  _applyFrame() {
    this.rig.setRatio(this.preview || this.ratio === 'auto' ? 'free' : this.ratio);
  }

  setRatio(str) {
    this.store.transact('取景比例', (doc) => { doc.scene.ratio = str; });
    this._applyFrame();
    const label = (RATIO_OPTIONS.find((o) => o[0] === str) || [str, str])[1];
    toast('取景比例：' + label);
  }

  /** 渲染相机变化时（进/出 POV、切换出画机位）把 gizmo 与拾取同步到当前渲染相机。 */
  _syncEditCamera() {
    const cam = this.getRenderCamera();
    this.gizmo.setCamera(cam);
    this.selection.camera = cam;
  }

  _usePovCamera(ent) {
    this.store.transact('当前机位', (doc) => { doc.scene.activeCameraId = ent.id; });
    this._syncPov();
  }

  /**
   * 播放出画独立于用户选择的编辑视角，退出临时预览后回导演观察。
   */
  _syncPov() {
    const tl = this.timeline;
    if (this.playback.playing && !this.findCamera(this.playbackCameraId)) this.playback.stop();
    const ent = this.preview ? this.findCamera(this.playbackCameraId) : this.cameraView ? this.findCamera(this.activeCameraId) : null;
    const main = ent && tl.active && ent.id === tl.mainCameraId;
    if (ent && this.stage.activeCamera !== ent.cam) {
      ent.cam.aspect = this.viewportAspect();
      ent.cam.updateProjectionMatrix();
      this.stage.activeCamera = ent.cam;
      this._syncEditCamera();
    }
    const unset = this.cameraView && tl.active && !this.findCamera(tl.mainCameraId);
    const id = ent?.id ?? null;
    if (this.povCameraId === id && this.mainPreview === !!main && this.povUnset === unset) return;
    this.povCameraId = id;
    this.mainPreview = !!main;
    this.povUnset = unset;
    this.gizmo.setVisible(this.gizmoShouldShow()); // 只在出画状态变化时同步（绘制 / 顶点拖动期间工具自己藏 gizmo）
    this.emit('pov', { camera: ent, main: !!main, unset });
  }

  /** 设置 POV 渲染相机（机位视角下立即生效）。 */
  setActiveCamera(id) {
    if (this.playback.playing) { this.showPlaybackHint(); return; }
    const ent = this.findCamera(id);
    if (!ent) return;
    if (this.cameraView) this._usePovCamera(ent);
    else this.store.transact('当前机位', (doc) => { doc.scene.activeCameraId = id; });
    this.select(id);
  }

  /** 所有播放入口（包括直接 play / 继续 / 重播）都先准备机位视角。 */
  _preparePlayback() {
    const target = this.findCamera(this.activeCameraId) || this.findCamera(this.timeline.mainCameraId) || this.cameras[0];
    if (!target) { toast('请先添加播放机位'); return false; }
    this.pathTool.cancel();
    this.pathEditor.cancel();
    // 清空未完成的环绕阻尼，再精确恢复当前导演观察状态；不更新 home 或文档。
    const camera = this.stage.camera;
    this._playbackDirector = { pos: camera.position.clone(), target: this.rig.controls.target.clone(),
      quaternion: camera.quaternion.clone(), fov: camera.fov, zoom: camera.zoom };
    this.rig.applyView(this._playbackDirector.pos, this._playbackDirector.target, camera.fov);
    camera.position.copy(this._playbackDirector.pos);
    camera.quaternion.copy(this._playbackDirector.quaternion);
    this.playbackCameraId = target.id;
    this.directorDetached = true;
    this.rig.controls.enabled = false;
    this.preview = true;
    this.labelSprites.enable();
    this.beginCleanRender();
    this._applyFrame();
    this._syncPov();
    return true;
  }

  startPreview() { return this.playback.play(); }

  _bindPlaybackLock() {
    const viewport = this.stage.viewport, canvas = this.stage.renderer.domElement;
    this.playbackHint = el('div', { class: 'playback-lock-hint', role: 'status', hidden: true }, '播放中已锁定机位视角，暂停后可自由查看');
    viewport.appendChild(this.playbackHint);
    let drag = null;
    viewport.addEventListener('pointerdown', e => {
      if (!this.playback.playing || e.target !== canvas) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, shown: false };
      e.preventDefault(); e.stopPropagation();
    }, true);
    viewport.addEventListener('pointermove', e => {
      if (!this.playback.playing || !drag || drag.id !== e.pointerId) return;
      if (!drag.shown && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) {
        drag.shown = true; this.showPlaybackHint();
      }
      e.stopPropagation();
    }, true);
    const release = () => { drag = null; };
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    viewport.addEventListener('wheel', e => {
      if (!this.playback.playing || e.target !== canvas) return;
      e.preventDefault(); e.stopPropagation(); this.showPlaybackHint();
    }, { capture: true, passive: false });
  }

  showPlaybackHint() {
    if (!this.playbackHint.hidden) return;
    this.playbackHint.hidden = false;
    this._playbackHintTimer = setTimeout(() => this._hidePlaybackHint(), 2200);
  }

  _bindDirectorZoom() {
    const ray = new THREE.Raycaster(), pointer = new THREE.Vector2(), offset = new THREE.Vector3();
    const canvas = this.stage.renderer.domElement;
    let lastHint = 0;
    this.stage.viewport.addEventListener('wheel', e => {
      if (this.playback.playing || this.cameraView || e.target !== canvas) return;
      e.preventDefault(); e.stopPropagation();
      const controls = this.rig.controls;
      const camera = this.stage.camera;
      if (e.deltaY > 0) {
        offset.copy(camera.position).sub(controls.target);
        camera.position.copy(controls.target).addScaledVector(offset, Math.min(controls.maxDistance / offset.length(), Math.exp(e.deltaY * 0.0015)));
        controls.update();
        return;
      }
      if (e.deltaY === 0) return;
      ray.setFromCamera(pointerNDC(canvas, e.clientX, e.clientY, pointer), camera);
      const subjects = this.entities.filter(ent => ent.visible && (ent.type === 'character' || ent.type === 'group')).map(ent => ent.root);
      const hit = ray.intersectObjects(subjects, true)[0];
      const anchor = hit?.point || controls.target;
      const distance = camera.position.distanceTo(anchor);
      if (distance <= controls.minDistance + 0.005) {
        if (performance.now() - lastHint > 1800) { toast('已到最近距离'); lastHint = performance.now(); }
        return;
      }
      const next = Math.max(controls.minDistance, distance * Math.exp(e.deltaY * 0.0015));
      const fraction = 1 - next / distance;
      camera.position.lerp(anchor, fraction);
      if (hit) controls.target.lerp(anchor, fraction);
      controls.update();
    }, { capture: true, passive: false });
  }

  _hidePlaybackHint() {
    clearTimeout(this._playbackHintTimer);
    if (this.playbackHint) this.playbackHint.hidden = true;
  }

  endPreview() {
    // pause 的 state 回调负责退出；不要在退出回调中再次 pause。
    if (this.playback.playing) { this.playback.pause(); return; }
    if (!this.preview) return;
    this.preview = false;
    this.playbackCameraId = null;
    this.cameraView = false;
    this.stage.activeCamera = null;
    const saved = this._playbackDirector;
    this._playbackDirector = null;
    if (saved) {
      this.rig.applyView(saved.pos, saved.target, saved.fov);
      this.stage.camera.position.copy(saved.pos);
      this.stage.camera.quaternion.copy(saved.quaternion);
      this.stage.camera.zoom = saved.zoom;
      this.stage.camera.updateProjectionMatrix();
      this.stage.camera.updateMatrixWorld(true);
    }
    this.rig.controls.enabled = true;
    this.endCleanRender();
    this.labelSprites.disable();
    this._applyFrame();
    this._syncPov();
    this._syncEditCamera();
    this.emit('view', false);
    this.stage.invalidate();
  }

  stopPreview() {
    this.playback.stop();
    this.endPreview();
    if (this.cameraView) this.setCameraView(false);
  }

  setCameraView(on) {
    if (this.playback.playing) { this.showPlaybackHint(); return; }
    this.endPreview();
    if (on) {
      // 选定出画机位：当前选中相机 > 上次 active > 第一个相机
      const sel = this.selected?.type === 'camera' ? this.selected : null;
      const target = sel || this.findCamera(this.activeCameraId) || this.cameras[0];
      if (!target) {
        toast('请先添加机位');
        this.emit('view', false); // 没机位：UI 退回导演视角标签
        return;
      }
      this.cameraView = true;
      this.rig.controls.enabled = false; // POV 固定，不可环绕
      this.setCameraHelpersVisible(false);
      this._usePovCamera(target);
      this._applyFrame();
      this.select(target.id, { activateTransform: false });
    } else {
      this.cameraView = false;
      this.stage.activeCamera = null;
      this.rig.controls.enabled = true;
      this.setCameraHelpersVisible(true);
      this._syncEditCamera();
      this._applyFrame();
      this._syncPov();
    }
    this.emit('view', this.cameraView);
  }

  // ---- 场景级参数（ScenePanel）----
  get ratio() { return this.store.document.scene.ratio; }
  get activeCameraId() { return this.store.document.scene.activeCameraId; }
  get docMeta() { return this.store.document.meta; }
  get sceneState() {
    const s = this._scenePreview || this.store.document.scene;
    const vec = ([x, y, z]) => ({ x, y, z });
    return { ...s, pos: vec(s.pos), rot: vec(s.rot), sky: parseInt(s.sky.slice(1), 16) };
  }

  sceneEdit(recipe, { preview = false } = {}) {
    if (preview) {
      this._scenePreview ||= clone(this.store.document.scene);
      recipe(this._scenePreview);
      this.documents.applyScene(this._scenePreview);
      this.stage.invalidate();
    } else this.store.transact('场景参数', (doc) => recipe(doc.scene));
  }
  commitScenePreview() {
    const preview = this._scenePreview;
    this._scenePreview = null;
    if (preview) this.store.transact('场景参数', (doc) => updateDraft(doc.scene, preview));
  }
  setSceneScale(v, opts) { this.sceneEdit((s) => { s.scale = round6(v); }, opts); }
  setScenePos(axis, v, opts) { this.sceneEdit((s) => { s.pos['xyz'.indexOf(axis)] = round6(v); }, opts); }
  setSceneRot(axis, v, opts) { this.sceneEdit((s) => { s.rot['xyz'.indexOf(axis)] = round6(v); }, opts); }
  setSkyColor(hex, opts) { this.sceneEdit((s) => { s.sky = '#' + new THREE.Color(hex).getHexString(); }, opts); }
  /** 「预览名牌」：视口里也用 3D 精灵名牌（看导出效果）；会话态，不进文档。 */
  setLabelPreview(on) {
    if (!!on === !!this.labelPreview) return;
    this.labelPreview = !!on;
    if (on) this.labelSprites.enable(); else this.labelSprites.disable();
    this.emit('labelPreview', this.labelPreview);
  }
  setLabelsVisible(v) { this.sceneEdit((s) => { s.labels = v; }); }
  setGroundVisible(v) { this.sceneEdit((s) => { s.ground.visible = v; }); }
  setGroundOpacity(v, opts) { this.sceneEdit((s) => { s.ground.opacity = round6(v); }, opts); }
  setGroundHeight(v, opts) { this.sceneEdit((s) => { s.ground.height = round6(v); }, opts); }

  exportDocument(opts) { this.pathEditor?.cancel(); return this.documents.export(opts); }
  loadDocument(doc, opts) { this.pathEditor?.cancel(); this.pathOverlay?.setSelectedPath(null); return this.documents.load(doc, opts); }

  // ---- 洁净渲染（截图 / 机位预览 / 导出）----
  /**
   * 在隐藏 gizmo / 选中环 / 相机可视化 / 路径 overlay、名牌改为 3D 精灵的状态下执行 fn（通常是 stage.snapshot），
   * 结束后恢复并立即重绘主视图，屏幕上不会闪出离屏帧。
   */
  withCleanRender(fn) {
    this.beginCleanRender();
    try {
      return fn();
    } finally {
      this.endCleanRender();
    }
  }

  /**
   * 跨异步的洁净渲染区间（导出视频逐帧 await 用），须与 endCleanRender 成对；可嵌套（最外层结束才恢复）。
   * labels=false：本区间不画名牌（导出「名牌」开关关闭时）。
   */
  beginCleanRender({ labels = true } = {}) {
    this.pathEditor?.cancel();
    this._cleanDepth++;
    this.hideOverlays();
    this.labelSprites.beginClean({ labels });
  }

  /** 隐藏 gizmo / 选中环 / 相机可视化 / 路径 overlay（洁净渲染区间内，导出每帧渲染前再调一次防被事件重新显示）。 */
  hideOverlays() {
    this.gizmo.setVisible(false);
    this.selection.setRingVisible(false);
    this.setCameraHelpersVisible(false);
    this.pathOverlay.setHidden(true);
  }

  endCleanRender() {
    this.labelSprites.endClean();
    if (--this._cleanDepth <= 0) {
      this._cleanDepth = 0;
      this.gizmo.setVisible(this.gizmoShouldShow());
      this.selection.setRingVisible(true);
      this.setCameraHelpersVisible(!this.cameraView);
      this.pathOverlay.setHidden(false);
    }
    this.stage.render();
  }

  /** 自动对准主体；AI 胶囊和选项不改变取景区域。 */
  frameSubjects() { this.directorDetached = true; this.rig.frameAll(this.entities); }

  /** 仅在载入时识别保存的同构图；不逐帧比较浮点位置猜测用户意图。 */
  restoreDirectorSync(view) {
    const ent = this.findCamera(this.timeline.mainCameraId);
    if (!ent || view.fov == null) return;
    ent.root.updateWorldMatrix(true, true);
    const position = ent.cam.getWorldPosition(new THREE.Vector3());
    const direction = ent.cam.getWorldDirection(new THREE.Vector3());
    const savedDirection = new THREE.Vector3().fromArray(view.target).sub(new THREE.Vector3().fromArray(view.pos)).normalize();
    if (position.distanceTo(this.stage.camera.position) > 1e-5 || direction.distanceTo(savedDirection) > 1e-5 || Math.abs(ent.fov - view.fov) > 1e-6) return;
    // 仅同构图存档绑定机位；独立导演视角的 reset 应回到自己的 home。
    this.defaultCameraId = ent.id;
    this.directorDetached = false;
    this.syncDirectorCamera();
  }

  /** 同步真实世界位姿和投影；控制器目标沿真实前向，兼容旋转和场景变换。 */
  syncDirectorCamera() {
    const ent = !this.directorDetached && this.findCamera(this.defaultCameraId);
    if (!ent || this._cleanDepth) return;
    ent.root.updateWorldMatrix(true, true);
    const camera = this.stage.camera;
    const position = ent.cam.getWorldPosition(new THREE.Vector3());
    const distance = Math.max(1.5, position.distanceTo(ent.lookTarget));
    const target = ent.cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(distance).add(position);
    camera.position.copy(position);
    this.rig.controls.target.copy(target);
    camera.quaternion.copy(ent.cam.getWorldQuaternion(new THREE.Quaternion()));
    camera.fov = ent.fov;
    camera.aspect = this.viewportAspect();
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    ent.cam.aspect = camera.aspect; ent.cam.updateProjectionMatrix();
  }

  resetView() {
    if (this.playback.playing) { this.showPlaybackHint(); return; }
    if (this.cameraView) this.setCameraView(false);
    if (this.findCamera(this.defaultCameraId)) {
      this.directorDetached = false;
      this.syncDirectorCamera();
      this.rig.saveHome();
    }
    this.rig.resetView();
    this.syncDirectorCamera();
    toast('已重置视角');
  }

  /**
   * 实体被 gizmo / 面板修改后（一次操作结束时）调用。时间轴 idle：把指定实体的手动值提交到 Store。
   * 时间轴 active：
   * - props 含 'pos' / 'rot' / 'scale' / 'fov' → Timeline.editAt：有轨道写当前时刻的键，无轨道按「自动打键」
   *   新建轨道写键或改手动值；被路径 / 跟随 / 注视驱动的属性不记并提示；
   * - props 省略（姿势 / 颜色等）→ refreshBase：改手动值。群众组连同成员一起（组面板的姿势广播到全部成员）。
   * @param {Set<string>} [props]
   */
  edited(ent, props) { return this.store.batch('修改实体', () => this._edited(ent, props)); }

  _edited(ent, props) {
    if (!ent || this.findEntity(ent.id) !== ent) return null;
    if (props?.has('pos') && this.timeline.paths.some(p => p.target === ent.id)
      && (!this.timeline.active || this.timeline.forcedProps(ent.id, this.playback.time).get('pos') === '路径')) {
      this.timeline.translatePathTo(ent, this.timeline.valueOf(ent, 'pos'));
      if (props.size === 1) return null;
      props = new Set([...props].filter(p => p !== 'pos'));
    }
    if (!this.timeline.active) {
      this.documents.commitEntities([ent, ...ent.children]);
      return null;
    }
    if (!props) {
      for (const e of [ent, ...ent.children]) this.timeline.refreshBase(e);
      this.documents.commitEntities([ent, ...ent.children]);
      return null;
    }
    let res = null;
    try { res = this.timeline.editAt(ent, props, this.playback.time, { autoKey: this.autoKey }); }
    catch (err) {
      console.warn(err);
      toast(err?.errors?.[0] || err?.message || String(err));
      this.timeline.evaluate(this.timeline.time); // 回到求值结果，不留未记录的修改
      return null;
    }
    if (res.blocked.length) {
      const by = [...new Set(res.blocked.map(([, src]) => src))].join(' / ');
      toast(`${res.blocked.map(([p]) => PROP_NAME[p]).join('、')}由${by}驱动，修改未记录`);
    }
    this.documents.commitEntities([ent, ...ent.children]);
    return res;
  }

  // ---- 每帧 ----
  /** 推进播放与相机阻尼；返回画面是否仍在动。 */
  tick() {
    const playing = this.playback.update();
    return (this.rig.controls.enabled && this.rig.update()) || playing;
  }

  /** 渲染前同步：视锥、选中环、名牌。 */
  beforeRender() {
    this.pathEditor?.flushPreview();
    this.syncDirectorCamera();
    const [ratioWidth, ratioHeight] = this.ratio.split(':').map(Number);
    const aspect = this.cameraView || this.ratio === 'auto' ? this.viewportAspect() : ratioWidth / ratioHeight;
    for (const ent of this.entities) {
      if (ent.type === 'camera' && !this._cleanDepth) {
        const effectiveAspect = ent.id === this.defaultCameraId && !this.directorDetached ? this.viewportAspect() : aspect;
        if (Number.isFinite(effectiveAspect) && ent.cam.aspect !== effectiveAspect) { ent.cam.aspect = effectiveAspect; ent.cam.updateProjectionMatrix(); }
      }
      ent.update();
      if (ent.type === 'camera') {
        ent.setMinimalHelpers(ent.id === this.defaultCameraId && !(this.transformEditing && this.selectedId === ent.id));
        ent.syncBodyVisibility(this.getRenderCamera());
        ent.helper.visible = ent.visible && ent._helpersOn && (ent.id === this.timeline.mainCameraId || this.selectedIds.has(ent.id));
      }
    }
    this.pathOverlay.update();
    this.selection.update();
    this.gizmo.updateSize();
    this.labels.update(this.entities, this.getRenderCamera(), {
      worldScale: this.stage.world.scale.y,
      hideCameras: this.cameraView,
    });
    this.labelSprites.update();
    if (this._cleanDepth) this.hideOverlays();
  }
}
