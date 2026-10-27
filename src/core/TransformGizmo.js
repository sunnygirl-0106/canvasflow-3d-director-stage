import { onKey, KEY_PRIORITY } from '../util/keys.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Vector3, MathUtils } from 'three';
import { worldBox } from '../util/measure.js';

// 单位手柄的屏幕尺度（CSS px）：平移箭头长约 0.6 单位，旋转外环直径 1.5 单位。
const MIN_SIZE_PX = 48;
const POINT_SIZE_PX = 96;
const MAX_VIEWPORT_FRACTION = 0.28;

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
    this._position = new Vector3();
    this._cameraPosition = new Vector3();
    this._extent = new Vector3();

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
      this._onDrag?.(e.value, !!this._cancelled);
    });

    this._onObjectChange = null;
    this.control.addEventListener('objectChange', () => this._onObjectChange?.());
    this._onChange = null; // 手柄任何视觉变化（悬停高亮/拖动），用于触发重绘
    this.control.addEventListener('change', () => this._onChange?.());

    this.attached = null;
    onKey((e) => {
      if (e.key !== 'Escape' || !this.dragging) return;
      e.preventDefault(); e.stopImmediatePropagation();
      this.cancel();
    }, { priority: KEY_PRIORITY.transformDrag });
    domElement.addEventListener('pointercancel', () => this.cancel());
  }

  cancel() {
    if (!this.dragging) return;
    this._cancelled = true;
    this.control.reset();
    this.control.pointerUp({ button: 0 });
    this._cancelled = false;
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

  /** Refresh picking matrices before arbitration, independent of the render schedule. */
  hitTest(clientX, clientY) {
    if (!this.visible || !this.control.enabled || this.dragging) return this.dragging;
    this.updateSize();
    const r = this.control.domElement.getBoundingClientRect();
    this.control.updateMatrixWorld(true);
    this.control.pointerHover({ x: (clientX - r.left) / r.width * 2 - 1, y: 1 - (clientY - r.top) / r.height * 2 });
    this.control.updateMatrixWorld(true);
    return this.overAxis;
  }

  /** 手柄当前是否显示。 */
  get visible() { return !!this._helper?.visible; }

  /** 随对象的画面尺度收敛；上下限保证近看不遮挡、远看仍可抓取。 */
  updateSize() {
    if (!this.attached || !this.visible || this.dragging) return;
    const { camera, domElement } = this.control;
    const height = domElement.clientHeight;
    if (!height) return;
    camera.updateWorldMatrix(true, false);
    this.attached.updateWorldMatrix(true, false);
    this.attached.getWorldPosition(this._position);
    camera.getWorldPosition(this._cameraPosition);
    const distance = this._position.distanceTo(this._cameraPosition);
    const depth = -this._position.applyMatrix4(camera.matrixWorldInverse).z;
    if (!camera.isOrthographicCamera && depth <= 0) return;
    const pixelsPerUnit = height * camera.projectionMatrix.elements[5] / 2
      / (camera.isOrthographicCamera ? 1 : depth);
    // 复用角色骨骼测量，避免 GLB 的原始网格包围盒把手柄撑大。
    const box = worldBox(this.attached, { useBones: true });
    box.getSize(this._extent);
    const extent = Math.max(this._extent.x, this._extent.y, this._extent.z);
    // 近景继续随人物变大，只在接近视口尺度时封顶；无体积的路径点保持固定尺寸。
    const maxPixels = Math.max(MIN_SIZE_PX, height * MAX_VIEWPORT_FRACTION);
    const pixels = box.isEmpty() ? Math.min(POINT_SIZE_PX, maxPixels)
      : MathUtils.clamp(extent * pixelsPerUnit * 0.65, MIN_SIZE_PX, maxPixels);
    // 抵消 TransformControls r160 内置的距离/FOV 缩放；可见手柄和拾取体共用 size。
    const factor = camera.isOrthographicCamera ? (camera.top - camera.bottom) / camera.zoom
      : distance * Math.min(1.9 * Math.tan(Math.PI * camera.fov / 360) / camera.zoom, 7);
    this.control.setSize(4 * pixels / (factor * pixelsPerUnit));
  }

  /**
   * 平移模式下某轴箭头的拾取体（世界矩阵已更新），自测真实拖拽用。
   * 依赖 TransformControls 的内部结构，升级 three 时只需改这里。
   */
  translateHandle(axis) {
    const giz = this.control._gizmo;
    giz.updateMatrixWorld(true);
    return giz.picker.translate.children.find((c) => c.name === axis.toUpperCase()) || null;
  }

  setSpace(space) { this.control.setSpace(space); }

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
    this.updateSize();
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
