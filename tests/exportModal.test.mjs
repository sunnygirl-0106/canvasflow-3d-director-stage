import test from 'node:test';
import assert from 'node:assert/strict';
import { ExportModal } from '../src/ui/ExportModal.js';

function setup(t) {
  const pending = [];
  class Encoder {
    static isConfigSupported() { return new Promise(resolve => pending.push(supported => resolve({ supported }))); }
  }
  const globals = { window: { VideoEncoder: Encoder, VideoFrame: class {} }, VideoEncoder: Encoder };
  for (const [key, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (original) Object.defineProperty(globalThis, key, original); else delete globalThis[key]; });
  }
  const modal = Object.create(ExportModal.prototype);
  const render = () => {
    modal.overlay = {};
    modal.startBtn = { disabled: false };
    modal.unsupEl = { hidden: true, textContent: '' };
  };
  render();
  return { modal, pending, render };
}

const params = { width: 1280, height: 720, fps: 30, error: null };

for (const [oldSupport, currentSupport] of [[false, true], [true, false]]) {
  test(`能力检测乱序返回时只采用当前表单结果：旧 ${oldSupport}，新 ${currentSupport}`, async t => {
    const { modal, pending, render } = setup(t);
    const old = modal._checkSupport({ ...params, width: 2560, height: 1440 });
    render(); // 修改导出规格会重建按钮与提示区域。
    const current = modal._checkSupport(params);
    pending[1](currentSupport);
    await current;
    pending[0](oldSupport);
    await old;
    assert.equal(modal.startBtn.disabled, !currentSupport);
    assert.equal(modal.unsupEl.hidden, currentSupport);
    if (!currentSupport) assert.match(modal.unsupEl.textContent, /1280×720/);
  });
}

test('关闭并重新打开弹层后，旧能力检测不能污染新表单', async t => {
  const { modal, pending, render } = setup(t);
  const old = modal._checkSupport(params);
  modal.overlay = null;
  render();
  pending[0](false);
  await old;
  assert.equal(modal.startBtn.disabled, false);
  assert.equal(modal.unsupEl.hidden, true);
});
