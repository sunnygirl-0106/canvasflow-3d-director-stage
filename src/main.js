import { Stage } from './core/Stage.js';
import { CameraRig } from './core/CameraRig.js';
import { TransformGizmo } from './core/TransformGizmo.js';
import { Selection } from './core/Selection.js';
import { NavGizmo } from './core/NavGizmo.js';
import { App } from './app/App.js';
import { Dock } from './ui/Dock.js';
import { Outliner } from './ui/Outliner.js';
import { Inspector } from './ui/Inspector.js';
import { ScenePanel } from './ui/ScenePanel.js';
import { toast } from './util/dom.js';

const viewport = document.getElementById('viewport');
const frameEl = document.getElementById('frame');
const labelLayer = document.getElementById('labelLayer');

// ---- core ----
const stage = new Stage(viewport);
const rig = new CameraRig(stage.camera, stage.renderer.domElement, viewport, frameEl);
rig.setRatio('free'); // 默认导演视角，无取景框
const gizmo = new TransformGizmo(stage.camera, stage.renderer.domElement, stage.scene, rig.controls, () => !app.cameraView);
const navGizmo = new NavGizmo(document.getElementById('navsvg'), stage.camera, () => app.resetView());

// ---- app ----
const app = new App({
  stage, rig, gizmo, selection: null, labelLayer,
  scenePanelEl: document.getElementById('scenePanel'),
  inspectorEl: document.getElementById('inspector'),
});

const selection = new Selection(stage.renderer, stage.camera, stage.scene, () => app.entities, (id) => app.select(id));
app.selection = selection;
selection.setSkipPredicate(() => gizmo.dragging || gizmo.overAxis);
gizmo.onObjectChange(() => app.ui?.inspector?.syncFromObject());

// ---- ui ----
const scenePanel = new ScenePanel(document.getElementById('scenePanel'), app);
const inspector = new Inspector(document.getElementById('inspector'), app);
const outliner = new Outliner(document.getElementById('outliner'), app, document.getElementById('search'));
const dock = new Dock(document.getElementById('dock'), app);
app.attachUI({ scenePanel, inspector, outliner, dock });

// header view tabs
document.getElementById('viewtabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) app.setCameraView(b.dataset.v === 'camera');
});
document.getElementById('helpBtn').onclick = () =>
  toast('空白拖动=环绕视角 · 拖三色 gizmo=变换选中 · 底部「＋」加角色/模型 · 右侧「姿势」摆全身');
document.getElementById('closeBtn').onclick = () => toast('（演示）关闭');

// resize: 重排取景框
window.addEventListener('resize', () => rig.onResize());

// keyboard
window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  const k = e.key.toLowerCase();
  if (k === 'v') app.setTransformMode('translate');
  else if (k === 'r') app.setTransformMode('rotate');
  else if (k === 's') app.setTransformMode('scale');
  else if (e.key === 'Delete' || e.key === 'Backspace') { if (app.selectedId) app.remove(app.selectedId); }
});

// 调试句柄
window.__app = app;

// ---- loop ----
stage.startLoop((dt) => { app.tick(dt); navGizmo.update(); });

// ---- seed：两个角色，默认未选中（右侧显示 3D场景面板，贴合截图）----
(async () => {
  try {
    await app.addCharacter('standard');
    await app.addCharacter('standard');
    app.entities[0]?.root.position.set(-1.1, 0, 0.2);
    app.entities[1]?.root.position.set(1.1, 0, 0.2);
    app.frameSubjects(); // 自动对准主体，主体占满画面（不被背景比下去）
    app.select(null);
  } catch (e) { console.error('seed failed', e); }
})();
