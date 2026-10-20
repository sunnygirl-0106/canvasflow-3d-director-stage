import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

// TransformControls 封装：模式切换、与 Orbit 互斥、变更回调。
export class TransformGizmo {
  /**
   * @param {THREE.Camera} camera
   * @param {HTMLElement} domElement
   * @param {THREE.Scene} scene
   * @param {OrbitControls} orbit
   * @param {() => boolean} [orbitAllowed] 拖拽结束是否允许恢复环绕（POV 下返回 false）
   */
  constructor(camera, domElement, scene, orbit, orbitAllowed = () => true) {
    this.control = new TransformControls(camera, domElement);
    this.control.setMode('translate');
    this.control.setSpace('local');
    this.control.setSize(0.85);

    // 不同 three 版本加入场景方式不同：新版需 control.getHelper()
    const helper = typeof this.control.getHelper === 'function' ? this.control.getHelper() : this.control;
    this._helper = helper;
    scene.add(helper);
    this.control.enabled = false;
    this._setHelperVisible(false);

    // 与 Orbit 互斥：拖 gizmo 时禁用环绕；拖拽结束是否恢复环绕服从视角状态（POV 下不得恢复）
    this._onDrag = null;
    this.control.addEventListener('dragging-changed', (e) => {
      orbit.enabled = !e.value && orbitAllowed();
      this._onDrag?.(e.value);
    });

    this._onObjectChange = null;
    this.control.addEventListener('objectChange', () => this._onObjectChange?.());
    this._onChange = null; // 手柄任何视觉变化（悬停高亮/拖动），用于触发重绘
    this.control.addEventListener('change', () => this._onChange?.());

    this.attached = null;
  }

  _setHelperVisible(v) {
    if (this._helper) this._helper.visible = v;
  }

  /** 拖动过程中对象变换改变（写回面板数值）。 */
  onObjectChange(fn) { this._onObjectChange = fn; }

  /** 拖动开始（true）/ 松手（false）。 */
  onDragState(fn) { this._onDrag = fn; }

  /** 手柄外观变化（需要重绘）。 */
  onChange(fn) { this._onChange = fn; }

  /** gizmo 是否正在被拖动（供 Selection 跳过点选）。 */
  get dragging() { return !!this.control.dragging; }

  /** 当前是否悬停在某个轴上（按下时即将抓取 gizmo）。 */
  get overAxis() { return this.control.axis != null; }

  /** 手柄当前是否显示。 */
  get visible() { return !!this._helper?.visible; }

  /**
   * 平移模式下某轴箭头的拾取体（世界矩阵已更新），自测真实拖拽用。
   * 依赖 TransformControls 的内部结构，升级 three 时只需改这里。
   */
  translateHandle(axis) {
    const giz = this.control._gizmo;
    giz.updateMatrixWorld(true);
    return giz.picker.translate.children.find((c) => c.name === axis.toUpperCase()) || null;
  }

  setMode(mode) {
    this.control.setMode(mode); // 'translate' | 'rotate' | 'scale'
  }

  /** 切换手柄投影/拾取所用相机（进/出 POV、切换出画机位时同步）。 */
  setCamera(cam) {
    if (cam) this.control.camera = cam;
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
