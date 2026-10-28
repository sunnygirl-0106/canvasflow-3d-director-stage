import assert from 'node:assert/strict';
import { page, ok } from '../harness.mjs';
export async function run() {
  const result = await page.evaluate(async () => {
    const a = window.__app;
    const { MockProvider } = await import('/src/ai/provider.js');
    const { Prop } = await import('/src/entities/Prop.js');
    const snapshot = () => ({ doc: JSON.stringify(a.store.document), revision: a.store.revision, history: a.history.index, entities: a.entities
        .map((e) => e.id) });
    let release, entered;
    const gate = () => { const ready = new Promise((r) => { entered = r; }); const wait = new Promise((r) => { release = r; }); return { ready, wait }; };
    let g = gate();
    let calls = 0;
    a.ai.setProvider({ configured: true, async chat() {
        calls++;
        entered();
        await g.wait;
        return JSON.stringify({ ops: [{ op: 'scene', sky: '#ff0000' }] });
      } });
    const pending = a.ai.run({ input: '等待期间修改场景' });
    await g.ready;
    a.timeline.setDuration(13);
    a.history.capture();
    const edited = snapshot();
    release();
    const stale = await pending;
    const staleKept = JSON.stringify(snapshot()) === JSON.stringify(edited);
    const provider = new MockProvider([{ match: '准备', reply: { ops: [{ op: 'add_prop', name: '取消道具', kind: 'box', pos: [2, 0, 1] }] } }]);
    a.ai.setProvider(provider);
    const originalPrepare = a.panorama.prepare, originalFrom = Prop.fromJSON;
    let disposed = 0, discarded = 0;
    const out = { staleStatus: stale.status, staleError: stale.error, staleKept, staleCalls: calls };
    try {
      // 等所有资源准备完再检查取消；fresh 与 panorama 各释放一次，旧对象保持原样。
      g = gate();
      a.panorama.prepare = async function (ref) { await originalPrepare.call(this, ref); entered(); await g.wait; return { discard() { discarded++; } }; };
      Prop.fromJSON = async function (...args) {
        const p = await originalFrom.apply(this, args), dispose = p.dispose;
        p
          .dispose = function () { disposed++; dispose.call(this); };
        return p;
      };
      a.history.capture();
      const before = snapshot();
      const preparing = a.ai.run({ input: '准备期间取消' });
      await g.ready;
      a.ai.cancel();
      release();
      const cancelled = await preparing;
      out.cancelledStatus = cancelled.status;
      out.cancelKept = JSON.stringify(snapshot()) === JSON.stringify(before);
      out.disposed = disposed;
      out.discarded = discarded;
      out.cancelCalls = provider.calls.length;
      out.idle = !a.ai.busy && !a.loadingDocument;
    }
    finally {
      a.panorama.prepare = originalPrepare;
      Prop.fromJSON = originalFrom;
    }
    // 排队加载开始前已过期：不得启动资源准备或重放旧响应。
    const before = snapshot(), expectedRevision = a.store.revision;
    const doc = a.exportDocument({ view: false });
    g = gate();
    a.documents.chain = a.documents.chain.then(() => g.wait);
    const queued = a.loadDocument(doc, { expectedRevision });
    a.timeline.setDuration(14);
    a.history.capture();
    const afterEdit = snapshot();
    release();
    let queuedError;
    try {
      await queued;
    }
    catch (err) {
      queuedError = err.name;
    }
    out.queuedError = queuedError;
    out.queueKept = JSON.stringify(snapshot()) === JSON.stringify(afterEdit);
    out.editAdvanced = before.revision < afterEdit.revision;
    // 忽略 AbortSignal 的 Provider 返回后也不能提交。
    g = gate();
    a.ai.setProvider({ configured: true, async chat() { entered(); await g.wait; return JSON.stringify({ ops: [{ op: 'scene', sky: '#00ff00' }] }); } });
    const beforeCancel = snapshot(), pendingCancel = a.ai.run({ input: '响应后取消' });
    await g.ready;
    a.ai.cancel();
    release();
    out.providerCancel = (await pendingCancel).status;
    out.providerCancelKept = JSON.stringify(snapshot()) === JSON.stringify(beforeCancel);
    return out;
  });
  assert.equal(result.staleStatus, 'error');
  assert.match(result.staleError, /场景已被修改/);
  assert(result.staleKept);
  assert.equal(result.staleCalls, 1);
  ok('等待模型时用户编辑：保留新文档与历史，旧响应不重试', true);
  assert.equal(result.cancelledStatus, 'cancelled');
  assert(result.cancelKept);
  assert.equal(result.disposed, 1);
  assert.equal(result.discarded, 1);
  assert.equal(result.cancelCalls, 1);
  assert(result.idle);
  ok('资源准备期间取消：文档/撤销不变，新资源各清理一次', true);
  assert.equal(result.queuedError, 'StaleRequestError');
  assert(result.queueKept && result.editAdvanced);
  ok('排队文档开始执行前也检查请求 revision', true);
  assert.equal(result.providerCancel, 'cancelled');
  assert(result.providerCancelKept);
  ok('Provider 忽略取消时，响应返回后仍拒绝提交', true);
}
