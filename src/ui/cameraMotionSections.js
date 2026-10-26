import * as THREE from 'three';
import { el } from '../util/dom.js';
import { tripleRow, dropdownRow, numberRow } from './widgets.js';
import { PANEL_MOVES, PANEL_PARAMS, MOVE_DIRS, PANEL_LABEL } from '../anim/cameraMoves.js';

const ROUTES = {
  circle: ['M35 8C8 0 5 32 30 32S55 10 35 8', '绕主体一圈，背景连续变化'],
  half_orbit: ['M10 29C0 3 50 0 52 27', '绕到另一侧，呈现侧背关系'],
  push_in: ['M8 20H42m-7-6 7 6-7 6', '真实靠近，主体逐渐放大'],
  pull_out: ['M48 20H14m7-6-7 6 7 6', '向后退开，展开环境空间'],
  crane: ['M30 32V7m-6 7 6-7 6 7', '保持水平位置，升高或降低'],
  truck: ['M8 25H50m-7-6 7 6-7 6M16 9h28', '向左或向右平移'],
  spiral: ['M12 32C55 36 55 19 27 20S0 6 44 7m-7-5 7 5-7 5', '环绕主体，同时缓缓升高'],
  pan: ['M12 29L30 10l18 19M19 31q11-8 22 0', '位置不变，转动镜头对准主体'],
};

/** Cards mutate only on click. Opening the panel never generates a candidate path. */
export function cameraMoveSection(app, cam, rerender) {
  const tool = app.cameraMoves, state = tool.current(cam);
  const segments = state?.segments || [], single = segments.length === 1 && !state.customPrefix ? segments[0] : null;
  const append = tool.appendCameraId === cam.id;
  const error = el('div', { class: 'move-error', role: 'status', text: tool.error || '', hidden: !tool.error });
  const apply = (name, options = {}) => {
    if (tool.applyPreset(cam, name, options)) { tool.appendCameraId = null; rerender(); }
    else { error.textContent = tool.error; error.hidden = false; }
  };
  const card = name => el('button', {
    class: 'move-card' + (single?.name === name ? ' applied' : ''), title: ROUTES[name][1],
    'data-preset': name, 'aria-pressed': String(single?.name === name),
    onclick: () => apply(name, { append }),
  }, [
    el('span', { class: 'move-route', html: `<svg viewBox="0 0 60 40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ROUTES[name][0]}"/></svg>` }),
    el('span', { class: 'move-card-title', text: PANEL_LABEL[name] }),
    el('span', { class: 'move-card-copy', text: ROUTES[name][1] }),
    single?.name === name ? el('span', { class: 'move-check', text: '✓' }) : null,
  ]);
  const summary = single ? `${PANEL_LABEL[single.name]} · ${single.params.duration.toFixed(1)} 秒` : segments.length ? `${state.customPrefix ? '自定义轨迹 + ' : ''}${segments.map(s => PANEL_LABEL[s.name]).join(' + ')} · ${(app.timeline.paths.find(p => p.target === cam.id)?.duration ?? segments.reduce((n, s) => n + s.params.duration, 0)).toFixed(1)} 秒` : tool.hasMoves(cam) ? '自定义轨迹' : '尚未设置运镜';
  const nodes = [el('div', { class: 'move-summary', text: summary }),
    append ? el('div', { class: 'move-append-note' }, ['选择下一段预设，将从当前路线终点追加。', el('button', { class: 'minibtn', text: '取消追加', onclick: () => { tool.appendCameraId = null; rerender(); } })]) : null,
    el('div', { class: 'move-cards' }, PANEL_MOVES.map(card)),
    el('details', { class: 'move-more' }, [el('summary', { text: '更多运镜' }), card('pan')]),
  ];
  if (single) {
    const { name, params, subject } = single;
    const set = (key, value) => apply(name, { params: { [key]: value } });
    nodes.push(el('div', { class: 'sec-title' }, [el('span', { text: '当前预设参数' }), el('button', { class: 'minibtn', text: '恢复默认', onclick: () => apply(name, { reset: true }) })]));
    const fields = [['duration', '时长', 's', .5], ['amount', '距离', 'm', .1], ['sweep', '角度', '°', 15], ['rise', '升高量', 'm', .1]];
    for (const [key, label, unit, step] of fields) {
      if (key !== 'duration' && !PANEL_PARAMS[name].includes(key)) continue;
      const row = numberRow({ label, unit, step, value: params[key], onChange: value => { set(key, value); if (tool.error) row.el.appendChild(error); } });
      row.el.querySelector('input').addEventListener('keydown', e => { if (e.key === 'Enter') e.currentTarget.blur(); });
      nodes.push(row.el);
    }
    if (PANEL_PARAMS[name].includes('dir')) nodes.push(dropdownRow({ label: '方向', value: params.dir, options: MOVE_DIRS[name].map(([value, label]) => ({ value, label })), onChange: value => set('dir', value) }).el);
    nodes.push(dropdownRow({ label: '持续注视', value: Array.isArray(subject) ? '__point' : subject,
      options: [...tool.subjects(cam), { value: '__point', label: '手动注视点' }],
      onChange: value => apply(name, { subject: value === '__point' ? single.aim.slice() : value }),
    }).el);
    if (Array.isArray(subject)) {
      const point = subject.slice();
      nodes.push(tripleRow({ label: '持续注视坐标', step: .05, onCommit: () => apply(name, { subject: point }), axes: ['x', 'y', 'z'].map((key, i) => ({ key, get: () => point[i], set: v => { point[i] = v; } })) }).el);
    }
  }
  nodes.push(error, el('button', { class: 'minibtn', text: '播放预览', onclick: () => app.playback.play() }));
  return el('div', { class: 'anim-sec camera-moves', 'data-sec': 'move' }, nodes);
}

export function cameraMoveActions(app, cam, rerender) {
  return el('div', { class: 'anim-btns move-actions' }, [
    el('button', { class: 'minibtn', text: '追加一段', onclick: () => { app.cameraMoves.appendCameraId = cam.id; rerender(); } }),
    app.cameraMoves.hasMoves(cam) ? el('button', { class: 'minibtn danger', text: '清除运镜', onclick: () => { app.cameraMoves.clear(cam); rerender(); } }) : null,
  ]);
}

/** 约束段（机位）：注视（无 / 实体 / 自定义点）、跟随（实体 + 偏移），各自生效区间。 */
export function cameraConstraintSection(app, cam, list, edit, { hideLook = false } = {}) {
  const look = list.find((c) => c.type === 'lookAt');
  const follow = list.find((c) => c.type === 'follow');
  const subjects = [];
  for (const e of app.entities) {
    if (e !== cam) subjects.push({ value: e.id, label: e.name });
    for (const m of e.children) subjects.push({ value: m.id, label: `${e.name} / ${m.name}` });
  }
  const r3 = (v) => v.map((x) => Math.round(x * 1000) / 1000);
  const range = (c) => el('div', { class: 'anim-pair' }, [
    numberRow({ label: '开始', value: c.start, step: 0.1, min: 0, unit: 's', allowEmpty: true, placeholder: '开头', onChange: (v) => edit((tl) => tl.updateConstraint(c.id, { start: v })) }).el,
    numberRow({ label: '结束', value: c.end, step: 0.1, min: 0, unit: 's', allowEmpty: true, placeholder: '结尾', onChange: (v) => edit((tl) => tl.updateConstraint(c.id, { end: v })) }).el,
  ]);
  const vecRow = (label, arr, onCommit) => {
    const v = [...arr];
    return tripleRow({
      label, step: 0.05, onCommit: () => onCommit(r3(v)),
      axes: ['x', 'y', 'z'].map((k, i) => ({ key: k, get: () => v[i], set: (x) => { v[i] = x; } })),
    }).el;
  };

  const nodes = [el('div', { class: 'sec-title' }, [el('span', { text: '约束' }), el('span', { class: 'sec-tag cns', text: '播放时生效' })])];

  // 注视
  if (!hideLook) {
  const lookVal = !look ? '' : Array.isArray(look.subject) ? '__point' : look.subject;
  nodes.push(dropdownRow({
    label: '持续注视', value: lookVal,
    options: [{ value: '', label: '无' }, ...subjects, { value: '__point', label: '自定义点' }],
    onChange: (v) => edit((tl) => {
      if (!v) { if (look) tl.removeConstraint(look.id); return; }
      const subject = v === '__point' ? (Array.isArray(look?.subject) ? look.subject : r3(cam.lookTarget.toArray())) : v;
      if (look) tl.updateConstraint(look.id, { subject });
      else tl.addConstraint({ type: 'lookAt', target: cam.id, subject });
    }),
  }).el);
  if (look && Array.isArray(look.subject)) nodes.push(vecRow('注视点', look.subject, (v) => edit((tl) => tl.updateConstraint(look.id, { subject: v }))));
  if (look) nodes.push(range(look));

  }

  // 跟随
  nodes.push(dropdownRow({
    label: '跟随', value: follow?.subject ?? '',
    options: [{ value: '', label: '无' }, ...subjects],
    onChange: (v) => edit((tl) => {
      if (!v) { if (follow) tl.removeConstraint(follow.id); return; }
      if (follow) tl.updateConstraint(follow.id, { subject: v });
      else tl.addConstraint({ type: 'follow', target: cam.id, subject: v, offset: followOffset(app, cam, v) });
    }),
  }).el);
  if (follow) {
    nodes.push(vecRow('偏移', follow.offset, (v) => edit((tl) => tl.updateConstraint(follow.id, { offset: v }))));
    nodes.push(range(follow));
  }
  return el('div', { class: 'anim-sec', 'data-sec': 'constraint' }, nodes);
}

/** 新建跟随时的默认偏移：机位相对 subject 的当前位置（subject 的 yaw 坐标系），机位不会跳走。 */
function followOffset(app, cam, subjectId) {
  const sub = app.findEntity(subjectId);
  if (!sub) return [0, 0, 0];
  const world = app.stage.world;
  world.updateMatrixWorld(true);
  const p = world.worldToLocal(sub.root.getWorldPosition(new THREE.Vector3()));
  const q = sub.root.getWorldQuaternion(new THREE.Quaternion());
  const yaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
  const d = cam.root.position.clone().sub(p).applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
  return d.toArray().map((x) => Math.round(x * 1000) / 1000);
}
