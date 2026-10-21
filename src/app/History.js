import { Emitter } from '../util/Emitter.js';
import { applyPatches } from 'immer';

/** 事务补丁历史。同一同步操作合并为一步，拖动预览由编辑入口在松手时提交。 */
export class History extends Emitter {
  constructor(app, { limit = 100 } = {}) {
    super();
    this.app = app;
    this.limit = limit;
    this.entries = [];
    this.index = -1;
    this.enabled = false;
    this._pending = null;
    this._chain = Promise.resolve();
    app.store.on('change', (change) => {
      if (!this.enabled || !change.history) return;
      if (!this._pending) this._pending = { label: change.label, patches: [], inversePatches: [] };
      this._pending.patches.push(...change.patches);
      this._pending.inversePatches.unshift(...change.inversePatches);
      this.schedule();
    });
  }

  get canUndo() { return this.index > 0 || !!this._pending; }
  get canRedo() { return !this._pending && this.index < this.entries.length - 1; }

  reset() {
    clearTimeout(this._timer);
    this._timer = null;
    this._pending = null;
    this.entries = [{ label: '初始场景', patches: [], inversePatches: [] }];
    this.index = 0;
    this.enabled = true;
    this.emit('change', 'reset');
  }

  capture() {
    clearTimeout(this._timer);
    this._timer = null;
    if (!this.enabled || !this._pending) return false;
    this.entries.length = this.index + 1;
    this.entries.push(this._pending);
    this._pending = null;
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    // 首项只是可回退的边界，不需要保留已无法使用的补丁及资源引用。
    this.entries[0] = { label: '历史起点', patches: [], inversePatches: [] };
    this.index = this.entries.length - 1;
    this.emit('change', 'capture');
    return true;
  }

  schedule() {
    if (this._timer != null) return;
    this._timer = setTimeout(() => this.capture(), 0);
  }

  undo() { return this._go(-1); }
  redo() { return this._go(1); }

  _go(step) {
    const run = async () => {
      if (!this.enabled) return false;
      this.capture();
      const target = this.index + step;
      if (target < 0 || target >= this.entries.length) return false;
      const entry = this.entries[step < 0 ? this.index : target];
      const doc = applyPatches(this.app.store.document, step < 0 ? entry.inversePatches : entry.patches);
      try { await this.app.loadDocument(doc, { applyView: false, history: false, label: step < 0 ? '撤销' : '重做' }); }
      catch (err) { console.error('[history] 恢复失败', err); return false; }
      this.index = target;
      this.emit('change', step < 0 ? 'undo' : 'redo');
      return true;
    };
    const pending = this._chain.then(run, run);
    this._chain = pending.catch(() => {});
    return pending;
  }
}
