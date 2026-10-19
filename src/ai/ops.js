// AI 高层操作（ops，阶段 H）：模型只输出一列 ops，不直接写场景文档。
// 本文件 = ops 词汇（OP_SPECS，提示词里的写法也由它生成）+ 手写校验器 validateOps。
// 校验只看 ops 本身与当前场景的名字表：结构、枚举、名字引用、数值范围；任何一条错 → 整批拒绝。
// 几何上做不出来的（推过头、太近无法环绕等）由 apply.js 在临时文档上执行时报错。
//
// 约定：实体一律按名字引用；坐标是文档口径（米、Y 向上、角色 / 组 y = 0 即站在地面），yaw / 旋转为度。
import { VOCAB, DEFAULT_POSE } from './vocab.js';
import { TRACK_TARGETS, PATH_TARGETS, FOV_RANGE } from '../doc/schema.js';
import { MOVE_PARAMS, MOVE_DIRS } from '../anim/cameraMoves.js';
import { CROWD_LIMITS, CROWD_SPACING } from '../doc/edit.js';

/** 三种模式：生成新场景 / 修改当前场景 / 识图导入。 */
export const MODES = ['generate', 'modify', 'image'];
export const MODE_LABEL = { generate: '生成新场景', modify: '修改当前场景', image: '识图导入' };
/** 识图模式只允许这些操作（且姿势固定为站立）。 */
export const IMAGE_OPS = ['clear', 'scene', 'add_character', 'add_prop', 'add_camera', 'move'];

export const LIMITS = {
  pos: 50,        // 坐标各分量 |v| ≤ 50 m
  duration: 120,  // 时长 / 时刻 ≤ 120 s
  scale: 10,      // 缩放倍数 (0, 10]
  amount: 50,     // 运镜距离 / 停步距离
  name: 32,       // 名字长度
  ops: 200,       // 一批最多几条
};

export const TYPE_LABEL = { character: '角色', prop: '道具', camera: '机位', group: '组' };

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isName = (v) => typeof v === 'string' && v.trim() !== '';
const fmt = (v) => (v === undefined ? 'undefined' : JSON.stringify(v));
const HEX_RE = /^#[0-9a-f]{6}$/i;

// ---- 字段类型：{ doc（提示词里的写法）, check(v, path, err) } ----
const nameType = (doc) => ({
  doc,
  check(v, p, err) {
    if (!isName(v)) err(p, `应为非空字符串，实际为 ${fmt(v)}`);
    else if (v.length > LIMITS.name) err(p, `名字过长（最多 ${LIMITS.name} 字）：${fmt(v)}`);
  },
});

const numType = ({ doc = '数', min = -Infinity, max = Infinity, gt, int = false } = {}) => ({
  doc,
  check(v, p, err) {
    if (!isNum(v)) { err(p, `应为数，实际为 ${fmt(v)}`); return; }
    if (int && !Number.isInteger(v)) err(p, `应为整数，实际为 ${v}`);
    else if (gt != null && (!(v > gt) || v > max)) err(p,`应大于 ${gt}${max < Infinity ? ` 且不超过 ${max}` : ''}，实际为 ${v}`);
    else if (v < min || v > max) err(p, `超出范围 ${min}..${max}，实际为 ${v}`);
  },
});

const vec3Check = (v, p, err, { limit = LIMITS.pos, positive = false } = {}) => {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum)) { err(p, `应为 [x, y, z] 三个数，实际为 ${fmt(v)}`); return; }
  if (positive && v.some((x) => !(x > 0) || x > LIMITS.scale)) err(p, `各分量应在 (0, ${LIMITS.scale}] 内，实际为 ${fmt(v)}`);
  else if (v.some((x) => Math.abs(x) > limit)) err(p, `各分量绝对值应 ≤ ${limit}，实际为 ${fmt(v)}`);
};
const vec3Type = (opts) => ({ doc: '[x,y,z]', check: (v, p, err) => vec3Check(v, p, err, opts) });

const enumType = (list, what, label) => ({
  doc: `<${label}>`,
  check(v, p, err) {
    if (!list.includes(v)) err(p, `未知${what} ${fmt(v)}，可选 ${list.join(' / ')}`);
  },
});

const T = {
  name: nameType('"名字"'),
  ref: nameType('"实体名"'),
  pos: vec3Type(),
  yaw: numType({ doc: '度', min: -3600, max: 3600 }),
  time: numType({ doc: '秒', min: 0, max: LIMITS.duration }),
  duration: numType({ doc: '秒', gt: 0, max: LIMITS.duration }),
  amount: numType({ doc: '米', gt: 0, max: LIMITS.amount }),
  sweep: numType({ doc: '度', gt: 0, max: 360 }),
  fov: numType({ doc: '度', min: FOV_RANGE[0], max: FOV_RANGE[1] }),
  bool: { doc: 'true|false', check: (v, p, err) => { if (typeof v !== 'boolean') err(p, `应为 true 或 false，实际为 ${fmt(v)}`); } },
  color: { doc: '"#rrggbb"', check: (v, p, err) => { if (typeof v !== 'string' || !HEX_RE.test(v)) err(p, `应为 #rrggbb 颜色，实际为 ${fmt(v)}`); } },
  refOrPoint: {
    doc: '"实体名"|[x,y,z]',
    check(v, p, err) {
      if (Array.isArray(v)) vec3Check(v, p, err);
      else if (!isName(v)) err(p, `应为实体名或 [x, y, z]，实际为 ${fmt(v)}`);
    },
  },
  names: {
    doc: '["名字",…]',
    check(v, p, err) {
      if (!Array.isArray(v) || !v.length) { err(p, `应为非空的名字数组，实际为 ${fmt(v)}`); return; }
      v.forEach((x, i) => { if (!isName(x)) err(`${p}[${i}]`, `应为非空字符串，实际为 ${fmt(x)}`); });
    },
  },
  scale: {
    doc: '倍数|[x,y,z]',
    check(v, p, err) {
      if (Array.isArray(v)) vec3Check(v, p, err, { positive: true });
      else if (!isNum(v) || !(v > 0) || v > LIMITS.scale) err(p, `应为 (0, ${LIMITS.scale}] 的倍数或 [x, y, z]，实际为 ${fmt(v)}`);
    },
  },
  nullableCamera: {
    doc: '"机位名"|null',
    check(v, p, err) { if (v !== null && !isName(v)) err(p, `应为机位名或 null，实际为 ${fmt(v)}`); },
  },
  keyValue: {
    doc: '[x,y,z]|数（fov）',
    check(v, p, err) { if (!isNum(v) && !Array.isArray(v)) err(p, `应为 [x, y, z] 或数（fov），实际为 ${fmt(v)}`); },
  },
  dir: { doc: '<方向>', check: (v, p, err) => { if (typeof v !== 'string') err(p, `应为字符串，实际为 ${fmt(v)}`); } },
  crowdSize: numType({ doc: `${CROWD_LIMITS.size[0]}–${CROWD_LIMITS.size[1]}`, min: CROWD_LIMITS.size[0], max: CROWD_LIMITS.size[1], int: true }),
  spacing: numType({ doc: '米', min: CROWD_LIMITS.spacing[0], max: CROWD_LIMITS.spacing[1] }),
  fps: numType({ doc: '1–120', min: 1, max: 120, int: true }),
};

const req = (type) => ({ type, required: true });
const opt = (type) => ({ type, required: false });

/** 嵌套对象（严格：缺必填 / 多余键都报）。 */
function checkFields(v, p, fields, err) {
  if (!isObj(v)) { err(p, `应为对象，实际为 ${fmt(v)}`); return false; }
  for (const [k, f] of Object.entries(fields)) {
    if (v[k] === undefined) { if (f.required) err(`${p}.${k}`, '缺少字段'); }
    else f.type.check(v[k], `${p}.${k}`, err);
  }
  for (const k of Object.keys(v)) if (!(k in fields)) err(`${p}.${k}`, `是未知字段（可用：${Object.keys(fields).join(' / ') || '无'}）`);
  return true;
}

const fieldsDoc = (fields) => Object.entries(fields).map(([k, f]) => `${k}${f.required ? '' : '?'}:${f.type.doc}`).join(', ');

/** 路径的几种写法：键 = 路径 kind（与 VOCAB.pathKind 逐项相等，单测断言）。 */
export const PATH_FIELDS = {
  points: { points: req({ doc: '[[x,y,z],…]', check: (v, p, err) => {
    if (!Array.isArray(v) || !v.length) { err(p, `应为至少 1 个点的数组，实际为 ${fmt(v)}`); return; }
    v.forEach((q, i) => vec3Check(q, `${p}[${i}]`, err));
  } }),
  // 停顿：在 points 的哪几个点停一下再走（下标从 0、升序、不能是最后一个点；范围在 validateOps 里按 points 查）
  stops: opt({ doc: '[下标,…]', check: (v, p, err) => {
    if (!Array.isArray(v)) { err(p, `应为 points 下标数组，实际为 ${fmt(v)}`); return; }
    v.forEach((i, j) => {
      if (!Number.isInteger(i) || i < 0) err(`${p}[${j}]`, `应为非负整数下标，实际为 ${fmt(i)}`);
      else if (j > 0 && !(i > v[j - 1])) err(`${p}[${j}]`, `应大于前一项 ${v[j - 1]}，实际为 ${i}`);
    });
  } }) },
  line: { to: req(T.refOrPoint) },
  arc: { center: req(T.refOrPoint), sweep: opt(T.sweep), dir: opt(enumType(VOCAB.arcDir, '环绕方向', '环绕 dir')) },
  toward: { target: req(T.ref), stop: opt(T.amount) },
};
T.path = {
  doc: VOCAB.pathKind.map((k) => `{kind:'${k}', ${fieldsDoc(PATH_FIELDS[k])}}`).join(' | '),
  check(v, p, err) {
    if (!isObj(v)) { err(p, `应为对象，实际为 ${fmt(v)}`); return; }
    if (!VOCAB.pathKind.includes(v.kind)) { err(`${p}.kind`, `未知路径类型 ${fmt(v.kind)}，可选 ${VOCAB.pathKind.join(' / ')}`); return; }
    const { kind, ...rest } = v;
    checkFields(rest, p, PATH_FIELDS[kind], err);
  },
};

const E = {
  body: enumType(VOCAB.body, '体型', '体型 body'),
  pose: enumType(VOCAB.pose, '姿势', '姿势 pose'),
  prop: enumType(VOCAB.prop, '道具', '道具 kind'),
  move: enumType(VOCAB.move, '运镜', '运镜 preset'),
  speed: enumType(VOCAB.speed, '速度曲线', '路径速度 speed'),
  orient: enumType(VOCAB.orient, '朝向方式', '路径朝向 orient'),
  property: enumType(VOCAB.property, '关键帧属性', '关键帧属性 property'),
  ease: enumType(VOCAB.ease, '缓动', '缓动 ease'),
  ratio: enumType(VOCAB.ratio, '取景比例', '取景比例 ratio'),
  panorama: { doc: "'none'", check: (v, p, err) => { if (v !== 'none') err(p, `只能是 'none'（清除全景），实际为 ${fmt(v)}`); } },
};
const GROUND = {
  doc: '{visible?:true|false, height?:米}',
  check: (v, p, err) => checkFields(v, p, { visible: opt(T.bool), height: opt(numType({ min: -LIMITS.pos, max: LIMITS.pos })) }, err),
};

/** ops 词汇：字段 + 说明（提示词由它生成）。 */
export const OP_SPECS = {
  clear: { fields: {}, note: '清空场景（实体与动画；天空 / 地面 / 比例 / 全景保留）。只在生成新场景 / 识图模式，必须是第一条' },
  scene: { fields: { sky: opt(T.color), ground: opt(GROUND), ratio: opt(E.ratio), panorama: opt(E.panorama) }, note: "场景参数；panorama 只能是 'none'（清除全景）" },
  add_character: { fields: { name: req(T.name), body: req(E.body), pos: req(T.pos), yaw: opt(T.yaw), pose: opt(E.pose), color: opt(T.color) }, note: '加角色；pose 默认站立' },
  add_prop: { fields: { name: req(T.name), kind: req(E.prop), pos: req(T.pos), yaw: opt(T.yaw), scale: opt(T.scale), color: opt(T.color) }, note: '加道具' },
  add_camera: { fields: { name: req(T.name), pos: req(T.pos), lookAt: req(T.refOrPoint), fov: opt(T.fov) }, note: '加机位，对准 lookAt（实体注视点或坐标）；fov 默认 40' },
  add_group: { fields: { name: req(T.name), members: req(T.names) }, note: '把已存在的 ≥ 2 个独立角色打成一组（保留各自位置）' },
  add_crowd: { fields: { name: req(T.name), rows: req(T.crowdSize), cols: req(T.crowdSize), spacing: opt(T.spacing), pos: req(T.pos), yaw: opt(T.yaw), body: opt(E.body) }, note: `群众阵列（行 × 列网格，成员自动命名）；spacing 默认 ${CROWD_SPACING}` },
  remove: { fields: { target: req(T.ref) }, note: '删除实体（连同引用它的路径 / 约束 / 关键帧；删组连成员一起删）' },
  move: { fields: { target: req(T.ref), pos: opt(T.pos), yaw: opt(T.yaw), scale: opt(T.scale) }, note: '改手动位置 / 朝向 / 缩放（机位只能改 pos，并保持对准原注视点）' },
  set_pose: { fields: { target: req(T.ref), preset: req(E.pose) }, note: '换姿势（对组 = 全部成员）' },
  set_path: { fields: { target: req(T.ref), path: req(T.path), start: opt(T.time), duration: opt(T.duration), speed: opt(E.speed), orient: opt(E.orient) }, note: '沿路径移动（替换已有路径）；duration 默认按步速 1.3 m/s 估算；points 写法可加 stops = 在哪几个点停一下（各段时长按路程比例分）' },
  clear_path: { fields: { target: req(T.ref) }, note: '删除路径' },
  camera_move: { fields: { target: req(T.ref), preset: req(E.move), subject: opt(T.refOrPoint), amount: opt(T.amount), dir: opt(T.dir), sweep: opt(T.sweep), duration: opt(T.duration), append: opt(T.bool) }, note: '运镜：生成机位路径并注视主体（subject 默认最近的角色）；append=true 接在已有运镜之后，否则替换已有运镜' },
  clear_moves: { fields: { target: req(T.ref) }, note: '清除机位的运镜（路径 + 约束 + 旋转关键帧）' },
  look_at: { fields: { target: req(T.ref), subject: req(T.refOrPoint), start: opt(T.time), end: opt(T.time) }, note: '机位注视主体（start / end 省略 = 全程）' },
  follow: { fields: { target: req(T.ref), subject: req(T.ref), offset: opt(T.pos), start: opt(T.time), end: opt(T.time) }, note: '机位刚性跟随主体；offset 默认 = 当前相对位置' },
  keyframe: { fields: { target: req(T.ref), property: req(E.property), t: req(T.time), value: req(T.keyValue), ease: opt(E.ease) }, note: '打一个关键帧（同一时刻覆盖）' },
  timeline: { fields: { duration: opt(T.duration), fps: opt(T.fps), mainCamera: opt(T.nullableCamera) }, note: '时间轴时长 / 帧率 / 主机位（导出视频用主机位出画）' },
};
export const OP_NAMES = Object.keys(OP_SPECS);

/** ops 词汇文本（提示词 / README 共用）。 */
export function opsText() {
  return OP_NAMES.map((op) => {
    const f = fieldsDoc(OP_SPECS[op].fields);
    return `{ op:'${op}'${f ? ', ' + f : ''} }  // ${OP_SPECS[op].note}`;
  }).join('\n');
}

// ---- 场景名字表 ----
/**
 * 文档 → 名字表：[{ name, type, parent }]（type 为文档词汇 character / prop / camera / group；parent = 所属组的名字）。
 */
export function sceneIndex(doc) {
  const byId = new Map((doc?.entities || []).map((e) => [e.id, e]));
  return (doc?.entities || []).map((e) => ({ name: e.name, type: e.type, parent: e.parent ? byId.get(e.parent)?.name ?? null : null }));
}

/** 不重名：name 已被占用 → name2、name3 …（与 apply 共用，保证校验与执行改出同一个名字）。 */
export function uniqueName(name, taken) {
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) if (!taken.has(`${name}${n}`)) return `${name}${n}`;
}

// ---- 校验 ----
/**
 * 校验一批 ops。
 * @param {object[]} ops
 * @param {{name:string, type:string, parent:string|null}[]} scene 当前场景名字表（sceneIndex(doc)）
 * @param {{mode?:'generate'|'modify'|'image'}} opts generate 模式从空场景开始（clear 可省略）
 * @returns {{ok:boolean, errors:string[], renames:Object<string,string>}}
 *   errors 每条带定位，如 'ops[2].preset 未知运镜 "orbit"，可选 push_in / …'
 */
export function validateOps(ops, scene = [], { mode = 'modify' } = {}) {
  const errors = [];
  const err = (path, msg) => errors.push(`${path} ${msg}`);
  const renames = {};
  if (!MODES.includes(mode)) return { ok: false, errors: [`未知模式 ${fmt(mode)}，可选 ${MODES.join(' / ')}`], renames };
  if (!Array.isArray(ops)) return { ok: false, errors: [`ops 应为数组，实际为 ${fmt(ops)}`], renames };
  if (ops.length > LIMITS.ops) return { ok: false, errors: [`ops 过多（${ops.length} 条，最多 ${LIMITS.ops}）`], renames };

  // 名字表：name → { type, parent, dup }；removed：name → 在哪条被删
  const names = new Map();
  const removed = new Map();
  const load = (list) => {
    names.clear();
    for (const e of list) {
      if (names.has(e.name)) names.get(e.name).dup = true;
      else names.set(e.name, { type: e.type, parent: e.parent || null });
    }
  };
  load(mode === 'generate' ? [] : scene);

  const known = () => {
    const list = [...names.keys()];
    return list.length ? `（现有：${list.slice(0, 12).join(' / ')}${list.length > 12 ? ' …' : ''}）` : '（场景里还没有实体）';
  };
  /** 名字引用：存在、唯一、类型对、（可选）不是组成员。返回条目或 null。 */
  const need = (p, name, types = null, { member = true, not = null } = {}) => {
    if (!isName(name)) return null; // 结构错误已报
    if (not != null && name === not) { err(p, `不能是自己 ${fmt(name)}`); return null; }
    const hit = names.get(name);
    if (!hit) {
      err(p, removed.has(name) ? `引用的实体已在 ${removed.get(name)} 删除：${fmt(name)}` : `引用的实体不存在：${fmt(name)}${known()}`);
      return null;
    }
    if (hit.dup) { err(p, `场景里有多个叫 ${fmt(name)} 的实体，无法确定是哪一个（请先改名）`); return null; }
    if (types && !types.includes(hit.type)) { err(p, `应为${types.map((t) => TYPE_LABEL[t]).join(' / ')}，${fmt(name)} 是${TYPE_LABEL[hit.type]}`); return null; }
    if (!member && hit.parent) { err(p, `${fmt(name)} 是组 ${fmt(hit.parent)} 的成员，不能单独操作（请对组操作）`); return null; }
    return hit;
  };
  const refOrPoint = (p, v, opts) => { if (typeof v === 'string') need(p, v, null, opts); };
  const addName = (p, name, info) => {
    if (!isName(name)) return;
    const final = uniqueName(name, names);
    if (final !== name) renames[name] = final;
    names.set(final, info);
    removed.delete(final);
    return final;
  };
  const span = (p, o) => { if (isNum(o.start) && isNum(o.end) && !(o.end > o.start)) err(`${p}.end`, `应大于 start ${o.start}，实际为 ${o.end}`); };

  ops.forEach((o, i) => {
    const p = `ops[${i}]`;
    if (!isObj(o)) { err(p, `应为对象，实际为 ${fmt(o)}`); return; }
    if (o.op === undefined) { err(`${p}.op`, '缺少字段'); return; }
    const spec = OP_SPECS[o.op];
    if (!spec) { err(`${p}.op`, `未知操作 ${fmt(o.op)}，可选 ${OP_NAMES.join(' / ')}`); return; }
    if (mode === 'image' && !IMAGE_OPS.includes(o.op)) { err(`${p}.op`, `识图模式不允许 ${fmt(o.op)}（只允许 ${IMAGE_OPS.join(' / ')}）`); return; }
    const { op, ...rest } = o;
    const before = errors.length;
    checkFields(rest, p, spec.fields, err);
    const shapeOk = errors.length === before; // 结构错了就不做语义检查（避免连带报错），但名字照常登记

    switch (op) {
      case 'clear':
        if (mode === 'modify') err(`${p}.op`, '修改模式不允许 clear（要重建整个场景请用「生成新场景」）');
        else if (i !== 0) err(`${p}.op`, 'clear 必须是第一条');
        load([]);
        removed.clear();
        break;
      case 'add_character':
        if (mode === 'image' && o.pose !== undefined && o.pose !== DEFAULT_POSE) err(`${p}.pose`, `识图模式姿势固定为 ${DEFAULT_POSE}，实际为 ${fmt(o.pose)}`);
        addName(p, o.name, { type: 'character', parent: null });
        break;
      case 'add_prop':
        addName(p, o.name, { type: 'prop', parent: null });
        break;
      case 'add_camera':
        if (shapeOk) refOrPoint(`${p}.lookAt`, o.lookAt);
        addName(p, o.name, { type: 'camera', parent: null });
        break;
      case 'add_group': {
        const members = Array.isArray(o.members) ? o.members.filter(isName) : [];
        if (shapeOk) {
          if (new Set(members).size !== members.length) err(`${p}.members`, `有重复的名字：${fmt(o.members)}`);
          else if (members.length < 2) err(`${p}.members`, `至少要 2 个角色，实际为 ${members.length} 个`);
          else members.forEach((m, k) => need(`${p}.members[${k}]`, m, ['character'], { member: false }));
        }
        const gname = addName(p, o.name, { type: 'group', parent: null });
        for (const m of members) { const h = names.get(m); if (h && h.type === 'character' && !h.parent) h.parent = gname; }
        break;
      }
      case 'add_crowd':
        addName(p, o.name, { type: 'group', parent: null }); // 成员名字由场景计数器起，同一批里不能引用
        break;
      case 'remove': {
        const hit = need(`${p}.target`, o.target);
        if (!hit) break;
        const drop = (n) => { names.delete(n); removed.set(n, p); };
        if (hit.type === 'group') for (const [n, h] of [...names]) if (h.parent === o.target) drop(n);
        drop(o.target);
        if (hit.parent && ![...names.values()].some((h) => h.parent === hit.parent)) drop(hit.parent); // 组被删空 → 连组一起删
        break;
      }
      case 'move': {
        if (!shapeOk) break;
        if (o.pos === undefined && o.yaw === undefined && o.scale === undefined) { err(p, 'move 至少要给 pos / yaw / scale 之一'); break; }
        const hit = need(`${p}.target`, o.target, null, { member: false });
        if (hit?.type === 'camera') {
          if (o.yaw !== undefined) err(`${p}.yaw`, '机位不能用 yaw 转向（改朝向请用 look_at，或删掉重新 add_camera）');
          if (o.scale !== undefined) err(`${p}.scale`, '机位不能缩放');
        }
        break;
      }
      case 'set_pose':
        if (shapeOk) need(`${p}.target`, o.target, ['character', 'group']);
        break;
      case 'set_path': {
        if (!shapeOk) break;
        need(`${p}.target`, o.target, PATH_TARGETS, { member: false });
        const pa = o.path;
        if (pa.kind === 'line') refOrPoint(`${p}.path.to`, pa.to, { not: o.target });
        if (pa.kind === 'arc') refOrPoint(`${p}.path.center`, pa.center, { not: o.target });
        if (pa.kind === 'toward') need(`${p}.path.target`, pa.target, null, { not: o.target });
        if (pa.kind === 'points' && Array.isArray(pa.stops) && Array.isArray(pa.points)) {
          pa.stops.forEach((i, j) => { if (Number.isInteger(i) && i > pa.points.length - 2) err(`${p}.path.stops[${j}]`, `应在 0–${pa.points.length - 2} 之间（最后一个点是终点，不用停顿），实际为 ${i}`); });
        }
        break;
      }
      case 'clear_path':
        if (shapeOk) need(`${p}.target`, o.target, PATH_TARGETS, { member: false });
        break;
      case 'camera_move': {
        if (!shapeOk) break;
        need(`${p}.target`, o.target, ['camera']);
        if (o.subject !== undefined) refOrPoint(`${p}.subject`, o.subject, { not: o.target });
        const params = MOVE_PARAMS[o.preset];
        for (const k of ['amount', 'dir', 'sweep']) {
          if (o[k] !== undefined && !params.includes(k)) err(`${p}.${k}`, `运镜 ${o.preset} 没有参数 ${k}（可用：${params.join(' / ') || '无'}）`);
        }
        const dirs = (MOVE_DIRS[o.preset] || []).map(([k]) => k);
        if (o.dir !== undefined && params.includes('dir') && !dirs.includes(o.dir)) err(`${p}.dir`, `未知方向 ${fmt(o.dir)}，${o.preset} 可选 ${dirs.join(' / ')}`);
        break;
      }
      case 'clear_moves':
        if (shapeOk) need(`${p}.target`, o.target, ['camera']);
        break;
      case 'look_at':
        if (!shapeOk) break;
        need(`${p}.target`, o.target, ['camera']);
        refOrPoint(`${p}.subject`, o.subject, { not: o.target });
        span(p, o);
        break;
      case 'follow':
        if (!shapeOk) break;
        need(`${p}.target`, o.target, ['camera']);
        need(`${p}.subject`, o.subject, null, { not: o.target });
        span(p, o);
        break;
      case 'keyframe': {
        if (!shapeOk) break;
        need(`${p}.target`, o.target, TRACK_TARGETS[o.property], { member: false });
        const vp = `${p}.value`;
        if (o.property === 'fov') T.fov.check(o.value, vp, err);
        else vec3Check(o.value, vp, err, o.property === 'scale' ? { positive: true } : o.property === 'rot' ? { limit: 3600 } : {});
        break;
      }
      case 'timeline':
        if (shapeOk && typeof o.mainCamera === 'string') need(`${p}.mainCamera`, o.mainCamera, ['camera']);
        break;
      default: break; // scene：只有结构检查
    }
  });
  return { ok: errors.length === 0, errors, renames };
}
