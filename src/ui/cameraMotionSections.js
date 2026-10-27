import * as THREE from 'three';
import { el } from '../util/dom.js';
import { tripleRow, dropdownRow, numberRow } from './widgets.js';
import { PANEL_MOVES, PANEL_PARAMS, MOVE_DIRS, PANEL_LABEL } from '../anim/cameraMoves.js';
import { anchorOf } from '../anim/Constraint.js';
import { round6 } from '../util/math.js';

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
  const segments = state?.segments || [], single = segments.at(-1);
  const combined = !!(state?.customPrefix || segments.length > 1);
  if (!tool.hasMoves(cam)) tool.appendCameraId = null;
  const append = tool.appendCameraId === cam.id;
  const error = el('div', { class: 'move-error', role: 'status', text: tool.error || '', hidden: !tool.error || undefined });
  const apply = (name, options) => {
    if (tool.applyPreset(cam, name, options)) { tool.appendCameraId = null; rerender(); }
    else { error.textContent = tool.error; error.hidden = false; }
  };
  const path = app.timeline.paths.find(p => p.target === cam.id);
  const ranges = segments.map(s => [s.origin.time, s.origin.time + s.params.duration]);
  if (path) ranges.push([path.start, path.start + path.duration]);
  for (const t of app.timeline.tracks.filter(t => t.target === cam.id && ['pos', 'rot'].includes(t.property) && t.keys.length)) ranges.push([t.keys[0].t, t.keys.at(-1).t]);
  const duration = ranges.length ? Math.max(...ranges.map(r => r[1])) - Math.min(...ranges.map(r => r[0])) : 0;
  const summary = segments.length ? `${state.customPrefix ? '自定义轨迹 → ' : ''}${segments.map(s => PANEL_LABEL[s.name]).join(' → ')} · ${Math.round(duration * 10) / 10} 秒` : tool.hasMoves(cam) ? '自定义运镜' : '选择预设创建首段运镜';
  const description = el('div', { class: 'move-description', text: summary, title: summary });
  let hovered, focused;
  const describe = () => {
    const name = hovered || focused;
    const text = name ? name === 'pan' && append && app.timeline.paths.some(p => p.target === cam.id) ? '当前路径后暂不支持追加摇镜头' : ROUTES[name][1] : summary;
    description.textContent = text; description.title = text;
  };
  const card = name => el('button', {
    class: 'move-card' + (!append && !combined && single?.name === name ? ' applied' : ''),
    disabled: append && name === 'pan' && app.timeline.paths.some(p => p.target === cam.id) || undefined,
    'data-preset': name, 'aria-pressed': String(!append && !combined && single?.name === name),
    onmouseenter: () => { hovered = name; describe(); }, onmouseleave: () => { hovered = null; describe(); },
    onfocus: () => { focused = name; describe(); }, onblur: () => { focused = null; describe(); },
    onclick: () => apply(name, { mode: append ? 'append' : 'replace' }),
  }, [
    el('span', { class: 'move-route', html: `<svg viewBox="0 0 60 40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ROUTES[name][0]}"/></svg>` }),
    el('span', { class: 'move-card-title', text: PANEL_LABEL[name] }),
  ]);
  const nodes = [el('div', { class: 'sec-title move-heading' }, [
    el('span', { text: append ? '追加运镜' : '运镜' }),
    append ? el('button', { class: 'minibtn move-cancel', text: '取消', onclick: () => { tool.appendCameraId = null; tool.error = null; rerender(); } })
      : tool.hasMoves(cam) ? el('button', { class: 'minibtn move-append', text: '＋ 追加运镜', onclick: () => { tool.appendCameraId = cam.id; tool.error = null; rerender(); } }) : null,
  ]),
    append ? el('div', { class: 'move-append-note', text: '接在现有运镜结束之后' }) : null,
    el('div', { class: 'move-cards' }, [...PANEL_MOVES, 'pan'].map(card)), description,
    !append && combined ? el('div', { class: 'anim-info', text: '选择预设将替换当前运镜' }) : null,
  ];
  if (single && !append) {
    const { name, params } = single;
    const set = (key, value) => apply(name, { mode: 'edit', params: { [key]: value } });
    nodes.push(el('div', { class: 'sec-title' }, [el('span', { text: combined ? '末段参数' : '当前预设参数' }), el('button', { class: 'minibtn', text: '恢复默认', onclick: () => apply(name, { mode: 'edit', reset: true }) })]));
    const fields = [['duration', '时长', 's', .5], ['amount', '距离', 'm', .1], ['sweep', '角度', '°', 15], ['rise', '升高量', 'm', .1]];
    for (const [key, label, unit, step] of fields) {
      if (key !== 'duration' && !PANEL_PARAMS[name].includes(key)) continue;
      const row = numberRow({ label, unit, step, value: params[key], onChange: value => { set(key, value); if (tool.error) row.el.appendChild(error); } });
      row.el.querySelector('input').addEventListener('keydown', e => { if (e.key === 'Enter') e.currentTarget.blur(); });
      nodes.push(row.el);
    }
    if (PANEL_PARAMS[name].includes('dir')) nodes.push(dropdownRow({ label: '方向', value: params.dir, options: MOVE_DIRS[name].map(([value, label]) => ({ value, label })), onChange: value => set('dir', value) }).el);
  }
  const constraints = app.timeline.constraints.filter(c => c.target === cam.id);
  if (constraints.length) nodes.push(el('div', { class: 'anim-info' }, [
    el('span', { text: constraints.some(c => c.type === 'follow') ? '跟随生效时，位置由跟随控制；底层轨迹保留。' : '持续注视生效时，朝向由注视目标控制。' }),
    el('button', { class: 'minibtn', text: '摄像机属性', onclick: () => app.emit('inspect', { id: cam.id, section: 'constraint' }) }),
  ]));
  nodes.push(error, el('button', { class: 'minibtn', text: '播放预览', onclick: () => app.playback.play() }));
  return el('div', { class: 'anim-sec camera-moves', 'data-sec': 'move' }, nodes);
}

export function cameraMoveActions(app, cam, rerender) {
  return el('div', { class: 'anim-btns move-actions' }, [
    app.cameraMoves.hasMoves(cam) ? el('button', { class: 'minibtn move-clear', text: '清除运镜', title: '清除位置与旋转动画，保留跟随和注视', onclick: () => { app.cameraMoves.clear(cam); rerender(); } }) : null,
  ]);
}

/** Attribute controls read the document; each edit targets one selected interval. */
export function cameraConstraintSection(app, cam, type, selection, rerender, edit) {
  const list = app.timeline.constraints.filter(c => c.target === cam.id && c.type === type);
  const time = app.timeline.active ? app.playback.time : 0;
  const active = list.findLast(c => (c.start ?? 0) <= time && (c.end == null || time <= c.end));
  const selected = list.find(c => c.id === selection[type]) || active;
  const subjects = app.cameraMoves.subjects(cam);
  const nodes = [];
  const update = patch => edit(tl => {
    if (selected) tl.updateConstraint(selected.id, patch);
    else selection[type] = tl.addConstraint({ type, target: cam.id, ...patch }).id;
  });
  if (list.length > 1 || list.length && !active) nodes.push(dropdownRow({
    label: type === 'follow' ? '跟随区间' : '注视区间', value: selected?.id || '',
    options: [{ value: '', label: '播放头不在生效区间' }, ...list.map(c => ({ value: c.id, label: `${c.start ?? 0}–${c.end ?? app.timeline.duration} 秒${c.id === active?.id ? ' · 当前' : ''}` }))],
    onChange: id => { selection[type] = id; rerender(); },
  }).el);
  const vecRow = (label, arr, key) => {
    const value = arr.slice();
    return tripleRow({ label, step: .05, onCommit: () => update({ [key]: value.map(v => Math.round(v * 1000) / 1000) }),
      axes: ['x', 'y', 'z'].map((key, i) => ({ key, get: () => value[i], set: v => { value[i] = v; } })) }).el;
  };
  const targetRow = dropdownRow({ label: type === 'follow' ? '跟随目标' : '注视目标',
    value: selected ? Array.isArray(selected.subject) ? '__point' : selected.subject : type === 'lookAt' ? '__point' : '',
    options: [type === 'follow' ? { value: '', label: '不跟随' } : { value: '__point', label: '手动坐标' }, ...subjects],
    onChange: value => edit(tl => {
      if (!value) { if (selected) tl.removeConstraint(selected.id); return; }
      const subject = value === '__point' ? cam.lookTarget.toArray() : value;
      const patch = { subject, ...(type === 'follow' ? { offset: followOffset(app, cam, value) } : {}) };
      if (selected) tl.updateConstraint(selected.id, patch);
      else {
        const c = tl.addConstraint({ type, target: cam.id, ...patch });
        selection[type] = c.id;
      }
    }),
  });
  if (list.length && !selected) {
    const select = targetRow.el.querySelector('select'); select.disabled = true; select.title = '请先选择要编辑的生效区间';
  }
  nodes.push(targetRow.el);
  if (type === 'lookAt' && !list.length) nodes.push(vecRow('注视坐标', cam.lookTarget.toArray(), 'subject'));
  if (selected) {
    if (type === 'follow') nodes.push(vecRow('偏移', selected.offset, 'offset'));
    else if (Array.isArray(selected.subject)) nodes.push(vecRow('注视坐标', selected.subject, 'subject'));
    nodes.push(el('details', { class: 'constraint-range' }, [el('summary', { text: '生效时间' }), el('div', { class: 'anim-pair' }, [
      numberRow({ label: '开始', value: selected.start, step: .1, min: 0, unit: 's', allowEmpty: true, placeholder: '开头', onChange: start => update({ start }) }).el,
      numberRow({ label: '结束', value: selected.end, step: .1, min: 0, unit: 's', allowEmpty: true, placeholder: '结尾', onChange: end => update({ end }) }).el,
    ])]));
  }
  return el('div', { class: 'camera-constraint', 'data-sec': 'constraint', 'data-constraint-type': type, 'data-interval': selected?.id || '' }, nodes);
}

/** 新建跟随时的默认偏移：机位相对 subject 的当前位置（subject 的 yaw 坐标系），机位不会跳走。 */
function followOffset(app, cam, subjectId) {
  const anchor = anchorOf(app, subjectId);
  if (!anchor) return [0, 0, 0];
  // 与播放求值共用脚底锚点和场景局部 yaw，避免混入场景旋转或角色贴地偏移。
  return cam.root.position.clone().sub(anchor.pos)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), -anchor.yaw).toArray().map(round6);
}
