// 全局快捷键分发：window 上只挂两个 keydown 监听（捕获 / 冒泡），各模块按显式优先级注册，不依赖构造顺序。
// handler 里调 stopPropagation / stopImmediatePropagation = 吃掉这次按键，后面的 handler 不再收到（与原生语义一致）。
// 捕获阶段先于页面元素；冒泡阶段在元素之后 —— 元素自己 stopPropagation（如 AI 抽屉）时冒泡阶段的 handler 收不到。

/** 优先级（大的先收到）。 */
export const KEY_PRIORITY = {
  // 捕获阶段
  modal: 100,      // 导出弹层：打开 / 导出中拦下全部按键（Esc = 取消 / 关闭）
  popup: 90,       // 弹出菜单：Esc 关闭
  pathDraw: 80,    // 路径绘制态：回车 / Backspace / Esc
  transformDrag: 75, // gizmo 拖动：Esc 取消预览
  pathDrag: 70,    // 拖顶点中：Esc 还原
  timeline: 60,    // 时间轴：选中键时 Del 删键、Space 播放…
  // 冒泡阶段
  menu: 30,        // 右键菜单：Esc 关闭
  pathVertex: 20,  // 选中路径顶点：Del 删顶点（先于删实体）
  global: 0,       // 撤销 / 变换模式 / 删实体
};

const lists = { capture: [], bubble: [] };
let installed = false;

function dispatch(list, e) {
  for (const h of list.slice()) {
    h.fn(e);
    if (e.cancelBubble) break;
  }
}

/**
 * 注册一个 keydown handler，返回注销函数。
 * @param {(e: KeyboardEvent) => void} fn
 * @param {{priority?: number, phase?: 'capture'|'bubble'}} opts
 */
export function onKey(fn, { priority = KEY_PRIORITY.global, phase = 'capture' } = {}) {
  if (!installed) {
    installed = true;
    window.addEventListener('keydown', (e) => dispatch(lists.capture, e), true);
    window.addEventListener('keydown', (e) => dispatch(lists.bubble, e));
  }
  const list = lists[phase];
  const h = { fn, priority };
  const i = list.findIndex((x) => x.priority < priority); // 同优先级按注册先后
  list.splice(i < 0 ? list.length : i, 0, h);
  return () => { const k = list.indexOf(h); if (k >= 0) list.splice(k, 1); };
}
