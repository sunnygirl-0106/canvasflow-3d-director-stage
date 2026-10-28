// @ts-check
import { pathLength } from '../anim/pathGen.js';
import { roundTo } from '../util/math.js';
// ---- 场景摘要 ----
const f2 = (v) => roundTo(v, 2).toString();
const vec = (p) => `(${p.map(f2).join(', ')})`;
const span = (start, end) => `${f2(start ?? 0)}–${end == null ? '全程' : f2(end) + ' s'}`;

/** 实体的静态描述；组员只在所属组中列出，机位使用注视点而非欧拉角。 */
function describeEntity(entity, byId) {
  const { transform } = entity;
  const yaw = () => transform.rot[0] || transform.rot[2] ? `rot ${vec(transform.rot)}` : `yaw ${f2(transform.rot[1])}`;
  const scale = () => transform.scale.every((v) => v === 1) ? '' : ` · scale ${vec(transform.scale)}`;
  switch (entity.type) {
    case 'character': {
      const pose = entity.pose.preset ?? (Object.keys(entity.pose.values).length ? '自定义' : 'stand');
      return `- ${entity.name} · 角色 ${entity.body} · pos ${vec(transform.pos)} · ${yaw()}${scale()} · 姿势 ${pose}`;
    }
    case 'prop':
      return `- ${entity.name} · 道具 ${entity.kind} · pos ${vec(transform.pos)} · ${yaw()}${scale()}`;
    case 'camera':
      return `- ${entity.name} · 机位 · pos ${vec(transform.pos)} · 对准 ${vec(entity.lookAt)} · fov ${f2(entity.fov)}`;
    default: {
      const members = entity.members.map((id) => byId.get(id));
      const poses = [...new Set(members.map((member) => member.pose.preset ?? 'stand'))].join('/');
      const names = members.slice(0, 8).map((member) => member.name).join('、') + (members.length > 8 ? ' 等' : '');
      return `- ${entity.name} · 组 ${members.length} 人（${names}）· pos ${vec(transform.pos)} · ${yaw()} · 姿势 ${poses}`;
    }
  }
}

/** 按路径、约束、关键帧的固定顺序追加动画信息。 */
function describeAnimation(entity, doc, nameOf) {
  const parts = [];
  const path = doc.paths.find((path) => path.target === entity.id);
  if (path) {
    const length = pathLength(path.points, path.closed, path.stops, path.interpolation);
    const endPoint = path.closed ? path.points[0] : path.points[path.points.length - 1];
    parts.push(`路径 ${path.points.length} 点 长 ${f2(length)} m ${span(path.start, path.start + path.duration)} 终点 ${vec(endPoint)}`);
  }
  for (const constraint of doc.constraints.filter((constraint) => constraint.target === entity.id)) {
    const type = constraint.type === 'lookAt' ? '注视' : '跟随';
    parts.push(`${type} ${nameOf(constraint.subject)} ${span(constraint.start, constraint.end)}`);
  }
  for (const track of doc.timeline.tracks.filter((track) => track.target === entity.id && track.keys.length)) {
    const times = track.keys.slice(0, 8).map((key) => f2(key.t)).join('/');
    const notice = track.keys.length > 8 ? '，仅列前8个时刻' : '';
    parts.push(`${track.property} 关键帧 ${track.keys.length} 个（${times} s${notice}）`);
  }
  return parts.length ? ' · ' + parts.join(' · ') : '';
}

/**
 * 给模型看的当前场景文本：每实体一行（名字、类型、体型 / 种类、pos、yaw、姿势、路径、运镜 / 约束），
 * 加场景参数与时间轴。全局概览加目标详情，字符预算内优先保留选中与名字命中对象。
 */
export function summarize(appOrDoc, { input = '', selectedId = appOrDoc.selectedId, budget = 12000 } = {}) {
  const doc = appOrDoc.exportDocument ? appOrDoc.exportDocument({ view: false }) : appOrDoc;
  budget = Number.isFinite(budget) ? Math.max(256, Math.min(32000, Math.floor(budget))) : 12000;
  const byId = new Map(doc.entities.map((e) => [e.id, e]));
  const nameOf = (s) => (Array.isArray(s) ? vec(s) : byId.get(s)?.name ?? '?');
  const s = doc.scene;
  const tl = doc.timeline;
  const lines = [
    `场景：天空 ${s.sky} · 地面 ${s.ground.visible ? '显示' : '隐藏'}，高 ${f2(s.ground.height)} · 比例 ${s.ratio} · 全景 ${s.panorama ? '有' : '无'}`,
    `时间轴：${f2(tl.duration)} s · ${tl.fps} fps · 主机位 ${tl.mainCameraId ? nameOf(tl.mainCameraId) : '未设'}`,
  ];
  lines.push(`全局结构：${doc.entities.length} 实体 · ${doc.entities.filter((e) => e.type === 'group').length} 组 · ${doc.paths.length} 路径 · ${tl.tracks.length} 轨道 · ${doc.constraints.length} 约束`);
  const tops = doc.entities.filter((e) => !(e.type === 'character' && e.parent));
  if (!tops.length) lines.push('实体：（空场景）');
  lines.push(`实体（${doc.entities.length}，名字唯一，按名字引用）：`);
  for (const entity of tops) {
    lines.push(describeEntity(entity, byId) + describeAnimation(entity, doc, nameOf));
  }
  return boundedContext(doc, byId, lines, { input, selectedId, budget });
}

// 预算包括裁剪提示；绝不把半截 JSON 当成完整目标信息交给模型。
function boundedContext(doc, byId, overview, { input, selectedId, budget }) {
  const notice = '\n【摘要已裁剪：未列出的实体、路径点或键值不可猜测；信息不足时请说明需要的目标或范围。】';
  const lines = [];
  let size = 0;
  let omitted = false;
  const addLine = (line) => {
    // 沿用每行额外计一个换行的预算，并始终为裁剪提示预留空间。
    if (size + line.length + 1 > budget - notice.length) {
      omitted = true;
      return false;
    }
    lines.push(line);
    size += line.length + 1;
    return true;
  };
  // 先保留全局结构与直接命中目标，再放关联对象和普通概览。
  overview.slice(0, 3).forEach(addLine);
  const matches = doc.entities.filter((e) => e.name && input.includes(e.name)).sort((a, b) => b.name.length - a.name.length);
  const direct = new Set([selectedId, ...matches.map((e) => e.id)].filter((id) => byId.has(id)));
  const related = new Set();
  for (const id of direct) {
    const e = byId.get(id);
    if (e.parent) related.add(e.parent);
    for (const c of doc.constraints) if (c.target === id || c.subject === id) {
      related.add(c.target); if (typeof c.subject === 'string') related.add(c.subject);
    }
  }
  if (doc.timeline.mainCameraId) related.add(doc.timeline.mainCameraId);
  const addDetails = (id, label) => {
    const e = byId.get(id);
    if (!e) return;
    const value = e.type === 'group' ? { ...e, members: e.members.slice(0, 12), memberCount: e.members.length } : e;
    if (e.type === 'group' && e.members.length > 12) omitted = true;
    addLine(`${label}：${JSON.stringify(value)}`);
    for (const p of doc.paths.filter((p) => p.target === id)) {
      if (!addLine(`路径详情：${JSON.stringify(p)}`)) {
        addLine(`路径采样（已裁剪）：${JSON.stringify({ ...p, points: undefined, stops: undefined, stopTimes: undefined,
          pointCount: p.points.length, samples: [0, p.points.length - 1].map((index) => ({ index, point: p.points[index] })) })}`);
      }
    }
    for (const t of doc.timeline.tracks.filter((t) => t.target === id)) {
      if (!addLine(`关键帧值：${JSON.stringify(t)}`)) {
        addLine(`关键帧采样（已裁剪）：${JSON.stringify({ ...t, keys: t.keys.length ? [t.keys[0], t.keys.at(-1)] : [], keyCount: t.keys.length })}`);
      }
    }
    for (const c of doc.constraints.filter((c) => c.target === id || c.subject === id)) addLine(`约束详情：${JSON.stringify(c)}`);
  };
  // 先列所有直接目标的身份，避免单个长路径挤掉其他直接目标。
  for (const id of direct) addLine(`直接目标：${JSON.stringify({ id, name: byId.get(id).name, type: byId.get(id).type })}`);
  for (const id of direct) addDetails(id, '目标详情');
  for (const id of related) if (!direct.has(id)) addDetails(id, '关联详情');
  overview.slice(3).forEach(addLine);
  return lines.join('\n') + (omitted ? notice : '');
}
