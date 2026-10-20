import fs from 'node:fs';
import { page, ok } from '../harness.mjs';
import { shootViewport, pixelDiff, sleep, settle, centerOf, clickSel, dragFromTo, pickInOutliner, dragPlayhead, gizmoDrag, canvasShot } from '../helpers.mjs';

export async function run() {
  const OUT = 'test-output/tl';
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  // 清掉会话偏好后重新加载：窗口 810 高 < 900，应默认折叠
  await page.evaluate(() => { localStorage.removeItem('director-stage.timeline'); });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__app?.history.enabled, { timeout: 30000 });
  await page.addStyleTag({ content: '#toast{visibility:hidden!important}' });
  const defCollapsed = await page.evaluate(() => document.getElementById('timeline').classList.contains('collapsed'));
  await clickSel('#dock .dockbtn[title^="时间轴"]');
  await settle(120);
  const expanded = await page.evaluate(() => document.getElementById('timeline').offsetHeight);
  ok('折叠：窗口高 < 900 默认折叠，Dock「时间轴」按钮展开到 220px', defCollapsed && expanded === 220, `default=${defCollapsed} h=${expanded}`);

  // ---- 场景：1 角色 + 2 道具 + 1 机位，导演相机俯视地面中心 ----
  const ids = await page.evaluate(async () => {
    const { createEmptyDocument } = await import('/src/doc/schema.js');
    const a = window.__app;
    a.playback.stop();
    await a.loadDocument(createEmptyDocument());
    const m = await a.addCharacter('male');
    m.root.position.set(0.9, m.root.position.y, 0);
    const p1 = a.addProp('box'); p1.root.position.set(-1.2, 0, 1.2);
    const p2 = a.addProp('cylinder'); p2.root.position.set(-0.4, 0, -1.4);
    const cam = a.addCamera('front_mid');
    a.select(null);
    a.rig.controls.target.set(0.4, 0, 0.3); a.stage.camera.position.set(0.6, 5.2, 6.4); a.rig.controls.update();
    a.history.reset();
    return { m: m.id, mName: m.name, p1: p1.id, p1Name: p1.name, p2: p2.id, p2Name: p2.name, cam: cam.id, camName: cam.name };
  });
  await settle(200);

  // ---- 1 从零做一段动画只靠界面 ----
  await pickInOutliner(ids.mName);
  await clickSel('#inspector .field .kf-dia'); // 位置栏菱形：idle → t=0 打键并进入 active
  await settle();
  await page.screenshot({ path: `${OUT}/02_inspector_keyed.png`, clip: await page.$eval('#rightPanel', (n) => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }) });
  const k0 = await page.evaluate((id) => ({ active: window.__app.timeline.active, tracks: window.__app.timeline.toJSON().timeline.tracks.filter((t) => t.target === id) }), ids.m);
  await dragPlayhead(3);
  const t3 = await page.evaluate(() => window.__app.playback.time);
  const before = await page.evaluate((id) => window.__app.timeline.valueOf(window.__app.findEntity(id), 'pos'), ids.m);
  await gizmoDrag('x', 2 - before[0]);
  await gizmoDrag('z', 1 - before[2]);
  const keys1 = await page.evaluate((id) => window.__app.timeline.toJSON().timeline.tracks.find((t) => t.target === id && t.property === 'pos').keys, ids.m);
  await dragPlayhead(1.5);
  const mid = await page.evaluate((id) => ({ t: window.__app.playback.time, v: window.__app.timeline.valueOf(window.__app.findEntity(id), 'pos') }), ids.m);
  await shootViewport(`${OUT}/1_t1.5.png`);
  const want = keys1.length === 2 ? keys1[0].value.map((v, i) => (v + keys1[1].value[i]) / 2) : [NaN, NaN, NaN];
  const err1 = Math.max(...want.map((v, i) => Math.abs(v - mid.v[i])));
  const k3 = keys1[1]?.value || [];
  ok('验收1 菱形在 t=0 打键并进入 active', k0.active && k0.tracks.length === 1 && k0.tracks[0].keys.length === 1 && k0.tracks[0].keys[0].t === 0, JSON.stringify(k0.tracks[0]?.keys));
  ok('验收1 拖播放头到 3s、gizmo 拖到 (2,0,1) → t=3 写键（已有轨道，自动打键关）',
    t3 === 3 && keys1.length === 2 && keys1[1].t === 3 && Math.abs(k3[0] - 2) < 0.03 && Math.abs(k3[1]) < 1e-6 && Math.abs(k3[2] - 1) < 0.03,
    `t=${t3} key3=${JSON.stringify(k3)}`);
  ok('验收1 播放头回 1.5s：角色位于两键中点 ±1cm', mid.t === 1.5 && err1 < 0.01, `pos=${JSON.stringify(mid.v)} 中点=${JSON.stringify(want.map((v) => +v.toFixed(4)))} 误差=${(err1 * 100).toFixed(3)}cm`);

  // ---- 2 自动打键 ----
  await clickSel('#timeline .tl-autokey');
  await dragPlayhead(2);
  await pickInOutliner(ids.p1Name);
  const n0 = await page.evaluate(() => window.__app.timeline.toJSON().timeline.tracks.length);
  await gizmoDrag('x', 0.6);
  const auto = await page.evaluate((id) => ({ autoKey: window.__app.autoKey, tracks: window.__app.timeline.toJSON().timeline.tracks.filter((t) => t.target === id) }), ids.p1);
  ok('验收2 自动打键开：t=2 拖无轨道道具 → 新建 pos 轨道 + 1 键',
    auto.autoKey && auto.tracks.length === 1 && auto.tracks[0].property === 'pos' && auto.tracks[0].keys.length === 1 && auto.tracks[0].keys[0].t === 2,
    JSON.stringify(auto.tracks.map((t) => [t.property, t.keys.map((k) => k.t)])));
  await clickSel('#timeline .tl-autokey');
  await pickInOutliner(ids.p2Name);
  const docPos = () => page.evaluate((id) => window.__app.toDocument().entities.find((e) => e.id === id).transform.pos, ids.p2);
  const p2a = await docPos();
  const n1 = await page.evaluate(() => window.__app.timeline.toJSON().timeline.tracks.length);
  await gizmoDrag('x', 0.5);
  const p2b = await docPos();
  const n2 = await page.evaluate(() => window.__app.timeline.toJSON().timeline.tracks.length);
  ok('验收2 自动打键关：拖无轨道道具 → 手动值改变、无新轨道',
    n1 === n0 + 1 && n2 === n1 && !(await page.evaluate(() => window.__app.autoKey)) && Math.abs(p2b[0] - p2a[0] - 0.5) < 0.03,
    `tracks ${n0}→${n1}→${n2} pos.x ${p2a[0]}→${p2b[0]}`);

  // ---- 3 菱形状态 ----
  const diaState = async (file) => {
    await settle();
    const s = await page.$eval('#inspector .field .kf-dia', (d) => ({ cls: d.className, bg: getComputedStyle(d).backgroundColor }));
    const clip = await page.$eval('#inspector .field.kf-row, #inspector .kf-label', (n) => { const b = n.closest('.field').getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
    await page.screenshot({ path: file, clip });
    return s;
  };
  await pickInOutliner(ids.mName);
  await page.keyboard.press('Home');
  const dKey = await diaState(`${OUT}/3_dia_key_t0.png`);
  await dragPlayhead(1.5);
  const dTrack = await diaState(`${OUT}/3_dia_track_t1.5.png`);
  await pickInOutliner(ids.p2Name);
  const dNone = await diaState(`${OUT}/3_dia_none.png`);
  ok('验收3 菱形：t=0 实心 / t=1.5 空心亮 / 无轨道空心灰',
    dKey.cls.endsWith(' key') && dKey.bg === 'rgb(59, 130, 246)' && dTrack.cls.endsWith(' track') && dTrack.bg === 'rgba(0, 0, 0, 0)' && dNone.cls.endsWith(' none'),
    `${dKey.cls}(${dKey.bg}) / ${dTrack.cls} / ${dNone.cls}`);

  // ---- 4 拖键 3s → 4s（吸附开，fps 30）+ 撤销 / 重做 ----
  const trackId = await page.evaluate((id) => window.__app.timeline.toJSON().timeline.tracks.find((t) => t.target === id && t.property === 'pos').id, ids.m);
  const fps = await page.evaluate(() => [window.__app.timeline.fps, window.__timelinePanel.snap]);
  const keySel = `.tl-key[data-track="${trackId}"][data-t="3"]`;
  const [kx, ky] = await centerOf(keySel);
  const pps = await page.evaluate(() => window.__timelinePanel.pps);
  await dragFromTo([kx, ky], [kx + pps * 1.004, ky], {
    steps: 10,
    hold: async () => { await settle(); await page.screenshot({ path: `${OUT}/03_key_dragging.png` }); },
  });
  const keyTimes = () => page.evaluate((tid) => window.__app.timeline.toJSON().timeline.tracks.find((t) => t.id === tid).keys.map((k) => k.t), trackId);
  const kt1 = await keyTimes();
  await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta');
  await sleep(400);
  const kt2 = await keyTimes();
  await page.keyboard.down('Meta'); await page.keyboard.down('Shift'); await page.keyboard.press('z'); await page.keyboard.up('Shift'); await page.keyboard.up('Meta');
  await sleep(400);
  const kt3 = await keyTimes();
  ok('验收4 拖键 3s → 4s（吸附、30fps）', fps[0] === 30 && fps[1] && JSON.stringify(kt1) === '[0,4]', JSON.stringify(kt1));
  ok('验收4 撤销一次回 3、重做回 4', JSON.stringify(kt2) === '[0,3]' && JSON.stringify(kt3) === '[0,4]', `${JSON.stringify(kt2)} / ${JSON.stringify(kt3)}`);

  // ---- 5 区间条（路径）----
  const pathId = await page.evaluate((id) => {
    const a = window.__app, e = a.findEntity(id);
    const [x, , z] = a.timeline.valueOf(e, 'pos');
    return a.timeline.addPath({ target: id, points: [[x, 0, z], [x + 1.5, 0, z + 0.8], [x + 2.5, 0, z]], start: 0, duration: 4 }).id;
  }, ids.p2);
  await settle();
  const pathOf = () => page.evaluate((pid) => { const p = window.__app.timeline.toJSON().paths.find((x) => x.id === pid); return { start: p.start, duration: p.duration }; }, pathId);
  const endXY = await centerOf('.tl-bar-path .tl-bar-end.end');
  await dragFromTo(endXY, [endXY[0] + pps * 2, endXY[1]]);
  const pa = await pathOf();
  const midXY = await page.$eval('.tl-bar-path', (n) => { const b = n.getBoundingClientRect(); return [b.x + b.width * 0.4, b.y + b.height / 2]; });
  await dragFromTo(midXY, [midXY[0] + pps, midXY[1]]);
  await settle();
  const pb = await pathOf();
  const insp = await page.$$eval('#inspector [data-sec="path"] .num-input', (ns) => ns.map((n) => +n.value));
  await page.screenshot({ path: `${OUT}/05_path_bar.png` });
  ok('验收5 拖路径条右端到 6s → duration=6', pa.start === 0 && pa.duration === 6, JSON.stringify(pa));
  ok('验收5 拖中间到 start 1 → start=1（时长不变），Inspector 路径段一致',
    pb.start === 1 && pb.duration === 6 && insp[0] === 1 && insp[1] === 6, `${JSON.stringify(pb)} inspector=${JSON.stringify(insp)}`);

  // ---- 6 约束段 ----
  await pickInOutliner(ids.camName);
  const cnsSel = async (i) => (await page.$$('#inspector [data-sec="constraint"] select'))[i];
  await (await cnsSel(0)).select(ids.m);
  await settle();
  const c1 = await page.evaluate((cam) => window.__app.timeline.toJSON().constraints.filter((c) => c.target === cam), ids.cam);
  const typeInto = async (i, text) => {
    const inp = (await page.$$('#inspector [data-sec="constraint"] .num-input'))[i];
    await inp.click({ clickCount: 3 });
    await page.keyboard.type(text);
    await page.keyboard.press('Tab');
    await settle();
  };
  await typeInto(0, '1');
  await typeInto(1, '3');
  const c2 = await page.evaluate((cam) => window.__app.timeline.toJSON().constraints.filter((c) => c.target === cam), ids.cam);
  await page.evaluate(() => { document.querySelector('#inspector [data-sec="constraint"]').scrollIntoView(); });
  await page.screenshot({ path: `${OUT}/06_constraint.png`, clip: await page.$eval('#rightPanel', (n) => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }) });
  await (await cnsSel(0)).select('');
  await settle();
  const c3 = await page.evaluate((cam) => window.__app.timeline.toJSON().constraints.filter((c) => c.target === cam), ids.cam);
  ok('验收6 约束段：注视 → 角色 产生 lookAt', c1.length === 1 && c1[0].type === 'lookAt' && c1[0].subject === ids.m && c1[0].start === null && c1[0].end === null, JSON.stringify(c1));
  ok('验收6 约束段：start=1 / end=3 写入文档', c2.length === 1 && c2[0].start === 1 && c2[0].end === 3, JSON.stringify(c2.map((c) => [c.start, c.end])));
  ok('验收6 约束段：选「无」删除', c3.length === 0, JSON.stringify(c3));

  // ---- 7 播放 / 停止 ----
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Escape');
  await settle(150);
  const idleShot = await shootViewport(`${OUT}/7_before.png`);
  const idle = await page.evaluate(() => !window.__app.timeline.active);
  await page.keyboard.press('Space');
  await sleep(1000);
  const playing = await page.evaluate(() => window.__app.playback.playing);
  await page.screenshot({ path: `${OUT}/04_playing.png` });
  // 播放中：同一同步块里读时刻并出图（画面与时刻严格对应）
  const tPlay = await page.evaluate(() => window.__app.playback.time);
  const shotPlay = await canvasShot(`${OUT}/7_playing.png`);
  const tPlay2 = await page.evaluate(() => window.__app.playback.time);
  await page.keyboard.press('Space');
  await page.evaluate((t) => window.__app.playback.seek(t), tPlay);
  const shotSeek = await canvasShot(`${OUT}/7_seek.png`);
  const dPlay = pixelDiff(shotPlay, shotSeek, `${OUT}/_diff_play.png`);
  ok('验收7 Space 开始播放，约 1s 时的画面 ≡ seek(该时刻)（< 0.5%）', idle && playing && tPlay > 0.6 && dPlay < 0.005,
    `t=${tPlay.toFixed(3)}（读图后 ${tPlay2.toFixed(3)}） 差 ${(dPlay * 100).toFixed(3)}%`);
  await page.keyboard.press('Escape');
  await settle(150);
  const stopShot = await shootViewport(`${OUT}/7_after_esc.png`);
  const dStop = pixelDiff(idleShot, stopShot, `${OUT}/_diff_esc.png`);
  ok('验收7 Esc 后场景 ≡ 进入前（0%）', dStop === 0 && await page.evaluate(() => !window.__app.timeline.active), `${(dStop * 100).toFixed(4)}%`);

  // ---- 8 快捷键 ----
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  const tFrame = await page.evaluate(() => window.__app.playback.time);
  await page.keyboard.press('End');
  const tEnd = await page.evaluate(() => [window.__app.playback.time, window.__app.timeline.duration]);
  await page.click('#timeline .tl-num');
  await page.keyboard.press('Space');
  await sleep(200);
  const typed = await page.evaluate(() => ({ playing: window.__app.playback.playing, focus: document.activeElement?.className }));
  await page.evaluate(() => document.activeElement?.blur());
  ok('验收8 → 一帧 = 1/fps；End = duration', Math.abs(tFrame - 1 / 30) < 1e-12 && tEnd[0] === tEnd[1], `→ ${tFrame} / End ${tEnd[0]}`);
  ok('验收8 输入框聚焦时 Space 不触发播放', !typed.playing && typed.focus === 'tl-num', JSON.stringify(typed));

  // ---- 10 面板性能：100 键、10 条轨道，播放 5s，主线程长任务 = 0 ----
  await page.keyboard.press('Escape');
  const perfSetup = await page.evaluate(async () => {
    const a = window.__app, tl = a.timeline;
    const props = [];
    for (let i = 0; i < 5; i++) { const p = a.addProp('box'); p.root.position.set(-2 + i, 0, 2.2); props.push(p); }
    a.select(null);
    for (const [i, p] of props.entries()) {
      const tp = tl.addTrack({ target: p.id, property: 'pos' });
      const tr = tl.addTrack({ target: p.id, property: 'rot' });
      for (let k = 0; k < 10; k++) {
        tl.setKey(tp.id, k, [-2 + i, (k % 2) * 0.5, 2.2], k % 3 === 0 ? 'smooth' : 'linear');
        tl.setKey(tr.id, k + 0.5, [0, k * 36, 0]);
      }
    }
    // 只统计这 10 条轨道（场景里另有前面步骤留下的轨道）
    const mine = tl.toJSON().timeline.tracks.filter((t) => props.some((p) => p.id === t.target));
    return { tracks: mine.length, keys: mine.reduce((n, t) => n + t.keys.length, 0) };
  });
  await settle(300);
  await page.evaluate(() => {
    window.__longTasks = [];
    window.__lt = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longTasks.push(Math.round(e.duration)); });
    window.__lt.observe({ type: 'longtask' });
  });
  await page.keyboard.press('Space');
  await sleep(5000);
  await page.keyboard.press('Space');
  const perf = await page.evaluate(() => { window.__lt.disconnect(); return { long: window.__longTasks, t: window.__app.playback.time }; });
  ok('验收10 100 键 / 10 条轨道播放 5s：主线程长任务（>50ms）为 0', perfSetup.keys === 100 && perfSetup.tracks === 10 && perf.long.length === 0,
    `keys=${perfSetup.keys} tracks=${perfSetup.tracks} 播放到 ${perf.t.toFixed(2)}s 长任务=${JSON.stringify(perf.long)}`);
  await page.keyboard.press('Escape');
  await settle(150);
  await page.screenshot({ path: `${OUT}/01_panel.png` });

  // ---- 收尾 1 · 面板列出所有实体：新建场景两个角色即出现；「◇ 打键」→ pos 行 + t=0 键 ----
  const bare = await page.evaluate(async () => {
    const { createEmptyDocument } = await import('/src/doc/schema.js');
    const a = window.__app;
    a.playback.stop();
    await a.loadDocument(createEmptyDocument());
    const m = await a.addCharacter('male');
    const f = await a.addCharacter('female');
    m.root.position.x = -1; f.root.position.x = 1;
    a.select(null);
    await new Promise((r) => setTimeout(r, 100));
    const rows = [...document.querySelectorAll('#timeline .tl-row')].map((r) => ({ ent: r.dataset.ent, bare: r.classList.contains('is-bare'), btn: !!r.querySelector('.tl-addkey'), color: getComputedStyle(r.querySelector('.tl-label')).color }));
    return { m: m.id, f: f.id, fName: f.name, rows };
  });
  await page.screenshot({ path: `${OUT}/20_bare_rows.png`, clip: await page.$eval('#timeline', (n) => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }) });
  ok('面板列出所有实体：新建场景两个角色即出现（灰字表头 + 「◇ 打键」）',
    bare.rows.length === 2 && bare.rows.every((r) => r.bare && r.btn) && bare.rows.some((r) => r.ent === bare.m) && bare.rows.some((r) => r.ent === bare.f), JSON.stringify(bare.rows));
  await clickSel(`#timeline .tl-row[data-ent="${bare.f}"] .tl-addkey`);
  await settle(150);
  const keyed = await page.evaluate((id) => {
    const a = window.__app;
    const tr = a.timeline.toJSON().timeline.tracks.filter((t) => t.target === id);
    const rows = [...document.querySelectorAll(`#timeline .tl-row[data-ent="${id}"]`)];
    return {
      tracks: tr.map((t) => [t.property, t.keys.map((k) => k.t)]),
      head: rows[0]?.classList.contains('is-bare'), posRow: rows.some((r) => r.dataset.track && r.querySelector('.tl-label')?.textContent === '位置'),
      key0: !!document.querySelector(`#timeline .tl-key[data-t="0"]`), sel: a.selectedIds.has(id), active: a.timeline.active,
    };
  }, bare.f);
  ok('面板「◇ 打键」：出现 pos 行且 t=0 有键（同 Inspector 位置菱形）、选中该角色',
    JSON.stringify(keyed.tracks) === '[["pos",[0]]]' && keyed.head === false && keyed.posRow && keyed.key0 && keyed.sel, JSON.stringify(keyed));
  await page.evaluate(() => window.__app.playback.stop());

  // ---- 收尾 1 · 播放中点进 Inspector 位置输入框 → 暂停；改完回车 → 键写在暂停时刻 ----
  await page.evaluate((id) => {
    const a = window.__app, tl = a.timeline;
    const tr = tl.toJSON().timeline.tracks.find((t) => t.target === id && t.property === 'pos');
    const v0 = tr.keys[0].value;
    tl.setKey(tr.id, 4, [v0[0] + 2, v0[1], v0[2]]);
    a.select(id);
    a.playback.seek(0);
    a.playback.play();
  }, bare.f);
  await sleep(500);
  const posX = await page.evaluate(() => {
    const f = [...document.querySelectorAll('#inspector .field')].find((n) => n.querySelector('label')?.textContent.startsWith('位置'));
    const b = f.querySelector('.triple input').getBoundingClientRect();
    return [b.x + b.width / 2, b.y + b.height / 2];
  });
  await page.mouse.click(...posX);
  await sleep(100);
  const focus8 = await page.evaluate(() => ({ state: window.__app.playback.state, t: window.__app.playback.time, focus: document.activeElement?.tagName }));
  await page.evaluate(() => document.activeElement.select()); // headless 下 ⌘A 不全选
  await page.keyboard.type('0.7');
  await page.keyboard.press('Enter');
  await settle(150);
  const typed8 = await page.evaluate((id, t) => {
    const a = window.__app;
    const tr = a.timeline.toJSON().timeline.tracks.find((x) => x.target === id && x.property === 'pos');
    const k = tr.keys.find((x) => Math.abs(x.t - t) < 1e-6);
    return { keys: tr.keys.map((x) => +x.t.toFixed(3)), x: k?.value[0], state: a.playback.state };
  }, bare.f, focus8.t);
  ok('播放中点进位置输入框 → 暂停（state=paused）；改完回车 → 键写在暂停时刻、不自动恢复播放',
    focus8.state === 'paused' && focus8.t > 0.2 && focus8.focus === 'INPUT' && Math.abs(typed8.x - 0.7) < 1e-9 && typed8.keys.length === 3 && typed8.state === 'paused',
    `聚焦时 ${JSON.stringify(focus8)}；回车后 keys=${JSON.stringify(typed8.keys)} x=${typed8.x} state=${typed8.state}`);
  await page.evaluate(() => { document.activeElement?.blur(); window.__app.playback.play(); });
  await sleep(200);
  const axXY = await page.evaluate(() => {
    const f = [...document.querySelectorAll('#inspector .field')].find((n) => n.querySelector('label')?.textContent.startsWith('位置'));
    const b = f.querySelector('.ax').getBoundingClientRect();
    return [b.x + b.width / 2, b.y + b.height / 2];
  });
  await page.mouse.move(...axXY); await page.mouse.down();
  const axState = await page.evaluate(() => window.__app.playback.state);
  await page.mouse.up();
  ok('播放中按下轴标签（拖动改值）同样先暂停', axState === 'paused', axState);
  await page.evaluate(() => window.__app.playback.stop());

  // ---- 9 折叠：视口高 +184px，刷新保持 ----
  const vh0 = await page.evaluate(() => document.getElementById('viewport').clientHeight);
  await clickSel('#timeline .tl-fold');
  await settle(150);
  const vh1 = await page.evaluate(() => document.getElementById('viewport').clientHeight);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__app?.history.enabled, { timeout: 30000 });
  const kept = await page.evaluate(() => ({ collapsed: document.getElementById('timeline').classList.contains('collapsed'), h: document.getElementById('timeline').offsetHeight, vh: document.getElementById('viewport').clientHeight }));
  ok('验收9 折叠后视口高度增加 184px', vh1 - vh0 === 184, `${vh0} → ${vh1}`);
  ok('验收9 刷新页面保持折叠', kept.collapsed && kept.h === 36 && kept.vh === vh1, JSON.stringify(kept));
  console.log(`📁 产物：${OUT}/`);
}
