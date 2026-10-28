// @ts-check
// 加载已校验文档：预建资源后原子发布到 Store 和运行时。
// 实体各自实现 toJSON / static fromJSON(json, ctx)；这里只编排场景级字段与实体顺序。
import { checkRequestState } from '../util/requestGuard.js';
import { validate, DocumentError } from './schema.js';
import { migrate } from './migrate.js';
import { Character } from '../entities/Character.js';
import { Prop } from '../entities/Prop.js';
import { CameraEntity } from '../entities/Camera.js';
import { Crowd } from '../entities/Crowd.js';
import { fitPathToDuration } from '../anim/pathGen.js';

/* global __APP_VERSION__ */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

/** 文档 type → 实体类（文档词汇 group ↔ 代码类 Crowd）。 */
const ENTITY_CLASSES = { character: Character, prop: Prop, camera: CameraEntity, group: Crowd };

/**
 * 文档 → 全部顶层实体（尚未入场），顺序 = 文档顺序；群众成员由 group 负责。
 * 当前场景里同 id、结构没变的顶层实体直接复用（提交时 applyJSON 原地套用），其余新建。
 * 任一新建失败则销毁已新建的并抛错，保证不出现半个场景。
 * apply：提交时依次调用，把文档值写进复用的实体
 */
async function buildEntities(app, doc) {
  const byId = new Map(doc.entities.map((e) => [e.id, e]));
  const ctx = { app, assets: doc.assets, entity: (id) => byId.get(id) };
  const tops = doc.entities.filter((e) => !(e.type === 'character' && e.parent));
  const reusable = (json) => {
    const old = app.entities.find((e) => e.id === json.id); // 只在顶层里找：原来是组成员的不复用
    return old && old.canApply(json, ctx) ? old : null;
  };
  const apply = [];
  const reused = new Set();
  const settled = await Promise.allSettled(tops.map((json) => {
    const old = reusable(json);
    if (!old) return ENTITY_CLASSES[json.type].fromJSON(json, ctx);
    reused.add(old);
    apply.push(() => old.applyJSON(json, ctx));
    return old;
  }));
  const fulfilled = settled.filter((r) => r.status === 'fulfilled');
  const fresh = fulfilled.filter((r) => !reused.has(r.value)).map((r) => r.value);
  const failed = settled.find((r) => r.status === 'rejected');
  if (failed) {
    fresh.forEach((e) => e.dispose());
    throw failed.reason;
  }
  return { entities: fulfilled.map((r) => r.value), fresh, apply };
}

/**
 * 校验并加载文档：migrate → validate → 预建实体 / 预载全景 → 一次性替换当前场景。
 * 不合法或任何资源加载失败都抛错，当前场景保持原样。
 * @param {object} input 文档（不会被修改）
 * @param {{applyView?:boolean, pruneShots?:boolean, label?:string, history?:boolean, expectedRevision?:number, signal?:AbortSignal}} opts
 *   applyView：应用 meta.editorView（导入 / 恢复存档时为 true，撤销为 false）
 *   pruneShots：清掉找不到机位的截图（导入别的场景时为 true）
 */
export async function loadDocument(app, input, opts = {}) {
  checkRequestState(app.store, opts);
  const doc = migrate(input);
  const { ok, errors } = validate(doc);
  if (!ok) throw new DocumentError(errors);
  // 兼容旧存档中超过场景终点的轨迹：保留几何路线，加载时适配总时长。
  doc.paths = doc.paths.map((p) => fitPathToDuration(p, doc.timeline.duration));
  const view = doc.meta.editorView;
  doc.meta.editorView = null;
  doc.meta.updatedAt = app.store.document.meta.updatedAt;
  const revision = app.store.revision;
  const change = app.store.prepareReplacement(opts.label || '加载文档', doc);
  const panoRef = doc.scene.panorama && { id: doc.scene.panorama.assetId, ...doc.assets[doc.scene.panorama.assetId] };
  const [ents, pano] = await Promise.allSettled([buildEntities(app, doc), app.panorama.prepare(panoRef)]);
  if (ents.status === 'rejected' || pano.status === 'rejected') {
    if (ents.status === 'fulfilled') ents.value.fresh.forEach((e) => e.dispose());
    if (pano.status === 'fulfilled') pano.value?.discard();
    checkRequestState(app.store, { expectedRevision: opts.expectedRevision ?? revision, signal: opts.signal });
    throw (ents.status === 'rejected' ? ents.reason : undefined) || (pano.status === 'rejected' ? pano.reason : undefined);
  }
  const { entities, apply } = ents.value;
  try {
    checkRequestState(app.store, { expectedRevision: opts.expectedRevision ?? revision, signal: opts.signal });
  } catch (err) {
    ents.value.fresh.forEach((e) => e.dispose());
    pano.value?.discard();
    throw err;
  }
  const commit = () => app.documents.commitRuntime({ ...doc, meta: { ...doc.meta, editorView: view } }, entities, pano.value, { ...opts, apply });
  if (change) app.store.commit(change, { apply: commit, history: opts.history !== false });
  else commit();
  return doc;
}
