import * as THREE from 'three';
import { Character } from '../entities/Character.js';
import { Prop } from '../entities/Prop.js';
import { CameraEntity } from '../entities/Camera.js';
import { Crowd } from '../entities/Crowd.js';
import { CAMERA_PRESETS } from '../core/cameraPresets.js';
import { TransformGizmo } from '../core/TransformGizmo.js';
import { Selection } from '../core/Selection.js';
import { PathOverlay } from '../core/PathOverlay.js';
import { PathTool } from './PathTool.js';
import { PathEditor } from './PathEditor.js';
import { CameraMoveTool } from './CameraMoveTool.js';
import { BODY_TYPES, PROP_LABEL, RATIO_OPTIONS } from '../config.js';
import { Emitter } from '../util/Emitter.js';
import { toast } from '../util/dom.js';
import { worldBox } from '../util/measure.js';
import { ShotManager } from './ShotManager.js';
import { Panorama } from './Panorama.js';
import { Labels } from './Labels.js';
import { LabelSprites } from './LabelSprites.js';
import { toDocument, loadDocument } from '../doc/serialize.js';
import * as edit from '../doc/edit.js';
import { xyz } from '../util/round.js';
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
 *   'pov'       机位视角下出画机位变化（{ camera, main, unset }：时间轴 active 时透过主机位，见 _syncPov）
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
    this.cameraView = false;
    this.activeCameraId = null;    // 机位视角的当前机位（idle 时出画；active 时出画的是主机位，见 _syncPov）
    this.povCameraId = null;       // 机位视角下此刻实际出画的机位
    this._mainPreview = false;     // 正透过主机位看成片（gizmo 隐藏）
    this._povUnset = false;        // 机位视角 active 但没设主机位（视口提示）
    this.ratio = 'auto';           // 取景比例（默认自由）
    this.frameInsetRight = 0;      // 视口右侧被 AI 抽屉遮住的宽度（px），自动取景时扣掉
    this.labelPreview = false;     // 「预览名牌」：视口也用精灵名牌（会话态）
    this._cleanDepth = 0;          // 洁净渲染嵌套层数（>0 时 gizmo 等不显示）

    this._charSeq = 0;
    this._propCount = {};
    this._camCount = 0;
    this._groupCount = 0;

    // 场景级状态（供 ScenePanel 读取/回写）
    this.sceneState = {
      scale: 1, pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 },
      sky: 0x060608, labels: true,
      ground: { visible: true, opacity: 0.4, height: 0 },
    };

    // 场景文档：元信息；动画三字段（timeline / paths / constraints）由 Timeline 持有
    this.docMeta = { name: '未命名场景', createdAt: new Date().toISOString() };
    this.timeline = new Timeline(this);
    this.playback = new Playback(this.timeline, { invalidate: () => stage.invalidate() });
    this.autoKey = false;               // 自动打键（会话偏好，由时间轴面板写入）
    this._docChain = Promise.resolve(); // 文档加载串行化（连续撤销不会交错重建）
    this.loadingDocument = false;       // 加载期间为 true：history / 自动保存据此屏蔽
    this.history = new History(this);
    // 主机位播放（阶段 F）：机位视角下时间轴 active ↔ idle、主机位变化时切换出画机位
    this.timeline.on('active', () => this._syncPov());
    this.timeline.on('change', () => this._syncPov());

    const dom = stage.renderer.domElement;
    this.gizmo = new TransformGizmo(stage.camera, dom, stage.scene, rig.controls, () => !this.cameraView);
    // gizmo：拖动中只改 root（实时显示）；松手时按时间轴状态归属（idle 改手动值 / active 打键或改 base，见 edited）
    this.gizmo.onObjectChange(() => { this._gizmoMoved = true; this.emit('transform'); });
    this.gizmo.onDragState((dragging) => {
      if (dragging) {
        this._gizmoMoved = false;
        this.playback.pause(); // 播放中拖动会被逐帧求值覆盖：先暂停
      } else if (this._gizmoMoved && this.selected) {
        this.edited(this.selected, new Set([GIZMO_PROP[this.gizmo.control.mode]]));
        this.emit('transform');
      }
    });
    this.gizmo.onChange(() => stage.invalidate());
    this.selection = new Selection(stage.renderer, stage.camera, stage.scene, () => this.entities, (id) => this.select(id));
    rig.controls.addEventListener('change', () => stage.invalidate());
    this.pathOverlay = new PathOverlay(this); // 视口路径可视化（阶段 E）
    this.pathTool = new PathTool(this);       // 路径绘制
    this.pathEditor = new PathEditor(this);   // 顶点编辑
    this.pathMeta = {};                       // 会话态：pathId → 生成器参数（环绕三参数），不进文档
    this.moveMeta = {};                       // 会话态：cameraId → 运镜段列表（阶段 F），不进文档
    this.cameraMoves = new CameraMoveTool(this); // 机位运镜
    this.selection.setSkipPredicate(() => this.gizmo.dragging || this.gizmo.overAxis || this.pathTool.busy || this.pathEditor.busy);

    this.labels = new Labels(labelLayer);
    this.labelSprites = new LabelSprites(this); // 3D 精灵名牌：截图 / 导出 / 「预览名牌」（阶段 G）
    this.shots = new ShotManager(this);
    this.panorama = new Panorama(stage, {
      getSky: () => this.sceneState.sky,
      onChange: (applied, { silent } = {}) => {
        // 设背景后自动对准主体，避免主体被宏大背景比成小不点（仅导演视角；加载文档时不动视角）
        if (applied && !silent && !this.cameraView) this.frameSubjects();
        this.emit('scene');
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

  // ---- 新增 ----
  /** A…Z，之后 A2…Z2，依此类推（不会溢出成标点符号）。 */
  _nextCharName() { return edit.charName(this._charSeq++); }

  /** 加载一个角色（不入场）。所有角色都经此创建，保证 spec 完整、可复制。 */
  _loadCharacter(spec) { return Character.load(this._nextCharName(), spec); }

  /** 骨骼兼容性校验：缺关节时 console.warn 列出并返回提示文案；完整兼容返回 null。 */
  _rigWarning(c) {
    const miss = c.missingJoints || [];
    if (!miss.length) return null;
    console.warn(`[rig] ${c.profile?.id || '?'}（${c.spec.url}）缺少 ${miss.length} 个关节：`, miss.join(', '));
    return `该模型缺少 ${miss.length} 个关节，相关姿势滑条已禁用`;
  }

  /** 默认落点（edit.spawnPoint）：只改水平位置，y 保留站立基准偏移。入场时按当时的实体数算（并发添加不重叠）。 */
  _placeNew(root) {
    const [x, , z] = edit.spawnPoint(this.entities.length);
    root.position.x = x;
    root.position.z = z;
  }

  /** 入场登记：（可选）放置 → 加入场景 → 名牌 → 入列 → 选中 → 提示。 */
  _registerEntity(ent, { place = true, msg } = {}) {
    if (place) this._placeNew(ent.root);
    this.stage.add(ent.root);
    this.labels.attach(ent);
    this.entities.push(ent);
    this.emit('entities');
    this.select(ent.id);
    if (msg) toast(msg);
  }

  /** 新建角色：数据由 edit.addCharacter 生成（与 AI 同一份），再按条目建场景对象。 */
  async addCharacter(key) {
    if (!BODY_TYPES[key]) { toast('未知素体：' + key); return null; }
    toast('加载中：' + BODY_TYPES[key].label + ' …');
    const json = edit.addCharacter(this.toDocument({ view: false }), { name: this._nextCharName(), body: key });
    let c;
    try { c = await Character.fromJSON(json); }
    catch (err) { console.error(err); toast('角色加载失败：' + (err?.message || err)); return null; }
    this._registerEntity(c, { msg: this._rigWarning(c) || '已添加：' + c.name });
    return c;
  }

  addProp(kind) {
    this._propCount[kind] = (this._propCount[kind] || 0) + 1;
    const prop = new Prop(kind, PROP_LABEL[kind] + this._propCount[kind]);
    this._registerEntity(prop, { msg: '已添加：' + prop.name });
    return prop;
  }

  // ---- 群众阵列（组）----
  /**
   * 行×列网格生成 N 个男性素体（并行加载，模板只下载一次），挂在一个轴心组下。
   * 数据（夹取 / 网格 / 配色 / 起名）由 edit.addCrowd 生成（与 AI 同一份），再按条目建场景对象。
   */
  async addCrowd(rows = 3, cols = 3, spacing = edit.CROWD_SPACING) {
    const doc = this.toDocument({ view: false });
    const res = edit.addCrowd(doc, { rows, cols, spacing, memberName: () => this._nextCharName() });
    toast(`加载群众阵列 ${res.rows}×${res.cols} …`);
    const byId = new Map(doc.entities.map((e) => [e.id, e]));
    let crowd;
    try { crowd = await Crowd.fromJSON(res.group, { app: this, assets: {}, entity: (id) => byId.get(id) }); }
    catch (err) { console.error(err); toast('群众加载失败'); return null; }
    Object.assign(crowd, { rows: res.rows, cols: res.cols }); // 阵列规格（会话态，文档里不存）
    this._registerEntity(crowd, { msg: this._rigWarning(crowd.members[0]) || `已添加群众阵列（共 ${crowd.members.length} 人）` });
    return crowd;
  }

  /** 把若干已选角色打成一个组，保留各自世界位姿。 */
  groupCharacters(ids) {
    const members = (ids || [])
      .map((id) => this.entities.find((e) => e.id === id))
      .filter((e) => e && e.type === 'character');
    if (members.length < 2) { toast('请至少选择 2 个角色再打组'); return null; }

    this.timeline.release(members.map((m) => m.id)); // 先写回手动值，再改父节点
    // 轴心 = 成员 root 的世界中心换算到场景根坐标（场景被整体变换时也能对齐；含素体站立基准偏移，与以往一致）
    const centroid = new THREE.Vector3();
    for (const m of members) centroid.add(m.root.getWorldPosition(new THREE.Vector3()));
    centroid.divideScalar(members.length);
    this.stage.world.updateMatrixWorld(true);
    const pivot = xyz(this.stage.world.worldToLocal(centroid));
    // 数据（组条目 / 成员相对轴心的 transform）由 edit.groupCharacters 生成（与 AI 同一份），再按条目改父子关系
    const res = edit.groupCharacters(this.toDocument({ view: false }), members.map((m) => m.id), { name: '组' + (++this._groupCount), pivot });
    const group = new THREE.Group();
    const crowd = new Crowd(res.group.name, group, members, {}, res.group.id);
    crowd._applyTransform(res.group.transform);
    this.stage.add(group);
    members.forEach((m, i) => { group.add(m.root); m._applyTransform(res.members[i].transform); });
    this.timeline.dropTransformAnimation(members.map((m) => m.id)); // 成员改为相对组轴心的坐标系（同 edit.dropTransformAnim）
    this.entities = this.entities.filter((e) => !members.includes(e));
    this._registerEntity(crowd, { place: false });
    toast(`已打组：${members.length} 个角色 → ${crowd.name}`);
    return crowd;
  }

  /** 解组：把群众拆为独立角色（保留各自世界位姿），轴心组移除。 */
  ungroupCrowd(id) {
    const crowd = this.entities.find((e) => e.id === id && e.type === 'crowd');
    if (!crowd) return;
    this.timeline.release([crowd.id, ...crowd.members.map((m) => m.id)]); // 先写回手动值，再改父节点
    for (const m of crowd.release()) {
      this.stage.world.attach(m.root); // attach 保留世界变换
      this.entities.push(m);
    }
    this.stage.remove(crowd.root);
    this.entities.splice(this.entities.indexOf(crowd), 1);
    this.timeline.pruneEntities([crowd.id]);
    this.timeline.dropTransformAnimation(crowd.members.map((m) => m.id)); // 成员改回场景坐标系
    this.emit('entities');
    this.select(null);
    toast(`已解组：${crowd.members.length} 个角色已独立`);
  }

  // ---- 机位 ----
  /** 主体取景上下文：选中角色用骨骼包围盒量真实中心/高度，否则取场景中心。 */
  _cameraContext(subject) {
    const center = new THREE.Vector3(0, 0.85, 0);
    let height = 1.7;
    if (subject) {
      const box = worldBox(subject.root, { useBones: true });
      if (!box.isEmpty()) { box.getCenter(center); height = box.getSize(new THREE.Vector3()).y || 1.7; }
    }
    return {
      subjectCenter: center,
      subjectHeight: height,
      directorCamera: this.stage.camera,
      directorTarget: this.rig.controls.target.clone(),
    };
  }

  addCamera(presetKey) {
    const preset = CAMERA_PRESETS.find((p) => p.key === presetKey) || CAMERA_PRESETS[0];
    const subject = this.selected?.type === 'character' ? this.selected : null;
    const out = preset.build(this._cameraContext(subject));
    const fov = out.fov || preset.fov || 40;

    const c = new CameraEntity('机位' + (++this._camCount), { fov, aspect: this.viewportAspect(), scene: this.stage.scene });
    c.root.position.copy(out.position);
    c._roll = out.roll || 0;
    c.aimAt(out.target); // 相机约定看向 -Z，叠加荷兰角
    c.setHelpersVisible(!this.cameraView); // 机位视角下不应看到相机可视化
    this._registerEntity(c, { place: false, msg: '已添加机位：' + c.name + '（' + preset.label + '）' });
    return c;
  }

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
  select(id) {
    this.selectedId = id;
    this.selectedIds = id != null ? new Set([id]) : new Set();
    this._reflectPrimary();
  }

  /** Shift 多选：在多选集合中切换某实体；主选取为最后一次加入项。 */
  toggleSelect(id) {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
      if (this.selectedId === id) this.selectedId = [...this.selectedIds].pop() ?? null;
    } else {
      this.selectedIds.add(id);
      this.selectedId = id;
    }
    this._reflectPrimary();
  }

  /** gizmo 是否应显示：有可见的主选实体，且不是「POV 下正在透过它看的出画机位」。 */
  _gizmoShouldShow() {
    const ent = this.selected;
    if (!ent || !ent.visible || this._mainPreview || this._cleanDepth) return false; // 透过主机位 = 成片预览，不显示 gizmo
    return !(this.cameraView && ent.id === this.povCameraId);
  }

  /** 把 gizmo / 高亮环同步到主选实体，并广播选择变化。 */
  _reflectPrimary() {
    const ent = this.selected;
    if (ent) {
      this.gizmo.attach(ent.root);
      // 相机不支持缩放：若当前为 scale 则退回 rotate
      this.gizmo.setMode(ent.type === 'camera' && this.transformMode === 'scale' ? 'rotate' : this.transformMode);
      this.gizmo.setVisible(this._gizmoShouldShow());
    } else {
      this.gizmo.detach();
    }
    this.selection.highlight(ent);
    this.emit('selection', ent);
  }

  // ---- 批量操作（Outliner 右键菜单）----
  /** 创建副本：角色重新克隆并拷贝位姿/颜色/姿势；道具重建；位置略偏移避免重叠。 */
  async duplicateMany(ids) {
    const list = (ids || []).map((id) => this.findEntity(id)).filter(Boolean);
    let last = null;
    for (const ent of list) { const c = await this._duplicateOne(ent); if (c) last = c; }
    if (last) { this.emit('entities'); this.select(last.id); }
  }

  async _duplicateOne(ent) {
    let copy;
    if (ent.type === 'character') {
      try { copy = await this._loadCharacter(ent.spec); }
      catch (err) { console.error(err); toast('创建副本失败'); return null; }
      copy.copyPoseFrom(ent);
    } else if (ent.type === 'prop') {
      copy = new Prop(ent.kind, ent.name + '副本');
    } else {
      toast('暂不支持创建该类型的副本');
      return null;
    }
    // 群众成员的位姿相对轴心，复制品放到 world 下需换算成世界位姿
    ent.root.updateWorldMatrix(true, false);
    const m = new THREE.Matrix4().copy(this.stage.world.matrixWorld).invert().multiply(ent.root.matrixWorld);
    m.decompose(copy.root.position, copy.root.quaternion, copy.root.scale);
    copy.root.position.add(new THREE.Vector3(0.6, 0, 0.6));
    copy.setColor(ent.color);
    this.stage.add(copy.root);
    this.labels.attach(copy);
    this.entities.push(copy);
    return copy;
  }

  removeMany(ids) {
    for (const id of [...new Set(ids || [])]) this.remove(id);
  }

  /** 批量显隐：有任一可见则全部隐藏，否则全部显示。 */
  toggleVisibleMany(ids) {
    const list = (ids || []).map((id) => this.findEntity(id)).filter(Boolean);
    if (!list.length) return;
    const target = !list.some((e) => e.visible);
    for (const e of list) if (e.visible !== target) this.toggleVisible(e.id);
  }

  rename(id, name) {
    const ent = this.findEntity(id);
    const n = (name || '').trim();
    if (!ent || !n) return;
    ent.name = n;
    this.labels.rename(ent);
    this.emit('entities');
  }

  toggleVisible(id) {
    const ent = this.findEntity(id);
    if (!ent) return;
    ent.setVisible(!ent.visible);
    if (ent.id === this.selectedId) {
      this.gizmo.setVisible(this._gizmoShouldShow());
      this.selection.highlight(ent);
    }
    this.emit('entities');
  }

  /** 删除顶层实体或群众成员；删除机位时处理 POV 与截图。 */
  remove(id) {
    const ent = this.findEntity(id);
    if (!ent) return;
    const parent = this.entities.includes(ent) ? null : this.entities.find((e) => e.children.includes(ent));
    const wasSel = [ent, ...ent.children].some((e) => this.selectedIds.has(e.id));
    const parentSel = !!parent && this.selectedIds.has(parent.id);
    if (wasSel) this.select(null); // 先解绑 gizmo，避免它挂着已移出场景的对象

    if (parent) {
      parent.removeMember(ent);
      if (!parent.members.length) this.remove(parent.id); // 组被删空 → 连组一起删
    } else {
      this.stage.remove(ent.root);
      this.entities.splice(this.entities.indexOf(ent), 1);
    }
    this.labels.detach(ent);
    ent.dispose();
    this.timeline.pruneEntities([ent.id, ...ent.children.map((c) => c.id)]); // 引用它的轨道 / 路径 / 约束一并删除

    if (ent.type === 'camera') {
      this.shots.removeForCamera(ent.id);
      if (this.activeCameraId === ent.id) {
        this.activeCameraId = null;
        if (this.cameraView) {
          // 正在透过它看：切到另一个机位，没有则退回导演视角
          const next = this.cameras[0];
          if (next) this.setActiveCamera(next.id);
          else this.setCameraView(false);
        }
      }
    }
    this.emit('entities');
    if (parentSel && this.entities.includes(parent)) this.select(parent.id); // 刷新组面板人数
    toast('已删除：' + ent.name);
  }

  // ---- 变换模式 ----
  setTransformMode(mode) {
    if (mode === 'scale' && this.selected?.type === 'camera') { toast('相机不支持缩放'); return; }
    this.transformMode = mode;
    if (this.selected) { this.gizmo.setMode(mode); this.gizmo.setVisible(this._gizmoShouldShow()); }
    this.emit('mode', mode);
  }

  // ---- 视角 / 取景比例 ----
  // 取景框规则：'auto' = 全幅，不画取景框；仅当显式选定某比例时才显示对应取景框。
  _applyFrame() { this.rig.setRatio(this.ratio === 'auto' ? 'free' : this.ratio); }

  setRatio(str) {
    this.ratio = str;
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
    this.activeCameraId = ent.id;
    this._syncPov();
  }

  /**
   * 机位视角下实际出画的机位（阶段 F 主机位播放）：时间轴 active（播放或拖播放头）→ 主机位，
   * 未设主机位则用当前机位并提示；idle → 当前机位（activeCameraId）。导演视角不切换。
   * 透过主机位时 gizmo 隐藏（画面是成片预览），仍可选中其他实体。
   */
  _syncPov() {
    const tl = this.timeline;
    const main = this.cameraView && tl.active ? this.findCamera(tl.mainCameraId) : null;
    const ent = this.cameraView ? main || this.findCamera(this.activeCameraId) : null;
    if (ent && this.stage.activeCamera !== ent.cam) {
      ent.cam.aspect = this.viewportAspect();
      ent.cam.updateProjectionMatrix();
      this.stage.activeCamera = ent.cam;
      this._syncEditCamera();
    }
    const unset = this.cameraView && tl.active && !main;
    const id = ent?.id ?? null;
    if (this.povCameraId === id && this._mainPreview === !!main && this._povUnset === unset) return;
    this.povCameraId = id;
    this._mainPreview = !!main;
    this._povUnset = unset;
    this.gizmo.setVisible(this._gizmoShouldShow()); // 只在出画状态变化时同步（绘制 / 顶点拖动期间工具自己藏 gizmo）
    this.emit('pov', { camera: ent, main: !!main, unset });
  }

  /** 设置 POV 渲染相机（机位视角下立即生效）。 */
  setActiveCamera(id) {
    const ent = this.findCamera(id);
    if (!ent) return;
    if (this.cameraView) this._usePovCamera(ent);
    else this.activeCameraId = id;
    this.select(id);
  }

  setCameraView(on) {
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
      this.select(target.id);
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
  setSceneScale(s) { this.sceneState.scale = s; this.stage.setWorldScale(s); }
  setScenePos(axis, v) { this.sceneState.pos[axis] = v; const p = this.sceneState.pos; this.stage.setWorldPos(p.x, p.y, p.z); }
  setSceneRot(axis, deg) { this.sceneState.rot[axis] = deg; const r = this.sceneState.rot; const k = Math.PI / 180; this.stage.setWorldRot(r.x * k, r.y * k, r.z * k); }
  setSkyColor(hex) { this.sceneState.sky = new THREE.Color(hex).getHex(); this.stage.setSkyColor(hex); }
  /** 「预览名牌」：视口里也用 3D 精灵名牌（看导出效果）；会话态，不进文档。 */
  setLabelPreview(on) {
    if (!!on === !!this.labelPreview) return;
    this.labelPreview = !!on;
    if (on) this.labelSprites.enable(); else this.labelSprites.disable();
    this.emit('labelPreview', this.labelPreview);
  }
  setLabelsVisible(v) { this.sceneState.labels = v; this.labels.setVisible(v); this.stage.invalidate(); }
  setGroundVisible(v) { this.sceneState.ground.visible = v; this.stage.setGroundVisible(v); }
  setGroundOpacity(v) { this.sceneState.ground.opacity = v; this.stage.setGroundOpacity(v); }
  setGroundHeight(v) { this.sceneState.ground.height = v; this.stage.setGroundHeight(v); }

  // ---- 场景文档 ----
  /** 当前场景 → 文档（见 src/doc/schema.js）。opts.view=false 时不带导演视角（撤销快照用）。 */
  toDocument(opts) { return toDocument(this, opts); }

  /**
   * 文档 → 场景：校验通过且全部资源加载成功后，一次性替换当前场景；否则抛错、场景不变。
   * 多次调用按顺序串行执行。
   * @param {object} doc
   * @param {{applyView?:boolean, pruneShots?:boolean}} opts 见 serialize.loadDocument
   */
  loadDocument(doc, opts = {}) {
    const run = async () => {
      this.loadingDocument = true;
      try { return await loadDocument(this, doc, opts); }
      finally { this.loadingDocument = false; }
    };
    const p = this._docChain.then(run, run);
    this._docChain = p.catch(() => {});
    return p;
  }

  /** 清空场景专用路径：不经 remove()，因此不连带删截图、不切视角、不 toast。 */
  _clearEntities() {
    this.selectedId = null;
    this.selectedIds = new Set();
    this.gizmo.detach();
    this.selection.highlight(null);
    for (const ent of this.entities) {
      this.stage.remove(ent.root);
      this.labels.detach(ent);
      ent.dispose();
    }
    this.entities = [];
  }

  /** 由 serialize.loadDocument 调用：实体与全景都已就绪，同步替换（中间不会渲染出半个场景）。 */
  _commitDocument(doc, entities, panoHandle, { applyView = false, pruneShots = false } = {}) {
    const prevSel = this.selectedId;
    this._clearEntities();
    for (const ent of entities) {
      this.stage.add(ent.root);
      if (ent.type === 'camera') ent.attachScene(this.stage.scene);
      ent.setHelpersVisible(!this.cameraView);
      this.labels.attach(ent);
      this.entities.push(ent);
    }

    const s = doc.scene;
    this.setSceneScale(s.scale);
    ['x', 'y', 'z'].forEach((k, i) => { this.setScenePos(k, s.pos[i]); this.setSceneRot(k, s.rot[i]); });
    this.setSkyColor(s.sky);
    this.setLabelsVisible(s.labels);
    this.setGroundVisible(s.ground.visible);
    this.setGroundOpacity(s.ground.opacity);
    this.setGroundHeight(s.ground.height);
    this.ratio = s.ratio;
    this._applyFrame();
    this.panorama.commit(panoHandle, s.panorama || undefined);
    this.activeCameraId = s.activeCameraId;

    // 视角模式是会话态：保持导演/机位视角不变；机位视角下改用文档里的当前机位
    if (this.cameraView) {
      const cam = this.findCamera(this.activeCameraId) || this.cameras[0];
      if (cam) this._usePovCamera(cam);
      else this.setCameraView(false);
    }
    if (applyView) this._applyEditorView(doc.meta.editorView);

    this.docMeta = { name: doc.meta.name, createdAt: doc.meta.createdAt };
    this.timeline.fromJSON(doc);
    if (pruneShots) this.shots.pruneOrphans();
    this._bumpNameCounters();

    this.emit('entities');
    this.emit('scene');
    this.select(this.findEntity(prevSel) ? prevSel : null); // id 稳定：撤销后仍选中同一对象
    this.emit('document', doc);
  }

  /** 应用导演相机视角；文档没存视角时自动取景。 */
  _applyEditorView(view) {
    if (!view) { this.frameSubjects(); return; }
    this.stage.camera.position.fromArray(view.pos);
    this.rig.controls.target.fromArray(view.target);
    this.rig.controls.update();
    this.rig._home.pos.copy(this.stage.camera.position); // 「重置视角」回到存档时的视角
    this.rig._home.target.copy(this.rig.controls.target);
  }

  /** 起名计数器按已有名字推进（只增不减），避免导入后新建出重名的「角色A」「机位1」。 */
  _bumpNameCounters() {
    const all = this.entities.flatMap((e) => [e, ...e.children]);
    const propKind = Object.fromEntries(Object.entries(PROP_LABEL).map(([k, v]) => [v, k]));
    for (const { name } of all) {
      let m;
      if ((m = /^角色([A-Z])(\d*)$/.exec(name))) {
        const n = ((m[2] ? +m[2] : 1) - 1) * 26 + (m[1].charCodeAt(0) - 65) + 1;
        this._charSeq = Math.max(this._charSeq, n);
      } else if ((m = /^机位(\d+)$/.exec(name))) this._camCount = Math.max(this._camCount, +m[1]);
      else if ((m = /^组(\d+)$/.exec(name))) this._groupCount = Math.max(this._groupCount, +m[1]);
      else if ((m = /^(\D+?)(\d+)$/.exec(name)) && propKind[m[1]]) {
        const k = propKind[m[1]];
        this._propCount[k] = Math.max(this._propCount[k] || 0, +m[2]);
      }
    }
  }

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
      this.gizmo.setVisible(this._gizmoShouldShow());
      this.selection.setRingVisible(true);
      this.setCameraHelpersVisible(!this.cameraView);
      this.pathOverlay.setHidden(false);
    }
    this.stage.render();
  }

  /**
   * 自动对准主体：相机贴合所有角色/道具取景（默认加载时调用）。
   * 视口右侧被遮住的宽度（AI 抽屉打开时由 AiPanel 设 frameInsetRight，px）从可用视口里扣掉，抽屉关了恢复为 0。
   */
  frameSubjects() {
    const w = this.stage.renderer.domElement.clientWidth;
    this.rig.frameAll(this.entities, { insetRight: w > 0 ? this.frameInsetRight / w : 0 });
  }

  resetView() { this.rig.resetView(); toast('已重置视角'); }

  /**
   * 实体被 gizmo / 面板修改后（一次操作结束时）调用。时间轴 idle：什么都不做（root 就是手动值）。
   * 时间轴 active（阶段 D 3.3）：
   * - props 含 'pos' / 'rot' / 'scale' / 'fov' → Timeline.editAt：有轨道写当前时刻的键，无轨道按「自动打键」
   *   新建轨道写键或改手动值；被路径 / 跟随 / 注视驱动的属性不记并提示；
   * - props 省略（姿势 / 颜色等）→ refreshBase：改手动值。群众组连同成员一起（组面板的姿势广播到全部成员）。
   * @param {Set<string>} [props]
   */
  edited(ent, props) {
    if (!ent || !this.timeline.active) return null;
    if (!props) {
      for (const e of [ent, ...ent.children]) this.timeline.refreshBase(e);
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
    return res;
  }

  // ---- 每帧 ----
  /** 推进播放与相机阻尼；返回画面是否仍在动。 */
  tick() {
    const playing = this.playback.update();
    return this.rig.update() || playing;
  }

  /** 渲染前同步：视锥、选中环、名牌。 */
  beforeRender() {
    for (const ent of this.entities) ent.update();
    this.selection.update();
    this.labels.update(this.entities, this.getRenderCamera(), {
      worldScale: this.stage.world.scale.y,
      hideCameras: this.cameraView,
    });
    this.labelSprites.update();
  }
}
