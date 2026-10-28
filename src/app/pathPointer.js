import * as THREE from 'three';
import { pointerNDC } from '../util/dom.js';
import { framePlanePoint } from '../core/pathPicking.js';

/** 两个路径工具共用事件入口和拾取射线；绘制/编辑事务仍由各工具管理。 */
export function trackPointer(app, handlers, upTarget = app.stage.renderer.domElement) {
  const dom = app.stage.renderer.domElement;
  dom.addEventListener('pointerdown', handlers.down, true); // 先于 OrbitControls / TransformControls
  dom.addEventListener('pointermove', e => {
    handlers.move(e);
    if (!e.buttons) handlers.hover?.(e);
  });
  upTarget.addEventListener('pointerup', handlers.up, upTarget === dom);
  dom.addEventListener('pointercancel', handlers.cancel);
  window.addEventListener('blur', handlers.cancel);
  if (handlers.leave) dom.addEventListener('pointerleave', handlers.leave);
  const raycaster = new THREE.Raycaster();
  const ray = e => {
    raycaster.setFromCamera(pointerNDC(dom, e.clientX, e.clientY), app.getRenderCamera());
    return raycaster;
  };
  return {
    ray,
    plane(e, y, frame = app.stage.world) {
      frame.updateWorldMatrix(true, false);
      return framePlanePoint(ray(e).ray, frame, y, app.rig.controls.target);
    },
  };
}
