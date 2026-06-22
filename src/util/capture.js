// 截图：按当前取景比例裁剪、隐藏辅助物（§5.7）
// 依赖 renderer 在创建时已设 preserveDrawingBuffer:true。

/**
 * 截一张图。
 * @param {object} opts
 * @param {THREE.WebGLRenderer} opts.renderer
 * @param {THREE.Scene} opts.scene
 * @param {THREE.Camera} opts.camera
 * @param {HTMLElement} opts.viewport - 视口容器（用于换算像素比与取景框位置）
 * @param {{x:number,y:number,w:number,h:number}|null} opts.frameRect - 取景框 CSS 像素矩形；null=全幅
 * @param {Function} opts.beforeRender - 隐藏辅助物（gizmo/grid/名牌）
 * @param {Function} opts.afterRender - 恢复辅助物
 * @returns {string} dataURL(image/png)
 */
export function capture({ renderer, scene, camera, viewport, frameRect, beforeRender, afterRender }) {
  beforeRender && beforeRender();
  renderer.render(scene, camera); // 强制渲染一帧，确保 buffer 最新
  const cv = renderer.domElement;

  let url;
  if (frameRect && frameRect.w > 0 && frameRect.h > 0) {
    // 画布物理像素 / CSS 像素 的比例
    const px = cv.width / viewport.clientWidth;
    const py = cv.height / viewport.clientHeight;
    const cw = Math.max(1, Math.round(frameRect.w * px));
    const ch = Math.max(1, Math.round(frameRect.h * py));
    const ox = Math.round(frameRect.x * px);
    const oy = Math.round(frameRect.y * py);
    const tmp = document.createElement('canvas');
    tmp.width = cw; tmp.height = ch;
    tmp.getContext('2d').drawImage(cv, ox, oy, cw, ch, 0, 0, cw, ch);
    url = tmp.toDataURL('image/png');
  } else {
    url = cv.toDataURL('image/png');
  }

  afterRender && afterRender();
  return url;
}

/** 下载一张 dataURL 图片。 */
export function downloadDataURL(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

/** 占位：发送到画布 / 接生成链路（首版仅打日志，§11 后续集成）。 */
export function sendToCanvas(dataURL) {
  console.log('[sendToCanvas] 占位：截图将作为参考图发送到生成链路。dataURL length =', dataURL.length);
}
