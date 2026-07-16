// 模拟「画布」历史资产服务（§3.c-3）。未来接入真实画布 SDK 时只替换本文件实现。
//
// 预置全景图为 Poly Haven（https://polyhaven.com）提供的 CC0 等距柱状（2:1）实拍全景，
// 已本地化到 public/assets/panoramas/（同源加载，避免跨域污染画布导致截图失败）。
//   pano-day    ← kloofendal_48d_partly_cloudy_puresky
//   pano-sunset ← venice_sunset
//   pano-dawn   ← kiara_1_dawn
//   pano-sky    ← kloppenheim_06_puresky
//   pano-night  ← dikhololo_night
//   pano-studio ← brown_photostudio_02

const P = './assets/panoramas/';

// 可作全景的 2:1 实拍图（历史记录弹层中可直接选用）。
const PANORAMAS = [
  { file: 'pano-day.jpg',    title: '晴日蓝天' },
  { file: 'pano-sunset.jpg', title: '威尼斯黄昏' },
  { file: 'pano-sky.jpg',    title: '云海金光' },
  { file: 'pano-dawn.jpg',   title: '山谷微光' },
  { file: 'pano-night.jpg',  title: '银河星夜' },
  { file: 'pano-studio.jpg', title: '室内影棚' },
];

// 真实「画布」历史里尺寸五花八门：既有 2:1 全景，也有横/竖画幅与视频。这里刻意混入
// 非 2:1 与视频素材，让历史记录弹层能演示「仅 2:1 可选、其余置灰」的拦截效果。
// 缩略图复用实拍全景（CSS 裁切显示），比纯色占位更贴近真实历史。
const EXTRAS = [
  { thumb: 'pano-sunset.jpg', title: '横画幅样片', type: 'image', w: 1920, h: 1080, ratioLabel: '16:9' },
  { thumb: 'pano-dawn.jpg',   title: '竖画幅样片', type: 'image', w: 1080, h: 1920, ratioLabel: '9:16' },
  { thumb: 'pano-night.jpg',  title: '星空延时',   type: 'video', w: 1280, h: 720,  ratioLabel: '16:9' },
];

let _cache = null;

/**
 * 列出「画布」历史资产（图片 + 视频）。
 * @returns {Promise<Array<{id,type:'image'|'video',w,h,ratioLabel,url,thumb,title,createdAt}>>}
 */
export async function listCanvasAssets() {
  if (_cache) return _cache;
  // 同一天内、按分钟错开，使历史记录弹层把资产聚成一组网格显示。
  const base = Date.UTC(2026, 5, 15, 10, 0, 0);
  let i = 0;
  const panos = PANORAMAS.map((p) => ({
    id: 'img' + (++i),
    type: 'image',
    w: 2048, h: 1024, ratioLabel: '2:1',
    url: P + p.file,
    thumb: P + p.file,
    title: `${p.title} · 2:1`,
    createdAt: base - i * 60000,
  }));
  const extras = EXTRAS.map((e) => ({
    id: (e.type === 'video' ? 'vid' : 'img') + (++i),
    type: e.type,
    w: e.w, h: e.h, ratioLabel: e.ratioLabel,
    url: P + e.thumb,
    thumb: P + e.thumb,
    title: `${e.title} · ${e.ratioLabel}${e.type === 'video' ? ' 视频' : ''}`,
    createdAt: base - i * 60000,
  }));
  _cache = [...panos, ...extras];
  return _cache;
}
