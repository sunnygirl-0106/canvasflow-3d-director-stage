import * as THREE from 'three';

// 场景 / 渲染器 / 光照 / 地面 / 网格 / 渲染循环 / resize
export class Stage {
  constructor(viewportEl) {
    this.viewport = viewportEl;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060608);
    this.scene.fog = new THREE.Fog(0x060608, 18, 46);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    viewportEl.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 1000);
    this.camera.position.set(0, 1.6, 6.2);

    // 机位视角 POV：非 null 时主视口透过该相机出画面（§B.1）
    this.activeCamera = null;

    // world：承载所有实体，供「场景缩放/平移/旋转」整体控制
    this.world = new THREE.Group();
    this.scene.add(this.world);

    this._buildLights();
    this._buildGround();

    this.clock = new THREE.Clock();
    this._tick = null;

    this.onResize = this.onResize.bind(this);
    window.addEventListener('resize', this.onResize);
    this.onResize();
  }

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

    const mat = new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 1, metalness: 0, transparent: true, opacity: 0.4 });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), mat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.groundGroup.add(this.ground);

    // 蓝灰网格
    this.grid = new THREE.GridHelper(40, 40, 0x2a3a5c, 0x1b2540);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.55;
    this.grid.position.y = 0.002;
    this.groundGroup.add(this.grid);

    // 主轴：X 红、Z 蓝（淡）
    const axisMat = (c) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.5 });
    const xg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-20, 0.004, 0), new THREE.Vector3(20, 0.004, 0)]);
    const zg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.004, -20), new THREE.Vector3(0, 0.004, 20)]);
    this.groundGroup.add(new THREE.Line(xg, axisMat(0x8a3a3a)));
    this.groundGroup.add(new THREE.Line(zg, axisMat(0x3a4a8a)));
  }

  // ---- 全景背景（§3.c）：BackSide 大球承载等距柱状贴图，支持旋转/半径 ----
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
  }
  hasPanorama() { return !!(this.panoSphere && this.panoSphere.visible); }
  setPanoramaRotation(deg) { this._panoRotDeg = deg; if (this.panoSphere) this.panoSphere.rotation.y = THREE.MathUtils.degToRad(deg); }
  setPanoramaRadius(r) { this._panoRadius = r; if (this.panoSphere) this.panoSphere.scale.setScalar(r); }

  // ---- scene-level controls ----
  setSkyColor(hex) { this.scene.background = new THREE.Color(hex); if (this.scene.fog) this.scene.fog.color = new THREE.Color(hex); }
  setGroundVisible(v) { this.groundGroup.visible = v; }
  setGroundOpacity(v) { this.ground.material.opacity = v; }
  setGroundHeight(y) { this.groundGroup.position.y = y; }

  setWorldScale(s) { this.world.scale.setScalar(s); }
  setWorldPos(x, y, z) { this.world.position.set(x, y, z); }
  setWorldRot(x, y, z) { this.world.rotation.set(x, y, z); }

  add(obj) { this.world.add(obj); }
  remove(obj) { this.world.remove(obj); }

  onResize() {
    const W = this.viewport.clientWidth;
    const H = this.viewport.clientHeight;
    this.renderer.setSize(W, H);
    const aspect = W / Math.max(1, H);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    if (this.activeCamera) { this.activeCamera.aspect = aspect; this.activeCamera.updateProjectionMatrix(); }
  }

  render() { this.renderer.render(this.scene, this.activeCamera || this.camera); }

  startLoop(tick) {
    this._tick = tick;
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = this.clock.getDelta();
      try { this._tick && this._tick(dt); } catch (e) { console.error(e); }
      this.render();
    };
    loop();
  }
}
