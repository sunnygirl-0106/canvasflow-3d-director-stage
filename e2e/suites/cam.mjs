import { ok, openApp, page, twoCharacterFixture } from '../harness.mjs';
import { camAnim, camPose, camShot, clickSel, hdist, pickInOutliner, pixelDiff, scr, settle, sleep } from '../helpers.mjs';
import fs from 'node:fs';
export async function run() {
  await twoCharacterFixture();
  const OUT = 'test-output/cam';
  fs.mkdirSync(OUT, { recursive: true });
  const ids = await page.evaluate(async () => {
    const a = window.__app, { aimPoint } = await import('/src/anim/Constraint.js');
    a.playback.stop();
    const [A, B] = a.entities.filter(e => e.type === 'character').sort((x, y) => x.name.localeCompare(y.name));
    const c = a.addCamera('front_mid');
    c.aimAt(aimPoint(a, A.id));
    a.edited(c);
    a.timeline.addConstraint({ type: 'lookAt', target: c.id, subject: A.id });
    a.setRatio('auto');
    a.select(c.id, { user: true });
    a.rig.controls.target.set(0, 0, .6);
    a.stage.camera.position.set(0, 8.5, 9.5);
    a.rig.controls.update();
    a.emit('inspect', { id: c.id, section: 'move' });
    return { A: A.id, B: B.id, c1: c.id, An: A.name, c1n: c.name };
  });
  await settle();
  // Geometry checks use explicit operations; card interaction is covered by manual-motion/editor-ui.
  const apply = (name, params = {}, mode = 'replace') => page.evaluate(({ id, name, params, mode }) => {
    const a = window.__app;
    a.playback.stop();
    if (!a.cameraMoves.applyPreset(a.findCamera(id), name, { mode, params }))
      throw new Error(a.cameraMoves.error);
  }, { id: ids.c1, name, params, mode });
  const cam0 = await camPose(ids.c1), r0 = hdist(cam0.pos, cam0.foot[ids.A]);
  const originalConstraints = await page.evaluate(() => JSON.stringify(window.__app.store.document.constraints));
  const before = await camShot(ids.c1, `${OUT}/before.png`);
  await apply('half_orbit', { duration: 6, sweep: 180 });
  const geometry = await page.evaluate(async (ids) => {
    const a = window.__app, { aimPoint } = await import('/src/anim/Constraint.js');
    const c = a.findCamera(ids.c1), points = [];
    for (let i = 0; i <= 24; i++) {
      a.playback.seek(i / 4);
      const aim = aimPoint(a, ids.A);
      c.cam.updateMatrixWorld(true);
      const projected = aim.clone().applyMatrix4(a.stage.world.matrixWorld).project(c.cam);
      points.push({ p: c.root.position.toArray(), off: Math.hypot(projected.x, projected.y) });
    }
    return points;
  }, ids);
  ok('半弧维持高度与半径，独立注视始终对准主体', geometry.every(s => Math.abs(hdist(s.p, cam0.foot[ids.A]) - r0) < .01 && Math.abs(s.p[1] - cam0.pos[1]) < .001 && s.off < .02));
  ok('180° 半弧终点在主体对面', Math.abs(hdist(geometry.at(-1).p, cam0.pos) - 2 * r0) < .02);
  await page.evaluate(() => window.__app.playback.seek(0));
  const at0 = await camShot(ids.c1, `${OUT}/at-zero.png`);
  ok('首段 t=0 与应用前画面相同', pixelDiff(before, at0) === 0);
  for (const [name, params, expected] of [
    ['push_in', { amount: 1, duration: 3 }, 'push'], ['pull_out', { amount: 1, duration: 3 }, 'pull'],
    ['truck', { amount: 2, dir: 'left', duration: 3 }, 'truck'], ['crane', { amount: 1, dir: 'up', duration: 3 }, 'crane'],
  ]) {
    await apply(name, params);
    const path = (await camAnim(ids.c1)).path, end = path.points.at(-1), delta = end.map((v, i) => v - cam0.pos[i]);
    const distance = hdist(end, cam0.foot[ids.A]);
    const good = expected === 'push' ? Math.abs(distance - (r0 - 1)) < .01 : expected === 'pull' ? Math.abs(distance - (r0 + 1)) < .01
      : expected === 'crane' ? Math.abs(delta[0]) + Math.abs(delta[2]) < .001 && Math.abs(delta[1] - 1) < .001 : Math.abs(Math
        .hypot(...delta) - 2) < .001 && Math.abs(delta[1]) < .001;
    ok(`${name} 普通替换：方向、距离、原始起点正确`, good && path.duration === 3 && JSON.stringify(path.points[0]) === JSON.stringify(cam0.pos));
  }
  ok('全部普通替换保留独立注视', await page.evaluate(before => JSON.stringify(window.__app.store.document.constraints) === before, originalConstraints));
  await apply('push_in', { amount: 1, duration: 3 });
  const prefix = await camAnim(ids.c1);
  await apply('half_orbit', { sweep: 180, duration: 5 }, 'append');
  const appended = await camAnim(ids.c1);
  ok('显式追加接在末端并保留前段点与时长', appended.path.duration === 8 && JSON.stringify(appended.path.points.slice(0, prefix.path.points.length)) === JSON
    .stringify(prefix.path.points));
  const seam = await page.evaluate(id => {
    const a = window.__app, c = a.findCamera(id), pos = t => { a.playback.seek(t); return c.root.position.clone(); };
    return pos(2.995).distanceTo(pos(3.005)) / .01;
  }, ids.c1);
  ok('追加接缝位置连续并平滑停顿', seam < .05, `seam speed=${seam}`);
  ok('路径后追加摇镜头失败且原子，但普通替换可用', await page.evaluate(id => {
    const a = window.__app, c = a.findCamera(id), before = JSON.stringify(a.store.document), history = a.history.index;
    const rejected = !a.cameraMoves.applyPreset(c, 'pan', { mode: 'append' });
    const atomic = before === JSON.stringify(a.store.document) && history === a.history.index;
    return rejected && atomic && a.cameraMoves.applyPreset(c, 'pan', { mode: 'replace' }) && !a.timeline.paths.some(p => p.target === id);
  }, ids.c1));
  await page.evaluate(async () => { await window.__app.history.undo(); });
  await settle();
  ok('替换单步撤销恢复完整组合路径', JSON.stringify((await camAnim(ids.c1)).path) === JSON.stringify(appended.path));
  await page.evaluate(id => {
    const a = window.__app;
    a.playback.stop();
    a.cameraMoves.clear(a.findCamera(id));
    for (const c of [...a.timeline.constraints].filter(c => c.target === id))
      a.timeline.removeConstraint(c.id);
    a.emit('inspect', { id, section: 'path' });
  }, ids.c1);
  await settle();
  // ---- 8 机位画路径：点击落点 3 点 ----
  await page.evaluate(() => window.__app.playback.stop());
  const camY = (await camPose(ids.c1)).pos[1];
  const camP = (await camPose(ids.c1)).pos;
  await page.evaluate(id => window.__app.emit('inspect', { id, section: 'path' }), ids.c1);
  await settle();
  await page.evaluate(() => window.__timelinePanel.setCollapsed(false));
  await settle();
  const pathMenuButton = `.tl-head[data-ent="${ids.c1}"] .tl-addkey`;
  await clickSel(pathMenuButton);
  await settle();
  const towardLabel = await page.$$eval('.ctx-item', (ns) => ns.map((n) => n.textContent).join(' '));
  await page.evaluate(() => [...document.querySelectorAll('.ctx-item')].find((n) => n.textContent.includes('钢笔路径')).click());
  // 时间轴浮层会遮住靠近机位的落点；选完工具后收起再进行画布点击。
  await page.evaluate(() => window.__timelinePanel.setCollapsed(true));
  await settle();
  const hint8 = await page.$eval('.path-hint', (n) => n.textContent);
  for (const q of [[camP[0] + 1.5, camY, camP[2] + 0.6], [camP[0] + 3, camY, camP[2] - 0.8], [camP[0] + 3.4, camY, camP[2] - 2.8]]) {
    await page.mouse.click(...await scr(q));
    await settle();
  }
  await page.keyboard.press('Enter');
  await settle(150);
  const cp = (await camAnim(ids.c1)).path;
  const maxDy8 = cp ? Math.max(...cp.points.map((q) => Math.abs(q[1] - camY))) : 1;
  ok('验收8 机位「点击落点」3 点：共 4 点（首点 = 机位位置）、所有点 y = 机位高度 ± 1 mm、orient = keep；菜单「走到」→「推到」', cp?.points.length === 4 && maxDy8 <= 0.001 && hdist(cp
    .points[0], camP) < 1e-4 && cp.orient === 'keep' && towardLabel.includes('推到') && !towardLabel.includes('走到') && hint8.includes('机位高度平面'), JSON
    .stringify({ n: cp?.points.length, maxDy8, orient: cp?.orient, towardLabel, hint8 }));
  await page.evaluate(() => window.__app.playback.seek(0.5));
  await settle();
  const dot = await page.evaluate((id) => window.__app.pathOverlay.dotOf(id), cp.id);
  const ovVis = await page.evaluate(() => window.__app.pathOverlay.visible);
  await page.screenshot({ path: `${OUT}/8_camera_path.png` });
  await page.evaluate(() => window.__app.setCameraView(true));
  await settle();
  const ovPov = await page.evaluate(() => window.__app.pathOverlay.visible);
  await page.evaluate(() => { window.__app.setCameraView(false); window.__app.playback.stop(); });
  await settle();
  ok('验收8 overlay 画在机位高度（播放亮点 y ≈ 机位高度）、机位视角下不显示', Math.abs(dot[1] - camY) < 0.002 && ovVis && !ovPov, JSON.stringify({ dotY: dot[1], camY, ovVis, ovPov }));
  // 推到：停在目标前 1.5 m
  await clickSel('#inspector .move-clear');
  await settle();
  await pickInOutliner(ids.c1n);
  await page.evaluate(id => window.__app.emit('inspect', { id, section: 'path' }), ids.c1);
  await settle();
  await page.evaluate(() => window.__timelinePanel.setCollapsed(false));
  await settle();
  await clickSel(pathMenuButton);
  await settle();
  await page.evaluate(() => [...document.querySelectorAll('.ctx-item')].find((n) => n.textContent.includes('推到')).click());
  await page.evaluate(() => window.__timelinePanel.setCollapsed(true));
  await settle();
  const footA = (await camPose(ids.c1)).foot[ids.A];
  await page.mouse.click(...await scr([footA[0], 0.9, footA[2]]));
  await settle(150);
  const tw = (await camAnim(ids.c1)).path;
  ok('机位「推到」角色：停在目标前 1.5 m（水平）、高度不变', !!tw && Math.abs(hdist(tw.points[1], footA) - 1.5) < 0.01 && Math.abs(tw.points[1][1] - camY) < 1e-4, JSON
    .stringify(tw?.points));
  await clickSel('#inspector .move-clear');
  await settle();
  // ---- 9 主机位播放 ----
  const c2 = await page.evaluate((ids) => {
    const a = window.__app;
    const c = a.addCamera('front_mid');
    c.root.position.set(4, 1.4, 4);
    c.aimAt(a.findEntity(ids.A).root.position.clone().setY(0.9));
    a.edited(c);
    a.cameraMoves.applyPreset(c, 'truck', { mode: 'replace', params: { duration: 3 } }); // 机位2 自己也在动：横移 3 s
    return { id: c.id, name: c.name };
  }, ids);
  await settle();
  await page.select('#timeline .tl-cam', c2.id);
  await settle();
  await page.evaluate((id) => { const a = window.__app; a.select(id); a.setCameraView(true); }, ids.c1);
  await settle(150);
  const noIdleLabel = !await page.$('#povLabel');
  // 视口画布 vs 指定机位的 snapshot（同一帧、同尺寸）
  const canvasVs = (camId) => page.evaluate((camId) => {
    const a = window.__app;
    const cv = a.stage.renderer.domElement;
    // 比较相同的有效画幅；预览包含精灵名牌，手动机位视角仍使用 DOM 名牌。
    a.beginCleanRender({ labels: !!a.preview });
    let view, snap;
    try {
      a.stage.render();
      view = cv.toDataURL('image/png');
      snap = a.stage.snapshot(a.findEntity(camId).cam).toDataURL('image/png');
    }
    finally {
      a.endCleanRender();
    }
    return { view, snap, pov: a.povCameraId, t: a.playback.time };
  }, camId);
  const writePair = (r, name) => {
    fs.writeFileSync(`${OUT}/${name}_view.png`, Buffer.from(r.view.split(',')[1], 'base64'));
    fs.writeFileSync(`${OUT}/${name}_snap.png`, Buffer.from(r.snap.split(',')[1], 'base64'));
    return pixelDiff(`${OUT}/${name}_view.png`, `${OUT}/${name}_snap.png`, `${OUT}/${name}_diff.png`);
  };
  await page.keyboard.press('Space');
  await sleep(700);
  const playing = await canvasVs(ids.c1);
  const d9 = writePair(playing, '9_main');
  const noPlayingLabel = !await page.$('#povLabel');
  await page.screenshot({ path: `${OUT}/12_main_playing.png` });
  ok('验收9 机位视角选中机位1、主机位 = 机位2，Space 播放：视口保持机位1（与 snapshot 差异 < 0.5%）', playing.pov === ids.c1 && playing.t > 0 && d9 < 0.005 && noIdleLabel &&
    noPlayingLabel, `t=${playing.t.toFixed(2)} 差异 ${(d9 * 100).toFixed(4)}%`);
  await pickInOutliner(ids.An);
  const giz = await page.evaluate(() => ({ sel: window.__app.selected?.name, giz: window.__app.gizmo.visible }));
  ok('验收9 透过主机位时可选中其他实体、gizmo 隐藏', giz.sel === ids.An && !giz.giz, JSON.stringify(giz));
  await pickInOutliner(ids.c1n); // 回到选中机位1（idle 后选中角色会显示 gizmo / 选中环，不是这里要比的）
  const still9 = await page.evaluate(() => window.__app.povCameraId);
  await page.keyboard.press('Escape');
  await settle(150);
  const back = await page.evaluate(() => {
    const a = window.__app;
    return !a.preview && !a.cameraView && a.stage.activeCamera === null && a.rig.controls.enabled && a.playback.time === 0;
  });
  ok('验收9 播放中点选保持机位1；Esc 停止回导演并归零', still9 === ids.c1 && back);
  // 未设主机位：用当前机位并提示
  await page.select('#timeline .tl-cam', '');
  await page.evaluate((id) => { window.__app.setActiveCamera(id); window.__app.setCameraView(true); }, ids.c1);
  await settle();
  const hintIdle = await page.$eval('#povHint', (n) => n.hidden);
  await page.evaluate(() => window.__app.playback.seek(1));
  await settle(150);
  const unset = await page.evaluate(() => ({ pov: window.__app.povCameraId, hint: !document.getElementById('povHint').hidden, text: document
      .getElementById('povHint').textContent }));
  await page.screenshot({ path: `${OUT}/9_unset.png` });
  await page.keyboard.press('Escape');
  await settle();
  ok('验收9 未设主机位：active 时仍透过当前机位、视口左上角提示「未设主机位」（idle 不显示）', hintIdle && unset.pov === ids.c1 && unset.hint && unset.text.includes('未设主机位'), JSON
    .stringify(unset));
  await page.evaluate(() => window.__app.setCameraView(false));
  await settle();
  const directorPlay = await page.evaluate(async (id) => {
    const a = window.__app;
    a.timeline.setMainCamera(id);
    a.playback.seek(1);
    const r = { active: a.stage.activeCamera, label: !document.getElementById('povLabel') };
    a.playback.stop();
    return { director: r.active === null, labelHidden: r.label };
  }, c2.id);
  ok('验收9 导演视角下拖播放头不切换（仍是导演相机）', directorPlay.director && directorPlay.labelHidden, JSON.stringify(directorPlay));
  await page.evaluate((id) => { const a = window.__app; a.timeline.setMainCamera(null); a.remove(id); }, c2.id);
  await pickInOutliner(ids.c1n);
  // Serialized identity and actual rendered output both survive loading.
  await apply('crane', { duration: 3, amount: 1 });
  await apply('half_orbit', { duration: 5, sweep: 90 }, 'append');
  await page.evaluate(() => window.__app.playback.seek(4));
  await settle();
  const rtA = await camShot(ids.c1, `${OUT}/reload-before.png`);
  const doc = await page.evaluate(() => { window.__app.playback.stop(); return window.__app.exportDocument(); });
  await page.evaluate(async (doc) => { await window.__app.loadDocument(doc); }, doc);
  await settle();
  ok('组合运镜保存重载保留段身份和原动画数据', await page.evaluate(({ doc, id }) => {
    const a = window.__app, next = a.exportDocument();
    return a.cameraMoves.current(a.findCamera(id)).segments.length === 2 && JSON.stringify(doc.paths) === JSON.stringify(next.paths) && JSON
      .stringify(doc.timeline) === JSON.stringify(next.timeline);
  }, { doc, id: ids.c1 }));
  await page.evaluate(() => window.__app.playback.seek(4));
  await settle();
  const rtB = await camShot(ids.c1, `${OUT}/reload-after.png`);
  ok('组合运镜重载后同一时刻画面完全一致', pixelDiff(rtA, rtB) === 0);
  // ---- 收尾 1 · lookAt 入场 / 退场 0.5 s 混合；接力不回摆 ----
  const blend = await page.evaluate(async (ids) => {
    const { aimPoint } = await import('/src/anim/Constraint.js');
    const a = window.__app, tl = a.timeline, pb = a.playback;
    pb.stop();
    const c = a.addCamera('side_track');
    a.select(null);
    c.root.rotation.y += 1.1; // 偏开 ~63°：没对准主体
    c.root.updateMatrixWorld(true);
    a.edited(c);
    const pre = c.root.quaternion.clone();
    const Q = pre.constructor, M = c.root.matrix.constructor, V = c.root.position.constructor;
    const aimQ = (sub) => new Q().setFromRotationMatrix(new M().lookAt(c.root.position, aimPoint(a, sub), new V(0, 1, 0)));
    const ang = (q1, q2) => q1.angleTo(q2) * 180 / Math.PI;
    tl.setDuration(Math.max(tl.duration, 8));
    const lk = tl.addConstraint({ type: 'lookAt', target: c.id, subject: ids.A, start: 2, end: 5 });
    const at = (t) => { pb.seek(t); return c.root.quaternion.clone(); };
    const out = { gap: ang(pre, aimQ(ids.A)) };
    out.t19 = ang(at(1.9), pre);
    out.t20 = ang(at(2.0), pre);
    out.t25 = ang(at(2.5), aimQ(ids.A));
    let prev = Infinity;
    out.mono = true;
    out.maxStep = 0;
    for (let i = 0; i <= 15; i++) {
      const q = at(2 + i / 30), d = ang(q, aimQ(ids.A));
      if (d > prev + 1e-6)
        out.mono = false;
      if (i)
        out.maxStep = Math.max(out.maxStep, prev - d);
      prev = d;
    }
    out.t45 = ang(at(4.5), aimQ(ids.A));
    out.t50 = ang(at(5.0), pre);
    out.t51 = ang(at(5.1), pre);
    // 接力：A [2,4] → B [4, 全程]：t=4 ≡ 注视 A，4.5 ≡ 注视 B，之间不回到手动朝向
    tl.updateConstraint(lk.id, { end: 4 });
    tl.addConstraint({ type: 'lookAt', target: c.id, subject: ids.B, start: 4, end: null });
    out.h40 = ang(at(4.0), aimQ(ids.A));
    out.h45 = ang(at(4.5), aimQ(ids.B));
    out.hPreMin = Infinity;
    for (let i = 0; i <= 15; i++)
      out.hPreMin = Math.min(out.hPreMin, ang(at(3.75 + i / 30), pre));
    out.h38 = ang(at(3.8), aimQ(ids.A));
    pb.stop();
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(4) : v]));
  }, ids);
  ok('lookAt 混合：start=2 —— t=2.0 朝向 ≡ 约束前、t=2.5 ≡ 注视（< 0.5°），中间单调', blend.gap > 30 && blend.t19 < 0.5 && blend.t20 < 0.5 && blend.t25 < 0.5 && blend
    .mono, `偏差 ${blend.gap}°；t=1.9 ${blend.t19}° t=2.0 ${blend.t20}° t=2.5 ${blend.t25}°，每帧最多转 ${blend.maxStep}°`);
  ok('lookAt 混合：end=5 —— t=4.5 ≡ 注视、t=5.0 ≡ 约束前（退场）', blend.t45 < 0.5 && blend.t50 < 0.5 && blend.t51 < 0.5,
    `t=4.5 ${blend.t45}° t=5.0 ${blend.t50}° t=5.1 ${blend.t51}°`);
  ok('lookAt 接力（A 到 4 s、B 从 4 s）：上一条不退场，t=4 ≡ 注视 A、t=4.5 ≡ 注视 B，期间不回摆到手动朝向', blend.h38 < 0.5 && blend.h40 < 0.5 && blend.h45 < 0.5 && blend
    .hPreMin > 10, `t=3.8 ${blend.h38}° t=4.0 ${blend.h40}° t=4.5 ${blend.h45}°，离手动朝向最近 ${blend.hPreMin}°`);
  await checkFrustumProjection();
}
async function checkFrustumProjection() {
  await page.evaluate(() => localStorage.clear());
  await page.setViewport({ width: 1440, height: 810, deviceScaleFactor: 1 });
  await openApp();
  const OUT = 'test-output/cam/checkFrustumProjection';
  fs.mkdirSync(OUT, { recursive: true });
  const shot = async (name) => { await settle(100); await page.screenshot({ path: `${OUT}/${name}.png` }); };
  const projection = await page.evaluate(() => {
    const a = window.__app, c = a.cameras[0];
    a.beforeRender();
    const before = c.helper.camera.far, far = c.cam.far, g = c.helper.geometry;
    c.setFov(65);
    a.beforeRender();
    return { before, far: far === c.cam.far, fov: c.helper.camera.fov, aspect: c.helper.camera.aspect === c.cam.aspect, geometry: g === c.helper
        .geometry, width: 2 * c.helper.camera.far * Math.tan(c.helper.camera.fov * Math.PI / 360) * c.helper.camera.aspect };
  });
  await shot('frustum-fov65');
  ok('视锥延伸主体、同步FOV/aspect、不改变真实far或重建几何', projection.before > .5 && projection.far && projection.fov === 65 && projection.aspect && projection
    .geometry, JSON.stringify(projection));
  await page.evaluate(() => { window.__app.startPreview(); });
  await shot('playback-clean');
  ok('播放画面隐藏视锥', await page.evaluate(() => window.__app.cameras.every(c => !c.helper.visible)));
  await page.evaluate(() => window.__app.playback.pause());
  ok('暂停恢复导演视角及主机位视锥', await page.evaluate(() => !window.__app.cameraView && !window.__app.preview && window.__app.cameras.some(c => c.helper.visible)));
  await page.evaluate(() => window.__app.stopPreview());
}
