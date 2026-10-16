import { Stage } from './core/Stage.js';
import { CameraRig } from './core/CameraRig.js';
import { NavGizmo } from './core/NavGizmo.js';
import { App } from './app/App.js';
import { Dock } from './ui/Dock.js';
import { Outliner } from './ui/Outliner.js';
import { Inspector } from './ui/Inspector.js';
import { ScenePanel } from './ui/ScenePanel.js';
import { toast } from './util/dom.js';

const $ = (id) => document.getElementById(id);

// ---- core ----
const stage = new Stage($('viewport'));
const rig = new CameraRig(stage.camera, stage.renderer.domElement, $('viewport'), $('frame'));
stage.onViewportResize(() => rig.onResize());

// ---- app ----
const app = new App({ stage, rig, labelLayer: $('labelLayer') });
const navGizmo = new NavGizmo($('navsvg'), stage.camera, () => app.resetView());

// ---- ui（各自订阅 app 事件）----
new ScenePanel($('scenePanel'), app);
new Inspector($('inspector'), app);
new Outliner($('outliner'), app, $('search'));
new Dock($('dock'), app);

// 右栏：未选中 → 3D场景面板；选中 → 属性面板
app.on('selection', (ent) => {
  $('scenePanel').hidden = !!ent;
  $('inspector').hidden = !ent;
});

// 顶栏视角切换 + 机位视角下隐藏坐标指示器
$('viewtabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) app.setCameraView(b.dataset.v === 'camera');
});
app.on('view', (on) => {
  $('navg').style.display = on ? 'none' : 'block';
  for (const b of $('viewtabs').querySelectorAll('button')) b.classList.toggle('on', (b.dataset.v === 'camera') === on);
});
$('helpBtn').onclick = () =>
  toast('空白拖动=环绕视角 · 拖三色 gizmo=变换选中 · 底部「＋」加角色/模型 · 右侧「姿势」摆全身');
$('closeBtn').onclick = () => toast('（演示）关闭');

// 键盘：输入控件内不拦截
window.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
  const k = e.key.toLowerCase();
  if (k === 'v') app.setTransformMode('translate');
  else if (k === 'r') app.setTransformMode('rotate');
  else if (k === 's') app.setTransformMode('scale');
  else if (e.key === 'Delete' || e.key === 'Backspace') { if (app.selectedId) app.remove(app.selectedId); }
});

// 调试句柄（selftest 也通过它驱动）
window.__app = app;

// ---- 按需渲染循环 ----
stage.startLoop({
  tick: () => app.tick(),
  beforeRender: () => { app.beforeRender(); navGizmo.update(); },
});

// ---- seed：两个角色，默认未选中（右侧显示 3D场景面板）----
(async () => {
  try {
    const [a, b] = await Promise.all([app.addCharacter('standard'), app.addCharacter('standard')]);
    a?.root.position.set(-1.1, 0, 0.2);
    b?.root.position.set(1.1, 0, 0.2);
    app.frameSubjects(); // 自动对准主体，主体占满画面
    app.select(null);
  } catch (e) { console.error('seed failed', e); }
})();
