import * as THREE from 'three';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

// 导出视频（阶段 G）：第 i 帧 = timeline.evaluate(t0 + i/fps) 后用主机位离屏渲染。
// evaluate 是纯函数，所以导出完全离线、逐帧，与机器快慢无关；不动主 canvas 尺寸，不改文档。

/** 短边可选值；1440p 标「实验」（集成显卡上可能内存不够）。 */
export const EXPORT_RESOLUTIONS = [
  { short: 720, label: '720p' },
  { short: 1080, label: '1080p' },
  { short: 1440, label: '1440p（实验）' },
];

/** 取景比例 + 短边 → 输出宽高（auto 视为 16:9；H.264 要求偶数）。 */
export function exportSize(ratio, short) {
  const m = /^(\d+):(\d+)$/.exec(ratio || '');
  const [a, b] = m ? [+m[1], +m[2]] : [16, 9];
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  return a >= b
    ? { width: even((short * a) / b), height: even(short) }
    : { width: even(short), height: even((short * b) / a) };
}

/** 帧数：不含终点（最后一帧在 t1 − 1/fps），视频时长 = 范围长度。 */
export function frameCount([t0, t1], fps) {
  return Math.max(1, Math.round((t1 - t0) * fps));
}

/**
 * 出画机位：主机位 > 当前机位 > 选中的机位 > 第一个机位；一个机位都没有返回 null。
 * @returns {{ent:object, source:'main'|'current'}|null}
 */
export function exportCamera(app) {
  const main = app.findCamera(app.timeline.mainCameraId);
  if (main) return { ent: main, source: 'main' };
  const sel = app.selected?.type === 'camera' ? app.selected : null;
  const ent = app.findCamera(app.activeCameraId) || sel || app.cameras[0];
  return ent ? { ent, source: 'current' } : null;
}

// H.264 级别按每帧宏块数选（Baseline 3.1 / Main 4.2 是任务说明的默认；21:9、1440p 超出该级别的帧尺寸上限时升级）
const AVC_LEVELS = [[3600, '1f'], [8192, '2a'], [22080, '32'], [36864, '33']];

/** 编码参数：720p Baseline 6 Mbps，1080p Main 12 Mbps，1440p Main 20 Mbps；关键帧每 2 秒（encode 时指定）。 */
export function encoderConfig(width, height, fps) {
  const short = Math.min(width, height);
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  const min = short <= 720 ? '1f' : '2a';
  const level = AVC_LEVELS.find(([max, lv]) => mbs <= max && lv >= min)?.[1] || '33';
  return {
    codec: (short <= 720 ? 'avc1.4200' : 'avc1.4d00') + level,
    width, height,
    bitrate: short <= 720 ? 6e6 : short <= 1080 ? 12e6 : 20e6,
    framerate: fps,
    latencyMode: 'quality',
    avc: { format: 'avc' },
  };
}

/** 浏览器有 WebCodecs 编码器（Chrome / Edge）。 */
export function hasWebCodecs() {
  return typeof window.VideoEncoder === 'function' && typeof window.VideoFrame === 'function';
}

/** 能力检测：WebCodecs 存在且支持该配置。 */
export async function isExportSupported(width, height, fps) {
  if (!hasWebCodecs()) return false;
  try { return !!(await VideoEncoder.isConfigSupported(encoderConfig(width, height, fps))).supported; }
  catch { return false; }
}

export const UNSUPPORTED_MSG = '导出视频需要 Chrome 或 Edge 浏览器';

export class ExportError extends Error {}

function abortError() {
  return new DOMException('导出已取消', 'AbortError');
}

/**
 * 固定分辨率的离屏渲染：主渲染器 → WebGLRenderTarget（4×MSAA）→ readRenderTargetPixels。
 * three r160 只在渲染到屏幕（或 XR 目标）时做 toneMapping + sRGB 输出编码，渲染到普通 RenderTarget 得到的是
 * 线性、未色调映射的颜色，和视口 / snapshot 不一致。这里在 GPU 存储按 RGBA8 分配之后把目标标成 XR 目标、
 * 纹理色彩空间标成 sRGB，让着色器走与屏幕完全相同的输出路径（ACES + sRGB 编码在 shader 里做，存储不做转换）。
 */
export class OfflineRenderer {
  constructor(renderer, width, height) {
    this.renderer = renderer;
    this.width = width;
    this.height = height;
    this.target = new THREE.WebGLRenderTarget(width, height, { samples: 4, type: THREE.UnsignedByteType });
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target); // 先按线性 RGBA8 分配存储
    renderer.setRenderTarget(prev);
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.target.isXRRenderTarget = true;
    this._raw = new Uint8Array(width * height * 4);
  }

  /** 渲染一帧，返回自上而下的 RGBA 像素（Uint8ClampedArray，可直接做 ImageData / VideoFrame）。 */
  render(scene, camera) {
    const { renderer: r, width: w, height: h } = this;
    const prevAspect = camera.aspect;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const prev = r.getRenderTarget();
    try {
      r.setRenderTarget(this.target);
      r.render(scene, camera);
      r.readRenderTargetPixels(this.target, 0, 0, w, h, this._raw);
    } finally {
      r.setRenderTarget(prev);
      camera.aspect = prevAspect;
      camera.updateProjectionMatrix();
    }
    // GL 读出来是自下而上：翻转 Y
    const out = new Uint8ClampedArray(w * h * 4);
    const row = w * 4;
    for (let y = 0; y < h; y++) out.set(this._raw.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    return out;
  }

  dispose() { this.target.dispose(); }
}

/**
 * 导出会话：暂停播放 → 时间轴进入 active、洁净渲染、精灵名牌接管 → fn() →
 * 恢复导出前的播放头（原来 active 则 seek(原 t)，原来 idle 则 stop()）。导出不改文档，不记撤销。
 */
async function exportSession(app, { labels }, fn) {
  const pb = app.playback;
  pb.pause();
  const was = { active: app.timeline.active, time: pb.time };
  app.exporting = true;
  app.emit('exporting', true);
  app.stage.suspended = true; // 逐帧离屏渲染期间主视口不跟着重绘（否则每帧渲染两遍）
  app.labelSprites.enable();
  app.beginCleanRender({ labels });
  try {
    return await fn();
  } finally {
    app.endCleanRender();
    app.labelSprites.disable();
    if (was.active) pb.seek(was.time); else pb.stop();
    app.stage.suspended = false;
    app.stage.invalidate();
    app.exporting = false;
    app.emit('exporting', false);
  }
}

/**
 * 逐帧离屏渲染（不编码）：每帧调 onFrame(pixels, { i, t, n, width, height })，可返回 Promise。
 * 每帧之后让出主线程（进度条能动）；signal 取消时抛 AbortError，会话照常恢复。
 * @param {{width:number, height:number, fps:number, range:[number,number], labels?:boolean,
 *          signal?:AbortSignal, onProgress?:(i:number, n:number)=>void}} opts
 */
export async function renderFrames(app, { width, height, fps, range, labels = true, signal, onProgress }, onFrame) {
  const cam = exportCamera(app);
  if (!cam) throw new ExportError('请先添加机位');
  const [t0] = range;
  const n = frameCount(range, fps);
  return exportSession(app, { labels }, async () => {
    const off = new OfflineRenderer(app.stage.renderer, width, height);
    try {
      for (let i = 0; i < n; i++) {
        if (signal?.aborted) throw abortError();
        const t = t0 + i / fps;
        const pixels = renderAt(app, off, cam.ent, t);
        await onFrame?.(pixels, { i, t, n, width, height });
        onProgress?.(i + 1, n);
        await new Promise((r) => setTimeout(r, 0));
      }
      if (signal?.aborted) throw abortError();
      return { n, camera: cam };
    } finally {
      off.dispose();
    }
  });
}

/** 求值到 t 并渲染一帧（调用方已处于导出会话 / 洁净渲染区间）。 */
function renderAt(app, off, camEnt, t) {
  app.timeline.evaluate(t);
  app.hideOverlays(); // 求值可能触发 pov 同步等事件：每帧再确认一次 overlay 隐藏
  return off.render(app.stage.scene, camEnt.cam);
}

/**
 * 导出 MP4：逐帧离屏渲染 → VideoEncoder（H.264）→ mp4-muxer（fastStart in-memory）→ Blob。
 * 取消（signal）时抛 AbortError，不产生文件。下载由调用方处理（返回 filename）。
 * @param {{width:number, height:number, fps:number, range:[number,number], labels?:boolean,
 *          signal?:AbortSignal, onProgress?:(i:number, n:number)=>void}} opts
 * @returns {Promise<{blob:Blob, filename:string, frames:number, width:number, height:number, fps:number}>}
 */
export async function exportVideo(app, { width, height, fps, range, labels = true, signal, onProgress }) {
  if (!hasWebCodecs()) throw new ExportError(UNSUPPORTED_MSG);
  const cfg = encoderConfig(width, height, fps);
  if (!(await isExportSupported(width, height, fps))) throw new ExportError(`当前浏览器不支持 ${width}×${height} 的 H.264 编码`);

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: 'avc', width, height, frameRate: fps }, fastStart: 'in-memory' });
  let encErr = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encErr = e; },
  });
  encoder.configure(cfg);
  const gop = Math.max(1, Math.round(fps * 2));
  const dur = Math.round(1e6 / fps);
  try {
    const { n } = await renderFrames(app, { width, height, fps, range, labels, signal, onProgress }, async (pixels, { i }) => {
      if (encErr) throw encErr;
      const frame = new VideoFrame(pixels, { format: 'RGBA', codedWidth: width, codedHeight: height, timestamp: Math.round((i * 1e6) / fps), duration: dur });
      try { encoder.encode(frame, { keyFrame: i % gop === 0 }); }
      finally { frame.close(); }
      // 背压：编码器积压过多时等它消化（否则 1080p 帧会堆满内存）
      while (encoder.encodeQueueSize > 4 && !encErr) await new Promise((r) => setTimeout(r, 2));
    });
    await encoder.flush();
    if (encErr) throw encErr;
    muxer.finalize();
    const name = (app.docMeta.name || '未命名场景').replace(/[\\/:*?"<>|]/g, '_');
    return { blob: new Blob([target.buffer], { type: 'video/mp4' }), filename: `${name}_${width}x${height}_${fps}fps.mp4`, frames: n, width, height, fps };
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
}

/**
 * 单帧（selftest 用）：与导出同一路径渲染 t 时刻，返回 canvas。会话结束后播放头恢复。
 */
export async function renderFrame(app, t, { width, height, labels = true } = {}) {
  const cam = exportCamera(app);
  if (!cam) throw new ExportError('请先添加机位');
  return exportSession(app, { labels }, async () => {
    const off = new OfflineRenderer(app.stage.renderer, width, height);
    try {
      return pixelsToCanvas(renderAt(app, off, cam.ent, t), width, height);
    } finally {
      off.dispose();
    }
  });
}

export function pixelsToCanvas(pixels, width, height) {
  const cv = document.createElement('canvas');
  cv.width = width; cv.height = height;
  cv.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);
  return cv;
}
