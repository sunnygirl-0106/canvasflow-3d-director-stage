import { toastError } from '../../util/dom.js';
import { keyId } from './TrackRows.js';
import { round6 } from '../../util/math.js';
export { popupMenu, closePopup } from '../popupMenu.js';

const DRAG_PX = 3; // 移动超过此距离才算拖动（否则是点击）

/** 在 pointer 按下的元素上跟踪一次拖动：onMove(dx, ev) / onEnd(dragged, ev)。 */
function track(node, e, { onMove, onEnd }) {
  const x0 = e.clientX;
  let dragged = false;
  try { node.setPointerCapture(e.pointerId); } catch { /* 已脱离文档 */ }
  const move = (ev) => {
    const dx = ev.clientX - x0;
    if (!dragged && Math.abs(dx) < DRAG_PX) return;
    dragged = true;
    onMove(dx, ev);
  };
  const up = (ev) => {
    node.removeEventListener('pointermove', move);
    node.removeEventListener('pointerup', up);
    node.removeEventListener('pointercancel', up);
    onEnd(dragged, ev);
  };
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
}

/** 当前文档里的键：keyId → { trackId, t, value, ease }。 */
function keyIndex(app) {
  const map = new Map();
  for (const tr of app.timeline.toJSON().timeline.tracks) {
    for (const k of tr.keys) map.set(keyId(tr.id, k.t), { trackId: tr.id, ...k });
  }
  return map;
}

/**
 * 拖动选中的关键帧（anchor = 按下的那颗）。
 * - 按 anchor 吸附（吸附开启时），其余键保持相对间距；整体夹在 [0, duration] 内。
 * - 松手才写入（timeline API，同步完成 → 一次撤销）；⌥ 拖 = 复制；落到已有键的时刻 = 覆盖。
 * - 未拖动的点击：若按下时该键已在多选里，松手时收成单选。
 */
export function dragKeys(panel, e, anchorEl, { collapseOnClick = false } = {}) {
  const { app } = panel;
  const index = keyIndex(app);
  const anchor = index.get(keyId(anchorEl.dataset.track, anchorEl.dataset.t));
  if (!anchor) return;
  const sel = [...panel.selKeys].map((id) => index.get(id)).filter(Boolean);
  const nodes = [...panel.rows.querySelectorAll('.tl-key.sel')];
  const tMin = Math.min(...sel.map((k) => k.t)), tMax = Math.max(...sel.map((k) => k.t));
  const { duration } = app.timeline;
  let delta = 0;
  let ghosts = [];

  const deltaFor = (dx) => {
    const target = panel.snapTime(anchor.t + dx / panel.pps);
    return Math.min(Math.max(target - anchor.t, -tMin), duration - tMax);
  };

  track(anchorEl, e, {
    onMove(dx, ev) {
      delta = deltaFor(dx);
      const copy = ev.altKey || e.altKey;
      if (copy && !ghosts.length) { // 复制：原位置留一份虚影
        ghosts = nodes.map((n) => { const g = n.cloneNode(); g.classList.add('ghost'); g.classList.remove('sel'); n.before(g); return g; });
      } else if (!copy && ghosts.length) { ghosts.forEach((g) => g.remove()); ghosts = []; }
      for (const n of nodes) n.style.setProperty('--t', +n.dataset.t + delta);
      panel.showDragTime(anchor.t + delta, ev.clientX);
    },
    onEnd(dragged, ev) {
      panel.showDragTime(null);
      ghosts.forEach((g) => g.remove());
      if (!dragged) {
        if (collapseOnClick && !e.shiftKey) { panel.selKeys = new Set([keyId(anchor.trackId, anchor.t)]); panel.applySelection(); panel.syncMotionKey(); }
        return;
      }
      if (Math.abs(delta) < 1e-9) { for (const n of nodes) n.style.setProperty('--t', n.dataset.t); return; }
      const copy = ev.altKey || e.altKey;
      const tl = app.timeline;
      const next = new Set();
      try {
        app.store.batch('移动关键帧', () => {
        if (!copy) for (const k of sel) tl.removeKey(k.trackId, k.t);
        for (const k of sel) {
          const t = round6(k.t + delta);
          tl.setKey(k.trackId, t, k.value, k.ease);
          next.add(keyId(k.trackId, t));
        }
        });
        panel.selKeys = next;
      } catch (err) { toastError(err); }
      panel.syncMotionKey();
      panel.rebuild();
    },
  });
}

/**
 * 拖区间条。
 * - 路径：拖中间平移（保持时长）；拖起止手柄分别调整开始 / 结束，另一端保持不变。
 * - 约束：拖两端菱形 = 设 start / end（null 视为 0 / 时长）。
 * 松手时经 updatePath / updateConstraint 写入（一次撤销）。
 */
export function dragBar(panel, e, barEl, edge) {
  const { app } = panel;
  const tl = app.timeline;
  const { kind, id } = barEl.dataset;
  const { duration, fps } = tl;
  const minLen = 1 / fps;
  const data = kind === 'path' ? tl.toJSON().paths.find((p) => p.id === id) : tl.toJSON().constraints.find((c) => c.id === id);
  if (!data) return;
  const t0 = kind === 'path' ? data.start : (data.start ?? 0);
  const t1 = kind === 'path' ? data.start + data.duration : (data.end ?? duration);
  if (kind === 'constraint' && edge === 'mid') return; // 约束只拖两端
  let a = t0, b = t1;

  track(barEl, e, {
    onMove(dx, ev) {
      const dt = dx / panel.pps;
      if (edge === 'end') {
        b = Math.min(duration, Math.max(a + Math.min(minLen, duration - a), panel.snapTime(t1 + dt)));
      } else if (kind === 'path' && edge === 'mid') { // 中间：整体平移
        const length = Math.min(t1 - t0, duration);
        a = Math.min(duration - length, Math.max(0, panel.snapTime(t0 + dt)));
        b = a + length;
      } else {
        a = Math.min(Math.max(0, panel.snapTime(t0 + dt)), b - minLen);
      }
      barEl.style.setProperty('--t0', a);
      barEl.style.setProperty('--t1', b);
      panel.showDragTime(edge === 'end' ? b : a, ev.clientX);
    },
    onEnd(dragged) {
      panel.showDragTime(null);
      if (!dragged) return;
      try {
        if (kind === 'path') {
          if (edge === 'end') tl.updatePath(id, { duration: round6(b - a) });
          else if (edge === 'start') tl.updatePath(id, { start: round6(a), duration: round6(b - a) });
          else tl.updatePath(id, { start: round6(a) });
        } else if (edge === 'end') tl.updateConstraint(id, { end: round6(b) });
        else tl.updateConstraint(id, { start: round6(a) });
      } catch (err) { toastError(err); }
      panel.rebuild();
    },
  });
}
