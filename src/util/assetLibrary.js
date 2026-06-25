// 模拟「画布」历史资产服务（§3.c-3）。未来接入真实画布 SDK 时只替换本文件实现。
// 首版用 canvas 动态生成若干等距柱状（2:1）渐变全景图，避免引入大体积素材。

// 生成一张 2:1 渐变全景：天空（上）→ 地平线 → 地面（下），叠加柔和光晕。
function makePanorama(w, h, theme) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');

  // 天空渐变
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.62);
  sky.addColorStop(0, theme.top);
  sky.addColorStop(1, theme.horizon);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.62);

  // 地面渐变
  const ground = ctx.createLinearGradient(0, h * 0.62, 0, h);
  ground.addColorStop(0, theme.ground1);
  ground.addColorStop(1, theme.ground2);
  ctx.fillStyle = ground;
  ctx.fillRect(0, h * 0.62, w, h * 0.38);

  // 太阳/光晕
  const sx = w * theme.sunX, sy = h * theme.sunY;
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, h * 0.55);
  glow.addColorStop(0, theme.sun);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  return cv.toDataURL('image/jpeg', 0.82);
}

const THEMES = [
  { title: '黄昏天空', top: '#1b2a55', horizon: '#e98a5b', ground1: '#3a2a32', ground2: '#10090c', sun: 'rgba(255,196,120,.9)', sunX: 0.78, sunY: 0.5 },
  { title: '清晨蓝调', top: '#0c1a3a', horizon: '#7fb6e6', ground1: '#243446', ground2: '#0a1018', sun: 'rgba(200,225,255,.7)', sunX: 0.3, sunY: 0.42 },
  { title: '影棚灰幕', top: '#2b2b30', horizon: '#9a9aa2', ground1: '#3a3a40', ground2: '#141416', sun: 'rgba(255,255,255,.45)', sunX: 0.5, sunY: 0.35 },
  { title: '霓虹夜景', top: '#0a0518', horizon: '#5b1f6b', ground1: '#241433', ground2: '#070310', sun: 'rgba(255,90,200,.6)', sunX: 0.62, sunY: 0.55 },
  { title: '日间晴空', top: '#1f6fd6', horizon: '#bfe0ff', ground1: '#3f5a3a', ground2: '#16210f', sun: 'rgba(255,250,210,.85)', sunX: 0.2, sunY: 0.25 },
  { title: '暖棕摄影棚', top: '#3a2c20', horizon: '#caa06a', ground1: '#473322', ground2: '#160f08', sun: 'rgba(255,220,160,.5)', sunX: 0.5, sunY: 0.4 },
];

let _cache = null;

// 真实「画布」历史里图片尺寸五花八门：既有 2:1 全景，也有 16:9 / 竖图 / 方图，还有视频。
// 这里刻意混入非 2:1 素材，让历史记录弹层能演示「仅 2:1 可选、其余置灰」的拦截效果。
// 每项带 w/h/ratioLabel，由消费方（Dock）用 isPanoRatio(w,h) 判定可选性。
const SPECS = [
  // theme 索引, 宽, 高, 比例标签, 类型
  [0, 2048, 1024, '2:1', 'image'],
  [1, 2048, 1024, '2:1', 'image'],
  [2, 2048, 1024, '2:1', 'image'],
  [3, 1920, 1080, '16:9', 'image'],
  [4, 1024, 1024, '1:1', 'image'],
  [5, 1080, 1920, '9:16', 'image'],
  [0, 2520, 1080, '21:9', 'image'],
  [2, 1280, 720, '16:9', 'video'],
  [3, 1080, 1920, '9:16', 'video'],
];

/**
 * 列出「画布」历史资产（图片 + 视频）。
 * @returns {Promise<Array<{id,type:'image'|'video',w,h,ratioLabel,url,thumb,title,createdAt}>>}
 */
export async function listCanvasAssets() {
  if (_cache) return _cache;
  // 同一天内、按分钟错开，使历史记录弹层把资产聚成一组网格显示。
  const base = Date.UTC(2026, 5, 15, 10, 0, 0);
  // 图片按 1024 宽生成（贴到全景球够清晰），视频用小图占位；高度按标称比例换算，保证
  // 生成图比例与 w/h 一致 —— 这样上传校验（读纹理尺寸）与弹层判定（读 w/h）结论一致。
  _cache = SPECS.map(([ti, w, h, ratioLabel, type], i) => {
    const t = THEMES[ti];
    const gw = type === 'video' ? 480 : 1024;
    const gh = Math.round((gw * h) / w);
    const url = makePanorama(gw, gh, t);
    return {
      id: (type === 'video' ? 'vid' : 'img') + (i + 1),
      type,
      w, h, ratioLabel,
      url,
      thumb: url, // 同图，CSS 缩放显示
      title: `${t.title} · ${ratioLabel}${type === 'video' ? ' 视频' : ''}`,
      createdAt: base - i * 60000,
    };
  });
  return _cache;
}
