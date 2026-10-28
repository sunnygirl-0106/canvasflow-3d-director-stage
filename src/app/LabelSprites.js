// @ts-check
import * as THREE from 'three';
/** 名牌锚点（世界坐标）：实体根节点上方 labelOffset（头顶 / 机位上方）。 */
export function labelAnchor(t, worldScale, out) {
  t.root.getWorldPosition(out);
  out.y += t.labelOffset() * worldScale;
  return out;
}

/**
 * 名牌重叠避让（视口、截图和导出共用）。
 * items：{ x 名牌框底边中点屏幕 x, bottom 框底屏幕 y（向下为正）, w, h 框宽高, depth 到相机距离 }，单位一致即可。
 * 按屏幕 x 排序后，离相机近的先落位；后落位的（远的）与已落位的矩形相交就往上推，推开距离 = 重叠高度 + gap，
 * 直到与所有已落位的都不相交。结果写在 item.dy（向上推的距离，≥ 0）；没有重叠时 dy = 0，位置不变。
 */
export function layoutLabels(items, gap = 4) {
  const order = items.slice().sort((a, b) => a.x - b.x);
  for (const it of order) it.dy = 0;
  order.sort((a, b) => a.depth - b.depth); // 稳定排序：同距离按 x
  const placed = [];
  for (const it of order) {
    for (let moved = true; moved;) {
      moved = false;
      for (const o of placed) {
        if (Math.abs(it.x - o.x) * 2 >= it.w + o.w) continue;
        const bot = it.bottom - it.dy, oBot = o.bottom - o.dy;
        if (bot <= oBot - o.h || bot - it.h >= oBot) continue;
        it.dy += bot - (oBot - o.h) + gap; // 底边推到对方顶边之上 gap
        moved = true;
      }
    }
    placed.push(it);
  }
  return items;
}



const _camPos = new THREE.Vector3();

// 视口和导出共用名牌样式（单位 CSS px）
const STYLE = {
  char: { font: 14, weight: 400, padX: 2, padY: 3, fg: '#fff' },
  cam: { font: 12, weight: 400, padX: 2, padY: 2, fg: '#fff' },
};
const SHADOW = { y: 2, blur: 10, color: 'rgba(0,0,0,.5)' };
const MARGIN = 12;               // 纹理四周给阴影留的边（CSS px）
const LINE = 1.25;               // 行高 / 字号
const CHAR_PX = 23.5;            // 14px × 1.25 + 6px
const DPR = 2;                   // 纹理按 2 倍绘制，避免放大发糊
const CHAR_BOX_H = STYLE.char.font * LINE + STYLE.char.padY * 2;
const SCALE = CHAR_PX / CHAR_BOX_H; // CSS 尺寸比例

/**
 * 视口、截图与视频共用精灵名牌，锚点位于头顶 / 机位上方。
 * sizeAttenuation=false，按当前相机投影矩阵计算尺寸，输出分辨率变化时同比缩放。
 * 洁净渲染期间隐藏机位名牌，可按导出选项临时隐藏全部名牌。
 */
export class LabelSprites {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    this.group.name = 'labelSprites';
    this.group.visible = false;
    app.stage.scene.add(this.group); // 不挂 stage.world：位置直接用世界坐标，不受场景缩放影响
    this._items = new Map();         // target → { sprite, text, w, h }
    this._clean = 0;
    this._cleanLabels = [];
    this._tmp = new THREE.Vector3();
    this._layoutKey = null;
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
    if (--this._clean === 0) this.update();
    else this.group.visible = this._cleanLabels.at(-1) && this.app.sceneState.labels;
  }

  /** 每帧渲染前：增删精灵、改名重绘、显隐。位置与尺寸在 onBeforeRender 里按渲染相机算。 */
  update() {
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
      // NDC 高 = scale.y × P[1][1]；视口按 CSS 像素定尺寸，导出随分辨率同比缩放
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
   * 本次渲染（renderer 的一次 render 调用 × 相机）里所有出画名牌的避让。
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
      items.push({ dy: 0, it, x: (p.x * 0.5 + 0.5) * baseHeight * aspect, bottom: (-p.y * 0.5 + 0.5) * baseHeight - (it.h - pad) * (t.type === 'camera' ? 0.6 : 0.35), w: it.w - pad, h: it.h - pad, depth });
    }
    layoutLabels(items);
    for (const x of items) x.it.dy = x.dy;
  }

  _dispose(t, it) {
    this.group.remove(it.sprite);
    it.sprite.material.map.dispose();
    it.sprite.material.dispose();
    this._items.delete(t);
  }

}
