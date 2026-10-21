import fs from 'node:fs';
import path from 'node:path';
import { page, browser, ok, errs } from '../harness.mjs';
import { pixelDiff, sleep, settle, clickSel, md5, dataURLBuf, buildExportScene, exportState, ffprobe, mp4Info } from '../helpers.mjs';

export async function run() {
  const OUT = 'test-output/export';
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(`${OUT}/frames`, { recursive: true });
  // 主画布需 ≥ 1920×1080，stage.snapshot(1920×1080) 才不缩小（验收 3 对比用）
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 2 });
  await page.evaluate(() => { const st = window.__app.stage; st.renderer.setPixelRatio(2); st.onResize(); }); // 像素比只在启动时读取
  await page.exposeFunction('__saveFile', (name, url) => fs.writeFileSync(`${OUT}/${name}`, dataURLBuf(url)));
  const ids = await buildExportScene();
  ok('导出场景：走路角色 + 半环绕主机位 + 全景', ids.seg && ids.pano, JSON.stringify(ids));
  await settle(200);

  // ---- 验收 3 帧 = 快照 ----
  await page.evaluate(async () => {
    const a = window.__app;
    const { renderFrame } = await import('/src/app/VideoExporter.js');
    const cam = a.findCamera(a.timeline.mainCameraId);
    const fr = await renderFrame(a, 2.0, { width: 1920, height: 1080 });
    await window.__saveFile('03_frame.png', fr.toDataURL('image/png'));
    a.timeline.evaluate(2.0);
    const snap = a.withCleanRender(() => a.stage.snapshot(cam.cam, { width: 1920, height: 1080 }));
    await window.__saveFile('03_snapshot.png', snap.toDataURL('image/png'));
    a.playback.stop();
  });
  const d3 = pixelDiff(`${OUT}/03_frame.png`, `${OUT}/03_snapshot.png`, `${OUT}/03_diff.png`);
  ok('验收3 renderFrame(2.0) ≡ evaluate(2.0) 后 snapshot(主机位, 1920×1080)', d3 < 0.005, `差异 ${(d3 * 100).toFixed(4)}%`);

  // ---- 验收 4 离线确定性 + 播放头 / 文档 / 撤销不变 ----
  await page.evaluate(() => window.__app.playback.seek(1.25)); // 导出前处于 active（暂停在 1.25 s）
  await settle();
  const before = await exportState();
  const runs = [];
  for (let run = 0; run < 2; run++) {
    const hashes = await page.evaluate(async (run) => {
      const a = window.__app;
      const { renderFrames, pixelsToCanvas } = await import('/src/app/VideoExporter.js');
      const out = [];
      await renderFrames(a, { width: 1280, height: 720, fps: 30, range: [0, 1] }, async (px, { i, width, height }) => {
        const url = pixelsToCanvas(px, width, height).toDataURL('image/png');
        out.push(url.length);
        await window.__saveFile(`frames/run${run}_${String(i).padStart(3, '0')}.png`, url);
      });
      return out.length;
    }, run);
    runs.push(hashes);
  }
  const files = (r) => fs.readdirSync(`${OUT}/frames`).filter((f) => f.startsWith(`run${r}_`)).sort();
  const h0 = files(0).map((f) => md5(fs.readFileSync(`${OUT}/frames/${f}`)));
  const h1 = files(1).map((f) => md5(fs.readFileSync(`${OUT}/frames/${f}`)));
  const same = h0.length === 30 && h0.every((h, i) => h === h1[i]);
  const moving = new Set(h0).size > 20; // 角色在走、机位在转：帧应各不相同
  ok('验收4 同一文档导出两次 30 帧 PNG 序列逐帧 md5 相同', same && moving, `帧数 ${runs.join('/')}，不同帧 ${new Set(h0).size}/30`);
  const after = await exportState();
  ok('验收4 导出后播放头回到导出前（时间 + active）、exportDocument 不变、History 不变',
    after.active === before.active && after.time === before.time && after.doc === before.doc && after.hist === before.hist && after.idx === before.idx,
    `active ${before.active}→${after.active} t ${before.time}→${after.time} doc ${after.doc === before.doc} hist ${before.hist}/${before.idx}→${after.hist}/${after.idx}`);
  await page.evaluate(() => window.__app.playback.stop());
  const idleBefore = await exportState();
  await page.evaluate(async () => {
    const { renderFrames } = await import('/src/app/VideoExporter.js');
    await renderFrames(window.__app, { width: 320, height: 180, fps: 10, range: [0, 0.5] });
  });
  const idleAfter = await exportState();
  ok('验收4 导出前 idle → 导出后仍 idle、文档不变', !idleAfter.active && idleAfter.time === 0 && idleAfter.doc === idleBefore.doc, `active=${idleAfter.active} t=${idleAfter.time}`);

  // ---- 验收 1 / 2 名牌进画面、位置一致 ----
  const lab = await page.evaluate(async (ids) => {
    const a = window.__app;
    const { labelAnchor } = await import('/src/app/Labels.js');
    const cam = a.findCamera(a.timeline.mainCameraId);
    const W = 1920, H = 1080;
    const layer = document.getElementById('labelLayer');
    const m = a.findEntity(ids.m);
    /** 1080p 快照 + 角色 m 名牌锚点在画面里的像素坐标（与 DOM 名牌同一套 labelAnchor + project）。 */
    const shoot = (file) => {
      cam.cam.aspect = W / H; cam.cam.updateProjectionMatrix();
      const p = labelAnchor(m, a.stage.world.scale.y, m.root.position.clone()).project(cam.cam);
      const cv = a.withCleanRender(() => a.stage.snapshot(cam.cam, { width: W, height: H }));
      window.__saveFile(file, cv.toDataURL('image/png'));
      const ax = (p.x * 0.5 + 0.5) * W, ay = (-p.y * 0.5 + 0.5) * H;
      // 无底白字：采样实际精灵框，白字占比不能变成实心白色气泡。
      const box = a.labelSprites.debugRects(cam.cam, W, H).find(r => r.text === m.name);
      const x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y));
      const w = Math.ceil(box.w), h = Math.ceil(box.h);
      const px = cv.getContext('2d').getImageData(x0, y0, w, h).data;
      let n = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] > 245 && px[i+1] > 245 && px[i+2] > 245) n++;
      return { ax, ay, n, fraction: n / (w*h), bx: box.x + box.w/2, by: box.y + box.h, bh: box.h, bw: box.w };

    };
    a.playback.stop();
    a.setLabelPreview(true);
    await new Promise((r) => setTimeout(r, 100));
    const on = shoot('01_labels_on.png');
    const onState = { dom: getComputedStyle(layer).display, sprites: a.labelSprites.group.children.length, vis: a.labelSprites.debugItem(m).visible };
    a.setLabelPreview(false);
    await new Promise((r) => setTimeout(r, 100));
    const offState = { dom: getComputedStyle(layer).display, sprites: a.labelSprites.group.children.length, groupVis: a.labelSprites.group.visible };
    a.setLabelsVisible(false);
    a.setLabelPreview(true);
    const hidden = shoot('01_labels_scene_off.png');
    const hiddenState = { dom: getComputedStyle(layer).display, groupVis: a.labelSprites.group.visible };
    a.setLabelPreview(false);
    a.setLabelsVisible(true);
    return { on, onState, offState, hidden, hiddenState };
  }, ids);
  ok('验收1 精灵名牌：快照里采到白字，透明底不出现白色气泡；DOM 名牌层隐藏',
    lab.on.n > 50 && lab.on.fraction < .65 && lab.onState.dom === 'none' && lab.onState.vis && lab.onState.sprites >= 2,
    `白字像素 ${lab.on.n}，DOM=${lab.onState.dom}，精灵 ${lab.onState.sprites}`);
  ok('验收1 关闭后 DOM 恢复、精灵移除；scene.labels=false 时两者都不显示',
    lab.offState.dom === 'block' && lab.offState.sprites === 0 && !lab.offState.groupVis && lab.hidden.n === 0 && lab.hiddenState.dom === 'none' && !lab.hiddenState.groupVis,
    `关闭：DOM=${lab.offState.dom} 精灵 ${lab.offState.sprites}；labels=false：白字 ${lab.hidden.n} DOM=${lab.hiddenState.dom}`);
  const dpos = Math.hypot(lab.on.bx - lab.on.ax, lab.on.by - (lab.on.ay - .35 * lab.on.bh));
  ok('验收2 精灵名牌框底边中点 与 DOM 名牌偏移后锚点 差 < 4 px（1080p）', dpos < 4,
    `锚点 (${lab.on.ax.toFixed(1)}, ${lab.on.ay.toFixed(1)}) 名牌底 (${lab.on.bx.toFixed(1)}, ${lab.on.by}) 差 ${dpos.toFixed(2)} px，框宽 ${lab.on.bw}`);

  // ---- 验收 5 分辨率与比例 ----
  const sizes = await page.evaluate(async () => {
    const { exportSize, EXPORT_RESOLUTIONS } = await import('/src/app/VideoExporter.js');
    const { RATIO_OPTIONS } = await import('/src/config.js');
    const all = RATIO_OPTIONS.flatMap(([r]) => EXPORT_RESOLUTIONS.map((x) => ({ r, ...exportSize(r, x.short) })));
    return { v916: exportSize('9:16', 1080), auto: exportSize('auto', 1080), odd: all.filter((x) => x.width % 2 || x.height % 2), all };
  });
  ok('验收5 9:16 + 1080p → 1080×1920；auto → 1920×1080；全部比例 × 分辨率宽高均为偶数',
    sizes.v916.width === 1080 && sizes.v916.height === 1920 && sizes.auto.width === 1920 && sizes.auto.height === 1080 && !sizes.odd.length,
    `9:16=${sizes.v916.width}×${sizes.v916.height} auto=${sizes.auto.width}×${sizes.auto.height} 奇数 ${sizes.odd.length}/${sizes.all.length}`);

  // ---- 导出弹层（真实点击）----
  const dl = path.resolve(`${OUT}/downloads`);
  fs.mkdirSync(dl, { recursive: true });
  const bcdp = await browser.target().createCDPSession();
  await bcdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
  const openExport = async () => {
    await clickSel('#sceneActions .dockbtn[title^="场景"]');
    await page.evaluate(() => [...document.querySelectorAll('.dockmenu.open .menu-item')].find((n) => n.textContent.includes('导出视频')).click());
    await page.waitForSelector('.export-box');
    await settle();
  };
  const setField = (name, value) => page.evaluate((name, value) => {
    const n = document.querySelector(`.export-box [data-name="${name}"]`);
    if (n.type === 'checkbox') n.checked = value; else n.value = String(value);
    n.dispatchEvent(new Event('change'));
  }, name, value);
  const boxClip = () => page.$eval('.export-box', (n) => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
  await page.evaluate(() => { window.__app.setRatio('9:16'); });
  await openExport();
  const resLabel = await page.$eval('.export-box [data-name="res"]', (s) => s.selectedOptions[0].textContent);
  await page.evaluate(() => window.__exportModal.close());
  await page.evaluate(() => { window.__app.setRatio('auto'); });
  ok('验收5 弹层分辨率显示随取景比例（9:16 1080p）', resLabel.includes('1080×1920'), resLabel);

  // ---- 验收 6 MP4 文件：3 s · 30 fps · 1080p（弹层导出 + 自动下载）----
  await openExport();
  await setField('res', 1080);
  await setField('fps', 30);
  await setField('range', 'custom');
  await setField('t0', 0);
  await setField('t1', 3);
  const est = await page.$eval('.export-box .ex-est', (n) => n.textContent);
  const camLine = await page.$eval('.export-box .ex-cam', (n) => n.textContent);
  await page.screenshot({ path: `${OUT}/11_modal.png`, clip: await boxClip() });
  const hist0 = await page.evaluate(() => window.__app.history.entries.length);
  await clickSel('.export-box .ex-start');
  await page.waitForFunction(() => { const t = document.querySelector('.export-box .ex-ptext')?.textContent || ''; const m = /帧 (\d+)\/(\d+)/.exec(t); return m && +m[1] >= +m[2] * 0.3; }, { timeout: 120000 });
  const locked = await page.evaluate(() => ({ body: document.body.classList.contains('exporting'), tl: getComputedStyle(document.getElementById('timeline')).pointerEvents, dock: getComputedStyle(document.getElementById('dock')).opacity }));
  await page.screenshot({ path: `${OUT}/11_progress.png` });
  await page.waitForFunction(() => !document.querySelector('.export-box'), { timeout: 300000 });
  const mp4Name = '未命名场景_1920x1080_30fps.mp4';
  const done = () => fs.existsSync(path.join(dl, mp4Name)) && fs.statSync(path.join(dl, mp4Name)).size > 0 && !fs.readdirSync(dl).some((f) => f.endsWith('.crdownload'));
  for (let i = 0; i < 100 && !done(); i++) await sleep(100);
  const mp4Path = path.join(dl, mp4Name);
  const exists = fs.existsSync(mp4Path);
  const size = exists ? fs.statSync(mp4Path).size : 0;
  ok('弹层：机位行显示主机位、估算 90 帧 3 s；导出中界面锁住', camLine.includes('主机位') && est.includes('90 帧') && est.includes('3 s') && locked.body && locked.tl === 'none',
    `${camLine} | ${est} | ${JSON.stringify(locked)}`);
  ok('验收6 MP4 文件存在且 ≥ 100 KB（自动下载，文件名 名称_宽x高_fps）', exists && size >= 100 * 1024, `${mp4Name} ${(size / 1024).toFixed(0)} KB`);
  if (exists) {
    const box = mp4Info(fs.readFileSync(mp4Path));
    ok('验收6 mp4 盒子解析（mvhd / tkhd / stsz / avc1）：3.00 s、90 帧、avc1、1920×1080',
      Math.abs(box.duration - 3) <= 0.05 && box.frames === 90 && box.codec === 'avc1' && box.width === 1920 && box.height === 1080, JSON.stringify(box));
    const fp = ffprobe(mp4Path);
    if (fp) ok('验收6 ffprobe：3.00 ± 0.05 s、90 帧、h264、1920×1080',
      Math.abs(fp.duration - 3) <= 0.05 && fp.frames === 90 && fp.codec === 'h264' && fp.width === 1920 && fp.height === 1080, JSON.stringify(fp));
    else console.log('ℹ️  本机无 ffprobe：验收6 只用 mp4 盒子解析器验证');
  }
  const hist1 = await page.evaluate(() => window.__app.history.entries.length);
  ok('导出不记撤销', hist1 === hist0, `${hist0}→${hist1}`);

  // ---- 验收 7 取消 ----
  await page.evaluate(() => window.__app.playback.seek(0.75));
  const cBefore = await exportState();
  const filesBefore = fs.readdirSync(dl).length;
  const errsBefore = errs.length;
  await openExport();
  await setField('res', 720);
  await setField('range', 'all');
  await clickSel('.export-box .ex-start');
  await page.waitForFunction(() => { const t = document.querySelector('.export-box .ex-ptext')?.textContent || ''; const m = /帧 (\d+)\/(\d+)/.exec(t); return m && +m[1] >= +m[2] * 0.3; }, { timeout: 120000 });
  const at = await page.$eval('.export-box .ex-ptext', (n) => n.textContent);
  await page.keyboard.press('Escape'); // Esc = 取消
  await page.waitForFunction(() => !window.__app.exporting, { timeout: 30000 });
  await sleep(800);
  const cAfter = await exportState();
  const ui7 = await page.evaluate(() => ({ body: document.body.classList.contains('exporting'), start: !document.querySelector('.export-box .ex-start').hidden, tl: getComputedStyle(document.getElementById('timeline')).pointerEvents }));
  ok('验收7 导出到 30% 取消：无文件、播放头恢复、UI 解锁、无 console 错误',
    fs.readdirSync(dl).length === filesBefore && cAfter.time === cBefore.time && cAfter.active === cBefore.active && cAfter.doc === cBefore.doc
      && !ui7.body && ui7.start && ui7.tl !== 'none' && errs.length === errsBefore,
    `取消于「${at}」，文件 ${filesBefore}→${fs.readdirSync(dl).length}，t ${cBefore.time}→${cAfter.time}，UI ${JSON.stringify(ui7)}`);
  await page.evaluate(() => window.__exportModal.close());
  await page.evaluate(() => window.__app.playback.stop());

  // ---- 验收 8 不支持的浏览器 ----
  const unsup = await page.evaluate(async () => {
    window.__VE = window.VideoEncoder;
    window.VideoEncoder = undefined;
    document.querySelector('#sceneActions .dockbtn[title^="场景"]').click();
    const item = [...document.querySelectorAll('.dockmenu.open .menu-item')].find((n) => n.textContent.includes('导出视频'));
    const greyed = item.classList.contains('unsupported');
    item.click();
    const t = document.getElementById('toast').textContent;
    const noModal = !document.querySelector('.export-box');
    window.__exportModal.open();
    await new Promise((r) => setTimeout(r, 50));
    const btn = document.querySelector('.export-box .ex-start').disabled;
    const hint = document.querySelector('.export-box .ex-unsup');
    const res = { greyed, toast: t, noModal, btnDisabled: btn, hint: hint.hidden ? '' : hint.textContent };
    window.__exportModal.close();
    window.VideoEncoder = window.__VE;
    return res;
  });
  ok('验收8 window.VideoEncoder = undefined → 菜单项置灰 + 提示、弹层「开始导出」禁用',
    unsup.greyed && unsup.toast.includes('Chrome 或 Edge') && unsup.noModal && unsup.btnDisabled && unsup.hint.includes('Chrome 或 Edge'), JSON.stringify(unsup));

  // ---- 验收 9 导出帧干净：选中走路角色（gizmo + 选中环 + 路径线）、导演视角（机位视锥）----
  const clean = await page.evaluate(async (ids) => {
    const a = window.__app;
    const { renderFrame } = await import('/src/app/VideoExporter.js');
    const W = 960, H = 540;
    // 此颜色探针专测辅助物：显式绿色夹具避免把新蓝/红角色材质误判为 gizmo。
    for (const e of a.entities.filter(e => e.type === 'character')) { e.setColor('#34c759'); a.edited(e); }
    a.playback.stop();
    a.setCameraView(false);
    const plain = (await renderFrame(a, 1.0, { width: W, height: H })).toDataURL('image/png');
    a.select(ids.m);
    a.addCamera('side_track'); // 另一个机位（视锥在主机位画面里）
    a.select(ids.m);
    await new Promise((r) => setTimeout(r, 100));
    const shown = { gizmo: a.gizmo.visible, ring: a.selection.ring.visible, path: a.pathOverlay.visible };
    const fr = await renderFrame(a, 1.0, { width: W, height: H });
    // 在路径线 / gizmo / 选中环应出现的屏幕位置采样：不含 accent 蓝、gizmo 红
    const cam = a.findCamera(a.timeline.mainCameraId).cam;
    cam.aspect = W / H; cam.updateProjectionMatrix();
    a.timeline.evaluate(1.0);
    const m = a.findEntity(ids.m);
    const pts = [];
    const path = a.timeline.toJSON().paths.find((p) => p.target === ids.m);
    const P = (x, y, z) => a.stage.world.localToWorld(m.root.position.clone().set(x, y, z));
    for (let i = 0; i <= 10; i++) {
      const [p0, p1] = path.points;
      pts.push(P(p0[0] + (p1[0] - p0[0]) * i / 10, 0.01, p0[2] + (p1[2] - p0[2]) * i / 10));
    }
    const foot = m.root.getWorldPosition(m.root.position.clone());
    pts.push(foot.clone(), foot.clone().add({ x: 0.5, y: 0, z: 0 }), foot.clone().add({ x: 0, y: 0, z: 0.5 }), foot.clone().add({ x: 0, y: 0.5, z: 0 }));
    const g = fr.getContext('2d');
    let bad = 0, sampled = 0;
    for (const p of pts) {
      const q = p.project(cam);
      if (Math.abs(q.x) > 1 || Math.abs(q.y) > 1 || q.z > 1) continue;
      const x = Math.round((q.x * 0.5 + 0.5) * W), y = Math.round((-q.y * 0.5 + 0.5) * H);
      const d = g.getImageData(Math.max(0, x - 3), Math.max(0, y - 3), 7, 7).data;
      sampled++;
      for (let i = 0; i < d.length; i += 4) {
        const [r, gg, b] = [d[i], d[i + 1], d[i + 2]];
        if ((b > 200 && r < 120 && gg > 90 && gg < 190) || (r > 200 && gg < 90 && b < 90)) bad++;
      }
    }
    a.playback.stop();
    window.__saveFile('09_clean_frame.png', fr.toDataURL('image/png'));
    return { shown, sampled, bad, same: fr.toDataURL('image/png') === plain };
  }, ids);
  ok('验收9 导出帧里没有 gizmo / 选中环 / 视锥 / 路径线（采样无 accent 蓝 / 红；与未选中时的帧逐像素相同）',
    clean.shown.gizmo && clean.shown.ring && clean.shown.path && clean.sampled >= 8 && clean.bad === 0 && clean.same, JSON.stringify(clean));
  const after9 = await page.evaluate(() => ({ gizmo: window.__app.gizmo.visible, ring: window.__app.selection.ring.visible, path: window.__app.pathOverlay.visible }));
  ok('导出结束后 gizmo / 选中环 / 路径 overlay 恢复显示', after9.gizmo && after9.ring && after9.path, JSON.stringify(after9));

  // ---- 验收 11 示例：5 s · 1080p MP4（不入库）----
  const sample = await page.evaluate(async () => {
    const a = window.__app;
    a.select(null);
    const { exportVideo } = await import('/src/app/VideoExporter.js');
    const t = performance.now();
    const out = await exportVideo(a, { width: 1920, height: 1080, fps: 30, range: [0, 5] });
    const url = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(out.blob); });
    await window.__saveFile('sample.mp4', url);
    return { ms: Math.round(performance.now() - t), size: out.blob.size, frames: out.frames };
  });
  const sp = ffprobe(`${OUT}/sample.mp4`) || mp4Info(fs.readFileSync(`${OUT}/sample.mp4`));
  ok('验收11 示例 sample.mp4：5 s · 1080p · 150 帧', sample.frames === 150 && Math.abs(sp.duration - 5) <= 0.05 && sp.frames === 150 && sp.width === 1920,
    `${(sample.size / 1048576).toFixed(2)} MB，用时 ${(sample.ms / 1000).toFixed(1)} s（headless swiftshader），${JSON.stringify(sp)}`);

  // ---- 收尾 1 · 名牌避让（DOM 与精灵同一个 layoutLabels）----
  const rectsHit = (rs) => rs.some((a, i) => rs.some((b, j) => j > i && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
  // 无重叠：导出场景（两人左右分开）避让开 / 关两次快照逐像素相同、DOM 位置相同
  const noOv = await page.evaluate(async () => {
    const a = window.__app;
    const { labelLayout } = await import('/src/app/Labels.js');
    const cam = a.findCamera(a.timeline.mainCameraId);
    a.playback.stop();
    const shot = () => { cam.cam.aspect = 16 / 9; cam.cam.updateProjectionMatrix(); return a.withCleanRender(() => a.stage.snapshot(cam.cam, { width: 1280, height: 720 })).toDataURL('image/png'); };
    const dom = () => { a.labels.update(a.entities, a.getRenderCamera(), { worldScale: a.stage.world.scale.y, hideCameras: a.cameraView }); return JSON.stringify(a.labels.debugRects()); };
    const on = shot(), domOn = dom();
    labelLayout.enabled = false;
    const off = shot(), domOff = dom();
    labelLayout.enabled = true;
    return { same: on === off, domSame: domOn === domOff, n: JSON.parse(domOn).length };
  });
  ok('名牌避让：无重叠时 快照（避让开 / 关）逐像素相同、DOM 名牌位置相同', noOv.same && noOv.domSame && noOv.n >= 2, JSON.stringify(noOv));
  // 前后站成一线：截图 / DOM 两处名牌矩形都不相交（关掉避让时相交）
  const ov = await page.evaluate(async () => {
    const { createEmptyDocument } = await import('/src/doc/schema.js');
    const { labelLayout } = await import('/src/app/Labels.js');
    const a = window.__app;
    a.playback.stop();
    await a.loadDocument(createEmptyDocument());
    const near = await a.addCharacter('male');
    const far = await a.addCharacter('female');
    near.root.position.x = 0; near.root.position.z = 0;
    far.root.position.x = 0.15; far.root.position.z = -2.5; a.edited(near); a.edited(far);
    const c = a.addCamera('front_full');
    const w = (x, y, z) => a.stage.world.localToWorld(near.root.position.clone().set(x, y, z));
    // 机位与名牌锚点同高、平视：两人名牌落在同一水平线上，必然叠在一起
    const { labelAnchor } = await import('/src/app/Labels.js');
    const hy = a.stage.world.worldToLocal(labelAnchor(near, a.stage.world.scale.y, near.root.position.clone())).y;
    c.root.position.copy(a.stage.world.worldToLocal(w(0, hy, 5)));
    c.aimAt(w(0, hy, -1)); a.edited(c);
    a.select(null);
    a.rig.controls.target.copy(w(0, hy, -1)); a.stage.camera.position.copy(w(0, hy, 5)); a.rig.controls.update();
    await new Promise((r) => setTimeout(r, 300));
    const W = 1920, H = 1080;
    const res = {};
    for (const on of [false, true]) {
      labelLayout.enabled = on;
      c.cam.aspect = W / H; c.cam.updateProjectionMatrix();
      const cv = a.withCleanRender(() => {
        const out = a.stage.snapshot(c.cam, { width: W, height: H });
        res[on ? 'sprite' : 'spriteOff'] = a.labelSprites.debugRects(c.cam, W, H);
        return out;
      });
      await window.__saveFile(on ? '20_labels_overlap.png' : '20_labels_overlap_off.png', cv.toDataURL('image/png'));
      a.labels.update(a.entities, a.getRenderCamera(), { worldScale: a.stage.world.scale.y, hideCameras: a.cameraView });
      res[on ? 'dom' : 'domOff'] = a.labels.debugRects().filter((r) => !r.text.startsWith('机位'));
    }
    labelLayout.enabled = true;
    a.stage.invalidate();
    res.far = far.name;
    return res;
  });
  await page.screenshot({ path: `${OUT}/20_labels_overlap_viewport.png` });
  const sum = (rs) => rs.map((r) => `${r.text}@(${r.x.toFixed(0)},${r.y.toFixed(0)} ${r.w.toFixed(0)}×${r.h.toFixed(0)})`).join(' ');
  ok('名牌避让：前后站位 —— 关避让时精灵 / DOM 名牌相交（构造有效）', rectsHit(ov.spriteOff) && rectsHit(ov.domOff), `精灵 ${sum(ov.spriteOff)}；DOM ${sum(ov.domOff)}`);
  const farUp = (rs) => rs.length === 2 && rs.find((r) => r.text === ov.far).y < rs.find((r) => r.text !== ov.far).y;
  ok('名牌避让：前后站位 —— 截图（精灵）与视口（DOM）名牌矩形都不相交，远的在上', farUp(ov.sprite) && farUp(ov.dom) && !rectsHit(ov.sprite) && !rectsHit(ov.dom),
    `精灵 ${sum(ov.sprite)}；DOM ${sum(ov.dom)}；截图 ${OUT}/20_labels_overlap.png`);
}
