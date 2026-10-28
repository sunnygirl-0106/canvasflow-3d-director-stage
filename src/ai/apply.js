// @ts-check
// ops → 场景：validateOps → 在文档拷贝上逐条执行（src/doc/edit.js 的纯函数）→ 现有校验器 →
// 全部通过才 loadDocument，History 记一步。任何一步失败都返回错误列表，场景不变。
import { checkRequestState } from '../util/requestGuard.js';
import * as THREE from 'three';
import { validateOps, sceneIndex, uniqueName } from './ops.js';
import { DEFAULT_POSE } from './vocab.js';
import * as edit from '../doc/edit.js';
import { validate, DEFAULT_TIMELINE } from '../doc/schema.js';
import { BODY_TYPES, PROP_PALETTE, CAMERA_FOV } from '../config.js';
import { propLocalCenter } from '../entities/Prop.js';
import { aimRotation, MoveError, MOVE_LABEL } from '../anim/cameraMoves.js';
import { line, polar, toward, pathLength, arcPoints, ARC_SWEEP, TOWARD_STOP } from '../anim/pathGen.js';
import { aimPointWith, anchorWith } from '../anim/subject.js';
import { upsertKeys } from '../anim/keyframes.js';
import { hexColor } from '../entities/Entity.js';
import { round6, clone, D2R } from '../util/math.js';

const r2 = (x) => Math.round(x * 100) / 100;

/** ops 执行期的错误（带定位，原文喂回模型）。 */
class OpError extends Error {}

// ---- 文档里的几何（AI 新建的实体还没有场景对象，只能按文档推算）----
const matrixOf = (t) => new THREE.Matrix4().compose(
  new THREE.Vector3(...t.pos),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(...t.rot.map((d) => d * D2R))),
  new THREE.Vector3(...t.scale),
);

/** 实体在场景根坐标下的矩阵（群众成员 = 组 × 成员）。 */
function worldMatrix(doc, e) {
  const m = matrixOf(e.transform);
  const parent = e.parent ? edit.findEntity(doc, e.parent) : null;
  return parent ? m.premultiply(matrixOf(parent.transform)) : m;
}

/** 文档适配器（注视点 / 锚点定义见 anim/subject.js，与运行时共用）：角色脚底 = root 原点（文档口径落地 y=0）。 */
const docAdapter = (doc) => ({
  get: (id) => edit.findEntity(doc, id),
  type: (e) => e.type,
  members: (e) => e.members.map((id) => edit.findEntity(doc, id)),
  matrix: (e, out) => out.copy(worldMatrix(doc, e)),
  aimLocal: (e, out) => (e.type === 'character' ? out.set(0, BODY_TYPES[e.body].height / 2, 0)
    : e.type === 'prop' ? out.copy(propLocalCenter(e.kind)) : out.set(0, 0, 0)),
  footLocal: (e, out) => out.set(0, 0, 0),
});

/** 注视点 [x,y,z]（subject 为 id 或坐标；不存在返回 null）。 */
export function docAimPoint(doc, subject) {
  return aimPointWith(docAdapter(doc), subject)?.toArray() ?? null;
}

/** 路径吸附点（「走到 / 环绕中心 / 直线终点」，与 PathTool.anchorOf 同口径）：角色 / 组 = 脚底 / 轴心，其余 = 注视点。 */
function docAnchor(doc, id) {
  const e = edit.findEntity(doc, id);
  if (e.type === 'character' || e.type === 'group') return new THREE.Vector3().setFromMatrixPosition(worldMatrix(doc, e)).toArray();
  return docAimPoint(doc, id);
}

/** 跟随锚点 + yaw（弧度）：与运行时 follow 同一锚点（道具 = root，不是几何中心）。 */
function docAnchorYaw(doc, id) {
  const a = anchorWith(docAdapter(doc), id);
  return { pos: a.pos.toArray(), yaw: a.yaw };
}

// ---- 编译：在文档上逐条执行 ----
/**
 * 在文档拷贝上执行一批（已校验的）ops。纯函数：不碰场景。
 * @param {object} base 当前文档（不修改）
 * @param {object[]} ops
 * @param {{mode?:string, charSeq?:number}} opts charSeq = 角色起名计数器起点（群众成员起名用）
 * @returns {{doc:object, errors:string[], renames:Object<string,string>, warnings:string[], applied:number}}
 */
export function compileOps(base, ops, { mode = 'modify', charSeq = 0 } = {}) {
  const doc = clone(base);
  /** @type {Record<string,string>} */
  const renames = {};
  const warnings = [];
  const errors = [];
  const ground = () => doc.scene.ground.height;
  const idOf = (name) => doc.entities.find((e) => e.name === name)?.id;
  const ent = (name) => edit.findEntity(doc, idOf(name));
  const subjectOf = (v) => (Array.isArray(v) ? v.slice() : idOf(v));
  const takenNames = () => new Set(doc.entities.map((e) => e.name));
  const nameFor = (name) => {
    const final = uniqueName(name, takenNames());
    if (final !== name) renames[name] = final;
    return final;
  };
  const charNames = takenNames();
  const memberName = () => {
    let nm;
    do nm = edit.charName(charSeq++); while (charNames.has(nm) || takenNames().has(nm));
    charNames.add(nm);
    return nm;
  };
  const lastPan = new Map(); // cameraId → 本批里上一段摇镜头（追加用）

  const clearAll = () => {
    doc.entities = [];
    delete doc.meta.cameraMoves;
    doc.paths = [];
    doc.constraints = [];
    doc.timeline = { ...clone(DEFAULT_TIMELINE), tracks: [] };
    doc.scene.activeCameraId = null;
    lastPan.clear();
  };
  if (mode === 'generate' && ops[0]?.op !== 'clear') clearAll(); // 生成模式一律从空场景开始

  const RUN = {
    clear: clearAll,
    scene(o) {
      if (o.sky) doc.scene.sky = o.sky.toLowerCase();
      if (o.ground) Object.assign(doc.scene.ground, o.ground);
      if (o.ratio) doc.scene.ratio = o.ratio;
      if (o.panorama === 'none') { doc.scene.panorama = null; doc.assets = {}; }
    },
    add_character(o) {
      edit.addCharacter(doc, { name: nameFor(o.name), body: o.body, pos: o.pos, yaw: o.yaw ?? 0, color: o.color, pose: o.pose ?? DEFAULT_POSE });
    },
    add_prop(o) {
      const s = o.scale ?? 1;
      const n = doc.entities.filter((e) => e.type === 'prop').length;
      doc.entities.push({
        type: 'prop', id: edit.newId(doc), name: nameFor(o.name), kind: o.kind,
        color: o.color?.toLowerCase() ?? hexColor(PROP_PALETTE[n % PROP_PALETTE.length]), visible: true,
        transform: { pos: o.pos.map(round6), rot: [0, round6(o.yaw ?? 0), 0], scale: (Array.isArray(s) ? s : [s, s, s]).map(round6) },
      });
    },
    add_camera(o) {
      const aim = docAimPoint(doc, subjectOf(o.lookAt));
      if (Math.hypot(aim[0] - o.pos[0], aim[1] - o.pos[1], aim[2] - o.pos[2]) < 1e-3) throw new OpError('.lookAt 与机位位置重合，无法确定朝向');
      const id = edit.newId(doc);
      doc.entities.push({
        type: 'camera', id, name: nameFor(o.name), visible: true,
        transform: { pos: o.pos.map(round6), rot: aimRotation(o.pos, aim, 0), scale: [1, 1, 1] },
        fov: o.fov ?? CAMERA_FOV, roll: 0, lookAt: aim.map(round6),
      });
      if (!doc.scene.activeCameraId) doc.scene.activeCameraId = id;
    },
    add_group(o) {
      edit.groupCharacters(doc, o.members.map(idOf), { name: nameFor(o.name) });
    },
    add_crowd(o) {
      edit.addCrowd(doc, { rows: o.rows, cols: o.cols, spacing: o.spacing ?? edit.CROWD_SPACING, name: nameFor(o.name), pos: o.pos, yaw: o.yaw ?? 0, body: o.body ?? 'male', memberName });
    },
    remove(o) {
      edit.removeEntity(doc, idOf(o.target));
    },
    move(o) {
      const e = ent(o.target);
      const t = e.transform;
      if (o.pos) t.pos = o.pos.map(round6);
      if (o.yaw !== undefined) t.rot = [t.rot[0], round6(o.yaw), t.rot[2]];
      if (o.scale !== undefined) t.scale = (Array.isArray(o.scale) ? o.scale : [o.scale, o.scale, o.scale]).map(round6);
      if (e.type === 'camera' && o.pos) {
        if (Math.hypot(...e.lookAt.map((v, k) => v - t.pos[k])) < 1e-3) throw new OpError('.pos 与该机位的注视点重合');
        t.rot = aimRotation(t.pos, e.lookAt, e.roll);
      }
      if (doc.paths.some((p) => p.target === e.id) && (o.pos || (o.yaw !== undefined))) {
        warnings.push(`「${e.name}」有路径：播放时位置由路径决定（需要的话用 set_path 重画）`);
      }
    },
    set_pose(o) {
      const e = ent(o.target);
      const list = e.type === 'group' ? e.members.map((id) => edit.findEntity(doc, id)) : [e];
      for (const m of list) m.pose = edit.posePreset(m.body, o.preset);
    },
    set_path(o) {
      const e = ent(o.target);
      const start = edit.pathStartPoint(e.type, e.transform.pos, ground());
      const y = start[1];
      const pa = o.path;
      const at = (v) => { const p = Array.isArray(v) ? v : docAnchor(doc, idOf(v)); return [p[0], y, p[2]]; };
      let points;
      let closed = false;
      if (pa.kind === 'points') points = [start, ...pa.points.map((q) => (e.type === 'camera' ? q.slice() : [q[0], y, q[2]]))];
      else if (pa.kind === 'line') points = line(start, at(pa.to));
      else if (pa.kind === 'arc') {
        const center = at(pa.center);
        const { radius, deg } = polar(center, start);
        if (radius < 0.1) throw new OpError('.path.center 离实体当前位置太近，无法环绕');
        const sweep = (pa.sweep ?? ARC_SWEEP) * (pa.dir === 'cw' ? -1 : 1);
        ({ points, closed } = arcPoints({ center, radius, startDeg: deg, sweepDeg: sweep }, y));
      } else {
        const stop = pa.stop ?? (e.type === 'camera' ? TOWARD_STOP.camera : TOWARD_STOP.default);
        points = toward(start, at(pa.target), { stopDistance: stop });
        if (!points) throw new OpError(`.path.target 离目标太近（≤ ${stop} m），不需要移动`);
      }
      if (pathLength(points, closed) < 0.05) throw new OpError('.path 路径太短（< 5 cm）');
      const set = {};
      for (const k of ['start', 'duration', 'speed', 'orient']) if (o[k] !== undefined) set[k] = o[k];
      if (pa.kind === 'points' && pa.stops?.length) set.stops = pa.stops.map((i) => i + 1); // points[i] 是路径第 i+1 个顶点（首点 = 当前位置）
      edit.setPath(doc, e.id, points, { closed, start: 0, set });
    },
    clear_path(o) {
      if (!edit.removePath(doc, idOf(o.target))) warnings.push(`「${o.target}」本来就没有路径`);
    },
    camera_move(o) {
      const cam = ent(o.target);
      if (!o.append) { edit.clearCameraMoves(doc, cam.id); lastPan.delete(cam.id); }
      const ctx = edit.moveContext(doc, cam.id, { lastPan: lastPan.get(cam.id) || null });
      const aimOf = (id) => docAimPoint(doc, id);
      const subject = o.subject !== undefined ? subjectOf(o.subject)
        : edit.nearestSubject(doc, cam.id, ctx.position, aimOf) ?? edit.aheadPoint(cam.transform);
      const params = {};
      for (const k of ['amount', 'dir', 'sweep', 'duration']) if (o[k] !== undefined) params[k] = o[k];
      const ownPan = lastPan.has(cam.id);
      try {
        const r = edit.applyCameraMove(doc, cam.id, { name: o.preset, subject, aim: docAimPoint(doc, subject), params, lastPan: lastPan.get(cam.id) || null, ownPan });
        if (r.move.points) lastPan.delete(cam.id);
        else lastPan.set(cam.id, { start: r.start, duration: r.move.duration, rotEnd: r.undo.rotEnd });
      } catch (err) {
        if (err instanceof MoveError) throw new OpError(` 运镜 ${o.preset}（${MOVE_LABEL[o.preset]}）无法生成：${err.message}`);
        throw err;
      }
    },
    clear_moves(o) {
      const cam = ent(o.target);
      lastPan.delete(cam.id);
      if (!edit.clearCameraMoves(doc, cam.id)) warnings.push(`「${o.target}」本来就没有运镜`);
    },
    look_at(o) {
      const cam = ent(o.target);
      doc.constraints = doc.constraints.filter((c) => !(c.target === cam.id && c.type === 'lookAt'));
      doc.constraints.push({ id: edit.newId(doc), type: 'lookAt', target: cam.id, subject: subjectOf(o.subject), offset: [0, 0, 0], start: o.start ?? null, end: o.end ?? null });
    },
    follow(o) {
      const cam = ent(o.target);
      const sid = idOf(o.subject);
      let offset = o.offset;
      if (!offset) { // 默认 = 当前相对位置（在主体 yaw 坐标系下），机位不跳
        const a = docAnchorYaw(doc, sid);
        const v = new THREE.Vector3(...cam.transform.pos).sub(new THREE.Vector3(...a.pos)).applyAxisAngle(new THREE.Vector3(0, 1, 0), -a.yaw);
        offset = v.toArray().map(round6);
      }
      doc.constraints = doc.constraints.filter((c) => !(c.target === cam.id && c.type === 'follow'));
      doc.constraints.push({ id: edit.newId(doc), type: 'follow', target: cam.id, subject: sid, offset, start: o.start ?? null, end: o.end ?? null });
    },
    keyframe(o) {
      const e = ent(o.target);
      if (o.property === 'pos' && doc.paths.some((p) => p.target === e.id)) throw new OpError('.property 该实体有路径，位置由路径驱动，不能再打位置关键帧（先 clear_path）');
      const tracks = doc.timeline.tracks;
      let tr = tracks.find((t) => t.target === e.id && t.property === o.property);
      if (!tr) { tr = { id: edit.newId(doc), target: e.id, property: o.property, keys: [] }; tracks.push(tr); }
      tr.keys = upsertKeys(tr.keys, { t: o.t, value: o.value, ease: o.ease ?? 'linear' });
    },
    timeline(o) {
      if (o.duration !== undefined) doc.timeline.duration = o.duration;
      if (o.fps !== undefined) doc.timeline.fps = o.fps;
      if (o.mainCamera !== undefined) doc.timeline.mainCameraId = o.mainCamera === null ? null : idOf(o.mainCamera);
    },
  };

  let applied = 0;
  ops.forEach((o, i) => {
    if (errors.length) return; // 第一处执行错误即停（后面的 op 可能依赖它）
    try { RUN[o.op](o); applied++; }
    catch (err) {
      const msg = err instanceof OpError ? err.message : ` 执行失败：${err?.message || err}`;
      errors.push(`ops[${i}]${msg}`);
    }
  });
  if (errors.length) return { doc, errors, renames, warnings, applied: 0 };

  // 收尾：生成 / 识图出来的场景没设主机位 → 第一个有运镜的机位（没有就第一个机位）
  const cams = doc.entities.filter((e) => e.type === 'camera');
  if (mode !== 'modify' && !doc.timeline.mainCameraId && cams.length) {
    const moving = cams.find((c) => doc.paths.some((p) => p.target === c.id) || doc.constraints.some((k) => k.target === c.id));
    doc.timeline.mainCameraId = (moving || cams[0]).id;
    warnings.push(`已将「${(moving || cams[0]).name}」设为主机位`);
  }
  const ends = [...doc.paths.map((p) => p.start + p.duration), ...doc.timeline.tracks.flatMap((t) => t.keys.map((k) => k.t))];
  const end = Math.max(0, ...ends);
  if (end > doc.timeline.duration + 1e-6) warnings.push(`动画结束于 ${r2(end)} s，超出时间轴时长 ${doc.timeline.duration} s`);
  return { doc, errors, renames, warnings, applied };
}

// ---- 应用 ----
/**
 * 校验 → 编译 → 文档校验 → 加载（一次撤销）。失败返回 { ok:false, errors }，场景不变。
 * @param {import('../app/App.js').App} app
 * @param {object[]} ops
 * @param {{mode?:'generate'|'modify'|'image', expectedRevision?:number, signal?:AbortSignal}} opts
 * @returns {Promise<{ok:boolean, applied:number, renames:Object<string,string>, warnings:string[], errors:string[]}>}
 */
export async function applyOps(app, ops, { mode = 'modify', expectedRevision = app.store.revision, signal } = {}) {
  checkRequestState(app.store, { expectedRevision, signal });
  const base = app.store.document;
  const v = validateOps(ops, sceneIndex(base), { mode });
  if (!v.ok) return { ok: false, applied: 0, renames: v.renames, warnings: [], errors: v.errors };
  const r = compileOps(base, ops, { mode, charSeq: app.charSeq });
  if (r.errors.length) return { ok: false, applied: 0, renames: r.renames, warnings: r.warnings, errors: r.errors };
  const check = validate(r.doc);
  if (!check.ok) return { ok: false, applied: 0, renames: r.renames, warnings: r.warnings, errors: check.errors.map((e) => `场景文档：${e}`) };
  try {
    await app.loadDocument(r.doc, { applyView: false, pruneShots: true, newScene: mode !== 'modify', expectedRevision, signal });
  } catch (err) {
    if (err?.name === 'AbortError' || err?.name === 'StaleRequestError') throw err;
    return { ok: false, applied: 0, renames: r.renames, warnings: r.warnings, errors: [`加载失败：${err?.message || err}`] };
  }
  app.history.capture(); // 一次 AI 应用 = 一步撤销
  if (ops.some(o => o.op === 'look_at' || o.op === 'follow')) {
    app.playback.seek(app.playback.time);
  }
  if (mode !== 'modify') {
    app.setCameraView(false);
    app.rig.frameAll(app.entities, { overview: true });
  }
  return { ok: true, applied: r.applied, renames: r.renames, warnings: r.warnings, errors: [] };
}

export { summarize } from './context.js';
