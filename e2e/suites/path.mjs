import fs from 'node:fs';
import { page, ok, twoCharacterFixture } from '../harness.mjs';
import { pixelDiff, sleep, settle, pickInOutliner, scr, pathMenu, toastText, toastClick, animJSON, pathOf, cleanShot, dragPath, hdist } from '../helpers.mjs';

export async function run() {
  await twoCharacterFixture();
  await page.evaluate(() => window.__timelinePanel.setCollapsed(false));
  const OUT = 'test-output/path';
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const panelClip = () => page.$eval('#rightPanel', (n) => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });

  // ---- 场景：种子角色 A (−1.1, 0, 0.2) / B (1.1, 0, 0.2) + 方块 + 圆柱 + 方块2；导演相机斜俯视 ----
  const ids = await page.evaluate(() => {
    const a = window.__app;
    a.playback.stop();
    // 种子模型并发加载，entities 的入列顺序不代表左右位置。
    const A = a.entities.find((e) => e.type === 'character' && e.body === 'male');
    const B = a.entities.find((e) => e.type === 'character' && e.body === 'female');
    const box = a.addProp('box'); box.root.position.set(1.6, 0, 2.6); a.edited(box);
    const cyl = a.addProp('cylinder'); cyl.root.position.set(3.4, 0, 0.9); a.edited(cyl);
    const box2 = a.addProp('box'); box2.root.position.set(-2.6, 0, 2.4); a.edited(box2);
    a.addCamera('front_mid'); // 验收 9：机位视角下路径不显示
    a.select(null);
    // 时间轴覆盖画布下部；绘制测试向上构图，点击点必须处于可见舞台。
    a.rig.controls.target.set(0, -1.5, 0.6); a.stage.camera.position.set(0, 7, 7.5); a.rig.controls.update();
    a.history.reset();
    const n = (e) => e.name;
    return { A: A.id, B: B.id, box: box.id, cyl: cyl.id, box2: box2.id, An: n(A), Bn: n(B), boxN: n(box), cylN: n(cyl), box2N: n(box2) };
  });
  await settle(200);

  // ---- 1 点击落点 + 8 绘制态不冲突 ----
  await pickInOutliner(ids.An);
  const shot0 = await cleanShot(`${OUT}/1_before.png`);
  const aPos = await page.evaluate((id) => window.__app.findEntity(id).toJSON().transform.pos, ids.A);
  await pathMenu('点击落点');
  for (const p of [[-1.1, 0, 2.2], [0.6, 0, 2.9], [1.9, 0, 0.8]]) { await page.mouse.click(...await scr(p)); await settle(); }
  const view0 = await page.evaluate(() => ({ pos: window.__app.stage.camera.position.toArray(), target: window.__app.rig.controls.target.toArray() }));
  await dragPath([await scr([0, 0, -1]), await scr([1.2, 0, -2.2])], { steps: 10 });
  const view1 = await page.evaluate(() => ({ pos: window.__app.stage.camera.position.toArray(), target: window.__app.rig.controls.target.toArray(), n: window.__app.pathTool.draft.length }));
  await page.mouse.move(...await scr([2.6, 0, -0.6]));
  await settle();
  await page.screenshot({ path: `${OUT}/13_points.png` });
  await page.keyboard.press('Enter');
  await settle(150);
  const p1 = await pathOf(ids.A);
  const dd1 = 10; // 最新UI绘制默认固定时长，非按长度估算。
  await page.evaluate(() => window.__app.playback.seek(0));
  await settle();
  const shot1 = await cleanShot(`${OUT}/1_t0.png`);
  const diff1 = pixelDiff(shot0, shot1, `${OUT}/1_diff.png`);
  await page.evaluate(() => window.__app.playback.stop());
  ok('验收1 点击落点：3 次点击 + Enter → 4 个点、首点 ≡ 角色当前位置、start=0、duration=10',
    p1 && p1.points.length === 4 && hdist(p1.points[0], aPos) < 1e-3 && p1.points[0][1] === 0 && p1.start === 0 && p1.duration === dd1,
    `points=${JSON.stringify(p1?.points)} start=${p1?.start} duration=${p1?.duration}/${dd1}`);
  ok('验收1 创建后 t=0 画面 ≡ 创建前（不跳）', diff1 === 0, `差异 ${(diff1 * 100).toFixed(4)}%`);
  ok('验收8 绘制态在地面按下拖动：相机不转、不落点',
    JSON.stringify(view0) === JSON.stringify({ pos: view1.pos, target: view1.target }) && view1.n === 4, `n=${view1.n}`);

  // ---- 2 手绘：从角色 B 脚下拖一条约 4 m 的 S 形 ----
  await pickInOutliner(ids.Bn);
  await pathMenu('手绘');
  const stroke = [];
  for (let i = 0; i <= 48; i++) { const u = i / 48; stroke.push(await scr([1.1 + 0.55 * Math.sin(u * Math.PI * 2), 0, 0.2 - 3.5 * u])); }
  await dragPath(stroke, { hold: () => page.screenshot({ path: `${OUT}/13_freehand.png` }) });
  const fh = await page.evaluate(async (id) => {
    const a = window.__app;
    const raw = a.pathTool.lastStroke;
    const p = a.timeline.toJSON().paths.find((x) => x.target === id);
    const { Path } = await import('/src/anim/Path.js');
    const path = new Path(p);
    const S = [];
    for (let i = 0; i <= 3000; i++) S.push(path.positionAt((i / 3000) * path.length));
    let max = 0;
    for (const r of raw.slice(1)) { let b = Infinity; for (const s of S) b = Math.min(b, Math.hypot(s.x - r[0], s.z - r[2])); max = Math.max(max, b); }
    let L = 0; for (let i = 1; i < raw.length; i++) L += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][2] - raw[i - 1][2]);
    return { n: p.points.length, raw: raw.length, L, max };
  }, ids.B);
  ok('验收2 手绘 S 形：简化后点数 ∈ [5, 40]，原采样点到路径曲线最大偏差 < 5 cm',
    fh.n >= 5 && fh.n <= 40 && fh.max < 0.05, `采样 ${fh.raw} 点 / 长 ${fh.L.toFixed(2)} m → ${fh.n} 点，最大偏差 ${(fh.max * 100).toFixed(2)} cm`);

  // ---- 3 直线（方块2）/ 走到（圆柱 → 方块）----
  await pickInOutliner(ids.box2N);
  await pathMenu('直线');
  await page.mouse.move(...await scr([-3.4, 0, 0.6]));
  await settle();
  await page.screenshot({ path: `${OUT}/13_line.png` });
  await page.mouse.click(...await scr([-3.4, 0, 0.6]));
  await settle(120);
  const ln = await pathOf(ids.box2);
  ok('验收3 直线：点一下终点 → 2 个点', ln?.points.length === 2 && hdist(ln.points[1], [-3.4, 0, 0.6]) < 0.01, JSON.stringify(ln?.points));

  await pickInOutliner(ids.cylN);
  await pathMenu('走到');
  await page.mouse.click(...await scr([0.4, 0, -2.8])); // 点地面（无 ⇧）：提示并留在绘制态
  await settle();
  const twGround = { mode: await page.evaluate(() => window.__app.pathTool.mode), toast: await toastText() };
  const boxC = await page.evaluate((id) => { const a = window.__app; return a.pathTool.anchorOf(a.findEntity(id)).point; }, ids.box);
  await page.mouse.move(...await scr([1.6, 0.25, 2.6]));
  await settle();
  await page.screenshot({ path: `${OUT}/13_toward.png` });
  await page.mouse.click(...await scr([1.6, 0.25, 2.6]));
  await settle(120);
  const tw = await pathOf(ids.cyl);
  const twD = tw ? hdist(tw.points[1], boxC) : NaN;
  const twAng = tw ? Math.abs(Math.atan2(tw.points[1][2] - tw.points[0][2], tw.points[1][0] - tw.points[0][0]) - Math.atan2(boxC[2] - tw.points[0][2], boxC[0] - tw.points[0][0])) * 180 / Math.PI : NaN;
  ok('验收3 走到：点地面（无 ⇧）不创建、留在绘制态', twGround.mode === 'toward' && twGround.toast.includes('请点击目标对象'), JSON.stringify(twGround));
  ok('验收3 走到方块：终点到方块中心水平距离 0.8 ± 0.01 m，方向偏差 < 1°', tw?.points.length === 2 && Math.abs(twD - 0.8) <= 0.01 && twAng < 1,
    `距离 ${twD.toFixed(4)} m，偏差 ${twAng.toFixed(4)}°`);

  // ---- 4 环绕：圆柱以方块为中心（替换走到路径）----
  await pathMenu('环绕');
  const replaceToast = await toastText();
  await toastClick('替换');
  await page.mouse.move(...await scr([1.6, 0.25, 2.6]));
  await settle();
  await page.screenshot({ path: `${OUT}/13_arc.png` });
  await page.mouse.click(...await scr([1.6, 0.25, 2.6]));
  await settle(150);
  const arc = await page.evaluate(({ id, c }) => {
    const a = window.__app;
    const p = a.timeline.toJSON().paths.find((x) => x.target === id);
    const s = a.pathTool.startPoint(a.findEntity(id));
    const R = Math.hypot(s[0] - c[0], s[2] - c[2]);
    return { R, d: p.points.map((q) => Math.hypot(q[0] - c[0], q[2] - c[2])), closed: p.closed, start: p.start, speed: p.speed, n: p.points.length };
  }, { id: ids.cyl, c: boxC });
  await page.evaluate(() => { [...document.querySelectorAll('.ptabs button')].find(b=>b.textContent==='运动轨迹')?.click(); document.querySelector('#inspector [data-sec="path"]')?.scrollIntoView(); });
  const setSweep = await page.evaluate(() => {
    const f = [...document.querySelectorAll('#inspector [data-sec="path"] .field')].find((x) => x.querySelector('label')?.textContent === '扫过角度');
    if (!f) return false;
    const inp = f.querySelector('input');
    inp.value = '360';
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });
  await settle(150);
  const arc2 = await pathOf(ids.cyl);
  const arc2d = arc2.points.map((q) => hdist(q, boxC));
  ok('验收4 环绕：已有路径时先确认替换', replaceToast.includes('重新绘制将替换现有路径'), replaceToast);
  ok('验收4 环绕方块：半径由当前位置得出，所有点到中心距离 = 半径 ± 1 cm',
    arc.n > 2 && arc.d.every((x) => Math.abs(x - arc.R) <= 0.01) && !arc.closed, `R=${arc.R.toFixed(3)} 点距=${arc.d.map((x) => x.toFixed(3)).join(',')}`);
  ok('验收4 Inspector 改扫过角度为 360 → closed=true，仍在圆上', setSweep && arc2.closed === true && arc2d.every((x) => Math.abs(x - arc.R) <= 0.01), `closed=${arc2.closed} n=${arc2.points.length}`);

  // ---- 11 往返（含手绘路径）----
  const rt = await page.evaluate(async () => {
    const a = window.__app;
    const strip = (d) => { const c = JSON.parse(JSON.stringify(d)); delete c.meta.updatedAt; return JSON.stringify(c); };
    const d1 = a.exportDocument();
    await a.loadDocument(JSON.parse(JSON.stringify(d1)), { applyView: true });
    const d2 = a.exportDocument();
    const selectedPaths = d2.paths.filter(p => a.selectedIds.has(p.target)).length;
    return { eq: strip(d1) === strip(d2), paths: d2.paths.length, items: a.pathOverlay.itemCount, selectedPaths, visible: a.pathOverlay.visible };
  });
  ok('验收11 含手绘路径的文档 导出 → 导入 → 导出 ≡；导入后立即显示选中对象的路径', rt.eq && rt.paths === 4 && rt.selectedPaths > 0 && rt.items === rt.selectedPaths && rt.visible, JSON.stringify(rt));

  // ---- 5 Explicitly enter editing before dragging existing vertices (round 4). ----
  await pickInOutliner(ids.An);
  await page.evaluate(() => [...document.querySelectorAll('.ptabs button')].find(b => b.textContent === '运动轨迹')?.click());
  await pathMenu('编辑现有轨迹');
  const pA = await pathOf(ids.A);
  await page.evaluate(() => {
    const tl = window.__app.timeline;
    window.__upd = 0;
    if (!tl.__spied) { const f = tl.updatePath.bind(tl); tl.updatePath = (...x) => { window.__upd++; return f(...x); }; tl.__spied = true; }
  });
  const H0 = await page.evaluate(() => window.__app.history.entries.length);
  const v1 = pA.points[1];
  let during = null;
  await dragPath([await scr(v1), await scr([v1[0] + 1, 0, v1[2]])], {
    steps: 12,
    hold: async () => {
      during = await animJSON();
      await page.screenshot({ path: `${OUT}/13_drag.png` });
    },
  });
  await sleep(50);
  const afterDrag = await page.evaluate(() => ({ n: window.__upd, H: window.__app.history.entries.length }));
  const pA2 = await pathOf(ids.A);
  const moved = [pA2.points[1][0] - v1[0], pA2.points[1][2] - v1[2]];
  ok('验收5 拖第 2 个顶点 1 m：拖动中文档不变；松手 updatePath 恰好 1 次、撤销栈 +1',
    JSON.stringify(during.paths) === JSON.stringify((await animJSON()).paths.map((p) => (p.id === pA.id ? pA : p))) && afterDrag.n === 1 && afterDrag.H === H0 + 1
      && Math.abs(moved[0] - 1) < 0.03 && Math.abs(moved[1]) < 0.03 && pA2.points.every((q, i) => i === 1 || JSON.stringify(q) === JSON.stringify(pA.points[i])),
    `updatePath×${afterDrag.n} history ${H0}→${afterDrag.H} 位移=${moved.map((x) => x.toFixed(3))}`);
  const v2 = pA2.points[2];
  const a0 = await scr(v2);
  await page.mouse.move(...a0); await page.mouse.down(); await page.mouse.move(a0[0] + 70, a0[1] - 40, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await settle(120);
  const escP = await pathOf(ids.A);
  ok('验收5 拖动中 Esc 取消：points 不变、未写文档', JSON.stringify(escP.points) === JSON.stringify(pA2.points) && (await page.evaluate(() => window.__upd)) === 1);
  await dragPath([await scr(v2), await scr([v2[0] - 0.5, 0, v2[2] - 0.7])], { steps: 10, shift: true });
  const shP = await pathOf(ids.A);
  const dl = shP.points.map((q, i) => [q[0] - pA2.points[i][0], q[2] - pA2.points[i][2]]);
  ok('验收5 ⇧拖整体平移：所有点位移一致', dl.every((d) => Math.abs(d[0] - dl[0][0]) < 1e-3 && Math.abs(d[1] - dl[0][1]) < 1e-3) && Math.hypot(...dl[0]) > 0.5,
    `位移=${dl.map((d) => d.map((x) => x.toFixed(3)).join('/')).join(' ')}`);
  // 平移回去（首点重新对齐角色，供后面的播放亮点检查）
  await page.evaluate((id) => { const a = window.__app; const p = a.timeline.toJSON().paths.find((x) => x.target === id); a.timeline.updatePath(p.id, { points: [a.pathTool.startPoint(a.findEntity(id)), ...p.points.slice(1)] }); }, ids.A);

  // ---- 6 插入 / 删除 ----
  const before6 = await pathOf(ids.A);
  const mid = await page.evaluate((pid) => {
    const a = window.__app;
    const path = a.pathOverlay.pathOf(pid);
    const n = a.timeline.toJSON().paths.find((p) => p.id === pid).points.length;
    const u = 1.5 / (n - 1); // 第 2、3 个顶点之间的中点（参数域）
    let lo = 0, hi = path.length;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (path.uAt(m) < u) lo = m; else hi = m; }
    const q = path.positionAt(lo);
    return [q.x, q.y, q.z];
  }, before6.id);
  await page.mouse.click(...await scr(mid), { count: 2 });
  await settle(150);
  const ins = await pathOf(ids.A);
  await page.screenshot({ path: `${OUT}/13_insert.png` });
  const np = ins.points[2], pa = ins.points[1], pb = ins.points[3];
  const between = ins.points.length === before6.points.length + 1 && hdist(np, pa) < hdist(pa, pb) && hdist(np, pb) < hdist(pa, pb) && hdist(np, mid) < 0.02;
  ok('验收6 双击曲线中点 → 点数 +1，新点在两邻点之间（落在曲线上）', between, `${before6.points.length} → ${ins.points.length} 新点=${JSON.stringify(np)}`);
  const selV = await page.evaluate(() => window.__app.pathOverlay.selVertex);
  await page.keyboard.press('Delete');
  await settle(150);
  const del = await pathOf(ids.A);
  const stillThere = await page.evaluate((id) => !!window.__app.findEntity(id), ids.A);
  ok('验收6 选中顶点 Del → 点数 −1（实体不被删除）', selV?.index === 2 && del.points.length === before6.points.length && stillThere, `${ins.points.length} → ${del.points.length}`);
  await pickInOutliner(ids.box2N);
  await page.evaluate(() => [...document.querySelectorAll('.ptabs button')].find(b => b.textContent === '运动轨迹')?.click());
  await pathMenu('编辑现有轨迹');
  const lnP = await pathOf(ids.box2);
  await page.mouse.click(...await scr(lnP.points[1]));
  await settle();
  await page.keyboard.press('Delete');
  await settle(150);
  const two = { n: (await pathOf(ids.box2)).points.length, toast: await toastText(), ent: await page.evaluate((id) => !!window.__app.findEntity(id), ids.box2) };
  ok('验收6 2 个点时 Del 被拒绝（toast）', two.n === 2 && two.toast.includes('至少需要 2 个顶点') && two.ent, JSON.stringify(two));

  // ---- 7 冲突：方块有 pos 轨道 ----
  await page.evaluate((id) => { const a = window.__app; const e = a.findEntity(id); const tl = a.timeline; const t = tl.addTrack({ target: id, property: 'pos' }); tl.setKey(t.id, 0, e.toJSON().transform.pos); tl.setKey(t.id, 2, [1.6, 0, 1.2]); a.playback.stop(); }, ids.box);
  await settle(200);
  await pickInOutliner(ids.boxN);
  const doc7 = JSON.stringify(await animJSON());
  await pathMenu('直线');
  const t7 = await toastText();
  await toastClick('取消');
  const mode7 = await page.evaluate(() => window.__app.pathTool.mode);
  const same7 = JSON.stringify(await animJSON()) === doc7;
  const H7 = await page.evaluate(() => window.__app.history.entries.length);
  await pathMenu('直线');
  await toastClick('删除并继续');
  await page.mouse.click(...await scr([2.8, 0, 3.4]));
  await settle(200);
  await sleep(50);
  const after7 = await page.evaluate((id) => { const a = window.__app; const j = a.timeline.toJSON(); return { tracks: j.timeline.tracks.filter((t) => t.target === id).length, path: !!j.paths.find((p) => p.target === id), H: a.history.entries.length }; }, ids.box);
  await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta');
  await sleep(400);
  const undo7 = await page.evaluate((id) => { const j = window.__app.timeline.toJSON(); return { tracks: j.timeline.tracks.filter((t) => t.target === id).length, path: !!j.paths.find((p) => p.target === id) }; }, ids.box);
  ok('验收7 有 pos 轨道点「路径」→ 确认 toast；取消 → 文档不变、不进绘制态', t7.includes('该对象已有位置关键帧') && same7 && mode7 === null, t7);
  ok('验收7 确认 → pos 轨道删除且路径创建，为一次撤销（⌘Z 后轨道恢复、路径消失）',
    after7.tracks === 0 && after7.path && after7.H === H7 + 1 && undo7.tracks === 1 && !undo7.path, `after=${JSON.stringify(after7)} undo=${JSON.stringify(undo7)}`);

  // ---- 8（补）⌥ + 左键拖动仍可环绕 ----
  await pickInOutliner(ids.An);
  const doc8 = JSON.stringify(await animJSON());
  await pathMenu('点击落点');
  await toastClick('替换'); // 已有路径：先确认替换（Esc 取消后文档不变）
  const cv0 = await page.evaluate(() => window.__app.stage.camera.position.toArray());
  await page.keyboard.down('Alt');
  await dragPath([await scr([0, 0, -1.5]), await scr([1.5, 0, -1.5])], { steps: 10 });
  await page.keyboard.up('Alt');
  await sleep(300);
  const cv1 = await page.evaluate(() => ({ pos: window.__app.stage.camera.position.toArray(), n: window.__app.pathTool.draft.length }));
  await page.keyboard.press('Escape');
  await settle();
  const esc8 = await page.evaluate(() => window.__app.pathTool.mode);
  ok('验收8 绘制态 ⌥ + 左键拖动 = 环绕（不落点）；Esc 退出、替换未执行', Math.hypot(...cv0.map((v, i) => v - cv1.pos[i])) > 0.1 && cv1.n === 1 && esc8 === null && JSON.stringify(await animJSON()) === doc8,
    `相机位移 ${Math.hypot(...cv0.map((v, i) => v - cv1.pos[i])).toFixed(3)} 草稿点数 ${cv1.n}`);
  await page.evaluate(() => { const a = window.__app; // 时间轴覆盖画布下部；绘制测试向上构图，点击点必须处于可见舞台。
    a.rig.controls.target.set(0, -1.5, 0.6); a.stage.camera.position.set(0, 7, 7.5); a.rig.controls.update(); });
  await settle(200);

  // ---- 9 可视化 ----
  await page.screenshot({ path: `${OUT}/9_selected.png` });
  await page.evaluate(() => window.__app.select(null));
  await settle();
  await page.screenshot({ path: `${OUT}/9_unselected.png` });
  const vis = await page.evaluate((id) => {
    const a = window.__app;
    const p = a.timeline.toJSON().paths.find((x) => x.target === id);
    a.select(id);
    a.playback.seek(p.start + p.duration * 0.45);
    const e = a.findEntity(id);
    const dot = a.pathOverlay.dotOf(p.id);
    return { d: Math.hypot(dot[0] - e.root.position.x, dot[2] - e.root.position.z) };
  }, ids.A);
  await settle(150);
  await page.screenshot({ path: `${OUT}/9_playing.png` });
  vis.pov = await page.evaluate(() => { const a = window.__app; a.setCameraView(true); const v = a.pathOverlay.visible; a.setCameraView(false); return v; });
  await pickInOutliner(ids.An);
  ok('验收9 播放亮点与角色脚底水平距离 < 5 cm；机位视角下路径不显示', vis.d < 0.05 && vis.pov === false, `距离 ${(vis.d * 100).toFixed(3)} cm`);
  await page.evaluate(() => window.__app.playback.stop());

  // ---- 13 Inspector 路径段截图 ----
  await page.evaluate(() => { [...document.querySelectorAll('.ptabs button')].find(b=>b.textContent==='运动轨迹')?.click(); document.querySelector('#inspector [data-sec="path"]')?.scrollIntoView(); });
  await settle();
  await page.screenshot({ path: `${OUT}/13_inspector.png`, clip: await panelClip() });

  // ---- 10 播放：角色 B 画一条 6 m 直线（替换手绘）后直接 Space ----
  // 长直线左端需落在可见画布内，不能点到左侧场景树。
  await page.evaluate(() => { const a = window.__app; a.rig.controls.target.set(-1.5, -1.5, 0); a.stage.camera.position.set(-1.5, 9, 11); a.rig.controls.update(); });
  await settle();
  await pickInOutliner(ids.Bn);
  await pathMenu('直线');
  await toastClick('替换');
  const bStart = await page.evaluate((id) => window.__app.pathTool.startPoint(window.__app.findEntity(id)), ids.B);
  const bEnd = [bStart[0] - 6, 0, bStart[2] - 0.3];
  await page.mouse.click(...await scr(bEnd));
  await settle(150);
  const p10 = await pathOf(ids.B);
  // 路径现在结束于场景末尾；关闭循环，才能验证自然停在10秒的终点。
  await page.evaluate(() => { window.__timelinePanel.setPref('loop', false); document.activeElement?.blur(); });
  await page.keyboard.press('Space');
  await page.waitForFunction((t) => window.__app.playback.time >= t, { timeout: 15000 }, p10.duration * 0.5);
  const walk = await page.evaluate((id) => { const e = window.__app.findEntity(id); return Object.values(e.values).reduce((s, v) => s + Math.abs(v), 0); }, ids.B);
  await page.waitForFunction((t) => window.__app.playback.time >= t, { timeout: 15000 }, p10.start + p10.duration);
  const end10 = await page.evaluate((id) => { const a = window.__app; a.playback.pause(); return window.__app.findEntity(id).toJSON({ base: null }).transform.pos; }, ids.B);
  const end10root = await page.evaluate((id) => { const e = window.__app.findEntity(id); return [e.root.position.x, e.root.position.z]; }, ids.B);
  const e10 = Math.hypot(end10root[0] - p10.points[1][0], end10root[1] - p10.points[1][2]);
  await page.evaluate(() => window.__app.playback.stop());
  ok('验收10 6 m 直线直接 Space：中途在走路（姿势非零），t ≥ 结束时停在终点（误差 < 1 cm）',
    Math.abs(hdist(p10.points[0], p10.points[1]) - 6) < 0.05 && walk > 1 && e10 < 0.01,
    `长 ${hdist(p10.points[0], p10.points[1]).toFixed(3)} m 时长 ${p10.duration}s 姿势Σ|v|=${walk.toFixed(1)} 终点误差 ${(e10 * 100).toFixed(3)} cm ${JSON.stringify(end10).length ? '' : ''}`);
  // 角色匀速路径从首帧朝向切线，不使用机位的 0.8 m 转身过渡。
  const turn10 = await page.evaluate(async (pid, id) => {
    const a = window.__app, pb = a.playback;
    const { Path, pathOptionsFor } = await import('/src/anim/Path.js');
    const { TURN_IN_DIST } = await import('/src/anim/PathTrack.js');
    const e = a.findEntity(id);
    const P = new Path(a.timeline.toJSON().paths.find((p) => p.id === pid), pathOptionsFor(e.type));
    const R2D = 180 / Math.PI;
    const yaw = () => e.root.rotation.clone().reorder('YXZ').y * R2D;
    const d = (x, y) => Math.abs(((x - y) % 360 + 540) % 360 - 180);
    const manual = yaw();
    const tan = P.tangentAt(P.length / 2);
    const tanYaw = Math.atan2(tan.x, tan.z) * R2D;
    let t06 = P.json.start;
    while (P.distanceAt(t06) < TURN_IN_DIST) t06 += 1 / 120;
    pb.seek(P.json.start); const s0 = d(yaw(), tanYaw);
    pb.seek(t06); const s1 = d(yaw(), tanYaw);
    let maxStep = 0, prev = null;
    for (let t = P.json.start; t <= t06 + 0.1; t += 1 / 30) { pb.seek(t); const y = yaw(); if (prev !== null) maxStep = Math.max(maxStep, d(y, prev)); prev = y; }
    pb.stop();
    return { manual, tanYaw, s0, s1, maxStep, t06 };
  }, p10.id, ids.B);
  ok('角色匀速直线：t=start 与走过 0.8 m 均朝向切线（< 0.5°），每帧 < 15°', turn10.s0 < 0.5 && turn10.s1 < 0.5 && turn10.maxStep < 15,
    JSON.stringify(Object.fromEntries(Object.entries(turn10).map(([k, v]) => [k, +v.toFixed(3)]))));
  // 收尾 1 · 停顿：点线插入一个中间顶点（自动选中）→ Inspector「在选中顶点处停顿」真实点击 → stops = [1]；该顶点处速度 0
  await page.evaluate((pid) => { const a = window.__app; const P = a.pathOverlay.pathOf(pid); a.pathEditor.insertAt(pid, P.length / 2); }, p10.id);
  await settle(200);
  await page.evaluate(id => { const p=window.__timelinePanel; p.trackRows.expandedEnts.add(id); p.rebuild(); }, ids.B);
  await settle();
  await page.click(`.tl-track[data-path="${p10.id}"] .tl-path-node:nth-of-type(3)`, {button:'right'});
  const stopUI0 = await page.$eval('.ctxmenu', n => n.innerText);
  await page.evaluate(() => [...document.querySelectorAll('.ctx-item')].find(n=>n.textContent.includes('在此节点停顿')).click());
  await settle(150);
  const stopUI = await page.evaluate(async (pid) => {
    const a = window.__app;
    const { Path } = await import('/src/anim/Path.js');
    const json = a.timeline.toJSON().paths.find((p) => p.id === pid);
    const P = new Path(json);
    return { stops: json.stops, v: P.speedAt(json.start + P.segmentTimes[0]), info: '第五轮停顿通过节点右键操作', hist: a.history.entries.length };
  }, p10.id);
  await page.screenshot({ path: `${OUT}/14_stop_inspector.png`, clip: await panelClip() });
  await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta');
  await settle(200);
  const stopUndo = await pathOf(ids.B);
  ok('停顿（节点右键）：选中中间顶点 → 勾「在选中顶点处停顿」→ stops=[1]、该顶点处速度 0；⌘Z 撤掉',
    stopUI0.includes('停顿') && JSON.stringify(stopUI.stops) === '[1]' && stopUI.v < 1e-9 && !('stops' in stopUndo) && stopUndo.points.length === 3,
    `「${stopUI0}」 stops=${JSON.stringify(stopUI.stops)} v=${stopUI.v} 撤销后 ${JSON.stringify(stopUndo.stops)} | ${stopUI.info.replace(/\s+/g, ' ')}`);

  console.log(`📁 产物：${OUT}/`);
}
