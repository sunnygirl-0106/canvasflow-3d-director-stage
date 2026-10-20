// 撤销栈单测：去重、撤销 / 重做、丢弃重做分支、上限、加载期间不记录、资源缓存回收。用最小 App 替身（文档 = 一个计数器）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History } from '../src/app/History.js';
import { createEmptyDocument } from '../src/doc/schema.js';

/** 场景状态只有 name 与可选全景；loadDocument 异步写回。 */
function fakeApp() {
  const app = {
    state: { name: 'a', pano: null },
    loadingDocument: false,
    toDocument() {
      const doc = createEmptyDocument({ name: app.state.name });
      doc.meta.createdAt = '2026-01-01T00:00:00.000Z'; // 与真实 App 一致：创建时间固定
      if (app.state.pano) {
        doc.scene.panorama = { assetId: app.state.pano, rotation: 0, radius: 50 };
        doc.assets[app.state.pano] = { type: 'panorama', dataURL: 'data:' + app.state.pano };
      }
      return doc;
    },
    async loadDocument(doc) {
      app.state = { name: doc.meta.name, pano: doc.scene.panorama?.assetId ?? null };
      app.lastAssets = doc.assets;
    },
  };
  return app;
}

test('相同状态不入栈；撤销 / 重做按顺序回到各步', async () => {
  const app = fakeApp();
  const h = new History(app);
  h.reset();
  assert.equal(h.capture(), false); // 没变
  app.state.name = 'b'; assert.equal(h.capture(), true);
  app.state.name = 'c'; h.capture();
  assert.equal(h.entries.length, 3);
  await h.undo(); assert.equal(app.state.name, 'b');
  await h.undo(); assert.equal(app.state.name, 'a');
  assert.equal(h.canUndo, false);
  assert.equal(await h.undo(), false);
  await h.redo(); assert.equal(app.state.name, 'b');
});

test('撤销后再改：丢弃重做分支', async () => {
  const app = fakeApp();
  const h = new History(app);
  h.reset();
  app.state.name = 'b'; h.capture();
  app.state.name = 'c'; h.capture();
  await h.undo();
  app.state.name = 'x'; h.capture();
  assert.equal(h.canRedo, false);
  assert.deepEqual(h.entries.map((s) => JSON.parse(s).meta.name), ['a', 'b', 'x']);
});

test('超过上限丢最早的；加载文档期间不记录', () => {
  const app = fakeApp();
  const h = new History(app, { limit: 3 });
  h.reset();
  for (const n of ['b', 'c', 'd', 'e']) { app.state.name = n; h.capture(); }
  assert.deepEqual(h.entries.map((s) => JSON.parse(s).meta.name), ['c', 'd', 'e']);
  app.loadingDocument = true;
  app.state.name = 'z';
  assert.equal(h.capture(), false);
});

test('全景资源只缓存一份；撤销时按快照引用带回；不再被引用的资源被回收', async () => {
  const app = fakeApp();
  const h = new History(app, { limit: 2 });
  h.reset();
  app.state.pano = 'p1'; h.capture();
  assert.ok(!h.entries.some((s) => s.includes('data:p1')), '快照里不内联资源');
  app.state.pano = null; h.capture();
  await h.undo();
  assert.equal(app.state.pano, 'p1');
  assert.equal(app.lastAssets.p1.dataURL, 'data:p1');
  app.state.name = 'n'; app.state.pano = null; h.capture(); // 丢弃重做分支 + 超上限：p1 不再被引用
  app.state.name = 'm'; h.capture();
  assert.equal(h._assets.has('p1'), false);
});
