import * as THREE from 'three';
import { Character } from '../entities/Character.js';
import { Prop } from '../entities/Prop.js';
import { CameraEntity } from '../entities/Camera.js';
import { CAMERA_PRESETS } from '../core/cameraPresets.js';
import { capture, downloadDataURL, sendToCanvas } from '../util/capture.js';
import { toast, el } from '../util/dom.js';

const MODEL_URLS = { Xbot: './assets/Xbot.glb', Soldier: './assets/Soldier.glb', Robot: './assets/Robot.glb' };
const PROP_LABEL = { box: '方块', cylinder: '圆柱', sphere: '球体', mannequin: '人体素模' };
// 取景比例候选（§3.e）。'auto' 等价自由（导演视角不显示取景框）。
export const RATIO_OPTIONS = [
  ['auto', 'Auto（默认）'], ['21:9', '21:9'], ['16:9', '16:9'],
  ['4:3', '4:3'], ['1:1', '1:1'], ['3:4', '3:4'], ['9:16', '9:16'],
];

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
    this.selectedId = null;
    this.transformMode = 'translate';
    this.cameraView = false;
    this.activeCameraId = null;   // 机位视角 POV 渲染的相机（§B.1）
    this.ratio = 'auto';          // 取景比例（字符串，默认自由）
    this.latestShot = null;

    // 截图数据模型（§C.1）：会话内存
    this.shots = [];              // { id, cameraId, cameraName, name, dataURL, createdAt }
    this.selectedShotIds = new Set();
    this._shotSeq = {};           // 每机位序号 { [cameraId]: n }
    this._shotCount = 0;

    this._charLetter = 0;
    this._propCount = {};
    this._camCount = 0;

    // 全景背景状态
    this.panoActive = false;
    this.panoramaInfo = null;     // { thumb, title }
    this._panoObjURL = null;      // 本地上传时的 ObjectURL（替换/清除时回收）

    // 场景级状态（供 ScenePanel 读取/回写）
    this.sceneState = {
      scale: 1, pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 },
      sky: 0x060608, labels: true, snap: false,
      panoRot: 0, panoRadius: 60,
      ground: { visible: true, opacity: 0.4, height: 0 },
    };

    this.gizmo.onObjectChange(() => this.ui?.inspector?.syncFromObject());
    this.selection?.setSkipPredicate(() => this.gizmo.dragging || this.gizmo.overAxis);
    this._labelTmp = new THREE.Vector3();
  }

  attachUI(ui) { this.ui = ui; }

  get selected() { return this.entities.find((e) => e.id === this.selectedId) || null; }

  _placeNew(root) {
    const n = this.entities.length;
    const a = n * 0.95;
    const r = Math.min(0.9 + n * 0.4, 3.2);
    root.position.x = Math.cos(a) * r;
    root.position.z = Math.sin(a) * r;
  }

  // ---- CRUD ----
  async _addCharacter(name, url) {
    toast('加载中：' + name + ' …');
    let c;
    try { c = await Character.load(name, url); }
    catch (err) { console.error(err); toast('角色加载失败：' + (err?.message || err)); return null; }
    this._placeNew(c.root);
    this.stage.add(c.root);
    this._makeLabel(c);
    this.entities.push(c);
    this.select(c.id);
    this.ui?.outliner?.refresh();
    toast('已添加：' + c.name);
    return c;
  }

  addCharacter(modelKey) {
    const url = MODEL_URLS[modelKey];
    if (!url) { toast('未知模型：' + modelKey); return; }
    return this._addCharacter('角色' + String.fromCharCode(65 + this._charLetter++), url);
  }

  addCharacterFromFile(file) {
    const url = URL.createObjectURL(file);
    return this._addCharacter('角色' + String.fromCharCode(65 + this._charLetter++), url)
      .finally(() => URL.revokeObjectURL(url));
  }

  addProp(kind) {
    this._propCount[kind] = (this._propCount[kind] || 0) + 1;
    const prop = new Prop(kind, PROP_LABEL[kind] + this._propCount[kind]);
    this._placeNew(prop.root);
    this.stage.add(prop.root);
    this.entities.push(prop);
    this.select(prop.id);
    this.ui?.outliner?.refresh();
    toast('已添加：' + prop.name);
    return prop;
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
      const box = new THREE.Box3();
      const p = new THREE.Vector3();
      let measured = false;
      subject.root.updateMatrixWorld(true);
      subject.root.traverse((o) => { if (o.isBone) { o.getWorldPosition(p); box.expandByPoint(p); measured = true; } });
      if (!measured) box.setFromObject(subject.root);
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
  focusCamera(id) {
    const ent = this.entities.find((e) => e.id === id);
    if (!ent || ent.type !== 'camera') return;
    this.rig.focus(ent);
    toast('已看向：' + ent.name);
  }

  select(id) {
    this.selectedId = id;
    const ent = this.selected;
    if (ent) {
      this.gizmo.attach(ent.root);
      // 相机不支持缩放：若当前为 scale 则退回 rotate
      const mode = ent.type === 'camera' && this.transformMode === 'scale' ? 'rotate' : this.transformMode;
      this.gizmo.setMode(mode);
      // 机位视角（POV）下不显示 gizmo / 选中环（人在画面里）
      this.gizmo.setVisible(!this.cameraView);
      this.scenePanelEl.hidden = true;
      this.inspectorEl.hidden = false;
      this.ui?.inspector?.show(ent);
    } else {
      this.gizmo.detach();
      this.inspectorEl.hidden = true;
      this.scenePanelEl.hidden = false;
    }
    this.selection.highlight(this.cameraView ? null : ent);
    this.ui?.outliner?.refresh();
  }

  rename(id, name) {
    const ent = this.entities.find((e) => e.id === id);
    if (!ent || !name) return;
    ent.name = name.trim() || ent.name;
    this.ui?.outliner?.refresh();
    if (ent.id === this.selectedId) this.ui?.inspector?.refreshName();
    if (ent.labelEl) ent.labelEl.textContent = ent.name;
  }

  toggleVisible(id) {
    const ent = this.entities.find((e) => e.id === id);
    if (!ent) return;
    ent.setVisible(!ent.visible);
    if (ent.labelEl) ent.labelEl.style.display = ent.visible && this.sceneState.labels ? 'block' : 'none';
    if (ent.id === this.selectedId) { this.gizmo.setVisible(ent.visible); this.selection.ring.visible = ent.visible; }
    this.ui?.outliner?.refresh();
  }

  remove(id) {
    const idx = this.entities.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const ent = this.entities[idx];
    const wasSel = ent.id === this.selectedId;
    this.stage.remove(ent.root);
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
        document.querySelectorAll('#viewtabs button').forEach((b) => b.classList.toggle('on', b.dataset.v === 'director'));
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
      this.select(target.id); // 显示该相机面板
    } else {
      this.cameraView = false;
      this.stage.activeCamera = null;
      this.rig.controls.enabled = true;
      this._applyFrame();
      this.setCameraGizmoVisible(true);
      this._setNavGizmoVisible(true);
      if (this.selected) { this.gizmo.setVisible(true); this.selection.highlight(this.selected); }
    }
    document.querySelectorAll('#viewtabs button').forEach((b) => b.classList.toggle('on', (b.dataset.v === 'camera') === this.cameraView));
    this.ui?.dock?.reflectCameraView(this.cameraView);
  }
  toggleCameraView() { this.setCameraView(!this.cameraView); }

  /** 一次性把某机位对准某对象中心（§B.3.5 / 澄清3）。返回对准点。 */
  aimCameraAtObject(camId, entId) {
    const cam = this.entities.find((e) => e.id === camId && e.type === 'camera');
    const target = this.entities.find((e) => e.id === entId);
    if (!cam || !target) return null;
    const center = this._entityCenter(target);
    cam.aimAt(center);
    if (this.activeCameraId === camId && this.cameraView) this.stage.activeCamera = cam.cam;
    return center;
  }

  /** 取对象世界中心（角色用骨骼包围盒，其余用包围盒）。 */
  _entityCenter(ent) {
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    let measured = false;
    ent.root.updateMatrixWorld(true);
    if (ent.type === 'character') {
      ent.root.traverse((o) => { if (o.isBone) { o.getWorldPosition(p); box.expandByPoint(p); measured = true; } });
    }
    if (!measured) box.setFromObject(ent.root);
    return box.isEmpty() ? ent.root.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());
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
  setSnap(v) { this.sceneState.snap = v; this.gizmo.setSnap(v); }
  setGroundVisible(v) { this.sceneState.ground.visible = v; this.stage.setGroundVisible(v); }
  setGroundOpacity(v) { this.sceneState.ground.opacity = v; this.stage.setGroundOpacity(v); }
  setGroundHeight(v) { this.sceneState.ground.height = v; this.stage.setGroundHeight(v); }

  // ---- 全景背景（§3.c）----
  _applyPanoramaTexture(tex, info, objURL) {
    tex.colorSpace = THREE.SRGBColorSpace;
    if (this._panoObjURL && this._panoObjURL !== objURL) URL.revokeObjectURL(this._panoObjURL);
    this._panoObjURL = objURL || null;
    this.stage.setPanorama(tex);
    this.panoActive = true;
    this.panoramaInfo = info;
    this.ui?.scenePanel?.render?.();
  }
  setPanoramaFromFile(file) {
    const objURL = URL.createObjectURL(file);
    new THREE.TextureLoader().load(
      objURL,
      (tex) => { this._applyPanoramaTexture(tex, { thumb: objURL, title: file.name || '本地全景图' }, objURL); toast('已设置全景背景'); },
      undefined,
      () => { URL.revokeObjectURL(objURL); toast('全景图加载失败'); },
    );
  }
  setPanoramaFromAsset(asset) {
    new THREE.TextureLoader().load(
      asset.url,
      (tex) => { this._applyPanoramaTexture(tex, { thumb: asset.thumb || asset.url, title: asset.title || '全景图' }, null); toast('已设置全景背景：' + (asset.title || '')); },
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
    if (this.selected && !this.cameraView) this.gizmo.setVisible(true);
    this.selection.ring.visible = !!this.selected && !this.cameraView;
    this.setCameraGizmoVisible(!this.cameraView);
    this.labelLayer.style.display = this._lblDisp ?? 'block';
  }

  /** 确定本次截图归属的机位实体；导演视角下若无机位上下文则按当前视角自动新建（§C.2/G.1）。 */
  _resolveShotCamera() {
    if (this.cameraView && this.activeCameraId) {
      const a = this.entities.find((e) => e.id === this.activeCameraId && e.type === 'camera');
      if (a) return { ent: a, created: false };
    }
    if (this.selected?.type === 'camera') return { ent: this.selected, created: false };
    // 无机位上下文：按当前视角新建机位（克隆导演相机位姿）
    const ent = this.addCamera('current');
    return { ent, created: true };
  }

  captureShot() {
    const { ent: camEnt, created } = this._resolveShotCamera();
    camEnt.cam.aspect = this._viewportAspect();
    camEnt.cam.updateProjectionMatrix();

    const url = capture({
      renderer: this.stage.renderer, scene: this.stage.scene, camera: camEnt.cam,
      viewport: this.stage.viewport, frameRect: this.rig.frameRect,
      beforeRender: () => this._beginCleanRender(),
      afterRender: () => this._endCleanRender(),
    });

    const n = (this._shotSeq[camEnt.id] = (this._shotSeq[camEnt.id] || 0) + 1);
    const shot = {
      id: 'shot' + (++this._shotCount),
      cameraId: camEnt.id,
      cameraName: camEnt.name,
      name: `${camEnt.name}-截图${String(n).padStart(2, '0')}`,
      dataURL: url,
      createdAt: Date.now(),
    };
    this.shots.push(shot);
    this.latestShot = url;
    this.ui?.outliner?.refresh();
    this.ui?.inspector?.onShotsChanged?.();
    toast(created ? `已截图（已新建${camEnt.name}）` : '已截图：' + shot.name);
    return shot;
  }

  shotsForCamera(cameraId) { return this.shots.filter((s) => s.cameraId === cameraId); }

  sendShotsToCanvas(ids) {
    const list = (ids && ids.length) ? ids : [...this.selectedShotIds];
    if (!list.length) { toast('请先选择截图'); return; }
    const sel = this.shots.filter((s) => list.includes(s.id));
    sel.forEach((s) => sendToCanvas(s.dataURL));
    toast(`已发送 ${sel.length} 张到画布（示意）`);
  }
  removeShot(id) {
    const i = this.shots.findIndex((s) => s.id === id);
    if (i < 0) return;
    this.shots.splice(i, 1);
    this.selectedShotIds.delete(id);
    this.ui?.inspector?.onShotsChanged?.();
    toast('已删除截图');
  }
  clearShots() {
    this.shots = [];
    this.selectedShotIds.clear();
    this._shotSeq = {};
    this.ui?.inspector?.onShotsChanged?.();
    toast('已清空全部截图');
  }
  toggleShotSelected(id) {
    if (this.selectedShotIds.has(id)) this.selectedShotIds.delete(id);
    else this.selectedShotIds.add(id);
    this.ui?.inspector?.onShotsChanged?.();
  }

  resetView() { this.rig.resetView(); toast('已重置视角'); }
  focusSelected() { const e = this.selected; if (!e) { toast('先选一个对象'); return; } this.rig.focus(e); toast('已聚焦：' + e.name); }

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
    for (const ent of this.entities) {
      if (!ent.labelEl) continue;
      if (ent.type !== 'character' && ent.type !== 'camera') continue;
      if (!ent.visible) { ent.labelEl.style.display = 'none'; continue; }
      // 相机视角下隐藏相机名牌（与相机可视化一起隐藏）
      if (ent.type === 'camera' && this.cameraView) { ent.labelEl.style.display = 'none'; continue; }
      // root.getWorldPosition 已含 world 组变换；头顶偏移按 world 缩放换算
      ent.root.getWorldPosition(this._labelTmp);
      const off = ent.type === 'character' ? (ent.height + 0.16) : 0.2;
      this._labelTmp.y += off * ws;
      this._labelTmp.project(cam);
      const inFront = this._labelTmp.z < 1;
      ent.labelEl.style.display = inFront ? 'block' : 'none';
      ent.labelEl.style.left = (this._labelTmp.x * 0.5 + 0.5) * W + 'px';
      ent.labelEl.style.top = (-this._labelTmp.y * 0.5 + 0.5) * H + 'px';
    }
  }

  // ---- per-frame ----
  tick(dt) {
    for (const ent of this.entities) {
      if (ent.type === 'character') ent.update(dt);
      else if (ent.type === 'camera') ent.update(); // CameraHelper 随相机世界矩阵刷新
    }
    this.rig.update();
    this.selection.update();
    this._updateLabels();
  }
}
