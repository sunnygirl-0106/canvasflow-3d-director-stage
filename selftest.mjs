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
//     对三个档案逐个预设做穿模检测（src/dev/poseCollision.js），列出穿模部位与最大深度；有穿模则退出码 1。
//   node selftest.mjs doc
//     场景文档验收：搭场景 → 截图 A → toDocument → 清空 → loadDocument → 截图 B → toDocument，
//     断言两份文档深度相等、两图像素差 < 0.5%；5 种坏文档被定位并拒绝；撤销/重做画面一致。产物在 test-output/doc/。
//   node selftest.mjs anim
//     动画内核验收（阶段 C）：纯函数 / 跳转一致 / 手动值保持 / 导出不污染 / 往返 / 撤销 / 步态 / 约束 / 坏文档。
//     产物在 test-output/anim/。
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
    const out = [];
    for (const p of Object.values(PROFILES)) {
      const ch = await Character.load(p.id, { url: p.file, profile: p, height: p.heightM });
      for (const pr of POSE_PRESETS) {
        if (only && !only.split(',').includes(pr.key)) continue;
        ch.applyPosePreset(pr.key);
        out.push({ profile: p.id, preset: pr.key, hits: detectPenetration(ch.model) });
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
    a.history.reset();
    return { n: a.entities.length, cams: a.cameras.length, pano: a.panorama.active };
  });
  ok('文档：API 搭建场景', built.n === 6 && built.cams === 2 && built.pano, JSON.stringify(built));

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
  ok('文档：删除实体连带删除引用它的路径 / 约束', bad.pruned.paths === 0 && bad.pruned.constraints === 0 && bad.pruned.tracks === 2 && bad.pruned.valid, JSON.stringify(bad.pruned));
  ok('坏文档：基准文档（含 timeline / paths / constraints）合法', bad.good.ok, bad.good.errors.slice(0, 3).join(' | '));
  for (const b of bad.out) ok(`坏文档：${b.name}`, b.ok && b.located && b.rejected && b.unchanged, b.first);
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
