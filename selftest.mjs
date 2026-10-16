// 端到端自测：headless Chrome 驱动真实 dev server，覆盖核心功能 + 已修复问题的回归。
// 运行：npm run test:e2e
//   - 默认自动起一个 Vite dev server；也可用 TEST_URL=http://localhost:5173/ 指向已有服务
//   - Chrome 路径：CHROME_PATH 环境变量，默认 macOS 安装位置
// 子命令：
//   node selftest.mjs poses [outDir] [bodyKey]
//     对单个角色逐个套用全部姿势预设并截图到 outDir/<preset>.png（默认 test-output/poses，
//     bodyKey 默认 xbot；不存在时取 BODY_TYPES 第一项）。用于重构前后逐像素对比。
//   node selftest.mjs posediff <dirA> <dirB> [maxRatio]
//     逐张像素对比两组截图（pixelmatch），差异像素占比 > maxRatio（默认 0.001）判失败，
//     差异图写到 dirB/_diff/。不起浏览器。
//   node selftest.mjs calib [profileId ...]
//     对校准页 calib.html?profile=<id> 整页截图到 test-output/calib_<id>.png（默认全部档案）。
//   node selftest.mjs collide [preset,...]
//     对三个档案逐个预设 + 步态（走 / 跑各 8 相位，可用 gait 指代）做穿模检测（src/dev/poseCollision.js），
//     列出穿模部位与最大深度；有穿模则退出码 1。
//   node selftest.mjs doc
//     场景文档验收：搭场景 → 截图 A → toDocument → 清空 → loadDocument → 截图 B → toDocument，
//     断言两份文档深度相等、两图像素差 < 0.5%；5 种坏文档被定位并拒绝；撤销/重做画面一致。产物在 test-output/doc/。
//   node selftest.mjs anim
//     动画内核验收（阶段 C）：纯函数 / 跳转一致 / 手动值保持 / 导出不污染 / 往返 / 撤销 / 步态 / 约束 / 坏文档。
//     产物在 test-output/anim/。
//   node selftest.mjs tl
//     时间轴面板验收（阶段 D）：puppeteer 真实点击 / 拖拽 —— 从零打键做动画、自动打键、菱形状态、拖键 + 撤销、
//     区间条、约束段、播放 / 停止、快捷键、性能、折叠。产物在 test-output/tl/。
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const [CMD, ...ARGS] = process.argv.slice(2);

if (CMD === 'posediff') process.exit(poseDiff(ARGS[0], ARGS[1], parseFloat(ARGS[2] ?? '0.001')));

function poseDiff(dirA, dirB, maxRatio) {
  const files = fs.readdirSync(dirA).filter((f) => f.endsWith('.png')).sort();
  const diffDir = path.join(dirB, '_diff');
  fs.mkdirSync(diffDir, { recursive: true });
  let bad = 0;
  for (const f of files) {
    const pb = path.join(dirB, f);
    if (!fs.existsSync(pb)) { console.log(`❌ ${f} — ${dirB} 中缺失`); bad++; continue; }
    const a = PNG.sync.read(fs.readFileSync(path.join(dirA, f)));
    const b = PNG.sync.read(fs.readFileSync(pb));
    if (a.width !== b.width || a.height !== b.height) { console.log(`❌ ${f} — 尺寸不同`); bad++; continue; }
    const diff = new PNG({ width: a.width, height: a.height });
    const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
    const ratio = n / (a.width * a.height);
    const pass = ratio <= maxRatio;
    if (!pass) { bad++; fs.writeFileSync(path.join(diffDir, f), PNG.sync.write(diff)); }
    console.log(`${pass ? '✅' : '❌'} ${f} — 差异像素 ${n}（${(ratio * 100).toFixed(4)}%）`);
  }
  console.log(`\n=== ${files.length - bad}/${files.length} 一致（阈值 ${(maxRatio * 100).toFixed(2)}%）===`);
  return bad ? 1 : 0;
}

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let server = null;
let URL_ = process.env.TEST_URL;
if (!URL_) {
  server = await createServer({ server: { port: 5181, strictPort: false, open: false }, logLevel: 'error' });
  await server.listen();
  URL_ = server.resolvedUrls.local[0];
}

const results = [];
const ok = (name, pass, detail = '') => { results.push({ pass }); console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 810, deviceScaleFactor: 1 });
const errs = [];
const warns = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warn') warns.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

if (CMD === 'calib') {
  const ids = ARGS.length ? ARGS : ['xbot', 'bodykun_male', 'bodychan_female'];
  fs.mkdirSync('test-output', { recursive: true });
  for (const id of ids) {
    await page.goto(new URL(`calib.html?profile=${id}`, URL_).href, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForFunction(() => window.__calibReady, { timeout: 60000 });
    const err = await page.$eval('#err', (e) => e.textContent);
    const out = `test-output/calib_${id}.png`;
    await page.screenshot({ path: out, fullPage: true });
    console.log(`${err ? '❌' : '📸'} ${out}${err ? ' — ' + err : ''}`);
  }
  if (errs.length) console.log('❌ console 错误：\n' + errs.join('\n'));
  await browser.close();
  await server?.close();
  process.exit(errs.length ? 1 : 0);
}

if (CMD === 'collide') {
  await page.goto(new URL('calib.html?profile=xbot', URL_).href, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForFunction(() => window.__calibReady, { timeout: 60000 });
  const report = await page.evaluate(async (only) => {
    const { Character } = await import('/src/entities/Character.js');
    const { PROFILES } = await import('/src/rig/profiles/index.js');
    const { POSE_PRESETS } = await import('/src/entities/posePresets.js');
    const { detectPenetration } = await import('/src/dev/poseCollision.js');
    const { gaitPose } = await import('/src/anim/Locomotion.js');
    const out = [];
    for (const p of Object.values(PROFILES)) {
      const ch = await Character.load(p.id, { url: p.file, profile: p, height: p.heightM });
      for (const pr of POSE_PRESETS) {
        if (only && !only.split(',').includes(pr.key)) continue;
        ch.applyPosePreset(pr.key);
        out.push({ profile: p.id, preset: pr.key, hits: detectPenetration(ch.model) });
      }
      // 步态：走 / 跑各 8 个相位（w=1 的完整步态，阶段 C Locomotion）
      if (!only || only.split(',').includes('gait')) {
        for (const [name, k] of [['walk', 0], ['run', 1]]) {
          for (let i = 0; i < 8; i++) {
            const g = gaitPose(ch.legGeom, i / 8, k);
            ch.resetPose();
            Object.assign(ch.values, g.values);
            ch.applyPose();
            out.push({ profile: p.id, preset: `${name}@${i}/8`, hits: detectPenetration(ch.model) });
          }
        }
      }
    }
    return out;
  }, ARGS[0] || '');
  let bad = 0;
  for (const r of report) {
    if (!r.hits.length) continue;
    bad++;
    console.log(`❌ ${r.profile.padEnd(16)} ${r.preset.padEnd(7)} ` + r.hits.map((h) => `${h.pair} ${(h.depth * 100).toFixed(1)}cm×${h.count}`).join('  '));
  }
  console.log(`\n=== ${report.length - bad}/${report.length} 无穿模 ===`);
  await browser.close();
  await server?.close();
  process.exit(bad ? 1 : 0);
}

await page.goto(URL_, { waitUntil: 'networkidle0', timeout: 30000 });
await page.waitForFunction(() => window.__app && window.__app.entities.filter((e) => e.type === 'character' && e.bones?.size > 0).length >= 2, { timeout: 30000 });

if (CMD === 'poses') {
  await shootPoses(ARGS[0] || 'test-output/poses', ARGS[1]);
  await browser.close();
  await server?.close();
  process.exit(errs.length ? 1 : 0);
}

if (CMD === 'anim') {
  await animTest();
  ok('运行期无 console 错误', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  await server?.close();
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n=== ${results.length - failed}/${results.length} passed ===`);
  process.exit(failed ? 1 : 0);
}

if (CMD === 'tl') {
  await tlTest();
  ok('运行期无 console 错误', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  await server?.close();
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n=== ${results.length - failed}/${results.length} passed ===`);
  process.exit(failed ? 1 : 0);
}

if (CMD === 'doc') {
  await docTest();
  ok('运行期无 console 错误', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  await server?.close();
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n=== ${results.length - failed}/${results.length} passed ===`);
  process.exit(failed ? 1 : 0);
}

/** 视口截图（含名牌 / 取景框叠加层），先等两帧让按需渲染出图。 */
async function shootViewport(file) {
  await page.evaluate(() => new Promise((r) => { window.__app.stage.invalidate(); requestAnimationFrame(() => requestAnimationFrame(r)); }));
  await new Promise((r) => setTimeout(r, 150));
  const vp = await page.$('#viewport');
  await vp.screenshot({ path: file });
  return file;
}

/** 两张 PNG 的差异像素占比（pixelmatch threshold 0.1），差异图写到 diffFile。 */
function pixelDiff(fa, fb, diffFile) {
  const a = PNG.sync.read(fs.readFileSync(fa));
  const b = PNG.sync.read(fs.readFileSync(fb));
  if (a.width !== b.width || a.height !== b.height) return 1;
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  if (n && diffFile) fs.writeFileSync(diffFile, PNG.sync.write(diff));
  return n / (a.width * a.height);
}

async function docTest() {
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
    m.root.position.x = -1.2; m.root.rotation.y = 0.4;
    m.applyPosePreset('walk');
    const f = await a.addCharacter('female');
    f.root.position.x = 1.0; f.root.position.z = 0.6; f.root.scale.multiplyScalar(1.1);
    f.applyPosePreset('think');
    f.values.headY = 25; f.values.lKnee = 30; f.currentPreset = null; f.applyPose(); // 模拟滑条微调
    f.setColor('#ff7a45');
    const p = a.addProp('cylinder'); p.root.position.set(0.2, 0, -1.4); p.setColor('#8e7cc3');
    a.select(m.id);
    const c1 = a.addCamera('front_mid');
    a.select(f.id);
    const c2 = a.addCamera('front_closeup'); c2.setFov(50);
    const crowd = await a.addCrowd(2, 2, 1.1);
    crowd.root.position.set(-0.4, 0, -3.2); crowd.root.rotation.y = -0.3;
    crowd.members[3].applyPosePreset('wave');
    a.setSkyColor('#1d2b3a');
    a.setGroundOpacity(0.65); a.setGroundHeight(-0.05);
    a.setRatio('16:9');
    await a.panorama.setFromAsset({ url: './assets/panoramas/pano-sunset.jpg', title: '威尼斯黄昏' });
    a.panorama.setRotation(120);
    a.setActiveCamera(c1.id);
    a.select(null);
    a.rig.controls.target.set(0, 0.9, -0.8); a.stage.camera.position.set(2.5, 2.6, 6.5); a.rig.controls.update();
    // 动画数据（阶段 C）：轨道 / 路径 / 约束也要往返一致
    const tl = a.timeline;
    const tr = tl.addTrack({ target: p.id, property: 'rot' });
    tl.setKey(tr.id, 0, [0, 0, 0]); tl.setKey(tr.id, 3, [0, 90, 0], 'smooth');
    tl.addTrack({ target: c2.id, property: 'fov' }); // 空轨道
    tl.addPath({ target: crowd.id, points: [[-0.4, 0, -3.2], [1.5, 0, -2], [3, 0, -3]], start: 1, duration: 5, speed: 'smooth', orient: 'tangent' });
    tl.addConstraint({ type: 'lookAt', target: c2.id, subject: f.id, start: 0.5, end: 6 });
    tl.setDuration(12); tl.setMainCamera(c1.id);
    a.history.reset();
    return { n: a.entities.length, cams: a.cameras.length, pano: a.panorama.active, anim: tl.tracks.length + tl.paths.length + tl.constraints.length };
  });
  ok('文档：API 搭建场景（含动画轨道 / 路径 / 约束）', built.n === 6 && built.cams === 2 && built.pano && built.anim === 4, JSON.stringify(built));

  // ---- 2 截图 A → doc1 → 清空 → load(doc1) → 截图 B → doc2 ----
  const shotA = await shootViewport(`${OUT}/A_director.png`);
  const doc1 = await page.evaluate(() => window.__app.toDocument());
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

  const t = await page.evaluate(async (d) => { const t0 = performance.now(); await window.__app.loadDocument(d, { applyView: true }); return performance.now() - t0; }, doc1);
  const shotB = await shootViewport(`${OUT}/B_director.png`);
  const doc2 = await page.evaluate(() => window.__app.toDocument());
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
    const before = JSON.stringify({ ...a.toDocument(), meta: null });
    const out = [];
    for (const [name, mut, expect] of cases) {
      const d = structuredClone(good);
      mut(d);
      const v = validate(d);
      let rejected = false;
      try { await a.loadDocument(d); } catch (e) { rejected = e.name === 'DocumentError'; }
      const unchanged = JSON.stringify({ ...a.toDocument(), meta: null }) === before;
      out.push({ name, ok: !v.ok, located: v.errors.some((e) => e.startsWith(expect)), rejected, unchanged, first: v.errors[0] });
    }
    return out;
  }, doc1);
  for (const b of bad) ok(`坏文档：${b.name}`, b.ok && b.located && b.rejected && b.unchanged, b.first);

  // ---- 4 撤销重做：添加 → 移动 → 改姿势 → 撤销×3 → 重做×3 ----
  await page.evaluate(() => { window.__app.history.reset(); });
  const states = [await shootViewport(`${OUT}/undo_s0.png`)];
  const step = async (fn, i) => {
    await page.evaluate(fn);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 30)));
    states.push(await shootViewport(`${OUT}/undo_s${i}.png`));
  };
  await step(() => { window.__app.addProp('box'); window.__app.select(null); }, 1);
  await step(() => { const p = window.__app.entities.at(-1); p.root.position.set(1.6, 0, 1.4); window.dispatchEvent(new Event('pointerup')); }, 2);
  await step(() => { window.__app.entities.find((e) => e.type === 'character').applyPosePreset('sit'); window.dispatchEvent(new Event('click')); }, 3);
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
  for (const [name, r] of seq) ok(`撤销重做：${name} 画面一致`, r < MAX, pct(r));
  console.log(`📁 产物：${OUT}/`);
}

/** 动画验收场景：2 角色、1 道具、2 机位（从空场景搭起）。返回各实体 id。 */
async function buildAnimScene() {
  return page.evaluate(async () => {
    const { createEmptyDocument } = await import('/src/doc/schema.js');
    const a = window.__app;
    a.playback?.stop();
    await a.loadDocument(createEmptyDocument());
    const m = await a.addCharacter('male');
    m.root.position.x = -1.2; m.root.rotation.y = 0.4;
    const f = await a.addCharacter('female');
    f.root.position.set(1.0, f.root.position.y, 0.6);
    f.applyPosePreset('think');
    const p = a.addProp('box'); p.root.position.set(0.2, 0, -1.4);
    a.select(m.id);
    const c1 = a.addCamera('front_mid');
    a.select(f.id);
    const c2 = a.addCamera('front_closeup');
    a.select(null);
    a.rig.controls.target.set(0, 0.9, -0.5); a.stage.camera.position.set(3.5, 3.2, 8.5); a.rig.controls.update();
    a.history.reset();
    return { m: m.id, f: f.id, p: p.id, c1: c1.id, c2: c2.id };
  });
}

async function animTest() {
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
    const good = a.toDocument();
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
    const before = JSON.stringify({ ...a.toDocument(), meta: null });
    const out = [];
    for (const [name, mut, expect] of cases) {
      const d = structuredClone(good);
      mut(d);
      const v = validate(d);
      let rejected = false;
      try { await a.loadDocument(d); } catch (e) { rejected = e.name === 'DocumentError'; }
      const unchanged = JSON.stringify({ ...a.toDocument(), meta: null }) === before;
      out.push({ name, ok: !v.ok, located: v.errors.some((e) => e.startsWith(expect)), rejected, unchanged, first: v.errors[0] });
    }
    // 合法文档能加载；删除被引用的实体后，引用它的路径 / 约束一并删除，导出仍合法
    await a.loadDocument(good);
    const loaded = JSON.stringify(a.timeline.toJSON()) === JSON.stringify({ timeline: good.timeline, paths: good.paths, constraints: good.constraints });
    a.remove(ids.f);
    const after = a.toDocument();
    const pruned = { paths: after.paths.length, constraints: after.constraints.length, tracks: after.timeline.tracks.length, valid: validate(after).ok };
    return { good: v0, out, loaded, pruned };
  }, ids);
  ok('文档：含动画的文档可加载，timeline.toJSON 与文档一致', bad.loaded);
  // ---- 关键帧：pos / rot / fov 轨道 + 播放 / 停止 / 导出不污染 ----
  await buildAnimScene().then((v) => Object.assign(ids, v));
  const kf = await page.evaluate(async (ids) => {
    const a = window.__app, tl = a.timeline, pb = a.playback;
    const strip = (d) => JSON.stringify({ ...d, meta: null });
    const manualDoc = strip(a.toDocument());
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
    const docWhileActive = strip(a.toDocument());
    pb.play();
    await new Promise((r) => setTimeout(r, 300));
    pb.pause();
    const playedTo = pb.time;
    const docWhilePlaying = strip(a.toDocument());
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
  ok('关键帧：active / 播放中 toDocument() 导出 base', kf.exportBase);
  // ---- 路径：道具 / 机位 / 角色沿 Catmull-Rom 移动，tangent 朝向，smooth 首尾速度为 0 ----
  await buildAnimScene().then((v) => Object.assign(ids, v));
  const pt = await page.evaluate(async (ids) => {
    const { Path } = await import('/src/anim/Path.js');
    const a = window.__app, tl = a.timeline, pb = a.playback;
    const p = a.findEntity(ids.p), c2 = a.findEntity(ids.c2), m = a.findEntity(ids.m);
    const R2D = 180 / Math.PI;
    const pp = tl.addPath({ target: ids.p, points: [[0.2, 0, -1.4], [2, 0, -1.4], [2.5, 0, 1]], start: 1, duration: 3, speed: 'linear', orient: 'tangent' });
    const cp = tl.addPath({ target: ids.c2, points: [[3, 1.6, 3], [0, 1.8, 4], [-3, 1.6, 3]], start: 0, duration: 4, speed: 'smooth', orient: 'tangent' });
    const mp = tl.addPath({ target: ids.m, points: [[-1.2, 0, 0], [-1.2, 0, 3]], start: 0, duration: 4, speed: 'smooth', orient: 'tangent' });
    const P = new Path(pp), C = new Path(cp), M = new Path(mp);
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
    out.charDocY = a.toDocument().entities.find((e) => e.id === ids.m).transform.pos[1];
    out.charRootY = m.root.position.y - m._rootY0;
    out.charZ = m.root.position.z;
    // smooth：首尾速度为 0
    out.speeds = [M.speedAt(0), M.speedAt(2), M.speedAt(4), C.speedAt(0), C.speedAt(4)];
    out.startCreep = M.distanceAt(1 / 240); // 起步 1/240 s 内几乎不动（匀速会走 3/4/240 = 0.003125 m）
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
  ok('路径：smooth 首尾速度为 0、中段最快', pt.speeds[0] === 0 && pt.speeds[2] === 0 && pt.speeds[3] === 0 && pt.speeds[4] === 0 && Math.abs(pt.speeds[1] - 1.125) < 1e-6 && pt.startCreep < 1e-4, JSON.stringify(pt.speeds.map((v) => +v.toFixed(4))) + ` 起步=${pt.startCreep.toExponential(2)}m`);
  ok('路径：stop() 回到手动位置', pt.stopped);
  // ---- 步态：6 m 直线 smooth 4 s；压到 1.5 s 为跑步；组沿路径成员一起走 ----
  await buildAnimScene().then((v) => Object.assign(ids, v));
  const gait = await page.evaluate(async (ids) => {
    const a = window.__app, tl = a.timeline, pb = a.playback;
    const m = a.findEntity(ids.m);
    m.applyPosePreset('think'); // 原姿势不是站立：停下后应回到它
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
    out.walking = !same(m.values) && !m.autoGround && Math.abs(m.values.lLegFwd - m.values.rLegFwd) > 5;
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
      // 纯走（w=1、速度 ≤ 1.8 m/s）时任意时刻都有一只脚着地；走跑混合区有腾空期，不查
      const v = P.speedAt(i / 30);
      if (v >= 0.5 && v <= 1.8) {
        const e = (m.lowestSoleY() - m.legGeom.ground / m.baseScale) * m.root.scale.y;
        if (Math.abs(e) > Math.abs(out.soleErr)) out.soleErr = e;
      }
    }
    // 跑：同一路径压到 1.5 s（平均 4 m/s）
    tl.updatePath(path.id, { duration: 1.5 });
    pb.seek(0.75);
    out.runKnee = Math.max(m.values.lKnee, m.values.rKnee);
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
  ok('步态：压到 1.5 s（4 m/s）t=0.75 为跑步（膝屈 > 45°）', gait.runKnee > 45, `膝 ${gait.runKnee.toFixed(1)}°`);
  ok('步态：stop() 后恢复原姿势', gait.restored);
  ok('步态：组沿路径时成员一起走、步伐错开，停下恢复', gait.crowdWalk && gait.crowdRestored);
  // ---- 约束：lookAt 保留 roll；follow 刚性跟随且覆盖 pos 轨道 / 路径 ----
  await buildAnimScene().then((v) => Object.assign(ids, v));
  const cons = await page.evaluate(async (ids) => {
    const { aimPoint, anchorOf } = await import('/src/anim/Constraint.js');
    const a = window.__app, tl = a.timeline, pb = a.playback;
    const c1 = a.findEntity(ids.c1), c2 = a.findEntity(ids.c2);
    const V = c1.root.position.constructor, Q = c1.root.quaternion.constructor;
    c1._roll = 12 * Math.PI / 180; // 荷兰角
    // f 沿弧线走（会转向）；c1 注视 f；c2 跟随 f，并且有自己的 pos 轨道和 rot 关键帧（应被 follow 覆盖 / 按 f 的 yaw 旋转）
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
      // follow 朝向：Ry(yaw) × 机位手动朝向
      const want = new Q().setFromAxisAngle(new V(0, 1, 0), an.yaw).multiply(new Q().setFromEuler(tl.baseOf(c2).rotation));
      maxRot = Math.max(maxRot, 2 * Math.acos(Math.min(1, Math.abs(want.dot(c2.root.quaternion)))) * R2D);
    }
    // 生效区间：end 之后 follow 失效，pos 轨道接管
    tl.updateConstraint(fo.id, { start: 0, end: 2 });
    pb.seek(4);
    const trackX = c2.root.position.x; // pos 轨道 t=4：5 + (−10)×0.8 = −3
    pb.stop();
    return { maxAim, maxRoll, maxOff, maxRot, trackX, rollKept: Math.abs(c1._roll * R2D - 12) < 1e-9 };
  }, ids);
  ok('约束：lookAt 机位 −Z 对准 subject（每 0.5 s 采样）', cons.maxAim < 0.1, `max ${cons.maxAim.toExponential(2)}°`);
  ok('约束：lookAt 保留荷兰角 roll', cons.maxRoll < 0.1 && cons.rollKept, `max 偏差 ${cons.maxRoll.toExponential(2)}°`);
  ok('约束：follow 相对偏移恒等于 offset（subject yaw 坐标系），覆盖 pos 轨道', cons.maxOff < 1e-6, `max ${cons.maxOff.toExponential(2)}m`);
  ok('约束：follow 朝向随 subject yaw 刚性旋转', cons.maxRot < 1e-3, `max ${cons.maxRot.toExponential(2)}°`);
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
  const manualDoc = await page.evaluate(() => window.__app.toDocument());
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
  const docAt5 = await page.evaluate(() => window.__app.toDocument());
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
  const rtDoc1 = await page.evaluate(() => window.__app.toDocument());
  fs.writeFileSync(`${OUT}/doc1.json`, JSON.stringify(rtDoc1, null, 2));
  await page.evaluate(async (d) => {
    const { createEmptyDocument } = await import('/src/doc/schema.js');
    const a = window.__app;
    a.playback.stop();
    await a.loadDocument(createEmptyDocument());
    await a.loadDocument(d, { applyView: true });
  }, rtDoc1);
  const rtDoc2 = await page.evaluate(() => window.__app.toDocument());
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

// ---- 时间轴面板验收（阶段 D）：真实点击 / 拖拽 ----
// 用函数声明（会提升）：子命令分发在文件前部，调用时这些定义还没执行到
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
/** 等界面刷新：两帧 rAF（Inspector / 标尺都是 rAF 节流）+ 一点余量。 */
async function settle(ms = 60) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await sleep(ms);
}

async function centerOf(sel) {
  const r = await page.$eval(sel, (n) => { const b = n.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; });
  return r;
}
async function clickSel(sel, opts) { const [x, y] = await centerOf(sel); await page.mouse.click(x, y, opts); }
async function dragFromTo([x0, y0], [x1, y1], { steps = 10, hold } = {}) {
  await page.mouse.move(x0, y0);
  await sleep(30);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps });
  if (hold) await hold();
  await page.mouse.up();
  await settle();
}

/** 左栏点选实体（按名字）。 */
async function pickInOutliner(name) {
  const xy = await page.evaluate((name) => {
    const n = [...document.querySelectorAll('#outliner .node')].find((x) => x.querySelector('.nm')?.textContent === name);
    if (!n) return null;
    const b = n.getBoundingClientRect();
    return [b.x + 40, b.y + b.height / 2];
  }, name);
  if (!xy) throw new Error('左栏找不到 ' + name);
  await page.mouse.click(...xy);
  await settle();
}

/** 时刻 t 在标尺上的屏幕坐标。 */
async function rulerPoint(t) {
  return page.evaluate((t) => {
    const p = window.__timelinePanel;
    const r = p.scroll.getBoundingClientRect();
    const rr = p.rulerRow.getBoundingClientRect();
    return [r.left + p.timeToX(t) - p.scroll.scrollLeft, rr.top + rr.height / 2];
  }, t);
}

/** 拖播放头：从当前位置按下，拖到 t。 */
async function dragPlayhead(t) {
  const cur = await page.evaluate(() => window.__app.playback.time);
  await dragFromTo(await rulerPoint(cur), await rulerPoint(t), { steps: 8 });
}

/**
 * 真实拖 gizmo 的某个轴箭头，使选中对象沿该轴移动 worldDelta（世界坐标）：
 * 按在箭头上（拾取体 0..0.6 × 手柄尺度），拖到"箭头点 + 位移"的投影处。
 */
async function gizmoDrag(axis, delta) {
  const pts = await page.evaluate((axis, delta) => {
    const a = window.__app;
    a.stage.render();
    const giz = a.gizmo.control._gizmo;
    giz.updateMatrixWorld(true);
    const h = giz.picker.translate.children.find((c) => c.name === axis.toUpperCase());
    const V = () => a.stage.camera.position.clone().set(0, 0, 0);
    const dir = V().set(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
    const p0 = h.position.clone().add(dir.clone().multiplyScalar(0.4 * h.scale.x));
    const p1 = p0.clone().add(dir.clone().multiplyScalar(delta));
    const cam = a.getRenderCamera();
    const r = a.stage.renderer.domElement.getBoundingClientRect();
    const scr = (p) => { const n = p.clone().project(cam); return [r.left + (n.x + 1) / 2 * r.width, r.top + (1 - n.y) / 2 * r.height]; };
    return [scr(p0), scr(p1)];
  }, axis, delta);
  await page.mouse.move(pts[0][0] - 6, pts[0][1]);
  await page.mouse.move(...pts[0], { steps: 3 }); // 悬停：TransformControls 先拾取到轴
  await sleep(40);
  await page.mouse.down();
  await page.mouse.move(...pts[1], { steps: 16 });
  await page.mouse.up();
  await settle();
}

/** 视口画布像素（同步渲染后立即读，时刻与画面严格对应），写成 PNG。 */
async function canvasShot(file) {
  const url = await page.evaluate(() => { const a = window.__app; a.stage.render(); return a.stage.renderer.domElement.toDataURL('image/png'); });
  fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  return file;
}

async function tlTest() {
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

/**
 * 单角色姿势截图：隐藏其余实体与名牌，角色放原点，固定相机出 正面 + 3/4 侧面 两视图拼一张。
 * 渲染走 Stage.snapshot（主渲染器），保证与应用内画面一致且确定。
 */
async function shootPoses(outDir, bodyKey) {
  fs.mkdirSync(outDir, { recursive: true });
  const keys = await page.evaluate(async (bodyKey) => {
    const { BODY_TYPES } = await import('/src/config.js');
    const { POSE_PRESETS } = await import('/src/entities/posePresets.js');
    const a = window.__app;
    const key = bodyKey || (BODY_TYPES.xbot ? 'xbot' : Object.keys(BODY_TYPES)[0]);
    const c = await a.addCharacter(key);
    a.select(null);
    for (const e of a.entities) if (e !== c) e.setVisible(false);
    a.setLabelsVisible(false);
    c.root.position.set(0, c.root.position.y, 0);
    c.root.rotation.set(0, 0, 0);
    c.root.updateMatrixWorld(true);
    const Cam = a.stage.camera.constructor; // THREE.PerspectiveCamera（页面内无法直接 import 裸模块名）
    const mk = (x, z) => { const cam = new Cam(30, 1, 0.05, 100); cam.position.set(x, 1.0, z); cam.lookAt(0, 0.9, 0); cam.updateMatrixWorld(true); return cam; };
    window.__poseCams = [mk(0, 5.2), mk(3.7, 3.7)];
    window.__poseChar = c;
    return { body: key, presets: POSE_PRESETS.map((p) => p.key) };
  }, bodyKey);
  console.log(`📐 姿势截图：body=${keys.body} → ${outDir}`);
  for (const preset of keys.presets) {
    const url = await page.evaluate((preset) => {
      const c = window.__poseChar;
      c.applyPosePreset(preset);
      c.root.updateMatrixWorld(true);
      const W = 360, H = 480;
      const out = document.createElement('canvas'); out.width = W * 2; out.height = H;
      const g = out.getContext('2d');
      window.__poseCams.forEach((cam, i) => g.drawImage(window.__app.stage.snapshot(cam, { width: W, height: H }), i * W, 0, W, H));
      window.__app.stage.render();
      return out.toDataURL('image/png');
    }, preset);
    fs.writeFileSync(path.join(outDir, preset + '.png'), Buffer.from(url.split(',')[1], 'base64'));
    console.log('  📸 ' + preset);
  }
  if (errs.length) console.log('❌ console 错误：\n' + errs.join('\n'));
}

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
  const a = window.__app; const saved = a._charSeq;
  a._charSeq = 25; const z = a._nextCharName(); const a2 = a._nextCharName();
  a._charSeq = saved; return { z, a2 };
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
  return { isCrowd: crowd.type === 'crowd', countMatch, synced, labels: crowd.members.every((x) => x.labelEl) };
});
ok('群众阵列：建组/成员数=行×列/整组位移同步/成员名牌', crowdT.isCrowd && crowdT.countMatch && crowdT.synced && crowdT.labels, JSON.stringify(crowdT));

// 20 删除群众成员 + 解组后成员可创建副本（保留世界位姿）
const memberT = await page.evaluate(async () => {
  const a = window.__app;
  const crowd = a.entities.find((e) => e.type === 'crowd');
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
await page.screenshot({ path: 'selftest_view.png' });
console.log('📸 已保存 selftest_view.png（未选中态）');
await page.evaluate(() => { const c = window.__app.entities.find((e) => e.type === 'character'); window.__app.select(c.id); });
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: 'selftest_selected.png' });
console.log('📸 已保存 selftest_selected.png（选中角色态）');

ok('运行期无 console 错误', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close();
await server?.close();
const failed = results.filter((r) => !r.pass).length;
console.log(`\n=== ${results.length - failed}/${results.length} passed ===`);
process.exit(failed ? 1 : 0);
