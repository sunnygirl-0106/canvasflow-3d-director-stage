import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import config from '../vite.config.js';
import { localAiPlugin } from '../scripts/local-ai.mjs';
import { OpenAICompatProvider } from '../src/ai/provider.js';

async function proxy(t, handler, enabled = true) {
  const upstream = httpServer(handler);
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const root = await mkdtemp(join(tmpdir(), 'director-ai-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = enabled ? { AI_API_KEY: 'test-server-secret', AI_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1/`, AI_MODEL: 'server-model' } : {};
  const server = await createServer({ configFile: false, root, plugins: [localAiPlugin(env)], logLevel: 'silent', server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
  t.after(() => server.close());
  await server.listen();
  return `http://127.0.0.1:${server.httpServer.address().port}/api/local-ai/chat/completions`;
}
const message = { messages: [{ role: 'user', content: '两个人在广场对话' }] };
const post = (url, body = message, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('运行时配置发现只返回模型名，不暴露凭据；未配置时返回空对象', async (t) => {
  for (const enabled of [true, false]) {
    const url = await proxy(t, (_req, res) => res.end('{}'), enabled);
    const res = await fetch(url.replace('/chat/completions', '/settings'));
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), enabled ? { model: 'server-model' } : {});
  }
});

test('Vite 代理实际启动、转发中文请求；固定服务端模型与凭据并过滤上游回显', async (t) => {
  let received;
  const url = await proxy(t, async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received = { path: req.url, authorization: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks)) };
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'response_format unsupported: test-server-secret' } }));
  });
  const res = await post(url, { ...message, model: 'client-model', apiKey: 'client-key', stream: true, temperature: 0.2, response_format: { type: 'json_object' } });
  assert.equal(res.status, 400);
  const text = await res.text();
  assert.ok(text.includes('response_format'));
  assert.ok(text.includes('[redacted]'));
  assert.ok(!text.includes('test-server-secret'));
  assert.equal(received.path, '/v1/chat/completions');
  assert.equal(received.authorization, 'Bearer test-server-secret');
  assert.deepEqual(received.body, { ...message, model: 'server-model', temperature: 0.2, response_format: { type: 'json_object' }, stream: false });
});

test('代理拒绝畸形来源、跨站请求、非 JSON 和缺失 messages，不访问上游', async (t) => {
  let calls = 0;
  const url = await proxy(t, (req, res) => { calls++; res.end('{}'); });
  assert.equal((await fetch(url)).status, 405);
  assert.equal((await post(url, message, { Origin: 'http://other.invalid' })).status, 403);
  assert.equal((await post(url, message, { Origin: 'null' })).status, 403);
  assert.equal((await post(url, message, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post(url, null)).status, 400);
  assert.equal((await post(url, { messages: [] })).status, 400);
  assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal(calls, 0);
});

test('未配置代理明确返回 503，不尝试连接外部模型', async (t) => {
  let calls = 0;
  const url = await proxy(t, (req, res) => { calls++; res.end('{}'); }, false);
  assert.equal((await post(url)).status, 503);
  assert.equal(calls, 0);
});

test('浏览器取消请求会中断代理的上游连接', { timeout: 10000 }, async (t) => {
  let started, closed;
  const ready = new Promise((resolve) => { started = resolve; });
  const stopped = new Promise((resolve) => { closed = resolve; });
  const url = await proxy(t, (req, res) => {
    req.resume();
    res.on('close', () => { if (!res.writableEnded) closed(); });
    started();
  });
  const controller = new AbortController();
  const request = fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(message), signal: controller.signal }).catch((err) => err);
  await ready;
  controller.abort();
  assert.equal((await request).name, 'AbortError');
  await stopped;
});

test('本机模式只在开发服务自动启用；构建、preview、自测均不绑定本机模型', () => {
  const vars = { AI_API_KEY: 'test-build-secret', AI_BASE_URL: 'https://example.invalid/v1', AI_MODEL: 'test-local-model' };
  const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, vars);
    assert.equal(config({ command: 'serve', mode: 'development' }).define.__LOCAL_AI_MODEL__, '"test-local-model"');
    for (const args of [{ command: 'build', mode: 'production' }, { command: 'serve', mode: 'production', isPreview: true }, { command: 'serve', mode: 'test' }]) {
      const defines = config(args).define;
      assert.equal(defines.__LOCAL_AI_MODEL__, '""');
      assert.ok(!JSON.stringify(defines).includes(vars.AI_API_KEY));
    }
    delete process.env.AI_MODEL;
    // 用空值显式覆盖 .env.local，验证缺少模型时不能开启代理模式。
    process.env.AI_MODEL = '';
    assert.equal(config({ command: 'serve', mode: 'development' }).define.__LOCAL_AI_MODEL__, '""');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('本机 Provider 不向浏览器请求添加凭据；保留 JSON 模式失败回退', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, ...options });
    return calls.length === 1 ? new Response('unsupported response_format', { status: 400 })
      : Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
  });
  const provider = new OpenAICompatProvider({ local: true, baseURL: '/api/local-ai', model: 'local-model' });
  assert.ok(provider.configured);
  assert.equal(await provider.chat(message.messages), '{"ok":true}');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, '/api/local-ai/chat/completions');
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(JSON.parse(calls[1].body).response_format, undefined);
});

test('Provider 收到已取消的 signal 时直接取消请求', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, { signal }) => {
    assert.ok(signal.aborted);
    throw new DOMException('cancelled', 'AbortError');
  });
  const provider = new OpenAICompatProvider({ local: true, baseURL: '/api/local-ai', model: 'local-model' });
  await assert.rejects(provider.chat(message.messages, { signal: AbortSignal.abort() }), { name: 'AbortError' });
});
