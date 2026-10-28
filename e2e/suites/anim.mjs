import fs from 'node:fs';
import { page, ok } from '../harness.mjs';
import { shootViewport, pixelDiff, buildAnimScene } from '../helpers.mjs';

export async function run() {
  const OUT = 'test-output/anim';
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForFunction(() => window.__app.history.enabled, { timeout: 30000 });
  await page.addStyleTag({ content: '#toast{visibility:hidden!important}' });
  const ids = await buildAnimScene();

  // ---- 坏文档：5 种被定位拒绝，场景不变 ----
  const bad = await page.evaluate(async (ids) => {
    const { validate } = await import('/src/doc/schema.js');
    const a = window.__app;
    const good = a.exportDocument();
    good.timeline.tracks = [
      { id: 'trk00001', target: ids.m, property: 'rot', keys: [{ t: 0, value: [0, 0, 0], ease: 'linear' }, { t: 2.5, value: [0, 90, 0], ease: 'smooth' }, { t: 4, value: [0, 180, 0], ease: 'linear' }] },
      { id: 'trk00002', target: ids.c1, property: 'fov', keys: [{ t: 0, value: 40, ease: 'linear' }, { t: 3, value: 25, ease: 'linear' }] },
    ];
    good.paths = [{ id: 'pth00001', target: ids.f, points: [[1, 0, 0.6], [2, 0, -1], [0, 0, -2]], closed: false, start: 0, duration: 4, speed: 'smooth', orient: 'tangent' }];
    good.constraints = [{ id: 'cns00001', type: 'lookAt', target: ids.c2, subject: ids.f, offset: [0, 0, 0], start: null, end: null }];
    const v0 = validate(good);
    const cases = [
      ['未知 target', (d) => { d.timeline.tracks[0].target = 'ghost000'; }, 'timeline.tracks[0].target 引用的实体不存在'],
      ['keys 乱序', (d) => { d.timeline.tracks[0].keys[2].t = 2.5; }, 'timeline.tracks[0].keys[2].t 应大于前一键 2.5，实际为 2.5'],
      ['character 打 fov', (d) => { d.timeline.tracks[1].target = ids.m; }, 'timeline.tracks[1].target 应引用 camera'],
      ['id 重复', (d) => { d.paths[0].id = ids.p; }, 'paths[0].id 重复'],
      ['points 只有 1 个', (d) => { d.paths[0].points = [[0, 0, 0]]; }, 'paths[0].points 应为至少 2 个点'],
    ];
    const before = JSON.stringify({ ...a.exportDocument(), meta: null });
    const out = [];
    for (const [name, mut, expect] of cases) {
      const d = structuredClone(good);
      mut(d);
      const v = validate(d);
      let rejected = false;
      try { await a.loadDocument(d); } catch (e) { rejected = e.name === 'DocumentError'; }
      const unchanged = JSON.stringify({ ...a.exportDocument(), meta: null }) === before;
      out.push({ name, ok: !v.ok, located: v.errors.some((e) => e.startsWith(expect)), rejected, unchanged, first: v.errors[0] });
    }
    // 合法文档能加载；删除被引用的实体后，引用它的路径 / 约束一并删除，导出仍合法
    await a.loadDocument(good);
    const loaded = JSON.stringify(a.timeline.toJSON()) === JSON.stringify({ timeline: good.timeline, paths: good.paths, constraints: good.constraints });
    a.remove(ids.f);
    const after = a.exportDocument();
    const pruned = { paths: after.paths.length, constraints: after.constraints.length, tracks: after.timeline.tracks.length, valid: validate(after).ok };
    return { good: v0, out, loaded, pruned };
  }, ids);
  ok('文档：含动画的文档可加载，timeline.toJSON 与文档一致', bad.loaded);
  // ---- 关键帧：pos / rot / fov 轨道 + 播放 / 停止 / 导出不污染 ----
  await buildAnimScene().then((v) => Object.assign(ids, v));
  const kf = await page.evaluate(async (ids) => {
    const a = window.__app, tl = a.timeline, pb = a.playback;
    const strip = (d) => JSON.stringify({ ...d, meta: null });
    const manualDoc = strip(a.exportDocument());
    const m = a.findEntity(ids.m), c1 = a.findEntity(ids.c1);
    const before = { pos: m.root.position.toArray(), rot: m.root.rotation.toArray().slice(0, 3), fov: c1.cam.fov };
    const tp = tl.addTrack({ target: ids.m, property: 'pos' });
    tl.setKey(tp.id, 0, [-1.2, 0, 0]);
    tl.setKey(tp.id, 4, [1.8, 0, 0], 'smooth');
    const tr = tl.addTrack({ target: ids.m, property: 'rot' });
    tl.setKey(tr.id, 0, [0, 0, 0]);
    tl.setKey(tr.id, 4, [0, 180, 0]);
    const tf = tl.addTrack({ target: ids.c1, property: 'fov' });
    tl.setKey(tf.id, 0, 40);
    tl.setKey(tf.id, 2, 20, 'step');
    tl.setKey(tf.id, 3, 60);
    const idleUntouched = m.root.position.x === before.pos[0]; // 打键不进入 active
    pb.seek(2);
    const at2 = { x: m.root.position.x, yaw: m.root.rotation.y * 180 / Math.PI, fov: c1.cam.fov, state: pb.state };
    pb.seek(2.5);
    const fov25 = c1.cam.fov; // step：2..3 段保持 20
    const docWhileActive = strip(a.exportDocument());
    pb.play();
    await new Promise((r) => setTimeout(r, 300));
    pb.pause();
    const playedTo = pb.time;
    const docWhilePlaying = strip(a.exportDocument());
    pb.stop();
    const after = { pos: m.root.position.toArray(), rot: m.root.rotation.toArray().slice(0, 3), fov: c1.cam.fov };
    // 文档：去掉三条轨道后应与打键前的手动文档一致
    const noAnim = (d) => { const o = JSON.parse(d); o.timeline.tracks = []; return JSON.stringify(o); };
    return {
      idleUntouched, at2, fov25, playedTo, state: pb.state,
      restored: JSON.stringify(before) === JSON.stringify(after),
      exportBase: noAnim(docWhileActive) === manualDoc && noAnim(docWhilePlaying) === manualDoc,
    };
  }, ids);
  // smooth 段 t=2：u=0.5 → x = -1.2 + 3×0.5 = 0.3；rot linear 0→180 在 t=2 为 90°；fov 0→2 linear 40→20，t=2 恰好 20
  ok('关键帧：打键时不进入 active（场景仍为手动值）', kf.idleUntouched);
  ok('关键帧：seek(2) 位置 / 旋转 / FOV 插值正确', Math.abs(kf.at2.x - 0.3) < 1e-9 && Math.abs(kf.at2.yaw - 90) < 1e-4 && Math.abs(kf.at2.fov - 20) < 1e-9 && kf.at2.state === 'paused', JSON.stringify(kf.at2));
  ok('关键帧：step 缓动保持到下一键', kf.fov25 === 20, `fov@2.5=${kf.fov25}`);
  ok('关键帧：play / pause 推进时间', kf.playedTo > 0.2 && kf.playedTo < 3, `time=${kf.playedTo.toFixed(3)}`);
  ok('关键帧：stop() 后回到手动值、状态 idle', kf.restored && kf.state === 'idle');
  ok('关键帧：active / 播放中 exportDocument() 导出 base', kf.exportBase);
  // ---- 路径：道具 / 机位 / 角色沿 Catmull-Rom 移动，tangent 朝向，smooth 首尾速度为 0 ----
  await buildAnimScene().then((v) => Object.assign(ids, v));
  const pt = await page.evaluate(async (ids) => {
    const { Path, rampFor, pathOptionsFor } = await import('/src/anim/Path.js');
    const a = window.__app, tl = a.timeline, pb = a.playback;
    const p = a.findEntity(ids.p), c2 = a.findEntity(ids.c2), m = a.findEntity(ids.m);
    const R2D = 180 / Math.PI;
    const pp = tl.addPath({ target: ids.p, points: [[0.2, 0, -1.4], [2, 0, -1.4], [2.5, 0, 1]], start: 1, duration: 3, speed: 'linear', orient: 'tangent' });
    const cp = tl.addPath({ target: ids.c2, points: [[3, 1.6, 3], [0, 1.8, 4], [-3, 1.6, 3]], start: 0, duration: 4, speed: 'smooth', orient: 'tangent' });
    const mp = tl.addPath({ target: ids.m, points: [[-1.2, 0, 0], [-1.2, 0, 3]], start: 0, duration: 4, speed: 'smooth', orient: 'tangent' });
    const P = new Path(pp, { ramp: rampFor('prop') }), C = new Path(cp), M = new Path(mp, pathOptionsFor('character'));
    const out = {};
    const near = (v, arr, eps = 1e-6) => arr.every((x, i) => Math.abs(v[i] - x) < eps);
    pb.seek(0);
    out.beforeStart = near(p.root.position.toArray(), [0.2, 0, -1.4]);
    pb.seek(5);
    out.afterEnd = near(p.root.position.toArray(), [2.5, 0, 1]);
    pb.seek(2.5);
    const s = P.distanceAt(2.5), tan = P.tangentAt(s);
    out.onCurve = near(p.root.position.toArray(), P.positionAt(s).toArray());
    out.halfway = Math.abs(s - P.length / 2) < 1e-9;
    out.propYawErr = Math.abs(((p.root.rotation.y - Math.atan2(tan.x, tan.z)) * R2D + 540) % 360 - 180);
    // 机位：镜头方向（−Z）的水平分量与切线一致
    pb.seek(1.3);
    const ct = C.tangentAt(C.distanceAt(1.3));
    const dir = new (p.root.position.constructor)(0, 0, -1).applyQuaternion(c2.root.quaternion);
    out.camDirErr = Math.acos(Math.min(1, (dir.x * ct.x + dir.z * ct.z) / Math.hypot(dir.x, dir.z) / Math.hypot(ct.x, ct.z))) * R2D;
    out.camHeight = c2.root.position.y;
    // 角色：沿 +Z 走，yaw = 0；脚底高度 = 路径 y；仍是原姿势（本步不切步态）
    pb.seek(2);
    out.charYaw = m.root.rotation.y * R2D;
    out.charDocY = a.exportDocument().entities.find((e) => e.id === ids.m).transform.pos[1];
    out.charRootY = m.root.position.y - m.rootY0;
    out.charZ = m.root.position.z;
    // 旧 smooth 人物路径也从起步匀速，机位仍保留缓入缓出。
    out.speeds = [M.speedAt(0), M.speedAt(2), M.speedAt(4), C.speedAt(0), C.speedAt(4)];
    pb.seek(1 / 240);
    out.startDistance = m.root.position.z;
    out.maxSpeedError = 0;
    let prevZ = null;
    for (let i = 0; i <= 240; i++) {
      pb.seek(i / 60);
      if (prevZ !== null) out.maxSpeedError = Math.max(out.maxSpeedError, Math.abs((m.root.position.z - prevZ) * 60 - 0.75));
      prevZ = m.root.position.z;
    }
    pb.stop();
    out.stopped = near(p.root.position.toArray(), [0.2, 0, -1.4]) && Math.abs(m.root.position.z) < 1e-9;
    return out;
  }, ids);
  ok('路径：start 前停在起点、结束后停在终点', pt.beforeStart && pt.afterEnd);
  ok('路径：位置在曲线上，匀速时半程 = 半长', pt.onCurve && pt.halfway);
  ok('路径：道具 orient=tangent 朝向切线', pt.propYawErr < 1e-4, `误差 ${pt.propYawErr.toExponential(2)}°`);
  ok('路径：机位镜头方向沿切线、高度取路径 y', pt.camDirErr < 1e-3 && pt.camHeight > 1.6 && pt.camHeight < 1.81, `误差 ${pt.camDirErr.toExponential(2)}°，y=${pt.camHeight.toFixed(3)}`);
  ok('路径：角色沿 +Z 朝向切线、贴路径高度（root.y − 站立基准 = 0）', Math.abs(pt.charYaw) < 1e-6 && Math.abs(pt.charRootY) < 1e-9 && Math.abs(pt.charZ - 1.5) < 1e-4, JSON.stringify({ yaw: pt.charYaw, z: pt.charZ }));
  ok('路径：active 时导出的仍是手动位置', pt.charDocY === 0);
  ok('路径：人物旧 smooth 路径首帧即匀速，全程 0.75 m/s；机位保留缓入缓出', pt.speeds.slice(0, 3).every(v => Math.abs(v - 0.75) < 1e-9) && pt.speeds[3] === 0 && pt.speeds[4] === 0 && Math.abs(pt.startDistance - 0.003125) < 1e-5 && pt.maxSpeedError < 0.002, `逐帧速度最大误差 ${pt.maxSpeedError.toFixed(6)} m/s，起步 ${pt.startDistance.toFixed(6)} m`);
  ok('路径：stop() 回到手动位置', pt.stopped);
  // ---- 步态：6 m 直线 smooth 4 s；压到 1.5 s 仍走路；组沿路径成员一起走 ----
  await buildAnimScene().then((v) => Object.assign(ids, v));
  const gait = await page.evaluate(async (ids) => {
    const a = window.__app, tl = a.timeline, pb = a.playback;
    const m = a.findEntity(ids.m);
    m.applyPosePreset('think'); a.edited(m); // 原姿势不是站立：停下后应回到它
    a.history.reset();
    const base = { ...m.values };
    const dir = [Math.sin(0.5), 0, Math.cos(0.5)]; // 斜向 6 m
    const start = [m.root.position.x, 0, m.root.position.z];
    const path = tl.addPath({ target: ids.m, points: [start, start.map((v, i) => v + dir[i] * 6)], start: 0, duration: 4, speed: 'smooth', orient: 'tangent' });
    const same = (v) => Object.keys(base).every((k) => v[k] === base[k]);
    const R2D = 180 / Math.PI;
    const out = {};
    pb.seek(0); out.t0 = same(m.values) && m.autoGround;
    pb.seek(4); out.t4 = same(m.values) && m.autoGround;
    pb.seek(2);
    out.walking = !same(m.values) && !m.autoGround;
    const midPose = { ...m.values };
    pb.seek(2.2);
    out.walking &&= Math.abs(m.values.lLegFwd - midPose.lLegFwd) > 5;
    pb.seek(2);
    const want = Math.atan2(dir[0], dir[2]);
    out.yawErr = Math.abs(((m.root.rotation.y - want) * R2D + 540) % 360 - 180);
    // 逐帧：骨盆世界高度相邻帧差；w=1 时脚底贴地（脚底最低点 vs 站立时）
    let prev = null; out.maxDy = 0; out.soleErr = 0;
    const P = new (await import('/src/anim/Path.js')).Path(path);
    for (let i = 0; i <= 120; i++) {
      pb.seek(i / 30);
      const y = m.root.position.y + m.model.position.y * m.root.scale.y;
      if (prev !== null) out.maxDy = Math.max(out.maxDy, Math.abs(y - prev));
      prev = y;
      // 完整走路步态时任意时刻都有一只脚着地
      const v = P.speedAt(i / 30);
      if (v >= 0.5 && v <= 1.8 && i / 30 >= 0.5 && i / 30 <= 3.5) {
        const e = (m.lowestSoleY() - m.legGeom.ground / m.baseScale) * m.root.scale.y;
        if (Math.abs(e) > Math.abs(out.soleErr)) out.soleErr = e;
      }
    }
    // 加速走：同一路径压到 1.5 s（平均 4 m/s），仍保持走路摆臂和直立躯干
    tl.updatePath(path.id, { duration: 1.5 });
    pb.seek(0.75);
    out.fastWalk = m.values.lFore === 12 && m.values.rFore === 12 && m.values.spineX === 0;
    out.fastSoleErr = (m.lowestSoleY() - m.legGeom.ground / m.baseScale) * m.root.scale.y;
    pb.stop();
    out.restored = same(m.values);
    // 组沿路径：成员切步态、彼此相位错开；停下恢复各自原姿势
    const crowd = await a.addCrowd(2, 2, 1.1);
    a.select(null);
    tl.addPath({ target: crowd.id, points: [[-2, 0, -3], [2, 0, -3]], start: 0, duration: 4, speed: 'linear', orient: 'tangent' });
    pb.seek(2);
    const legs = crowd.members.map((c) => +(c.values.lLegFwd - c.values.rLegFwd).toFixed(2));
    out.crowdWalk = legs.every((d) => d !== 0) && new Set(legs).size > 1;
    pb.stop();
    out.crowdRestored = crowd.members.every((c) => Object.values(c.values).every((v) => v === 0));
    return out;
  }, ids);
  ok('步态：t=0 / t=4 姿势 ≡ 原姿势（values 逐项相等，自动贴地）', gait.t0 && gait.t4);
  ok('步态：t=2 为步行姿势且朝向路径方向', gait.walking && gait.yawErr < 1, `yaw 误差 ${gait.yawErr.toFixed(4)}°`);
  ok('步态：逐帧骨盆高度相邻帧差 < 2cm（不跳）', gait.maxDy < 0.02, `max ${(gait.maxDy * 100).toFixed(2)}cm`);
  ok('步态：行走中脚底贴地（±1cm）', Math.abs(gait.soleErr) < 0.01, `最大偏差 ${(gait.soleErr * 100).toFixed(2)}cm（正 = 悬空）`);
  ok('步态：压到 1.5 s（4 m/s）仍走路且脚底贴地', gait.fastWalk && Math.abs(gait.fastSoleErr) < 0.01, `脚底偏差 ${(gait.fastSoleErr * 100).toFixed(2)}cm`);
  ok('步态：stop() 后恢复原姿势', gait.restored);
  ok('步态：组沿路径时成员一起走、步伐错开，停下恢复', gait.crowdWalk && gait.crowdRestored);
  // ---- 收尾 1 · 路径停顿 stops：角色走到中间顶点停下（速度 0、原姿势）再走；含 stops 的文档往返 ≡ ----
  await buildAnimScene().then((v) => Object.assign(ids, v));
  const stopRes = await page.evaluate(async (ids) => {
    const { Path } = await import('/src/anim/Path.js');
    const a = window.__app, tl = a.timeline, pb = a.playback;
    const m = a.findEntity(ids.m);
    const x = m.root.position.x, z = m.root.position.z;
    const json = tl.addPath({ target: ids.m, points: [[x, 0, z], [x, 0, z + 2], [x + 2, 0, z + 2], [x + 2, 0, z + 4]], start: 0, duration: 6, speed: 'smooth', orient: 'tangent' });
    const p1 = tl.updatePath(json.id, { stops: [1] });
    const P = new Path(p1);
    const T1 = P.segmentTimes[0];
    const base = { ...m.values };
    pb.seek(T1);
    const pos = m.toJSON().transform.pos;
    const out = {
      T1, stops: p1.stops, hasTimes: 'stopTimes' in p1,
      atVertex: Math.hypot(pos[0] - x, pos[2] - (z + 2)),
      still: Object.keys(base).every((k) => Math.abs((m.values[k] || 0) - (base[k] || 0)) < 1e-9),
      v: P.speedAt(T1),
    };
    pb.seek(T1 / 2);
    const midLeg = m.values.lLegFwd;
    pb.seek(T1 / 2 + 0.3);
    out.walkMid = !m.autoGround && Math.abs(m.values.lLegFwd - midLeg) > 5;
    pb.stop();
    const d1 = a.exportDocument();
    await a.loadDocument(JSON.parse(JSON.stringify(d1)));
    const d2 = a.exportDocument();
    d1.meta.updatedAt = d2.meta.updatedAt = null;
    out.roundTrip = JSON.stringify(d1) === JSON.stringify(d2) && JSON.stringify(d2.paths[0].stops) === '[1]';
    // 插入 / 删除顶点后停顿索引跟着走；顶点数被整体替换时停顿去掉
    const id = d2.paths[0].id;
    a.select(ids.m, { user: true });
    out.inserted = a.pathEditor.insertAt(id, 0.5)?.inserted === true;
    out.afterInsert = tl.toJSON().paths[0].stops;
    a.pathEditor.deleteVertex(id, 1);
    out.afterDelete = tl.toJSON().paths[0].stops;
    tl.updatePath(id, { points: [[x, 0, z], [x + 3, 0, z]] });
    out.afterReplace = 'stops' in tl.toJSON().paths[0];
    return out;
  }, ids);
  ok('停顿：角色走到停顿顶点时 速度 0、在顶点上（< 1 cm）、姿势 ≡ 原姿势；段中在走', stopRes.v < 1e-9 && stopRes.atVertex < 0.01 && stopRes.still && stopRes.walkMid && !stopRes.hasTimes,
    `stops=${JSON.stringify(stopRes.stops)} T1=${stopRes.T1.toFixed(3)}s 离顶点 ${(stopRes.atVertex * 100).toFixed(4)} cm`);
  ok('停顿：含 stops 的文档往返 ≡；插入 / 删除顶点后索引跟着走，顶点数整体改变时去掉', stopRes.roundTrip && stopRes.inserted && JSON.stringify(stopRes.afterInsert) === '[2]' && JSON.stringify(stopRes.afterDelete) === '[1]' && !stopRes.afterReplace,
    JSON.stringify({ rt: stopRes.roundTrip, ins: stopRes.afterInsert, del: stopRes.afterDelete, replaced: stopRes.afterReplace }));
  // ---- 收尾 1 · 起步立即转向：手动朝向 −100°、路径朝 +X（90°），差 170° ----
  await buildAnimScene().then((v) => Object.assign(ids, v));
  const turn = await page.evaluate(async (ids) => {
    const { Path, pathOptionsFor } = await import('/src/anim/Path.js');
    const a = window.__app, tl = a.timeline, pb = a.playback;
    const m = a.findEntity(ids.m);
    const R2D = 180 / Math.PI;
    m.root.rotation.set(0, -100 / R2D, 0); a.edited(m);
    a.history.reset();
    const x = m.root.position.x, z = m.root.position.z;
    const json = tl.addPath({ target: ids.m, points: [[x, 0, z], [x + 4, 0, z]], start: 1, duration: 3, speed: 'smooth', orient: 'tangent' });
    const P = new Path(json, pathOptionsFor('character'));
    const yaw = () => { const e = m.root.rotation.clone().reorder('YXZ'); return e.y * R2D; };
    const d = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
    const out = { maxStep: 0, beforeErr: 0, afterErr: 0 };
    let prev = null;
    for (let i = 0; i <= 120; i++) {
      const t = i / 30;
      pb.seek(t);
      const y = yaw();
      if (prev !== null) out.maxStep = Math.max(out.maxStep, d(y, prev));
      prev = y;
      if (t <= 1) out.beforeErr = Math.max(out.beforeErr, d(y, 90));
      else out.afterErr = Math.max(out.afterErr, d(y, 90));
    }
    pb.seek(1); out.startErr = d(yaw(), 90);
    pb.seek(1.6); out.uniformErr = Math.abs((m.root.position.x - x) - 4 / 3 * 0.6);
    out.vStart = P.speedAt(1) / (4 / 3);
    pb.stop();
    out.restored = d(yaw(), -100) < 1e-9;
    return out;
  }, ids);
  ok('起步转身：t ≤ start 朝向 ≡ 出发方向（< 0.5°）', turn.startErr < 0.5 && turn.beforeErr < 0.5, `t=start 误差 ${turn.startErr.toFixed(4)}°，之前最大 ${turn.beforeErr.toFixed(4)}°`);
  ok('起步转身：行走中朝向 ≡ 切线（< 0.5°）', turn.afterErr < 0.5, `最大误差 ${turn.afterErr.toFixed(4)}°`);
  ok('起步匀速：人物从开始即按总长度 / 时长移动', turn.uniformErr < 1e-4 && Math.abs(turn.vStart - 1) < 1e-9, `位移误差 ${turn.uniformErr.toExponential(2)} m，起步速度 / 匀速 = ${turn.vStart.toFixed(4)}`);
  ok('起步转身：第一帧已对齐，无渐转等待，停止恢复手动朝向', turn.maxStep < 1e-6 && turn.restored, `最大 ${turn.maxStep.toFixed(2)}°/帧；停止后回手动朝向 ${turn.restored}`);
  const drawnFacing = await page.evaluate(async (id) => {
    const a = window.__app, m = a.findEntity(id);
    const before = m.root.quaternion.clone();
    a.history.reset();
    a.pathTool.request('points', m.id);
    const x = m.root.position.x, z = m.root.position.z;
    a.pathTool.draft = [[x, 0, z], [x + 4, 0, z]]; a.pathTool.finish();
    const facesDeparture = () => Math.abs(m.root.rotation.clone().reorder('YXZ').y - Math.PI / 2) < 1e-6;
    const immediate = !a.timeline.active && facesDeparture();
    await a.history.undo();
    const undone = m.root.quaternion.angleTo(before) < 1e-6;
    await a.history.redo();
    const redone = facesDeparture();
    await a.history.undo();
    return { immediate, undone, redone };
  }, ids.m);
  ok('绘制完成：未播放即面朝出发方向，撤销 / 重做同步恢复朝向', Object.values(drawnFacing).every(Boolean), JSON.stringify(drawnFacing));
  // ---- 约束：lookAt 保留 roll；follow 刚性跟随且覆盖 pos 轨道 / 路径 ----
  await buildAnimScene().then((v) => Object.assign(ids, v));
  const cons = await page.evaluate(async (ids) => {
    const { aimPoint, anchorOf } = await import('/src/anim/Constraint.js');
    const a = window.__app, tl = a.timeline, pb = a.playback;
    const c1 = a.findEntity(ids.c1), c2 = a.findEntity(ids.c2);
    const V = c1.root.position.constructor, Q = c1.root.quaternion.constructor;
    c1.rollRad = 12 * Math.PI / 180; // 荷兰角
    // f 沿弧线走（会转向）；c1 注视 f；c2 跟随 f，覆盖位置轨道但保留独立朝向。
    tl.addPath({ target: ids.f, points: [[1, 0, 0.6], [2.5, 0, -1], [1, 0, -3], [-1, 0, -2]], start: 0, duration: 5, speed: 'linear', orient: 'tangent' });
    tl.addConstraint({ type: 'lookAt', target: ids.c1, subject: ids.f });
    const tp = tl.addTrack({ target: ids.c2, property: 'pos' });
    tl.setKey(tp.id, 0, [5, 5, 5]); tl.setKey(tp.id, 5, [-5, 5, 5]);
    const fo = tl.addConstraint({ type: 'follow', target: ids.c2, subject: ids.f, offset: [0.4, 1.6, -2.5] });
    const R2D = 180 / Math.PI;
    let maxAim = 0, maxRoll = 0, maxOff = 0, maxRot = 0;
    for (let i = 0; i <= 10; i++) {
      const t = i * 0.5;
      pb.seek(t);
      // lookAt：−Z 与指向注视点的夹角
      const p = aimPoint(a, ids.f);
      const fwd = new V(0, 0, -1).applyQuaternion(c1.root.quaternion);
      const to = p.clone().sub(c1.root.position).normalize();
      maxAim = Math.max(maxAim, Math.acos(Math.min(1, fwd.dot(to))) * R2D);
      // roll：去掉 roll 后相机的 up 应在"竖直平面"里 —— 等价于：实际 up 与无 roll up 的夹角 = 12°
      const up = new V(0, 1, 0).applyQuaternion(c1.root.quaternion);
      const right0 = fwd.clone().cross(new V(0, 1, 0)).normalize();
      const up0 = right0.clone().cross(fwd).normalize();
      const roll = Math.atan2(up.dot(right0) * -1, up.dot(up0)) * R2D;
      maxRoll = Math.max(maxRoll, Math.abs(Math.abs(roll) - 12));
      // follow：相对偏移（subject yaw 坐标系）恒等于 offset
      const an = anchorOf(a, ids.f);
      const rel = c2.root.position.clone().sub(an.pos).applyQuaternion(new Q().setFromAxisAngle(new V(0, 1, 0), -an.yaw));
      maxOff = Math.max(maxOff, rel.distanceTo(new V(0.4, 1.6, -2.5)));
      // follow 不参与朝向求值。
      const want = new Q().setFromEuler(tl.baseOf(c2).rotation);
      maxRot = Math.max(maxRot, 2 * Math.acos(Math.min(1, Math.abs(want.dot(c2.root.quaternion)))) * R2D);
    }
    // 生效区间：end 之后 follow 失效，pos 轨道接管
    tl.updateConstraint(fo.id, { start: 0, end: 2 });
    pb.seek(4);
    const trackX = c2.root.position.x; // pos 轨道 t=4：5 + (−10)×0.8 = −3
    pb.stop();
    return { maxAim, maxRoll, maxOff, maxRot, trackX, rollKept: Math.abs(c1.rollRad * R2D - 12) < 1e-9 };
  }, ids);
  ok('约束：lookAt 机位 −Z 对准 subject（每 0.5 s 采样）', cons.maxAim < 0.1, `max ${cons.maxAim.toExponential(2)}°`);
  ok('约束：lookAt 保留荷兰角 roll', cons.maxRoll < 0.1 && cons.rollKept, `max 偏差 ${cons.maxRoll.toExponential(2)}°`);
  ok('约束：follow 相对偏移恒等于 offset（subject yaw 坐标系），覆盖 pos 轨道', cons.maxOff < 1e-6, `max ${cons.maxOff.toExponential(2)}m`);
  ok('约束：follow 不改变机位独立朝向', cons.maxRot < 1e-3, `max ${cons.maxRot.toExponential(2)}°`);
  ok('约束：生效区间外 follow 失效，pos 轨道接管', Math.abs(cons.trackX + 3) < 1e-9, `x=${cons.trackX}`);
  // ======== 验收 1–6：完整动画场景（pos/rot/scale/fov 轨道各 1、角色路径 1、lookAt 1、follow 1）========
  await buildAnimScene().then((v) => Object.assign(ids, v));
  await page.evaluate(async (ids) => {
    const a = window.__app, tl = a.timeline;
    const tp = tl.addTrack({ target: ids.f, property: 'pos' });
    tl.setKey(tp.id, 0, [1.0, 0, 0.6]); tl.setKey(tp.id, 6, [2.2, 0, -0.8], 'smooth');
    const tr = tl.addTrack({ target: ids.f, property: 'rot' });
    tl.setKey(tr.id, 0, [0, 0, 0]); tl.setKey(tr.id, 6, [0, -120, 0]);
    const ts = tl.addTrack({ target: ids.m, property: 'scale' });
    tl.setKey(ts.id, 0, [1, 1, 1]); tl.setKey(ts.id, 8, [1.15, 1.15, 1.15]);
    const tf = tl.addTrack({ target: ids.c1, property: 'fov' });
    tl.setKey(tf.id, 0, 40); tl.setKey(tf.id, 8, 28, 'smooth');
    tl.addPath({ target: ids.m, points: [[-1.2, 0, 0], [-0.5, 0, 2], [1, 0, 3], [2.5, 0, 2.5]], start: 0.5, duration: 6, speed: 'smooth', orient: 'tangent' });
    tl.addConstraint({ type: 'lookAt', target: ids.c1, subject: ids.m });
    tl.addConstraint({ type: 'follow', target: ids.c2, subject: ids.f, offset: [0.3, 1.5, 2.2] });
    a.history.reset();
  }, ids);
  // 被驱动属性的全量记录
  const record = () => page.evaluate(() => {
    const a = window.__app, out = [];
    for (const e of a.entities.flatMap((x) => [x, ...x.children])) {
      out.push(...e.root.position.toArray(), ...e.root.quaternion.toArray(), ...e.root.scale.toArray());
      if (e.type === 'camera') out.push(e.cam.fov);
      if (e.type === 'character') out.push(...Object.values(e.values), e.model.position.y);
    }
    return out;
  });
  const manualShot = await shootViewport(`${OUT}/manual.png`);
  const manualDoc = await page.evaluate(() => window.__app.exportDocument());
  const prop0 = await page.evaluate((id) => window.__app.findEntity(id).root.position.toArray(), ids.p);

  // 1 纯函数：真实播放 2.0 s → 暂停记录；stop → seek(同一时刻) 再记录
  await page.evaluate(() => window.__app.playback.play());
  await new Promise((r) => setTimeout(r, 2000));
  const tPlay = await page.evaluate(() => { window.__app.playback.pause(); return window.__app.playback.time; });
  const recA = await record();
  await page.evaluate((t) => { const pb = window.__app.playback; pb.stop(); pb.seek(t); }, tPlay);
  const recB = await record();
  const maxDiff = recA.reduce((m, v, i) => Math.max(m, Math.abs(v - recB[i])), recA.length === recB.length ? 0 : Infinity);
  ok('验收1 纯函数：播放到 t 与直接 seek(t) 逐项差 < 1e-6', maxDiff < 1e-6, `t=${tPlay.toFixed(3)}s，${recA.length} 个数，max 差 ${maxDiff.toExponential(2)}`);

  // 2 跳转一致：seek(0)→seek(7.3)→seek(2.5) ≡ 直接 seek(2.5)
  await page.evaluate(() => { const pb = window.__app.playback; pb.stop(); pb.seek(0); pb.seek(7.3); pb.seek(2.5); });
  const jumpA = await shootViewport(`${OUT}/seek_jump_2.5.png`);
  await page.evaluate(() => { const pb = window.__app.playback; pb.stop(); pb.seek(2.5); });
  const jumpB = await shootViewport(`${OUT}/seek_direct_2.5.png`);
  const dJump = pixelDiff(jumpA, jumpB, `${OUT}/_diff_seek.png`);
  ok('验收2 跳转一致：截图像素差 0%', dJump === 0, `${(dJump * 100).toFixed(4)}%`);

  // 3 手动值保持：未打键的道具 t=0 / t=5 / stop 后不变；stop 后整场 ≡ 进入 active 前
  const hold = await page.evaluate((id) => {
    const a = window.__app, pb = a.playback, p = a.findEntity(id);
    pb.seek(0); const p0 = p.root.position.toArray();
    pb.seek(5); const p5 = p.root.position.toArray();
    return { p0, p5 };
  }, ids.p);
  // 4 导出不污染：t=5 时导出
  const docAt5 = await page.evaluate(() => window.__app.exportDocument());
  await shootViewport(`${OUT}/t5.png`);
  await page.evaluate(() => window.__app.playback.stop());
  const pStop = await page.evaluate((id) => window.__app.findEntity(id).root.position.toArray(), ids.p);
  const stopShot = await shootViewport(`${OUT}/after_stop.png`);
  const same3 = (x) => JSON.stringify(x) === JSON.stringify(prop0);
  ok('验收3 手动值保持：未打键道具 t=0 / t=5 / stop 后位置不变', same3(hold.p0) && same3(hold.p5) && same3(pStop));
  const dStop = pixelDiff(manualShot, stopShot, `${OUT}/_diff_stop.png`);
  ok('验收3 stop() 后整场截图 ≡ 进入 active 前', dStop === 0, `${(dStop * 100).toFixed(4)}%`);
  const strip = (d) => JSON.stringify({ ...d, meta: { ...d.meta, updatedAt: null } });
  const charT = (d) => JSON.stringify(d.entities.filter((e) => e.type === 'character').map((e) => [e.transform, e.pose]));
  ok('验收4 导出不污染：t=5 导出的角色 transform / 姿势 ≡ 进入 active 前', charT(docAt5) === charT(manualDoc) && strip(docAt5) === strip(manualDoc));

  // 5 往返：导出 → 清空 → 导入 → 导出；导入后 seek(3) 截图 ≡ 导入前 seek(3)
  await page.evaluate(() => window.__app.playback.seek(3));
  const rtA = await shootViewport(`${OUT}/roundtrip_before_t3.png`);
  const rtDoc1 = await page.evaluate(() => window.__app.exportDocument());
  fs.writeFileSync(`${OUT}/doc1.json`, JSON.stringify(rtDoc1, null, 2));
  await page.evaluate(async (d) => {
    const { createEmptyDocument } = await import('/src/doc/schema.js');
    const a = window.__app;
    a.playback.stop();
    await a.loadDocument(createEmptyDocument());
    await a.loadDocument(d, { applyView: true });
  }, rtDoc1);
  const rtDoc2 = await page.evaluate(() => window.__app.exportDocument());
  fs.writeFileSync(`${OUT}/doc2.json`, JSON.stringify(rtDoc2, null, 2));
  ok('验收5 往返：含 timeline 的 doc1 ≡ doc2（忽略 updatedAt）', strip(rtDoc1) === strip(rtDoc2) && rtDoc1.timeline.tracks.length === 4 && rtDoc1.paths.length === 1 && rtDoc1.constraints.length === 2);
  await page.evaluate(() => window.__app.playback.seek(3));
  const rtB = await shootViewport(`${OUT}/roundtrip_after_t3.png`);
  const dRt = pixelDiff(rtA, rtB, `${OUT}/_diff_roundtrip.png`);
  ok('验收5 导入后 seek(3) 截图 ≡ 导入前', dRt === 0, `${(dRt * 100).toFixed(4)}%`);
  await page.evaluate(() => window.__app.playback.stop());

  // 6 撤销：addTrack → setKey → addPath，撤销 ×3、重做 ×3，每步 timeline.toJSON 与操作时一致
  const undo = await page.evaluate(async (ids) => {
    const a = window.__app, tl = a.timeline, h = a.history;
    const wait = () => new Promise((r) => setTimeout(r, 20));
    h.reset();
    const snaps = [JSON.stringify(tl.toJSON())];
    const tr = tl.addTrack({ target: ids.p, property: 'pos' }); await wait(); snaps.push(JSON.stringify(tl.toJSON()));
    tl.setKey(tr.id, 1, [0.2, 0.5, -1.4]); await wait(); snaps.push(JSON.stringify(tl.toJSON()));
    tl.addPath({ target: ids.c1, points: [[0, 2, 5], [3, 2, 4]], duration: 3 }); await wait(); snaps.push(JSON.stringify(tl.toJSON()));
    const res = [h.entries.length];
    for (let i = 2; i >= 0; i--) { await h.undo(); res.push(JSON.stringify(tl.toJSON()) === snaps[i]); }
    for (let i = 1; i <= 3; i++) { await h.redo(); res.push(JSON.stringify(tl.toJSON()) === snaps[i]); }
    return res;
  }, ids);
  ok('验收6 撤销：三步各记一步，撤销 ×3 / 重做 ×3 的 timeline 与操作时一致', undo[0] === 4 && undo.slice(1).every(Boolean), JSON.stringify(undo));

  // 步态示意图：角色沿路径行走 t=1..6 叠在一张图（导演视角）
  await page.evaluate(() => window.__app.playback.seek(0));
  for (const t of [1.5, 3.5, 5.5]) {
    await page.evaluate((t) => window.__app.playback.seek(t), t);
    await shootViewport(`${OUT}/scene_t${t}.png`);
  }
  await page.evaluate(() => window.__app.playback.stop());

  ok('文档：删除实体连带删除引用它的路径 / 约束', bad.pruned.paths === 0 && bad.pruned.constraints === 0 && bad.pruned.tracks === 2 && bad.pruned.valid, JSON.stringify(bad.pruned));
  ok('坏文档：基准文档（含 timeline / paths / constraints）合法', bad.good.ok, bad.good.errors.slice(0, 3).join(' | '));
  for (const b of bad.out) ok(`坏文档：${b.name}`, b.ok && b.located && b.rejected && b.unchanged, b.first);
  console.log(`📁 产物：${OUT}/`);
}
