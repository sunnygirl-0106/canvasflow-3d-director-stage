import test from 'node:test';
import assert from 'node:assert/strict';
import { AiPanel } from '../src/ui/AiPanel.js';

function setup() {
  const pending = [];
  const panel = Object.assign(Object.create(AiPanel.prototype), {
    settings: { baseURL: 'https://example.test/v1', apiKey: 'test', model: 'test' },
    renderSettings() {},
    _provider: () => ({ test: () => new Promise(resolve => pending.push(resolve)) }),
  });
  return { panel, pending };
}

test('重复测试模型连接时，旧请求不能覆盖新请求的结果', async () => {
  const { panel, pending } = setup();
  const old = panel._testConnection();
  const current = panel._testConnection();
  pending[1]({ ok: true, ms: 20 });
  await current;
  pending[0]({ ok: false, error: '旧接口失败' });
  await old;
  assert.deepEqual(panel.testState, { ok: true, text: '连接正常（20 ms）' });
});

test('测试期间编辑或保存新设置后，不显示旧配置的成功结果', async () => {
  for (const save of [false, true]) {
    const { panel, pending } = setup();
    const request = panel._testConnection();
    panel.settings.model = 'new-model';
    if (save) panel.testState = null; // 保存设置会清除已有检测状态。
    pending[0]({ ok: true, ms: 20 });
    await request;
    assert.equal(panel.testState, null);
  }
});
