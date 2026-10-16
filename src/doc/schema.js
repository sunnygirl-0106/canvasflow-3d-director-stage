// 场景文档 schema：版本号 / 默认值 / 手写校验器（不引 ajv）。
// 文档是"源"，场景对象是它的渲染结果；界面上能看到的每个场景状态在这里都有字段。
// 词汇表面向 AI 与外部工具，用通用词（如 group），不跟代码类名走。
//
// 文档形状（director-stage/0.1）：
// {
//   schema: 'director-stage/0.1',
//   meta: { name, createdAt, updatedAt, app, editorView: { pos:[x,y,z], target:[x,y,z] } | null },
//   scene: { scale, pos:[3], rot:[3](度), sky:'#rrggbb', labels, ground:{visible, opacity, height},
//            ratio, activeCameraId, panorama: { assetId, rotation(度), radius } | null },
//   assets: { [id]: { type:'image', name, url | dataURL } },        // url 只接受同源 ./assets/…
//   entities: [
//     { type:'character', id, name, body, color, visible, transform, pose:{ preset, values }, parent },
//     { type:'prop',      id, name, kind, color, visible, transform },
//     { type:'camera',    id, name, visible, transform, fov, roll(度), lookAt:[3] },
//     { type:'group',     id, name, visible, transform, members:[ids] },
//   ],
//   paths: [], constraints: [], timeline: { duration, fps, mainCameraId, tracks: [] },   // 后续阶段预留
// }
// transform = { pos:[3], rot:[3](度, XYZ 欧拉), scale:[3] }。
//   - character 的 scale 是"相对素体自然尺寸的倍数"（站立素体 = [1,1,1]），与模型文件单位无关；
//   - group 成员（parent 非 null）的 transform 是相对组轴心的局部变换；
//   - camera 的 rot 已包含荷兰角；roll 单独存一份，供"改注视坐标后重新瞄准"时叠加。
// camera.lookAt 与 transform 同时存在时以 transform + roll 为准，lookAt 只回写面板显示（不触发瞄准），
// 校验器不检查二者一致（阶段 F 升级为注视约束时再统一）。
import { BODY_TYPES, PROP_KINDS, RATIO_OPTIONS } from '../config.js';
import { POSE_PRESET_MAP } from '../entities/posePresets.js';
import { JOINT_SCHEMA } from '../rig/jointSchema.js';

export const SCHEMA_VERSION = 'director-stage/0.1';
export const APP_ID = 'director-stage-demo';

export const ENTITY_TYPES = ['character', 'prop', 'camera', 'group'];
export const FOV_RANGE = [10, 120];

const JOINT_MAP = Object.fromEntries(JOINT_SCHEMA.map((j) => [j.key, j]));
const PROP_KIND_SET = new Set(PROP_KINDS.map(([k]) => k));
const RATIO_SET = new Set(RATIO_OPTIONS.map(([k]) => k));
const HEX_RE = /^#[0-9a-f]{6}$/i;

// ---- 默认值 ----
export const DEFAULT_SCENE = Object.freeze({
  scale: 1, pos: [0, 0, 0], rot: [0, 0, 0], sky: '#060608', labels: true,
  ground: { visible: true, opacity: 0.4, height: 0 },
  ratio: 'auto', activeCameraId: null, panorama: null,
});
export const DEFAULT_TIMELINE = Object.freeze({ duration: 10, fps: 30, mainCameraId: null, tracks: [] });
export const DEFAULT_TRANSFORM = Object.freeze({ pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] });

const clone = (v) => JSON.parse(JSON.stringify(v));

/** 一份空场景文档（全部字段齐全）。 */
export function createEmptyDocument({ name = '未命名场景', app = APP_ID } = {}) {
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
const TOP_KEYS = ['schema', 'meta', 'scene', 'assets', 'entities', 'paths', 'constraints', 'timeline'];
const META_KEYS = ['name', 'createdAt', 'updatedAt', 'app', 'editorView'];
const SCENE_KEYS = ['scale', 'pos', 'rot', 'sky', 'labels', 'ground', 'ratio', 'activeCameraId', 'panorama'];
const ENTITY_KEYS = {
  character: ['type', 'id', 'name', 'body', 'color', 'visible', 'transform', 'pose', 'parent'],
  prop: ['type', 'id', 'name', 'kind', 'color', 'visible', 'transform'],
  camera: ['type', 'id', 'name', 'visible', 'transform', 'fov', 'roll', 'lookAt'],
  group: ['type', 'id', 'name', 'visible', 'transform', 'members'],
};
const TIMELINE_KEYS = ['duration', 'fps', 'mainCameraId', 'tracks'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string';
const fmt = (v) => (v === undefined ? 'undefined'
  : JSON.stringify(v, (k, x) => (typeof x === 'number' && !Number.isFinite(x) ? String(x) : x)));

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
  // 约定：字段缺失（undefined）由上一级 checkKeys 报"缺少字段"，下面各值检查遇到 undefined 直接跳过，避免重复报错。

  /** 必须是对象且键集合恰好为 keys（缺键 / 多余键都报）。返回是否为对象。 */
  const checkKeys = (v, path, keys) => {
    if (v === undefined) return false;
    if (!isObj(v)) { err(path, `应为对象，实际为 ${fmt(v)}`); return false; }
    for (const k of keys) if (!(k in v)) err(path, `缺少字段 ${k}`);
    for (const k of Object.keys(v)) if (!keys.includes(k)) err(`${path}.${k}`, '是未知字段');
    return true;
  };
  const vec3 = (v, path) => {
    if (v === undefined) return;
    if (!Array.isArray(v) || v.length !== 3) { err(path, `应为长度 3 的数组，实际为 ${fmt(v)}`); return; }
    v.forEach((x, i) => { if (!isNum(x)) err(`${path}[${i}]`, `应为有限数，实际为 ${fmt(x)}`); });
  };
  const num = (v, path, { min = -Infinity, max = Infinity, gt } = {}) => {
    if (v === undefined) return;
    if (!isNum(v)) { err(path, `应为有限数，实际为 ${fmt(v)}`); return; }
    if (gt != null && !(v > gt)) err(path, `应大于 ${gt}，实际为 ${v}`);
    if (v < min || v > max) err(path, `超出范围 ${min}..${max}，实际为 ${v}`);
  };
  const bool = (v, path) => { if (v !== undefined && typeof v !== 'boolean') err(path, `应为布尔值，实际为 ${fmt(v)}`); };
  const str = (v, path) => { if (v !== undefined && !isStr(v)) err(path, `应为字符串，实际为 ${fmt(v)}`); };
  const nonEmpty = (v, path) => { if (v !== undefined && (!isStr(v) || !v)) err(path, `应为非空字符串，实际为 ${fmt(v)}`); };
  const hex = (v, path) => { if (v !== undefined && (!isStr(v) || !HEX_RE.test(v))) err(path, `应为 #rrggbb 颜色，实际为 ${fmt(v)}`); };
  const arr = (v, path) => { if (v !== undefined && !Array.isArray(v)) err(path, `应为数组，实际为 ${fmt(v)}`); };

  if (!isObj(doc)) return { ok: false, errors: [`文档应为对象，实际为 ${fmt(doc)}`] };

  // 版本先查：版本不认识时其余结构没有意义
  if (doc.schema !== SCHEMA_VERSION) {
    return { ok: false, errors: [`schema 版本未知：${fmt(doc.schema)}（当前支持 ${SCHEMA_VERSION}）`] };
  }
  checkKeys(doc, '文档', TOP_KEYS);

  // ---- meta ----
  if (checkKeys(doc.meta, 'meta', META_KEYS)) {
    const m = doc.meta;
    str(m.name, 'meta.name');
    for (const k of ['createdAt', 'updatedAt']) {
      if (m[k] !== undefined && (!isStr(m[k]) || Number.isNaN(Date.parse(m[k])))) err(`meta.${k}`, `应为 ISO 时间字符串，实际为 ${fmt(m[k])}`);
    }
    str(m.app, 'meta.app');
    if (m.editorView != null && checkKeys(m.editorView, 'meta.editorView', ['pos', 'target'])) {
      vec3(m.editorView.pos, 'meta.editorView.pos');
      vec3(m.editorView.target, 'meta.editorView.target');
    }
  }

  // ---- assets ----
  const assetIds = new Set();
  if (doc.assets === undefined) { /* 已报缺少字段 */ } else if (!isObj(doc.assets)) err('assets', `应为对象，实际为 ${fmt(doc.assets)}`);
  else {
    for (const [id, a] of Object.entries(doc.assets)) {
      const p = `assets.${id}`;
      assetIds.add(id);
      if (!isObj(a)) { err(p, `应为对象，实际为 ${fmt(a)}`); continue; }
      for (const k of Object.keys(a)) if (!['type', 'name', 'url', 'dataURL'].includes(k)) err(`${p}.${k}`, '是未知字段');
      if (a.type !== 'image') err(`${p}.type`, `应为 'image'，实际为 ${fmt(a.type)}`);
      str(a.name, `${p}.name`);
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
    if (!ENTITY_TYPES.includes(e.type)) { err(`${p}.type`, `未知实体类型 ${fmt(e.type)}（可选 ${ENTITY_TYPES.join(' / ')}）`); return; }
    checkKeys(e, p, ENTITY_KEYS[e.type]);
    nonEmpty(e.id, `${p}.id`);
    str(e.name, `${p}.name`);
    bool(e.visible, `${p}.visible`);
    if (checkKeys(e.transform, `${p}.transform`, ['pos', 'rot', 'scale'])) {
      for (const k of ['pos', 'rot', 'scale']) vec3(e.transform[k], `${p}.transform.${k}`);
    }

    if (e.type === 'character') {
      if (e.body !== undefined && !(isStr(e.body) && e.body in BODY_TYPES)) err(`${p}.body`, `未知体型 ${fmt(e.body)}（可选 ${Object.keys(BODY_TYPES).join(' / ')}）`);
      hex(e.color, `${p}.color`);
      if (checkKeys(e.pose, `${p}.pose`, ['preset', 'values'])) {
        const { preset, values } = e.pose;
        if (preset != null && !(isStr(preset) && preset in POSE_PRESET_MAP)) {
          err(`${p}.pose.preset`, `未知姿势预设 ${fmt(preset)}（应为 null 或 ${Object.keys(POSE_PRESET_MAP).join(' / ')}）`);
        }
        if (values === undefined) { /* 已报缺少字段 */ } else if (!isObj(values)) err(`${p}.pose.values`, `应为对象，实际为 ${fmt(values)}`);
        else {
          for (const [k, v] of Object.entries(values)) {
            const j = JOINT_MAP[k];
            const vp = `${p}.pose.values.${k}`;
            if (!j) { err(vp, '不是已知关节'); continue; }
            if (!isNum(v)) err(vp, `应为有限数，实际为 ${fmt(v)}`);
            else if (v < j.min || v > j.max) err(vp, `超出范围 ${j.min}..${j.max}，实际为 ${v}`);
          }
        }
      }
      if (e.parent != null) ref(e.parent, `${p}.parent`, 'group');
    } else if (e.type === 'prop') {
      if (e.kind !== undefined && !PROP_KIND_SET.has(e.kind)) err(`${p}.kind`, `未知道具类型 ${fmt(e.kind)}（可选 ${[...PROP_KIND_SET].join(' / ')}）`);
      hex(e.color, `${p}.color`);
    } else if (e.type === 'camera') {
      num(e.fov, `${p}.fov`, { min: FOV_RANGE[0], max: FOV_RANGE[1] });
      num(e.roll, `${p}.roll`);
      vec3(e.lookAt, `${p}.lookAt`);
    } else if (e.type === 'group') {
      if (e.members === undefined) { /* 已报缺少字段 */ } else if (!Array.isArray(e.members) || !e.members.length) err(`${p}.members`, `应为非空数组，实际为 ${fmt(e.members)}`);
      else {
        e.members.forEach((mid, k) => {
          const mp = `${p}.members[${k}]`;
          const hit = ref(mid, mp, 'character');
          if (!hit) return;
          if (memberOf.has(mid)) err(mp, `${fmt(mid)} 同时属于多个组（${memberOf.get(mid)} / ${e.id}）`);
          else memberOf.set(mid, e.id);
          if (hit.e.parent !== e.id) err(`entities[${hit.i}].parent`, `应为 ${fmt(e.id)}（该角色列在组 ${fmt(e.id)} 的 members 里），实际为 ${fmt(hit.e.parent)}`);
        });
      }
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
  if (checkKeys(doc.scene, 'scene', SCENE_KEYS)) {
    const s = doc.scene;
    num(s.scale, 'scene.scale', { gt: 0 });
    vec3(s.pos, 'scene.pos');
    vec3(s.rot, 'scene.rot');
    hex(s.sky, 'scene.sky');
    bool(s.labels, 'scene.labels');
    if (checkKeys(s.ground, 'scene.ground', ['visible', 'opacity', 'height'])) {
      bool(s.ground.visible, 'scene.ground.visible');
      num(s.ground.opacity, 'scene.ground.opacity', { min: 0, max: 1 });
      num(s.ground.height, 'scene.ground.height');
    }
    if (s.ratio !== undefined && !RATIO_SET.has(s.ratio)) err('scene.ratio', `未知取景比例 ${fmt(s.ratio)}（可选 ${[...RATIO_SET].join(' / ')}）`);
    if (s.activeCameraId != null) ref(s.activeCameraId, 'scene.activeCameraId', 'camera');
    if (s.panorama != null && checkKeys(s.panorama, 'scene.panorama', ['assetId', 'rotation', 'radius'])) {
      if (!assetIds.has(s.panorama.assetId)) err('scene.panorama.assetId', `引用的资源不存在：${fmt(s.panorama.assetId)}`);
      num(s.panorama.rotation, 'scene.panorama.rotation');
      num(s.panorama.radius, 'scene.panorama.radius', { gt: 0 });
    }
  }

  // ---- 预留字段：只校验形状 ----
  arr(doc.paths, 'paths');
  arr(doc.constraints, 'constraints');
  if (checkKeys(doc.timeline, 'timeline', TIMELINE_KEYS)) {
    const t = doc.timeline;
    num(t.duration, 'timeline.duration', { gt: 0 });
    if (t.fps !== undefined && !(Number.isInteger(t.fps) && t.fps > 0)) err('timeline.fps', `应为正整数，实际为 ${fmt(t.fps)}`);
    if (t.mainCameraId != null) ref(t.mainCameraId, 'timeline.mainCameraId', 'camera');
    arr(t.tracks, 'timeline.tracks');
  }

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
