import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOps } from '../src/ai/apply.js';
import { DocumentStore } from '../src/doc/Store.js';
import { History } from '../src/app/History.js';
import { checkRequestState } from '../src/util/requestGuard.js';

// 只替代资源加载边界；ops 校验、编译、文档校验、事务和历史使用真实模块。
function documentApp() {
  const app = {
    store: new DocumentStore(), charSeq: 0,
    async loadDocument(doc, options) {
      checkRequestState(app.store, options);
      app.store.commit(app.store.prepareReplacement('加载', doc), { history: options.history });
    },
  };
  app.history = new History(app);
  app.history.reset();
  return app;
}

test('applyOps：批量指令只提交一次，撤销和重做恢复完整文档', async () => {
  const app = documentApp(), before = app.store.document;
  const result = await applyOps(app, [
    { op: 'add_character', name: '小红', body: 'female', pos: [-1, 0, 0], pose: 'wave' },
    { op: 'add_character', name: '小王', body: 'male', pos: [1, 0, 0], pose: 'sit' },
    { op: 'add_camera', name: '机位', pos: [0, 1.4, 4], lookAt: [0, 1, 0] },
    { op: 'timeline', duration: 5, mainCamera: '机位' },
  ]);
  assert.equal(result.ok, true);
  const applied = app.store.document;
  assert.deepEqual(applied.entities.map(e => e.name), ['小红', '小王', '机位']);
  assert.deepEqual(applied.entities.slice(0, 2).map(e => e.pose.preset), ['wave', 'sit']);
  assert.equal(applied.timeline.duration, 5);
  assert.equal(applied.timeline.mainCameraId, applied.entities[2].id);
  assert.equal(app.history.entries.length, 2);
  await app.history.undo();
  assert.deepEqual(app.store.document, before);
  await app.history.redo();
  assert.deepEqual(app.store.document, applied);
});

test('applyOps：校验或加载失败不发布部分文档、不记录历史', async () => {
  const app = documentApp(), before = app.store.document;
  const result = await applyOps(app, [{ op: 'scene', sky: '#ff0000' }, { op: 'remove', target: '不存在' }]);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /ops\[1\]/);
  assert.equal(app.store.document, before);
  app.loadDocument = async () => { throw new Error('资源加载失败'); };
  const failed = await applyOps(app, [{ op: 'scene', sky: '#ff0000' }]);
  assert.equal(failed.ok, false);
  assert.match(failed.errors[0], /资源加载失败/);
  assert.equal(app.store.document, before);
  assert.equal(app.history.entries.length, 1);
});

test('applyOps：过期请求与取消请求都不能提交', async () => {
  const app = documentApp(), revision = app.store.revision;
  app.store.transact('用户修改', doc => { doc.meta.name = '新编辑'; });
  const edited = app.store.document;
  await assert.rejects(applyOps(app, [{ op: 'scene', sky: '#ff0000' }], { expectedRevision: revision }), { name: 'StaleRequestError' });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(applyOps(app, [{ op: 'scene', sky: '#ff0000' }], { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(app.store.document, edited);
});

// 原 ai/ai-boundary 浏览器套件的请求回路断言；仅通知出口不挂 DOM。
test('AI 校验重试携带原错误，三次失败不改变文档；等待时编辑和取消拒绝旧响应', async t => {
  const { AiAgent } = await import('../src/ai/agent.js');
  const { MockProvider } = await import('../src/ai/provider.js');
  const previous = globalThis.document;
  globalThis.document = { getElementById: () => null };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const app = documentApp();
  Object.defineProperty(app, 'entities', { get: () => app.store.document.entities });
  app.exportDocument = () => structuredClone(app.store.document);
  await applyOps(app, [{ op: 'add_prop', name: '方块', kind: 'box', pos: [0, 0, 0] }]);
  const provider = new MockProvider([{ match: '重试', reply: [
    { ops: [{ op: 'remove', target: '不存在' }] },
    { ops: [{ op: 'scene', sky: '#123456' }] },
  ] }]);
  const agent = new AiAgent(app, { provider });
  const before = app.history.entries.length;
  const turn = await agent.run({ input: '重试' });
  assert.equal(turn.status, 'ok');
  assert.equal(turn.attempts.length, 2);
  assert.ok(provider.calls[1].at(-1).content.includes(turn.attempts[0].errors[0]));
  assert.equal(app.history.entries.length, before + 1);
  agent.setProvider(new MockProvider([{ match: '', reply: { ops: [{ op: 'remove', target: '不存在' }] } }]));
  const saved = app.store.document, history = app.history.entries.length;
  const failed = await agent.run({ input: '失败' });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.attempts.length, 3);
  assert.equal(app.store.document, saved);
  assert.equal(app.history.entries.length, history);
  for (const cancel of [false, true]) {
    let release, entered;
    const ready = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    let calls = 0;
    agent.setProvider({ configured: true, async chat() {
      calls++; entered(); await gate;
      return JSON.stringify({ ops: [{ op: 'scene', sky: '#ff0000' }] });
    } });
    const pending = agent.run({ input: '等待' });
    await ready;
    if (cancel) agent.cancel();
    else app.store.transact('用户编辑', doc => { doc.meta.name = '保留新编辑'; });
    const current = app.store.document;
    release();
    const result = await pending;
    assert.equal(result.status, cancel ? 'cancelled' : 'error');
    assert.equal(app.store.document, current);
    assert.equal(calls, 1);
    assert.equal(agent.busy, false);
  }
});
