import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { OpenAICompatProvider, ProviderError } from '../src/ai/provider.js';

const messages = [{ role: 'user', content: '测试' }];

async function providerFor(t, handler, timeoutMs = 2000) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return new OpenAICompatProvider({
    baseURL: `http://127.0.0.1:${server.address().port}`, apiKey: 'test', model: 'test', timeoutMs,
  });
}

test('收到响应头后正文停滞，仍然超时', { timeout: 3000 }, async (t) => {
  let headersSent = false;
  const provider = await providerFor(t, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.flushHeaders();
    headersSent = true;
    // 故意不结束正文，模拟上游卡住。
  }, 100);
  await assert.rejects(provider.chat(messages), (err) => err instanceof ProviderError && /请求超时/.test(err.message));
  assert.equal(headersSent, true);
});

test('读取正文期间取消，保持 AbortError 语义', { timeout: 3000 }, async (t) => {
  const ctl = new AbortController();
  const provider = await providerFor(t, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.flushHeaders();
  });
  // 用实际 HTTP 响应，同时精确在 fetch 已完成、正文开始读取时取消。
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (...args) => {
    const res = await originalFetch(...args);
    const read = res.text.bind(res);
    res.text = () => { const pending = read(); ctl.abort(); return pending; };
    return res;
  });
  await assert.rejects(provider.chat(messages, { signal: ctl.signal }), { name: 'AbortError' });
});

test('不支持 JSON 模式时只降级一次，后续请求复用配置', async (t) => {
  const bodies = [];
  const provider = await providerFor(t, async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    bodies.push(body);
    if (body.response_format) {
      res.writeHead(400);
      res.end('response_format unsupported');
    } else res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
  });
  assert.equal(await provider.chat(messages), '{"ok":true}');
  assert.equal(await provider.chat(messages), '{"ok":true}');
  assert.equal(bodies.length, 3);
  assert.deepEqual(bodies[0].response_format, { type: 'json_object' });
  assert.ok(bodies.slice(1).every((body) => !('response_format' in body)));
});

test('无关的 HTTP 错误不重试，保留状态码', async (t) => {
  let calls = 0;
  const provider = await providerFor(t, (req, res) => {
    calls++;
    res.writeHead(400);
    res.end('invalid model');
  });
  await assert.rejects(provider.chat(messages), (err) => err instanceof ProviderError && err.status === 400 && /invalid model/.test(err.message));
  assert.equal(calls, 1);
});

test('无效 JSON 使用稳定的 ProviderError，不暴露解析器异常', async (t) => {
  const provider = await providerFor(t, (req, res) => res.end('<html>upstream error</html>'));
  await assert.rejects(provider.chat(messages), (err) => err instanceof ProviderError && /不是合法 JSON/.test(err.message));
});
