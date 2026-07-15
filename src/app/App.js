import * as THREE from 'three';
import { Character } from '../entities/Character.js';
import { Prop } from '../entities/Prop.js';
import { CameraEntity } from '../entities/Camera.js';
import { Crowd } from '../entities/Crowd.js';
import { CAMERA_PRESETS } from '../core/cameraPresets.js';
import { toast, el } from '../util/dom.js';
import { worldBox } from '../util/measure.js';
import { ShotManager } from './ShotManager.js';

// 体型素体注册表（单一事实来源）：一期全部由中性 Xbot 派生，按 height(身高) + girth(横向围度)
// 程序化缩放出 高/矮/胖/瘦 等"简单区分"。全部为 mixamorig 骨骼 → 姿势/动画对每种都生效。
const XBOT = './assets/Xbot.glb';
export const BODY_TYPES = {
  standard: { url: XBOT, label: '标准素体', height: 1.75, girth: 1.00 },
  tall:     { url: XBOT, label: '高大素体', height: 2.05, girth: 1.06 },
  small:    { url: XBOT, label: '矮小素体', height: 1.25, girth: 0.94 },
  broad:    { url: XBOT, label: '宽厚素体', height: 1.70, girth: 1.30 },
  slim:     { url: XBOT, label: '纤细素体', height: 1.78, girth: 0.80 },
};
const PROP_LABEL = { box: '方块', cylinder: '圆柱', sphere: '球体', mannequin: '人体素模' };
// 取景比例候选（§3.e）。'auto' 等价自由（导演视角不显示取景框）。
export const RATIO_OPTIONS = [
  ['auto', 'Auto（默认）'], ['21:9', '21:9'], ['16:9', '16:9'],
  ['4:3', '4:3'], ['1:1', '1:1'], ['3:4', '3:4'], ['9:16', '9:16'],
];

// 全景图限制（一期）：仅接受等距柱状（equirectangular）全景，宽:高 = 2:1。
// 非 2:1（局部/柱面全景、普通照片）贴到全景球会上下拉伸且盖不住天地，故拒绝并提示。
export const PANO_RATIO = 2;
export const PANO_RATIO_TOL = 0.05; // 相对容差 ±5% → 宽高比落在 [1.9, 2.1] 视为合法
// 按宽高判定是否 2:1 全景。拿不到尺寸时放行（极少见，避免误杀）。
// 供历史记录弹层（已知 w/h）与上传校验（图片元素）共用，单一事实来源。
export function isPanoRatio(w, h) {
  if (!w || !h) return true;
  return Math.abs(w / h - PANO_RATIO) <= PANO_RATIO * PANO_RATIO_TOL;
}
export function isEquirectImage(img) {
  return isPanoRatio(img?.naturalWidth || img?.width || 0, img?.naturalHeight || img?.height || 0);
}

// 应用状态机：entities[]、selectedId，统筹增删选改（§4 / §7）
export class App {
  constructor({ stage, rig, gizmo, selection, labelLayer, scenePanelEl, inspectorEl }) {
    this.stage = stage;
    this.rig = rig;
    this.gizmo = gizmo;
    this.selection = selection;
    this.labelLayer = labelLayer;
    this.scenePanelEl = scenePanelEl;
    this.inspectorEl = inspectorEl;

    this.entities = [];
    this.selectedId = null;        // 主选实体（右侧面板 / gizmo 作用对象）
    this.selectedIds = new Set();  // 多选集合（Shift 点击；恒与 selectedId 同步）
    this.transformMode = 'translate';
    this.cameraView = false;
    this.activeCameraId = null;   // 机位视角 POV 渲染的相机（§B.1）
    this.ratio = 'auto';          // 取景比例（字符串，默认自由）

    // 截图小王国（§C）：数据与操作都归 ShotManager
    this.shots = new ShotManager(this);

    this._charLetter = 0;
    this._propCount = {};
    this._camCount = 0;
    this._groupCount = 0;

    // 全景背景状态
    this.panoActive = false;
    this.panoramaInfo = null;     // { thumb, title }
    this._panoObjURL = null;      // 本地上传时的 ObjectURL（替换/清除时回收）

    // 场景级状态（供 ScenePanel 读取/回写）
    this.sceneState = {
      scale: 1, pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 },
      sky: 0x060608, labels: true,
      panoRot: 0, panoRadius: 60,
      ground: { visible: true, opacity: 0.4, height: 0 },
    };

    this.gizmo.onObjectChange(() => this.ui?.inspector?.syncFromObject());
    this.selection?.setSkipPredicate(() => this.gizmo.dragging || this.gizmo.overAxis);
    this._labelTmp = new THREE.Vector3();
  }

  attachUI(ui) { this.ui = ui; }

  /** 按 id 查实体：先查顶层 entities，再查各群众组的成员。 */
  _findEntity(id) {
    const top = this.entities.find((e) => e.id === id);
    if (top) return top;
    for (const e of this.entities) {
      if (e.type === 'crowd') { const m = e.members.find((x) => x.id === id); if (m) return m; }
    }
    return null;
  }

  get selected() { return this._findEntity(this.selectedId); }

  _placeNew(root) {
    const n = this.entities.length;
    const a = n * 0.95;
    const r = Math.min(0.9 + n * 0.4, 3.2);
    root.position.x = Math.cos(a) * r;
    root.position.z = Math.sin(a) * r;
  }

  /** 入场登记：放置→加入场景→（可选）名牌→入列→选中→刷新→提示。 */
  _registerEntity(ent, { label = false, msg } = {}) {
    this._placeNew(ent.root);
    this.stage.add(ent.root);
    if (label) this._makeLabel(ent);
    this.entities.push(ent);
    this.select(ent.id);
    this.ui?.outliner?.refresh();
    if (msg) toast(msg);
  }

  // ---- CRUD ----
  async _addCharacter(name, url, opts = {}) {
    toast('加载中：' + name + ' …');
    let c;
    try { c = await Character.load(name, url, opts); }
    catch (err) { console.error(err); toast('角色加载失败：' + (err?.message || err)); return null; }
    c._srcUrl = url; c._opts = opts; // 供「创建副本」重新加载
    this._registerEntity(c, { label: true, msg: '已添加：' + c.name });
    return c;
  }

  addCharacter(key) {
    const b = BODY_TYPES[key];
    if (!b) { toast('未知素体：' + key); return; }
    return this._addCharacter('角色' + String.fromCharCode(65 + this._charLetter++), b.url, { height: b.height, girth: b.girth });
  }

  addProp(kind) {
    this._propCount[kind] = (this._propCount[kind] || 0) + 1;
    const prop = new Prop(kind, PROP_LABEL[kind] + this._propCount[kind]);
    this._registerEntity(prop, { msg: '已添加：' + prop.name });
    return prop;
  }

  // ---- 群众阵列（组）----
  /** 行×列网格生成 N 个标准素体，挂在一个轴心组下，整组可一起变换。 */
  async addCrowd(rows = 3, cols = 3, spacing = 1.2) {
    rows = Math.max(1, Math.min(6, Math.round(rows)));
    cols = Math.max(1, Math.min(6, Math.round(cols)));
    spacing = Math.max(0.5, Math.min(5, spacing));
    const b = BODY_TYPES.standard;
    const PALETTE = [0x4f8ef7, 0xff9f43, 0xee5253, 0x10ac84, 0xfeca57, 0xa55eea, 0x00d2d3, 0xff6b9d, 0x9b59b6];
    const group = new THREE.Group();
    const members = [];
    const w = (cols - 1) * spacing, d = (rows - 1) * spacing;
    toast(`加载群众阵列 ${rows}×${cols} …`);
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++, i++) {
        let ch;
        try { ch = await Character.load('角色' + String.fromCharCode(65 + this._charLetter++), b.url, { height: b.height, girth: b.girth }); }
        catch (err) { console.error(err); continue; }
        ch.setColor(PALETTE[i % PALETTE.length]);
        ch.root.position.set(c * spacing - w / 2, 0, r * spacing - d / 2);
        group.add(ch.root);
        members.push(ch);
      }
    }
    if (!members.length) { toast('群众加载失败'); return null; }
    const crowd = new Crowd(`群众 (${rows}x${cols})`, group, members, { rows, cols, spacing });
    for (const m of members) m.root.userData.entityId = crowd.id; // 视口点击成员 → 选中整组
    for (const m of members) this._makeLabel(m); // 群众名牌逐成员，不能并进 _registerEntity
    this._registerEntity(crowd, { msg: `已添加群众阵列（共 ${members.length} 人）` });
    return crowd;
  }

  /** 解组：把群众拆为独立角色（保留各自世界位姿），轴心组移除。 */
  ungroupCrowd(id) {
    const crowd = this.entities.find((e) => e.id === id);
    if (!crowd || crowd.type !== 'crowd') return;
    crowd.root.updateMatrixWorld(true); // 同步轴心与各成员的本地矩阵
    const members = crowd.members.slice();
    for (const m of members) {
      // 成员相对 world 的本地矩阵 = 轴心本地矩阵 ∘ 成员本地矩阵（二者同处 world 组下）
      const mat = new THREE.Matrix4().multiplyMatrices(crowd.root.matrix, m.root.matrix);
      this.stage.add(m.root); // 从轴心移到 world（Object3D.add 自动脱离原父级）
      mat.decompose(m.root.position, m.root.quaternion, m.root.scale);
      m.root.userData.entityId = m.id; // 恢复独立选择（之前被指到组）
      this.entities.push(m);
    }
    this.stage.remove(crowd.root);
    this.entities.splice(this.entities.indexOf(crowd), 1);
    this.select(null);
    this.ui?.outliner?.refresh();
    toast(`已解组：${members.length} 个角色已独立`);
  }

  // ---- 机位（§4.3）----
  _viewportAspect() {
    const W = this.stage.viewport.clientWidth, H = this.stage.viewport.clientHeight;
    return W / Math.max(1, H);
  }

  /** 主体取景上下文：选中角色用骨骼包围盒量真实中心/高度，否则取场景中心。 */
  _cameraContext(subject) {
    const center = new THREE.Vector3();
    let height = 1.7;
    if (subject) {
      const box = worldBox(subject.root, { useBones: true });
      if (!box.isEmpty()) { box.getCenter(center); height = box.getSize(new THREE.Vector3()).y || 1.7; }
    } else {
      center.set(0, 0.85, 0);
    }
    return {
      subjectCenter: center,
      subjectHeight: height,
      directorCamera: this.stage.camera,
      directorTarget: this.rig.controls.target.clone(),
      sceneCenter: new THREE.Vector3(0, 0.85, 0),
    };
  }

  addCamera(presetKey) {
    const preset = CAMERA_PRESETS.find((p) => p.key === presetKey) || CAMERA_PRESETS[0];
    const subject = this.selected?.type === 'character' ? this.selected : null;
    const ctx = this._cameraContext(subject);
    const out = preset.build(ctx);
    const fov = out.fov || preset.fov || 40;

    const c = new CameraEntity('机位' + (++this._camCount), { fov, aspect: this._viewportAspect(), scene: this.stage.scene });
    c.root.position.copy(out.position);
    c._roll = out.roll || 0;
    // 相机约定看向 -Z：用 lookAt 矩阵令 root 的 -Z 指向 target，并叠加荷兰角
    c.aimAt(out.target);

    this.stage.add(c.root);
    this._makeLabel(c);
    this.entities.push(c);
    // 截图/机位视角时不应看到相机可视化
    if (this.cameraView) { c.body.visible = false; c.helper.visible = false; }
    this.select(c.id);
    this.ui?.outliner?.refresh();
    toast('已添加机位：' + c.name + '（' + preset.label + '）');
    return c;
  }

  /** 切换所有相机实体的可视化（相机体 + 视锥）。截图/机位视角时隐藏。 */
  setCameraGizmoVisible(v) {
    for (const ent of this.entities) {
      if (ent.type !== 'camera') continue;
      const show = v && ent.visible;
      ent.body.visible = show;
      ent.helper.visible = show;
    }
  }

  /** 把导演视角聚焦到某机位（便于查看构图）。 */

  select(id) {
    this.selectedId = id;
    this.selectedIds = id != null ? new Set([id]) : new Set();
    this._reflectPrimary();
    this.ui?.outliner?.refresh();
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
    this.ui?.outliner?.refresh();
  }

  /** 渲染相机变化时（进/出 POV、切换出画机位）把 gizmo 与拾取同步到当前渲染相机。 */
  _syncEditCamera() {
    const cam = this.getRenderCamera();
    this.gizmo.setCamera(cam);
    if (this.selection) this.selection.camera = cam; // Selection._pick 用它做 setFromCamera
  }

  /** gizmo 是否应显示：有主选实体，且不是「POV 下选中正在透过它看的出画机位」。 */
  _gizmoShouldShow() {
    if (!this.selected) return false;
    return !(this.cameraView && this.selectedId === this.activeCameraId);
  }

  /** 把右侧面板 / gizmo / 高亮环同步到主选实体。 */
  _reflectPrimary() {
    const ent = this.selected;
    if (ent) {
      this.gizmo.attach(ent.root);
      // 相机不支持缩放：若当前为 scale 则退回 rotate
      const mode = ent.type === 'camera' && this.transformMode === 'scale' ? 'rotate' : this.transformMode;
      this.gizmo.setMode(mode);
      // POV 下角色/道具照常显示 gizmo；仅对「正在透过它看」的出画机位不显示
      this.gizmo.setVisible(this._gizmoShouldShow());
      this.scenePanelEl.hidden = true;
      this.inspectorEl.hidden = false;
      this.ui?.inspector?.show(ent);
    } else {
      this.gizmo.detach();
      this.inspectorEl.hidden = true;
      this.scenePanelEl.hidden = false;
    }
    // POV 下也显示脚下选中环作为选中反馈（截图/预览由洁净钩子隐藏，不进构图）
    this.selection.highlight(ent);
  }

  // ---- 多选批量操作（Outliner 右键菜单）----
  /** 把若干已选角色打成一个组（Crowd），保留各自世界位姿。 */
  groupCharacters(ids) {
    const members = (ids || [])
      .map((id) => this.entities.find((e) => e.id === id))
      .filter((e) => e && e.type === 'character');
    if (members.length < 2) { toast('请至少选择 2 个角色再打组'); return null; }

    // 轴心置于成员世界中心，再用 attach 保留各成员世界变换地挂入组
    const centroid = new THREE.Vector3();
    for (const m of members) { m.root.updateMatrixWorld(true); centroid.add(m.root.getWorldPosition(new THREE.Vector3())); }
    centroid.divideScalar(members.length);
    const group = new THREE.Group();
    group.position.copy(centroid);
    this.stage.add(group);
    group.updateMatrixWorld(true);
    for (const m of members) group.attach(m.root);

    const crowd = new Crowd('组' + (++this._groupCount), group, members);
    for (const m of members) m.root.userData.entityId = crowd.id; // 视口点成员 → 选整组
    this.entities = this.entities.filter((e) => !members.includes(e));
    this.entities.push(crowd);
    this.select(crowd.id);
    toast(`已打组：${members.length} 个角色 → ${crowd.name}`);
    return crowd;
  }

  /** 创建副本：角色重新加载并拷贝位姿/颜色/姿势；道具直接克隆；位置略偏移避免重叠。 */
  async duplicateMany(ids) {
    const list = (ids || []).map((id) => this._findEntity(id)).filter(Boolean);
    let last = null;
    for (const ent of list) { const c = await this._duplicateOne(ent); if (c) last = c; }
    if (last) this.select(last.id);
    this.ui?.outliner?.refresh();
  }

  async _duplicateOne(ent) {
    const OFF = new THREE.Vector3(0.6, 0, 0.6);
    if (ent.type === 'character') {
      if (!ent._srcUrl) { toast('该角色无法创建副本'); return null; }
      let c;
      try { c = await Character.load('角色' + String.fromCharCode(65 + this._charLetter++), ent._srcUrl, ent._opts || {}); }
      catch (err) { console.error(err); toast('创建副本失败'); return null; }
      c._srcUrl = ent._srcUrl; c._opts = ent._opts;
      c.root.position.copy(ent.root.position).add(OFF);
      c.root.quaternion.copy(ent.root.quaternion);
      c.root.scale.copy(ent.root.scale);
      c.setColor(ent.color);
      Object.assign(c.values, ent.values); c.applyPose();
      c.currentPreset = ent.currentPreset;
      this.stage.add(c.root); this._makeLabel(c); this.entities.push(c);
      return c;
    }
    if (ent.type === 'prop') {
      const p = new Prop(ent.kind, ent.name + '副本');
      p.root.position.copy(ent.root.position).add(OFF);
      p.root.quaternion.copy(ent.root.quaternion);
      p.root.scale.copy(ent.root.scale);
      p.setColor(ent.color);
      this.stage.add(p.root); this.entities.push(p);
      return p;
    }
    toast('暂不支持创建该类型的副本');
    return null;
  }

  /** 批量删除（多选）。 */
  removeMany(ids) {
    for (const id of [...new Set(ids || [])]) this.remove(id);
  }

  /** 批量显隐（多选）：有任一可见则全部隐藏，否则全部显示。 */
  toggleVisibleMany(ids) {
    const list = (ids || []).map((id) => this._findEntity(id)).filter(Boolean);
    if (!list.length) return;
    const target = !list.some((e) => e.visible);
    for (const e of list) if (e.visible !== target) this.toggleVisible(e.id);
  }

  rename(id, name) {
    const ent = this._findEntity(id);
    if (!ent || !name) return;
    ent.name = name.trim() || ent.name;
    this.ui?.outliner?.refresh();
    if (ent.id === this.selectedId) this.ui?.inspector?.refreshName();
    if (ent.labelEl) ent.labelEl.textContent = ent.name;
  }

  toggleVisible(id) {
    const ent = this._findEntity(id);
    if (!ent) return;
    ent.setVisible(!ent.visible);
    if (ent.labelEl) ent.labelEl.style.display = ent.visible && this.sceneState.labels ? 'block' : 'none';
    if (ent.id === this.selectedId) { this.gizmo.setVisible(ent.visible); this.selection.ring.visible = ent.visible; }
    // 机位视角下相机 body/helper 由视角逻辑统一隐藏，toggleVisible 不得重新点亮
    if (ent.type === 'camera' && this.cameraView) this.setCameraGizmoVisible(false);
    this.ui?.outliner?.refresh();
  }

  remove(id) {
    const idx = this.entities.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const ent = this.entities[idx];
    const wasSel = ent.id === this.selectedId || (ent.type === 'crowd' && ent.members.some((m) => m.id === this.selectedId));
    this.stage.remove(ent.root);
    if (ent.type === 'crowd') ent.members.forEach((m) => { if (m.labelEl) m.labelEl.remove(); });
    if (ent.labelEl) ent.labelEl.remove();
    ent.dispose();
    this.entities.splice(idx, 1);
    if (wasSel) this.select(null);
    else this.ui?.outliner?.refresh();
    toast('已删除：' + ent.name);
  }

  // ---- transform mode ----
  setTransformMode(mode) {
    if (mode === 'scale' && this.selected?.type === 'camera') { toast('相机不支持缩放'); return; }
    this.transformMode = mode;
    if (this.selected) { this.gizmo.setMode(mode); this.gizmo.setVisible(true); }
    this.ui?.dock?.reflectMode(mode);
  }

  // ---- view mode / ratio ----
  // 取景框规则：'auto' = 全幅，不画取景框（POV / 截图均所见即所得）；
  // 仅当显式选定某比例时才显示对应取景框。
  _applyFrame() {
    this.rig.setRatio(this.ratio === 'auto' ? 'free' : this.ratio);
  }

  get cameras() { return this.entities.filter((e) => e.type === 'camera'); }
  getRenderCamera() { return this.stage.activeCamera || this.stage.camera; }

  /** 设置 POV 渲染相机（机位视角下生效）。 */
  setActiveCamera(id) {
    const ent = this.entities.find((e) => e.id === id && e.type === 'camera');
    if (!ent) return;
    this.activeCameraId = id;
    if (this.cameraView) {
      ent.cam.aspect = this._viewportAspect();
      ent.cam.updateProjectionMatrix();
      this.stage.activeCamera = ent.cam;
      this._syncEditCamera(); // gizmo/拾取对齐到新出画相机投影
    }
    this.select(id);
  }

  _setNavGizmoVisible(v) {
    const nav = document.getElementById('navg');
    if (nav) nav.style.display = v ? 'block' : 'none';
  }

  setCameraView(on) {
    if (on) {
      // 选定 active：当前选中相机 > 上次 active > 第一个相机
      const sel = this.selected?.type === 'camera' ? this.selected : null;
      const target = sel || this.entities.find((e) => e.id === this.activeCameraId && e.type === 'camera') || this.cameras[0];
      if (!target) {
        toast('请先添加机位');
        this.ui?.dock?.reflectCameraView(false); // 没机位：退回导演视角标签
        return;
      }
      this.cameraView = true;
      this.activeCameraId = target.id;
      target.cam.aspect = this._viewportAspect();
      target.cam.updateProjectionMatrix();
      this.stage.activeCamera = target.cam;
      this.rig.controls.enabled = false; // POV 固定，不可环绕
      this._applyFrame();
      this.setCameraGizmoVisible(false);
      this._setNavGizmoVisible(false);
      this._syncEditCamera(); // gizmo/拾取切到出画相机（select 前先对齐）
      this.select(target.id); // 显示该相机面板
    } else {
      this.cameraView = false;
      this.stage.activeCamera = null;
      this.rig.controls.enabled = true;
      this._applyFrame();
      this.setCameraGizmoVisible(true);
      this._setNavGizmoVisible(true);
      this._syncEditCamera(); // gizmo/拾取切回导演相机
      if (this.selected) { this.gizmo.setVisible(this._gizmoShouldShow()); this.selection.highlight(this.selected); }
    }
    this.ui?.dock?.reflectCameraView(this.cameraView);
  }

  /** 一次性把某机位对准某对象中心（§B.3.5 / 澄清3）。返回对准点。 */
  aimCameraAtObject(camId, entId) {
    const cam = this.entities.find((e) => e.id === camId && e.type === 'camera');
    const target = this._findEntity(entId);
    if (!cam || !target) return null;
    const center = this._entityCenter(target);
    cam.aimAt(center);
    if (this.activeCameraId === camId && this.cameraView) this.stage.activeCamera = cam.cam;
    return center;
  }

  /** 取对象世界中心（角色用骨骼包围盒，其余用包围盒）。 */
  _entityCenter(ent) {
    const box = worldBox(ent.root, { useBones: ent.type === 'character' });
    return box.isEmpty()
      ? ent.root.getWorldPosition(new THREE.Vector3())
      : box.getCenter(new THREE.Vector3());
  }

  setRatio(str) {
    this.ratio = str;
    this._applyFrame();
    const label = (RATIO_OPTIONS.find((o) => o[0] === str) || [str, str])[1];
    toast('取景比例：' + label);
  }

  // ---- scene controls (ScenePanel) ----
  setSceneScale(s) { this.sceneState.scale = s; this.stage.setWorldScale(s); }
  setScenePos(axis, v) { this.sceneState.pos[axis] = v; const p = this.sceneState.pos; this.stage.setWorldPos(p.x, p.y, p.z); }
  setSceneRot(axis, deg) { this.sceneState.rot[axis] = deg; const r = this.sceneState.rot; const k = Math.PI / 180; this.stage.setWorldRot(r.x * k, r.y * k, r.z * k); }
  setSkyColor(hex) { this.sceneState.sky = new THREE.Color(hex).getHex(); this.stage.setSkyColor(hex); }
  setLabelsVisible(v) { this.sceneState.labels = v; this.labelLayer.style.display = v ? 'block' : 'none'; }
  setGroundVisible(v) { this.sceneState.ground.visible = v; this.stage.setGroundVisible(v); }
  setGroundOpacity(v) { this.sceneState.ground.opacity = v; this.stage.setGroundOpacity(v); }
  setGroundHeight(v) { this.sceneState.ground.height = v; this.stage.setGroundHeight(v); }

  // ---- 全景背景（§3.c）----
  // 统一入口：校验 2:1 后再应用。非 2:1 直接拒绝并提示，返回 false（由调用方决定成功 toast）。
  _applyPanoramaTexture(tex, info, objURL) {
    if (!isEquirectImage(tex.image)) {
      const w = tex.image?.naturalWidth || tex.image?.width || 0;
      const h = tex.image?.naturalHeight || tex.image?.height || 0;
      tex.dispose?.();
      if (objURL) URL.revokeObjectURL(objURL);
      toast(`仅支持 2:1 全景图（如 2048×1024）${w && h ? `，当前为 ${w}×${h}` : ''}`);
      return false;
    }
    tex.colorSpace = THREE.SRGBColorSpace;
    if (this._panoObjURL && this._panoObjURL !== objURL) URL.revokeObjectURL(this._panoObjURL);
    this._panoObjURL = objURL || null;
    this.stage.setPanorama(tex);
    this.panoActive = true;
    this.panoramaInfo = info;
    // 设背景后自动对准主体，避免主体被宏大背景比成小不点（导演视角下才动相机）
    if (!this.cameraView) this.frameSubjects();
    this.ui?.scenePanel?.render?.();
    return true;
  }
  setPanoramaFromFile(file) {
    const objURL = URL.createObjectURL(file);
    new THREE.TextureLoader().load(
      objURL,
      (tex) => { if (this._applyPanoramaTexture(tex, { thumb: objURL, title: file.name || '本地全景图' }, objURL)) toast('已设置全景背景'); },
      undefined,
      () => { URL.revokeObjectURL(objURL); toast('全景图加载失败'); },
    );
  }
  setPanoramaFromAsset(asset) {
    new THREE.TextureLoader().load(
      asset.url,
      (tex) => { if (this._applyPanoramaTexture(tex, { thumb: asset.thumb || asset.url, title: asset.title || '全景图' }, null)) toast('已设置全景背景：' + (asset.title || '')); },
      undefined,
      () => toast('全景图加载失败'),
    );
  }
  clearPanorama() {
    this.stage.clearPanorama(this.sceneState.sky);
    if (this._panoObjURL) { URL.revokeObjectURL(this._panoObjURL); this._panoObjURL = null; }
    this.panoActive = false;
    this.panoramaInfo = null;
    this.ui?.scenePanel?.render?.();
    toast('已移除全景背景');
  }
  setPanoramaRotation(deg) { this.sceneState.panoRot = deg; this.stage.setPanoramaRotation(deg); }
  setPanoramaRadius(r) { this.sceneState.panoRadius = r; this.stage.setPanoramaRadius(r); }

  // ---- capture / shots（§C）----
  // 渲染洁净钩子：隐藏 gizmo / 选中环 / 相机可视化 / 名牌，统一供截图与预览复用。
  _beginCleanRender() {
    this.gizmo.setVisible(false);
    this.selection.ring.visible = false;
    this.setCameraGizmoVisible(false);
    this._lblDisp = this.labelLayer.style.display;
    this.labelLayer.style.display = 'none';
  }
  _endCleanRender() {
    if (this._gizmoShouldShow()) this.gizmo.setVisible(true);
    this.selection.ring.visible = !!this.selected;
    this.setCameraGizmoVisible(!this.cameraView);
    this.labelLayer.style.display = this._lblDisp ?? 'block';
  }

  /** 自动对准主体：相机贴合所有角色/道具取景，主体占满画面（默认加载时调用）。 */
  frameSubjects() { this.rig.frameAll(this.entities); }

  resetView() { this.rig.resetView(); toast('已重置视角'); }

  // ---- labels ----
  _makeLabel(ent) {
    const d = el('div', { class: 'label3d' + (ent.type === 'camera' ? ' cam' : ''), text: ent.name });
    if (!this.sceneState.labels) d.style.display = 'none';
    this.labelLayer.appendChild(d);
    ent.labelEl = d;
  }
  _updateLabels() {
    if (!this.sceneState.labels) return;
    const cam = this.getRenderCamera(); // POV 下用 active 相机投影，名牌跟随出画相机
    const ws = this.stage.world.scale.y;
    const W = this.stage.viewport.clientWidth, H = this.stage.viewport.clientHeight;
    const place = (ent) => {
      if (!ent.labelEl) return;
      if (!ent.visible) { ent.labelEl.style.display = 'none'; return; }
      // 相机视角下隐藏相机名牌（与相机可视化一起隐藏）
      if (ent.type === 'camera' && this.cameraView) { ent.labelEl.style.display = 'none'; return; }
      // root.getWorldPosition 已含 world / 组轴心变换；头顶偏移按 world 缩放换算
      ent.root.getWorldPosition(this._labelTmp);
      const off = ent.type === 'camera' ? 0.2 : (ent.height + 0.16);
      this._labelTmp.y += off * ws;
      this._labelTmp.project(cam);
      const inFront = this._labelTmp.z < 1;
      ent.labelEl.style.display = inFront ? 'block' : 'none';
      ent.labelEl.style.left = (this._labelTmp.x * 0.5 + 0.5) * W + 'px';
      ent.labelEl.style.top = (-this._labelTmp.y * 0.5 + 0.5) * H + 'px';
    };
    for (const ent of this.entities) {
      if (ent.type === 'crowd') { ent.members.forEach(place); continue; }
      if (ent.type === 'character' || ent.type === 'camera') place(ent);
    }
  }

  // ---- per-frame ----
  tick(dt) {
    for (const ent of this.entities) {
      if (ent.type === 'character') ent.update(dt);
      else if (ent.type === 'camera') ent.update(); // CameraHelper 随相机世界矩阵刷新
      else if (ent.type === 'crowd') ent.members.forEach((m) => m.update(dt));
    }
    this.rig.update();
    this.selection.update();
    this._updateLabels();
  }
}
