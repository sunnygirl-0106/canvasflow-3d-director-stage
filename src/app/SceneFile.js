import { AutosaveRepository, STORAGE_VERSION } from './AutosaveRepository.js';
import { Emitter } from '../util/Emitter.js';
import { migrate } from '../doc/migrate.js';
import { validate } from '../doc/schema.js';
import { toast } from '../util/dom.js';
import { downloadURL } from './ShotManager.js';

// 场景文件：导出 / 导入 .json，以及 IndexedDB 自动保存与主动恢复。

export const AUTOSAVE_KEY = 'director-stage:autosave';
const AUTOSAVE_DELAY = 1000;

const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

/** 导出当前场景为 .json 下载。 */
export function exportScene(app) {
  const doc = app.exportDocument();
  const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
  downloadURL(url, `${doc.meta.name || '场景'}-${stamp()}.json`);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('已导出场景');
}

/**
 * 文本 → 迁移 → 校验 → 加载（导入 / 恢复共用）。
 * 不合法：toast 前 3 条错误并拒绝，场景不变。成功后记一份撤销快照作为新的起点（可撤销回导入前）。
 * @returns {Promise<boolean>}
 */
export async function loadSceneText(app, text, { successMsg = '已导入场景' } = {}) {
  let raw;
  try { raw = JSON.parse(text); }
  catch { toast('导入失败：不是有效的 JSON 文件'); return false; }
  const doc = migrate(raw);
  const { ok, errors } = validate(doc);
  if (!ok) {
    const more = errors.length > 3 ? `\n…共 ${errors.length} 处错误` : '';
    toast('场景文件不合法，已拒绝导入：\n' + errors.slice(0, 3).join('\n') + more, { duration: 6000 });
    console.warn('[scene] 校验失败', errors);
    return false;
  }
  try {
    await app.loadDocument(doc, { applyView: true, pruneShots: true });
  } catch (err) {
    console.error(err);
    toast('导入失败：' + (err?.message || err));
    return false;
  }
  app.history.capture();
  toast(successMsg);
  return true;
}

/** 弹出文件选择并导入。 */
export function pickAndImportScene(app) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    let text;
    try { text = await f.text(); }
    catch { toast('导入失败：无法读取文件'); return; }
    await loadSceneText(app, text);
  });
  input.click();
}

/** 已提交历史 → 防抖 → 单写队列。预览、启动 reset 不进入恢复点。 */
export class AutoSave extends Emitter {
  constructor(app, { repository = new AutosaveRepository(), legacyStorage = { getItem: (key) => globalThis.localStorage.getItem(key) },
    sessionId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`, delay = AUTOSAVE_DELAY } = {}) {
    super();
    this.app = app;
    this.repository = repository;
    this.legacyStorage = legacyStorage;
    this.sessionId = sessionId;
    this.delay = delay;
    this.sequence = 0;
    this.savedSequence = 0;
    this.state = { status: 'loading', savedAt: null, error: null };
    this.candidates = [];
    this.invalid = [];
    this._timer = null;
    this._running = null;
    app.history.on('change', (reason) => { if (reason !== 'reset') this.schedule(); });
    this.ready = this._initialize();
  }

  _state(status, extra = {}) {
    this.state = { ...this.state, status, error: null, ...extra };
    this.emit('status', this.state);
  }

  async _initialize() {
    try {
      // 先读取，确保已建立存储连接；没有恢复决策也不会覆盖其他会话。
      await this.refreshRecovery();
      let legacy;
      try { legacy = this.legacyStorage?.getItem(AUTOSAVE_KEY); } catch { /* IDB 仍可用 */ }
      if (legacy) {
        const doc = recoveryDocument(legacy);
        if (doc) await this.repository.migrateLegacy({
          id: 'legacy', sessionId: 'legacy', sequence: 1, storageVersion: STORAGE_VERSION,
          savedAt: doc.meta.updatedAt || new Date().toISOString(), text: JSON.stringify(doc),
        });
        else this.legacyWarning = '旧恢复点损坏，已跳过；原记录仍保留';
      }
      await this.refreshRecovery();
      this.initialized = true;
      this._state(this.sequence > this.savedSequence ? 'dirty' : 'idle');
      return true;
    } catch (err) {
      this.initialized = false;
      this._state('error', { error: err.message || String(err) });
      return false;
    }
  }

  async refreshRecovery() {
    const rows = (await this.repository.readRecovery()).filter((row) => row.id !== this.sessionId);
    this.candidates = [];
    this.invalid = [];
    for (const row of rows) {
      if (row.storageVersion === STORAGE_VERSION && recoveryDocument(row.text)) this.candidates.push(row);
      else this.invalid.push(row);
    }
    const signature = JSON.stringify(rows.map(({ id, sequence, savedAt }) => [id, sequence, savedAt]));
    if (signature !== this._recoverySignature) {
      this._recoverySignature = signature;
      this.emit('recovery');
    }
  }

  schedule() {
    this.sequence++;
    this._state('dirty');
    this._scheduleTimer();
  }

  _scheduleTimer() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => { this._timer = null; void this.save(); }, this.delay);
  }

  save() {
    clearTimeout(this._timer);
    this._timer = null;
    if (!this._running) this._running = this._drain().finally(() => { this._running = null; });
    return this._running;
  }

  async _drain() {
    await this.ready;
    if (!this.initialized && !await this._initialize()) return false;
    while (this.savedSequence < this.sequence) {
      // 新三维节点拖动仍在预览中：延后，不把临时值或编辑视角写进存档。
      if (this.app.loadingDocument || this.app.pathEditor?.drag) { this._scheduleTimer(); return false; }
      const sequence = this.sequence;
      this._state('saving');
      try {
        const snapshot = { id: this.sessionId, sessionId: this.sessionId, sequence,
          storageVersion: STORAGE_VERSION, savedAt: new Date().toISOString(),
          text: JSON.stringify(this.app.exportDocument()) };
        await this.repository.writeSnapshot(snapshot);
        this.savedSequence = sequence;
        this._state(this.savedSequence === this.sequence ? 'saved' : 'dirty', { savedAt: snapshot.savedAt });
      } catch (err) {
        this._state('error', { error: err.message || String(err) });
        return false; // 保留脏状态和上次成功快照，等待下一次编辑或用户重试。
      }
    }
    return true;
  }

  async dismiss(record) {
    await this.repository.clearRecovery(record.id, record);
    await this.refreshRecovery();
  }
}

/** 读取候选只校验，不加载资源、不改变场景；真正恢复仍走 loadSceneText。 */
function recoveryDocument(text) {
  try {
    const doc = migrate(JSON.parse(text));
    return validate(doc).ok ? doc : null;
  } catch { return null; }
}
