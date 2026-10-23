import * as THREE from 'three';
import { el, toast } from '../util/dom.js';
import { tripleRow, dropdownRow, numberRow } from './widgets.js';
import { CAMERA_MOVES, MOVE_PARAMS, MOVE_DIRS, MOVE_LABEL } from '../anim/cameraMoves.js';

// 表单只渲染运行时状态；刷新与文档写入由 Inspector 提供，沿用统一错误处理。
const round2 = (x) => Math.round(x * 100) / 100;
const fmtS = (x) => (Math.round(x * 10) / 10).toFixed(1);

/**
 * 运镜段（机位）：预设 / 主体 / 参数 / 时长 → 应用（或追加）；清除运镜；已有段列表（只能删最后一段）。
 * 表单是会话态（app.cameraMoves.form），改动即重算视口里的虚线预览；写操作全在 CameraMoveTool（一次撤销）。
 */
export function cameraMoveSection(app, cam, rerender) {
  const tool = app.cameraMoves;
  const f = tool.formOf(cam);
  const ctx = tool.context(cam);
  const params = tool.params(cam);
  const built = tool.build(cam);
  const setParam = (k, v) => { f.params[k] = v; rerender(); };
  const segs = tool.segments(cam);

  const nearest = tool.nearestSubject(cam);
  const nearestLabel = Array.isArray(nearest) ? '前方 3 m' : app.findEntity(nearest)?.name;
  const nodes = [
    el('div', { class: 'sec-title' }, [
      el('span', { text: '运镜' }),
      segs.length ? el('span', { class: 'sec-tag path', text: `${segs.length} 段` }) : null,
    ]),
    dropdownRow({
      label: '预设', value: f.name,
      options: CAMERA_MOVES.map(([value, label]) => ({ value, label: `${label} ${value}` })),
      onChange: (v) => { tool.setName(cam, v); rerender(); },
    }).el,
    dropdownRow({
      label: '主体', value: f.subject,
      options: [{ value: '', label: `最近角色（${nearestLabel}）` }, ...tool.subjects(cam), { value: '__point', label: '自定义点' }],
      onChange: (v) => { f.subject = v; rerender(); },
    }).el,
  ];
  if (f.subject === '__point') {
    const v = f.point;
    nodes.push(tripleRow({
      label: '主体坐标', step: 0.05, onCommit: rerender,
      axes: ['x', 'y', 'z'].map((k, i) => ({ key: k, get: () => v[i], set: (x) => { v[i] = Math.round(x * 1000) / 1000; } })),
    }).el);
  }
  const keys = MOVE_PARAMS[f.name];
  const pair = [];
  if (keys.includes('amount')) pair.push(numberRow({ label: '距离', value: round2(params.amount), step: 0.1, min: 0.01, unit: 'm', onChange: (v) => setParam('amount', v) }).el);
  if (keys.includes('sweep')) pair.push(numberRow({ label: '扫过角度', value: params.sweep, step: 15, min: 1, unit: '°', onChange: (v) => setParam('sweep', v) }).el);
  pair.push(numberRow({ label: '时长', value: params.duration, step: 0.5, min: 0.1, unit: 's', onChange: (v) => setParam('duration', v) }).el);
  nodes.push(el('div', { class: 'anim-pair' }, pair));
  if (keys.includes('dir')) {
    nodes.push(dropdownRow({
      label: '方向', value: params.dir,
      options: MOVE_DIRS[f.name].map(([value, label]) => ({ value, label })),
      onChange: (v) => setParam('dir', v),
    }).el);
  }
  nodes.push(el('div', { class: 'anim-info move-info' + (built.error ? ' err' : ''), text: built.error || `${fmtS(ctx.time)}–${fmtS(ctx.time + built.move.duration)} s · 注视 ${subjectName(app, built.subject)}` }));
  nodes.push(el('div', { class: 'anim-btns' }, [
    // 有错误时也可点：点击 = toast 原因（如「摇镜头请单独使用或放在最前」）
    el('button', { class: 'minibtn primary', text: ctx.append ? '追加' : '应用', onclick: () => tool.request(cam) }),
    tool.hasMoves(cam) ? el('button', { class: 'minibtn danger', text: '清除运镜', title: '删除路径、该机位全部约束与旋转轨道', onclick: () => tool.clear(cam) }) : null,
  ]));
  if (segs.length) {
    nodes.push(el('div', { class: 'move-segs' }, segs.map((sg, i) => el('div', { class: 'move-seg' }, [
      el('span', { class: 'move-seg-name', text: `${i + 1}. ${MOVE_LABEL[sg.name]}` }),
      el('span', { class: 'move-seg-time', text: `${fmtS(sg.start)}–${fmtS(sg.start + sg.duration)} s` }),
      el('button', {
        class: 'move-seg-del', text: '×', title: i === segs.length - 1 ? '删除这一段' : '只能删除最后一段',
        onclick: () => { if (i === segs.length - 1) tool.removeLast(cam); else toast('只能删除最后一段，请清除后重做'); },
      }),
    ]))));
  }
  app.pathOverlay.setMovePreview(built.move?.points || null, { closed: built.move?.closed && !ctx.append });
  return el('div', { class: 'anim-sec', 'data-sec': 'move' }, nodes);
}

function subjectName(app, subject) {
  if (Array.isArray(subject)) return `(${subject.map((x) => x.toFixed(2)).join(', ')})`;
  return app.findEntity(subject)?.name || subject;
}

/** 约束段（机位）：注视（无 / 实体 / 自定义点）、跟随（实体 + 偏移），各自生效区间。 */
export function cameraConstraintSection(app, cam, list, edit) {
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
  const lookVal = !look ? '' : Array.isArray(look.subject) ? '__point' : look.subject;
  nodes.push(dropdownRow({
    label: '注视', value: lookVal,
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
