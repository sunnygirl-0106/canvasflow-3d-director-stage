// 场景 ↔ 文档。toDocument 读当前场景出一份文档；loadDocument 按文档重建场景。
// 实体各自实现 toJSON / static fromJSON(json, ctx)；这里只编排场景级字段与实体顺序。
import { SCHEMA_VERSION, APP_ID, DEFAULT_TIMELINE, validate, DocumentError } from './schema.js';
import { migrate } from './migrate.js';
import { Character } from '../entities/Character.js';
import { Prop } from '../entities/Prop.js';
import { CameraEntity } from '../entities/Camera.js';
import { Crowd } from '../entities/Crowd.js';

/* global __APP_VERSION__ */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

/** 文档 type → 实体类（文档词汇 group ↔ 代码类 Crowd）。 */
const ENTITY_CLASSES = { character: Character, prop: Prop, camera: CameraEntity, group: Crowd };

const clone = (v) => JSON.parse(JSON.stringify(v));

/** 预留字段（paths / constraints / timeline）的初始值；导入时整体替换为文档里的值并原样带出。 */
export function emptyReserved() {
  return { paths: [], constraints: [], timeline: clone(DEFAULT_TIMELINE) };
}

/** 导演相机视角（仅导入 / 恢复存档时应用，撤销忽略）。 */
function editorView(app) {
  const r6 = (v) => [v.x, v.y, v.z].map(round6);
  return { pos: r6(app.stage.camera.position), target: r6(app.rig.controls.target) };
}

/** 数值统一保留 6 位小数并消除 -0：度↔弧度、相对缩放的往返误差都在 1e-12 量级，舍入后导出→导入→导出严格相等。 */
export function round6(x) {
  const v = Math.round(x * 1e6) / 1e6;
  return v === 0 ? 0 : v;
}

/**
 * 当前场景 → 文档。
 * @param {{view?:boolean}} opts view=false 时 editorView 置 null（撤销快照用：视角不是场景内容）
 */
export function toDocument(app, { view = true } = {}) {
  const entities = [];
  for (const e of app.entities) {
    entities.push(e.toJSON());
    for (const m of e.children) entities.push(m.toJSON({ parent: e.id })); // 成员紧跟其组，顺序 = members 顺序
  }

  // 只导出被引用的资源（目前只有全景）
  const pano = app.panorama;
  const assets = {};
  let panorama = null;
  if (pano.active && pano.assetId) {
    assets[pano.assetId] = { ...pano.asset };
    panorama = { assetId: pano.assetId, rotation: round6(pano.rotation), radius: round6(pano.radius) };
  }

  const s = app.sceneState;
  const xyz = (o) => [o.x, o.y, o.z].map(round6);
  const reserved = clone(app.docReserved);
  // 预留字段里的机位引用可能随机位删除而悬空：置 null 保证导出的文档始终合法
  if (reserved.timeline.mainCameraId && !app.findCamera(reserved.timeline.mainCameraId)) reserved.timeline.mainCameraId = null;

  return {
    schema: SCHEMA_VERSION,
    meta: {
      name: app.docMeta.name,
      createdAt: app.docMeta.createdAt,
      updatedAt: new Date().toISOString(),
      app: `${APP_ID}@${APP_VERSION}`,
      editorView: view ? editorView(app) : null,
    },
    scene: {
      scale: round6(s.scale),
      pos: xyz(s.pos),
      rot: xyz(s.rot),
      sky: '#' + s.sky.toString(16).padStart(6, '0'),
      labels: s.labels,
      ground: { visible: s.ground.visible, opacity: round6(s.ground.opacity), height: round6(s.ground.height) },
      ratio: app.ratio,
      activeCameraId: app.findCamera(app.activeCameraId) ? app.activeCameraId : null,
      panorama,
    },
    assets,
    entities,
    paths: reserved.paths,
    constraints: reserved.constraints,
    timeline: reserved.timeline,
  };
}

/**
 * 文档 → 全部实体（尚未入场）。任一实体失败则销毁已建好的并抛错，保证不出现半个场景。
 * 群众成员由 group 的 fromJSON 负责创建，这里只建顶层实体，顺序 = 文档顺序。
 */
async function buildEntities(app, doc) {
  const byId = new Map(doc.entities.map((e) => [e.id, e]));
  const ctx = { app, assets: doc.assets, entity: (id) => byId.get(id) };
  const tops = doc.entities.filter((e) => !(e.type === 'character' && e.parent));
  const settled = await Promise.allSettled(tops.map((json) => ENTITY_CLASSES[json.type].fromJSON(json, ctx)));
  const failed = settled.find((r) => r.status === 'rejected');
  if (failed) {
    for (const r of settled) if (r.status === 'fulfilled') r.value.dispose();
    throw failed.reason;
  }
  return settled.map((r) => r.value);
}

/**
 * 校验并加载文档：migrate → validate → 预建实体 / 预载全景 → 一次性替换当前场景。
 * 不合法或任何资源加载失败都抛错，当前场景保持原样。
 * @param {object} input 文档（不会被修改）
 * @param {{applyView?:boolean, pruneShots?:boolean}} opts
 *   applyView：应用 meta.editorView（导入 / 恢复存档时为 true，撤销为 false）
 *   pruneShots：清掉找不到机位的截图（导入别的场景时为 true）
 */
export async function loadDocument(app, input, opts = {}) {
  const doc = migrate(input);
  const { ok, errors } = validate(doc);
  if (!ok) throw new DocumentError(errors);
  const panoRef = doc.scene.panorama && { id: doc.scene.panorama.assetId, ...doc.assets[doc.scene.panorama.assetId] };
  const [ents, pano] = await Promise.allSettled([buildEntities(app, doc), app.panorama.prepare(panoRef)]);
  if (ents.status === 'rejected' || pano.status === 'rejected') {
    if (ents.status === 'fulfilled') ents.value.forEach((e) => e.dispose());
    if (pano.status === 'fulfilled') pano.value?.discard();
    throw ents.reason || pano.reason;
  }
  app._commitDocument(doc, ents.value, pano.value, opts);
  return doc;
}
