import { el, toast } from '../util/dom.js';
import { exportScene, loadSceneText } from '../app/SceneFile.js';

/** 状态始终可见；恢复只由用户点击触发，异步读盘不会抢走当前编辑。 */
export class SaveStatus {
  constructor(parent, app, autosave) {
    this.app = app;
    this.autosave = autosave;
    this.root = el('details', { class: 'save-status' });
    parent.appendChild(this.root);
    autosave.on('status', () => this.render());
    autosave.on('recovery', () => this.render());
    this.root.addEventListener('toggle', () => {
      if (this.root.open) void autosave.refreshRecovery().catch((err) => this.error(err));
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        app.history.capture();
        void autosave.save();
      }
    });
    this.render();
  }

  error(err) { toast('恢复点操作失败：' + err.message, { duration: 6000 }); }

  render() {
    const s = this.autosave, { status, savedAt, error } = s.state;
    const clock = (time) => new Date(time).toLocaleString('zh-CN', { hour12: false });
    const labels = { loading: '正在读取恢复点…', idle: '尚无新修改', dirty: '有未保存修改', saving: '正在保存…',
      saved: `已保存于 ${savedAt ? new Date(savedAt).toLocaleTimeString('zh-CN', { hour12: false }) : ''}`, error: '自动保存失败' };
    this.root.dataset.status = status;
    const count = s.candidates.length + s.invalid.length;
    const summary = el('summary', { text: labels[status] + (count ? ` · ${count} 个恢复点` : ''), 'aria-live': 'polite' });
    const panel = el('div', { class: 'save-panel' });
    if (error) panel.appendChild(el('p', { class: 'save-error', text: error + '。当前场景可手动导出；重试不会删除上次存档。' }));
    if (s.legacyWarning) panel.appendChild(el('p', { text: s.legacyWarning }));
    panel.appendChild(el('div', { class: 'save-actions' }, [
      el('button', { text: '导出场景', onclick: () => exportScene(this.app) }),
      el('button', { text: '重试保存', onclick: () => { this.app.history.capture(); void s.save(); } }),
      el('button', { text: '继续当前场景', onclick: () => { this.root.open = false; } }),
    ]));
    if (count) panel.appendChild(el('p', { text: '选择恢复点会替换当前场景，可撤销。其他页面的恢复点会独立保留。' }));
    for (const record of [...s.candidates, ...s.invalid]) {
      const valid = s.candidates.includes(record);
      const row = el('div', { class: 'save-recovery' }, [
        el('span', { text: `${clock(record.savedAt)}${valid ? '' : '（记录损坏或版本不支持）'}` }),
      ]);
      if (valid) row.appendChild(el('button', { text: '恢复场景', 'data-recovery-id': record.id,
        disabled: this.busy || null, onclick: () => void this.restore(record) }));
      row.appendChild(el('button', { text: '删除恢复点', disabled: this.busy || null,
        onclick: () => void s.dismiss(record).catch((err) => this.error(err)) }));
      panel.appendChild(row);
    }
    this.root.replaceChildren(summary, panel);
  }

  async restore(record) {
    if (this.busy || !this.app.ready || this.app.exporting || this.app.loadingDocument || this.app.pathEditor?.drag) return;
    this.busy = true;
    this.render();
    try {
      this.app.history.capture();
      // 当前编辑先落盘，恢复失败或资源损坏仍保留原场景与原恢复点。
      if (!await this.autosave.save()) throw new Error('请先导出当前场景或重试保存');
      if (await loadSceneText(this.app, record.text, { successMsg: '已恢复场景' })) {
        if (await this.autosave.save()) await this.autosave.dismiss(record);
        this.root.open = false;
      }
    } catch (err) { this.error(err); }
    finally { this.busy = false; this.render(); }
  }
}
