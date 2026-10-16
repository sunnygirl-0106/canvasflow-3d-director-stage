import { migrate } from '../doc/migrate.js';
import { validate } from '../doc/schema.js';
import { toast } from '../util/dom.js';
import { downloadURL } from './ShotManager.js';

// 场景文件：导出 / 导入 .json，以及 localStorage 自动保存与启动恢复。

export const AUTOSAVE_KEY = 'director-stage:autosave';
const AUTOSAVE_MAX_BYTES = 4 * 1024 * 1024; // 超过即不写（localStorage 上限约 5MB，且全景 dataURL 很大）
const AUTOSAVE_DELAY = 1000;

const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

/** 导出当前场景为 .json 下载。 */
export function exportScene(app) {
  const doc = app.toDocument();
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

/**
 * 自动保存：撤销栈每次变化（记录 / 撤销 / 重做）后防抖 1s 写 localStorage。
 * 启动时的 reset 不写，避免在用户决定是否恢复前覆盖上次存档。
 */
export class AutoSave {
  constructor(app) {
    this.app = app;
    this._timer = null;
    this._warnedLarge = false;
    app.history.on('change', (reason) => { if (reason !== 'reset') this.schedule(); });
  }

  schedule() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.save(), AUTOSAVE_DELAY);
  }

  save() {
    if (this.app.loadingDocument) { this.schedule(); return; }
    try {
      const text = JSON.stringify(this.app.toDocument());
      if (new Blob([text]).size > AUTOSAVE_MAX_BYTES) {
        if (!this._warnedLarge) toast('场景含大图，未自动保存，请手动导出');
        this._warnedLarge = true;
        return;
      }
      this._warnedLarge = false;
      localStorage.setItem(AUTOSAVE_KEY, text);
    } catch (err) {
      console.warn('[autosave] 写入失败', err);
    }
  }

  /** 读取上次存档（没有或读取失败返回 null）。 */
  static read() {
    try { return localStorage.getItem(AUTOSAVE_KEY); }
    catch { return null; }
  }

  /** 启动时：有存档则 toast 提供「恢复上次场景」按钮（不自动恢复）。 */
  static offerRestore(app) {
    const text = AutoSave.read();
    if (!text) return;
    let when = '';
    try {
      const d = new Date(JSON.parse(text)?.meta?.updatedAt);
      if (!Number.isNaN(d.getTime())) when = `（${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}）`;
    } catch { /* 存档损坏：仍提供按钮，点了由校验报错 */ }
    toast('发现上次的场景' + when, {
      action: { label: '恢复上次场景', onClick: () => loadSceneText(app, text, { successMsg: '已恢复上次场景' }) },
    });
  }
}
