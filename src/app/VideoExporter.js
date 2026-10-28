// @ts-check
// 导出视频：第 i 帧 = timeline.evaluate(t0 + i/fps) 后用主机位离屏渲染。
// evaluate 是纯函数，所以导出完全离线、逐帧，与机器快慢无关；不动主 canvas 尺寸，不改文档。
import * as THREE from 'three';
import { withVideoEncoder, exportAbortError as abortError } from './VideoEncoding.js';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { DEFAULT_SCENE_NAME } from '../doc/schema.js';
import { exportCamera, encoderConfig, frameCount, ExportError, hasWebCodecs, isExportSupported, UNSUPPORTED_MSG } from './exportSpec.js';

// 规格 / 能力检测在 exportSpec.js（不带 mp4-muxer，首屏可直接引用）；这里转出，老调用方式不变
export * from './exportSpec.js';

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
  app.pathEditor?.cancel();
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
 * @param {import('./App.js').App} app
 * @param {{width:number, height:number, fps:number, range:[number,number], labels?:boolean,
 *          signal?:AbortSignal, onProgress?:(i:number, n:number)=>void}} opts
 */
export async function renderFrames(app, { width, height, fps, range, labels = true, signal, onProgress }, onFrame) {
  const cam = exportCamera(app);
  if (!cam) throw new ExportError('请先添加机位');
  return exportSession(app, { labels }, () => renderFramesInSession(app, cam, { width, height, fps, range, signal, onProgress }, onFrame));
}

/** 调用方持有整个导出会话；编码 flush 也在会话内，期间不提前解锁。 */
async function renderFramesInSession(app, cam, { width, height, fps, range, signal, onProgress }, onFrame) {
  const [t0] = range;
  const n = frameCount(range, fps);
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
  } finally { off.dispose(); }
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
 * @param {import('./App.js').App} app
 * @param {{width:number, height:number, fps:number, range:[number,number], labels?:boolean,
 *          signal?:AbortSignal, onProgress?:(i:number, n:number)=>void}} opts
 * @returns {Promise<{blob:Blob, filename:string, frames:number, width:number, height:number, fps:number}>}
 */
export async function exportVideo(app, { width, height, fps, range, labels = true, signal, onProgress }) {
  if (!hasWebCodecs()) throw new ExportError(UNSUPPORTED_MSG);
  const cfg = encoderConfig(width, height, fps);
  if (!(await isExportSupported(width, height, fps))) throw new ExportError(`当前浏览器不支持 ${width}×${height} 的 H.264 编码`);

  if (signal?.aborted) throw abortError();
  const cam = exportCamera(app);
  if (!cam) throw new ExportError('请先添加机位');
  return exportSession(app, { labels }, async () => {
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({ target, video: { codec: 'avc', width, height, frameRate: fps }, fastStart: 'in-memory' });
    const { n } = await withVideoEncoder(cfg, { signal, output: (chunk, meta) => muxer.addVideoChunk(chunk, meta) },
      (encode) => renderFramesInSession(app, cam, { width, height, fps, range, signal, onProgress },
        (pixels, { i }) => encode(pixels, i)));
    if (signal?.aborted) throw abortError();
    muxer.finalize();
    const name = (app.docMeta.name || DEFAULT_SCENE_NAME).replace(/[\\/:*?"<>|]/g, '_');
    return { blob: new Blob([target.buffer], { type: 'video/mp4' }), filename: `${name}_${width}x${height}_${fps}fps.mp4`, frames: n, width, height, fps };
  });
}

/**
 * 单帧（selftest 用）：与导出同一路径渲染 t 时刻，返回 canvas。会话结束后播放头恢复。
 */
/** @param {import('./App.js').App} app
 * @param {number} t
 * @param {{width?:number, height?:number, labels?:boolean}} [options] */
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
