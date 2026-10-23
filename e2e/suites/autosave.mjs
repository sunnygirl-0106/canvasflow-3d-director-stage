import fs from 'node:fs';
import path from 'node:path';
import { browser, page, URL_, ok } from '../harness.mjs';

export async function run() {
  const OUT = 'test-output/autosave';
  fs.mkdirSync(OUT, { recursive: true });
  const saved = await page.evaluate(async () => {
    const a = window.__app, s = a.autosave;
    await s.ready;
    const before = await s.repository.readRecovery();
    a.timeline.setDuration(17); a.history.capture(); await s.save();
    const row = (await s.repository.readRecovery()).find((r) => r.id === s.sessionId);
    return { id: row.id, duration: JSON.parse(row.text).timeline.duration, state: s.state.status, initial: before.length };
  });
  ok('启动 reset 不存档；提交修改写入真实 IndexedDB', saved.initial === 0 && saved.duration === 17 && saved.state === 'saved', JSON.stringify(saved));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__app?.ready && window.__app.autosave.initialized);
  const pending = await page.evaluate(() => ({ duration: window.__app.timeline.duration, count: window.__app.autosave.candidates.length }));
  ok('刷新只提供恢复点，场景不会被异步读取自动替换', pending.duration === 10 && pending.count === 1, JSON.stringify(pending));
  await page.click('.save-status summary');
  await page.click(`[data-recovery-id="${saved.id}"]`);
  await page.waitForFunction(() => window.__app.timeline.duration === 17 && window.__app.autosave.state.status === 'saved');
  ok('真实点击恢复成功，恢复经原子加载且可撤销', await page.evaluate(() => window.__app.history.canUndo));
  const history = await page.evaluate(async () => {
    const a = window.__app, s = a.autosave;
    await a.history.undo(); await s.save();
    const read = async () => JSON.parse((await s.repository.readRecovery()).find((r) => r.id === s.sessionId).text).timeline.duration;
    const undo = await read(); await a.history.redo(); await s.save();
    return { undo, redo: await read() };
  });
  ok('撤销/重做分别持久化最新提交', history.undo === 10 && history.redo === 17, JSON.stringify(history));

  // 噪声 PNG 为有效 2:1 大图，禁止用伪造 dataURL 或无效资源凑体积。
  const big = await page.evaluate(async () => {
    const a = window.__app, s = a.autosave;
    const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 1024;
    const ctx = cv.getContext('2d'), data = ctx.createImageData(cv.width, cv.height);
    let seed = 123456789;
    for (let i = 0; i < data.data.length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      data.data[i] = i % 4 === 3 ? 255 : seed & 255;
    }
    ctx.putImageData(data, 0, 0);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    await a.panorama.setFromFile(new File([blob], 'recovery-2to1.png', { type: 'image/png' }));
    a.history.capture(); await s.save();
    const row = (await s.repository.readRecovery()).find((r) => r.id === s.sessionId);
    return { id: row.id, bytes: new Blob([row.text]).size, active: a.panorama.active };
  });
  ok('有效 2:1 大图使场景超过 4 MiB，仍可自动保存', big.bytes > 4 * 1024 * 1024 && big.active, JSON.stringify(big));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__app?.ready && window.__app.autosave.initialized);
  await page.click('.save-status summary');
  await page.click(`[data-recovery-id="${big.id}"]`);
  await page.waitForFunction(() => window.__app.panorama.active && window.__app.autosave.state.status === 'saved', { timeout: 30000 });
  ok('大图刷新恢复：资源完整且保存状态正确', await page.evaluate(() => window.__app.panorama.asset.name === 'recovery-2to1.png'));

  const failures = await page.evaluate(async () => {
    const a = window.__app, s = a.autosave, repo = s.repository;
    const write = repo.writeSnapshot.bind(repo);
    const read = async () => (await repo.readRecovery()).find((r) => r.id === s.sessionId);
    const before = await read();
    repo.writeSnapshot = async () => { throw new DOMException('测试配额不足', 'QuotaExceededError'); };
    a.timeline.setDuration(19); a.history.capture(); await s.save();
    const quota = s.state.status === 'error' && (await read()).sequence === before.sequence;
    repo.writeSnapshot = (snapshot) => repo._transaction(['snapshots'], 'readwrite', (tx) => {
      tx.objectStore('snapshots').put(snapshot); tx.abort();
    });
    await s.save();
    const aborted = s.state.status === 'error' && (await read()).sequence === before.sequence;
    repo.writeSnapshot = write;
    return { quota, aborted, exportVisible: [...document.querySelectorAll('.save-panel button')].some((b) => b.textContent === '导出场景') };
  });
  ok('配额与真实事务中断保留上次快照，并提供手动导出', failures.quota && failures.aborted && failures.exportVisible, JSON.stringify(failures));
  const downloads = path.resolve(`${OUT}/downloads`);
  fs.mkdirSync(downloads, { recursive: true });
  const cdp = await browser.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await page.click('.save-status summary');
  await page.evaluate(() => [...document.querySelectorAll('.save-panel button')].find((b) => b.textContent === '导出场景').click());
  for (let i = 0; i < 100 && !fs.readdirSync(downloads).some((f) => f.endsWith('.json')); i++) await new Promise((r) => setTimeout(r, 100));
  const file = fs.readdirSync(downloads).find((f) => f.endsWith('.json'));
  ok('保存失败后仍能下载完整场景 JSON', !!file && JSON.parse(fs.readFileSync(path.join(downloads, file))).timeline.duration === 19);
  await page.evaluate(() => window.__app.autosave.save());
  ok('重试成功恢复已保存状态', await page.evaluate(() => window.__app.autosave.state.status === 'saved'));

  const other = await browser.newPage();
  try {
    await other.goto(URL_, { waitUntil: 'networkidle0' });
    await other.waitForFunction(() => window.__app?.ready && window.__app.autosave.initialized);
    const own = await page.evaluate(() => window.__app.autosave.sessionId);
    const stale = await other.evaluate(async (own) => {
      const a = window.__app; a.timeline.setDuration(23); a.history.capture(); await a.autosave.save();
      return (await a.autosave.repository.readRecovery()).find((r) => r.id === own);
    }, own);
    await page.evaluate(async () => { const a = window.__app; a.timeline.setDuration(21); a.history.capture(); await a.autosave.save(); });
    const tabs = await other.evaluate(async ({ own, stale }) => {
      const s = window.__app.autosave;
      const deleted = await s.repository.clearRecovery(own, stale);
      const rows = await s.repository.readRecovery();
      return { deleted, first: JSON.parse(rows.find((r) => r.id === own).text).timeline.duration,
        second: JSON.parse(rows.find((r) => r.id === s.sessionId).text).timeline.duration };
    }, { own, stale });
    ok('双标签页各自保留快照；旧界面不能删除另一页刚更新的记录', !tabs.deleted && tabs.first === 21 && tabs.second === 23, JSON.stringify(tabs));
  } finally { await other.close(); }

  const legacy = await page.evaluate(async () => {
    const a = window.__app;
    a.panorama.clear(); a.timeline.setDuration(27); a.history.capture(); await a.autosave.save();
    const text = JSON.stringify(a.exportDocument());
    localStorage.setItem('director-stage:autosave', text);
    return text;
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__app?.ready && window.__app.autosave.initialized);
  const migrated = await page.evaluate(async (legacy) => {
    const s = window.__app.autosave, row = (await s.repository.readRecovery()).find((r) => r.id === 'legacy');
    await s.repository.clearRecovery('legacy', row);
    return { duration: JSON.parse(row.text).timeline.duration, original: localStorage.getItem('director-stage:autosave') === legacy };
  }, legacy);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__app?.ready && window.__app.autosave.initialized);
  const once = await page.evaluate(async () => !(await window.__app.autosave.repository.readRecovery()).some((r) => r.id === 'legacy'));
  ok('旧存档验证迁移一次；删除候选后不重复迁移，旧键保留回退', migrated.duration === 27 && migrated.original && once, JSON.stringify(migrated));
  await page.evaluate(async () => {
    const s = window.__app.autosave;
    await s.repository.writeSnapshot({ id: 'broken', sequence: 1, savedAt: new Date().toISOString(), storageVersion: 1, text: '{bad' });
    localStorage.setItem('director-stage:autosave', '{broken');
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__app?.ready && window.__app.autosave.initialized);
  ok('损坏旧键与新记录可跳过，不阻断启动，仍可管理恢复点', await page.evaluate(() => window.__app.autosave.invalid.length === 1 && !!window.__app.autosave.legacyWarning));
  await page.click('.save-status summary');
  await page.screenshot({ path: `${OUT}/recovery.png` });

  const bounded = await page.evaluate(async () => {
    const { AutosaveRepository, MAX_RECOVERY_SESSIONS } = await import('/src/app/AutosaveRepository.js');
    const repo = new AutosaveRepository({ name: 'autosave-cap-test' });
    const snapshot = (id, sequence = 1) => ({ id, sessionId: id, sequence, savedAt: new Date().toISOString(), storageVersion: 1, text: '{}' });
    for (let i = 0; i < MAX_RECOVERY_SESSIONS; i++) await repo.writeSnapshot(snapshot(`s${i}`));
    let full = false, migrationFull = false;
    try { await repo.writeSnapshot(snapshot('overflow')); } catch { full = true; }
    try { await repo.migrateLegacy(snapshot('legacy')); } catch { migrationFull = true; }
    const unchanged = (await repo.readRecovery()).length === MAX_RECOVERY_SESSIONS;
    const old = (await repo.readRecovery()).find((r) => r.id === 's0');
    await repo.writeSnapshot(snapshot('s0', 2));
    await repo.writeSnapshot(snapshot('s0', 1));
    const sequence = (await repo.readRecovery()).find((r) => r.id === 's0').sequence;
    const removedOld = await repo.clearRecovery('s0', old);
    const current = (await repo.readRecovery()).find((r) => r.id === 's0');
    await repo.clearRecovery('s0', current);
    await repo.migrateLegacy(snapshot('legacy'));
    const migrated = (await repo.readRecovery()).some((r) => r.id === 'legacy');
    const db = await repo.open(); db.close();
    await new Promise((resolve, reject) => { const r = indexedDB.deleteDatabase('autosave-cap-test'); r.onsuccess = resolve; r.onerror = reject; });
    return { full, migrationFull, unchanged, sequence, removedOld, migrated };
  });
  ok('恢复点满额不淘汰未处理记录；同会话不倒退；失败迁移不写成功标记',
    bounded.full && bounded.migrationFull && bounded.unchanged && bounded.sequence === 2 && !bounded.removedOld && bounded.migrated, JSON.stringify(bounded));

  // 全新页面禁用 IndexedDB：初始化不应抛出到页面，也不能假报保存成功。
  await page.evaluateOnNewDocument(() => { Object.defineProperty(window, 'indexedDB', { value: undefined }); });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__app?.ready && window.__app.autosave.state.status === 'error');
  ok('存储不可用仍可打开和编辑场景，持续显示保存失败与导出入口', await page.evaluate(() => {
    const a = window.__app; a.timeline.setDuration(28); a.history.capture();
    return a.timeline.duration === 28 && [...document.querySelectorAll('.save-panel button')].some((b) => b.textContent === '导出场景');
  }));
  await page.evaluate(() => window.__app.autosave.save());
}
