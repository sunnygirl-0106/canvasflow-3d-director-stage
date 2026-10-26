// 场景文档 schema：版本号 / 默认值 / 手写校验器（不引 ajv）。
// 文档是"源"，场景对象是它的渲染结果；界面上能看到的每个场景状态在这里都有字段。
// 词汇表面向 AI 与外部工具，用通用词（如 group），不跟代码类名走。
//
// 文档形状（director-stage/0.1）：
// {
//   schema: 'director-stage/0.1',
//   meta: { name, createdAt, updatedAt, app, editorView: { pos:[x,y,z], target:[x,y,z], fov?:number } | null },
//   scene: { scale, pos:[3], rot:[3](度), sky:'#rrggbb', labels, ground:{visible, opacity, height},
//            ratio, activeCameraId, panorama: { assetId, rotation(度), radius } | null },
//   assets: { [id]: { type:'image', name, url | dataURL } },        // url 只接受同源 ./assets/…
//   entities: [
//     { type:'character', id, name, body, color, visible, transform, pose:{ preset, values }, parent },
//     { type:'prop',      id, name, kind, color, visible, transform },
//     { type:'camera',    id, name, visible, transform, fov, roll(度), lookAt:[3] },
//     { type:'group',     id, name, visible, transform, members:[ids] },
//   ],
//   paths: [ Path ], constraints: [ Constraint ], timeline: { duration, fps, mainCameraId, tracks: [ Track ] },
// }
// transform = { pos:[3], rot:[3](度, XYZ 欧拉), scale:[3] }。
//   - character 的 scale 是"相对素体自然尺寸的倍数"（站立素体 = [1,1,1]），与模型文件单位无关；
//   - group 成员（parent 非 null）的 transform 是相对组轴心的局部变换；
//   - camera 的 rot 已包含荷兰角；roll 单独存一份，供"改注视坐标后重新瞄准"时叠加。
// camera.lookAt 与 transform 同时存在时以 transform + roll 为准，lookAt 只回写面板显示（不触发瞄准），
// 校验器不检查二者一致。
//
// 动画—— 时间单位一律为秒；坐标与 entities[].transform 同一口径（场景根节点下的局部坐标）：
// timeline: {
//   duration: 10,            // 秒，> 0
//   fps: 30,                 // 只影响吸附与导出
//   mainCameraId: null,      // 主机位（机位视角下播放时透过它看）
//   tracks: [ Track ],
// }
// Track = {
//   id,                      // 8 位 base36，与实体 / 路径 / 约束同一命名空间内唯一
//   target: entityId,        // character / prop / group / camera
//   property: 'pos' | 'rot' | 'scale' | 'fov',   // fov 只允许 camera；camera 不允许 scale
//   keys: [ { t, value, ease } ],                // 可为空（空轨道不驱动任何属性，但仍占名额）；非空时 t 严格递增；value: vec3（口径同 transform，rot 为欧拉角度数 XYZ）或 number（fov）
// }                                              // ease ∈ 'linear' | 'smooth' | 'step'，作用于"从该键出发"的那一段；最后一键的 ease 忽略
// Path = {
//   id, target: entityId,    // character / prop / camera / group（群众成员不能单独有路径）；每个实体最多一条
//   points: [[x,y,z], ...],  // ≥ 2 个；角色 / 组的路径 y 即地面高度（= transform.pos.y）
//   closed: false,
//   interpolation: 'centripetal' | 'polyline', // 可选：缺省保持原曲线；折线按真实边长求值
//   start: 0, duration: 4,   // 秒；start ≥ 0，duration > 0
//   speed: 'linear' | 'smooth',      // 弧长随时间的曲线：匀速 / 缓入缓出
//   orient: 'tangent' | 'keep',      // 朝向跟随切线（只改 yaw）/ 保持手动朝向
//   stops: [i, ...],                 // 可选：停顿的顶点索引，升序、不含首尾（闭合路径可到 n−1）；缺省 = 无停顿
//   stopTimes: [秒, ...],            // 可选：到达各停顿顶点的时刻（相对 start），与 stops 等长、递增、在 (0, duration) 内；
//   timedSegments: [{from,to,start,end}], // 可选：连续覆盖全部顶点；时段间空隙是真正的驻足，时间相对路径 start
//   waypointTimes: [秒, ...],       // 可选：依次到达各节点的相对时刻；内部节点速度连续，不能与分段停步并用
// }                                  //   缺省 = 各段按弧长比例分配时长。有 stops 时每段各自缓入缓出（停顿处速度 0）
// Constraint = {
//   id, type: 'lookAt' | 'follow',
//   target: cameraId,                 // 被约束的机位（本阶段只约束机位）
//   subject: entityId | [x,y,z],      // 看向 / 跟随谁（不能是 target 自己）
//   offset: [x,y,z],                  // follow 用：在 subject 的 yaw 坐标系下的偏移；lookAt 忽略
//   start: null, end: null,           // 生效区间（秒），null = 全程
// }
// 规则：同一实体同一 property 最多一条轨道（空轨道也算）；有路径的实体不允许再有 pos 轨道（路径优先，直接拒绝）。
// 机位同时有 follow 与 pos 轨道 / 路径时仍合法，follow 覆盖之（evaluate 顺序：关键帧 → 路径 → 约束）。
import { BODY_TYPES, PROP_KINDS, RATIO_OPTIONS } from '../config.js';
import { POSE_PRESET_MAP } from '../entities/posePresets.js';
import { JOINT_SCHEMA } from '../rig/jointSchema.js';
import { clone, isObj, isNum } from '../util/math.js';

export const SCHEMA_VERSION = 'director-stage/0.1';
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
const TRACK_KEYS = ['id', 'target', 'property', 'keys'];
const KEY_KEYS = ['t', 'value', 'ease'];
const PATH_KEYS = ['id', 'target', 'points', 'closed', 'start', 'duration', 'speed', 'orient'];
const PATH_OPTIONAL = ['stops', 'stopTimes', 'interpolation', 'timedSegments', 'waypointTimes'];
const CONSTRAINT_KEYS = ['id', 'type', 'target', 'subject', 'offset', 'start', 'end'];

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

  /** 必须是对象且键集合恰好为 keys（缺键 / 多余键都报；optional 里的可缺省）。返回是否为对象。 */
  const checkKeys = (v, path, keys, optional = []) => {
    if (v === undefined) return false;
    if (!isObj(v)) { err(path, `应为对象，实际为 ${fmt(v)}`); return false; }
    for (const k of keys) if (!(k in v)) err(path, `缺少字段 ${k}`);
    for (const k of Object.keys(v)) if (!keys.includes(k) && !optional.includes(k)) err(`${path}.${k}`, '是未知字段');
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
  if (checkKeys(doc.meta, 'meta', META_KEYS, ['cameraMoves'])) {
    const m = doc.meta;
    str(m.name, 'meta.name');
    for (const k of ['createdAt', 'updatedAt']) {
      if (m[k] !== undefined && (!isStr(m[k]) || Number.isNaN(Date.parse(m[k])))) err(`meta.${k}`, `应为 ISO 时间字符串，实际为 ${fmt(m[k])}`);
    }
    str(m.app, 'meta.app');
    if (m.cameraMoves != null) {
      if (typeof m.cameraMoves !== 'object' || Array.isArray(m.cameraMoves)) err('meta.cameraMoves', '应为对象');
      else for (const [id, state] of Object.entries(m.cameraMoves)) {
        const p = `meta.cameraMoves.${id}`;
        if (!checkKeys(state, p, ['signature', 'segments'], ['customPrefix'])) continue;
        str(state.signature, `${p}.signature`);
        if (state.customPrefix !== undefined && typeof state.customPrefix !== 'boolean') err(`${p}.customPrefix`, '应为布尔值');
        if (!Array.isArray(state.segments)) { err(`${p}.segments`, '应为数组'); continue; }
        state.segments.forEach((segment, i) => {
          const q = `${p}.segments[${i}]`;
          if (!checkKeys(segment, q, ['name', 'params', 'subject', 'aim', 'origin'])) return;
          if (!['circle', 'half_orbit', 'push_in', 'pull_out', 'truck', 'crane', 'spiral', 'pan'].includes(segment.name)) err(`${q}.name`, '未知运镜');
          vec3(segment.aim, `${q}.aim`);
          if (Array.isArray(segment.subject)) vec3(segment.subject, `${q}.subject`); else str(segment.subject, `${q}.subject`);
          if (checkKeys(segment.origin, `${q}.origin`, ['position', 'rot', 'roll', 'time'])) {
            vec3(segment.origin.position, `${q}.origin.position`); vec3(segment.origin.rot, `${q}.origin.rot`);
            num(segment.origin.roll, `${q}.origin.roll`); num(segment.origin.time, `${q}.origin.time`, { min: 0 });
          }
          if (checkKeys(segment.params, `${q}.params`, ['duration'], ['amount', 'sweep', 'rise', 'dir', 'minSubjectDist'])) {
            for (const k of ['duration', 'amount', 'sweep', 'rise', 'minSubjectDist']) num(segment.params[k], `${q}.params.${k}`, { gt: 0 });
            if (segment.params.dir != null && !['ccw', 'cw', 'left', 'right', 'up', 'down'].includes(segment.params.dir)) err(`${q}.params.dir`, '无效方向');
          }
        });
      }
    }
    if (m.editorView != null && checkKeys(m.editorView, 'meta.editorView', ['pos', 'target'], ['fov'])) {
      vec3(m.editorView.pos, 'meta.editorView.pos');
      vec3(m.editorView.target, 'meta.editorView.target');
      num(m.editorView.fov, 'meta.editorView.fov', { gt: 0, max: 179 });
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
    checkKeys(e, p, ENTITY_KEYS[e.type], e.type === 'character' ? ['trailColor'] : []);
    nonEmpty(e.id, `${p}.id`);
    str(e.name, `${p}.name`);
    bool(e.visible, `${p}.visible`);
    if (checkKeys(e.transform, `${p}.transform`, ['pos', 'rot', 'scale'])) {
      for (const k of ['pos', 'rot', 'scale']) vec3(e.transform[k], `${p}.transform.${k}`);
    }

    if (e.type === 'character') {
      if (e.body !== undefined && !(isStr(e.body) && e.body in BODY_TYPES)) err(`${p}.body`, `未知体型 ${fmt(e.body)}（可选 ${Object.keys(BODY_TYPES).join(' / ')}）`);
      hex(e.color, `${p}.color`);
      hex(e.trailColor, `${p}.trailColor`);
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
          // parent 悬空时只报"引用不存在"（在该角色条目上），不再重复报不一致
          const parentDangling = isStr(hit.e.parent) && !byId.has(hit.e.parent);
          if (hit.e.parent !== e.id && !parentDangling) err(`entities[${hit.i}].parent`, `应为 ${fmt(e.id)}（该角色列在组 ${fmt(e.id)} 的 members 里），实际为 ${fmt(hit.e.parent)}`);
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
  const oneOf = (v, path, list, what) => {
    if (v !== undefined && !list.includes(v)) err(path, `未知${what} ${fmt(v)}（可选 ${list.join(' / ')}）`);
  };
  const time = (v, path) => num(v, path, { min: 0 });
  const nullableTime = (v, path) => { if (v !== null) time(v, path); };

  const posTracks = new Map(); // targetId → 轨道路径（pos 轨道，与路径互斥）
  if (checkKeys(doc.timeline, 'timeline', TIMELINE_KEYS)) {
    const t = doc.timeline;
    num(t.duration, 'timeline.duration', { gt: 0 });
    if (t.fps !== undefined && !(Number.isInteger(t.fps) && t.fps > 0)) err('timeline.fps', `应为正整数，实际为 ${fmt(t.fps)}`);
    if (t.mainCameraId != null) ref(t.mainCameraId, 'timeline.mainCameraId', 'camera');
    arr(t.tracks, 'timeline.tracks');
    const seen = new Map(); // `${target}|${property}` → 轨道路径
    (Array.isArray(t.tracks) ? t.tracks : []).forEach((tr, i) => {
      const p = `timeline.tracks[${i}]`;
      if (!checkKeys(tr, p, TRACK_KEYS)) return;
      claimId(tr.id, p);
      oneOf(tr.property, `${p}.property`, TRACK_PROPERTIES, '轨道属性');
      const okProp = TRACK_PROPERTIES.includes(tr.property);
      const hit = okProp ? animRef(tr.target, `${p}.target`, TRACK_TARGETS[tr.property]) : null;
      if (hit) {
        const k = `${tr.target}|${tr.property}`;
        if (seen.has(k)) err(p, `与 ${seen.get(k)} 重复：同一实体 ${fmt(tr.target)} 的 ${tr.property} 只能有一条轨道`);
        else seen.set(k, p);
        if (tr.property === 'pos') posTracks.set(tr.target, p);
      }
      if (tr.keys === undefined) return;
      // keys 可为空（先加轨道、再打键的中间状态；evaluate 里是 no-op），非空时严格递增
      if (!Array.isArray(tr.keys)) { err(`${p}.keys`, `应为数组，实际为 ${fmt(tr.keys)}`); return; }
      let prevT = null;
      tr.keys.forEach((key, j) => {
        const kp = `${p}.keys[${j}]`;
        if (!checkKeys(key, kp, KEY_KEYS)) { prevT = null; return; }
        time(key.t, `${kp}.t`);
        if (isNum(key.t) && prevT !== null && !(key.t > prevT)) err(`${kp}.t`, `应大于前一键 ${prevT}，实际为 ${key.t}`);
        prevT = isNum(key.t) ? key.t : null;
        oneOf(key.ease, `${kp}.ease`, EASES, '缓动');
        if (!okProp || key.value === undefined) return;
        if (tr.property === 'fov') num(key.value, `${kp}.value`, { min: FOV_RANGE[0], max: FOV_RANGE[1] });
        else {
          vec3(key.value, `${kp}.value`);
          if (tr.property === 'scale' && Array.isArray(key.value)) {
            key.value.forEach((x, n) => { if (isNum(x) && !(x > 0)) err(`${kp}.value[${n}]`, `缩放应大于 0，实际为 ${x}`); });
          }
        }
      });
    });
  }

  /** 路径停顿：stops 为升序顶点索引（不含首尾），stopTimes 与之等长、递增、在 (0, duration) 内。 */
  const checkStops = (pa, p) => {
    const { stops, stopTimes } = pa;
    if (stops === undefined) {
      if (stopTimes !== undefined) err(`${p}.stopTimes`, '需要同时给出 stops');
      return;
    }
    if (!Array.isArray(stops)) { err(`${p}.stops`, `应为顶点索引数组，实际为 ${fmt(stops)}`); return; }
    const n = Array.isArray(pa.points) ? pa.points.length : 0;
    const last = pa.closed ? n - 1 : n - 2;
    stops.forEach((i, j) => {
      if (!Number.isInteger(i) || i < 1 || i > last) err(`${p}.stops[${j}]`, `应为 1–${last} 之间的顶点索引（不含首尾），实际为 ${fmt(i)}`);
      else if (j > 0 && !(i > stops[j - 1])) err(`${p}.stops[${j}]`, `应大于前一项 ${stops[j - 1]}，实际为 ${i}`);
    });
    if (stopTimes === undefined) return;
    if (!Array.isArray(stopTimes) || stopTimes.length !== stops.length) { err(`${p}.stopTimes`, `应为与 stops 等长（${stops.length}）的时刻数组，实际为 ${fmt(stopTimes)}`); return; }
    stopTimes.forEach((t, j) => {
      if (!isNum(t) || !(t > 0) || (isNum(pa.duration) && !(t < pa.duration))) err(`${p}.stopTimes[${j}]`, `应在 (0, ${pa.duration}) 内，实际为 ${fmt(t)}`);
      else if (j > 0 && !(t > stopTimes[j - 1])) err(`${p}.stopTimes[${j}]`, `应大于前一项 ${stopTimes[j - 1]}，实际为 ${t}`);
    });
  };

  arr(doc.paths, 'paths');
  const pathOf = new Map(); // targetId → 路径路径
  (Array.isArray(doc.paths) ? doc.paths : []).forEach((pa, i) => {
    const p = `paths[${i}]`;
    if (!checkKeys(pa, p, PATH_KEYS, PATH_OPTIONAL)) return;
    claimId(pa.id, p);
    const hit = animRef(pa.target, `${p}.target`, PATH_TARGETS);
    if (hit) {
      if (hit.type === 'character' && hit.e.parent != null) err(`${p}.target`, `${fmt(pa.target)} 是群众成员，不能单独有路径（请给所在组 ${fmt(hit.e.parent)} 加路径）`);
      else if (pathOf.has(pa.target)) err(`${p}.target`, `${fmt(pa.target)} 已有路径 ${pathOf.get(pa.target)}，每个实体最多一条`);
      else pathOf.set(pa.target, p);
      if (posTracks.has(pa.target)) err(`${p}.target`, `${fmt(pa.target)} 已有 pos 轨道 ${posTracks.get(pa.target)}，路径与 pos 轨道不能共存`);
    }
    if (pa.points !== undefined) {
      if (!Array.isArray(pa.points) || pa.points.length < 2) err(`${p}.points`, `应为至少 2 个点的数组，实际为 ${Array.isArray(pa.points) ? `${pa.points.length} 个点` : fmt(pa.points)}`);
      else pa.points.forEach((pt, j) => vec3(pt, `${p}.points[${j}]`));
    }
    if (pa.interpolation !== undefined) oneOf(pa.interpolation, `${p}.interpolation`, ['centripetal', 'polyline'], '插值');
    bool(pa.closed, `${p}.closed`);
    time(pa.start, `${p}.start`);
    num(pa.duration, `${p}.duration`, { gt: 0 });
    oneOf(pa.speed, `${p}.speed`, PATH_SPEEDS, '速度曲线');
    oneOf(pa.orient, `${p}.orient`, PATH_ORIENTS, '朝向方式');
    checkStops(pa, p);
    if (pa.timedSegments !== undefined) {
      if (!Array.isArray(pa.timedSegments) || !pa.timedSegments.length) err(`${p}.timedSegments`, '应为非空分段数组');
      else {
        if (pa.stops?.length || pa.stopTimes?.length) err(`${p}.timedSegments`, '不能与 stops 同时使用');
        let lastPoint = 0, lastEnd = 0;
        pa.timedSegments.forEach((s, j) => {
          const q = `${p}.timedSegments[${j}]`;
          if (!checkKeys(s, q, ['from', 'to', 'start', 'end'])) return;
          if (s.from !== lastPoint || !Number.isInteger(s.to) || s.to <= s.from || s.to >= pa.points?.length) err(q, '顶点区间应连续、递增并覆盖路径');
          if (!isNum(s.start) || !isNum(s.end) || s.start < lastEnd || s.end <= s.start || s.end > pa.duration) err(q, '时段应递增且位于路径时长内');
          lastPoint = s.to; lastEnd = s.end;
        });
        if (lastPoint !== pa.points?.length - 1) err(`${p}.timedSegments`, '最后一段须到达终点');
      }
    }
    if (pa.waypointTimes !== undefined) {
      const times = pa.waypointTimes;
      if (pa.closed || pa.timedSegments || pa.stops?.length) err(`${p}.waypointTimes`, '仅开放、连续路径可设置节点时间');
      if (!Array.isArray(times) || times.length !== pa.points?.length) err(`${p}.waypointTimes`, '应为与路径顶点等长的时刻数组');
      else {
        times.forEach((value, j) => {
          if (!isNum(value) || (j === 0 ? value !== 0 : value <= times[j - 1]) || value > pa.duration) err(`${p}.waypointTimes[${j}]`, '应从 0 开始并严格递增，且不超过路径时长');
        });
        if (times.at(-1) !== pa.duration) err(`${p}.waypointTimes`, '末时刻应等于路径时长');
      }
    }
  });

  arr(doc.constraints, 'constraints');
  (Array.isArray(doc.constraints) ? doc.constraints : []).forEach((c, i) => {
    const p = `constraints[${i}]`;
    if (!checkKeys(c, p, CONSTRAINT_KEYS)) return;
    claimId(c.id, p);
    oneOf(c.type, `${p}.type`, CONSTRAINT_TYPES, '约束类型');
    animRef(c.target, `${p}.target`, ['camera']);
    if (Array.isArray(c.subject)) vec3(c.subject, `${p}.subject`);
    else if (c.subject !== undefined) {
      if (animRef(c.subject, `${p}.subject`, ENTITY_TYPES) && c.subject === c.target) err(`${p}.subject`, `不能是被约束的机位自己 ${fmt(c.target)}`);
    }
    vec3(c.offset, `${p}.offset`);
    if (c.start !== undefined) nullableTime(c.start, `${p}.start`);
    if (c.end !== undefined) nullableTime(c.end, `${p}.end`);
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
