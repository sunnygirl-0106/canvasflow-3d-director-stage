import * as THREE from 'three';
import { DEFAULT_SCENE } from '../doc/schema.js';

// 用户交互事件：任何一次都可能改变画面，标记需要重绘。
// 离散事件（点击 / 按键 / 表单）在 window 上监听；高频的 pointermove / wheel 只在视口内监听 ——
// 鼠标划过侧栏 / 时间轴不该让整个场景按帧重绘。视口外的拖拽（滑条、拖键）经 input 事件或 app.emit 重绘。
const INVALIDATING_EVENTS = ['pointerdown', 'pointerup', 'keydown', 'input', 'change'];
const VIEWPORT_EVENTS = ['pointermove', 'wheel'];

// 将长网格线按格距分段：部分 WebGL 后端会丢失跨过观察相机近平面的整条线。
// 仍合并为一个 LineSegments，不增加网格的 draw call。
function groundGrid(spacing) {
  const divisions = 120 / spacing; // 范围固定 120m，只改变参考线间距。
  const grid = new THREE.GridHelper(120, divisions, 0x536878, 0x354956);
  const source = grid.geometry;
  const p = source.getAttribute('position'), c = source.getAttribute('color');
  const positions = [], colors = [];
  for (let i = 0; i < p.count; i += 2) {
    for (let step = 0; step < divisions; step++) {
      for (const t of [step / divisions, (step + 1) / divisions]) {
        positions.push(
          THREE.MathUtils.lerp(p.getX(i), p.getX(i + 1), t),
          0,
          THREE.MathUtils.lerp(p.getZ(i), p.getZ(i + 1), t),
        );
        colors.push(c.getX(i), c.getY(i), c.getZ(i));
      }
    }
  }
  grid.geometry = new THREE.BufferGeometry();
  grid.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  grid.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  source.dispose();
  return grid;
}

// 场景 / 渲染器 / 光照 / 地面 / 网格 / 按需渲染循环 / resize
export class Stage {
  constructor(viewportEl) {
    this.viewport = viewportEl;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(DEFAULT_SCENE.sky);
    // 雾只用于地面等环境渐隐；可编辑实体材质禁用 fog，避免拉远后融入背景。
    this.scene.fog = new THREE.Fog(DEFAULT_SCENE.sky, 24, 80);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }) // 截图在渲染后同步读取，无需 preserveDrawingBuffer;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    viewportEl.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    this.camera.position.set(0, 1.6, 6.2);

    // 机位视角 POV：非 null 时主视口透过该相机出画面
    this.activeCamera = null;

    // world：承载所有实体，供「场景缩放/平移/旋转」整体控制
    this.world = new THREE.Group();
    this.scene.add(this.world);

    this._buildLights();
    this._buildGround();

    this.clock = new THREE.Clock();
    this._dirty = true;
    const invalidate = () => this.invalidate();
    for (const t of INVALIDATING_EVENTS) window.addEventListener(t, invalidate, { passive: true, capture: true });
    for (const t of VIEWPORT_EVENTS) viewportEl.addEventListener(t, invalidate, { passive: true, capture: true });

    // 视口尺寸变化（窗口缩放、全屏、侧栏变化）统一由 ResizeObserver 感知
    this._resizeHandlers = [];
    new ResizeObserver(() => this.onResize()).observe(viewportEl);
    this.onResize();
  }

  /** 标记下一帧需要重绘。 */
  invalidate() { this._dirty = true; }

  /** 视口尺寸变化时的额外回调（取景框重排等）。 */
  onViewportResize(fn) { this._resizeHandlers.push(fn); }

  _buildLights() {
    const s = this.scene;
    s.add(new THREE.AmbientLight(0xffffff, 0.42));
    s.add(new THREE.HemisphereLight(0xbcd2ff, 0x14181f, 0.7));

    const key = new THREE.DirectionalLight(0xffffff, 1.35);
    key.position.set(4, 10, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 40;
    key.shadow.camera.left = -10; key.shadow.camera.right = 10;
    key.shadow.camera.top = 10; key.shadow.camera.bottom = -10;
    key.shadow.bias = -0.0004; key.shadow.radius = 4;
    s.add(key);

    const fill = new THREE.DirectionalLight(0x9bb8ff, 0.4);
    fill.position.set(-6, 4, -2);
    s.add(fill);
    const rim = new THREE.DirectionalLight(0xbfd3ff, 0.5);
    rim.position.set(-3, 6, -8);
    s.add(rim);
  }

  _buildGround() {
    this.groundGroup = new THREE.Group();
    this.scene.add(this.groundGroup);

    const mat = new THREE.MeshStandardMaterial({ color: 0x3b424c, roughness: 1, metalness: 0, transparent: true, opacity: DEFAULT_SCENE.ground.opacity });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.groundGroup.add(this.ground);

    // 导演视图使用 2m 网格；机位预览、截图和视频保留原有 1m 网格。
    this.grid = groundGrid(2);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.6;
    this.grid.position.y = 0.002;
    this.groundGroup.add(this.grid);

    const directorGeometry = this.grid.geometry, directorMaterial = this.grid.material;
    // 按观察深度渐隐，减少地平线附近的线条堆叠；不依赖全景背景是否关闭环境雾。
    directorMaterial.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `
        #include <fog_fragment>
        #ifdef USE_FOG
          gl_FragColor.a *= 1.0 - smoothstep(12.0, 40.0, vFogDepth);
        #endif
      `);
    };
    const shotGrid = groundGrid(1);
    shotGrid.material.transparent = true;
    shotGrid.material.opacity = 0.6;
    // scene 回调覆盖所有渲染入口（包括离屏视频），避免改变拍摄画面。
    this.scene.onBeforeRender = (_renderer, _scene, camera) => {
      const director = camera === this.camera;
      this.grid.geometry = director ? directorGeometry : shotGrid.geometry;
      this.grid.material = director ? directorMaterial : shotGrid.material;
    };

    // 主轴：X 红、Z 蓝（淡）
    const axisMat = (c) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.5 });
    const xg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-20, 0.004, 0), new THREE.Vector3(20, 0.004, 0)]);
    const zg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.004, -20), new THREE.Vector3(0, 0.004, 20)]);
    this.groundGroup.add(new THREE.Line(xg, axisMat(0x8a3a3a)));
    this.groundGroup.add(new THREE.Line(zg, axisMat(0x3a4a8a)));
  }

  // ---- 全景背景：BackSide 大球承载等距柱状贴图，支持旋转/半径 ----
  setPanorama(texture) {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    if (this._panoTex && this._panoTex !== texture) this._panoTex.dispose();
    this._panoTex = texture;
    if (!this.panoSphere) {
      const geo = new THREE.SphereGeometry(1, 60, 40);
      const mat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, toneMapped: false, depthWrite: false });
      this.panoSphere = new THREE.Mesh(geo, mat);
      this.panoSphere.renderOrder = -1;
      this.panoSphere.rotation.y = THREE.MathUtils.degToRad(this._panoRotDeg || 0);
      this.panoSphere.scale.setScalar(this._panoRadius || 60);
      this.scene.add(this.panoSphere);
    }
    this.panoSphere.material.map = texture;
    this.panoSphere.material.needsUpdate = true;
    this.panoSphere.visible = true;
    this.invalidate();
    // 弱化雾，避免全景被雾染色（记录原值，clearPanorama 时恢复）
    if (this.scene.fog && this._fogSaved === undefined) {
      this._fogSaved = { near: this.scene.fog.near, far: this.scene.fog.far };
      this.scene.fog.near = 1000; this.scene.fog.far = 2000;
    }
  }
  clearPanorama(skyHex) {
    if (this.panoSphere) { this.panoSphere.visible = false; this.panoSphere.material.map = null; }
    if (this._panoTex) { this._panoTex.dispose(); this._panoTex = null; }
    if (this.scene.fog && this._fogSaved) {
      this.scene.fog.near = this._fogSaved.near; this.scene.fog.far = this._fogSaved.far; this._fogSaved = undefined;
    }
    if (skyHex != null) this.setSkyColor(skyHex);
    this.invalidate();
  }
  setPanoramaRotation(deg) { this._panoRotDeg = deg; if (this.panoSphere) this.panoSphere.rotation.y = THREE.MathUtils.degToRad(deg); this.invalidate(); }
  setPanoramaRadius(r) { this._panoRadius = r; if (this.panoSphere) this.panoSphere.scale.setScalar(r); this.invalidate(); }

  // ---- scene-level controls ----
  setSkyColor(hex) { this.scene.background = new THREE.Color(hex); if (this.scene.fog) this.scene.fog.color = new THREE.Color(hex); this.invalidate(); }
  setGroundVisible(v) { this.groundGroup.visible = v; this.invalidate(); }
  setGroundOpacity(v) { this.ground.material.opacity = v; this.invalidate(); }
  setGroundHeight(y) { this.groundGroup.position.y = y; this.invalidate(); }

  setWorldScale(s) { this.world.scale.setScalar(s); this.invalidate(); }
  setWorldPos(x, y, z) { this.world.position.set(x, y, z); this.invalidate(); }
  setWorldRot(x, y, z) { this.world.rotation.set(x, y, z); this.invalidate(); }

  add(obj) { this.world.add(obj); this.invalidate(); }
  remove(obj) { this.world.remove(obj); this.invalidate(); }

  onResize() {
    const W = this.viewport.clientWidth;
    const H = this.viewport.clientHeight;
    this.renderer.setSize(W, H);
    const aspect = W / Math.max(1, H);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    if (this.activeCamera) { this.activeCamera.aspect = aspect; this.activeCamera.updateProjectionMatrix(); }
    this._resizeHandlers.forEach((fn) => fn());
    this.invalidate();
    this.render(); // 立即重绘，避免缩放时闪出空白画布
  }

  render() {
    this.renderer.render(this.scene, this.activeCamera || this.camera);
  }

  /**
   * 按需渲染循环：每帧推进 tick（返回 true 表示画面在动，如环绕阻尼），
   * 只有被标记脏或 tick 报告变化时才真正渲染；渲染前调用 beforeRender 同步名牌等覆盖层。
   */
  startLoop({ tick, beforeRender } = {}) {
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = this.clock.getDelta();
      if (this.suspended) return; // 离线导出期间由导出器自己逐帧渲染，主视口不重复渲染
      let moving = false;
      try { moving = !!tick?.(dt); } catch (e) { console.error(e); }
      if (!this._dirty && !moving) return;
      this._dirty = false;
      try { beforeRender?.(); } catch (e) { console.error(e); }
      this.render();
    };
    loop();
  }

  /**
   * 用主渲染器离屏出一帧，返回 2D canvas（不新建 WebGL 上下文，避免资源重复上传）。
   * - 传 width/height：缩略图，在主画布左下角用 viewport+scissor 渲一块（超出画布则等比缩小）；
   * - 否则按当前视口全幅渲染，可用 crop（CSS 像素矩形）裁剪。
   * 调用后主画布内容是这一帧，调用方须随即 render() 恢复（见 App.withCleanRender）。
   */
  snapshot(camera, { width, height, crop } = {}) {
    const r = this.renderer;
    const cv = r.domElement;
    const out = document.createElement('canvas');

    if (width && height) {
      const pr = r.getPixelRatio();
      const s = Math.min(1, cv.width / width, cv.height / height);
      const w = Math.max(1, Math.floor(width * s));
      const h = Math.max(1, Math.floor(height * s));
      const prevAspect = camera.aspect;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      const size = r.getSize(new THREE.Vector2());
      r.setViewport(0, 0, w / pr, h / pr);
      r.setScissor(0, 0, w / pr, h / pr);
      r.setScissorTest(true);
      try {
        r.render(this.scene, camera);
      } finally {
        r.setScissorTest(false);
        r.setViewport(0, 0, size.x, size.y);
        camera.aspect = prevAspect;
        camera.updateProjectionMatrix();
      }
      out.width = w; out.height = h;
      out.getContext('2d').drawImage(cv, 0, cv.height - h, w, h, 0, 0, w, h);
      return out;
    }

    r.render(this.scene, camera);
    let sx = 0, sy = 0, sw = cv.width, sh = cv.height;
    if (crop && crop.w > 0 && crop.h > 0) {
      const px = cv.width / this.viewport.clientWidth;
      const py = cv.height / this.viewport.clientHeight;
      sx = Math.round(crop.x * px); sy = Math.round(crop.y * py);
      sw = Math.max(1, Math.round(crop.w * px)); sh = Math.max(1, Math.round(crop.h * py));
    }
    out.width = sw; out.height = sh;
    out.getContext('2d').drawImage(cv, sx, sy, sw, sh, 0, 0, sw, sh);
    return out;
  }
}
