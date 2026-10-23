import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutoSave } from '../src/app/SceneFile.js';
import { Emitter } from '../src/util/Emitter.js';
import { createEmptyDocument } from '../src/doc/schema.js';

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function fixture(overrides = {}) {
  const rows = new Map(), writes = [], migrated = [];
  const repository = {
    async readRecovery() { return [...rows.values()]; },
    async writeSnapshot(s) { writes.push(s); rows.set(s.id, s); },
    async migrateLegacy(s) { migrated.push(s); rows.set(s.id, s); },
    ...overrides,
  };
  const app = { history: new Emitter(), doc: createEmptyDocument(), exportDocument() { return this.doc; } };
  const make = (opts = {}) => new AutoSave(app, { repository, legacyStorage: null, sessionId: 'one', delay: 10000, ...opts });
  return { app, repository, make, rows, writes, migrated };
}

test('启动 reset 不保存；读取期间新编辑等待初始化，恢复候选不替换当前场景', async () => {
  const gate = deferred();
  const f = fixture({ async readRecovery() { await gate.promise; return []; } });
  const s = f.make();
  f.app.history.emit('change', 'reset');
  assert.equal(s.sequence, 0);
  f.app.doc.meta.name = '新编辑'; f.app.history.emit('change', 'capture');
  const saving = s.save();
  await Promise.resolve(); assert.equal(f.writes.length, 0);
  gate.resolve(); await saving;
  assert.equal(JSON.parse(f.writes[0].text).meta.name, '新编辑');
  assert.equal(s.state.status, 'saved');
});

test('同会话只有一个写事务，写入中的多次修改只保留最新，不能提前显示全部已保存', async () => {
  const gate = deferred(), started = deferred(), writes = [], states = [];
  let inflight = 0, max = 0;
  const f = fixture({ async writeSnapshot(s) {
    inflight++; max = Math.max(max, inflight); writes.push(s);
    if (writes.length === 1) { started.resolve(); await gate.promise; }
    inflight--;
  } });
  const s = f.make(); await s.ready; s.on('status', (state) => states.push(state.status));
  f.app.doc.meta.name = 'A'; s.schedule(); const saving = s.save(); await started.promise;
  f.app.doc.meta.name = 'B'; s.schedule();
  f.app.doc.meta.name = 'C'; s.schedule();
  assert.equal(s.state.status, 'dirty'); gate.resolve(); await saving; await s.save();
  assert.equal(max, 1); assert.deepEqual(writes.map((s) => JSON.parse(s.text).meta.name), ['A', 'C']);
  assert.equal(states.filter((s) => s === 'saved').length, 1);
});

test('配额/事务失败保留上次快照，后续重试恢复；序列化失败仍标为未保存', async () => {
  const f = fixture(), s = f.make(); await s.ready;
  s.schedule(); await s.save(); const before = f.rows.get('one');
  const write = f.repository.writeSnapshot;
  f.repository.writeSnapshot = async () => { throw new DOMException('quota', 'QuotaExceededError'); };
  f.app.doc.meta.name = '未保存'; s.schedule(); assert.equal(await s.save(), false);
  assert.equal(s.state.status, 'error'); assert.equal(f.rows.get('one'), before);
  f.repository.writeSnapshot = write; await s.save(); assert.equal(s.state.status, 'saved');
  f.app.doc.loop = f.app.doc; s.schedule(); await s.save(); assert.equal(s.state.status, 'error');
  delete f.app.doc.loop; await s.save(); assert.equal(s.state.status, 'saved');
});

test('加载和三维路径拖动期间不写预览，撤销/重做事件仍调度保存', async () => {
  const f = fixture(), s = f.make(); await s.ready;
  for (const flag of ['loadingDocument', 'pathEditor']) {
    f.app[flag] = flag === 'pathEditor' ? { drag: {} } : true;
    f.app.history.emit('change', 'undo');
    assert.equal(await s.save(), false); assert.equal(f.writes.length, 0);
    f.app[flag] = false;
  }
  f.app.history.emit('change', 'redo'); await s.save();
  assert.equal(f.writes.length, 1);
});

test('旧存档先迁移校验，损坏文本跳过；存储不可用后可以重试', async () => {
  const f = fixture(), text = JSON.stringify(f.app.doc);
  const s = f.make({ legacyStorage: { getItem: () => text } }); await s.ready;
  assert.equal(f.migrated.length, 1); assert.equal(s.candidates[0].id, 'legacy');
  const bad = f.make({ legacyStorage: { getItem: () => '{bad' } }); await bad.ready;
  assert.match(bad.legacyWarning, /损坏/); assert.equal(f.migrated.length, 1);
  const read = f.repository.readRecovery; f.repository.readRecovery = async () => { throw new Error('unavailable'); };
  const retry = f.make(); await retry.ready; assert.equal(retry.state.status, 'error');
  f.repository.readRecovery = read; retry.schedule(); await retry.save(); assert.equal(retry.state.status, 'saved');
});
