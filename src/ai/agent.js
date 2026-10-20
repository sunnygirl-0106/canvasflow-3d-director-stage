// 重试回路：调用模型 → 解析 JSON → applyOps；失败把错误原文作为下一轮用户消息，最多重试 2 次；
// 全部失败 → toast 前 3 条错误，场景不变。每轮对话（输入、模型 note、应用结果）只存会话态，不进文档。
import { Emitter } from '../util/Emitter.js';
import { toast } from '../util/dom.js';
import { applyOps, summarize } from './apply.js';
import { systemPrompt, userMessage, retryMessage } from './prompt.js';
import { MODES } from './ops.js';

export const MAX_RETRIES = 2;

/**
 * 模型回复 → { ops, note }。容错：去掉 ```json 围栏、取最外层的 {…}；顶层直接是数组也当 ops。
 * @returns {{ops:object[], note:string}|{error:string}}
 */
export function parseReply(text) {
  let s = String(text ?? '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  if (!s.startsWith('{') && !s.startsWith('[')) {
    const i = s.indexOf('{'), j = s.lastIndexOf('}');
    if (i >= 0 && j > i) s = s.slice(i, j + 1);
  }
  let v;
  try { v = JSON.parse(s); }
  catch (err) { return { error: `输出不是合法 JSON：${err.message}` }; }
  if (Array.isArray(v)) return { ops: v, note: '' };
  if (!v || typeof v !== 'object') return { error: '输出应为 JSON 对象 {"ops":[...], "note":"..."}' };
  if (!Array.isArray(v.ops)) return { error: '输出缺少 ops 数组：应为 {"ops":[...], "note":"..."}' };
  return { ops: v.ops, note: typeof v.note === 'string' ? v.note : '' };
}

/**
 * AI 操作者：持有模型接口与本次会话的对话记录。
 * 事件：'turn'(turn) 新一轮开始 / 'update'(turn) 尝试次数或结果变化 / 'busy'(bool)。
 */
export class AiAgent extends Emitter {
  constructor(app, { provider = null, maxRetries = MAX_RETRIES } = {}) {
    super();
    this.app = app;
    this.provider = provider;
    this.maxRetries = maxRetries;
    this.turns = [];
    this.busy = false;
    this._abort = null;
  }

  setProvider(p) { this.provider = p; }

  /** 当前场景是否为空（修改模式下为空时自动改为生成）。 */
  get sceneEmpty() { return this.app.entities.length === 0; }

  /** 直接应用一批 ops（控制台 / selftest：__app.ai.applyOps([...])）。 */
  applyOps(ops, opts) { return applyOps(this.app, ops, opts); }
  summarize() { return summarize(this.app); }

  cancel() { this._abort?.abort(); }

  /**
   * 跑一轮：→ turn = { id, mode, input, image, attempts:[{ raw, note, errors }], status:'running'|'ok'|'failed'|'error'|'cancelled', result, note, error }
   * @param {{input:string, mode?:string, image?:string|null}} o
   */
  async run({ input, mode = 'modify', image = null }) {
    if (this.busy) throw new Error('上一轮还没结束');
    if (!MODES.includes(mode)) throw new Error(`未知模式：${mode}`);
    if (mode === 'modify' && this.sceneEmpty) mode = 'generate';
    const turn = { id: this.turns.length + 1, mode, input, image, attempts: [], status: 'running', result: null, note: '', error: null };
    this.turns.push(turn);
    this._setBusy(true);
    this.emit('turn', turn);
    const ctl = new AbortController();
    this._abort = ctl;
    const messages = [
      { role: 'system', content: systemPrompt() },
      userMessage({ mode, summary: summarize(this.app), input, image }),
    ];
    try {
      for (let k = 0; k <= this.maxRetries; k++) {
        const attempt = { raw: null, note: '', errors: [] };
        turn.attempts.push(attempt);
        this.emit('update', turn);
        attempt.raw = await this.provider.chat(messages, { signal: ctl.signal });
        const parsed = parseReply(attempt.raw);
        if (parsed.error) attempt.errors = [parsed.error];
        else {
          attempt.note = parsed.note;
          const res = await applyOps(this.app, parsed.ops, { mode });
          if (res.ok) {
            Object.assign(turn, { status: 'ok', result: res, note: parsed.note });
            return turn;
          }
          attempt.errors = res.errors;
        }
        messages.push({ role: 'assistant', content: attempt.raw }, retryMessage(attempt.errors));
      }
      const errors = turn.attempts[turn.attempts.length - 1].errors;
      Object.assign(turn, { status: 'failed', note: turn.attempts[turn.attempts.length - 1].note });
      const more = errors.length > 3 ? `\n…共 ${errors.length} 处` : '';
      toast(`AI 生成失败（已尝试 ${turn.attempts.length} 次），场景未改动：\n${errors.slice(0, 3).join('\n')}${more}`, { duration: 7000 });
      return turn;
    } catch (err) {
      if (err?.name === 'AbortError') turn.status = 'cancelled';
      else {
        Object.assign(turn, { status: 'error', error: err?.message || String(err) });
        toast('AI 调用失败：' + turn.error, { duration: 6000 });
      }
      return turn;
    } finally {
      this._abort = null;
      this._setBusy(false);
      this.emit('update', turn);
    }
  }

  _setBusy(v) { this.busy = v; this.emit('busy', v); }
}
