// @ts-check
// 场景文档 schema：版本号 / 默认值 / 声明式结构与跨引用校验（不引 ajv）。
// 文档是"源"，场景对象是它的渲染结果；界面上能看到的每个场景状态在这里都有字段。
// 词汇表面向 AI 与外部工具，用通用词（如 group），不跟代码类名走。
//
// 文档形状见 src/types/contracts.d.ts。
import { BODY_TYPES, PROP_KINDS, RATIO_OPTIONS } from '../config.js';
import { POSE_PRESET_MAP } from '../entities/posePresets.js';
import { JOINT_SCHEMA } from '../rig/jointSchema.js';
import { PANEL_LABEL, MOVE_DIRS } from '../anim/cameraMoves.js';
import { clone, isObj, isNum } from '../util/math.js';
import { num as numberType, vec3 as vectorType, hex as colorType, enumOf, obj, rule, optional, nullable, arrayOf, fmt } from '../util/validate.js';

export const SCHEMA_VERSION = 'director-stage/0.2';
export const APP_ID = 'director-stage-demo';

export const ENTITY_TYPES = ['character', 'prop', 'camera', 'group'];
export const FOV_RANGE = [10, 120];

// 动画词汇表（面向 AI，定了就不改）
export const TRACK_PROPERTIES = ['pos', 'rot', 'scale', 'fov'];
export const EASES = ['linear', 'smooth', 'step'];
export const PATH_SPEEDS = ['linear', 'smooth'];
export const PATH_ORIENTS = ['tangent', 'keep'];
export const CONSTRAINT_TYPES = ['lookAt', 'follow'];
/** 各 property 允许的目标实体类型。 */
export const TRACK_TARGETS = {
  pos: ['character', 'prop', 'group', 'camera'],
  rot: ['character', 'prop', 'group', 'camera'],
  scale: ['character', 'prop', 'group'],
  fov: ['camera'],
};
export const PATH_TARGETS = ['character', 'prop', 'camera', 'group'];

const JOINT_MAP = Object.fromEntries(JOINT_SCHEMA.map((j) => [j.key, j]));
// 手动运镜面板持久化的预设名与方向（与 anim/cameraMoves.js 同一份词汇）
const MOVE_NAMES = Object.keys(PANEL_LABEL);
const MOVE_DIR_VALUES = new Set(Object.values(MOVE_DIRS).flat().map(([value]) => value));

// ---- 默认值 ----
/** @type {import("../types/contracts.js").SceneDocument["scene"]} */
export const DEFAULT_SCENE = Object.freeze({
  scale: 1, pos: /** @type {[number,number,number]} */ ([0, 0, 0]), rot: /** @type {[number,number,number]} */ ([0, 0, 0]), sky: '#060608', labels: true,
  ground: { visible: true, opacity: 0.4, height: 0 },
  ratio: 'auto', activeCameraId: null, panorama: null,
});
/** @type {{duration:number,fps:number,mainCameraId:string|null,tracks:object[]}} */
export const DEFAULT_TIMELINE = Object.freeze({ duration: 10, fps: 30, mainCameraId: null, tracks: [] });
export const DEFAULT_SCENE_NAME = '未命名场景';


/** 一份空场景文档（全部字段齐全）。 */
export function createEmptyDocument({ name = DEFAULT_SCENE_NAME, app = APP_ID } = {}) {
  const now = new Date().toISOString();
  return {
    schema: SCHEMA_VERSION,
    meta: { name, createdAt: now, updatedAt: now, app, editorView: null },
    scene: clone(DEFAULT_SCENE),
    assets: {},
    entities: [],
    paths: [],
    constraints: [],
    timeline: clone(DEFAULT_TIMELINE),
  };
}

// ---- 校验 ----
const isStr = v => typeof v === 'string';
const any = rule(() => true, ''); // 引用与字段间关系由下方普通代码检查。
const strType = rule(isStr, '应为字符串');
const nonEmptyType = rule(v => isStr(v) && !!v, '应为非空字符串');
const boolType = rule(v => typeof v === 'boolean', '应为布尔值');
const scalar = numberType(), vector = vectorType(), positive = numberType({ gt: 0 }), timeType = numberType({ min: 0 });
const fovType = numberType({ min: FOV_RANGE[0], max: FOV_RANGE[1] });
const shape = fields => obj(fields, { missingAt: 'parent' });
const record = type => ({ check(v, p, err) {
  if (v === undefined) return;
  if (!isObj(v)) { err(p, '应为对象'); return; }
  for (const [key, value] of Object.entries(v)) type.check(value, `${p}.${key}`, err);
} });
const transformType = shape({ pos: vector, rot: vector, scale: vector });
const originType = shape({ position: vector, rot: vector, roll: scalar, time: timeType });
const moveType = shape({
  signature: strType, customPrefix: optional(boolType),
  segments: { missingAt: 'both', type: arrayOf(shape({
    name: { missingAt: 'both', type: enumOf(MOVE_NAMES) }, aim: vector,
    subject: { check: (v, p, err) => (Array.isArray(v) ? vector : strType).check(v, p, err) },
    origin: originType,
    params: shape({ duration: positive, amount: optional(positive), sweep: optional(positive), rise: optional(positive),
      minSubjectDist: optional(positive), dir: optional(nullable(enumOf([...MOVE_DIR_VALUES]))) }),
  })) },
});
const metaType = shape({
  name: strType, app: strType,
  ...Object.fromEntries(['createdAt', 'updatedAt'].map(k => [k, rule(v => isStr(v) && !Number.isNaN(Date.parse(v)), '应为 ISO 时间字符串')])),
  editorView: nullable(shape({ pos: vector, target: vector, fov: optional(numberType({ gt: 0, max: 179 })) })),
  cameraMoves: optional(nullable(record(moveType))),
});
const entityBase = { type: any, id: nonEmptyType, name: strType, visible: boolType, transform: transformType };
const entityTypes = {
  character: shape({ ...entityBase, body: enumOf(Object.keys(BODY_TYPES)), color: colorType, trailColor: optional(colorType), parent: any,
    pose: shape({ preset: nullable(enumOf(Object.keys(POSE_PRESET_MAP))),
      values: shape(Object.fromEntries(Object.entries(JOINT_MAP).map(([key, joint]) => [key, optional(numberType({ min: joint.min, max: joint.max }))]))) }),
  }),
  prop: shape({ ...entityBase, kind: enumOf(PROP_KINDS.map(([k]) => k)), color: colorType }),
  camera: shape({ ...entityBase, fov: fovType, roll: scalar, lookAt: vector }),
  group: shape({ ...entityBase, members: arrayOf(any, 1) }),
};
const sceneType = shape({
  scale: positive, pos: vector, rot: vector, sky: colorType, labels: boolType,
  ground: shape({ visible: boolType, opacity: numberType({ min: 0, max: 1 }), height: scalar }),
  ratio: enumOf(RATIO_OPTIONS.map(([k]) => k)), activeCameraId: any,
  panorama: nullable(shape({ assetId: any, rotation: scalar, radius: positive })),
});
const timelineType = shape({ duration: positive, fps: numberType({ gt: 0, int: true }), mainCameraId: any, tracks: arrayOf(any) });
const trackType = shape({ id: any, target: any, property: enumOf(TRACK_PROPERTIES), keys: any });
const pathType = shape({
  id: any, target: any, points: arrayOf(vector, 2), closed: boolType, start: timeType, duration: positive,
  schedule: arrayOf(obj({ i: numberType({ min: 0, int: true }), t: timeType, curve: optional(enumOf(['linear', 'smooth', 'cubic'])),
    baseCurve: optional(enumOf(PATH_SPEEDS)), allocation: optional(enumOf(['distance'])), segmented: optional(boolType),
    stop: optional(boolType), closed: optional(boolType), inherited: optional(boolType), caption: optional(boolType), captionTime: optional(boolType) }), 2),
  orient: enumOf(PATH_ORIENTS), interpolation: optional(enumOf(['centripetal', 'polyline'])),
});
const constraintType = shape({ id: any, type: enumOf(CONSTRAINT_TYPES), target: any, subject: any, offset: vector,
  start: nullable(timeType), end: nullable(timeType) });

/** 同源资源路径：只允许 ./assets/ 下的相对路径，不允许 .. 回溯、协议、查询串。 */
export function isLocalAssetURL(url) {
  return isStr(url) && url.startsWith('./assets/') && !url.includes('..') && !/[?#\\]/.test(url) && !/^[a-z]+:/i.test(url);
}

/**
 * 校验文档。只认当前版本（旧版本请先 migrate）。
 * @returns {{ok:boolean, errors:string[]}} errors 每条带定位路径，如 "entities[2].pose.values.lFore 超出范围 -8..145"
 */
export function validate(doc) {
  const errors = [];
  const err = (path, msg) => errors.push(`${path} ${msg}`);
  // 缺字段保留父对象定位；关系校验仅在结构允许时继续。
  /** @param {object} type @param {unknown} v @param {string} path @returns {v is Record<string, any>} */
  const check = (type, v, path) => type.check(v, path, err);
  const vec3 = (v, path) => check(vector, v, path);
  const nonEmpty = (v, path) => check(nonEmptyType, v, path);
  const arr = (v, path) => check(arrayOf(any), v, path);

  if (!isObj(doc)) return { ok: false, errors: [`文档应为对象，实际为 ${fmt(doc)}`] };

  // 版本先查：版本不认识时其余结构没有意义
  if (doc.schema !== SCHEMA_VERSION) {
    return { ok: false, errors: [`schema 版本未知：${fmt(doc.schema)}（当前支持 ${SCHEMA_VERSION}）`] };
  }
  check(shape({ schema: any, meta: any, scene: any, assets: any, entities: any, paths: any, constraints: any, timeline: any }), doc, '文档');

  // ---- meta ----
  check(metaType, doc.meta, 'meta');

  // ---- assets ----
  const assetIds = new Set();
  if (doc.assets === undefined) { /* 已报缺少字段 */ } else if (!isObj(doc.assets)) err('assets', `应为对象，实际为 ${fmt(doc.assets)}`);
  else {
    for (const [id, a] of Object.entries(doc.assets)) {
      const p = `assets.${id}`;
      assetIds.add(id);
      if (!isObj(a)) { err(p, `应为对象，实际为 ${fmt(a)}`); continue; }
      check(obj({ type: enumOf(['image']), name: optional(strType), url: optional(any), dataURL: optional(any) }), a, p);
      const hasUrl = 'url' in a, hasData = 'dataURL' in a;
      if (hasUrl === hasData) err(p, 'url 与 dataURL 必须二选一');
      if (hasUrl && !isLocalAssetURL(a.url)) err(`${p}.url`, `必须是以 ./assets/ 开头的同源相对路径，实际为 ${fmt(a.url)}`);
      if (hasData && !(isStr(a.dataURL) && a.dataURL.startsWith('data:image/'))) err(`${p}.dataURL`, '必须是 data:image/… 格式');
    }
  }

  // ---- entities：先收集 id / 类型，再逐条校验（引用检查要用到全表）----
  const ents = Array.isArray(doc.entities) ? doc.entities : [];
  if (doc.entities !== undefined && !Array.isArray(doc.entities)) err('entities', `应为数组，实际为 ${fmt(doc.entities)}`);
  const byId = new Map();
  ents.forEach((e, i) => {
    if (!isObj(e) || !isStr(e.id) || !e.id) return;
    if (byId.has(e.id)) err(`entities[${i}].id`, `重复：${fmt(e.id)} 已被 entities[${byId.get(e.id).i}] 使用`);
    else byId.set(e.id, { i, type: e.type, e });
  });
  const ref = (id, path, type) => {
    const hit = byId.get(id);
    if (!hit) { err(path, `引用的实体不存在：${fmt(id)}`); return null; }
    if (type && hit.type !== type) { err(path, `应引用 ${type}，实际 ${fmt(id)} 是 ${hit.type}`); return null; }
    return hit;
  };

  const memberOf = new Map(); // characterId → groupId（来自 group.members）
  ents.forEach((e, i) => {
    const p = `entities[${i}]`;
    if (!isObj(e)) { err(p, `应为对象，实际为 ${fmt(e)}`); return; }
    if (!(isStr(e.type) && ENTITY_TYPES.includes(e.type))) { err(`${p}.type`, `未知实体类型 ${fmt(e.type)}（可选 ${ENTITY_TYPES.join(' / ')}）`); return; }
    check(entityTypes[e.type], e, p);
    if (e.type === 'character') {
      if (e.parent != null) ref(e.parent, `${p}.parent`, 'group');
    } else if (e.type === 'group' && Array.isArray(e.members)) {
      e.members.forEach((mid, k) => {
        const mp = `${p}.members[${k}]`;
        const hit = ref(mid, mp, 'character');
        if (!hit) return;
        if (memberOf.has(mid)) err(mp, `${fmt(mid)} 同时属于多个组（${memberOf.get(mid)} / ${e.id}）`);
        else memberOf.set(mid, e.id);
        // parent 悬空时只报"引用不存在"（在该角色条目上），不再重复报不一致
        const parentDangling = isStr(hit.e.parent) && !byId.has(hit.e.parent);
        if (hit.e.parent !== e.id && !parentDangling) err(`entities[${hit.i}].parent`, `应为 ${fmt(e.id)}（该角色列在组 ${fmt(e.id)} 的 members 里），实际为 ${fmt(hit.e.parent)}`);
      });
    }
  });
  // 反向：parent 指向某组，但该组 members 里没有它
  ents.forEach((e, i) => {
    if (e?.type !== 'character' || !isStr(e.parent)) return;
    const g = byId.get(e.parent);
    if (g?.type === 'group' && Array.isArray(g.e.members) && !g.e.members.includes(e.id)) {
      err(`entities[${i}].parent`, `指向组 ${fmt(e.parent)}，但该组 members 里没有 ${fmt(e.id)}`);
    }
  });

  // ---- scene ----
  if (check(sceneType, doc.scene, 'scene')) {
    const s = doc.scene;
    if (s.activeCameraId != null) ref(s.activeCameraId, 'scene.activeCameraId', 'camera');
    if (isObj(s.panorama) && !assetIds.has(s.panorama.assetId)) err('scene.panorama.assetId', `引用的资源不存在：${fmt(s.panorama.assetId)}`);
  }

  // ---- 动画：timeline / paths / constraints ----
  // id 与实体同一命名空间：先登记实体 id，再依次登记轨道 / 路径 / 约束
  const idOwner = new Map([...byId].map(([id, { i }]) => [id, `entities[${i}]`]));
  const claimId = (id, path) => {
    nonEmpty(id, `${path}.id`);
    if (!isStr(id) || !id) return;
    if (idOwner.has(id)) err(`${path}.id`, `重复：${fmt(id)} 已被 ${idOwner.get(id)} 使用`);
    else idOwner.set(id, path);
  };
  /** 动画目标：必须存在且类型在 types 内。返回命中项或 null。 */
  const animRef = (id, path, types) => {
    if (id === undefined) return null;
    if (!isStr(id) || !id) { err(path, `应为实体 id，实际为 ${fmt(id)}`); return null; }
    const hit = byId.get(id);
    if (!hit) { err(path, `引用的实体不存在：${fmt(id)}`); return null; }
    if (!types.includes(hit.type)) { err(path, `应引用 ${types.join(' / ')}，实际 ${fmt(id)} 是 ${hit.type}`); return null; }
    return hit;
  };
  const posTracks = new Map(); // targetId → 位置轨道；机位允许结束后衔接路径
  if (check(timelineType, doc.timeline, 'timeline')) {
    const t = doc.timeline;
    if (t.mainCameraId != null) ref(t.mainCameraId, 'timeline.mainCameraId', 'camera');
    const seen = new Map(); // `${target}|${property}` → 轨道路径
    (Array.isArray(t.tracks) ? t.tracks : []).forEach((tr, i) => {
      const p = `timeline.tracks[${i}]`;
      if (!check(trackType, tr, p)) return;
      claimId(tr.id, p);
      const okProp = isStr(tr.property) && TRACK_PROPERTIES.includes(tr.property);
      const hit = okProp ? animRef(tr.target, `${p}.target`, TRACK_TARGETS[tr.property]) : null;
      if (hit) {
        const k = `${tr.target}|${tr.property}`;
        if (seen.has(k)) err(p, `与 ${seen.get(k)} 重复：同一实体 ${fmt(tr.target)} 的 ${tr.property} 只能有一条轨道`);
        else seen.set(k, p);
        if (tr.property === 'pos') posTracks.set(tr.target, { track: tr, path: p });
      }
      if (tr.keys === undefined) return;
      // keys 可为空（先加轨道、再打键的中间状态；evaluate 里是 no-op），非空时严格递增
      if (!Array.isArray(tr.keys)) { err(`${p}.keys`, `应为数组，实际为 ${fmt(tr.keys)}`); return; }
      let prevT = null;
      tr.keys.forEach((key, j) => {
        const kp = `${p}.keys[${j}]`;
        if (!check(shape({ t: timeType, value: !okProp ? any : tr.property === 'fov' ? fovType : vector, ease: enumOf(EASES) }), key, kp)) { prevT = null; return; }
        if (isNum(key.t) && prevT !== null && !(key.t > prevT)) err(`${kp}.t`, `应大于前一键 ${prevT}，实际为 ${key.t}`);
        prevT = isNum(key.t) ? key.t : null;
        if (!okProp || key.value === undefined) return;
        if (tr.property === 'scale' && Array.isArray(key.value)) {
          key.value.forEach((x, n) => { if (isNum(x) && !(x > 0)) err(`${kp}.value[${n}]`, `缩放应大于 0，实际为 ${x}`); });
        }
      });
    });
  }

  arr(doc.paths, 'paths');
  const pathOf = new Map(); // targetId → 路径路径
  (Array.isArray(doc.paths) ? doc.paths : []).forEach((pa, i) => {
    const p = `paths[${i}]`;
    if (!check(pathType, pa, p)) return;
    claimId(pa.id, p);
    const hit = animRef(pa.target, `${p}.target`, PATH_TARGETS);
    if (hit) {
      if (hit.type === 'character' && hit.e.parent != null) err(`${p}.target`, `${fmt(pa.target)} 是群众成员，不能单独有路径（请给所在组 ${fmt(hit.e.parent)} 加路径）`);
      else if (pathOf.has(pa.target)) err(`${p}.target`, `${fmt(pa.target)} 已有路径 ${pathOf.get(pa.target)}，每个实体最多一条`);
      else pathOf.set(pa.target, p);
      const prefix = posTracks.get(pa.target);
      if (prefix) {
        const last = prefix.track.keys?.at(-1);
        const connected = hit.type === 'camera' && last && last.t <= pa.start && Array.isArray(last.value) && last.value.every((v, i) => Math.abs(v - pa.points?.[0]?.[i]) < 1e-6);
        if (!connected) err(`${p}.target`, `${fmt(pa.target)} 已有 pos 轨道 ${prefix.path}，路径与 pos 轨道不能重叠；仅机位可在位置动画结束后从末端接续`);
      }
    }
    if (!Array.isArray(pa.schedule) || !Array.isArray(pa.points) || pa.schedule.some(entry => !entry || !Number.isInteger(entry.i) || !isNum(entry.t))) return;
    const entries = pa.schedule.filter(entry => !entry.caption), lastIndex = pa.points.length - (pa.closed ? 0 : 1);
    if (entries[0]?.i !== 0 || entries[0]?.t !== 0 || !entries[0]?.curve) err(`${p}.schedule`, '时刻表须从顶点 0、时刻 0 开始并指定曲线');
    if (entries.at(-1)?.i !== lastIndex || entries.at(-1)?.t !== pa.duration) err(`${p}.schedule`, '末项须为终点和路径时长');
    entries.forEach((entry, j) => {
      const previous = entries[j - 1], q = `${p}.schedule[${j}]`;
      if (entry.i > lastIndex || entry.t > pa.duration) err(q, '顶点或时刻超出路径范围');
      if (previous && (entry.i < previous.i || (entry.t < previous.t || (entry.t === previous.t && entries[0].allocation !== 'distance')))) err(q, '顶点下标应非递减，时刻应严格递增');
      if (entry.stop && (entry.i === 0 || entry.i === lastIndex)) err(q, '停顿标记只能位于中间顶点');
      if (entry.closed && (!previous || entry.i - previous.i < 3 || JSON.stringify(pa.points[previous.i]) !== JSON.stringify(pa.points[entry.i]))) err(q, '闭合段须至少三条边且首尾重合');
    });
    if (entries[0]?.curve === 'cubic' && (pa.closed || entries.length !== pa.points.length || entries.some((entry, i) => entry.i !== i))) err(`${p}.schedule`, '节点曲线须覆盖开放路径的每个顶点');
  });

  arr(doc.constraints, 'constraints');
  (Array.isArray(doc.constraints) ? doc.constraints : []).forEach((c, i) => {
    const p = `constraints[${i}]`;
    if (!check(constraintType, c, p)) return;
    claimId(c.id, p);
    animRef(c.target, `${p}.target`, ['camera']);
    if (Array.isArray(c.subject)) vec3(c.subject, `${p}.subject`);
    else if (c.subject !== undefined) {
      if (animRef(c.subject, `${p}.subject`, ENTITY_TYPES) && c.subject === c.target) err(`${p}.subject`, `不能是被约束的机位自己 ${fmt(c.target)}`);
    }
    if (isNum(c.start) && isNum(c.end) && !(c.end > c.start)) err(`${p}.end`, `应大于 start ${c.start}，实际为 ${c.end}`);
  });

  return { ok: errors.length === 0, errors };
}

/** 校验失败的错误对象：errors 为完整定位列表。 */
export class DocumentError extends Error {
  constructor(errors) {
    super(`场景文档不合法（${errors.length} 处）：` + errors.slice(0, 3).join('；'));
    this.name = 'DocumentError';
    this.errors = errors;
  }
}
