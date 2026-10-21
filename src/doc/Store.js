import { enablePatches, produceWithPatches, applyPatches, freeze } from 'immer';
import { Emitter } from '../util/Emitter.js';
import { clone } from '../util/math.js';
import { createEmptyDocument, validate, DocumentError } from './schema.js';

enablePatches();

/** 把普通 JSON 写进 draft；相同字段不赋值，保留引用与细粒度补丁。 */
export function updateDraft(target, source) {
  for (const key of Object.keys(target)) if (!(key in source)) delete target[key];
  for (const key of Object.keys(source)) {
    const a = target[key], b = source[key];
    if (a === b) continue;
    if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
      if (Array.isArray(a)) {
        while (a.length > b.length) a.pop();
        for (let i = 0; i < b.length; i++) {
          if (a[i] && b[i] && typeof a[i] === 'object' && typeof b[i] === 'object' && Array.isArray(a[i]) === Array.isArray(b[i])) updateDraft(a[i], b[i]);
          else if (a[i] !== b[i]) a[i] = clone(b[i]);
        }
      } else updateDraft(a, b);
    } else target[key] = clone(b);
  }
}

/** 唯一的已提交文档。只持有 JSON；渲染对象、预览与历史由应用层编排。 */
export class DocumentStore extends Emitter {
  constructor(document = createEmptyDocument()) {
    super();
    this._validate(document);
    this._document = freeze(clone(document), true);
    this.revision = 0;
  }

  get document() { return this._document; }

  _validate(doc) {
    const result = validate(doc);
    if (!result.ok) throw new DocumentError(result.errors);
  }

  /** 生成候选版本，不发布。异步加载资源后必须用 commit 检查版本。 */
  prepare(label, recipe) {
    const before = this.document;
    const [after, patches, inversePatches] = produceWithPatches(before, (draft) => {
      const result = recipe(draft);
      if (result?.then) throw new Error('文档事务必须同步执行，请先准备资源');
    });
    if (!patches.length) return null;
    this._validate(after);
    return { label, before, after, patches, inversePatches, revision: this.revision };
  }

  assertCurrent(change) {
    if (change && (change.revision !== this.revision || change.before !== this.document)) {
      throw new Error('准备期间场景已被修改，请重试');
    }
  }

  /** apply 必须同步；在发布文档和通知历史之前完成运行时更新。 */
  commit(change, { apply, history = true } = {}) {
    if (!change) return false;
    this.assertCurrent(change);
    apply?.(change.after, change.before);
    this._document = change.after;
    this.revision++;
    this.emit('change', { ...change, history });
    return true;
  }

  transact(label, recipe, options) { return this.commit(this.prepare(label, recipe), options); }

  prepareReplacement(label, document) { return this.prepare(label, (draft) => updateDraft(draft, document)); }

  preparePatches(label, patches) {
    const after = applyPatches(this.document, patches);
    this._validate(after);
    return { label, before: this.document, after, patches, inversePatches: [], revision: this.revision };
  }
}
