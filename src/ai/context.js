import { pathLength } from '../anim/pathGen.js';
const r2 = (x) => Math.round(x * 100) / 100;
// ---- 场景摘要 ----
const f2 = (v) => r2(v).toString();
const vec = (p) => `(${p.map(f2).join(', ')})`;

/**
 * 给模型看的当前场景文本：每实体一行（名字、类型、体型 / 种类、pos、yaw、姿势、路径、运镜 / 约束），
 * 加场景参数与时间轴。全局概览加目标详情，字符预算内优先保留选中与名字命中对象。
 */
export function summarize(appOrDoc, { input = '', selectedId = appOrDoc.selectedId, budget = 12000 } = {}) {
  const doc = appOrDoc.exportDocument ? appOrDoc.exportDocument({ view: false }) : appOrDoc;
  budget = Number.isFinite(budget) ? Math.max(256, Math.min(32000, Math.floor(budget))) : 12000;
  const byId = new Map(doc.entities.map((e) => [e.id, e]));
  const nameOf = (s) => (Array.isArray(s) ? vec(s) : byId.get(s)?.name ?? '?');
  const span = (s, e) => `${f2(s ?? 0)}–${e == null ? '全程' : f2(e) + ' s'}`;
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
  const anim = (e) => {
    const out = [];
    const p = doc.paths.find((x) => x.target === e.id);
    if (p) out.push(`路径 ${p.points.length} 点 长 ${f2(pathLength(p.points, p.closed, p.stops, p.interpolation))} m ${span(p.start, p.start + p.duration)} 终点 ${vec(p.closed ? p.points[0] : p.points[p.points.length - 1])}`);
    for (const c of doc.constraints.filter((x) => x.target === e.id)) out.push(`${c.type === 'lookAt' ? '注视' : '跟随'} ${nameOf(c.subject)} ${span(c.start, c.end)}`);
    for (const t of tl.tracks.filter((x) => x.target === e.id && x.keys.length)) out.push(`${t.property} 关键帧 ${t.keys.length} 个（${t.keys.slice(0, 8).map((k) => f2(k.t)).join('/')} s${t.keys.length > 8 ? '，仅列前8个时刻' : ''}）`);
    return out.length ? ' · ' + out.join(' · ') : '';
  };
  const yaw = (e) => (e.transform.rot[0] || e.transform.rot[2] ? `rot ${vec(e.transform.rot)}` : `yaw ${f2(e.transform.rot[1])}`);
  const scale = (e) => (e.transform.scale.every((v) => v === 1) ? '' : ` · scale ${vec(e.transform.scale)}`);
  for (const e of tops) {
    if (e.type === 'character') lines.push(`- ${e.name} · 角色 ${e.body} · pos ${vec(e.transform.pos)} · ${yaw(e)}${scale(e)} · 姿势 ${e.pose.preset ?? (Object.keys(e.pose.values).length ? '自定义' : 'stand')}${anim(e)}`);
    else if (e.type === 'prop') lines.push(`- ${e.name} · 道具 ${e.kind} · pos ${vec(e.transform.pos)} · ${yaw(e)}${scale(e)}${anim(e)}`);
    else if (e.type === 'camera') lines.push(`- ${e.name} · 机位 · pos ${vec(e.transform.pos)} · 对准 ${vec(e.lookAt)} · fov ${f2(e.fov)}${anim(e)}`);
    else {
      const ms = e.members.map((id) => byId.get(id));
      const poses = [...new Set(ms.map((m) => m.pose.preset ?? 'stand'))].join('/');
      const names = ms.length > 8 ? `${ms.slice(0, 8).map((m) => m.name).join('、')} 等` : ms.map((m) => m.name).join('、');
      lines.push(`- ${e.name} · 组 ${ms.length} 人（${names}）· pos ${vec(e.transform.pos)} · ${yaw(e)} · 姿势 ${poses}${anim(e)}`);
    }
  }
  return boundedContext(doc, byId, lines, { input, selectedId, budget });
}

// 预算包括裁剪提示；绝不把半截 JSON 当成完整目标信息交给模型。
function boundedContext(doc, byId, overview, { input, selectedId, budget }) {
  const notice = '\n【摘要已裁剪：未列出的实体、路径点或键值不可猜测；信息不足时请说明需要的目标或范围。】';
  const lines = []; let size = 0, omitted = false;
  const add = (line) => {
    if (size + line.length + 1 > budget - notice.length) { omitted = true; return false; }
    lines.push(line); size += line.length + 1; return true;
  };
  // 先保留全局结构与直接命中目标，再放关联对象和普通概览。
  overview.slice(0, 3).forEach(add);
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
  const details = (id, label) => {
    const e = byId.get(id); if (!e) return;
    const value = e.type === 'group' ? { ...e, members: e.members.slice(0, 12), memberCount: e.members.length } : e;
    if (e.type === 'group' && e.members.length > 12) omitted = true;
    add(`${label}：${JSON.stringify(value)}`);
    for (const p of doc.paths.filter((p) => p.target === id)) {
      if (!add(`路径详情：${JSON.stringify(p)}`)) {
        add(`路径采样（已裁剪）：${JSON.stringify({ ...p, points: undefined, stops: undefined, stopTimes: undefined,
          pointCount: p.points.length, samples: [0, p.points.length - 1].map((index) => ({ index, point: p.points[index] })) })}`);
      }
    }
    for (const t of doc.timeline.tracks.filter((t) => t.target === id)) {
      if (!add(`关键帧值：${JSON.stringify(t)}`)) add(`关键帧采样（已裁剪）：${JSON.stringify({ ...t, keys: t.keys.length ? [t.keys[0], t.keys.at(-1)] : [], keyCount: t.keys.length })}`);
    }
    for (const c of doc.constraints.filter((c) => c.target === id || c.subject === id)) add(`约束详情：${JSON.stringify(c)}`);
  };
  // 先列所有直接目标的身份，避免单个长路径挤掉其他直接目标。
  for (const id of direct) add(`直接目标：${JSON.stringify({ id, name: byId.get(id).name, type: byId.get(id).type })}`);
  for (const id of direct) details(id, '目标详情');
  for (const id of related) if (!direct.has(id)) details(id, '关联详情');
  overview.slice(3).forEach(add);
  return lines.join('\n') + (omitted ? notice : '');
}
