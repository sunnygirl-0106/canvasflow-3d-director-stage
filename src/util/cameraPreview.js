import * as THREE from 'three';

// 按需把某相机 POV 渲成 dataURL（§B.4）。
// 惰性创建一个独立小 WebGLRenderer，共享 stage.scene；临时设 cam.aspect=w/h，
// 渲染一帧 → toDataURL → 恢复 cam.aspect，避免打扰主渲染尺寸。

let _r = null;

function getRenderer() {
  if (_r) return _r;
  _r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
  _r.setPixelRatio(1);
  _r.outputColorSpace = THREE.SRGBColorSpace;
  _r.toneMapping = THREE.ACESFilmicToneMapping;
  _r.toneMappingExposure = 1.0;
  return _r;
}

/**
 * @param {Stage} stage
 * @param {THREE.PerspectiveCamera} cam
 * @param {number} w
 * @param {number} h
 * @param {{before?:Function, after?:Function}} hooks 渲染前/后隐藏/恢复辅助物
 * @returns {string} dataURL(png)
 */
export function renderCameraThumbnail(stage, cam, w = 320, h = 180, hooks = {}) {
  const r = getRenderer();
  r.setSize(w, h, false);
  const prevAspect = cam.aspect;
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
  hooks.before?.();
  try {
    r.render(stage.scene, cam);
  } finally {
    hooks.after?.();
    cam.aspect = prevAspect;
    cam.updateProjectionMatrix();
  }
  return r.domElement.toDataURL('image/png');
}
