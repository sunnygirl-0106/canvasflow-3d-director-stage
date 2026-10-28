// @ts-check
import { migrate } from '../doc/migrate.js';
import { validate } from '../doc/schema.js';
import { toast } from '../util/dom.js';
import { downloadURL } from './ShotManager.js';

// 场景文件：导出 / 导入 .json。

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
 * 文本 → 迁移 → 校验 → 加载。
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
