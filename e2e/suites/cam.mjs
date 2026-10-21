import fs from 'node:fs';
import { page, ok } from '../harness.mjs';
import { pixelDiff, sleep, settle, clickSel, pickInOutliner, scr, toastText, hdist, moveField, moveBtn, camAim, camPose, camAnim, camShot } from '../helpers.mjs';

export async function run() {
  const OUT = 'test-output/cam';
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const panelClip = () => page.$eval('#rightPanel', (n) => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });

  // ---- 场景：种子角色 A / B；机位1 对准 A ----
  const ids = await page.evaluate(() => {
    const a = window.__app;
    a.playback.stop();
    const [A, B] = a.entities.filter((e) => e.type === 'character').sort((x, y) => x.name.localeCompare(y.name)); // 加载顺序不定：按名字取
    const c1 = a.addCamera('front_mid');
    a.select(null);
    a.rig.controls.target.set(0, 0, 0.6); a.stage.camera.position.set(0, 8.5, 9.5); a.rig.controls.update();
    a.history.reset();
    return { A: A.id, B: B.id, c1: c1.id, An: A.name, Bn: B.name, c1n: c1.name };
  });
  await settle(200);

  // ---- 2 半环绕盯人 ----
  await page.evaluate(async (ids) => { // 机位先对准 A 的注视点（运镜从 start 起注视，不改手动朝向）
    const a = window.__app;
    const { aimPoint } = await import('/src/anim/Constraint.js');
    a.findEntity(ids.c1).aimAt(aimPoint(a, ids.A)); a.edited(a.findEntity(ids.c1));
  }, ids);
  await pickInOutliner(ids.c1n);
  const before2 = await camShot(ids.c1, `${OUT}/2_before.png`);
  const cam0 = await camPose(ids.c1);
  await moveField('预设', 'half_orbit');
  await moveField('主体', ids.A);
  const pv = await page.evaluate(() => window.__app.pathOverlay.movePreviewSize);
  await page.screenshot({ path: `${OUT}/12_preview.png` });
  await page.evaluate(() => document.querySelector('#inspector [data-sec="move"]').scrollIntoView());
  await page.screenshot({ path: `${OUT}/12_move_section.png`, clip: await panelClip() });
  await moveBtn('应用');
  const ho = await camAnim(ids.c1);
  ok('验收2 应用半环绕：一条路径（smooth / keep / 5 s）+ 一条注视 A（从 0 起、全程）、预览虚线已显示',
    !!ho.path && ho.path.speed === 'smooth' && ho.path.orient === 'keep' && ho.path.duration === 5 && ho.path.start === 0
    && ho.cns.length === 1 && ho.cns[0].type === 'lookAt' && ho.cns[0].subject === ids.A && ho.cns[0].start === 0 && ho.cns[0].end === null && pv === 1,
    JSON.stringify({ path: ho.path && { n: ho.path.points.length, d: ho.path.duration }, cns: ho.cns, pv }));
  const samples = [];
  for (let t = 0; t <= 5 + 1e-9; t += 0.25) {
    await page.evaluate((t) => window.__app.playback.seek(t), t);
    const pose = await camPose(ids.c1);
    const aim = await camAim(ids.c1, ids.A);
    samples.push({ t, r: hdist(pose.pos, pose.foot[ids.A]), y: pose.pos[1], off: aim.off });
  }
  const r0 = hdist(cam0.pos, cam0.foot[ids.A]);
  const maxDr = Math.max(...samples.map((x) => Math.abs(x.r - r0)));
  const maxDy = Math.max(...samples.map((x) => Math.abs(x.y - cam0.pos[1])));
  const maxOff = Math.max(...samples.map((x) => x.off));
  ok('验收2 每 0.25 s：水平距离恒定 ±1 cm、高度恒定 ±1 mm、注视点偏离画面中心 < 2%', maxDr <= 0.01 && maxDy <= 0.001 && maxOff < 0.02,
    `Δr=${(maxDr * 100).toFixed(2)}cm Δy=${(maxDy * 1000).toFixed(3)}mm off=${(maxOff * 100).toFixed(3)}%`);
  const end2 = await camPose(ids.c1);
  ok('验收2 扫过 180°：终点在主体对面', Math.abs(hdist(end2.pos, cam0.pos) - 2 * r0) < 0.02, `弦长 ${hdist(end2.pos, cam0.pos).toFixed(3)} / 直径 ${(2 * r0).toFixed(3)}`);
  await page.evaluate(() => window.__app.playback.seek(2.5));
  await settle();
  await camShot(ids.c1, `${OUT}/12_half_orbit.png`);
  await page.evaluate(() => window.__app.playback.seek(0));
  const at0 = await camShot(ids.c1, `${OUT}/2_t0.png`);
  const d2 = pixelDiff(before2, at0, `${OUT}/2_t0_diff.png`);
  ok('验收2 t=0 与应用前画面一致（不跳）', d2 === 0, `差异 ${(d2 * 100).toFixed(4)}%`);

  // ---- 清除运镜 ----
  await page.evaluate(() => window.__app.playback.stop());
  await moveBtn('清除运镜');
  const cleared = await camAnim(ids.c1);
  ok('清除运镜：路径 / 约束 / rot 轨道全删、段列表消失', !cleared.path && !cleared.cns.length && !cleared.rot
    && !(await page.$('#inspector [data-sec="move"] .move-seg')), JSON.stringify(cleared));

  // ---- 3 推 / 拉 ----
  const moveEnd = async (name, params = {}) => {
    await moveField('预设', name);
    for (const [k, v] of Object.entries(params)) await moveField(k, v);
    await moveBtn('应用');
    const an = await camAnim(ids.c1);
    const T = an.path ? an.path.start + an.path.duration : 0;
    await page.evaluate((T) => window.__app.playback.seek(T), T);
    const pose = await camPose(ids.c1);
    await page.evaluate(() => window.__app.playback.seek(1.5));
    await settle();
    await camShot(ids.c1, `${OUT}/12_${name}.png`);
    await page.evaluate(() => window.__app.playback.stop());
    await moveBtn('清除运镜');
    return { an, pose };
  };
  const push = await moveEnd('push_in');
  const pull = await moveEnd('pull_out');
  const rPush = hdist(push.pose.pos, cam0.foot[ids.A]), rPull = hdist(pull.pose.pos, cam0.foot[ids.A]);
  ok('验收3 推：终点到主体（水平）= 原距离 × 0.6 ± 1 cm；拉 = × 1.6', Math.abs(rPush - r0 * 0.6) <= 0.01 && Math.abs(rPull - r0 * 1.6) <= 0.01
    && push.an.path.duration === 3 && pull.an.path.duration === 3,
    `原 ${r0.toFixed(3)} → 推 ${rPush.toFixed(3)}（×${(rPush / r0).toFixed(4)}）拉 ${rPull.toFixed(3)}（×${(rPull / r0).toFixed(4)}）`);

  // ---- 4 横移 / 升降 ----
  const tr = await moveEnd('truck');
  const disp = [tr.pose.pos[0] - cam0.pos[0], tr.pose.pos[2] - cam0.pos[2]];
  const conn = [cam0.foot[ids.A][0] - cam0.pos[0], cam0.foot[ids.A][2] - cam0.pos[2]];
  const ang = Math.acos((disp[0] * conn[0] + disp[1] * conn[1]) / Math.hypot(...disp) / Math.hypot(...conn)) * 180 / Math.PI;
  // 机位视角的左：机位右方向量（本地 +X）与位移反向
  const right = await page.evaluate((id) => { const c = window.__app.findEntity(id); c.root.updateMatrix(); const e = c.root.matrix.elements; return [e[0], e[2]]; }, ids.c1);
  ok('验收4 横移：位移垂直于初始连线（90° ± 1°）、y 不变、默认 2 m 向机位左方',
    Math.abs(ang - 90) <= 1 && Math.abs(tr.pose.pos[1] - cam0.pos[1]) < 1e-4 && Math.abs(Math.hypot(...disp) - 2) < 1e-3 && disp[0] * right[0] + disp[1] * right[1] < 0,
    `夹角 ${ang.toFixed(3)}° |d|=${Math.hypot(...disp).toFixed(4)} Δy=${(tr.pose.pos[1] - cam0.pos[1]).toExponential(1)}`);
  const cr = await moveEnd('crane');
  const dc = cr.pose.pos.map((v, i) => v - cam0.pos[i]);
  ok('验收4 升降：只有 y 变化 1 m', Math.abs(dc[0]) < 1e-4 && Math.abs(dc[2]) < 1e-4 && Math.abs(dc[1] - 1) < 1e-4, JSON.stringify(dc.map((v) => +v.toFixed(5))));

  // ---- 5 摇 ----
  await page.evaluate((id) => { const c = window.__app.findEntity(id); c.root.rotation.y += 0.7; c.root.updateMatrixWorld(true); window.__app.edited(c); }, ids.c1);
  const panPos0 = (await camPose(ids.c1)).pos;
  await moveField('预设', 'pan');
  await moveBtn('应用');
  const pan = await camAnim(ids.c1);
  const panPos = [];
  for (const t of [0, 0.5, 1, 1.5, 2, 3]) { await page.evaluate((t) => window.__app.playback.seek(t), t); panPos.push((await camPose(ids.c1)).pos); }
  await page.evaluate(() => window.__app.playback.seek(2));
  const panAim = await camAim(ids.c1, ids.A);
  await page.evaluate(() => window.__app.playback.seek(1));
  await settle();
  await camShot(ids.c1, `${OUT}/12_pan.png`);
  const still = Math.max(...panPos.map((p) => Math.hypot(...p.map((v, i) => v - panPos0[i]))));
  ok('验收5 摇：无路径、rot 轨道 2 键（0 / 2 s）、注视从 2 s 起', !pan.path && pan.rot?.keys.length === 2 && pan.rot.keys[0].t === 0 && pan.rot.keys[1].t === 2
    && pan.cns.length === 1 && pan.cns[0].start === 2 && pan.cns[0].end === null, JSON.stringify({ rot: pan.rot?.keys.map((k) => k.t), cns: pan.cns }));
  ok('验收5 t=duration 机位 −Z 指向主体 < 0.5°、位置全程不变', panAim.angle < 0.5 && still < 1e-6, `夹角 ${panAim.angle.toFixed(4)}° 位移 ${still.toExponential(1)}`);
  await page.evaluate(() => window.__app.playback.stop());
  await moveBtn('清除运镜');
  await page.evaluate((id) => { const c = window.__app.findEntity(id); c.root.rotation.y -= 0.7; c.root.updateMatrixWorld(true); window.__app.edited(c); }, ids.c1);

  // ---- 6 追加：推 → 半环绕（同主体合并注视）----
  await moveField('预设', 'push_in');
  await moveBtn('应用');
  const pushOnly = await camAnim(ids.c1);
  const label6 = await page.$eval('#inspector [data-sec="move"] .anim-btns .primary', (b) => b.textContent);
  await moveField('预设', 'half_orbit');
  await moveBtn('追加');
  const ap = await camAnim(ids.c1);
  const n1 = pushOnly.path.points.length;
  const seamOk = JSON.stringify(ap.path.points.slice(0, n1)) === JSON.stringify(pushOnly.path.points);
  ok('验收6 已有路径时按钮为「追加」；追加后仍一条路径、前段点不变（接缝 = 推的终点）、duration = 3 + 5',
    label6 === '追加' && seamOk && ap.path.duration === 8 && ap.path.closed === false && ap.path.id === pushOnly.path.id,
    `label=${label6} n=${n1}→${ap.path.points.length} d=${ap.path.duration}`);
  ok('验收6 同主体：两段注视合并为一条 [0, 全程]', ap.cns.length === 1 && ap.cns[0].start === 0 && ap.cns[0].end === null, JSON.stringify(ap.cns));
  const segs6 = await page.$$eval('#inspector [data-sec="move"] .move-seg', (ns) => ns.map((n) => n.innerText.replace(/\s+/g, ' ')));
  ok('验收6 段列表：推 0–3 / 半环绕 3–8', segs6.length === 2 && segs6[0].includes('推') && segs6[0].includes('0.0–3.0') && segs6[1].includes('半环绕') && segs6[1].includes('3.0–8.0'), JSON.stringify(segs6));
  await page.evaluate(() => document.querySelector('#inspector [data-sec="move"]').scrollIntoView());
  await page.screenshot({ path: `${OUT}/12_segments.png`, clip: await panelClip() });
  // 判"无跳变"：跨接缝的一步与前后相邻两步的平均相差 < 2 mm（原始距离一并打印；收尾 1 起接缝处停顿，三步都接近 0）
  const at = async (t) => { await page.evaluate((t) => window.__app.playback.seek(t), t); return (await camPose(ids.c1)).pos; };
  const ts = [2.97, 2.99, 3.01, 3.03];
  const ps = [];
  for (const t of ts) ps.push(await at(t));
  const step = (i) => Math.hypot(...ps[i].map((v, k) => v - ps[i + 1][k]));
  const jump = Math.abs(step(1) - (step(0) + step(2)) / 2);
  ok('验收6 播放 t=3 附近位置连续（跨接缝一步与相邻步之差 < 2 mm）', jump < 0.002,
    `2.99→3.01 相距 ${(step(1) * 100).toFixed(3)} cm（相邻 ${(step(0) * 100).toFixed(3)} / ${(step(2) * 100).toFixed(3)} cm），差 ${(jump * 1000).toFixed(3)} mm`);
  // 收尾 1 · 接缝停顿：stops = [接缝]、stopTimes = [3]；t=3 速度 < 0.05 m/s；0–3 s 始终在推的线段上（< 2 cm）
  const stop6 = await page.evaluate(async (id, push) => {
    const a = window.__app, pb = a.playback;
    const c = a.findEntity(id);
    const P0 = push[0], P1 = push[push.length - 1];
    const L = Math.hypot(P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]);
    const u = P1.map((v, i) => (v - P0[i]) / L);
    const pos = (t) => { pb.seek(t); return c.toJSON().transform.pos; }; // 文档口径 = 路径点口径
    let off = 0;
    for (let i = 0; i <= 90; i++) {
      const q = pos(i / 30);
      const along = q.reduce((s, v, k) => s + (v - P0[k]) * u[k], 0);
      const cl = Math.min(Math.max(along, 0), L);
      off = Math.max(off, Math.hypot(...q.map((v, k) => v - (P0[k] + u[k] * cl))) + Math.max(0, -along, along - L));
    }
    const a3 = pos(2.995), b3 = pos(3.005);
    const v3 = Math.hypot(...a3.map((v, k) => v - b3[k])) / 0.01;
    const vMid = Math.hypot(...pos(1.495).map((v, k, q) => v - pos(1.505)[k])) / 0.01;
    pb.stop();
    const p = a.timeline.toJSON().paths.find((x) => x.target === id);
    return { stops: p.stops, stopTimes: p.stopTimes, n1: push.length, v3, vMid, off, duration: p.duration };
  }, ids.c1, pushOnly.path.points);
  ok('验收4（收尾 1）推 3 s + 半环绕 5 s：接缝停顿 stops/stopTimes、t=3.0 速度 < 0.05 m/s、0–3 s 在推的线段上（< 2 cm）、总 8 s',
    JSON.stringify(stop6.stops) === JSON.stringify([stop6.n1 - 1]) && JSON.stringify(stop6.stopTimes) === '[3]' && stop6.v3 < 0.05 && stop6.vMid > 0.3 && stop6.off < 0.02 && stop6.duration === 8,
    `stops=${JSON.stringify(stop6.stops)} stopTimes=${JSON.stringify(stop6.stopTimes)} v(3.0)=${stop6.v3.toFixed(4)} m/s v(1.5)=${stop6.vMid.toFixed(3)} m/s 偏离 ${(stop6.off * 100).toFixed(3)} cm`);
  await page.evaluate(() => window.__app.playback.stop());

  // 摇镜头不能接在路径后
  await moveField('预设', 'pan');
  await moveBtn('追加');
  ok('摇镜头接在路径后：拒绝并提示', (await toastText()).includes('摇镜头请单独使用或放在最前') && (await camAnim(ids.c1)).path.duration === 8, await toastText());

  // ---- 7 删末段 + ⌘Z ----
  await page.evaluate(() => [...document.querySelectorAll('#inspector [data-sec="move"] .move-seg-del')][0].click());
  await settle();
  const midTxt = await toastText();
  await page.evaluate(() => { const b = [...document.querySelectorAll('#inspector [data-sec="move"] .move-seg-del')]; b[b.length - 1].click(); });
  await settle(150);
  const del = await camAnim(ids.c1);
  ok('验收7 删中间段提示「请清除后重做」；删末段：points / duration / 约束回到追加前',
    midTxt.includes('请清除后重做') && JSON.stringify(del.path) === JSON.stringify(pushOnly.path) && JSON.stringify(del.cns) === JSON.stringify(pushOnly.cns)
    && (await page.$$('#inspector [data-sec="move"] .move-seg')).length === 1, JSON.stringify({ midTxt, d: del.path.duration, cns: del.cns }));
  await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta');
  await settle(300);
  const undo7 = await camAnim(ids.c1);
  ok('验收7 ⌘Z 恢复追加后的状态（段列表回到 2 段）', JSON.stringify(undo7.path) === JSON.stringify(ap.path) && JSON.stringify(undo7.cns) === JSON.stringify(ap.cns)
    && (await page.$$('#inspector [data-sec="move"] .move-seg')).length === 2, `d=${undo7.path?.duration}`);

  // 异主体：推 A → 追加半环绕 B：两条注视 [0,3] / [3,全程]
  await moveBtn('清除运镜');
  await moveField('预设', 'push_in');
  await moveField('主体', ids.A);
  await moveBtn('应用');
  await moveField('预设', 'half_orbit');
  await moveField('主体', ids.B);
  await moveBtn('追加');
  const ab = await camAnim(ids.c1);
  const win = ab.cns.map((c) => [c.subject === ids.A ? 'A' : c.subject === ids.B ? 'B' : '?', c.start, c.end]);
  ok('验收6 异主体：两条注视窗口 A [0,3] / B [3,全程]，不重叠', JSON.stringify(win) === JSON.stringify([['A', 0, 3], ['B', 3, null]]), JSON.stringify(win));
  await page.evaluate(() => window.__app.playback.seek(5));
  await settle();
  await camShot(ids.c1, `${OUT}/6_append_t5.png`);
  await page.evaluate(() => window.__app.playback.stop());
  await moveBtn('清除运镜');
  await moveField('主体', '');

  // ---- 8 机位画路径：点击落点 3 点 ----
  await page.evaluate(() => window.__app.playback.stop());
  const camY = (await camPose(ids.c1)).pos[1];
  const camP = (await camPose(ids.c1)).pos;
  await clickSel('#dock .dockbtn[title^="路径"]');
  await settle();
  const towardLabel = await page.$$eval('#dock .dockmenu.open .menu-item', (ns) => ns.map((n) => n.textContent).join(' '));
  await page.evaluate(() => [...document.querySelectorAll('#dock .dockmenu.open .menu-item')].find((n) => n.textContent.includes('点击落点')).click());
  await settle();
  const hint8 = await page.$eval('.path-hint', (n) => n.textContent);
  for (const q of [[camP[0] + 1.5, camY, camP[2] + 0.6], [camP[0] + 3, camY, camP[2] - 0.8], [camP[0] + 3.4, camY, camP[2] - 2.8]]) { await page.mouse.click(...await scr(q)); await settle(); }
  await page.keyboard.press('Enter');
  await settle(150);
  const cp = (await camAnim(ids.c1)).path;
  const maxDy8 = cp ? Math.max(...cp.points.map((q) => Math.abs(q[1] - camY))) : 1;
  ok('验收8 机位「点击落点」3 点：共 4 点（首点 = 机位位置）、所有点 y = 机位高度 ± 1 mm、orient = keep；菜单「走到」→「推到」',
    cp?.points.length === 4 && maxDy8 <= 0.001 && hdist(cp.points[0], camP) < 1e-4 && cp.orient === 'keep' && towardLabel.includes('推到') && !towardLabel.includes('走到') && hint8.includes('机位高度平面'),
    JSON.stringify({ n: cp?.points.length, maxDy8, orient: cp?.orient, towardLabel, hint8 }));
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
  ok('验收8 overlay 画在机位高度（播放亮点 y ≈ 机位高度）、机位视角下不显示', Math.abs(dot[1] - 0.01 - camY) < 0.002 && ovVis && !ovPov, JSON.stringify({ dotY: dot[1], camY, ovVis, ovPov }));

  // 推到：停在目标前 1.5 m
  await page.evaluate(() => [...document.querySelectorAll('#inspector [data-sec="path"] .minibtn')].find((b) => b.textContent === '删除路径').click());
  await settle();
  await pickInOutliner(ids.c1n);
  await clickSel('#dock .dockbtn[title^="路径"]');
  await settle();
  await page.evaluate(() => [...document.querySelectorAll('#dock .dockmenu.open .menu-item')].find((n) => n.textContent.includes('推到')).click());
  await settle();
  const footA = (await camPose(ids.c1)).foot[ids.A];
  await page.mouse.click(...await scr([footA[0], 0.9, footA[2]]));
  await settle(150);
  const tw = (await camAnim(ids.c1)).path;
  ok('机位「推到」角色：停在目标前 1.5 m（水平）、高度不变', !!tw && Math.abs(hdist(tw.points[1], footA) - 1.5) < 0.01 && Math.abs(tw.points[1][1] - camY) < 1e-4,
    JSON.stringify(tw?.points));
  await page.evaluate(() => [...document.querySelectorAll('#inspector [data-sec="path"] .minibtn')].find((b) => b.textContent === '删除路径').click());
  await settle();

  // ---- 9 主机位播放 ----
  const c2 = await page.evaluate((ids) => {
    const a = window.__app;
    const c = a.addCamera('front_mid');
    c.root.position.set(4, 1.4, 4); c.aimAt(a.findEntity(ids.A).root.position.clone().setY(0.9)); a.edited(c);
    const t = a.cameraMoves;
    t.formOf(c).name = 'truck';
    t.commit(c, t.build(c)); // 机位2 自己也在动：横移 3 s
    return { id: c.id, name: c.name };
  }, ids);
  await settle();
  await page.select('#timeline .tl-cam', c2.id);
  await settle();
  await page.evaluate((id) => { const a = window.__app; a.select(id); a.setCameraView(true); }, ids.c1);
  await settle(150);
  const idleLabel = await page.$eval('#povLabel', (n) => ({ text: n.textContent, main: n.classList.contains('main'), hidden: n.hidden }));
  // 视口画布 vs 指定机位的 snapshot（同一帧、同尺寸）
  const canvasVs = (camId) => page.evaluate((camId) => {
    const a = window.__app;
    const cv = a.stage.renderer.domElement;
    a.stage.render();
    const view = cv.toDataURL('image/png');
    // 视口画布里没有名牌（平时是 DOM 名牌），洁净渲染自阶段 G 起画精灵名牌：比机位画面时关掉名牌
    a.beginCleanRender({ labels: false });
    let snap;
    try { snap = a.stage.snapshot(a.findEntity(camId).cam).toDataURL('image/png'); } finally { a.endCleanRender(); }
    return { view, snap, pov: a.povCameraId, t: a.playback.time };
  }, camId);
  const writePair = (r, name) => {
    fs.writeFileSync(`${OUT}/${name}_view.png`, Buffer.from(r.view.split(',')[1], 'base64'));
    fs.writeFileSync(`${OUT}/${name}_snap.png`, Buffer.from(r.snap.split(',')[1], 'base64'));
    return pixelDiff(`${OUT}/${name}_view.png`, `${OUT}/${name}_snap.png`, `${OUT}/${name}_diff.png`);
  };
  await page.keyboard.press('Space');
  await sleep(700);
  await page.keyboard.press('Space'); // 暂停：仍 active
  await settle(150);
  const playing = await canvasVs(c2.id);
  const d9 = writePair(playing, '9_main');
  const mainLabel = await page.$eval('#povLabel', (n) => ({ text: n.textContent, main: n.classList.contains('main') }));
  await page.screenshot({ path: `${OUT}/12_main_playing.png` });
  ok('验收9 机位视角选中机位1、主机位 = 机位2，Space 播放：视口 ≡ 机位2 同一 t 的 snapshot（< 0.5%）、标签「▶ 主机位 · 机位2」',
    playing.pov === c2.id && playing.t > 0 && d9 < 0.005 && mainLabel.main && mainLabel.text.includes(c2.name) && !idleLabel.main && idleLabel.text === ids.c1n,
    `t=${playing.t.toFixed(2)} 差异 ${(d9 * 100).toFixed(4)}% idle=${JSON.stringify(idleLabel)} active=${JSON.stringify(mainLabel)}`);
  await pickInOutliner(ids.An);
  const giz = await page.evaluate(() => ({ sel: window.__app.selected?.name, giz: window.__app.gizmo.visible }));
  ok('验收9 透过主机位时可选中其他实体、gizmo 隐藏', giz.sel === ids.An && !giz.giz, JSON.stringify(giz));
  await pickInOutliner(ids.c1n); // 回到选中机位1（idle 后选中角色会显示 gizmo / 选中环，不是这里要比的）
  const still9 = await page.evaluate(() => window.__app.povCameraId);
  await page.keyboard.press('Escape');
  await settle(150);
  const back = await canvasVs(ids.c1);
  const d9b = writePair(back, '9_back');
  ok('验收9 播放中在大纲点机位1 仍透过主机位；Esc 后视口回到机位1（像素 0%）', still9 === c2.id && back.pov === ids.c1 && d9b === 0,
    `pov=${back.pov === ids.c1 ? '机位1' : back.pov} 差异 ${(d9b * 100).toFixed(4)}%`);

  // 未设主机位：用当前机位并提示
  await page.select('#timeline .tl-cam', '');
  await page.evaluate((id) => window.__app.setActiveCamera(id), ids.c1);
  await settle();
  const hintIdle = await page.$eval('#povHint', (n) => n.hidden);
  await page.evaluate(() => window.__app.playback.seek(1));
  await settle(150);
  const unset = await page.evaluate(() => ({ pov: window.__app.povCameraId, hint: !document.getElementById('povHint').hidden, text: document.getElementById('povHint').textContent }));
  await page.screenshot({ path: `${OUT}/9_unset.png` });
  await page.keyboard.press('Escape');
  await settle();
  ok('验收9 未设主机位：active 时仍透过当前机位、视口左上角提示「未设主机位」（idle 不显示）', hintIdle && unset.pov === ids.c1 && unset.hint && unset.text.includes('未设主机位'), JSON.stringify(unset));
  await page.evaluate(() => window.__app.setCameraView(false));
  await settle();
  const directorPlay = await page.evaluate(async (id) => {
    const a = window.__app;
    a.timeline.setMainCamera(id);
    a.playback.seek(1);
    const r = { active: a.stage.activeCamera, label: document.getElementById('povLabel').hidden };
    a.playback.stop();
    return { director: r.active === null, labelHidden: r.label };
  }, c2.id);
  ok('验收9 导演视角下播放不切换（仍是导演相机）', directorPlay.director && directorPlay.labelHidden, JSON.stringify(directorPlay));
  await page.evaluate((id) => { const a = window.__app; a.timeline.setMainCamera(null); a.remove(id); }, c2.id);
  await pickInOutliner(ids.c1n);

  // ---- 其余预设截图（t = duration / 2）----
  await moveField('预设', 'circle');
  await moveBtn('应用');
  await page.evaluate(() => window.__app.playback.seek(4));
  await settle();
  await camShot(ids.c1, `${OUT}/12_circle.png`);
  await page.evaluate(() => window.__app.playback.stop());
  await moveBtn('清除运镜');

  // ---- 10 往返：含追加运镜的文档 导出 → 导入 → 导出 ≡；导入后 seek(4) 画面 ≡ 导入前 ----
  await moveField('预设', 'crane');
  await moveBtn('应用');
  await moveField('预设', 'half_orbit');
  await moveBtn('追加');
  await page.evaluate(() => window.__app.playback.seek(4));
  await settle();
  const rtA = await camShot(ids.c1, `${OUT}/10_before.png`);
  const doc1 = await page.evaluate(() => { window.__app.playback.stop(); return window.__app.exportDocument(); });
  fs.writeFileSync(`${OUT}/10_doc1.json`, JSON.stringify(doc1, null, 2));
  await page.evaluate(async (d) => {
    const { createEmptyDocument } = await import('/src/doc/schema.js');
    const a = window.__app;
    await a.loadDocument(createEmptyDocument());
    await a.loadDocument(d);
  }, doc1);
  await settle(150);
  const doc2 = await page.evaluate(() => window.__app.exportDocument());
  const norm = (d) => JSON.stringify({ ...d, meta: { ...d.meta, updatedAt: null } });
  const camPath = doc1.paths.find((p) => p.target === ids.c1);
  ok('验收10 含运镜（升降 + 追加半环绕）的文档 导出 → 导入 → 导出 ≡', norm(doc1) === norm(doc2) && camPath?.duration === 8
    && doc1.constraints.filter((c) => c.target === ids.c1).length === 1, `path d=${camPath?.duration} n=${camPath?.points.length}`);
  await page.evaluate(() => window.__app.playback.seek(4));
  await settle();
  const rtB = await camShot(ids.c1, `${OUT}/10_after.png`);
  const d10 = pixelDiff(rtA, rtB, `${OUT}/10_diff.png`);
  ok('验收10 导入后 seek(4) 画面 ≡ 导入前', d10 === 0, `差异 ${(d10 * 100).toFixed(4)}%`);
  await page.evaluate(() => window.__app.playback.stop());
  await pickInOutliner(ids.c1n);
  const kept = (await page.$$('#inspector [data-sec="move"] .move-seg')).length;
  await page.evaluate(() => { const a = window.__app; a.moveMeta = {}; a.select(null); }); // = 刷新页面：会话态丢失
  await pickInOutliner(ids.c1n);
  const degraded = (await page.$$('#inspector [data-sec="move"] .move-seg')).length;
  const lbl = await page.$eval('#inspector [data-sec="move"] .anim-btns .primary', (b) => b.textContent);
  ok('同一会话导入同一文档段列表保留；会话态丢失（刷新）后段列表为空，文档里的路径仍可「追加」', kept === 2 && degraded === 0 && lbl === '追加', `kept=${kept} degraded=${degraded} btn=${lbl}`);

  // ---- 12 第 0 节修正后的属性面板（角色 Y = 0.00、缩放 1.00）----
  await pickInOutliner(ids.An);
  await page.screenshot({ path: `${OUT}/12_panel_units.png`, clip: await panelClip() });

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
    let prev = Infinity; out.mono = true; out.maxStep = 0;
    for (let i = 0; i <= 15; i++) {
      const q = at(2 + i / 30), d = ang(q, aimQ(ids.A));
      if (d > prev + 1e-6) out.mono = false;
      if (i) out.maxStep = Math.max(out.maxStep, prev - d);
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
    for (let i = 0; i <= 15; i++) out.hPreMin = Math.min(out.hPreMin, ang(at(3.75 + i / 30), pre));
    out.h38 = ang(at(3.8), aimQ(ids.A));
    pb.stop();
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(4) : v]));
  }, ids);
  ok('lookAt 混合：start=2 —— t=2.0 朝向 ≡ 约束前、t=2.5 ≡ 注视（< 0.5°），中间单调', blend.gap > 30 && blend.t19 < 0.5 && blend.t20 < 0.5 && blend.t25 < 0.5 && blend.mono,
    `偏差 ${blend.gap}°；t=1.9 ${blend.t19}° t=2.0 ${blend.t20}° t=2.5 ${blend.t25}°，每帧最多转 ${blend.maxStep}°`);
  ok('lookAt 混合：end=5 —— t=4.5 ≡ 注视、t=5.0 ≡ 约束前（退场）', blend.t45 < 0.5 && blend.t50 < 0.5 && blend.t51 < 0.5, `t=4.5 ${blend.t45}° t=5.0 ${blend.t50}° t=5.1 ${blend.t51}°`);
  ok('lookAt 接力（A 到 4 s、B 从 4 s）：上一条不退场，t=4 ≡ 注视 A、t=4.5 ≡ 注视 B，期间不回摆到手动朝向',
    blend.h38 < 0.5 && blend.h40 < 0.5 && blend.h45 < 0.5 && blend.hPreMin > 10, `t=3.8 ${blend.h38}° t=4.0 ${blend.h40}° t=4.5 ${blend.h45}°，离手动朝向最近 ${blend.hPreMin}°`);
}
