import fs from 'node:fs';
import { PNG } from 'pngjs';
import { page, ok } from '../harness.mjs';
import { settle } from '../helpers.mjs';

const OUT = 'test-output/default-view';
const decode = url => PNG.sync.read(Buffer.from(url.split(',')[1], 'base64'));

// 对比开/关像素，确认线段实际显示，而非只验证场景里存在几何体。
function lineContrast(on, off, point) {
  let delta = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = Math.round(point[0]) + dx, y = Math.round(point[1]) + dy;
    if (x < 0 || x >= on.width || y < 0 || y >= on.height) continue;
    const i = (y * on.width + x) * 4;
    delta = Math.max(delta, (on.data[i] + on.data[i + 1] + on.data[i + 2]
      - off.data[i] - off.data[i + 1] - off.data[i + 2]) / 3);
  }
  return delta;
}

export async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const calibration = [];
  for (const [width, height] of [[2048, 1034], [1440, 900], [1440, 810], [1920, 1080]]) {
    await page.setViewport({ width, height });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.__app?.ready);
    await settle();
    const state = await page.evaluate(async () => {
      const a = window.__app, camera = a.stage.camera, V = camera.position.constructor;
      const { worldBox } = await import('/src/util/measure.js');
      const characters = a.entities.filter(e => e.type === 'character');
      const direction = camera.position.clone().sub(a.rig.controls.target);
      return {
        actors: characters.map(e => {
          const b = worldBox(e.root, { useBones: true }), center = b.getCenter(new V());
          const foot = new V(center.x, b.min.y, center.z).project(camera);
          const head = new V(center.x, b.max.y, center.z).project(camera);
          return { body: e.body, color: e.toJSON().color, pos: e.toJSON().transform.pos, height: (head.y - foot.y) / 2, feet: (1 - foot.y) / 2 };
        }),
        yaw: direction.x, pitch: Math.atan2(direction.y, direction.z) * 180 / Math.PI,
        director: camera.position.toArray(), target: a.rig.controls.target.toArray(),
        body: a.cameras[0].body.getWorldPosition(new V()).project(camera).toArray(),
        shot: a.cameras[0].toJSON(), selected: a.selectedId === characters[0].id,
        gizmo: a.gizmo.visible, collapsed: window.__timelinePanel.collapsed, playing: a.playback.playing,
      };
    });
    calibration.push({ viewport: [width, height], ...state });
    ok(`${width}×${height} 保留一男一女、颜色和左右站位`, state.actors.length === 2
      && state.actors[0].body === 'male' && state.actors[1].body === 'female'
      && state.actors[0].color === '#57a2ff' && state.actors[1].color === '#ff6b7a'
      && state.actors[0].pos.join() === '-0.7,0,0' && state.actors[1].pos.join() === '0.7,0,0');
    ok(`${width}×${height} 导演视角同时展示人物和摄像机，拍摄参数不变`,
      state.actors.every(e => e.height > .12 && e.height < .16 && e.feet > .48 && e.feet < .54)
      && state.yaw > 0 && state.pitch > 13 && state.pitch < 14
      && Math.abs(state.body[0]) < .9 && Math.abs(state.body[1]) < .9 && state.body[2] > -1 && state.body[2] < 1
      && state.director.every((v, i) => Math.abs(v - [2, 3.2, 13][i]) < 1e-6)
      && state.target.join() === '0,0.8,3' && !state.gizmo
      && state.shot.lookAt.join() === '0,1.2,0'
      && state.shot.transform.pos.join() === '0,2.2,10' && state.shot.fov === 50 && state.selected && state.collapsed && !state.playing,
      JSON.stringify(state.actors.map(e => ({ height: e.height, feet: e.feet }))));
    await page.screenshot({ path: `${OUT}/after-${width}x${height}.png` });
  }
  fs.writeFileSync(`${OUT}/calibration.json`, JSON.stringify(calibration, null, 2));

  const raster = await page.evaluate(() => {
    const a = window.__app, s = a.stage, c = a.cameras[0], V = s.camera.position.constructor;
    // 独立移动观察点，验证视锥侧线的真实渲染。
    a.directorDetached = true;
    a.rig.applyView(new V(1, 2.2, 10), new V(0, 1.2, 0), 50); a.beforeRender();
    const project = p => {
      p.project(s.camera);
      return [(p.x + 1) / 2 * s.renderer.domElement.width, (1 - p.y) / 2 * s.renderer.domElement.height];
    };
    const gridPoint = project(new V(2, .002, 3));
    const farGridPoint = project(new V(2, .002, -38));
    const p = c.helper.geometry.getAttribute('position');
    // 从真实可见侧边采样，保持原有亮度差阈值。
    const sidePoints = [];
    for (let edge=16; edge<24; edge+=2) for (let u=.1; u<1; u+=.1) {
      const side = new V().fromBufferAttribute(p, edge).lerp(new V().fromBufferAttribute(p, edge+1), u);
      const point = project(side.applyMatrix4(c.helper.camera.matrixWorld));
      if (point[0]>5 && point[0]<s.renderer.domElement.width-5 && point[1]>5 && point[1]<s.renderer.domElement.height-5) sidePoints.push(point);
    }
    const snapshot = () => { s.render(); return s.renderer.domElement.toDataURL(); };
    const on = snapshot();
    s.grid.visible = false; const noGrid = snapshot(); s.grid.visible = true;
    c.helper.children[0].visible = false; const noSides = snapshot(); c.helper.children[0].visible = true;
    s.invalidate();
    return { on, noGrid, noSides, gridPoint, farGridPoint, sidePoints };
  });
  const on = decode(raster.on);
  const grid = lineContrast(on, decode(raster.noGrid), raster.gridPoint);
  const sides = Math.max(0, ...raster.sidePoints.map(p => lineContrast(on, decode(raster.noSides), p)));
  ok('正面视角的纵向网格线实际可见', grid > 3, `像素亮度差 ${grid.toFixed(1)}`);
  const farGrid = lineContrast(on, decode(raster.noGrid), raster.farGridPoint);
  ok('远处网格完全渐隐，不在地平线堆叠', farGrid < 1, `像素亮度差 ${farGrid.toFixed(1)}`);
  ok('跨近平面的视锥侧边实际可见', sides > 3, `像素亮度差 ${sides.toFixed(1)}`);

  const reset = await page.evaluate(async () => {
    const a = window.__app;
    a.resetView();
    const original = a.stage.camera.position.clone(), target = a.rig.controls.target.clone();
    a.rig.controls.enableDamping = false;
    a.stage.camera.position.addScalar(2); a.rig.controls.update(); a.resetView();
    const matches = a.stage.camera.position.distanceTo(original) < 1e-6 && a.rig.controls.target.distanceTo(target) < 1e-6;
    const doc = a.exportDocument(); await a.loadDocument(doc, { applyView: true });
    const roundtrip = a.stage.camera.position.distanceTo(original) < 1e-5 && a.rig.controls.target.distanceTo(target) < 1e-5;
    a.setCameraView(true); a.beforeRender();
    const clean = a.cameras.every(c => !c.body.visible && !c.helper.visible);
    a.setCameraView(false);
    a.select(a.cameras[0].id);
    return { matches, roundtrip, clean, slider: document.querySelector('#inspector input[type=range]')?.value, fov: a.cameras[0].fov };
  });
  ok('重置和存档恢复保留构图；机位视角隐藏辅助物；FOV面板与真实机位一致',
    reset.matches && reset.roundtrip && reset.clean && Number(reset.slider) === reset.fov, JSON.stringify(reset));

  const saved = await page.evaluate(async () => {
    const a = window.__app, s = a.stage;
    const doc = a.exportDocument(), camera = JSON.stringify(doc.entities.find(e => e.type === 'camera'));
    const view = { pos: [4, 4, 9], target: [1, .8, -2], fov: 66 };
    doc.meta.editorView = view;
    await a.loadDocument(doc, { applyView: true });
    const matches = () => s.camera.position.distanceTo(s.camera.position.clone().fromArray(view.pos)) < 1e-5
      && a.rig.controls.target.distanceTo(a.rig.controls.target.clone().fromArray(view.target)) < 1e-5;
    const restored = matches() && s.camera.fov === 66;
    const exported = a.exportDocument().meta.editorView;
    s.camera.position.addScalar(3); s.camera.fov = 80; a.resetView();
    const resetSaved = matches() && s.camera.fov === 66;
    delete doc.meta.editorView.fov;
    await a.loadDocument(doc, { applyView: true });
    const legacy = matches() && s.camera.fov === 40;
    return { restored, exported, resetSaved, legacy,
      shotUnchanged: camera === JSON.stringify(a.exportDocument().entities.find(e => e.type === 'camera')) };
  });
  ok('自定义存档视角和FOV往返、重置均保留；缺FOV的旧文件仍使用40°；不改拍摄机位',
    saved.restored && saved.resetSaved && saved.legacy && saved.shotUnchanged
      && saved.exported.pos.join() === '4,4,9' && saved.exported.fov === 66, JSON.stringify(saved));
}
