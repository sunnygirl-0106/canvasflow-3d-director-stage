import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

// TransformControls 封装（§4 / §5.5）：模式切换、与 Orbit 互斥、变更回调。
export class TransformGizmo {
  /**
   * @param {THREE.Camera} camera
   * @param {HTMLElement} domElement
   * @param {THREE.Scene} scene
   * @param {OrbitControls} orbit
   */
  constructor(camera, domElement, scene, orbit) {
    this.control = new TransformControls(camera, domElement);
    this.control.setMode('translate');
    this.control.setSpace('local');
    this.control.setSize(0.85);

    // §5.5 不同 three 版本加入场景方式不同：新版需 control.getHelper()
    const helper = typeof this.control.getHelper === 'function' ? this.control.getHelper() : this.control;
    this._helper = helper;
    scene.add(helper);
    this.control.enabled = false;
    this._setHelperVisible(false);

    // 与 Orbit 互斥：拖 gizmo 时禁用环绕
    this.control.addEventListener('dragging-changed', (e) => {
      orbit.enabled = !e.value;
    });

    this._onObjectChange = null;
    this.control.addEventListener('objectChange', () => {
      this._onObjectChange && this._onObjectChange();
    });

    this.attached = null;
  }

  _setHelperVisible(v) {
    if (this._helper) this._helper.visible = v;
  }

  /** 拖动结束/过程中把新 transform 写回（Inspector.syncFromObject）。 */
  onObjectChange(fn) { this._onObjectChange = fn; }

  /** gizmo 是否正在被拖动（供 Selection 跳过点选）。 */
  get dragging() { return !!this.control.dragging; }

  /** 当前是否悬停在某个轴上（按下时即将抓取 gizmo）。 */
  get overAxis() { return this.control.axis != null; }

  setMode(mode) {
    this.control.setMode(mode); // 'translate' | 'rotate' | 'scale'
  }

  /** 网格吸附：on 时平移按 0.5 单位、旋转按 15° 吸附。 */
  setSnap(on) {
    this.control.setTranslationSnap(on ? 0.5 : null);
    this.control.setRotationSnap(on ? THREE.MathUtils.degToRad(15) : null);
    this.control.setScaleSnap(on ? 0.1 : null);
  }

  attach(root) {
    this.attached = root;
    this.control.attach(root);
    this.control.enabled = true;
    this._setHelperVisible(true);
  }

  detach() {
    this.attached = null;
    this.control.detach();
    this.control.enabled = false;
    this._setHelperVisible(false);
  }

  setVisible(v) {
    if (!this.attached) return;
    this.control.enabled = v;
    this._setHelperVisible(v);
  }
}
