// @ts-check
// 编码生命周期：取消/编码错误立即关闭编码器，同时唤醒背压与 flush 等待。
export const exportAbortError = () => new DOMException('导出已取消', 'AbortError');

export async function withVideoEncoder(config, { signal, output }, produce) {
  if (signal?.aborted) throw exportAbortError();
  let encoder, failure = null, finished = false, rejectStopped;
  const stopped = new Promise((_, reject) => { rejectStopped = reject; });
  // 错误可能发生在两次 wait 之间；该 Promise 始终有拒绝处理器。
  stopped.catch(() => {});
  const close = () => { if (encoder && encoder.state !== 'closed') encoder.close(); };
  const stop = (err) => {
    if (failure || finished) return;
    failure = err;
    rejectStopped(err);
    close();
  };
  const abort = () => stop(exportAbortError());
  const check = () => { if (signal?.aborted) throw exportAbortError(); if (failure) throw failure; };
  const wait = (promise) => Promise.race([promise, stopped]);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    encoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (failure || finished || signal?.aborted) return;
        try { output(chunk, meta); } catch (err) { stop(err); }
      },
      error: stop,
    });
    encoder.configure(config);
    check();
    const result = await produce(async (pixels, i) => {
      check();
      const fps = config.framerate;
      const frame = new VideoFrame(pixels, { format: 'RGBA', codedWidth: config.width, codedHeight: config.height,
        timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      try { encoder.encode(frame, { keyFrame: i % Math.max(1, Math.round(fps * 2)) === 0 }); }
      finally { frame.close(); }
      while (encoder.encodeQueueSize > 4) {
        check();
        await wait(new Promise((resolve) => setTimeout(resolve, 2)));
      }
      check();
    });
    check();
    await wait(encoder.flush());
    check();
    return result;
  } catch (err) {
    check(); // 关闭编码器也会拒绝 flush，优先返回真实的取消/编码错误。
    throw err;
  } finally {
    finished = true;
    signal?.removeEventListener('abort', abort);
    close();
  }
}
