// 存储格式与场景 schema 独立。每个页面拥有自己的恢复点，事务完成才算保存。
export const AUTOSAVE_DB = 'director-stage-recovery';
export const STORAGE_VERSION = 1;
export const MAX_RECOVERY_SESSIONS = 20;

export class AutosaveRepository {
  constructor({ indexedDB = globalThis.indexedDB, name = AUTOSAVE_DB } = {}) {
    this.indexedDB = indexedDB;
    this.name = name;
    this._db = null;
  }

  async open() {
    if (this._db) return this._db;
    this._db = new Promise((resolve, reject) => {
      if (!this.indexedDB) { reject(new Error('浏览器存储不可用')); return; }
      const request = this.indexedDB.open(this.name, 1);
      let abandoned = false;
      const failOpen = (err) => { abandoned = true; reject(err); };
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('snapshots', { keyPath: 'id' });
        db.createObjectStore('meta');
      };
      request.onerror = () => failOpen(request.error);
      request.onblocked = () => failOpen(new Error('存储升级被其他页面阻止，请关闭旧页面后重试'));
      request.onsuccess = () => {
        const db = request.result;
        if (abandoned) { db.close(); return; }
        db.onversionchange = () => { db.close(); this._db = null; };
        resolve(db);
      };
    }).catch((err) => { this._db = null; throw err; });
    return this._db;
  }

  async _transaction(stores, mode, operation) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result, failure;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure || tx.error || new Error('存储事务中断'));
      tx.onerror = () => {}; // abort 是唯一失败出口
      const fail = (err) => { failure = err; tx.abort(); };
      try { operation(tx, (value) => { result = value; }, fail); }
      catch (err) { fail(err); }
    });
  }

  readRecovery() {
    return this._transaction(['snapshots'], 'readonly', (tx, done) => {
      const req = tx.objectStore('snapshots').getAll();
      req.onsuccess = () => done(req.result.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt))));
    });
  }

  writeSnapshot(snapshot) {
    return this._transaction(['snapshots'], 'readwrite', (tx, done, fail) => {
      const store = tx.objectStore('snapshots');
      const req = store.get(snapshot.id);
      req.onsuccess = () => {
        if (req.result && req.result.sequence >= snapshot.sequence) { done(req.result); return; }
        const count = store.count();
        count.onsuccess = () => {
          if (!req.result && count.result >= MAX_RECOVERY_SESSIONS) {
            fail(new Error('恢复点已满，请在保存状态中处理旧恢复点后重试')); return;
          }
          store.put(snapshot);
          done(snapshot);
        };
      };
    });
  }

  // 只删除用户看到的那一版，不能删除另一标签页刚刚更新的快照。
  clearRecovery(id, expected) {
    return this._transaction(['snapshots'], 'readwrite', (tx, done) => {
      const store = tx.objectStore('snapshots');
      const req = store.get(id);
      req.onsuccess = () => {
        const value = req.result;
        const same = value && value.sequence === expected.sequence && value.savedAt === expected.savedAt;
        if (same) store.delete(id);
        done(!!same);
      };
    });
  }

  // 标记与快照原子提交，失败或跨标签页竞争不会重复迁移；旧 localStorage 键由调用方保留。
  migrateLegacy(snapshot) {
    return this._transaction(['snapshots', 'meta'], 'readwrite', (tx, done, fail) => {
      const meta = tx.objectStore('meta');
      const req = meta.get('legacyMigrated');
      req.onsuccess = () => {
        if (req.result) { done(false); return; }
        const store = tx.objectStore('snapshots');
        const count = store.count();
        count.onsuccess = () => {
          if (count.result >= MAX_RECOVERY_SESSIONS) { fail(new Error('恢复点已满，旧存档尚未迁移')); return; }
          store.put(snapshot);
          meta.put(true, 'legacyMigrated');
          done(true);
        };
      };
    });
  }
}
