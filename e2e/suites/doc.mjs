import fs from 'node:fs';
import { page, ok } from '../harness.mjs';
import { shootViewport, pixelDiff } from '../helpers.mjs';
export async function run() {
  const OUT = 'test-output/doc';
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const MAX = 0.005;
  const pct = (r) => (r * 100).toFixed(3) + '%';
  await page.waitForFunction(() => window.__app.history.enabled, { timeout: 30000 });
  // toast 叠在视口上且有显隐动画，不属于场景画面：截图比对时隐藏
  await page.addStyleTag({ content: '#toast{visibility:hidden!important}' });
  // ---- 1 用 API 搭场景 ----
  const built = await page.evaluate(async () => {
    const { createEmptyDocument } = await import('/src/doc/schema.js');
    const a = window.__app;
    await a.loadDocument(createEmptyDocument()); // 从空场景开始
    const m = await a.addCharacter('male');
    m.root.position.x = -1.2;
    m.root.rotation.y = 0.4;
    m.applyPosePreset('walk');
    const f = await a.addCharacter('female');
    f.root.position.x = 1.0;
    f.root.position.z = 0.6;
    f.root.scale.multiplyScalar(1.1);
    f.applyPosePreset('think');
    f.values.headY = 25;
    f.values.lKnee = 30;
    f.currentPreset = null;
    f.applyPose(); // 模拟滑条微调
    f.setColor('#ff7a45');
    const p = a.addProp('cylinder');
    p.root.position.set(0.2, 0, -1.4);
    p.setColor('#8e7cc3');
    a.select(m.id);
    const c1 = a.addCamera('front_mid');
    a.select(f.id);
    const c2 = a.addCamera('front_closeup');
    c2.setFov(50);
    const crowd = await a.addCrowd(2, 2, 1.1);
    crowd.root.position.set(-0.4, 0, -3.2);
    crowd.root.rotation.y = -0.3;
    crowd.members[3].applyPosePreset('wave');
    a.setSkyColor('#1d2b3a');
    a.setGroundOpacity(0.65);
    a.setGroundHeight(-0.05);
    a.setRatio('16:9');
    await a.panorama.setFromAsset({ url: './assets/panoramas/pano-sunset.jpg', title: '威尼斯黄昏' });
    a.panorama.setRotation(120);
    a.setActiveCamera(c1.id);
    a.select(null);
    a.rig.controls.target.set(0, 0.9, -0.8);
    a.stage.camera.position.set(2.5, 2.6, 6.5);
    a.rig.controls.update();
    for (const ent of a.entities)
      a.edited(ent); // 提交测试搭景的手动编辑
    // 动画数据（阶段 C）：轨道 / 路径 / 约束也要往返一致
    const tl = a.timeline;
    const tr = tl.addTrack({ target: p.id, property: 'rot' });
    tl.setKey(tr.id, 0, [0, 0, 0]);
    tl.setKey(tr.id, 3, [0, 90, 0], 'smooth');
    tl.addTrack({ target: c2.id, property: 'fov' }); // 空轨道
    tl.addPath({ target: crowd.id, points: [[-0.4, 0, -3.2], [1.5, 0, -2], [3, 0, -3]], start: 1, duration: 5, speed: 'smooth', orient: 'tangent' });
    tl.addConstraint({ type: 'lookAt', target: c2.id, subject: f.id, start: 0.5, end: 6 });
    tl.setDuration(12);
    tl.setMainCamera(c1.id);
    a.history.reset();
    return { n: a.entities.length, cams: a.cameras.length, pano: a.panorama.active, anim: tl.tracks.length + tl.paths.length + tl.constraints.length };
  });
  ok('文档：API 搭建场景（含动画轨道 / 路径 / 约束）', built.n === 6 && built.cams === 2 && built.pano && built.anim === 4, JSON.stringify(built));
  // ---- 2 截图 A → doc1 → 清空 → load(doc1) → 截图 B → doc2 ----
  const shotA = await shootViewport(`${OUT}/A_director.png`);
  const doc1 = await page.evaluate(() => window.__app.exportDocument());
  fs.writeFileSync(`${OUT}/doc1.json`, JSON.stringify(doc1, null, 2));
  const v1 = await page.evaluate(async (d) => (await import('/src/doc/schema.js')).validate(d), doc1);
  ok('文档：doc1 通过校验', v1.ok, v1.errors.slice(0, 3).join(' | '));
  const cleared = await page.evaluate(async () => {
    const { createEmptyDocument } = await import('/src/doc/schema.js');
    const a = window.__app;
    await a.loadDocument(createEmptyDocument());
    return { n: a.entities.length, pano: a.panorama.active, sky: a.sceneState.sky };
  });
  await shootViewport(`${OUT}/cleared.png`);
  ok('文档：清空', cleared.n === 0 && cleared.sky === 0x060608, JSON.stringify(cleared));
  const t = await page.evaluate(async (d) => {
    const t0 = performance.now();
    await window.__app.loadDocument(d, { applyView: true });
    return performance.now() - t0;
  }, doc1);
  const shotB = await shootViewport(`${OUT}/B_director.png`);
  const doc2 = await page.evaluate(() => window.__app.exportDocument());
  fs.writeFileSync(`${OUT}/doc2.json`, JSON.stringify(doc2, null, 2));
  const norm = (d) => JSON.stringify({ ...d, meta: { ...d.meta, updatedAt: null } });
  ok('文档：doc1 与 doc2 深度相等（忽略 updatedAt）', norm(doc1) === norm(doc2), `加载 ${t.toFixed(0)}ms`);
  const dDir = pixelDiff(shotA, shotB, `${OUT}/_diff_director.png`);
  ok('文档：导演视角截图 A/B 像素差 < 0.5%', dDir < MAX, pct(dDir));
  // 机位视角（POV + 16:9 取景框）也比一次：先切 POV 拍 A，重新加载后再拍 B
  await page.evaluate(() => window.__app.setCameraView(true));
  const povA = await shootViewport(`${OUT}/A_camera.png`);
  await page.evaluate(async (d) => { await window.__app.loadDocument(d, { applyView: true }); }, doc1);
  const povB = await shootViewport(`${OUT}/B_camera.png`);
  const dPov = pixelDiff(povA, povB, `${OUT}/_diff_camera.png`);
  ok('文档：机位视角截图 A/B 像素差 < 0.5%', dPov < MAX, pct(dPov));
  await page.evaluate(() => window.__app.setCameraView(false));
  // ---- 3 五种坏文档：validate 定位准确，loadDocument 拒绝且场景不变 ----
  const bad = await page.evaluate(async (good) => {
    const { validate } = await import('/src/doc/schema.js');
    const a = window.__app;
    const ci = good.entities.findIndex((e) => e.type === 'character' && e.parent === null);
    const mi = good.entities.findIndex((e) => e.type === 'character' && e.parent);
    const cases = [
      ['未知 body', (d) => { d.entities[ci].body = 'giant'; }, `entities[${ci}].body`],
      ['超范围角度', (d) => { d.entities[ci].pose.values.lFore = 170; }, `entities[${ci}].pose.values.lFore 超出范围 -8..145`],
      ['悬空 parent', (d) => { d.entities[mi].parent = 'ghost000'; }, `entities[${mi}].parent 引用的实体不存在`],
      ['重复 id', (d) => { d.entities[ci + 1].id = d.entities[ci].id; }, `entities[${ci + 1}].id 重复`],
      ['版本号未知', (d) => { d.schema = 'director-stage/9.9'; }, 'schema 版本未知'],
    ];
    const before = JSON.stringify({ ...a.exportDocument(), meta: null });
    const out = [];
    for (const [name, mut, expect] of cases) {
      const d = structuredClone(good);
      mut(d);
      const v = validate(d);
      let rejected = false;
      try {
        await a.loadDocument(d);
      }
      catch (e) {
        rejected = e.name === 'DocumentError';
      }
      const unchanged = JSON.stringify({ ...a.exportDocument(), meta: null }) === before;
      out.push({ name, ok: !v.ok, located: v.errors.some((e) => e.startsWith(expect)), rejected, unchanged, first: v.errors[0] });
    }
    return out;
  }, doc1);
  for (const b of bad)
    ok(`坏文档：${b.name}`, b.ok && b.located && b.rejected && b.unchanged, b.first);
  // ---- 4 撤销重做：添加 → 移动 → 改姿势 → 撤销×3 → 重做×3 ----
  await page.evaluate(() => { window.__app.history.reset(); });
  const states = [await shootViewport(`${OUT}/undo_s0.png`)];
  const step = async (fn, i) => {
    await page.evaluate(fn);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 30)));
    states.push(await shootViewport(`${OUT}/undo_s${i}.png`));
  };
  await step(() => { window.__app.addProp('box'); window.__app.select(null); }, 1);
  await step(() => { const p = window.__app.entities.at(-1); p.root.position.set(1.6, 0, 1.4); window.__app.edited(p); }, 2);
  await step(() => { const a = window.__app, c = a.entities.find((e) => e.type === 'character'); c.applyPosePreset('sit'); a.edited(c); }, 3);
  const steps = await page.evaluate(() => window.__app.history.entries.length);
  ok('撤销重做：三个操作各记一步', steps === 4, `entries=${steps}`);
  const seq = [];
  for (let i = 2; i >= 0; i--) {
    await page.evaluate(() => window.__app.history.undo());
    const f = await shootViewport(`${OUT}/undo_back${i}.png`);
    seq.push([`撤销→状态${i}`, pixelDiff(states[i], f, `${OUT}/_diff_undo${i}.png`)]);
  }
  for (let i = 1; i <= 3; i++) {
    await page.evaluate(() => window.__app.history.redo());
    const f = await shootViewport(`${OUT}/redo_fwd${i}.png`);
    seq.push([`重做→状态${i}`, pixelDiff(states[i], f, `${OUT}/_diff_redo${i}.png`)]);
  }
  for (const [name, r] of seq)
    ok(`撤销重做：${name} 画面一致`, r < MAX, pct(r));
  // ---- 5 撤销不重建：结构没变的实体原地更新（对象不变），只有增删的实体新建 / 销毁 ----
  const reuse = await page.evaluate(async () => {
    const a = window.__app;
    a.history.reset();
    const before = new Map(a.entities.map((e) => [e.id, e]));
    const ch = a.entities.find((e) => e.type === 'character');
    ch.setColor('#ff3366');
    a.edited(ch);
    a.history.capture();
    const t0 = performance.now();
    await a.history.undo();
    const ms = performance.now() - t0;
    const same = a.entities.every((e) => before.get(e.id) === e);
    const color = a.findEntity(ch.id).color;
    await a.history.redo();
    return { same, ms, colorBack: color !== 0xff3366, redone: a.findEntity(ch.id).color === 0xff3366 };
  });
  ok('撤销不重建：改颜色后撤销，全部实体还是原对象、颜色回到原值', reuse.same && reuse.colorBack && reuse.redone, `${reuse.ms.toFixed(1)} ms`);
  console.log(`📁 产物：${OUT}/`);
}
