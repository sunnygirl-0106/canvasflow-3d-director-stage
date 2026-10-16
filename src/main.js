import { Stage } from './core/Stage.js';
import { CameraRig } from './core/CameraRig.js';
import { NavGizmo } from './core/NavGizmo.js';
import { App } from './app/App.js';
import { Dock } from './ui/Dock.js';
import { Outliner } from './ui/Outliner.js';
import { Inspector } from './ui/Inspector.js';
import { ScenePanel } from './ui/ScenePanel.js';
import { TimelinePanel } from './ui/timeline/TimelinePanel.js';
import { toast } from './util/dom.js';
import { AutoSave } from './app/SceneFile.js';

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
const timelinePanel = new TimelinePanel($('timeline'), app);
new Dock($('dock'), app, { timelinePanel });

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

// 撤销重做：每个用户操作结束后记一步（快照与栈顶相同则不记）。
// 拖动类操作（gizmo / 轴标签拖动 / 滑条）只在 pointerup / change 时记录，不按帧记录；
// 异步完成的操作（加角色 / 群众 / 复制 / 全景）在 'entities' / 'scene' 事件时记录。
const history = app.history;
for (const t of ['pointerup', 'click', 'change', 'keyup']) window.addEventListener(t, () => history.schedule());
app.on('entities', () => history.schedule());
app.on('scene', () => history.schedule());
new AutoSave(app); // 撤销栈变化后防抖 1s 写 localStorage

// 键盘：输入控件内不拦截（文本框里的 ⌘Z 留给浏览器做文字撤销）
window.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
  const k = e.key.toLowerCase();
  if (e.metaKey || e.ctrlKey) {
    // ⌘Z / Ctrl+Z 撤销；⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y 重做
    if (k === 'z' || k === 'y') {
      e.preventDefault();
      if (k === 'y' || e.shiftKey) history.redo(); else history.undo();
    }
    return;
  }
  if (k === 'v') app.setTransformMode('translate');
  else if (k === 'r') app.setTransformMode('rotate');
  else if (k === 's') app.setTransformMode('scale');
  else if (e.key === 'Delete' || e.key === 'Backspace') { if (app.selectedId) app.remove(app.selectedId); }
});

// 调试句柄（selftest 也通过它驱动）
window.__app = app;
window.__timelinePanel = timelinePanel;

// ---- 按需渲染循环 ----
stage.startLoop({
  tick: () => app.tick(),
  beforeRender: () => { app.beforeRender(); navGizmo.update(); },
});

// ---- seed：男女各一个角色，默认未选中（右侧显示 3D场景面板）----
(async () => {
  try {
    const [a, b] = await Promise.all([app.addCharacter('male'), app.addCharacter('female')]);
    // 只改水平位置：y 保留各素体的站立基准偏移（脚底贴地）
    if (a) { a.root.position.x = -1.1; a.root.position.z = 0.2; }
    if (b) { b.root.position.x = 1.1; b.root.position.z = 0.2; }
    app.frameSubjects(); // 自动对准主体，主体占满画面
    app.select(null);
  } catch (e) { console.error('seed failed', e); }
  history.reset(); // 种子场景作为撤销起点（之前的添加不进撤销栈）
  AutoSave.offerRestore(app); // 有上次存档：提示可恢复（不自动恢复）
})();
