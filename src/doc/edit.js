// 作用于场景文档的纯函数：新建角色 / 群众 / 打组 / 路径 / 运镜的"数据部分"。
// 界面入口（App / PathTool / CameraMoveTool）与 AI（src/ai/apply.js）调用同一份函数：
// 界面先在 exportDocument() 的拷贝上算出结果，再按结果建场景对象（Character.fromJSON 等）或整体提交动画字段；
// AI 在临时文档上连续调用，最后整份 loadDocument。
//
// 约定：函数直接修改传入的 doc（调用方传拷贝），返回新建 / 改动的条目；坐标一律文档口径。
// 不依赖 DOM / App / 场景对象，node 里可直接单测。
import * as THREE from 'three';
import { genId, hexColor } from '../entities/Entity.js';
import { BODY_TYPES, CROWD_PALETTE, CHARACTER_COLOR, CHARACTER_COLORS, CHARACTER_PALETTE } from '../config.js';
import { POSE_PRESET_MAP } from '../entities/posePresets.js';
import { paceFor, defaultDuration, fitStops, fitPathToDuration } from '../anim/pathGen.js';
import { rampFor } from '../anim/Path.js';
import { cameraMove, appendMove, lookAtWindows, pathEnd, MoveError } from '../anim/cameraMoves.js';
import { round6, clone, round4 } from '../util/math.js';
import { upsertKeys } from '../anim/keyframes.js';

/** 群众阵列行列数 / 间距的范围与默认间距（界面与 AI 校验共用）。 */
export const CROWD_LIMITS = { size: [1, 6], spacing: [0.5, 5] };
export const CROWD_SPACING = 1.2;
/** 新路径默认速度曲线；朝向：机位保持手动朝向，其余跟随切线。 */
export const PATH_DEFAULTS = {
  speed: (type) => (['character', 'group'].includes(type) ? 'linear' : 'smooth'),
  orient: (type) => (type === 'camera' ? 'keep' : 'tangent'),
};

// ---- 基础 ----
/** 文档里已用的 id（实体 / 轨道 / 路径 / 约束同一命名空间）。 */
export function usedIds(doc) {
  const ids = new Set();
  for (const e of doc.entities || []) ids.add(e.id);
  for (const x of [...(doc.timeline?.tracks || []), ...(doc.paths || []), ...(doc.constraints || [])]) ids.add(x.id);
  return ids;
}

/** 文档内不重复的新 id。 */
export function newId(doc) {
  const used = usedIds(doc);
  let id;
  do id = genId(); while (used.has(id));
  return id;
}

export const findEntity = (doc, id) => doc.entities.find((e) => e.id === id) || null;

/** 第 n 个新实体的默认落点（螺旋排开，避免叠在一起）。 */
export function spawnPoint(n) {
  const a = n * 0.95;
  const r = Math.min(0.9 + n * 0.4, 3.2);
  return [Math.cos(a) * r, 0, Math.sin(a) * r];
}

/** 第 n 个自动角色名：角色A…角色Z，之后 角色A2…角色Z2，依此类推（不会溢出成标点符号）。 */
export function charName(n) {
  const round = Math.floor(n / 26);
  return '角色' + String.fromCharCode(65 + (n % 26)) + (round ? round + 1 : '');
}

/** charName 的反解：「角色A2」→ 26；不是自动角色名返回 -1。 */
export function parseCharName(name) {
  const m = /^角色([A-Z])(\d*)$/.exec(name);
  return m ? ((m[2] ? +m[2] : 1) - 1) * 26 + (m[1].charCodeAt(0) - 65) : -1;
}

/** 顶层实体个数（群众成员不算），= 界面里的实体列表长度。 */
export const topLevelCount = (doc) => doc.entities.filter((e) => !(e.type === 'character' && e.parent)).length;

// ---- 角色 ----
/**
 * 姿势预设 → 文档 pose（values 只存非 0，与 Character.applyPosePreset + toJSON 结果相同）。
 * preset = null → 自然站立且不标记预设（界面新建角色的初始状态）。
 */
export function posePreset(body, preset) {
  if (preset == null) return { preset: null, values: {} };
  const p = POSE_PRESET_MAP[preset];
  if (!p) throw new Error(`未知姿势预设：${preset}`);
  const src = p.special === 'tpose'
    ? Object.fromEntries(Object.entries(BODY_TYPES[body]?.profile.neutralOffset || {}).map(([k, v]) => [k, -v]))
    : p.values || {};
  const values = {};
  for (const [k, v] of Object.entries(src)) if (round6(v)) values[k] = round6(v);
  return { preset, values };
}

/**
 * 新角色条目（不入文档）。
 * @param {{id:string, name:string, body:string, pos?:number[], rot?:number[], scale?:number[], color?:string, pose?:string|null, parent?:string|null}} o
 */
export function characterJSON({ id, name, body, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], color = hexColor(CHARACTER_COLORS[body] ?? CHARACTER_COLOR), pose = null, parent = null }) {
  if (!BODY_TYPES[body]) throw new Error(`未知体型：${body}`);
  return {
    type: 'character', id, name, body, color, visible: true,
    transform: { pos: pos.map(round6), rot: rot.map(round6), scale: scale.map(round6) },
    pose: posePreset(body, pose), parent,
  };
}

export function nextTrailColor(doc) {
  const palette = ['#4dd9ed', '#ff897d', '#f4c85c', '#83d69a', '#76a9ff', '#f49ec4'];
  const used = new Set(doc.entities.filter(e => e.type === 'character').map(e => e.trailColor).filter(Boolean));
  return palette.find(c => !used.has(c)) || (() => {
    let i = 0, c;
    do { c = `#${new THREE.Color().setHSL(((i++ * 0.61803398875) + 0.12) % 1, 0.72, 0.66).getHexString()}`; } while (used.has(c));
    return c;
  })();
}

/** 新建角色并加入文档（默认落点 = spawnPoint）。返回条目。 */
export function addCharacter(doc, { name, body, pos, yaw = 0, color, pose = null }) {
  const characterCount = doc.entities.filter(e => e.type === 'character').length;
  const defaultColor = CHARACTER_COLORS[body] ?? CHARACTER_PALETTE[characterCount % CHARACTER_PALETTE.length];
  const json = characterJSON({
    id: newId(doc), name, body, pos: pos || spawnPoint(topLevelCount(doc)),
    rot: [0, yaw, 0], color: color ?? hexColor(defaultColor), pose,
  });
  json.trailColor = nextTrailColor(doc);
  doc.entities.push(json);
  return json;
}

// ---- 群众 ----
/**
 * 新建群众阵列：行 × 列网格的角色挂在一个组轴心下（成员 transform 相对轴心，按行优先排列、轮换配色）。
 * 行列数 / 间距按 CROWD_LIMITS 夹取。
 * @param {{rows:number, cols:number, spacing?:number, name?:string, pos?:number[], yaw?:number, body?:string, memberName:()=>string}} o
 *   memberName：成员起名（界面用角色计数器）
 * @returns {{group:object, members:object[], rows:number, cols:number}}
 */
export function addCrowd(doc, { rows = 3, cols = 3, spacing = CROWD_SPACING, name, pos, yaw = 0, body = 'male', memberName }) {
  const [lo, hi] = CROWD_LIMITS.size;
  rows = Math.max(lo, Math.min(hi, Math.round(rows)));
  cols = Math.max(lo, Math.min(hi, Math.round(cols)));
  spacing = Math.max(CROWD_LIMITS.spacing[0], Math.min(CROWD_LIMITS.spacing[1], spacing));
  const gid = newId(doc);
  const group = {
    type: 'group', id: gid, name: name ?? `群众 (${rows}x${cols})`, visible: true,
    transform: { pos: (pos || spawnPoint(topLevelCount(doc))).map(round6), rot: [0, round6(yaw), 0], scale: [1, 1, 1] },
    members: [],
  };
  doc.entities.push(group);
  const members = [];
  const w = (cols - 1) * spacing, d = (rows - 1) * spacing;
  for (let r = 0, i = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++, i++) {
      const m = characterJSON({
        id: newId(doc), name: memberName(), body, parent: gid,
        pos: [c * spacing - w / 2, 0, r * spacing - d / 2], color: hexColor(CROWD_PALETTE[i % CROWD_PALETTE.length]),
      });
      m.trailColor = nextTrailColor(doc);
      doc.entities.push(m);
      group.members.push(m.id);
      members.push(m);
    }
  }
  return { group, members, rows, cols };
}

// ---- 打组 ----
/**
 * 去掉这些实体的变换动画（pos / rot / scale 轨道与路径）：坐标系变了（打组 / 解组），旧数据按旧坐标系记录。
 * 约束只引用实体位置，不受影响。返回新的 { tracks, paths }。
 */
export function dropTransformAnim({ tracks, paths }, ids) {
  const set = new Set(ids);
  return {
    tracks: tracks.filter((t) => !(set.has(t.target) && t.property !== 'fov')),
    paths: paths.filter((p) => !set.has(p.target)),
  };
}

/**
 * 旋转经四元数换回 XYZ 欧拉（度）：朝向不变，表示可能变（如 yaw 150° → (−180, 30, −180)）。
 * 与界面打组以往的 Object3D.attach 结果一致（attach 会把局部矩阵分解成四元数再转欧拉）。
 */
function canonicalRot(rot) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot.map((d) => d * Math.PI / 180)));
  const e = new THREE.Euler().setFromQuaternion(q);
  return [e.x, e.y, e.z].map((r) => round6(r * 180 / Math.PI));
}

/**
 * 把若干独立角色打成一组，保留各自位姿：组轴心 = pivot（默认成员位置的平均），旋转 0、缩放 1；
 * 成员 transform 改为相对轴心（旋转按 canonicalRot 规整），条目移到组后面（顺序 = ids 顺序），并删掉成员的变换动画。
 * 不足 2 个独立角色时返回 null、文档不变。
 * @param {{name:string, pivot?:number[]}} o
 * @returns {{group:object, members:object[]}|null}
 */
export function groupCharacters(doc, ids, { name, pivot }) {
  const byId = new Map(doc.entities.map((e) => [e.id, e]));
  const members = [...new Set(ids || [])].map((id) => byId.get(id)).filter((e) => e && e.type === 'character' && !e.parent);
  if (members.length < 2) return null;
  const center = pivot || [0, 1, 2].map((k) => members.reduce((s, m) => s + m.transform.pos[k], 0) / members.length);
  const gid = newId(doc);
  const group = {
    type: 'group', id: gid, name, visible: true,
    transform: { pos: center.map(round6), rot: [0, 0, 0], scale: [1, 1, 1] }, members: members.map((m) => m.id),
  };
  for (const m of members) {
    m.parent = gid;
    m.transform = { ...m.transform, pos: m.transform.pos.map((v, k) => round6(v - group.transform.pos[k])), rot: canonicalRot(m.transform.rot) };
  }
  doc.entities = [...doc.entities.filter((e) => !members.includes(e)), group, ...members];
  const anim = dropTransformAnim({ tracks: doc.timeline.tracks, paths: doc.paths }, group.members);
  doc.timeline.tracks = anim.tracks;
  doc.paths = anim.paths;
  return { group, members };
}

// ---- 删除 ----
/** 去掉引用这些实体的轨道 / 路径 / 约束（target 或 subject）。返回新的 { tracks, paths, constraints }。 */
export function pruneAnim({ tracks, paths, constraints }, ids) {
  const dead = new Set(ids);
  return {
    tracks: tracks.filter((t) => !dead.has(t.target)),
    paths: paths.filter((p) => !dead.has(p.target)),
    constraints: constraints.filter((c) => !dead.has(c.target) && !(typeof c.subject === 'string' && dead.has(c.subject))),
  };
}

/**
 * 删除实体（与界面删除同规则）：组连成员一起删；删成员后组空了连组一起删；
 * 引用它们的轨道 / 路径 / 约束、主机位、当前机位一并清掉。返回删掉的 id 列表。
 */
export function removeEntity(doc, id) {
  const e = findEntity(doc, id);
  if (!e) return [];
  const dead = [id, ...(e.type === 'group' ? e.members : [])];
  doc.entities = doc.entities.filter((x) => !dead.includes(x.id));
  const parent = e.parent ? findEntity(doc, e.parent) : null;
  if (parent) {
    parent.members = parent.members.filter((m) => m !== id);
    if (!parent.members.length) dead.push(...removeEntity(doc, parent.id));
  }
  const anim = pruneAnim({ tracks: doc.timeline.tracks, paths: doc.paths, constraints: doc.constraints }, dead);
  doc.timeline.tracks = anim.tracks;
  doc.paths = anim.paths;
  doc.constraints = anim.constraints;
  if (doc.meta.cameraMoves) for (const deadId of dead) delete doc.meta.cameraMoves[deadId];
  if (dead.includes(doc.timeline.mainCameraId)) doc.timeline.mainCameraId = null;
  if (dead.includes(doc.scene.activeCameraId)) doc.scene.activeCameraId = null;
  return dead;
}

// ---- 路径 ----
/** 路径起点：实体手动位置投到绘制平面（机位保留自身高度，其余落到地面高度 groundY）。 */
export function pathStartPoint(type, pos, groundY) {
  return [pos[0], type === 'camera' ? pos[1] : groundY, pos[2]];
}

/**
 * 写入实体的路径（一条）。已有路径 → 替换 points / closed，人物保留时长、其余按新长度重算，保留 start / speed / orient；
 * 否则删掉该实体的 pos 轨道并新建：角色 / 组默认匀速，其余缓入缓出；orient = tangent（机位 keep）。
 * opts.set 里给出的字段两种情况都覆盖，但角色 / 组始终使用匀速。
 * @returns {{path:object, replaced:boolean}}
 */
export function setPath(doc, target, points, { closed = false, start = 0, set = {} } = {}) {
  const ent = findEntity(doc, target);
  if (!ent) throw new Error(`实体不存在：${target}`);
  const old = doc.paths.find((p) => p.target === target);
  const uniform = ['character', 'group'].includes(ent.type);
  const speed = uniform ? 'linear' : set.speed ?? old?.speed ?? PATH_DEFAULTS.speed(ent.type);
  // 显式时长优先；角色 / 组重画时沿用旧时长，其余情况按步速估算。
  let duration = set.duration ?? (uniform ? old?.duration : undefined);
  if (duration == null) {
    duration = defaultDuration(points, {
      speed: paceFor(ent.type), closed, interpolation: set.interpolation,
      ramp: speed === 'smooth' ? rampFor(ent.type) : 0,
    });
  }
  let path;
  if (old) { // 重新绘制：旧停顿作废（set.stops 给出时用新的）
    path = fitStops(null, { ...old, interpolation: undefined, points: clone(points), closed, duration, stops: undefined, stopTimes: undefined, ...clone(set), speed });
    if (!set.timedSegments) delete path.timedSegments;
    if (!set.waypointTimes) delete path.waypointTimes;
    doc.paths = doc.paths.map((p) => (p === old ? path : p));
  } else {
    doc.timeline.tracks = doc.timeline.tracks.filter((t) => !(t.target === target && t.property === 'pos'));
    path = fitStops(null, {
      id: newId(doc), target, points: clone(points), closed, start, duration,
      orient: PATH_DEFAULTS.orient(ent.type), ...clone(set), speed,
    });
    doc.paths = [...doc.paths, path];
  }
  path = fitPathToDuration(path, doc.timeline.duration);
  doc.paths = doc.paths.map((p) => p.id === path.id ? path : p);
  return { path, replaced: !!old };
}

/** 删除实体的路径（没有则什么都不做）。返回是否删了。 */
export function removePath(doc, target) {
  const n = doc.paths.length;
  doc.paths = doc.paths.filter((p) => p.target !== target);
  return doc.paths.length !== n;
}

// ---- 运镜 ----
/** 机位的动画条目（只读引用），供文档编辑与运镜界面共用。 */
export const cameraAnimation = (doc, camId) => ({
  constraints: doc.constraints.filter((c) => c.target === camId),
  path: doc.paths.find((p) => p.target === camId) || null,
  lookAts: doc.constraints.filter((c) => c.target === camId && c.type === 'lookAt'),
  rotTrack: doc.timeline.tracks.find((t) => t.target === camId && t.property === 'rot') || null,
  posTrack: doc.timeline.tracks.find((t) => t.target === camId && t.property === 'pos') || null,
});

/**
 * 下一段运镜从哪里开始：已有路径 → 路径终点 + 结束时刻；上一段是摇镜头（lastPan）→ 它结束的时刻与摇到的朝向；
 * 否则 = 机位手动值 + time。
 * @param {{time?:number, lastPan?:{start:number, duration:number, rotEnd:number[]}|null}} o
 */
export function moveContext(doc, camId, { time = 0, lastPan = null } = {}) {
  const cam = findEntity(doc, camId);
  const { pos, rot } = cam.transform;
  const roll = cam.roll;
  const { path } = cameraAnimation(doc, camId);
  if (path) return { position: pathEnd(path), rot, roll, time: round4(path.start + path.duration), append: true, path };
  if (lastPan) return { position: pos, rot: lastPan.rotEnd, roll, time: round4(lastPan.start + lastPan.duration), append: true, path: null };
  return { position: pos, rot, roll, time, append: false, path: null };
}

/** 机位前方 dist 米的点（主体缺省时用）：−Z 经机位朝向（XYZ 欧拉，度）旋转。 */
export function aheadPoint(transform, dist = 3) {
  const e = new THREE.Euler(...transform.rot.map((d) => d * Math.PI / 180));
  const dir = new THREE.Vector3(0, 0, -1).applyEuler(e);
  return new THREE.Vector3(...transform.pos).addScaledVector(dir, dist).toArray().map(round4);
}

/**
 * 默认主体：离 position 最近的角色（含群众成员），没有角色取最近的其他实体；什么都没有返回 null。
 * aimOf(id) → 注视点 [x,y,z]（界面用场景实测值，AI 用文档推算值）。
 */
export function nearestSubject(doc, camId, position, aimOf) {
  const all = doc.entities.filter((e) => e.id !== camId);
  const chars = all.filter((e) => e.type === 'character');
  let best = null, bd = Infinity;
  for (const e of chars.length ? chars : all) {
    const p = aimOf(e.id);
    const d = p ? Math.hypot(p[0] - position[0], p[1] - position[1], p[2] - position[2]) : Infinity;
    if (d < bd) { bd = d; best = e.id; }
  }
  return best;
}

/**
 * 写入一段运镜：生成器结果写成 path（追加 = 接在已有路径后）+ lookAt 约束（+ pan 的 rot 轨道两键）。
 * @param {{name:string, subject:string|number[], aim:number[], params?:object, time?:number, lastPan?:object|null, ownPan?:boolean}} o
 *   aim = 主体注视点；time = 无路径时的开始时刻；lastPan / ownPan = 会话里上一段摇镜头 / 已有 rot 轨道是否由运镜产生
 * @returns {{ctx:object, move:object, start:number, undo:object}} undo = 删末段用的逆操作信息
 * @throws {MoveError} 几何上做不出来（文案直接给用户看）
 */
export function applyCameraMove(doc, camId, { name, subject, aim, params = {}, time = 0, lastPan = null, ownPan = false, mode = 'append', origin = null, preserveConstraints = false, preservePositionKeys = false }) {
  const cam = findEntity(doc, camId);
  const ctx = mode === 'replace'
    ? { ...(origin || { position: cam.transform.pos, rot: cam.transform.rot, roll: cam.roll, time }), append: false, path: null }
    : { ...moveContext(doc, camId, { time, lastPan }), ...(origin || {}) };
  if (name === 'pan' && ctx.path) throw new MoveError('摇镜头请单独使用或放在最前');
  const move = cameraMove(name, { position: ctx.position, rot: ctx.rot, roll: ctx.roll, aim, params });
  // Validate geometry first; failed generation cannot partially clear existing motion.
  if (mode === 'replace') {
    doc.paths = doc.paths.filter(p => p.target !== camId);
    doc.timeline.tracks = doc.timeline.tracks.filter(t => t.target !== camId || (t.property !== 'pos' && !(t.property === 'rot' && (name === 'pan' || ownPan))));
    if (!preserveConstraints) doc.constraints = doc.constraints.filter(c => c.target !== camId);
  }
  const before = cameraAnimation(doc, camId);
  const start = ctx.time;
  const undo = {};
  const tl = doc.timeline;

  // 1 路径 / 摇镜头的 rot 键
  if (move.points) {
    if (before.path) {
      const bp = before.path;
      undo.path = { ...clone(bp), stops: bp.stops || [], stopTimes: bp.stopTimes, timedSegments: bp.timedSegments, waypointTimes: bp.waypointTimes };
      const next = { ...before.path, ...appendMove(before.path, move) };
      doc.paths = doc.paths.map((p) => (p === before.path ? next : p));
    } else {
      if (before.posTrack && !preservePositionKeys) tl.tracks = tl.tracks.filter((t) => t !== before.posTrack);
      doc.paths = [...doc.paths, { id: newId(doc), target: camId, points: move.points, closed: move.closed, start, duration: move.duration, speed: 'smooth', orient: 'keep' }];
      undo.path = null;
    }
  } else {
    let track = before.rotTrack;
    if (track && !ownPan) { tl.tracks = tl.tracks.filter((t) => t !== track); track = null; }
    if (!track) {
      track = { id: newId(doc), target: camId, property: 'rot', keys: [] };
      tl.tracks = [...tl.tracks, track];
      undo.track = track.id;
    }
    const end = round4(start + move.duration);
    const keys = upsertKeys(track.keys,
      { t: start, value: move.rotKeys[0], ease: 'smooth' },
      { t: end, value: move.rotKeys[1], ease: 'smooth' });
    const next = { ...track, keys };
    tl.tracks = tl.tracks.map((t) => (t === track ? next : t));
    undo.keys = { track: track.id, times: [start, end] };
    undo.rotEnd = move.rotKeys[1];
  }

  // 2 注视窗口：带路径的段从 start 开始注视，摇镜头摇完（start + duration）才开始
  // 保留用户已有的注视区间和旋转轨道；默认位移预设仍需真正写入注视，
  // 否则 subject 只参与路径几何计算，播放时镜头会始终保持原朝向。
  if (preserveConstraints && (before.lookAts.length || before.rotTrack?.keys.length || !move.points)) return { ctx, move, start, undo };
  const lookStart = move.points ? start : round4(start + move.duration);
  const w = lookAtWindows(before.lookAts, { subject, cut: start, start: lookStart });
  undo.removed = before.lookAts.filter((c) => w.remove.includes(c.id));
  undo.patched = w.patch.map((p) => ({ id: p.id, end: before.lookAts.find((c) => c.id === p.id).end }));
  doc.constraints = doc.constraints.filter((c) => !w.remove.includes(c.id));
  for (const p of w.patch) doc.constraints = doc.constraints.map((c) => (c.id === p.id ? { ...c, end: p.end } : c));
  if (w.add) {
    const c = { id: newId(doc), type: 'lookAt', target: camId, subject: clone(w.add.subject), offset: [0, 0, 0], start: w.add.start, end: w.add.end };
    doc.constraints = [...doc.constraints, c];
    undo.added = c.id;
  }
  return { ctx, move, start, undo };
}

/** Remove only a verified generated tail before editing its parameters in the same transaction. */
export function removeCameraMoveTail(doc, camId, segment) {
  const { path, rotTrack } = cameraAnimation(doc, camId);
  const start = segment.origin.time;
  if (segment.name === 'pan') {
    rotTrack.keys = rotTrack.keys.filter(k => k.t <= start);
    return;
  }
  if (start === path.start) { doc.paths = doc.paths.filter(p => p !== path); return; }
  const generated = cameraMove(segment.name, { ...segment.origin, aim: segment.aim, params: segment.params });
  const count = generated.points.length + (generated.closed ? 1 : 0) - 1;
  const endIndex = path.points.length - count - 1;
  path.points = path.points.slice(0, endIndex + 1);
  path.duration = round4(start - path.start);
  if (path.timedSegments) path.timedSegments = path.timedSegments.slice(0, -1);
  if (path.waypointTimes) path.waypointTimes = path.waypointTimes.slice(0, endIndex + 1);
  if (path.stops) path.stops = path.stops.filter(i => i < endIndex);
  if (path.stopTimes) path.stopTimes = path.stopTimes.slice(0, path.stops.length);
}

/** 清除机位的运镜：路径 + 该机位全部约束 + rot 轨道。返回是否有改动。 */
export function clearCameraMoves(doc, camId, { preserveConstraints = false } = {}) {
  const { path, rotTrack, posTrack } = cameraAnimation(doc, camId);
  if (doc.meta.cameraMoves) delete doc.meta.cameraMoves[camId];
  if (posTrack) doc.timeline.tracks = doc.timeline.tracks.filter(t => t !== posTrack);
  const n = doc.constraints.length;
  if (path) doc.paths = doc.paths.filter((p) => p !== path);
  if (!preserveConstraints) doc.constraints = doc.constraints.filter((c) => c.target !== camId);
  if (rotTrack) doc.timeline.tracks = doc.timeline.tracks.filter((t) => t !== rotTrack);
  return !!(path || rotTrack || posTrack || n !== doc.constraints.length);
}
