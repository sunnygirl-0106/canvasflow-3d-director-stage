import * as THREE from 'three';
import { labelAnchor, layoutLabels } from './Labels.js';

const _camPos = new THREE.Vector3();

// 名牌样式：照抄 style.css 的 .label3d / .label3d.cam（单位 CSS px）
const STYLE = {
  char: { font: 19, weight: 700, padX: 2, padY: 3, fg: '#fff' },
  cam: { font: 12, weight: 600, padX: 2, padY: 2, fg: '#fff' },
};
const SHADOW = { y: 2, blur: 10, color: 'rgba(0,0,0,.5)' };
const MARGIN = 12;               // 纹理四周给阴影留的边（CSS px）
const LINE = 1.25;               // 行高 / 字号
const CHAR_PX = 29.75;           // 与 DOM 的 19px × 1.25 + 6px 一致
const DPR = 2;                   // 纹理按 2 倍绘制，避免放大发糊
const CHAR_BOX_H = STYLE.char.font * LINE + STYLE.char.padY * 2;
const SCALE = CHAR_PX / CHAR_BOX_H; // CSS 尺寸比例（与 DOM 相同）

/**
 * 3D 精灵名牌：与 DOM 名牌（Labels）同一锚点、同一样式，但画进 WebGL 画面，
 * 所以截图 / 机位预览 / 导出视频里都有名牌。平时视口仍用 DOM 名牌（更清晰、不占 GPU）。
 * - 锚点在名牌框底部中央，位置 = labelAnchor（头顶 / 机位上方）；
 * - sizeAttenuation=false，名牌高 = 画面高 × CSS字号 / 视口高度（与分辨率成比例），每次渲染按当前相机投影矩阵算 scale；
 * - depthTest=false、renderOrder 最高：与 DOM 名牌一样始终压在画面最上层。
 * 启用方式：enable()/disable()（导出、「预览名牌」开关，引用计数；启用期间隐藏 DOM 层）；
 * withCleanRender 期间临时显示（beginClean/endClean），机位名牌在洁净渲染里不显示（相机体也不显示）。
 */
export class LabelSprites {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    this.group.name = 'labelSprites';
    this.group.visible = false;
    app.stage.scene.add(this.group); // 不挂 stage.world：位置直接用世界坐标，不受场景缩放影响
    this._items = new Map();         // target → { sprite, text, w, h }
    this._enabled = 0;
    this._clean = 0;
    this._cleanLabels = [];
    this._tmp = new THREE.Vector3();
    this._layoutKey = null;
  }

  get enabled() { return this._enabled > 0; }

  enable() {
    if (this._enabled++ === 0) this._apply();
  }

  disable() {
    if (this._enabled === 0) return;
    if (--this._enabled === 0) { this._apply(); this._clear(); }
  }

  /** 洁净渲染开始：按 scene.labels 显示精灵（机位名牌隐藏）。可嵌套；结束后精灵留作缓存（机位预览每帧都会走这里）。 */
  beginClean({ labels = true } = {}) {
    this._clean++;
    this._cleanLabels.push(labels);
    this.sync({ hideCameras: true });
    this.group.visible = labels && this.app.sceneState.labels;
  }

  endClean() {
    if (!this._clean) return;
    this._cleanLabels.pop();
    if (--this._clean === 0) this._apply();
    else this.group.visible = this._cleanLabels.at(-1) && this.app.sceneState.labels;
  }

  _apply() {
    const on = this.enabled;
    this.app.labels.setSuppressed(on);
    if (on) this.sync({ hideCameras: this.app.cameraView });
    this.group.visible = on && this.app.sceneState.labels;
    this.app.stage.invalidate();
  }

  /** 每帧渲染前（启用时）：增删精灵、改名重绘、显隐。位置与尺寸在 onBeforeRender 里按渲染相机算。 */
  update() {
    if (!this.enabled) return;
    this.sync({ hideCameras: !!this._clean || this.app.cameraView });
    this.group.visible = (!this._clean || this._cleanLabels.at(-1)) && this.app.sceneState.labels;
  }

  sync({ hideCameras }) {
    const seen = new Set();
    for (const ent of this.app.entities) {
      for (const t of ent.labelTargets()) {
        seen.add(t);
        let it = this._items.get(t);
        if (!it) { it = this._create(t); this._items.set(t, it); }
        else if (it.text !== t.name) this._draw(it, t);
        it.sprite.visible = t.visible && !(hideCameras && t.type === 'camera');
      }
    }
    for (const [t, it] of this._items) if (!seen.has(t)) this._dispose(t, it);
  }

  _create(t) {
    const tex = new THREE.CanvasTexture(document.createElement('canvas'));
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false, depthWrite: false,
      sizeAttenuation: false, toneMapped: false, fog: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 1e6;
    sprite.frustumCulled = false; // 位置在 onBeforeRender 才写入
    const it = { sprite, text: null, w: 0, h: 0, dy: 0 };
    const k = this;
    sprite.onBeforeRender = function (renderer, scene, camera) {
      k._layout(renderer, camera);
      labelAnchor(t, k.app.stage.world.scale.y, this.position);
      // NDC 高 = scale.y × P[1][1]；视口里与 DOM 等大，导出随分辨率同比缩放
      const s = 2 / (k.app.stage.viewport.clientHeight * camera.projectionMatrix.elements[5]);
      this.scale.set(it.w * s, it.h * s, 1);
      this.center.y = (MARGIN * SCALE - it.dy - (it.h - MARGIN * SCALE * 2) * (t.type === 'camera' ? 0.6 : 0.35)) / it.h; // 避让：框底上移 dy（CSS px）
      this.updateMatrixWorld();
    };
    this._draw(it, t);
    this.group.add(sprite);
    return it;
  }

  /** 把名牌画进纹理：透明底、白字与轻暗描边。it.w/h 为纹理的 CSS 像素尺寸。 */
  _draw(it, t) {
    const st = t.type === 'camera' ? STYLE.cam : STYLE.char;
    const font = `${st.weight} ${st.font}px ${getComputedStyle(document.body).fontFamily || 'sans-serif'}`;
    const cv = it.sprite.material.map.image;
    const g = cv.getContext('2d');
    g.font = font;
    const boxW = Math.ceil(g.measureText(t.name).width) + st.padX * 2;
    const boxH = st.font * LINE + st.padY * 2;
    const W = boxW + MARGIN * 2, H = boxH + MARGIN * 2;
    const R = DPR * SCALE;
    cv.width = Math.ceil(W * R); cv.height = Math.ceil(H * R);
    g.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
    g.clearRect(0, 0, W, H);
    g.save();
    g.shadowColor = SHADOW.color; g.shadowBlur = SHADOW.blur * R; g.shadowOffsetY = SHADOW.y * R;
    g.font = font;
    g.fillStyle = st.fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.strokeStyle = '#000a'; g.lineWidth = 2;
    g.strokeText(t.name, W / 2, H / 2);
    g.fillText(t.name, W / 2, H / 2);
    g.restore();
    const tex = it.sprite.material.map;
    tex.dispose(); // 尺寸变了：重新分配 GPU 纹理
    tex.needsUpdate = true;
    it.text = t.name;
    it.w = W * SCALE; it.h = H * SCALE;
    it.sprite.center.set(0.5, MARGIN / H); // 锚点 = 名牌框底边中点
  }

  /**
   * 本次渲染（renderer 的一次 render 调用 × 相机）里所有出画名牌的避让，与 DOM 名牌同一个 layoutLabels。
   * 按当前视口高度与出画 aspect 计算；导出按输出尺寸同比缩放。
   * 由第一个被渲染的精灵触发，结果写进各 it.dy。
   */
  _layout(renderer, camera) {
    const key = `${renderer.info.render.frame}|${camera.id}`;
    if (key === this._layoutKey) return;
    this._layoutKey = key;
    const baseHeight = this.app.stage.viewport.clientHeight;
    const aspect = camera.isPerspectiveCamera ? camera.aspect : (camera.right - camera.left) / (camera.top - camera.bottom);
    const p = this._tmp, ws = this.app.stage.world.scale.y, pad = MARGIN * SCALE * 2;
    const items = [];
    for (const [t, it] of this._items) {
      it.dy = 0;
      if (!it.sprite.visible) continue;
      labelAnchor(t, ws, p);
      const depth = p.distanceTo(_camPos.setFromMatrixPosition(camera.matrixWorld));
      p.project(camera);
      if (p.z >= 1) continue;
      items.push({ it, x: (p.x * 0.5 + 0.5) * baseHeight * aspect, bottom: (-p.y * 0.5 + 0.5) * baseHeight - (it.h - pad) * (t.type === 'camera' ? 0.6 : 0.35), w: it.w - pad, h: it.h - pad, depth });
    }
    layoutLabels(items);
    for (const x of items) x.it.dy = x.dy;
  }

  /** selftest：出画精灵名牌框在给定画面尺寸下的像素矩形（按最近一次渲染的避让结果）。 */
  debugRects(camera, width, height) {
    const p = this._tmp, ws = this.app.stage.world.scale.y, k = height / this.app.stage.viewport.clientHeight, pad = MARGIN * SCALE * 2;
    const out = [];
    for (const [t, it] of this._items) {
      if (!it.sprite.visible) continue;
      labelAnchor(t, ws, p).project(camera);
      if (p.z >= 1) continue;
      const w = (it.w - pad) * k, h = (it.h - pad) * k;
      const x = (p.x * 0.5 + 0.5) * width, bottom = (-p.y * 0.5 + 0.5) * height - it.dy * k - h * (t.type === 'camera' ? 0.6 : 0.35);
      out.push({ text: it.text, x: x - w / 2, y: bottom - h, w, h });
    }
    return out;
  }

  _dispose(t, it) {
    this.group.remove(it.sprite);
    it.sprite.material.map.dispose();
    it.sprite.material.dispose();
    this._items.delete(t);
  }

  _clear() { for (const [t, it] of this._items) this._dispose(t, it); }

  /** selftest：某目标的精灵状态（是否出画、整张纹理的 CSS 像素尺寸、文字）。 */
  debugItem(t) {
    const it = this._items.get(t);
    return it ? { visible: it.sprite.visible && this.group.visible, w: it.w, h: it.h, text: it.text } : null;
  }
}
