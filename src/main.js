import { icon } from './ui/icons.js';
import { installTooltips } from './ui/Tooltips.js';
import { defaultScene } from './app/defaultScene.js';
import { Stage } from './core/Stage.js';
import { CameraRig } from './core/CameraRig.js';
import { NavGizmo } from './core/NavGizmo.js';
import { App } from './app/App.js';
import { Dock } from './ui/Dock.js';
import { Outliner } from './ui/Outliner.js';
import { Inspector } from './ui/Inspector.js';
import { ScenePanel } from './ui/ScenePanel.js';
import { TimelinePanel } from './ui/timeline/TimelinePanel.js';
import { ExportModal } from './ui/ExportModal.js';
import { AiPanel } from './ui/AiPanel.js';
import { toast, isTyping } from './util/dom.js';
import { SaveStatus } from './ui/SaveStatus.js';
import { AutoSave } from './app/SceneFile.js';
import { AiAgent } from './ai/agent.js';
import { OpenAICompatProvider, loadSettings } from './ai/provider.js';
import { onKey, KEY_PRIORITY } from './util/keys.js';

const $ = (id) => document.getElementById(id);
installTooltips();

// ---- core ----
const stage = new Stage($('viewport'));
const rig = new CameraRig(stage.camera, stage.renderer.domElement, $('viewport'), $('frame'));
stage.onViewportResize(() => rig.onResize());

// ---- app ----
const app = new App({ stage, rig, labelLayer: $('labelLayer') });
const navGizmo = new NavGizmo($('navsvg'), stage.camera, () => app.resetView());

// AI 操作者：__app.ai.run({ input, mode }) 走模型 + 重试回路；__app.ai.applyOps([...], { mode }) 直接应用 ops。
// 失败场景不变，成功 = 一步撤销。模型接口设置只存本机 localStorage。
app.ai = new AiAgent(app, { provider: new OpenAICompatProvider(loadSettings()) });

// ---- ui（各自订阅 app 事件）----
// 导出视频弹层：打开 / 导出中拦下全部快捷键（Esc = 取消），优先级见 util/keys.js
const exportModal = new ExportModal(app);
app.on('exportVideo', () => exportModal.open());
new ScenePanel($('scenePanel'), app);
new Inspector($('inspector'), app);
new Outliner($('outliner'), app, $('search'));
const timelinePanel = new TimelinePanel($('timeline'), app);
const aiPanel = new AiPanel($('stageTools'), app);
// 构建预览也从运行中的本地服务发现模型；密钥始终留在服务端。
if (!aiPanel.settings.local) {
  const initialSettings = JSON.stringify(aiPanel.settings);
  fetch('./api/local-ai/settings', { signal: AbortSignal.timeout(3000) })
    .then((res) => res.ok ? res.json() : null)
    .then((config) => {
      if (!config?.model || app.ai.busy || JSON.stringify(aiPanel.settings) !== initialSettings) return;
      aiPanel.settings = { baseURL: '/api/local-ai', apiKey: '', model: config.model, local: true };
      app.ai.setProvider(new OpenAICompatProvider(aiPanel.settings));
      aiPanel.render();
    })
    .catch(() => {}); // 纯静态托管仍使用浏览器中保存的设置。
}
new Dock($('dock'), app, { timelinePanel, exportModal, aiPanel });

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
  $('navg').title = on ? '返回导演视角并重置（不修改机位）' : '重置视角';
  for (const b of $('viewtabs').querySelectorAll('button')) b.classList.toggle('on', (b.dataset.v === 'camera') === on);
});
// 机位视角旁的机位名：idle 灰字 = 当前机位；时间轴 active 透过主机位 = 强调色「▶ 主机位 · 名字」
const renderPov = () => {
  const camera = app.findCamera(app.povCameraId);
  const main = app.mainPreview;
  const label = $('povLabel');
  label.hidden = !camera;
  label.classList.toggle('main', main);
  label.textContent = camera ? (main ? `▶ 主机位 · ${camera.name}` : camera.name) : '';
  $('povHint').hidden = !app.povUnset;
};
app.on('pov', renderPov);
app.on('entities', renderPov); // 改名
$('closeBtn').innerHTML = icon('close', 18);
$('foldLeft').innerHTML = icon('chevron', 18);
$('foldLeft').style.transform = 'rotate(180deg)';
$('foldRight').innerHTML = icon('chevron', 18);
$('foldLeft').onclick = () => $('app').classList.toggle('left-collapsed');
$('foldRight').onclick = () => $('app').classList.toggle('right-collapsed');
$('closeBtn').onclick = () => toast('（演示）关闭');

// 撤销只订阅已提交的文档事务；交互预览由各编辑入口管理。
const history = app.history;
app.autosave = new AutoSave(app);
new SaveStatus($('saveStatus'), app, app.autosave);

// 键盘：输入控件内不拦截（文本框里的 ⌘Z 留给浏览器做文字撤销）
onKey((e) => {
  if (!app.ready || isTyping(e.target)) return;
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
}, { priority: KEY_PRIORITY.global, phase: 'bubble' });

// 调试句柄（selftest 也通过它驱动）
window.__app = app;
window.__timelinePanel = timelinePanel;
window.__exportModal = exportModal;
window.__aiPanel = aiPanel;

// ---- 按需渲染循环 ----
stage.startLoop({
  tick: () => app.tick(),
  beforeRender: () => { app.beforeRender(); navGizmo.camera = app.getRenderCamera(); navGizmo.update(); },
});

// 初始化遮罩同时阻止指针与键盘操作；失败保留遮罩并提供重试。
const startup = document.createElement('div');
startup.className = 'startup';
startup.setAttribute('role', 'status');
document.body.appendChild(startup);
$('app').inert = true;
app.ready = false;
async function initialize() {
  startup.textContent = '正在准备场景…';
  try {
    const doc = await defaultScene(stage.camera);
    await app.loadDocument(doc, { history: false, applyView: true });
    app.select(doc.entities[0].id, { activateTransform: false });
    history.reset();
    app.ready = true;
    $('app').inert = false;
    startup.remove();

  } catch (err) {
    startup.textContent = '场景加载失败：' + err.message;
    const retry = document.createElement('button');
    retry.textContent = '重试';
    retry.onclick = initialize;
    startup.appendChild(retry);
  }
}
initialize();
