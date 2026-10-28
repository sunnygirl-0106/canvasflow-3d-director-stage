import { errs, ok, openApp, page } from '../harness.mjs';
import { clickSel, gizmoDrag, mp4Info, pickInOutliner, settle } from '../helpers.mjs';
import fs from 'node:fs';
import { PNG } from 'pngjs';
const OUT = 'test-output/director';
export async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  await page.addStyleTag({ content: '#toast { visibility: hidden !important; }' });
  const seed = await page.evaluate(() => {
    const a = window.__app, d = a.exportDocument();
    return { doc: d, ready: a.ready, selected: a.selectedId, collapsed: window.__timelinePanel.collapsed, hist: a.history.entries.length };
  });
  const d = seed.doc, char = d.entities.find(e => e.type === 'character'), cam = d.entities.find(e => e.type === 'camera');
  ok('第五轮双人一机、无初始路径、10s/30fps、选中角色、时间轴关闭', seed.ready && d.entities.length === 3 && !!char && !!cam && d.timeline.duration === 10 && d.timeline
    .fps === 30 && d.timeline.mainCameraId === cam.id && d.scene.activeCameraId === cam.id && d.paths.length === 0 && !d.timeline.tracks.length && !d
    .constraints.length && seed.selected === char.id && seed.collapsed && seed.hist === 1);
  const calibration = [];
  for (const [width, height] of [[1440, 900], [1920, 1080], [1440, 810]]) {
    await page.setViewport({ width, height });
    await settle(160);
    calibration.push(await page.evaluate(async () => {
      const a = window.__app, V = a.stage.camera.position.constructor;
      const { worldBox } = await import('/src/util/measure.js');
      const b = worldBox(a.selected.root, { useBones: true }), c = b.getCenter(new V());
      const extent = camera => [b.min.y, b.max.y].map(y => (1 - new V(c.x, y, c.z).project(camera).y) / 2);
      const e = extent(a.stage.camera);
      return { viewport: [innerWidth, innerHeight], director: { height: e[0] - e[1], feet: e[0], pos: a.stage.camera.position.toArray(), target: a.rig
            .controls.target.toArray() }, camera: a.cameras[0].toJSON(), character: a.selected.toJSON() };
    }));
    await page.screenshot({ path: `${OUT}/director-${width}x${height}.png` });
  }
  fs.writeFileSync(`${OUT}/calibration.json`, JSON.stringify(calibration, null, 2));
  ok('导演视角后移侧看；拍摄机位保持原构图', calibration.every(x => x.director.height >= .12 && x.director.height <= .16 && x.director.feet >= .48 && x.director.feet <= .54
    && x.camera.transform.pos.join() === '0,2.2,10' && x.camera.lookAt.join() === '0,1.2,0' && x.camera.fov === 50
    && x.director.pos.every((v, i) => Math.abs(v - [2, 3.2, 13][i]) < 1e-6)
    && x.director.target.every((v, i) => Math.abs(v - [0, .8, 3][i]) < 1e-6)), JSON.stringify(calibration.map(x => x.director)));
  await page.setViewport({ width: 1440, height: 900 });
  await settle();
  const preview = await page.evaluate(() => {
    const a = window.__app;
    a.setCameraView(true);
    a.select(a.entities.find(e => e.type === 'character').id);
    const before = JSON.stringify(a.store.document), sel = a.selectedId, hist = a.history.entries.length;
    a.startPreview();
    const immediate = a.getRenderCamera() === a.findCamera(a.timeline.mainCameraId).cam;
    a.playback.pause();
    a.playback.seek(2);
    a.beforeRender();
    return { immediate, pause: !a.preview && !a.cameraView && !a.playback.playing && a.playback.time === 2, clean: a.cleanRenderDepth === 0 && a
        .selection.ring.visible, stable: before === JSON.stringify(a.store.document) && sel === a.selectedId && hist === a.history.entries.length };
  });
  ok('手动机位播放后暂停回导演，辅助物恢复，文档/选择/撤销不变', Object.values(preview).every(Boolean), JSON.stringify(preview));
  await page.screenshot({ path: `${OUT}/camera-paused.png` });
  const labels = await page.evaluate(async () => {
    const a = window.__app, c = a.selected;
    a.startPreview();
    a.rename(c.id, '预览改名');
    a.beforeRender();
    const renamed = a.labelSprites.labels[c.id] === '预览改名';
    a.rename(c.id, '角色A');
    const prop = await a.addCharacter('female');
    a.beforeRender();
    const added = Object.hasOwn(a.labelSprites.labels, prop.id);
    a.remove(prop.id);
    a.beforeRender();
    const removed = !Object.hasOwn(a.labelSprites.labels, prop.id);
    a.select(c.id);
    return { renamed, added, removed };
  });
  ok('持续预览中名牌随重命名/新增/删除同步，不残留旧对象', Object.values(labels).every(Boolean), JSON.stringify(labels));
  const shot = await page.evaluate(async () => {
    const a = window.__app;
    a.startPreview();
    const result = await a.shots.captureShot();
    const bitmap = await createImageBitmap(result.blob);
    const ratio = bitmap.width / bitmap.height;
    bitmap.close();
    return { ratio, clean: a.cleanRenderDepth, preview: !!a.preview };
  });
  ok('预览截图使用有效画幅并恢复嵌套洁净状态', Math.abs(shot.ratio - 16 / 9) < .005 && shot.clean === 1 && shot.preview, JSON.stringify(shot));
  const ratios = await page.evaluate(async () => {
    const a = window.__app, V = a.stage.camera.position.constructor;
    const { worldBox } = await import('/src/util/measure.js');
    const b = worldBox(a.selected.root, { useBones: true }), c = b.getCenter(new V());
    const out = [];
    for (const ratio of ['16:9', '9:16']) {
      a.setRatio(ratio);
      a.beforeRender();
      a.stage.render();
      const cam = a.getRenderCamera(), lo = new V(c.x, b.min.y, c.z).project(cam), hi = new V(c.x, b.max.y, c.z).project(cam);
      out.push({ ratio, aspect: cam.aspect, height: (hi.y - lo.y) / 2, full: lo.y >= -1 && hi.y <= 1, frame: a.rig.frameRect, viewport: a
          .viewportAspect(), hidden: getComputedStyle(a.rig.frameEl).display === 'none' });
    }
    return out;
  });
  ok('横竖导出设置均不改变普通播放的全视口 aspect，框和遮罩隐藏', ratios.every(r => r.full && r.height >= .15 && r.height <= .25 && Math.abs(r.aspect - r.viewport) < .001 && r
    .frame === null && r.hidden), JSON.stringify(ratios));
  await page.screenshot({ path: `${OUT}/camera-portrait.png` });
  await page.evaluate(() => { const a = window.__app; a.setRatio('16:9'); a.stopPreview(); });
  ok('停止回0并恢复导演视角，洁净计数归零', await page.evaluate(() => {
    const a = window.__app;
    return !a.preview && !a.cameraView && !a.timeline.active && a.playback
      .time === 0 && a.cleanRenderDepth === 0;
  }));
  await page.keyboard.press('Space');
  await settle(100);
  ok('Space复用预览入口', await page.evaluate(() => !!window.__app.preview && window.__app.playback.playing));
  await page.click('#viewtabs [data-v="director"]');
  ok('播放中导演标签被锁定，拖播放头保持机位', await page.evaluate(() => {
    const a = window.__app;
    a.playback.seek(3);
    return !!a.preview && !a.cameraView && a.playback
      .playing && a.cleanRenderDepth === 1;
  }));
  const lifecycle = await page.evaluate(async () => {
    const a = window.__app;
    a.setCameraView(true);
    // 手动切机位会创建截图缩略图，先完成加载，再验证本轮删除机位释放资源。
    await Promise.all([...document.querySelectorAll('.shot-card img')].map(img => img.decode()));
    a.startPreview();
    a.playback.pause();
    a.playback.loop = false;
    a.playback.seek(a.timeline.duration);
    a.playback.play();
    const restart = a.playback.time === 0 && !!a.preview;
    a.playback.loop = true;
    a.playback.seek(a.timeline.duration);
    a.playback.update();
    const loop = !!a.preview && a.playback.time < a.timeline.duration;
    a.playback.pause();
    a.playback.loop = false;
    a.playback.seek(9.9);
    a.playback.play();
    a.playback.seek(a.timeline.duration);
    a.playback.update();
    const end = a.playback.time === 10 && !a.playback.playing && !a.preview && !a.cameraView;
    const c2 = a.addCamera('front_mid');
    const main = a.timeline.mainCameraId;
    a.remove(main);
    const fallback = !a.playback.playing && a.getRenderCamera() === a.stage.camera;
    a.remove(c2.id);
    const empty = !a.preview && !a.cameraView && !a.startPreview() && !a.playback.playing && a.cleanRenderDepth === 0;
    return { restart, loop, end, fallback, empty };
  });
  ok('末端重播/循环/自然结束/当前机位删除回退/无机位阻止播放', Object.values(lifecycle).every(Boolean), JSON.stringify(lifecycle));
  await page.evaluate(async (doc) => {
    const a = window.__app;
    await a.loadDocument(doc, { applyView: true });
    a.select(doc.entities[0].id);
    a.history
      .reset();
  }, d);
  const replaced = await page.evaluate(async (doc) => {
    const a = window.__app;
    a.setCameraView(true);
    a.startPreview();
    await a.loadDocument(doc);
    const camera = !a.preview && !a.cameraView && !a.playback.playing && a.getRenderCamera() === a.stage.camera && a.cleanRenderDepth === 0;
    const { createEmptyDocument } = await import('/src/doc/schema.js');
    await a.loadDocument(createEmptyDocument());
    const empty = !a.preview && !a.cameraView && a.cleanRenderDepth === 0 && a.entities.length === 0;
    await a.loadDocument(doc);
    a.select(doc.entities[0].id);
    return { camera, empty };
  }, d);
  ok('预览中导入暂停并回导演；导入空场景清理预览且不补seed', replaced.camera && replaced.empty, JSON.stringify(replaced));
  const frames = await page.evaluate(() => {
    const a = window.__app, p = window.__timelinePanel;
    a.stopPreview();
    for (let i = 0; i < 30; i++)
      p.stepFrames(1);
    const forward = a.playback.time;
    for (let i = 0; i < 30; i++)
      p.stepFrames(-1);
    const back = a.playback.time;
    a.playback.seek(299 / 30);
    const display = p.transport.timeEl.textContent;
    a.timeline.setFps(24);
    a.timeline.setFps(25);
    a.timeline.setFps(60);
    a.timeline.setFps(30);
    a.timeline.setDuration(1.01);
    a.playback.seek(1);
    p.stepFrames(1);
    const edge = a.playback.time;
    a.timeline.setDuration(10);
    a.stopPreview();
    return { forward, back, display, edge, duration: a.timeline.duration };
  });
  ok('30次步进到1s再返回0；299帧显示9.97；非整帧终点夹取', frames.forward === 1 && frames.back === 0 && frames.display === '9.97' && frames.edge === 1.01 && frames
    .duration === 10, JSON.stringify(frames));
  const track = await page.evaluate(() => {
    const a = window.__app;
    window.__timelinePanel.setCollapsed(false);
    window.__timelinePanel.trackRows
      .expandedEnts.add(a.entities[0].id);
    const path = a.timeline.paths.find(p => p.target === a.entities[0].id);
    if (path)
      a.timeline.removePath(path.id);
    const t = a.timeline.addTrack({ target: a.entities[0].id, property: 'pos' });
    a.timeline.setKey(t.id, 0, [0, 0,
      0]);
    a.timeline.setKey(t.id, 4, [0.4, 0, 0]);
    a.timeline.setKey(t.id, 10, [1, 0, 0]);
    a.history.capture();
    return t.id;
  });
  await settle();
  const coords = await page.evaluate(() => {
    const p = window.__timelinePanel, r = p.scroll.getBoundingClientRect();
    p.setZoom(900);
    p.scroll.scrollLeft = 3100;
    const t = p.clientXToTime(r.left + p.timeToX(4) - p.scroll.scrollLeft);
    return { t, pps: p.pps, scroll: p.scroll.scrollLeft };
  });
  ok('缩放与横滚共用坐标原点', Math.abs(coords.t - 4) < 1e-9 && coords.scroll > 0, JSON.stringify(coords));
  await page.screenshot({ path: `${OUT}/timeline-frames.png` });
  await page.evaluate(() => { const p = window.__timelinePanel; p.seek(10); p.scroll.scrollLeft = p.content.clientWidth; });
  await settle();
  await page.screenshot({ path: `${OUT}/timeline-end.png` });
  await page.evaluate(() => { const p = window.__timelinePanel; p.setZoom(0); p.scroll.scrollLeft = 0; });
  await clickSel(`.tl-track[data-track="${track}"] .tl-label`);
  await clickSel('#timeline button[title^="移除选中"]');
  await settle();
  const deleted = await page.evaluate(id => !window.__app.timeline.tracks.some(t => t.id === id), track);
  await page.evaluate(() => window.__app.history.undo());
  ok('移除轨道保留实体，一步撤销恢复', deleted && await page.evaluate(id => window.__app.entities.length === 3 && window.__app.timeline.tracks.some(t => t.id === id), track));
  await page.evaluate(async (doc) => {
    const a = window.__app;
    await a.loadDocument(doc);
    const c = a.cameras[0], pos = c.toJSON().transform.pos;
    a
      .timeline.addPath({ target: c.id, points: [pos, [pos[0] + 1, pos[1], pos[2]]], duration: 10, orient: 'keep' });
    a.history.capture();
    a
      .setCameraView(true);
    a.startPreview();
  }, d);
  await settle(150);
  await page.screenshot({ path: `${OUT}/moving.png` });
  const video = await page.evaluate(async () => {
    const a = window.__app;
    a.playback.pause();
    a.playback.seek(2);
    const { exportVideo, renderFrames } = await import('/src/app/VideoExporter.js');
    const before = JSON.stringify(a.store.document), hist = a.history.entries.length;
    const abort = new AbortController();
    let cancelled = false;
    try {
      await renderFrames(a, { width: 160, height: 90, fps: 30, range: [0, 10], labels: false, signal: abort.signal }, () => abort.abort());
    }
    catch (e) {
      cancelled = e.name === 'AbortError';
    }
    let failed = false;
    try {
      await renderFrames(a, { width: 160, height: 90, fps: 30, range: [0, 1] }, () => { throw new Error('test failure'); });
    }
    catch (e) {
      failed = e.message === 'test failure';
    }
    let last;
    const v = await exportVideo(a, { width: 320, height: 180, fps: 30, range: [0, 10], onProgress: (i) => { last = (i - 1) / 30; } });
    return { bytes: Array.from(new Uint8Array(await v.blob.arrayBuffer())), frames: v.frames, last, cancelled, failed, restored: a
        .cleanRenderDepth === 0 && !a.preview && !a.cameraView && a.playback.time === 2 && before === JSON.stringify(a.store.document) && hist === a
        .history.entries.length };
  });
  const bytes = Buffer.from(video.bytes);
  fs.writeFileSync(`${OUT}/sample-10s-30fps.mp4`, bytes);
  const info = mp4Info(bytes);
  ok('10s/30fps视频300帧，末样本299/30；取消/失败恢复预览与文档', video.frames === 300 && video.last === 299 / 30 && video.cancelled && video.failed && video.restored &&
    info.frames === 300, JSON.stringify({ ...video, bytes: undefined, info }));
  fs.writeFileSync(`${OUT}/video-info.json`, JSON.stringify({ ...video, bytes: undefined, info }, null, 2));
  // 已存在存档不会被新鲜启动覆盖；明确恢复仍保留旧场景。
  const saved = await page.evaluate(async () => {
    const a = window.__app;
    a.stopPreview();
    a.timeline.setDuration(7);
    const text = JSON.stringify(a
      .exportDocument());
    localStorage.setItem('director-stage:autosave', text);
    return text;
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__app?.ready);
  await settle(1200);
  ok('刷新不累积对象、不覆盖旧存档', await page.evaluate(text => window.__app.entities.length === 3 && localStorage.getItem('director-stage:autosave') === text, saved));
  await page.evaluate(async (text) => window.__app.loadDocument(JSON.parse(text)), saved);
  ok('旧双人场景恢复保留实体和7秒时长', await page.evaluate(() => window.__app.entities.filter(e => e.type === 'character').length === 2 && window.__app.timeline
    .duration === 7));
  // 加载资源失败：不能 ready，遮罩阻止交互；解除故障后点击重试。
  let fail = true;
  const intercept = req => {
    if (fail && /\.glb(?:\?|$)/.test(req.url()))
      req.abort();
    else
      req.continue();
  };
  await page.setRequestInterception(true);
  page.on('request', intercept);
  const oldErrors = errs.length;
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.startup button');
  await page.screenshot({ path: `${OUT}/loading-error.png` });
  ok('资源失败不暴露半成品，提供重试', await page.evaluate(() => !window.__app.ready && window.__app.entities.length === 0 && document.querySelector('#app').inert));
  const expected = errs.splice(oldErrors);
  ok('故障注入只产生预期资源错误', expected.every(e => e.includes('ERR_FAILED') || e.includes('ERR_ABORTED')), expected.join(' | '));
  fail = false;
  await page.click('.startup button');
  await page.waitForFunction(() => window.__app.ready);
  page.off('request', intercept);
  await page.setRequestInterception(false);
  ok('重试成功恢复完整默认场景', await page.evaluate(() => window.__app.entities.length === 3 && !document.querySelector('#app').inert));
  await checkPreviewLayout();
  await checkIndependentDirectorView();
}
async function checkPreviewLayout() {
  await page.evaluate(() => localStorage.clear());
  await page.setViewport({ width: 1440, height: 810, deviceScaleFactor: 1 });
  await openApp();
  const OUT = 'test-output/director/checkPreviewLayout';
  const rects = () => Object.fromEntries(['#viewport', '#stageTools', '#dock', '.ai-capsule', '#timeline', '.side.left', '.side.right'].map(s => [s,
    document.querySelector(s).getBoundingClientRect().toJSON()]));
  fs.mkdirSync(OUT, { recursive: true });
  for (const name of ['reference-standing', 'bench-seated']) {
    const doc = JSON.parse(fs.readFileSync(`e2e/fixtures/${name}.json`, 'utf8'));
    await page.evaluate(async (doc) => {
      const a = window.__app;
      a.stopPreview();
      await a.loadDocument(doc);
      a.setRatio('auto');
      a
        .setCameraView(true);
      a.playback.seek(0);
    }, doc);
    await settle(150);
    const before = await page.evaluate(rects);
    const state = await page.evaluate(() => {
      const a = window.__app;
      a.beforeRender();
      a.stage.render();
      return { projection: a.getRenderCamera()
          .projectionMatrix.toArray(), ground: a.stage.groundGroup.visible, grid: a.stage.grid.visible, labels: a.labels.debugRects().filter(x => !x.text
          .startsWith('机位')) };
    });
    await page.screenshot({ path: `${OUT}/${name}-before.png` });
    await page.evaluate(() => { const a = window.__app; a.startPreview({ play: false }); a.beforeRender(); a.stage.render(); });
    await settle(60);
    await page.screenshot({ path: `${OUT}/${name}-paused.png` });
    const after = await page.evaluate(rects);
    const preview = await page.evaluate(() => {
      const a = window.__app;
      return { projection: a.getRenderCamera().projectionMatrix.toArray(), ground: a
          .stage.groundGroup.visible, grid: a.stage.grid.visible, aspect: a.getRenderCamera().aspect, viewport: a.viewportAspect(), frame: a.rig
          .frameRect, hidden: getComputedStyle(a.rig.frameEl).display === 'none', scissor: a.stage.renderer.getScissorTest(), labels: a.labelSprites
          .debugRects(a.getRenderCamera(), a.stage.viewport.clientWidth, a.stage.viewport.clientHeight) };
    });
    ok(`${name} 播放前后所有布局边界完全一致、同时间同机位投影不变`, JSON.stringify(before) === JSON.stringify(after) && JSON.stringify(state.projection) === JSON
      .stringify(preview.projection));
    ok(`${name} 全视口无框/遮罩/留边，地面网格不变`, preview.hidden && preview.frame === null && !preview.scissor && preview.aspect === preview.viewport && state
      .ground === preview.ground && state.grid === preview.grid);
    const labelDelta = state.labels.map(a => {
      const b = preview.labels.find(b => b.text === a.text);
      return b ? Math.max(Math.abs(a.h - b.h), Math
        .abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.x - b.x)) : Infinity;
    });
    ok(`${name} 播放名牌位置和字号变化≤2px`, labelDelta.every(n => n <= 2), JSON.stringify(labelDelta));
    await page.evaluate(() => window.__app.startPreview());
    await settle(200);
    await page.screenshot({ path: `${OUT}/${name}-playing.png` });
    await page.evaluate(() => window.__app.playback.pause());
    await page.setViewport({ width: 1440, height: 810 });
    await settle(100);
    ok(`${name} 暂停后resize仍铺满视口`, await page.evaluate(() => Math.abs(window.__app.getRenderCamera().aspect - window.__app.viewportAspect()) < 1e-9));
    await page.setViewport({ width: 1920, height: 1080 });
    await settle(100);
    await page.evaluate(() => { const a = window.__app; a.setRatio('9:16'); a.stopPreview(); });
    ok(`${name} 退出恢复显式编辑取景框`, await page.evaluate(() => window.__app.rig.ratio === 9 / 16 && window.__app.rig.frameRect !== null));
  }
  await page.evaluate(() => { const a = window.__app; a.setRatio('auto'); a.setCameraView(true); a.playback.seek(0); });
  await settle(100);
  await page.screenshot({ path: `${OUT}/final.png` });
  const styles = await page.evaluate(() => Object.fromEntries(['#dock', '.ai-input', '.tl-head', '.tl-presence', '.tl-clock', '.tl-key', '.label3d']
    .map(s => {
    const e = document.querySelector(s), c = e && getComputedStyle(e);
    return [s, c ? { radius: c.borderRadius, font: c.fontSize, height: c.height, color: c.color, background: c.backgroundColor } : null];
  })));
  fs.writeFileSync(`${OUT}/measurements.json`, JSON.stringify({ styles }, null, 2));
  comparison();
  // 同尺寸参考与实际 UI 裁区；3D 舞台不参与差异比较。
  function comparison() {
    // 私有评审图仅在本地提供；缺少时不生成对比附件，功能断言照常执行。
    const referencePath = 'docs/references/director-round2-02.png';
    if (!fs.existsSync(referencePath)) {
      console.log('跳过 UI 对比附件：未提供本地私有评审图');
      return;
    }
    const source = PNG.sync.read(fs.readFileSync(referencePath));
    const current = PNG.sync.read(fs.readFileSync(`${OUT}/final.png`));
    const ref = new PNG({ width: 1920, height: 1080 });
    for (let y = 0; y < 1080; y++)
      for (let x = 0; x < 1920; x++) {
        const from = (Math.min(source.height - 1, Math.floor(y * source.height / 1080)) * source.width + Math.min(source.width - 1, Math
          .floor(x * source.width / 1920))) * 4;
        source.data.copy(ref.data, (y * 1920 + x) * 4, from, from + 4);
      }
    fs.writeFileSync(`${OUT}/reference-1920x1080.png`, PNG.sync.write(ref));
    for (const [name, x, y, w, h] of [['sidebar', 0, 0, 309, 778], ['dock-ai', 752, 712, 416, 66], ['transport', 0, 778, 354, 41], ['tracks', 0, 819,
        700, 240], ['views', 850, 0, 220, 65]]) {
      const paired = new PNG({ width: w * 2, height: h }), overlay = new PNG({ width: w, height: h }), diff = new PNG({ width: w, height: h });
      PNG.bitblt(ref, paired, x, y, w, h, 0, 0);
      PNG.bitblt(current, paired, x, y, w, h, w, 0);
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++)
          for (let c = 0; c < 4; c++) {
            const src = ((y + j) * 1920 + x + i) * 4 + c, dst = (j * w + i) * 4 + c;
            overlay.data[dst] = c === 3 ? 255 : Math.round((ref.data[src] + current.data[src]) / 2);
            diff.data[dst] = c === 3 ? 255 : Math.abs(ref.data[src] - current.data[src]);
          }
      fs.writeFileSync(`${OUT}/${name}-compare.png`, PNG.sync.write(paired));
      fs.writeFileSync(`${OUT}/${name}-overlay.png`, PNG.sync.write(overlay));
      fs.writeFileSync(`${OUT}/${name}-diff.png`, PNG.sync.write(diff));
    }
  }
}
async function checkIndependentDirectorView() {
  await page.evaluate(() => localStorage.clear());
  await page.setViewport({ width: 1440, height: 810, deviceScaleFactor: 1 });
  await openApp();
  const OUT = 'test-output/director/checkIndependentDirectorView';
  const snap = async (name) => { await page.mouse.move(450, 30); await settle(220); await page.screenshot({ path: `${OUT}/${name}.png` }); };
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  await page.evaluateOnNewDocument(() => {
    window.startupHandles = [];
    const sample = () => {
      const a = window.__app;
      if (a)
        window.startupHandles.push({ ready: !!a.ready, visible: a.gizmo.visible, enabled: a.gizmo.control.enabled });
      if (!a?.ready || window.startupHandles.filter(s => s.ready).length < 5)
        requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.setViewport({ width: 1440, height: 900 });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__app?.ready);
  await settle(300);
  const seed = await page.evaluate(() => window.__app.exportDocument());
  ok('首帧到ready后均无可见/可拾取变换手柄', await page.evaluate(() => window.startupHandles.length > 0 && window.startupHandles.every(s => !s.visible && !s.enabled)));
  await snap('startup-no-gizmo');
  ok('默认导演视角显示机身、标签、视锥和导航', await page.evaluate(() => {
    const a = window.__app, c = a.cameras[0];
    return c.body.visible && c.helper.visible && c
      .helper.geometry.drawRange.count > 0 && c.labelEl.style.display !== 'none' && !!document.querySelector('#navsvg circle');
  }));
  const projections = [];
  for (const [width, height] of [[1440, 900], [1920, 1080]]) {
    await page.setViewport({ width, height });
    await settle();
    for (const ratio of ['16:9', '9:16']) {
      await page.evaluate(r => window.__app.setRatio(r), ratio);
      const result = await page.evaluate(async () => {
        const a = window.__app, { worldBox } = await import('/src/util/measure.js');
        a.beforeRender();
        const cam = a.cameras[0].cam, director = a.stage.camera, V = director.position.constructor;
        const points = a.entities.filter(e => e.type === 'character').flatMap(e => {
          const b = worldBox(e.root, { useBones: true }), c = b
            .getCenter(new V());
          return [c.clone().setY(b.min.y), c.clone().setY(b.max.y)];
        });
        const stable = points.map(p => p.clone().project(director).toArray());
        a.setCameraView(true);
        a.beforeRender();
        const clean = a.cameras.every(c => !c.body.visible && !c.helper.visible);
        a.setCameraView(false);
        window.__timelinePanel.setCollapsed(false);
        a.beforeRender();
        return { position: director.position.toArray(), target: a.rig.controls.target.toArray(), fov: director.fov, cameraPosition: cam
            .getWorldPosition(new V()).toArray(), cameraTarget: a.cameras[0].lookTarget.toArray(), clean, restored: a.cameras[0].body.visible && a
            .cameras[0].helper.visible, stable: JSON.stringify(stable) === JSON.stringify(points.map(p => p.clone().project(director).toArray())),
              gizmo: a.gizmo.visible };
      });
      projections.push({ width, height, ratio, ...result });
      ok(`${width}×${height} ${ratio} 导演与机位独立、切换/时间轴不跳动且辅助元素恢复`, result.position.every((v, i) => Math.abs(v - [2, 3.2, 13][i]) < 1e-6) && result
        .target.join() === '0,0.8,3' && result.fov === 50 && result.cameraPosition.join() === '0,2.2,10' && result.cameraTarget
        .join() === '0,1.2,0' && result.clean && result.restored && result.stable && !result.gizmo, JSON.stringify(result));
      if (ratio === '16:9') {
        await snap(`director-${width}x${height}`);
        await page.evaluate(() => window.__app.setCameraView(true));
        await snap(`camera-${width}x${height}`);
        await page.evaluate(() => window.__app.setCameraView(false));
      }
      await page.evaluate(() => window.__timelinePanel.setCollapsed(true));
    }
  }
  await page.setViewport({ width: 1440, height: 900 });
  const sync = await page.evaluate(() => {
    const a = window.__app, c = a.cameras[0], director = a.stage.camera;
    const position = director.position.clone(), direction = director.quaternion.clone(), target = a.rig.controls.target.clone();
    c.lookTarget.y = -.9;
    c.aimAt(c.lookTarget);
    c.root.position.x = .3;
    c.setFov(55);
    a.edited(c);
    a.beforeRender();
    return { fov: director.fov, position: director.position.distanceTo(position), direction: director.quaternion.angleTo(direction), target: a.rig
        .controls.target.distanceTo(target), cameraChanged: c.fov === 55 && c.root.position.x === .3 && c.lookTarget.y === -.9 };
  });
  ok('机位位置/朝向/FOV修改不覆盖独立导演视角', sync.fov === 50 && sync.position < 1e-6 && sync.direction < 1e-6 && sync.target < 1e-6 && sync.cameraChanged, JSON
    .stringify(sync));
  const cameraBefore = await page.evaluate(() => JSON.stringify(window.__app.cameras[0].toJSON()));
  await page.mouse.move(800, 210);
  await page.mouse.down();
  await page.mouse.move(900, 260, { steps: 15 });
  await page.mouse.up();
  await settle(800);
  const detached = await page.evaluate(before => {
    const a = window.__app, c = a.cameras[0], p = a.stage.camera.position.clone(), q = a.stage.camera.quaternion.clone();
    const unchanged = JSON.stringify(c.toJSON()) === before;
    c.lookTarget.y = -.71;
    c.aimAt(c.lookTarget);
    c.setFov(50);
    a.edited(c);
    a.beforeRender();
    return a.directorDetached && unchanged && p.distanceTo(a.stage.camera.position) < 1e-8 && q.angleTo(a.stage.camera.quaternion) < 1e-6;
  }, cameraBefore);
  ok('真实环绕不写机位；后续机位编辑不覆盖观察视角', detached);
  await page.click('#navg');
  await settle();
  ok('reset恢复导演home，保留机位编辑', await page.evaluate(() => {
    const a = window.__app;
    a.beforeRender();
    return a.directorDetached && a.stage.camera
      .fov === 50 && a.stage.camera.position.toArray().every((v, i) => Math.abs(v - [2, 3.2, 13][i]) < 1e-6) && a.rig.controls.target.toArray()
      .join() === '0,0.8,3' && a.cameras[0].root.position.x === .3 && a.cameras[0].lookTarget.y === -.71;
  }));
  const persistence = await page.evaluate(async (seed) => {
    const a = window.__app;
    const d = a.exportDocument();
    await a.loadDocument(d, { applyView: true });
    const current = a.directorDetached && JSON.stringify(a.exportDocument().meta.editorView) === JSON.stringify(d.meta.editorView) && JSON.stringify(a
      .exportDocument().entities.filter(e => e.type === 'camera')) === JSON.stringify(d.entities.filter(e => e.type === 'camera'));
    const old = structuredClone(seed);
    delete old.meta.editorView.fov;
    const oldCam = JSON.stringify(old.entities.filter(e => e.type === 'camera'));
    await a.loadDocument(old, { applyView: true });
    const legacy = a.stage.camera.fov === 40 && a.directorDetached && JSON.stringify(a.exportDocument().entities.filter(e => e.type === 'camera')) === oldCam;
    a.stage.camera.fov = 70;
    a.resetView();
    const home = a.stage.camera.fov === 40;
    await a.loadDocument(seed, { applyView: true });
    return { current, legacy, home };
  }, seed);
  ok('独立导演视角完整保存恢复；旧字段缺失40；机位不改写；home带FOV', Object.values(persistence).every(Boolean), JSON.stringify(persistence));
  await page.evaluate(() => {
    const a = window.__app;
    a.select(a.entities[0].id, { activateTransform: false });
    a.withCleanRender(() => a.stage
      .snapshot(a.cameras[0].cam, { width: 160, height: 90 }));
    a.playback.seek(1);
    a.playback.stop();
  });
  await page.setViewport({ width: 1450, height: 900 });
  await settle();
  ok('恢复/截图结束/播放停止/resize不重新激活首屏手柄', await page.evaluate(() => !window.__app.gizmo.visible && !window.__app.gizmo.control.enabled));
  await page.setViewport({ width: 1440, height: 900 });
  await pickInOutliner('角色A');
  await page.evaluate(() => { window.__app.history.reset(); window.actorBefore = window.__app.selected.toJSON().transform.pos; });
  await gizmoDrag('x', .5);
  const drag = await page.evaluate(async () => {
    const a = window.__app;
    const changed = Math.abs(a.selected.toJSON().transform.pos[0] - window
      .actorBefore[0]) > .2;
    await a.history.undo();
    return { changed, restored: JSON.stringify(a.selected.toJSON().transform.pos) === JSON
        .stringify(window.actorBefore), enabled: a.gizmo.control.enabled };
  });
  ok('明确选择后真实拖动并一步撤销', drag.changed && drag.restored && drag.enabled, JSON.stringify(drag));
  await page.evaluate(() => window.__app.select(null));
  ok('取消选择同步禁用隐藏手柄', await page.evaluate(() => !window.__app.gizmo.visible && !window.__app.gizmo.control.enabled));
  fs.writeFileSync(`${OUT}/measurements.json`, JSON.stringify({ projections, sync, persistence, drag }, null, 2));
}
