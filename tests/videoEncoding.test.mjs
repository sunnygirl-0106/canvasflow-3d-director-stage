import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withVideoEncoder } from '../src/app/VideoEncoding.js';

const config = { width: 2, height: 2, framerate: 30 };
function fake(t, phase) {
  let enc, framesClosed = 0, rejectFlush;
  class Encoder {
    state = 'unconfigured'; encodeQueueSize = 0; closes = 0; frames = 0;
    constructor(callbacks) { enc = this; this.callbacks = callbacks; }
    configure() { this.state = 'configured'; if (phase === 'configure') throw new Error('configure'); }
    encode() { this.frames++; if (phase === 'queue') this.encodeQueueSize = 5; }
    flush() { this.flushing = true; return phase === 'flush' ? new Promise((_, reject) => { rejectFlush = reject; }) : Promise.resolve(); }
    close() { this.closes++; this.state = 'closed'; rejectFlush?.(new Error('encoder closed')); }
  }
  const oldEncoder = globalThis.VideoEncoder, oldFrame = globalThis.VideoFrame;
  globalThis.VideoEncoder = Encoder;
  globalThis.VideoFrame = class { close() { framesClosed++; } };
  t.after(() => { globalThis.VideoEncoder = oldEncoder; globalThis.VideoFrame = oldFrame; });
  return { get enc() { return enc; }, get framesClosed() { return framesClosed; } };
}
const tick = () => new Promise((r) => setTimeout(r, 5));
for (const phase of ['queue', 'flush']) test(`${phase} 阻塞时取消：立即关闭一次、无新帧/输出、flush 拒绝已处理`, async (t) => {
  const f = fake(t, phase), ac = new AbortController(); let output = 0;
  const run = withVideoEncoder(config, { signal: ac.signal, output: () => output++ }, async (encode) => {
    await encode(new Uint8Array(16), 0);
    if (phase === 'queue') await encode(new Uint8Array(16), 1);
    return 1;
 });
  const rejection = assert.rejects(run, { name: 'AbortError' });
  await tick(); if (phase === 'flush') assert.equal(f.enc.flushing, true);
  ac.abort(); f.enc.callbacks.error(new Error('late codec error')); f.enc.callbacks.output({}, {});
  await rejection; assert.equal(f.enc.closes, 1); assert.equal(f.enc.frames, 1);
  assert.equal(f.framesClosed, 1); assert.equal(output, 0);
});

test('编码器异步错误唤醒队列；正常 flush 和 configure 失败都释放编码器', async (t) => {
  const f = fake(t, 'queue');
  const run = withVideoEncoder(config, { output() {} }, (encode) => encode(new Uint8Array(16), 0));
  const rejection = assert.rejects(run, /codec broke/);
  await tick(); f.enc.callbacks.error(new Error('codec broke')); await rejection; assert.equal(f.enc.closes, 1);
});
for (const phase of ['success', 'configure']) test(`编码结束清理：${phase}`, async (t) => {
  const f = fake(t, phase);
  const run = withVideoEncoder(config, { output() {} }, async (encode) => { await encode(new Uint8Array(16), 0); return 7; });
  if (phase === 'configure') await assert.rejects(run, /configure/); else assert.equal(await run, 7);
  assert.equal(f.enc.closes, 1);
});
