// 默认套件：核心功能 + 已修复问题的回归。
import fs from 'node:fs';
import { page, ok, warns } from '../harness.mjs';

export async function run() {
  // 1 骨骼/restQ + 归一化（身高 = 体型注册表里的目标身高）
  const ci = await page.evaluate(async () => {
    const { BODY_TYPES } = await import('/src/config.js');
    const c = window.__app.entities.find((e) => e.type === 'character' && e.profile.id === BODY_TYPES.male.profile.id);
    return { bones: c.bones.size, restQ: c.restQ.size, base: c.baseScale, y: c.root.position.y, h: c.height, want: BODY_TYPES.male.height };
  });
  ok('GLB 加载：骨骼表/restQ', ci.bones > 20 && ci.restQ > 10, `bones=${ci.bones} restQ=${ci.restQ}`);
  ok('身高归一化 + 落地 + baseScale', Math.abs(ci.h - ci.want) < 1e-3 && Math.abs(ci.y) < 0.2 && ci.base > 0, `h=${ci.h} baseScale=${ci.base.toFixed(3)} rootY=${ci.y.toFixed(3)}`);

  // 1a 默认人偶（男/女）骨骼档案完整兼容
  const compat = await page.evaluate(() => window.__app.entities.filter((e) => e.type === 'character')
    .map((c) => `${c.profile.id}:${c.missingJoints.length}`).sort().join(' ')); // 并行加载，入列顺序不定
  ok('默认男/女人偶：档案关节全部命中', compat === 'bodychan_female:0 bodykun_male:0', compat);

  // 1a' Inspector 位置 / 旋转 / 缩放 = 文档口径（落地 Y=0、素体缩放 1）；面板输入 Y=0 不改 root
  const panelUnits = await page.evaluate(async () => {
    const a = window.__app;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const row = (label) => [...document.querySelectorAll('#inspector .field')].find((f) => f.querySelector(':scope > label')?.textContent === label);
    const vals = (label) => [...row(label).querySelectorAll('.triple input')].map((i) => +i.value);
    const out = [];
    for (const c of a.entities.filter((e) => e.type === 'character')) {
      a.select(c.id); await wait(80);
      const tr = a.toDocument().entities.find((e) => e.id === c.id).transform;
      const shown = { pos: vals('位置'), rot: vals('旋转'), scale: vals('缩放') };
      const same = ['pos', 'scale'].every((k) => shown[k].every((v, i) => Math.abs(v - tr[k][i]) <= 0.005))
        && shown.rot.every((v, i) => Math.abs(v - tr.rot[i]) <= 0.5);
      const y0 = c.root.position.y;
      const yIn = row('位置').querySelectorAll('.triple input')[1];
      yIn.value = '0'; yIn.dispatchEvent(new Event('input')); yIn.dispatchEvent(new Event('change'));
      out.push({ name: c.name, y: shown.pos[1], scale: shown.scale, same, rootKept: Math.abs(c.root.position.y - y0) < 1e-9 });
    }
    a.select(null);
    return out;
  });
  ok('Inspector 位置/缩放 = 文档口径（Y=0.00、缩放 1）、输入 Y=0 不改 root',
    panelUnits.length >= 2 && panelUnits.every((p) => p.y === 0 && p.scale.every((s) => s === 1) && p.same && p.rootKept), JSON.stringify(panelUnits));

  // 1b 模板缓存：同源角色共享几何体（只下载/上传一次）
  const shared = await page.evaluate(async () => {
    const app = window.__app;
    const b = await app.addCharacter('male');
    const a = app.entities.find((e) => e.type === 'character' && e !== b && e.spec.url === b.spec.url);
    const geo = (c) => { let g = null; c.model.traverse((o) => { if (!g && o.isSkinnedMesh) g = o.geometry; }); return g; };
    const res = !!a && geo(a) && geo(a) === geo(b) && a._mats[0] !== b._mats[0];
    app.remove(b.id); app.select(null);
    return res;
  });
  ok('GLB 模板缓存：几何体共享、材质独立', shared);

  // 2 姿势唯一关节 + 复位
  const pt = await page.evaluate(() => {
    const c = window.__app.entities.find((e) => e.type === 'character');
    const get = (n) => { for (const [k, b] of c.bones) if (k === n) return b; };
    const La = get('mixamorigleftarm'), Ra = get('mixamorigrightarm');
    const bL = La.quaternion.clone(), bR = Ra.quaternion.clone();
    c.values.lArmFwd = 90; c.applyPose();
    const dL = La.quaternion.angleTo(bL) * 180 / Math.PI, dR = Ra.quaternion.angleTo(bR) * 180 / Math.PI;
    c.resetPose(); const rest = La.quaternion.angleTo(bL) * 180 / Math.PI;
    return { dL, dR, rest };
  });
  ok('姿势驱动对应且唯一关节', pt.dL > 60 && pt.dR < 1, `左臂Δ=${pt.dL.toFixed(1)}° 右臂Δ=${pt.dR.toFixed(1)}°`);
  ok('复位姿势归零', pt.rest < 1, `Δ=${pt.rest.toFixed(2)}°`);

  // 3 多角色独立
  const ind = await page.evaluate(() => {
    const cs = window.__app.entities.filter((e) => e.type === 'character');
    const get = (c, n) => { for (const [k, b] of c.bones) if (k === n) return b; };
    const arm = get(cs[1], 'mixamorigleftarm'); const before = arm.quaternion.clone();
    cs[0].values.lArmFwd = 120; cs[0].applyPose();
    const delta = arm.quaternion.angleTo(before) * 180 / Math.PI;
    cs[0].resetPose();
    return { delta, shared: cs[0].values === cs[1].values };
  });
  ok('多角色姿势独立（共享几何不串姿势）', ind.delta < 0.5 && !ind.shared, `他者臂Δ=${ind.delta.toFixed(2)}°`);

  // 4 静态姿势预设：应用 → values 与预设一致 / currentPreset 正确；复位归零
  const posePreset = await page.evaluate(async () => {
    const c = window.__app.entities.find((e) => e.type === 'character');
    const { POSE_PRESET_MAP } = await import('/src/entities/posePresets.js');
    const sameAs = (key) => {
      const want = POSE_PRESET_MAP[key].values;
      for (const k in want) if (Math.abs((c.values[k] || 0) - want[k]) > 1e-6) return false;
      for (const k in c.values) if (!(k in want) && Math.abs(c.values[k]) > 1e-6) return false;
      return true;
    };
    const res = {};
    for (const key of ['walk', 'wave', 'cross']) {
      c.applyPosePreset(key);
      res[key] = sameAs(key) && c.currentPreset === key;
    }
    c.resetPose();
    res.reset = Object.values(c.values).every((v) => Math.abs(v) < 1e-6) && c.currentPreset === null;
    return res;
  });
  ok('静态姿势预设：应用/高亮/复位', posePreset.walk && posePreset.wave && posePreset.cross && posePreset.reset, JSON.stringify(posePreset));

  // 4a 零点 = 自然站立：新角色 values 全 0 且手臂已放下；T型 = -neutralOffset，总角度 0 回到文件静止位
  const neutral = await page.evaluate(() => {
    const c = window.__app.entities.find((e) => e.type === 'character');
    const arm = c.bones.get('mixamorigleftarm');
    const rest = c.restQ.get(arm);
    const standZero = c.pose.isZero() && arm.quaternion.angleTo(rest) * 180 / Math.PI > 60;
    c.applyPosePreset('tpose');
    let tposeAtRest = true;
    for (const [bone, q] of c.restQ) if (!bone.quaternion.equals(q)) tposeAtRest = false; // 总角度 0 → 逐分量等于 restQ（文件里的 restQ 未必严格单位长，不能用 angleTo/dot）
    const tposeVals = c.values.lArmAbd === -c.profile.neutralOffset.lArmAbd;
    c.resetPose();
    return { standZero, tposeAtRest, tposeVals, resetStand: c.pose.isZero() && arm.quaternion.angleTo(rest) * 180 / Math.PI > 60 };
  });
  ok('零点=站立 / T型回静止位 / 复位回站立', Object.values(neutral).every(Boolean), JSON.stringify(neutral));

  // 4a' 加载校验：档案缺关节 → toast 提示 + console.warn 列出 + 对应滑条禁用；角色仍可添加/移动
  const rigCheck = await page.evaluate(async () => {
    const a = window.__app;
    const { PROFILES } = await import('/src/rig/profiles/index.js');
    const base = PROFILES.xbot;
    const joints = { ...base.joints, lHand: { bone: 'mixamorig:NoSuchBone', axis: 'x' } };
    delete joints.rHand;
    const c = await a._loadCharacter({ url: './assets/Xbot.glb', profile: { ...base, id: 'broken_test', joints }, height: 1.7 });
    a._registerEntity(c, { msg: a._rigWarning(c) });
    const toastTxt = document.getElementById('toast').textContent;
    a.select(c.id);
    const tab = (t) => [...document.querySelectorAll('#inspector .ptabs button')].find((x) => x.textContent === t)?.click();
    tab('姿势');
    const disabled = [...document.querySelectorAll('#inspector .sld input[type=range]')].filter((i) => i.disabled).length;
    tab('属性');
    c.root.position.x += 0.5;
    const res = { missing: c.missingJoints.join(','), toastTxt, disabled, added: a.entities.includes(c) };
    a.remove(c.id);
    return res;
  });
  ok('加载校验：缺关节 toast / 滑条禁用 / 仍可添加',
    rigCheck.missing === 'lHand,rHand' && rigCheck.toastTxt === '该模型缺少 2 个关节，相关姿势滑条已禁用'
    && rigCheck.disabled === 2 && rigCheck.added && warns.some((w) => w.includes('lHand, rHand')), JSON.stringify(rigCheck));

  // 4a'' 自动贴地：坐姿整体下沉（髋部降低、最低骨头仍在地面），root 位置不变；复位后回到站立高度
  const sit = await page.evaluate(() => {
    const c = window.__app.entities.find((e) => e.type === 'character');
    const hips = c.bones.get('mixamorighips');
    const hipY = () => { c.root.updateMatrixWorld(true); return hips.getWorldPosition(hips.position.clone()).y; };
    const rootY0 = c.root.position.y, h0 = hipY();
    c.applyPosePreset('sit');
    const h1 = hipY(), ground = Math.abs(c._lowestBoneY() - c._groundY) < 1e-4, rootKept = c.root.position.y === rootY0;
    c.resetPose();
    return { drop: +(h0 - h1).toFixed(3), ground, rootKept, restored: Math.abs(hipY() - h0) < 1e-4 };
  });
  ok('坐姿自动贴地：整体下沉 / 脚着地 / root 不动 / 复位还原', sit.drop > 0.25 && sit.ground && sit.rootKept && sit.restored, JSON.stringify(sit));

  // 4b 角色命名超过 26 个不溢出成标点
  const names = await page.evaluate(() => {
    const a = window.__app; const saved = a.charSeq;
    a.charSeq = 25; const z = a._nextCharName(); const a2 = a._nextCharName();
    a.charSeq = saved; return { z, a2 };
  });
  ok('角色命名：Z 之后为 A2', names.z === '角色Z' && names.a2 === '角色A2', JSON.stringify(names));

  // 4c 不同体型的名牌高度跟随目标身高
  const tall = await page.evaluate(async () => {
    const a = window.__app; const c = await a.addCharacter('tall');
    const h = c.height; a.remove(c.id); return h;
  });
  ok('高大素体 height = 2.05（名牌不再陷进头里）', Math.abs(tall - 2.05) < 1e-6, `height=${tall}`);

  // 5 道具 + 选中 + gizmo
  const pr = await page.evaluate(() => { const a = window.__app; const p = a.addProp('box'); return { sel: a.selectedId === p.id, g: a.gizmo.attached === p.root, vis: a.gizmo._helper.visible }; });
  ok('加道具+选中+gizmo 绑定', pr.sel && pr.g && pr.vis);

  // 6 变换模式（含角色 scale）
  const tm = await page.evaluate(() => {
    const a = window.__app; const c = a.entities.find((e) => e.type === 'character'); a.select(c.id);
    const modes = ['translate', 'rotate', 'scale'].map((m) => { a.setTransformMode(m); return a.gizmo.control.mode === m && a.gizmo._helper.visible; });
    a.setTransformMode('translate');
    return modes.every(Boolean);
  });
  ok('移动/旋转/缩放三模式可用', tm);

  // 7 取景 + 截图裁剪（截图为 Blob + ObjectURL）
  const dims = async (url) => page.evaluate((u) => new Promise((res) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.src = u; }), url);
  for (const [ratio, want] of [['16:9', 16 / 9], ['9:16', 9 / 16], ['4:3', 4 / 3]]) {
    const shot = await page.evaluate(async (r) => { const a = window.__app; a.setRatio(r); const s = await a.shots.captureShot(); return { url: s.url, isBlob: s.blob instanceof Blob }; }, ratio);
    const d = await dims(shot.url);
    ok(`截图 ${ratio} 裁剪`, shot.isBlob && Math.abs(d.w / d.h - want) < 0.06, `${d.w}×${d.h}`);
  }
  await page.evaluate(() => { window.__app.setCameraView(false); window.__app.setRatio('auto'); });

  // 8 场景级控制
  const sc = await page.evaluate(() => {
    const a = window.__app;
    a.setSceneScale(2); const sScale = Math.abs(a.stage.world.scale.x - 2) < 1e-6;
    a.setSceneScale(1);
    a.setSkyColor('#123456'); const sky = a.stage.scene.background.getHexString() === '123456';
    a.setGroundOpacity(0.7); const op = Math.abs(a.stage.ground.material.opacity - 0.7) < 1e-6;
    a.setLabelsVisible(false); const lbl = a.labels.layer.style.display === 'none'; a.setLabelsVisible(true);
    return { sScale, sky, op, lbl };
  });
  ok('场景控制：缩放/天空色/地面透明/标签', sc.sScale && sc.sky && sc.op && sc.lbl, JSON.stringify(sc));

  // 9 显隐/删除 + 面板切换
  const crud = await page.evaluate(() => {
    const a = window.__app; const p = a.entities.find((e) => e.type === 'prop');
    a.select(p.id);
    a.toggleVisible(p.id); const h = !p.root.visible && !a.gizmo._helper.visible; a.toggleVisible(p.id);
    a.select(null); const scenePanelShown = document.getElementById('inspector').hidden && !document.getElementById('scenePanel').hidden;
    const n0 = a.entities.length; a.remove(p.id);
    return { h, scenePanelShown, removed: a.entities.length === n0 - 1 };
  });
  ok('显隐（隐藏时不显示 gizmo）/删除 + 未选中显示场景面板', crud.h && crud.scenePanelShown && crud.removed, JSON.stringify(crud));

  // 10 添加机位：实体 + helper 在 scene + 导演视角下可见
  const camAdd = await page.evaluate(() => {
    const a = window.__app;
    const c = a.entities.find((e) => e.type === 'character'); if (c) a.select(c.id);
    const cam = a.addCamera('front_mid');
    return { isCam: cam.type === 'camera', inScene: a.stage.scene.children.includes(cam.helper), bodyVis: cam.body.visible, helperVis: cam.helper.visible, hasFov: cam.cam.fov > 0 };
  });
  ok('添加机位：实体/视锥/导演视角可见', camAdd.isCam && camAdd.inScene && camAdd.bodyVis && camAdd.helperVis && camAdd.hasFov);

  // 11 机位视角隐藏相机可视化
  const camHide = await page.evaluate(() => {
    const a = window.__app;
    a.setCameraView(true);
    const cam = a.cameras[0];
    const hidden = !cam.body.visible && !cam.helper.visible;
    a.setCameraView(false);
    return { hidden, shown: cam.body.visible && cam.helper.visible };
  });
  ok('机位视角隐藏相机体+视锥，导演视角恢复', camHide.hidden && camHide.shown);

  // 12 相机不支持缩放 + 删除清理 helper
  const camMisc = await page.evaluate(() => {
    const a = window.__app;
    const cam = a.cameras[0]; a.select(cam.id);
    a.setTransformMode('scale'); const notScale = a.gizmo.control.mode !== 'scale';
    a.setTransformMode('translate');
    const n0 = a.entities.length; a.remove(cam.id);
    return { notScale, removed: a.entities.length === n0 - 1, helperGone: !a.stage.scene.children.includes(cam.helper) };
  });
  ok('相机禁缩放 + 删除清理视锥', camMisc.notScale && camMisc.removed && camMisc.helperGone);

  // 13 全景背景：设置后球可见，移除后恢复
  const pano = await page.evaluate(async () => {
    const a = window.__app;
    const assets = await import('/src/util/assetLibrary.js').then((m) => m.listCanvasAssets());
    a.panorama.setFromAsset(assets[0]);
    for (let i = 0; i < 50 && !a.panorama.active; i++) await new Promise((r) => setTimeout(r, 100));
    const onState = a.panorama.active && a.stage.panoSphere.visible;
    a.panorama.clear();
    return { onState, offState: !a.panorama.active && !a.stage.panoSphere.visible };
  });
  ok('全景背景：设置/移除', pano.onState && pano.offState, JSON.stringify(pano));

  // 14 机位视角 POV：切换渲染相机 / 禁环绕 / 退出恢复
  const povT = await page.evaluate(() => {
    const a = window.__app;
    const cam = a.cameras[0] || a.addCamera('front_mid'); a.select(cam.id);
    a.setCameraView(true);
    const active = a.stage.activeCamera === cam.cam && a.getRenderCamera() === cam.cam;
    const orbitOff = a.rig.controls.enabled === false;
    a.setCameraView(false);
    return { active, orbitOff, restored: a.stage.activeCamera === null && a.rig.controls.enabled === true };
  });
  ok('机位视角 POV：切换渲染相机/禁环绕/退出恢复', povT.active && povT.orbitOff && povT.restored, JSON.stringify(povT));

  // 15 POV 下删除出画机位：切到另一机位；删光则退回导演视角
  const povDel = await page.evaluate(() => {
    const a = window.__app;
    a.cameras.forEach((c) => a.remove(c.id));
    const c1 = a.addCamera('front_mid'), c2 = a.addCamera('side_track');
    a.select(c1.id); a.setCameraView(true);
    a.remove(c1.id);
    const switched = a.cameraView && a.stage.activeCamera === c2.cam && a.activeCameraId === c2.id;
    a.remove(c2.id);
    const exited = !a.cameraView && a.stage.activeCamera === null && a.activeCameraId === null && a.rig.controls.enabled;
    return { switched, exited };
  });
  ok('POV 下删除出画机位：自动切换/退出', povDel.switched && povDel.exited, JSON.stringify(povDel));

  // 16 截图入库 + 自动建机位 + 按机位分组；删机位连带清理截图
  const shotsT = await page.evaluate(async () => {
    const a = window.__app; a.shots.clearShots();
    const c = a.entities.find((e) => e.type === 'character'); a.select(c.id);
    const camsBefore = a.cameras.length;
    const shot = await a.shots.captureShot();
    const res = {
      hasCamId: !!shot.cameraId, inShots: a.shots.list.includes(shot),
      autoCam: a.cameras.length === camsBefore + 1, grouped: a.shots.shotsForCamera(shot.cameraId).length,
    };
    a.shots.toggleShotSelected(shot.id);
    a.remove(shot.cameraId);
    res.orphansCleared = a.shots.list.length === 0 && a.shots.selectedShotIds.size === 0;
    return res;
  });
  ok('截图入库/自动建机位/分组/删机位清理截图', shotsT.hasCamId && shotsT.inShots && shotsT.autoCam && shotsT.grouped >= 1 && shotsT.orphansCleared, JSON.stringify(shotsT));

  // 17 截图多选 / 删除 / 清空
  const selT = await page.evaluate(async () => {
    const a = window.__app;
    const cam = a.addCamera('front_mid'); a.select(cam.id);
    await a.shots.captureShot(); await a.shots.captureShot();
    const ids = a.shots.list.slice(-2).map((s) => s.id);
    a.shots.toggleShotSelected(ids[0]);
    const onlyOne = a.shots.selectedShotIds.size === 1 && a.shots.selectedShotIds.has(ids[0]);
    a.shots.toggleShotSelected(ids[0]); const cleared = a.shots.selectedShotIds.size === 0;
    const before = a.shots.list.length; a.shots.removeShot(ids[1]); const removed = a.shots.list.length === before - 1;
    a.shots.clearShots();
    return { onlyOne, cleared, removed, emptied: a.shots.list.length === 0 };
  });
  ok('截图多选 / 删除 / 清空', selT.onlyOne && selT.cleared && selT.removed && selT.emptied, JSON.stringify(selT));

  // 18 注视一次性对准 + FOV
  const aimT = await page.evaluate(() => {
    const a = window.__app;
    const cam = a.cameras[0] || a.addCamera('front_mid');
    const char = a.entities.find((e) => e.type === 'character');
    const center = a.aimCameraAtObject(cam.id, char.id);
    const lookSet = center && Math.abs(cam.lookTarget.x - center.x) < 1e-6 && Math.abs(cam.lookTarget.y - center.y) < 1e-6;
    cam.setFov(70);
    return { hasCenter: !!center, lookSet, fov: Math.abs(cam.cam.fov - 70) < 1e-6 };
  });
  ok('注视一次性对准 + FOV', aimT.hasCenter && aimT.lookSet && aimT.fov, JSON.stringify(aimT));

  // 19 群众阵列：建组 + 成员数 = 行×列 + 整组位移成员世界坐标同步
  const crowdT = await page.evaluate(async () => {
    const a = window.__app;
    const rows = 2, cols = 3;
    const crowd = await a.addCrowd(rows, cols, 1.2);
    const countMatch = crowd.members.length === rows * cols && crowd.rows === rows && crowd.cols === cols;
    const wp = (o) => { o.updateWorldMatrix(true, false); const e = o.matrixWorld.elements; return { x: e[12], y: e[13], z: e[14] }; };
    const m = crowd.members[crowd.members.length - 1];
    const before = wp(m.root);
    const D = 3.5;
    crowd.root.position.x += D; crowd.root.position.z -= D;
    const after = wp(m.root);
    const synced = Math.abs((after.x - before.x) - D) < 1e-6 && Math.abs((after.z - before.z) + D) < 1e-6 && Math.abs(after.y - before.y) < 1e-6;
    crowd.root.position.x -= D; crowd.root.position.z += D;
    return { isCrowd: crowd.type === 'group', countMatch, synced, labels: crowd.members.every((x) => x.labelEl) };
  });
  ok('群众阵列：建组/成员数=行×列/整组位移同步/成员名牌', crowdT.isCrowd && crowdT.countMatch && crowdT.synced && crowdT.labels, JSON.stringify(crowdT));

  // 20 删除群众成员 + 解组后成员可创建副本（保留世界位姿）
  const memberT = await page.evaluate(async () => {
    const a = window.__app;
    const crowd = a.entities.find((e) => e.type === 'group');
    const victim = crowd.members[0];
    a.select(victim.id); a.remove(victim.id);
    const memberRemoved = !crowd.members.includes(victim) && !victim.labelEl && a.selectedId === null;
    crowd.root.position.x += 2;
    const m = crowd.members[0];
    const wBefore = m.root.getWorldPosition(m.root.position.clone());
    a.ungroupCrowd(crowd.id);
    const wAfter = m.root.getWorldPosition(m.root.position.clone());
    const keptPose = wBefore.distanceTo(wAfter) < 1e-6 && a.entities.includes(m);
    const n0 = a.entities.length;
    await a.duplicateMany([m.id]);
    const copy = a.entities[a.entities.length - 1];
    const duplicated = a.entities.length === n0 + 1 && copy.type === 'character' && copy.spec.url === m.spec.url;
    return { memberRemoved, keptPose, duplicated };
  });
  ok('删群众成员 / 解组保持位姿 / 解组成员可复制', memberT.memberRemoved && memberT.keptPose && memberT.duplicated, JSON.stringify(memberT));

  // 21 按需渲染：静止时不重绘；状态变化后重绘一次
  const idle = await page.evaluate(async () => {
    const a = window.__app; const st = a.stage;
    let n = 0; const orig = st.render.bind(st); st.render = () => { n++; orig(); };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await wait(800); n = 0;          // 等阻尼结束
    await wait(600); const idleRenders = n;
    a.select(null); await wait(100); const afterChange = n;
    st.render = orig;
    return { idleRenders, afterChange };
  });
  ok('按需渲染：静止 0 次重绘，变化后重绘', idle.idleRenders === 0 && idle.afterChange >= 1, JSON.stringify(idle));

  // 22 UI 冒烟：左栏条目 = 顶层实体；相机面板预览画出了内容；工具坞菜单可开合
  const ui = await page.evaluate(async () => {
    const a = window.__app;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const cam = a.cameras[0] || a.addCamera('front_mid');
    a.select(cam.id);
    await wait(100);
    const rows = document.querySelectorAll('#outliner .node:not(.child)').length;
    const cv = document.querySelector('#inspector .cam-preview canvas');
    const px = cv ? cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data : [];
    let lit = 0; for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 30) lit++;
    document.querySelector('#dock .dockbtn[title^="添加角色"]').click();
    const menuOpen = !!document.querySelector('#dock .dockmenu.open');
    document.body.click();
    const menuClosed = !document.querySelector('#dock .dockmenu.open');
    return { rows, entities: a.entities.length, hasPreview: !!cv, lit, menuOpen, menuClosed };
  });
  ok('UI：清单条目/机位预览出图/菜单开合', ui.rows === ui.entities && ui.hasPreview && ui.lit > 100 && ui.menuOpen && ui.menuClosed, JSON.stringify(ui));

  // 截图便于人工对齐
  await page.evaluate(() => { window.__app.setCameraView(false); window.__app.select(null); });
  await new Promise((r) => setTimeout(r, 400));
  fs.mkdirSync('test-output', { recursive: true });
  await page.screenshot({ path: 'test-output/selftest_view.png' });
  console.log('📸 已保存 test-output/selftest_view.png（未选中态）');
  await page.evaluate(() => { const c = window.__app.entities.find((e) => e.type === 'character'); window.__app.select(c.id); });
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: 'test-output/selftest_selected.png' });
  console.log('📸 已保存 test-output/selftest_selected.png（选中角色态）');
}
