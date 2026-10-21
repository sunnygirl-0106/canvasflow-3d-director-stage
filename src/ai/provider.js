// 模型调用：本机配置走服务端代理，手动配置可直接调用兼容接口。
// - OpenAICompatProvider：OpenAI 兼容的 /chat/completions（DeepSeek / 通义 / Kimi / OpenRouter / 本地 vLLM 等都能接）。
// - MockProvider：按请求里的关键字返回预录回复；selftest 用它，验收不依赖网络。
// 两者接口相同：chat(messages, { signal }) → 模型回复的文本。
//
// 设置（baseURL / apiKey / model）只存本机 localStorage，不进场景文档、不打日志、不进 selftest 产物。

export const SETTINGS_KEY = 'director-stage.ai';
const DEFAULT_SETTINGS = { baseURL: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' };

export function loadSettings() {
  if (typeof __LOCAL_AI_MODEL__ !== 'undefined' && __LOCAL_AI_MODEL__) {
    return { baseURL: '/api/local-ai', apiKey: '', model: __LOCAL_AI_MODEL__, local: true };
  }
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ baseURL: s.baseURL, apiKey: s.apiKey, model: s.model })); }
  catch { /* 隐私模式等：只在本次会话生效 */ }
}

/** 接口报错（文案给用户看；不含密钥）。 */
export class ProviderError extends Error {
  constructor(message, status) { super(message); this.name = 'ProviderError'; this.status = status; }
}

/** 消息内容 → 纯文本（Mock 匹配 / 日志用；图片记成占位）。 */
export function textOf(content) {
  if (typeof content === 'string') return content;
  return (content || []).map((p) => (p.type === 'text' ? p.text : '[图片]')).join('\n');
}

export class OpenAICompatProvider {
  /**
   * @param {{baseURL:string, apiKey:string, model:string, local?:boolean, temperature?:number, timeoutMs?:number}} o
   */
  constructor({ baseURL, apiKey, model, local = false, temperature = 0.2, timeoutMs = 120000 }) {
    this.local = local;
    this.baseURL = (baseURL || '').replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.model = model;
    this.temperature = temperature;
    this.timeoutMs = timeoutMs;
    this.jsonMode = true; // 接口不支持 response_format 时自动关掉（只影响本实例）
  }

  get configured() { return !!(this.baseURL && (this.local || this.apiKey) && this.model); }

  async chat(messages, { signal } = {}) {
    if (!this.configured) throw new ProviderError('未配置模型接口：请在 AI 面板「设置」里填写 baseURL / apiKey / model');
    const body = { model: this.model, messages, temperature: this.temperature };
    if (this.jsonMode) body.response_format = { type: 'json_object' };
    let res;
    try {
      res = await this._post(body, signal);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw new ProviderError(`网络错误：${err.message || err}（检查 baseURL、网络或跨域设置）`);
    }
    if (res.status === 400 && this.jsonMode) {
      const text = await res.clone().text();
      if (/response_format|json_object/i.test(text)) { // 不支持 JSON 模式：去掉重试一次
        this.jsonMode = false;
        return this.chat(messages, { signal });
      }
    }
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 300);
      throw new ProviderError(`接口返回 ${res.status}：${text || res.statusText}`, res.status);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new ProviderError('接口返回格式不对：没有 choices[0].message.content');
    return content;
  }

  async _post(body, signal) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new Error('请求超时')), this.timeoutMs);
    const onAbort = () => ctl.abort(signal.reason);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(!this.local ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
    } catch (err) {
      if (signal?.aborted) { const e = new Error('已取消'); e.name = 'AbortError'; throw e; }
      if (ctl.signal.aborted) throw new Error('请求超时');
      throw err;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** 「测试连接」：发一条最小请求。→ { ok, ms, error? } */
  async test() {
    const t0 = performance.now();
    try {
      const text = await this.chat([
        { role: 'system', content: '只输出 JSON。' },
        { role: 'user', content: '回复 {"ok": true}' },
      ]);
      return { ok: /ok/i.test(text), ms: Math.round(performance.now() - t0), reply: text.slice(0, 80) };
    } catch (err) {
      return { ok: false, ms: Math.round(performance.now() - t0), error: err.message || String(err) };
    }
  }
}

/**
 * 预录回复。fixtures = [{ match, reply }]：
 *   match：字符串（用户输入包含它）/ RegExp / (用户输入, messages) => bool；
 *   reply：对象（序列化成 JSON）/ 字符串 / 数组（同一条 fixture 第 n 次命中返回第 n 项，用完停在最后一项）/
 *          函数 (messages, n) => 上述之一。
 * 没有命中 → 抛错。calls 记录每次请求的消息（selftest 断言重试消息里带错误原文）。
 */
export class MockProvider {
  constructor(fixtures = [], { delayMs = 0 } = {}) {
    this.fixtures = fixtures.map((f) => ({ ...f, hits: 0 }));
    this.delayMs = delayMs;
    this.calls = [];
    this.configured = true;
  }

  async chat(messages, { signal } = {}) {
    this.calls.push(JSON.parse(JSON.stringify(messages)));
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (signal?.aborted) { const e = new Error('已取消'); e.name = 'AbortError'; throw e; }
    // 只匹配用户输入那一段（第一条用户消息里「用户：」之后），不被场景摘要里的名字误命中；重试时第一条不变，命中同一条 fixture
    const first = textOf(messages.find((m) => m.role === 'user')?.content);
    const k = first.lastIndexOf('\n用户：');
    const firstUser = k >= 0 ? first.slice(k + 4) : first;
    const hit = this.fixtures.find((f) => {
      if (typeof f.match === 'function') return f.match(firstUser, messages);
      if (f.match instanceof RegExp) return f.match.test(firstUser);
      return firstUser.includes(f.match);
    });
    if (!hit) throw new ProviderError('MockProvider：没有匹配的预录回复');
    const n = hit.hits++;
    let r = typeof hit.reply === 'function' ? hit.reply(messages, n) : hit.reply;
    if (Array.isArray(r)) r = r[Math.min(n, r.length - 1)];
    return typeof r === 'string' ? r : JSON.stringify(r);
  }

  async test() { return { ok: true, ms: 0, reply: 'mock' }; }
}
