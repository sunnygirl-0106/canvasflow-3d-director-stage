// 导出视频的规格与能力检测：分辨率 / 帧数 / 出画机位 / 编码配置。不依赖 mp4-muxer，界面可在首屏直接引用；
// 真正的逐帧渲染与封装在 VideoExporter.js（导出时按需加载）。

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

// H.264 级别按每帧宏块数选（默认 Baseline 3.1 / Main 4.2；21:9、1440p 超出该级别的帧尺寸上限时升级）
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
