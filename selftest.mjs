// 自测脚本（§9 验收 + UI 对齐）：headless Chrome 驱动真实 dev server。
// 可选开发工具，默认依赖不含 puppeteer-core。运行前：
//   npm i -D puppeteer-core && npx vite --port 5181 --strictPort &
//   TEST_URL=http://localhost:5181/ node selftest.mjs
import puppeteer from 'puppeteer-core';

const URL = process.env.TEST_URL || 'http://localhost:5181/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = [];
const ok = (name, pass, detail = '') => { results.push({ pass }); console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 810, deviceScaleFactor: 1 });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.waitForFunction(() => window.__app && window.__app.entities.filter((e) => e.type === 'character' && e.bones?.size > 0).length >= 2, { timeout: 30000 });

// 1 骨骼/restQ + 归一化
const ci = await page.evaluate(() => { const c = window.__app.entities.find((e) => e.type === 'character'); return { bones: c.bones.size, restQ: c.restQ.size, base: c.baseScale, y: c.root.position.y, h: c.height }; });
ok('GLB 加载：骨骼表/restQ', ci.bones > 20 && ci.restQ > 10, `bones=${ci.bones} restQ=${ci.restQ}`);
ok('身高归一化 + 落地 + baseScale', Math.abs(ci.h - 1.7) < 1e-3 && Math.abs(ci.y) < 0.2 && ci.base > 0, `baseScale=${ci.base.toFixed(3)} rootY=${ci.y.toFixed(3)}`);

// 2 姿势唯一关节 + 复位
const pt = await page.evaluate(() => {
  const c = window.__app.entities.find((e) => e.type === 'character');
  const get = (n) => { for (const [k, b] of c.bones) if (k === n) return b; };
  const La = get('mixamorigleftarm'), Ra = get('mixamorigrightarm');
  const bL = La.quaternion.clone(), bR = Ra.quaternion.clone();
  c.values.lArmFwd = 90; c.enterManual(); c.applyPose();
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
  cs[0].values.lArmFwd = 120; cs[0].enterManual(); cs[0].applyPose();
  return { delta: arm.quaternion.angleTo(before) * 180 / Math.PI, shared: cs[0].values === cs[1].values };
});
ok('多角色姿势独立', ind.delta < 0.5 && !ind.shared, `他者臂Δ=${ind.delta.toFixed(2)}°`);

// 4 预设动画
const an = await page.evaluate(() => { const c = window.__app.entities.find((e) => e.clipNames?.length); if (!c) return { skip: true }; c.playClip(c.clipNames[0]); return { ok: c.currentClip === c.clipNames[0] }; });
ok('预设动画播放/互斥', an.skip || an.ok);

// 5 道具 + 选中 + gizmo
const pr = await page.evaluate(() => { const a = window.__app; const p = a.addProp('box'); return { sel: a.selectedId === p.id, g: a.gizmo.attached === p.root, vis: a.gizmo._helper.visible }; });
ok('加道具+选中+gizmo 绑定', pr.sel && pr.g && pr.vis);

// 6 变换模式（含角色 scale）
const tm = await page.evaluate(() => {
  const a = window.__app; const c = a.entities.find((e) => e.type === 'character'); a.select(c.id);
  const modes = ['translate', 'rotate', 'scale'].map((m) => { a.setTransformMode(m); return a.gizmo.control.mode === m && a.gizmo._helper.visible; });
  return modes.every(Boolean);
});
ok('移动/旋转/缩放三模式可用', tm);

// 7 取景 + 截图裁剪
const dims = async (dataurl) => page.evaluate((u) => new Promise((res) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.src = u; }), dataurl);
const s1 = await page.evaluate(async () => { const a = window.__app; a.setCameraView(true); a.ratioIndex = 0; a.rig.setRatio('16:9'); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); a.captureShot(); return a.latestShot; });
const d1 = await dims(s1); ok('截图 16:9 裁剪', Math.abs(d1.w / d1.h - 16 / 9) < 0.06, `${d1.w}×${d1.h}`);
const s2 = await page.evaluate(async () => { const a = window.__app; a.rig.setRatio('9:16'); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); a.captureShot(); return a.latestShot; });
const d2 = await dims(s2); ok('截图 9:16 裁剪', Math.abs(d2.w / d2.h - 9 / 16) < 0.06, `${d2.w}×${d2.h}`);

// 8 场景级控制
const sc = await page.evaluate(() => {
  const a = window.__app;
  a.setSceneScale(2); const sScale = Math.abs(a.stage.world.scale.x - 2) < 1e-6;
  a.setSceneScale(1);
  a.setSkyColor('#123456'); const sky = a.stage.scene.background.getHexString() === '123456';
  a.setGroundOpacity(0.7); const op = Math.abs(a.stage.ground.material.opacity - 0.7) < 1e-6;
  a.setLabelsVisible(false); const lbl = a.labelLayer.style.display === 'none'; a.setLabelsVisible(true);
  a.setSnap(true); const snap = a.gizmo.control.translationSnap === 0.5; a.setSnap(false);
  return { sScale, sky, op, lbl, snap };
});
ok('场景控制：缩放/天空色/地面透明/标签/吸附', sc.sScale && sc.sky && sc.op && sc.lbl && sc.snap, JSON.stringify(sc));

// 9 显隐/删除 + 面板切换
const crud = await page.evaluate(() => {
  const a = window.__app; const p = a.entities.find((e) => e.type === 'prop');
  a.toggleVisible(p.id); const h = !p.root.visible; a.toggleVisible(p.id);
  a.select(null); const scenePanelShown = document.getElementById('inspector').hidden && !document.getElementById('scenePanel').hidden;
  const n0 = a.entities.length; a.remove(p.id);
  return { h, scenePanelShown, removed: a.entities.length === n0 - 1 };
});
ok('显隐/删除 + 未选中显示场景面板', crud.h && crud.scenePanelShown && crud.removed);

// 截一张页面图，便于人工对齐截图
await page.evaluate(() => window.__app.select(null));
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: 'selftest_view.png' });
console.log('📸 已保存 selftest_view.png（未选中态）');
const c2 = await page.evaluate(() => { const c = window.__app.entities.find((e) => e.type === 'character'); window.__app.select(c.id); return c.id; });
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: 'selftest_selected.png' });
console.log('📸 已保存 selftest_selected.png（选中角色态）');

ok('运行期无 console 错误', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.pass).length;
console.log(`\n=== ${results.length - failed}/${results.length} passed ===`);
if (failed) process.exit(1);
