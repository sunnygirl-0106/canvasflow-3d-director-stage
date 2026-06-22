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
    this.camera.aspect = W / Math.max(1, H);
    this.camera.updateProjectionMatrix();
  }

  render() { this.renderer.render(this.scene, this.camera); }

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
