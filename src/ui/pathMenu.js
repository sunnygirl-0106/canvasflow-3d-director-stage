import { defaultDuration, paceFor, stopsAfterReverse } from '../anim/pathGen.js';
import { rampFor } from '../anim/Path.js';
import { toastError } from '../util/dom.js';
import { pathModes } from '../app/PathTool.js';
import { popupMenu } from './popupMenu.js';

/** Opening only captures the row target; scene changes start after choosing an item. */
const shapes = {
  circle: '<circle cx="10" cy="10" r="7"/>', line: '<path d="M2 10h16"/>', rectangle: '<rect x="3" y="4" width="14" height="12"/>',
  freehand: '<path d="M3 17l2-6L14 2l4 4-9 9-6 2zm2-6 4 4"/>', points: '<path d="M10 2L3 13l7 5 7-5-7-11zm0 0v9"/><circle cx="10" cy="12" r="1"/>',
};
export function openPathMenu(app, anchor, targetId) {
  const ent = app.findEntity(targetId);
  if (!app.pathTool.canDraw(ent)) return;
  const r = anchor.getBoundingClientRect();
  const items = pathModes(ent).map(([mode, label]) => ({ label, icon: shapes[mode] ? `<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3">${shapes[mode]}</svg>` : null, onClick: () => app.pathTool.request(mode, targetId) }));
  if (app.timeline.toJSON().paths.some(p => p.target === targetId)) {
    items.push('-', { label: '编辑现有轨迹', onClick: () => {
      if (!app.findEntity(targetId)) return;
      app.playback.pause(); app.setCameraView(false); app.select(targetId);
      const path = app.timeline.toJSON().paths.find(p => p.target === targetId);
      app.pathOverlay.setSelectedPath(path?.id || null);
    } }, { label: '轨迹操作 ›', onClick: () => {
      const current = () => app.timeline.paths.find(p => p.target === targetId);
      const update = patch => { app.playback.pause(); try { const p = current(); if (p) app.timeline.updatePath(p.id, patch(p)); } catch (err) { toastError(err); } };
      popupMenu(r.left, r.top, [
        { label: '反向', onClick: () => update(p => ({ points: p.points.slice().reverse(), ...stopsAfterReverse(p) })) },
        { label: current()?.closed ? '取消闭合' : '闭合路径', onClick: () => update(p => ({ closed: !p.closed })) },
        { label: '按步速调整', onClick: () => update(p => ({ duration: defaultDuration(p.points, { speed: paceFor(ent.type), closed: p.closed, interpolation: p.interpolation, ramp: ['character', 'group'].includes(ent.type) ? 0 : rampFor(ent.type) }) })) },
        { label: '起点对齐当前位置', onClick: () => update(p => ({ points: [app.pathTool.startPoint(ent), ...p.points.slice(1)] })) },
      ], { anchor: r });
    } });
  }
  items.splice(5, 0, '-');
  return popupMenu(r.left, r.top, items, { minWidth: '190px', anchor: r });
}
