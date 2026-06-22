import * as THREE from 'three';
import { Character } from '../entities/Character.js';
import { Prop } from '../entities/Prop.js';
import { capture, downloadDataURL, sendToCanvas } from '../util/capture.js';
import { toast, el } from '../util/dom.js';

const MODEL_URLS = { Xbot: './assets/Xbot.glb', Soldier: './assets/Soldier.glb', Robot: './assets/Robot.glb' };
const PROP_LABEL = { box: '方块', cylinder: '圆柱', sphere: '球体', mannequin: '人体素模' };
const RATIOS = ['16:9', '9:16', '1:1', 'free'];

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
    this.ratioIndex = 0;
    this.latestShot = null;

    this._charLetter = 0;
    this._propCount = {};

    // 场景级状态（供 ScenePanel 读取/回写）
    this.sceneState = {
      scale: 1, pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 },
      sky: 0x060608, labels: true, snap: false,
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

  select(id) {
    this.selectedId = id;
    const ent = this.selected;
    if (ent) {
      this.gizmo.attach(ent.root);
      this.gizmo.setMode(this.transformMode);
      this.gizmo.setVisible(true);
      this.scenePanelEl.hidden = true;
      this.inspectorEl.hidden = false;
      this.ui?.inspector?.show(ent);
    } else {
      this.gizmo.detach();
      this.inspectorEl.hidden = true;
      this.scenePanelEl.hidden = false;
    }
    this.selection.highlight(ent);
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
    this.transformMode = mode;
    if (this.selected) { this.gizmo.setMode(mode); this.gizmo.setVisible(true); }
    this.ui?.dock?.reflectMode(mode);
  }

  // ---- view mode / ratio ----
  setCameraView(on) {
    this.cameraView = on;
    this.rig.setRatio(on ? RATIOS[this.ratioIndex] : 'free');
    document.querySelectorAll('#viewtabs button').forEach((b) => b.classList.toggle('on', (b.dataset.v === 'camera') === on));
    this.ui?.dock?.reflectCameraView(on);
  }
  toggleCameraView() { this.setCameraView(!this.cameraView); }

  cycleRatio() {
    this.ratioIndex = (this.ratioIndex + 1) % RATIOS.length;
    const r = RATIOS[this.ratioIndex];
    if (r !== 'free') this.setCameraView(true);
    this.rig.setRatio(r);
    toast('取景比例：' + (r === 'free' ? '自由' : r));
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

  // ---- capture ----
  captureShot() {
    if (!this.cameraView && this.rig.ratio == null) this.setCameraView(true); // 确保有取景框
    const url = capture({
      renderer: this.stage.renderer, scene: this.stage.scene, camera: this.stage.camera,
      viewport: this.stage.viewport, frameRect: this.rig.frameRect,
      beforeRender: () => {
        this.gizmo.setVisible(false);
        this.selection.ring.visible = false;
        this._lblDisp = this.labelLayer.style.display;
        this.labelLayer.style.display = 'none';
      },
      afterRender: () => {
        if (this.selected) this.gizmo.setVisible(true);
        this.selection.ring.visible = !!this.selected;
        this.labelLayer.style.display = this._lblDisp ?? 'block';
      },
    });
    this.latestShot = url;
    downloadDataURL(url, `导演台_截图_${Date.now()}.png`);
    toast('已截图并下载');
  }
  sendLatestShot() {
    if (!this.latestShot) { toast('请先截图'); return; }
    sendToCanvas(this.latestShot);
    toast('已发送到画布（示意）');
  }

  resetView() { this.rig.resetView(); toast('已重置视角'); }
  focusSelected() { const e = this.selected; if (!e) { toast('先选一个对象'); return; } this.rig.focus(e); toast('已聚焦：' + e.name); }

  // ---- labels ----
  _makeLabel(ent) {
    const d = el('div', { class: 'label3d', text: ent.name });
    if (!this.sceneState.labels) d.style.display = 'none';
    this.labelLayer.appendChild(d);
    ent.labelEl = d;
  }
  _updateLabels() {
    if (!this.sceneState.labels) return;
    const cam = this.stage.camera;
    const W = this.stage.viewport.clientWidth, H = this.stage.viewport.clientHeight;
    for (const ent of this.entities) {
      if (ent.type !== 'character' || !ent.labelEl) continue;
      if (!ent.visible) { ent.labelEl.style.display = 'none'; continue; }
      // root.getWorldPosition 已含 world 组变换；头顶偏移按 world 缩放换算
      ent.root.getWorldPosition(this._labelTmp);
      this._labelTmp.y += (ent.height + 0.16) * this.stage.world.scale.y;
      this._labelTmp.project(cam);
      const inFront = this._labelTmp.z < 1;
      ent.labelEl.style.display = inFront ? 'block' : 'none';
      ent.labelEl.style.left = (this._labelTmp.x * 0.5 + 0.5) * W + 'px';
      ent.labelEl.style.top = (-this._labelTmp.y * 0.5 + 0.5) * H + 'px';
    }
  }

  // ---- per-frame ----
  tick(dt) {
    for (const ent of this.entities) if (ent.type === 'character') ent.update(dt);
    this.rig.update();
    this.selection.update();
    this._updateLabels();
  }
}
