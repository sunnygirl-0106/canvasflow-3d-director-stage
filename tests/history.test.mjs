import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History } from '../src/app/History.js';
import { DocumentStore } from '../src/doc/Store.js';

function fakeApp(limit = 100) {
  const app = {
    store: new DocumentStore(),
    async loadDocument(doc, opts) {
      if (app.fail) throw new Error('resource failed');
      app.store.commit(app.store.prepareReplacement('加载', doc), { history: opts.history });
    },
    name(value) { app.store.transact('改名', (d) => { d.meta.name = value; }); },
  };
  app.history = new History(app, { limit });
  app.history.reset();
  return app;
}

test('无改动不入栈；补丁撤销/重做按顺序恢复', async () => {
  const a = fakeApp(), h = a.history;
  assert.equal(h.capture(), false);
  a.name('b'); h.capture();
  a.name('c'); h.capture();
  await h.undo(); assert.equal(a.store.document.meta.name, 'b');
  await h.undo(); assert.equal(h.canUndo, false);
  assert.equal(await h.undo(), false);
  await h.redo(); assert.equal(a.store.document.meta.name, 'b');
  assert.equal(typeof h.entries[1], 'object');
  assert.equal(h.entries[1].patches.length, 1);
});

test('复合修改一步撤销；撤销后再改丢弃重做分支', async () => {
  const a = fakeApp(), h = a.history;
  a.name('b'); a.name('c'); h.capture();
  assert.equal(h.entries.length, 2);
  await h.undo();
  a.name('x'); h.capture();
  assert.equal(h.canRedo, false);
  await h.undo(); await h.redo();
  assert.equal(a.store.document.meta.name, 'x');
});

test('连续撤销排队；失败不推进索引，之后仍能重试', async () => {
  const a = fakeApp(), h = a.history;
  for (const n of ['b', 'c', 'd']) { a.name(n); h.capture(); }
  await Promise.all([h.undo(), h.undo()]);
  assert.equal(a.store.document.meta.name, 'b');
  a.fail = true;
  const oldError = console.error;
  console.error = () => {};
  try { assert.equal(await h.undo(), false); } finally { console.error = oldError; }
  assert.equal(h.index, 1);
  assert.equal(a.store.document.meta.name, 'b');
  a.fail = false;
  assert.equal(await h.undo(), true);
});

test('上限和分支截断释放已不可达的全景；普通修改的补丁不携带图片', async () => {
  const a = fakeApp(3), h = a.history;
  a.store.transact('背景', (d) => {
    d.assets.p1 = { type: 'image', name: '全景', dataURL: 'data:image/png;base64,large' };
    d.scene.panorama = { assetId: 'p1', rotation: 0, radius: 50 };
  }); h.capture();
  a.name('b'); h.capture();
  assert.ok(!JSON.stringify(h.entries.at(-1)).includes('base64'));
  a.store.transact('移除背景', (d) => { d.assets = {}; d.scene.panorama = null; }); h.capture();
  await h.undo(); assert.equal(a.store.document.scene.panorama.assetId, 'p1');
  await h.redo();
  for (const n of ['c', 'd', 'e']) { a.name(n); h.capture(); }
  assert.equal(h.entries.length, 3);
  assert.ok(!JSON.stringify(h.entries).includes('base64'));
});
