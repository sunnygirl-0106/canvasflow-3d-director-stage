import { Emitter } from '../util/Emitter.js';

/**
 * 撤销 / 重做：场景文档快照栈。
 * - 快照 = toDocument({view:false}) 去掉 updatedAt 与 assets 后的 JSON 字符串；与栈顶相同则不入栈
 *   （天然过滤"点了但没改"，也让拖动只在松手时记一步）。
 * - assets（可能是几 MB 的 dataURL）按 id 单独缓存，快照里只留引用。
 * - 撤销 = app.loadDocument(上一份)。导演视角、视图模式、选中都是会话态，不随撤销变化。
 * 事件：'change'(reason) —— 栈变化，reason ∈ 'reset' | 'capture' | 'undo' | 'redo'；自动保存据此触发。
 */
export class History extends Emitter {
  constructor(app, { limit = 100 } = {}) {
    super();
    this.app = app;
    this.limit = limit;
    this.entries = [];   // JSON 字符串
    this.index = -1;     // 当前状态在 entries 里的位置
    this.enabled = false; // 种子场景加载完成后由 reset() 打开
    this._assets = new Map(); // assetId → asset
    this._restoring = 0;      // 进行中的撤销/重做加载数（排队期间 loadingDocument 可能还没置位）
  }

  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.entries.length - 1; }

  _snapshot() {
    const doc = this.app.toDocument({ view: false });
    doc.meta.updatedAt = '';
    for (const [id, a] of Object.entries(doc.assets)) this._assets.set(id, a);
    doc.assets = {};
    return JSON.stringify(doc);
  }

  /** 以当前场景为唯一起点清空栈（启动完成时）。 */
  reset() {
    this.enabled = true;
    this._assets.clear();
    this.entries = [this._snapshot()];
    this.index = 0;
    this.emit('change', 'reset');
  }

  /** 记录一步（当前状态与栈顶相同则忽略）。加载文档期间不记录。返回是否入栈。 */
  capture() {
    if (!this.enabled || this._restoring || this.app.loadingDocument) return false;
    const snap = this._snapshot();
    if (snap === this.entries[this.index]) return false;
    this.entries.length = this.index + 1; // 丢弃重做分支
    this.entries.push(snap);
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    this.index = this.entries.length - 1;
    this._gcAssets();
    this.emit('change', 'capture');
    return true;
  }

  /** 同一帧内多处触发只记一次：等当前事件处理链全部结束后再快照。 */
  schedule() {
    if (this._pending) return;
    this._pending = true;
    setTimeout(() => { this._pending = false; this.capture(); }, 0);
  }

  undo() { return this._go(-1); }
  redo() { return this._go(1); }

  async _go(step) {
    if (!this.enabled) return false;
    this.capture(); // 先收下尚未记录的改动（如刚改完还没触发记录），避免被撤销直接吞掉
    const target = this.index + step;
    if (target < 0 || target >= this.entries.length) return false;
    this.index = target; // 同步推进：连按多次撤销按顺序排队加载
    this.emit('change', step < 0 ? 'undo' : 'redo');
    const doc = JSON.parse(this.entries[target]);
    doc.meta.updatedAt = new Date().toISOString();
    const pano = doc.scene.panorama;
    if (pano) doc.assets = { [pano.assetId]: this._assets.get(pano.assetId) };
    this._restoring++;
    try { await this.app.loadDocument(doc, { applyView: false }); }
    catch (err) { console.error('[history] 恢复快照失败', err); return false; }
    finally { this._restoring--; }
    return true;
  }

  /** 丢掉不再被任何快照引用的资源缓存。 */
  _gcAssets() {
    if (!this._assets.size) return;
    const used = new Set();
    for (const s of this.entries) {
      const m = /"panorama":\{"assetId":"([^"]+)"/.exec(s);
      if (m) used.add(m[1]);
    }
    for (const id of this._assets.keys()) if (!used.has(id)) this._assets.delete(id);
  }
}
