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
//   node selftest.mjs path
//     角色路径验收（阶段 E）：puppeteer 真实点击 / 拖拽 —— 五种绘制、起点不跳、顶点拖动 / Esc / ⇧平移、插入 / 删除、
//     pos 轨道冲突、绘制态不转相机、可视化、播放、往返。产物在 test-output/path/。
//   node selftest.mjs cam
//     机位运镜验收（阶段 F）：Inspector 运镜段真实操作 —— 半环绕盯人 / 推拉 / 横移升降 / 摇、清除、追加 + 段列表 + 删末段 + ⌘Z、
//     机位画路径、主机位播放（视口 ≡ 主机位 snapshot）、含运镜文档往返。产物在 test-output/cam/。
//   node selftest.mjs export
//     导出视频验收（阶段 G）：精灵名牌进画面 / 位置一致、离屏帧 ≡ snapshot、两次导出逐帧 md5 相同且播放头 / 文档 / 撤销不变、
//     分辨率与比例、MP4 文件（ffprobe 或 mp4 盒子解析）、取消、不支持的浏览器、导出帧干净。产物在 test-output/export/。
//   node selftest.mjs ai
//     AI 生成验收（阶段 H，全部 MockProvider、不依赖网络）：一句话生成 / 校验回路（错误原文喂回）/ 三次失败场景不变 /
//     修改模式 + ⌘Z / 重名改名 / 识图（合成站位图）与越权拒绝 / 词汇表一致 / 设置只存本机。产物在 test-output/ai/。
//   pathGen / cameraMoves / AI ops / 文档纯函数单元测试不起浏览器：npm run test:unit
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
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

if (CMD === 'path') {
  await pathTest();
  ok('运行期无 console 错误', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  await server?.close();
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n=== ${results.length - failed}/${results.length} passed ===`);
  process.exit(failed ? 1 : 0);
}

if (CMD === 'cam') {
  await camTest();
  ok('运行期无 console 错误', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  await server?.close();
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n=== ${results.length - failed}/${results.length} passed ===`);
  process.exit(failed ? 1 : 0);
}

if (CMD === 'export') {
  await exportTest();
  ok('运行期无 console 错误', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  await server?.close();
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n=== ${results.length - failed}/${results.length} passed ===`);
  process.exit(failed ? 1 : 0);
}

if (CMD === 'ai') {
  await aiTest();
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

// ---- 角色路径验收（阶段 E）：真实点击 / 拖拽 ----
/** 文档口径的点（stage.world 局部坐标）→ 屏幕坐标。 */
async function scr(p) {
  return page.evaluate((p) => {
    const a = window.__app;
    a.stage.world.updateMatrixWorld(true);
    const v = a.stage.camera.position.clone().set(p[0], p[1], p[2]);
    a.stage.world.localToWorld(v).project(a.getRenderCamera());
    const r = a.stage.renderer.domElement.getBoundingClientRect();
    return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height];
  }, p);
}
/** Dock「路径」→ 选一种方式。 */
async function pathMenu(label) {
  await clickSel('#dock .dockbtn[title^="路径"]');
  await settle();
  await page.evaluate((l) => [...document.querySelectorAll('#dock .dockmenu.open .menu-item')].find((n) => n.textContent.includes(l)).click(), label);
  await settle();
}
function toastText() { return page.$eval('#toast', (n) => (n.classList.contains('show') ? n.textContent : '')); }
async function toastClick(label) {
  await page.evaluate((l) => [...document.querySelectorAll('#toast .toast-action')].find((b) => b.textContent === l).click(), label);
  await settle();
}
function animJSON() { return page.evaluate(() => window.__app.timeline.toJSON()); }
async function pathOf(id) { return (await animJSON()).paths.find((p) => p.target === id); }
/** 洁净渲染（无 gizmo / 选中环 / 路径 overlay）导演视角画面，写成 PNG。 */
async function cleanShot(file) {
  const url = await page.evaluate(() => { const a = window.__app; return a.withCleanRender(() => a.stage.snapshot(a.stage.camera)).toDataURL('image/png'); });
  fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  return file;
}
async function dragPath(points, { steps = 3, hold, shift } = {}) {
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(...points[0]);
  await sleep(30);
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(...p, { steps });
  if (hold) await hold();
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
  await settle(120);
}
function hdist(a, b) { return Math.hypot(a[0] - b[0], a[2] - b[2]); }

async function pathTest() {
  const OUT = 'test-output/path';
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const panelClip = () => page.$eval('#rightPanel', (n) => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });

  // ---- 场景：种子角色 A (−1.1, 0, 0.2) / B (1.1, 0, 0.2) + 方块 + 圆柱 + 方块2；导演相机斜俯视 ----
  const ids = await page.evaluate(() => {
    const a = window.__app;
    a.playback.stop();
    const [A, B] = a.entities.filter((e) => e.type === 'character');
    const box = a.addProp('box'); box.root.position.set(1.6, 0, 2.6);
    const cyl = a.addProp('cylinder'); cyl.root.position.set(3.4, 0, 0.9);
    const box2 = a.addProp('box'); box2.root.position.set(-2.6, 0, 2.4);
    a.addCamera('front_mid'); // 验收 9：机位视角下路径不显示
    a.select(null);
    a.rig.controls.target.set(0, 0, 0.6); a.stage.camera.position.set(0, 8.5, 7.5); a.rig.controls.update();
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
  const dd1 = await page.evaluate(async (pts) => (await import('/src/anim/pathGen.js')).defaultDuration(pts), p1?.points || [[0, 0, 0]]);
  await page.evaluate(() => window.__app.playback.seek(0));
  await settle();
  const shot1 = await cleanShot(`${OUT}/1_t0.png`);
  const diff1 = pixelDiff(shot0, shot1, `${OUT}/1_diff.png`);
  await page.evaluate(() => window.__app.playback.stop());
  ok('验收1 点击落点：3 次点击 + Enter → 4 个点、首点 ≡ 角色当前位置、start=0、duration=defaultDuration',
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
  await page.evaluate(() => document.querySelector('#inspector [data-sec="path"]')?.scrollIntoView());
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
    const d1 = a.toDocument();
    await a.loadDocument(JSON.parse(JSON.stringify(d1)), { applyView: true });
    const d2 = a.toDocument();
    return { eq: strip(d1) === strip(d2), paths: d2.paths.length, items: a.pathOverlay._items.length, visible: a.pathOverlay.visible };
  });
  ok('验收11 含手绘路径的文档 导出 → 导入 → 导出 ≡；导入后 overlay 立即显示', rt.eq && rt.paths === 4 && rt.items === 4 && rt.visible, JSON.stringify(rt));

  // ---- 5 拖顶点（角色 A 第 2 个顶点拖 1 m）----
  await pickInOutliner(ids.An);
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
  await page.mouse.click(...await scr(mid));
  await settle(150);
  const ins = await pathOf(ids.A);
  await page.screenshot({ path: `${OUT}/13_insert.png` });
  const np = ins.points[2], pa = ins.points[1], pb = ins.points[3];
  const between = ins.points.length === before6.points.length + 1 && hdist(np, pa) < hdist(pa, pb) && hdist(np, pb) < hdist(pa, pb) && hdist(np, mid) < 0.02;
  ok('验收6 点曲线中点 → 点数 +1，新点在两邻点之间（落在曲线上）', between, `${before6.points.length} → ${ins.points.length} 新点=${JSON.stringify(np)}`);
  const selV = await page.evaluate(() => window.__app.pathOverlay.selVertex);
  await page.keyboard.press('Delete');
  await settle(150);
  const del = await pathOf(ids.A);
  const stillThere = await page.evaluate((id) => !!window.__app.findEntity(id), ids.A);
  ok('验收6 选中顶点 Del → 点数 −1（实体不被删除）', selV?.index === 2 && del.points.length === before6.points.length && stillThere, `${ins.points.length} → ${del.points.length}`);
  await pickInOutliner(ids.box2N);
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
  await page.evaluate(() => { const a = window.__app; a.rig.controls.target.set(0, 0, 0.6); a.stage.camera.position.set(0, 8.5, 7.5); a.rig.controls.update(); });
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
  await page.evaluate(() => document.querySelector('#inspector [data-sec="path"]')?.scrollIntoView());
  await settle();
  await page.screenshot({ path: `${OUT}/13_inspector.png`, clip: await panelClip() });

  // ---- 10 播放：角色 B 画一条 6 m 直线（替换手绘）后直接 Space ----
  await pickInOutliner(ids.Bn);
  await pathMenu('直线');
  await toastClick('替换');
  const bStart = await page.evaluate((id) => window.__app.pathTool.startPoint(window.__app.findEntity(id)), ids.B);
  const bEnd = [bStart[0] - 6, 0, bStart[2] - 0.3];
  await page.mouse.click(...await scr(bEnd));
  await settle(150);
  const p10 = await pathOf(ids.B);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Space');
  await page.waitForFunction((t) => window.__app.playback.time >= t, { timeout: 15000 }, p10.duration * 0.5);
  const walk = await page.evaluate((id) => { const e = window.__app.findEntity(id); return Object.values(e.values).reduce((s, v) => s + Math.abs(v), 0); }, ids.B);
  await page.waitForFunction((t) => window.__app.playback.time >= t, { timeout: 15000 }, p10.start + p10.duration + 0.1);
  const end10 = await page.evaluate((id) => { const a = window.__app; a.playback.pause(); return window.__app.findEntity(id).toJSON({ base: null }).transform.pos; }, ids.B);
  const end10root = await page.evaluate((id) => { const e = window.__app.findEntity(id); return [e.root.position.x, e.root.position.z]; }, ids.B);
  const e10 = Math.hypot(end10root[0] - p10.points[1][0], end10root[1] - p10.points[1][2]);
  await page.evaluate(() => window.__app.playback.stop());
  ok('验收10 6 m 直线直接 Space：中途在走路（姿势非零），t ≥ 结束时停在终点（误差 < 1 cm）',
    Math.abs(hdist(p10.points[0], p10.points[1]) - 6) < 0.05 && walk > 1 && e10 < 0.01,
    `长 ${hdist(p10.points[0], p10.points[1]).toFixed(3)} m 时长 ${p10.duration}s 姿势Σ|v|=${walk.toFixed(1)} 终点误差 ${(e10 * 100).toFixed(3)} cm ${JSON.stringify(end10).length ? '' : ''}`);

  console.log(`📁 产物：${OUT}/`);
}

/**
 * 单角色姿势截图：隐藏其余实体与名牌，角色放原点，固定相机出 正面 + 3/4 侧面 两视图拼一张。
 * 渲染走 Stage.snapshot（主渲染器），保证与应用内画面一致且确定。
 */
// ---- 阶段 F：机位运镜 ----
/** Inspector 运镜段：按标签找下拉 / 输入并设值（触发 change）。 */
async function moveField(label, value) {
  await page.evaluate((label, value) => {
    const f = [...document.querySelectorAll('#inspector [data-sec="move"] .field')].find((x) => x.querySelector('label')?.textContent === label);
    const n = f.querySelector('select, input');
    n.value = String(value);
    n.dispatchEvent(new Event('change'));
  }, label, value);
  await settle();
}
async function moveBtn(text) {
  await page.evaluate((t) => [...document.querySelectorAll('#inspector [data-sec="move"] .anim-btns button')].find((b) => b.textContent === t).click(), text);
  await settle(120);
}
/** 机位 −Z 与主体注视点方向的夹角（度）+ 注视点投影到画面的偏差（占画幅比例）。 */
function camAim(camId, subjectId) {
  return page.evaluate(async (camId, subjectId) => {
    const a = window.__app;
    const { aimPoint } = await import('/src/anim/Constraint.js');
    const cam = a.findEntity(camId);
    cam.root.updateMatrixWorld(true);
    const p = aimPoint(a, subjectId);
    const world = a.stage.world;
    world.updateMatrixWorld(true);
    const pw = world.localToWorld(p.clone());
    const fwd = cam.cam.getWorldDirection(p.clone());
    const to = pw.clone().sub(cam.cam.getWorldPosition(p.clone())).normalize();
    const ndc = pw.clone().project(cam.cam);
    return { angle: fwd.angleTo(to) * 180 / Math.PI, off: Math.max(Math.abs(ndc.x), Math.abs(ndc.y)) / 2 };
  }, camId, subjectId);
}

/** 机位位姿（场景根节点坐标）+ 各角色脚底位置（水平距离用）。 */
function camPose(camId) {
  return page.evaluate((camId) => {
    const a = window.__app;
    const c = a.findEntity(camId);
    const foot = {};
    for (const e of a.entities) if (e.type === 'character') foot[e.id] = e.toJSON().transform.pos;
    return { pos: c.root.position.toArray(), rot: c.root.rotation.toArray().slice(0, 3), foot };
  }, camId);
}
/** 机位的动画数据：路径 / 约束 / rot 轨道。 */
function camAnim(camId) {
  return page.evaluate((id) => {
    const t = window.__app.timeline.toJSON();
    return {
      path: t.paths.find((p) => p.target === id) || null,
      cns: t.constraints.filter((c) => c.target === id),
      rot: t.timeline.tracks.find((x) => x.target === id && x.property === 'rot') || null,
    };
  }, camId);
}
/** 机位画面（洁净渲染 stage.snapshot），写成 PNG。 */
async function camShot(camId, file) {
  const url = await page.evaluate((id) => {
    const a = window.__app;
    const c = a.findEntity(id);
    return a.withCleanRender(() => a.stage.snapshot(c.cam, { width: 640, height: 360 })).toDataURL('image/png');
  }, camId);
  fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  return file;
}

async function camTest() {
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
    a.findEntity(ids.c1).aimAt(aimPoint(a, ids.A));
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
  await page.evaluate((id) => { const c = window.__app.findEntity(id); c.root.rotation.y += 0.7; c.root.updateMatrixWorld(true); }, ids.c1);
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
  await page.evaluate((id) => { const c = window.__app.findEntity(id); c.root.rotation.y -= 0.7; c.root.updateMatrixWorld(true); }, ids.c1);

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
  // 拼接后是一条 smooth 速度曲线，t=3 附近机位正以 ~1.6 m/s 运动：0.02 s 本身就走 ~3 cm。
  // 判"无跳变"：跨接缝的一步与前后相邻两步的平均相差 < 2 mm（原始距离一并打印）
  const at = async (t) => { await page.evaluate((t) => window.__app.playback.seek(t), t); return (await camPose(ids.c1)).pos; };
  const ts = [2.97, 2.99, 3.01, 3.03];
  const ps = [];
  for (const t of ts) ps.push(await at(t));
  const step = (i) => Math.hypot(...ps[i].map((v, k) => v - ps[i + 1][k]));
  const jump = Math.abs(step(1) - (step(0) + step(2)) / 2);
  ok('验收6 播放 t=3 附近位置连续（跨接缝一步与相邻步之差 < 2 mm）', jump < 0.002,
    `2.99→3.01 相距 ${(step(1) * 100).toFixed(3)} cm（相邻 ${(step(0) * 100).toFixed(3)} / ${(step(2) * 100).toFixed(3)} cm），差 ${(jump * 1000).toFixed(3)} mm`);
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
    c.root.position.set(4, 1.4, 4); c.aimAt(a.findEntity(ids.A).root.position.clone().setY(0.9));
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
  const giz = await page.evaluate(() => ({ sel: window.__app.selected?.name, giz: window.__app.gizmo._helper.visible }));
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
  const doc1 = await page.evaluate(() => { window.__app.playback.stop(); return window.__app.toDocument(); });
  fs.writeFileSync(`${OUT}/10_doc1.json`, JSON.stringify(doc1, null, 2));
  await page.evaluate(async (d) => {
    const { createEmptyDocument } = await import('/src/doc/schema.js');
    const a = window.__app;
    await a.loadDocument(createEmptyDocument());
    await a.loadDocument(d);
  }, doc1);
  await settle(150);
  const doc2 = await page.evaluate(() => window.__app.toDocument());
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
}

// ---- 阶段 G：导出视频 ----
function md5(buf) { return crypto.createHash('md5').update(buf).digest('hex'); }
function dataURLBuf(url) { return Buffer.from(url.split(',')[1], 'base64'); }

/** 导出验收场景：走路角色（直线路径）+ 第二个角色 + 半环绕盯人的主机位 + 全景图。 */
async function buildExportScene() {
  return page.evaluate(async () => {
    const { createEmptyDocument } = await import('/src/doc/schema.js');
    const { aimPoint } = await import('/src/anim/Constraint.js');
    const a = window.__app;
    a.playback.stop();
    await a.loadDocument(createEmptyDocument());
    const m = await a.addCharacter('male');
    m.root.position.x = -1.6;
    const f = await a.addCharacter('female');
    f.root.position.set(1.2, f.root.position.y, -0.8);
    const tl = a.timeline;
    tl.setDuration(6);
    tl.addPath({ target: m.id, points: [[-1.6, 0, 0], [1.6, 0, 0.4]], start: 0, duration: 4, speed: 'smooth', orient: 'tangent' });
    a.select(m.id);
    const c = a.addCamera('front_full');
    c.aimAt(a.stage.world.localToWorld(aimPoint(a, m.id).clone()));
    const mv = a.cameraMoves;
    mv.setName(c, 'half_orbit');
    mv.formOf(c).subject = m.id;
    const seg = mv.commit(c, mv.build(c));
    tl.setMainCamera(c.id);
    await a.panorama.setFromAsset({ url: './assets/panoramas/pano-sunset.jpg', title: '威尼斯黄昏' });
    for (let i = 0; i < 50 && !a.panorama.active; i++) await new Promise((r) => setTimeout(r, 100));
    a.select(null);
    a.rig.controls.target.set(0, 0.9, 0); a.stage.camera.position.set(2.5, 4.5, 9); a.rig.controls.update();
    a.history.reset();
    return { m: m.id, f: f.id, c: c.id, mName: m.name, cName: c.name, seg: !!seg, pano: a.panorama.active };
  });
}

/** 播放头 / 文档 / 撤销栈的状态指纹（导出前后比对）。 */
function exportState() {
  return page.evaluate(() => {
    const a = window.__app;
    const d = a.toDocument();
    d.meta.updatedAt = null;
    return { active: a.timeline.active, time: a.playback.time, doc: JSON.stringify(d), hist: a.history.entries.length, idx: a.history.index };
  });
}

async function exportTest() {
  const OUT = 'test-output/export';
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(`${OUT}/frames`, { recursive: true });
  // 主画布需 ≥ 1920×1080，stage.snapshot(1920×1080) 才不缩小（验收 3 对比用）
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 2 });
  await page.evaluate(() => { const st = window.__app.stage; st.renderer.setPixelRatio(2); st.onResize(); }); // 像素比只在启动时读取
  await page.exposeFunction('__saveFile', (name, url) => fs.writeFileSync(`${OUT}/${name}`, dataURLBuf(url)));
  const ids = await buildExportScene();
  ok('导出场景：走路角色 + 半环绕主机位 + 全景', ids.seg && ids.pano, JSON.stringify(ids));
  await settle(200);

  // ---- 验收 3 帧 = 快照 ----
  await page.evaluate(async () => {
    const a = window.__app;
    const { renderFrame } = await import('/src/app/VideoExporter.js');
    const cam = a.findCamera(a.timeline.mainCameraId);
    const fr = await renderFrame(a, 2.0, { width: 1920, height: 1080 });
    await window.__saveFile('03_frame.png', fr.toDataURL('image/png'));
    a.timeline.evaluate(2.0);
    const snap = a.withCleanRender(() => a.stage.snapshot(cam.cam, { width: 1920, height: 1080 }));
    await window.__saveFile('03_snapshot.png', snap.toDataURL('image/png'));
    a.playback.stop();
  });
  const d3 = pixelDiff(`${OUT}/03_frame.png`, `${OUT}/03_snapshot.png`, `${OUT}/03_diff.png`);
  ok('验收3 renderFrame(2.0) ≡ evaluate(2.0) 后 snapshot(主机位, 1920×1080)', d3 < 0.005, `差异 ${(d3 * 100).toFixed(4)}%`);

  // ---- 验收 4 离线确定性 + 播放头 / 文档 / 撤销不变 ----
  await page.evaluate(() => window.__app.playback.seek(1.25)); // 导出前处于 active（暂停在 1.25 s）
  await settle();
  const before = await exportState();
  const runs = [];
  for (let run = 0; run < 2; run++) {
    const hashes = await page.evaluate(async (run) => {
      const a = window.__app;
      const { renderFrames, pixelsToCanvas } = await import('/src/app/VideoExporter.js');
      const out = [];
      await renderFrames(a, { width: 1280, height: 720, fps: 30, range: [0, 1] }, async (px, { i, width, height }) => {
        const url = pixelsToCanvas(px, width, height).toDataURL('image/png');
        out.push(url.length);
        await window.__saveFile(`frames/run${run}_${String(i).padStart(3, '0')}.png`, url);
      });
      return out.length;
    }, run);
    runs.push(hashes);
  }
  const files = (r) => fs.readdirSync(`${OUT}/frames`).filter((f) => f.startsWith(`run${r}_`)).sort();
  const h0 = files(0).map((f) => md5(fs.readFileSync(`${OUT}/frames/${f}`)));
  const h1 = files(1).map((f) => md5(fs.readFileSync(`${OUT}/frames/${f}`)));
  const same = h0.length === 30 && h0.every((h, i) => h === h1[i]);
  const moving = new Set(h0).size > 20; // 角色在走、机位在转：帧应各不相同
  ok('验收4 同一文档导出两次 30 帧 PNG 序列逐帧 md5 相同', same && moving, `帧数 ${runs.join('/')}，不同帧 ${new Set(h0).size}/30`);
  const after = await exportState();
  ok('验收4 导出后播放头回到导出前（时间 + active）、toDocument 不变、History 不变',
    after.active === before.active && after.time === before.time && after.doc === before.doc && after.hist === before.hist && after.idx === before.idx,
    `active ${before.active}→${after.active} t ${before.time}→${after.time} doc ${after.doc === before.doc} hist ${before.hist}/${before.idx}→${after.hist}/${after.idx}`);
  await page.evaluate(() => window.__app.playback.stop());
  const idleBefore = await exportState();
  await page.evaluate(async () => {
    const { renderFrames } = await import('/src/app/VideoExporter.js');
    await renderFrames(window.__app, { width: 320, height: 180, fps: 10, range: [0, 0.5] });
  });
  const idleAfter = await exportState();
  ok('验收4 导出前 idle → 导出后仍 idle、文档不变', !idleAfter.active && idleAfter.time === 0 && idleAfter.doc === idleBefore.doc, `active=${idleAfter.active} t=${idleAfter.time}`);

  // ---- 验收 1 / 2 名牌进画面、位置一致 ----
  const lab = await page.evaluate(async (ids) => {
    const a = window.__app;
    const { labelAnchor } = await import('/src/app/Labels.js');
    const cam = a.findCamera(a.timeline.mainCameraId);
    const W = 1920, H = 1080;
    const layer = document.getElementById('labelLayer');
    const m = a.findEntity(ids.m);
    /** 1080p 快照 + 角色 m 名牌锚点在画面里的像素坐标（与 DOM 名牌同一套 labelAnchor + project）。 */
    const shoot = (file) => {
      cam.cam.aspect = W / H; cam.cam.updateProjectionMatrix();
      const p = labelAnchor(m, a.stage.world.scale.y, m.root.position.clone()).project(cam.cam);
      const cv = a.withCleanRender(() => a.stage.snapshot(cam.cam, { width: W, height: H }));
      window.__saveFile(file, cv.toDataURL('image/png'));
      const ax = (p.x * 0.5 + 0.5) * W, ay = (-p.y * 0.5 + 0.5) * H;
      // 在锚点上方 0–90 px、左右 ±200 px 的窗口里找名牌的白底像素
      const x0 = Math.max(0, Math.round(ax - 200)), y0 = Math.max(0, Math.round(ay - 90));
      const w = Math.min(W - x0, 400), h = Math.min(H - y0, Math.round(ay) + 6 - y0);
      const px = cv.getContext('2d').getImageData(x0, y0, w, h).data;
      let n = 0, bottom = -1;
      const white = (i) => px[i] > 245 && px[i + 1] > 245 && px[i + 2] > 245;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (white((y * w + x) * 4)) { n++; bottom = Math.max(bottom, y); }
      let xmin = Infinity, xmax = -Infinity;
      const row = bottom - 6; // 底边上方 6 px：圆角已过，左右边界即名牌框宽
      if (row >= 0) for (let x = 0; x < w; x++) if (white((row * w + x) * 4)) { xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); }
      return { ax, ay, n, bx: x0 + (xmin + xmax + 1) / 2, by: y0 + bottom + 1, bw: xmax - xmin + 1 };
    };
    a.playback.stop();
    a.setLabelPreview(true);
    await new Promise((r) => setTimeout(r, 100));
    const on = shoot('01_labels_on.png');
    const onState = { dom: getComputedStyle(layer).display, sprites: a.labelSprites.group.children.length, vis: a.labelSprites.debugItem(m).visible };
    a.setLabelPreview(false);
    await new Promise((r) => setTimeout(r, 100));
    const offState = { dom: getComputedStyle(layer).display, sprites: a.labelSprites.group.children.length, groupVis: a.labelSprites.group.visible };
    a.setLabelsVisible(false);
    a.setLabelPreview(true);
    const hidden = shoot('01_labels_scene_off.png');
    const hiddenState = { dom: getComputedStyle(layer).display, groupVis: a.labelSprites.group.visible };
    a.setLabelPreview(false);
    a.setLabelsVisible(true);
    return { on, onState, offState, hidden, hiddenState };
  }, ids);
  ok('验收1 精灵名牌：快照里锚点上方采到名牌白底；DOM 名牌层隐藏',
    lab.on.n > 1500 && lab.onState.dom === 'none' && lab.onState.vis && lab.onState.sprites >= 2,
    `白底像素 ${lab.on.n}，DOM=${lab.onState.dom}，精灵 ${lab.onState.sprites}`);
  ok('验收1 关闭后 DOM 恢复、精灵移除；scene.labels=false 时两者都不显示',
    lab.offState.dom === 'block' && lab.offState.sprites === 0 && !lab.offState.groupVis && lab.hidden.n === 0 && lab.hiddenState.dom === 'none' && !lab.hiddenState.groupVis,
    `关闭：DOM=${lab.offState.dom} 精灵 ${lab.offState.sprites}；labels=false：白底 ${lab.hidden.n} DOM=${lab.hiddenState.dom}`);
  const dpos = Math.hypot(lab.on.bx - lab.on.ax, lab.on.by - lab.on.ay);
  ok('验收2 精灵名牌框底边中点 与 DOM 名牌锚点 差 < 4 px（1080p）', dpos < 4,
    `锚点 (${lab.on.ax.toFixed(1)}, ${lab.on.ay.toFixed(1)}) 名牌底 (${lab.on.bx.toFixed(1)}, ${lab.on.by}) 差 ${dpos.toFixed(2)} px，框宽 ${lab.on.bw}`);

  // ---- 验收 5 分辨率与比例 ----
  const sizes = await page.evaluate(async () => {
    const { exportSize, EXPORT_RESOLUTIONS } = await import('/src/app/VideoExporter.js');
    const { RATIO_OPTIONS } = await import('/src/config.js');
    const all = RATIO_OPTIONS.flatMap(([r]) => EXPORT_RESOLUTIONS.map((x) => ({ r, ...exportSize(r, x.short) })));
    return { v916: exportSize('9:16', 1080), auto: exportSize('auto', 1080), odd: all.filter((x) => x.width % 2 || x.height % 2), all };
  });
  ok('验收5 9:16 + 1080p → 1080×1920；auto → 1920×1080；全部比例 × 分辨率宽高均为偶数',
    sizes.v916.width === 1080 && sizes.v916.height === 1920 && sizes.auto.width === 1920 && sizes.auto.height === 1080 && !sizes.odd.length,
    `9:16=${sizes.v916.width}×${sizes.v916.height} auto=${sizes.auto.width}×${sizes.auto.height} 奇数 ${sizes.odd.length}/${sizes.all.length}`);

  // ---- 导出弹层（真实点击）----
  const dl = path.resolve(`${OUT}/downloads`);
  fs.mkdirSync(dl, { recursive: true });
  const bcdp = await browser.target().createCDPSession();
  await bcdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
  const openExport = async () => {
    await clickSel('#dock .dockbtn[title^="场景"]');
    await page.evaluate(() => [...document.querySelectorAll('#dock .dockmenu.open .menu-item')].find((n) => n.textContent.includes('导出视频')).click());
    await page.waitForSelector('.export-box');
    await settle();
  };
  const setField = (name, value) => page.evaluate((name, value) => {
    const n = document.querySelector(`.export-box [data-name="${name}"]`);
    if (n.type === 'checkbox') n.checked = value; else n.value = String(value);
    n.dispatchEvent(new Event('change'));
  }, name, value);
  const boxClip = () => page.$eval('.export-box', (n) => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
  await page.evaluate(() => { window.__app.setRatio('9:16'); });
  await openExport();
  const resLabel = await page.$eval('.export-box [data-name="res"]', (s) => s.selectedOptions[0].textContent);
  await page.evaluate(() => window.__exportModal.close());
  await page.evaluate(() => { window.__app.setRatio('auto'); });
  ok('验收5 弹层分辨率显示随取景比例（9:16 1080p）', resLabel.includes('1080×1920'), resLabel);

  // ---- 验收 6 MP4 文件：3 s · 30 fps · 1080p（弹层导出 + 自动下载）----
  await openExport();
  await setField('res', 1080);
  await setField('fps', 30);
  await setField('range', 'custom');
  await setField('t0', 0);
  await setField('t1', 3);
  const est = await page.$eval('.export-box .ex-est', (n) => n.textContent);
  const camLine = await page.$eval('.export-box .ex-cam', (n) => n.textContent);
  await page.screenshot({ path: `${OUT}/11_modal.png`, clip: await boxClip() });
  const hist0 = await page.evaluate(() => window.__app.history.entries.length);
  await clickSel('.export-box .ex-start');
  await page.waitForFunction(() => { const t = document.querySelector('.export-box .ex-ptext')?.textContent || ''; const m = /帧 (\d+)\/(\d+)/.exec(t); return m && +m[1] >= +m[2] * 0.3; }, { timeout: 120000 });
  const locked = await page.evaluate(() => ({ body: document.body.classList.contains('exporting'), tl: getComputedStyle(document.getElementById('timeline')).pointerEvents, dock: getComputedStyle(document.getElementById('dock')).opacity }));
  await page.screenshot({ path: `${OUT}/11_progress.png` });
  await page.waitForFunction(() => !document.querySelector('.export-box'), { timeout: 300000 });
  const mp4Name = '未命名场景_1920x1080_30fps.mp4';
  const done = () => fs.existsSync(path.join(dl, mp4Name)) && fs.statSync(path.join(dl, mp4Name)).size > 0 && !fs.readdirSync(dl).some((f) => f.endsWith('.crdownload'));
  for (let i = 0; i < 100 && !done(); i++) await sleep(100);
  const mp4Path = path.join(dl, mp4Name);
  const exists = fs.existsSync(mp4Path);
  const size = exists ? fs.statSync(mp4Path).size : 0;
  ok('弹层：机位行显示主机位、估算 90 帧 3 s；导出中界面锁住', camLine.includes('主机位') && est.includes('90 帧') && est.includes('3 s') && locked.body && locked.tl === 'none',
    `${camLine} | ${est} | ${JSON.stringify(locked)}`);
  ok('验收6 MP4 文件存在且 ≥ 100 KB（自动下载，文件名 名称_宽x高_fps）', exists && size >= 100 * 1024, `${mp4Name} ${(size / 1024).toFixed(0)} KB`);
  if (exists) {
    const box = mp4Info(fs.readFileSync(mp4Path));
    ok('验收6 mp4 盒子解析（mvhd / tkhd / stsz / avc1）：3.00 s、90 帧、avc1、1920×1080',
      Math.abs(box.duration - 3) <= 0.05 && box.frames === 90 && box.codec === 'avc1' && box.width === 1920 && box.height === 1080, JSON.stringify(box));
    const fp = ffprobe(mp4Path);
    if (fp) ok('验收6 ffprobe：3.00 ± 0.05 s、90 帧、h264、1920×1080',
      Math.abs(fp.duration - 3) <= 0.05 && fp.frames === 90 && fp.codec === 'h264' && fp.width === 1920 && fp.height === 1080, JSON.stringify(fp));
    else console.log('ℹ️  本机无 ffprobe：验收6 只用 mp4 盒子解析器验证');
  }
  const hist1 = await page.evaluate(() => window.__app.history.entries.length);
  ok('导出不记撤销', hist1 === hist0, `${hist0}→${hist1}`);

  // ---- 验收 7 取消 ----
  await page.evaluate(() => window.__app.playback.seek(0.75));
  const cBefore = await exportState();
  const filesBefore = fs.readdirSync(dl).length;
  const errsBefore = errs.length;
  await openExport();
  await setField('res', 720);
  await setField('range', 'all');
  await clickSel('.export-box .ex-start');
  await page.waitForFunction(() => { const t = document.querySelector('.export-box .ex-ptext')?.textContent || ''; const m = /帧 (\d+)\/(\d+)/.exec(t); return m && +m[1] >= +m[2] * 0.3; }, { timeout: 120000 });
  const at = await page.$eval('.export-box .ex-ptext', (n) => n.textContent);
  await page.keyboard.press('Escape'); // Esc = 取消
  await page.waitForFunction(() => !window.__app.exporting, { timeout: 30000 });
  await sleep(800);
  const cAfter = await exportState();
  const ui7 = await page.evaluate(() => ({ body: document.body.classList.contains('exporting'), start: !document.querySelector('.export-box .ex-start').hidden, tl: getComputedStyle(document.getElementById('timeline')).pointerEvents }));
  ok('验收7 导出到 30% 取消：无文件、播放头恢复、UI 解锁、无 console 错误',
    fs.readdirSync(dl).length === filesBefore && cAfter.time === cBefore.time && cAfter.active === cBefore.active && cAfter.doc === cBefore.doc
      && !ui7.body && ui7.start && ui7.tl !== 'none' && errs.length === errsBefore,
    `取消于「${at}」，文件 ${filesBefore}→${fs.readdirSync(dl).length}，t ${cBefore.time}→${cAfter.time}，UI ${JSON.stringify(ui7)}`);
  await page.evaluate(() => window.__exportModal.close());
  await page.evaluate(() => window.__app.playback.stop());

  // ---- 验收 8 不支持的浏览器 ----
  const unsup = await page.evaluate(async () => {
    window.__VE = window.VideoEncoder;
    window.VideoEncoder = undefined;
    document.querySelector('#dock .dockbtn[title^="场景"]').click();
    const item = [...document.querySelectorAll('#dock .dockmenu.open .menu-item')].find((n) => n.textContent.includes('导出视频'));
    const greyed = item.classList.contains('unsupported');
    item.click();
    const t = document.getElementById('toast').textContent;
    const noModal = !document.querySelector('.export-box');
    window.__exportModal.open();
    await new Promise((r) => setTimeout(r, 50));
    const btn = document.querySelector('.export-box .ex-start').disabled;
    const hint = document.querySelector('.export-box .ex-unsup');
    const res = { greyed, toast: t, noModal, btnDisabled: btn, hint: hint.hidden ? '' : hint.textContent };
    window.__exportModal.close();
    window.VideoEncoder = window.__VE;
    return res;
  });
  ok('验收8 window.VideoEncoder = undefined → 菜单项置灰 + 提示、弹层「开始导出」禁用',
    unsup.greyed && unsup.toast.includes('Chrome 或 Edge') && unsup.noModal && unsup.btnDisabled && unsup.hint.includes('Chrome 或 Edge'), JSON.stringify(unsup));

  // ---- 验收 9 导出帧干净：选中走路角色（gizmo + 选中环 + 路径线）、导演视角（机位视锥）----
  const clean = await page.evaluate(async (ids) => {
    const a = window.__app;
    const { renderFrame } = await import('/src/app/VideoExporter.js');
    const W = 960, H = 540;
    a.playback.stop();
    a.setCameraView(false);
    const plain = (await renderFrame(a, 1.0, { width: W, height: H })).toDataURL('image/png');
    a.select(ids.m);
    a.addCamera('side_track'); // 另一个机位（视锥在主机位画面里）
    a.select(ids.m);
    await new Promise((r) => setTimeout(r, 100));
    const shown = { gizmo: a.gizmo._helper.visible, ring: a.selection.ring.visible, path: a.pathOverlay.visible };
    const fr = await renderFrame(a, 1.0, { width: W, height: H });
    // 在路径线 / gizmo / 选中环应出现的屏幕位置采样：不含 accent 蓝、gizmo 红
    const cam = a.findCamera(a.timeline.mainCameraId).cam;
    cam.aspect = W / H; cam.updateProjectionMatrix();
    a.timeline.evaluate(1.0);
    const m = a.findEntity(ids.m);
    const pts = [];
    const path = a.timeline.toJSON().paths.find((p) => p.target === ids.m);
    const P = (x, y, z) => a.stage.world.localToWorld(m.root.position.clone().set(x, y, z));
    for (let i = 0; i <= 10; i++) {
      const [p0, p1] = path.points;
      pts.push(P(p0[0] + (p1[0] - p0[0]) * i / 10, 0.01, p0[2] + (p1[2] - p0[2]) * i / 10));
    }
    const foot = m.root.getWorldPosition(m.root.position.clone());
    pts.push(foot.clone(), foot.clone().add({ x: 0.5, y: 0, z: 0 }), foot.clone().add({ x: 0, y: 0, z: 0.5 }), foot.clone().add({ x: 0, y: 0.5, z: 0 }));
    const g = fr.getContext('2d');
    let bad = 0, sampled = 0;
    for (const p of pts) {
      const q = p.project(cam);
      if (Math.abs(q.x) > 1 || Math.abs(q.y) > 1 || q.z > 1) continue;
      const x = Math.round((q.x * 0.5 + 0.5) * W), y = Math.round((-q.y * 0.5 + 0.5) * H);
      const d = g.getImageData(Math.max(0, x - 3), Math.max(0, y - 3), 7, 7).data;
      sampled++;
      for (let i = 0; i < d.length; i += 4) {
        const [r, gg, b] = [d[i], d[i + 1], d[i + 2]];
        if ((b > 200 && r < 120 && gg > 90 && gg < 190) || (r > 200 && gg < 90 && b < 90)) bad++;
      }
    }
    a.playback.stop();
    window.__saveFile('09_clean_frame.png', fr.toDataURL('image/png'));
    return { shown, sampled, bad, same: fr.toDataURL('image/png') === plain };
  }, ids);
  ok('验收9 导出帧里没有 gizmo / 选中环 / 视锥 / 路径线（采样无 accent 蓝 / 红；与未选中时的帧逐像素相同）',
    clean.shown.gizmo && clean.shown.ring && clean.shown.path && clean.sampled >= 8 && clean.bad === 0 && clean.same, JSON.stringify(clean));
  const after9 = await page.evaluate(() => ({ gizmo: window.__app.gizmo._helper.visible, ring: window.__app.selection.ring.visible, path: window.__app.pathOverlay.visible }));
  ok('导出结束后 gizmo / 选中环 / 路径 overlay 恢复显示', after9.gizmo && after9.ring && after9.path, JSON.stringify(after9));

  // ---- 验收 11 示例：5 s · 1080p MP4（不入库）----
  const sample = await page.evaluate(async () => {
    const a = window.__app;
    a.select(null);
    const { exportVideo } = await import('/src/app/VideoExporter.js');
    const t = performance.now();
    const out = await exportVideo(a, { width: 1920, height: 1080, fps: 30, range: [0, 5] });
    const url = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(out.blob); });
    await window.__saveFile('sample.mp4', url);
    return { ms: Math.round(performance.now() - t), size: out.blob.size, frames: out.frames };
  });
  const sp = ffprobe(`${OUT}/sample.mp4`) || mp4Info(fs.readFileSync(`${OUT}/sample.mp4`));
  ok('验收11 示例 sample.mp4：5 s · 1080p · 150 帧', sample.frames === 150 && Math.abs(sp.duration - 5) <= 0.05 && sp.frames === 150 && sp.width === 1920,
    `${(sample.size / 1048576).toFixed(2)} MB，用时 ${(sample.ms / 1000).toFixed(1)} s（headless swiftshader），${JSON.stringify(sp)}`);

  // ---- 收尾 1 · 名牌避让（DOM 与精灵同一个 layoutLabels）----
  const rectsHit = (rs) => rs.some((a, i) => rs.some((b, j) => j > i && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
  // 无重叠：导出场景（两人左右分开）避让开 / 关两次快照逐像素相同、DOM 位置相同
  const noOv = await page.evaluate(async () => {
    const a = window.__app;
    const { labelLayout } = await import('/src/app/Labels.js');
    const cam = a.findCamera(a.timeline.mainCameraId);
    a.playback.stop();
    const shot = () => { cam.cam.aspect = 16 / 9; cam.cam.updateProjectionMatrix(); return a.withCleanRender(() => a.stage.snapshot(cam.cam, { width: 1280, height: 720 })).toDataURL('image/png'); };
    const dom = () => { a.labels.update(a.entities, a.getRenderCamera(), { worldScale: a.stage.world.scale.y, hideCameras: a.cameraView }); return JSON.stringify(a.labels.debugRects()); };
    const on = shot(), domOn = dom();
    labelLayout.enabled = false;
    const off = shot(), domOff = dom();
    labelLayout.enabled = true;
    return { same: on === off, domSame: domOn === domOff, n: JSON.parse(domOn).length };
  });
  ok('名牌避让：无重叠时 快照（避让开 / 关）逐像素相同、DOM 名牌位置相同', noOv.same && noOv.domSame && noOv.n >= 2, JSON.stringify(noOv));
  // 前后站成一线：截图 / DOM 两处名牌矩形都不相交（关掉避让时相交）
  const ov = await page.evaluate(async () => {
    const { createEmptyDocument } = await import('/src/doc/schema.js');
    const { labelLayout } = await import('/src/app/Labels.js');
    const a = window.__app;
    a.playback.stop();
    await a.loadDocument(createEmptyDocument());
    const near = await a.addCharacter('male');
    const far = await a.addCharacter('female');
    near.root.position.x = 0; near.root.position.z = 0;
    far.root.position.x = 0.15; far.root.position.z = -2.5;
    const c = a.addCamera('front_full');
    const w = (x, y, z) => a.stage.world.localToWorld(near.root.position.clone().set(x, y, z));
    // 机位与名牌锚点同高、平视：两人名牌落在同一水平线上，必然叠在一起
    const { labelAnchor } = await import('/src/app/Labels.js');
    const hy = a.stage.world.worldToLocal(labelAnchor(near, a.stage.world.scale.y, near.root.position.clone())).y;
    c.root.position.copy(a.stage.world.worldToLocal(w(0, hy, 5)));
    c.aimAt(w(0, hy, -1));
    a.select(null);
    a.rig.controls.target.copy(w(0, hy, -1)); a.stage.camera.position.copy(w(0, hy, 5)); a.rig.controls.update();
    await new Promise((r) => setTimeout(r, 300));
    const W = 1920, H = 1080;
    const res = {};
    for (const on of [false, true]) {
      labelLayout.enabled = on;
      c.cam.aspect = W / H; c.cam.updateProjectionMatrix();
      const cv = a.withCleanRender(() => {
        const out = a.stage.snapshot(c.cam, { width: W, height: H });
        res[on ? 'sprite' : 'spriteOff'] = a.labelSprites.debugRects(c.cam, W, H);
        return out;
      });
      await window.__saveFile(on ? '20_labels_overlap.png' : '20_labels_overlap_off.png', cv.toDataURL('image/png'));
      a.labels.update(a.entities, a.getRenderCamera(), { worldScale: a.stage.world.scale.y, hideCameras: a.cameraView });
      res[on ? 'dom' : 'domOff'] = a.labels.debugRects().filter((r) => !r.text.startsWith('机位'));
    }
    labelLayout.enabled = true;
    a.stage.invalidate();
    res.far = far.name;
    return res;
  });
  await page.screenshot({ path: `${OUT}/20_labels_overlap_viewport.png` });
  const sum = (rs) => rs.map((r) => `${r.text}@(${r.x.toFixed(0)},${r.y.toFixed(0)} ${r.w.toFixed(0)}×${r.h.toFixed(0)})`).join(' ');
  ok('名牌避让：前后站位 —— 关避让时精灵 / DOM 名牌相交（构造有效）', rectsHit(ov.spriteOff) && rectsHit(ov.domOff), `精灵 ${sum(ov.spriteOff)}；DOM ${sum(ov.domOff)}`);
  const farUp = (rs) => rs.length === 2 && rs.find((r) => r.text === ov.far).y < rs.find((r) => r.text !== ov.far).y;
  ok('名牌避让：前后站位 —— 截图（精灵）与视口（DOM）名牌矩形都不相交，远的在上', farUp(ov.sprite) && farUp(ov.dom) && !rectsHit(ov.sprite) && !rectsHit(ov.dom),
    `精灵 ${sum(ov.sprite)}；DOM ${sum(ov.dom)}；截图 ${OUT}/20_labels_overlap.png`);
}

/** ffprobe 读时长 / 帧数 / 编码 / 宽高；本机没有 ffprobe 返回 null。 */
function ffprobe(file) {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries',
      'stream=codec_name,width,height,nb_read_frames:format=duration', '-of', 'json', file], { encoding: 'utf8' });
    const j = JSON.parse(out);
    const st = j.streams[0];
    return { duration: +j.format.duration, frames: +st.nb_read_frames, codec: st.codec_name, width: st.width, height: st.height };
  } catch { return null; }
}

/** 最小 mp4 盒子解析：mvhd 时长、首个视频轨 tkhd 宽高、stsd 编码、stsz 帧数。 */
function mp4Info(buf) {
  const out = {};
  const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);
  const walk = (start, end) => {
    for (let p = start; p + 8 <= end;) {
      let size = buf.readUInt32BE(p);
      const type = buf.toString('latin1', p + 4, p + 8);
      let hdr = 8;
      if (size === 1) { size = Number(buf.readBigUInt64BE(p + 8)); hdr = 16; }
      if (size < hdr) break;
      const body = p + hdr;
      if (CONTAINERS.has(type)) walk(body, p + size);
      else if (type === 'mvhd') {
        const v = buf[body];
        const ts = v === 1 ? buf.readUInt32BE(body + 20) : buf.readUInt32BE(body + 12);
        const du = v === 1 ? Number(buf.readBigUInt64BE(body + 24)) : buf.readUInt32BE(body + 16);
        out.duration = du / ts;
      } else if (type === 'tkhd' && out.width == null) {
        const v = buf[body];
        const off = body + (v === 1 ? 88 : 76);
        out.width = buf.readUInt32BE(off) / 65536;
        out.height = buf.readUInt32BE(off + 4) / 65536;
      } else if (type === 'stsd' && !out.codec) out.codec = buf.toString('latin1', body + 12, body + 16);
      else if (type === 'stsz' && out.frames == null) out.frames = buf.readUInt32BE(body + 8);
      p += size;
    }
  };
  walk(0, buf.length);
  return out;
}

// ---- 阶段 H：AI 生成（全部用 MockProvider，不依赖网络）----
// 预录回复：按用户输入里的关键字命中（MockProvider 只匹配「用户：」之后的输入）。
// 函数声明（会提升）：子命令在文件前部的顶层 await 里就会调用 aiTest
function aiInputs() { return { gen: '两个人在广场对话，一个女的站着挥手，一个男的坐着，一个机位半环绕拍他们，5 秒', mod: '让男的站起来走到女的旁边，机位改成推' }; }
function aiFixturesSrc() {
  return `({
  gen: { ops: [
    { op: 'clear' },
    { op: 'scene', sky: '#6f8fb0', ground: { visible: true, height: 0 } },
    { op: 'add_character', name: '小红', body: 'female', pos: [-0.8, 0, 0], yaw: 90, pose: 'wave' },
    { op: 'add_character', name: '小王', body: 'male', pos: [0.8, 0, 0.1], yaw: -90, pose: 'sit' },
    { op: 'add_camera', name: '机位1', pos: [0, 1.4, 3.6], lookAt: [0, 0.8, 0] },
    { op: 'camera_move', target: '机位1', preset: 'half_orbit', subject: [0, 0.8, 0], duration: 5 },
    { op: 'timeline', duration: 5, mainCamera: '机位1' },
  ], note: '小红站着挥手、小王坐着，两人面对面；机位1 绕两人中点半环绕 5 秒' },
  mod: { ops: [
    { op: 'set_pose', target: '小王', preset: 'stand' },
    { op: 'set_path', target: '小王', path: { kind: 'toward', target: '小红' } },
    { op: 'clear_moves', target: '机位1' },
    { op: 'camera_move', target: '机位1', preset: 'push_in', subject: '小红' },
  ], note: '小王站起来走到小红旁边 0.8 m 处；机位1 改为推近小红' },
})`;
}

async function aiSend(mode, text, { confirm = true } = {}) {
  await page.click(`.ai-mode[data-mode="${mode}"]`);
  await page.$eval('.ai-text', (t) => { t.value = ''; });
  if (text) await page.type('.ai-text', text);
  await page.focus('.ai-text');
  await page.keyboard.press('Enter');
  await sleep(80);
  if (confirm && await page.$('#toast.show .toast-action')) await toastClick('清空并生成');
  await page.waitForFunction(() => !window.__app.ai.busy, { timeout: 30000 });
  await settle(150);
  return page.evaluate(() => { const t = window.__app.ai.turns.at(-1); return { status: t.status, attempts: t.attempts.length, errors: t.attempts.at(-1).errors, result: t.result, mode: t.mode }; });
}

/** 文档指纹（不含 updatedAt / 导演视角）+ 撤销栈长度。 */
function aiState() {
  return page.evaluate(() => {
    const a = window.__app;
    const d = a.toDocument({ view: false });
    d.meta.updatedAt = null;
    return { doc: JSON.stringify(d), hist: a.history.entries.length, idx: a.history.index };
  });
}

async function aiPanelShot(file) {
  const clip = await page.$eval('.ai-drawer', (n) => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
  await page.screenshot({ path: file, clip });
}

async function aiTest() {
  const OUT = 'test-output/ai';
  const { gen: AI_GEN_INPUT, mod: AI_MOD_INPUT } = aiInputs();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await settle(200);

  // Mock：生成 / 修改 / 校验回路 / 永远失败 / 重名 / 删不存在 / 识图 / 识图越权
  await page.evaluate(async (FX) => {
    const { MockProvider } = await import('/src/ai/provider.js');
    const fx = eval(FX);
    const snap = () => { const d = window.__app.toDocument({ view: false }); d.meta.updatedAt = null; return JSON.stringify(d); };
    const BAD = JSON.parse(JSON.stringify(fx.gen));
    BAD.ops[5].preset = 'orbit';
    BAD.ops[3].pos = [0.8, 0];
    window.__aiMock = new MockProvider([
      { match: '广场对话', reply: fx.gen },
      { match: '男的站起来', reply: fx.mod },
      { match: '校验回路', reply: (msgs, n) => { if (n === 1) window.__snapAtRetry = snap(); return n === 0 ? BAD : fx.gen; } },
      { match: '永远失败', reply: BAD },
      { match: '两个阿明', reply: { ops: [
        { op: 'add_character', name: '阿明', body: 'male', pos: [2, 0, 2] },
        { op: 'add_character', name: '阿明', body: 'slim', pos: [3, 0, 2] },
      ], note: '加了两个阿明' } },
      { match: '删掉老张', reply: { ops: [{ op: 'remove', target: '老张' }], note: '删老张' } },
      { match: '照图摆位', reply: { ops: [
        { op: 'clear' },
        { op: 'add_character', name: '红', body: 'female', pos: [-1.5, 0, 0], yaw: 90 },
        { op: 'add_character', name: '绿', body: 'male', pos: [0, 0, -0.5], yaw: 0 },
        { op: 'add_character', name: '蓝', body: 'male', pos: [1.5, 0, 0], yaw: -90 },
        { op: 'add_camera', name: '机位1', pos: [0, 1.4, 3.5], lookAt: '绿' },
      ], note: '按图摆了 3 个人，机位在正前方' } },
      { match: '还要走动', reply: { ops: [{ op: 'set_path', target: '红', path: { kind: 'line', to: [0, 0, 2] } }], note: '红走过来' } },
    ], { delayMs: 30 });
    window.__app.ai.setProvider(window.__aiMock);
    window.__aiPanel.toggle(true);
  }, aiFixturesSrc());
  await settle(200);
  await aiPanelShot(`${OUT}/panel_empty.png`);

  // ---- 验收 1 一句话生成 ----
  const h0 = (await aiState()).hist;
  const r1 = await aiSend('generate', AI_GEN_INPUT);
  const g = await page.evaluate(async () => {
    const a = window.__app;
    const { aimPoint } = await import('/src/anim/Constraint.js');
    const doc = a.toDocument({ view: false });
    const by = (n) => doc.entities.find((e) => e.name === n);
    const cam = by('机位1');
    a.playback.seek(2.5);
    const c = a.findCamera(cam.id);
    c.root.updateMatrixWorld(true);
    c.cam.updateMatrixWorld(true);
    const inFrame = ['小红', '小王'].map((n) => {
      const p = a.stage.world.localToWorld(aimPoint(a, by(n).id).clone()).project(c.cam);
      return Math.abs(p.x) < 0.95 && Math.abs(p.y) < 0.95 && p.z < 1;
    });
    return {
      n: doc.entities.length, poses: [by('小红').pose.preset, by('小王').pose.preset],
      camPath: doc.paths.some((p) => p.target === cam.id), lookAt: doc.constraints.some((k) => k.target === cam.id && k.type === 'lookAt'),
      duration: doc.timeline.duration, main: doc.timeline.mainCameraId === cam.id, inFrame, camId: cam.id,
    };
  });
  await camShot(g.camId, `${OUT}/gen_t2.5.png`);
  await page.evaluate(() => window.__app.playback.stop());
  await shootViewport(`${OUT}/gen_viewport.png`);
  ok('验收 1 一句话生成：3 实体 / 挥手 + 坐 / 机位路径 + 注视 / 时长 5 / 一步撤销',
    r1.status === 'ok' && g.n === 3 && g.poses.join() === 'wave,sit' && g.camPath && g.lookAt && g.duration === 5 && g.main && (await aiState()).hist === h0 + 1,
    JSON.stringify({ r1: r1.status, ...g, camId: undefined }));
  ok('验收 1 t=2.5 s 主机位画面两人都入画（gen_t2.5.png）', g.inFrame.every(Boolean), JSON.stringify(g.inFrame));

  // ---- 验收 4 修改模式（在验收 1 的场景上）----
  const before4 = await aiState();
  const pre = await page.evaluate(() => JSON.stringify(window.__app.toDocument({ view: false }).entities.find((e) => e.name === '小红')));
  const r4 = await aiSend('modify', AI_MOD_INPUT);
  const m = await page.evaluate(async () => {
    const a = window.__app;
    const { cameraMove } = await import('/src/anim/cameraMoves.js');
    const { aimPoint } = await import('/src/anim/Constraint.js');
    const doc = a.toDocument({ view: false });
    const by = (n) => doc.entities.find((e) => e.name === n);
    const red = by('小红'), wang = by('小王'), cam = by('机位1');
    const wp = doc.paths.find((p) => p.target === wang.id);
    const end = wp.points[wp.points.length - 1];
    const cp = doc.paths.find((p) => p.target === cam.id);
    const expect = cameraMove('push_in', { position: cam.transform.pos, aim: aimPoint(a, red.id).toArray() }).points;
    return {
      dist: Math.hypot(end[0] - red.transform.pos[0], end[2] - red.transform.pos[2]),
      pose: wang.pose.preset, push: JSON.stringify(cp.points) === JSON.stringify(expect),
      looks: doc.constraints.filter((c) => c.target === cam.id).map((c) => c.subject === red.id),
      red: JSON.stringify(red),
    };
  });
  ok('验收 4 修改：小王站立、路径终点距小红 0.8 m、运镜 = push_in、小红未动',
    r4.status === 'ok' && r4.mode === 'modify' && Math.abs(m.dist - 0.8) < 1e-4 && m.pose === 'stand' && m.push && m.looks.join() === 'true' && m.red === pre,
    JSON.stringify({ ...m, red: m.red === pre }));
  await aiPanelShot(`${OUT}/panel_modify.png`);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta');
  await page.waitForFunction(() => !window.__app.loadingDocument, { timeout: 30000 });
  await settle(300);
  const after4 = await aiState();
  ok('验收 4 ⌘Z 一次回到修改前（文档逐字节相等）', after4.doc === before4.doc && after4.idx === before4.idx, `idx ${before4.idx} → ${after4.idx}`);

  // ---- 验收 2 校验回路 ----
  const before2 = await aiState();
  const r2 = await aiSend('generate', '校验回路：' + AI_GEN_INPUT.replace('广场对话', '对话'));
  const v2 = await page.evaluate((s0) => {
    const calls = window.__aiMock.calls;
    const last = calls[calls.length - 1];
    const msg = last[last.length - 1].content;
    return {
      msg, posErr: msg.includes('ops[3].pos 应为 [x, y, z] 三个数，实际为 [0.8,0]'), presetErr: msg.includes('ops[5].preset 未知运镜 "orbit"'),
      unchangedAtRetry: window.__snapAtRetry === s0,
    };
  }, before2.doc);
  const after2 = await aiState();
  ok('验收 2 校验回路：第 1 次坏（未知运镜 + pos 缺分量）→ 第 2 次成功', r2.status === 'ok' && r2.attempts === 2 && after2.idx === before2.idx + 1 && after2.hist === after2.idx + 1, JSON.stringify({ status: r2.status, attempts: r2.attempts, idx: `${before2.idx} → ${after2.idx}` }));  // 之前 ⌘Z 留下的重做分支被这一步截掉
  ok('验收 2 第 2 次请求带两条错误原文（ops[i].字段）且失败那次场景不变', v2.posErr && v2.presetErr && v2.unchangedAtRetry, v2.msg.split('\n').slice(1, 3).join(' | '));
  await aiPanelShot(`${OUT}/panel_retry.png`);

  // ---- 验收 3 三次失败 ----
  const before3 = await aiState();
  const r3 = await aiSend('modify', '永远失败的请求');
  const toast3 = await page.$eval('#toast', (t) => ({ show: t.classList.contains('show'), text: t.textContent }));
  const after3 = await aiState();
  ok('验收 3 三次失败：toast 出现、文档逐字节相等、撤销栈不变',
    r3.status === 'failed' && r3.attempts === 3 && toast3.show && toast3.text.includes('AI 生成失败') && after3.doc === before3.doc && after3.hist === before3.hist && after3.idx === before3.idx,
    JSON.stringify({ status: r3.status, attempts: r3.attempts, toast: toast3.text.split('\n')[0] }));
  await aiPanelShot(`${OUT}/panel_failed.png`);

  // ---- 验收 5 名字 ----
  const r5 = await aiSend('modify', '加两个阿明');
  const r5b = await aiSend('modify', '删掉老张');
  const names5 = await page.evaluate(() => window.__app.entities.map((e) => e.name));
  ok('验收 5 重名第二个自动改名并出现在回执 renames', r5.status === 'ok' && r5.result.renames['阿明'] === '阿明2' && names5.includes('阿明') && names5.includes('阿明2'), JSON.stringify(r5.result?.renames));
  ok('验收 5 remove 不存在的名字 → 定位错误', r5b.status === 'failed' && r5b.errors[0].startsWith('ops[0].target 引用的实体不存在："老张"'), r5b.errors[0]);

  // ---- 验收 6 识图 ----
  // 合成图：白底 3 个色块代表站位（红 / 绿 / 蓝）
  const png = new PNG({ width: 1600, height: 900 });
  for (let y = 0; y < 900; y++) for (let x = 0; x < 1600; x++) {
    const i = (y * 1600 + x) * 4;
    let c = [255, 255, 255];
    if (y > 300 && y < 700) { if (x > 250 && x < 450) c = [220, 40, 40]; else if (x > 700 && x < 900 && y > 250) c = [40, 180, 60]; else if (x > 1150 && x < 1350) c = [40, 80, 220]; }
    png.data[i] = c[0]; png.data[i + 1] = c[1]; png.data[i + 2] = c[2]; png.data[i + 3] = 255;
  }
  fs.writeFileSync(`${OUT}/stance.png`, PNG.sync.write(png));
  await page.click('.ai-mode[data-mode="image"]');
  const fileInput = await page.$('.ai-imgrow input[type=file]');
  await fileInput.uploadFile(`${OUT}/stance.png`);
  await page.waitForSelector('.ai-imgprev img', { timeout: 10000 });
  await aiPanelShot(`${OUT}/panel_image.png`);
  const r6 = await aiSend('image', '照图摆位，机位从正前方拍');
  const v6 = await page.evaluate(() => {
    const calls = window.__aiMock.calls;
    const user = calls[calls.length - 1].find((m) => m.role === 'user');
    const img = Array.isArray(user.content) && user.content.find((p) => p.type === 'image_url');
    const doc = window.__app.toDocument({ view: false });
    return {
      img: img ? img.image_url.url.slice(0, 23) : null,
      chars: doc.entities.filter((e) => e.type === 'character').map((e) => [e.name, e.pose.preset]),
      cams: doc.entities.filter((e) => e.type === 'camera').length,
    };
  });
  const imgSize = await page.evaluate(() => new Promise((res) => {
    const calls = window.__aiMock.calls;
    const url = calls[calls.length - 1].find((m) => m.role === 'user').content[1].image_url.url;
    const im = new Image(); im.onload = () => res([im.naturalWidth, im.naturalHeight]); im.src = url;
  }));
  ok('验收 6 识图：图片以 data URL 发给模型（压到 1024 px）、3 个站立角色 + 1 机位',
    r6.status === 'ok' && v6.img === 'data:image/jpeg;base64,' && Math.max(...imgSize) === 1024 && v6.chars.length === 3 && v6.chars.every(([, p]) => p === 'stand') && v6.cams === 1,
    JSON.stringify({ ...v6, imgSize }));
  await shootViewport(`${OUT}/image_viewport.png`);
  const before6 = await aiState();
  const fileInput2 = await page.$('.ai-imgrow input[type=file]');
  await fileInput2.uploadFile(`${OUT}/stance.png`);
  await page.waitForSelector('.ai-imgprev img', { timeout: 10000 });
  const r6b = await aiSend('image', '还要走动');
  const after6 = await aiState();
  ok('验收 6 识图模式下 set_path 被拒绝（说明该模式不允许）、场景不变',
    r6b.status === 'failed' && r6b.errors[0].startsWith('ops[0].op 识图模式不允许 "set_path"') && after6.doc === before6.doc,
    r6b.errors[0]);

  // ---- 验收 7 词汇表一致 ----
  const v7 = await page.evaluate(async () => {
    const { VOCAB, MOVE_PARAM_KEYS } = await import('/src/ai/vocab.js');
    const { OP_NAMES } = await import('/src/ai/ops.js');
    const { systemPrompt } = await import('/src/ai/prompt.js');
    const { BODY_TYPES, PROP_KINDS } = await import('/src/config.js');
    const { POSE_PRESET_MAP } = await import('/src/entities/posePresets.js');
    const { CAMERA_MOVES } = await import('/src/anim/cameraMoves.js');
    const { PATH_MODES } = await import('/src/app/PathTool.js');
    const S = await import('/src/doc/schema.js');
    const eq = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
    const sets = {
      body: eq(VOCAB.body, Object.keys(BODY_TYPES)), prop: eq(VOCAB.prop, PROP_KINDS.map(([k]) => k)), pose: eq(VOCAB.pose, Object.keys(POSE_PRESET_MAP)),
      move: eq(VOCAB.move, CAMERA_MOVES.map(([k]) => k)), pathKind: eq(VOCAB.pathKind, PATH_MODES.map(([k]) => k).filter((k) => k !== 'freehand')),
      ease: eq(VOCAB.ease, S.EASES), speed: eq(VOCAB.speed, S.PATH_SPEEDS), orient: eq(VOCAB.orient, S.PATH_ORIENTS),
    };
    const p = systemPrompt();
    const missing = [...Object.values(VOCAB).flat(), ...MOVE_PARAM_KEYS, ...OP_NAMES].filter((w) => !p.includes(w));
    return { sets, missing };
  });
  ok('验收 7 词汇表 ≡ 代码枚举（姿势 / 体型 / 道具 / 运镜 / 路径 kind / ease / speed / orient），提示词含每个词',
    Object.values(v7.sets).every(Boolean) && !v7.missing.length, JSON.stringify(v7));

  // ---- 设置 / 隐私 ----
  const v8 = await page.evaluate(async () => {
    const p = window.__aiPanel;
    p.showSettings = true; p.render();
    const set = (name, v) => { const i = document.querySelector(`.ai-field[data-name="${name}"]`); i.value = v; i.dispatchEvent(new Event('input')); };
    set('baseURL', 'https://example.invalid/v1'); set('apiKey', 'sk-selftest-not-a-real-key'); set('model', 'demo-model');
    [...document.querySelectorAll('.ai-frow-btns .minibtn')].find((b) => b.textContent === '保存').click();
    const stored = JSON.parse(localStorage.getItem('director-stage.ai'));
    const docHasKey = JSON.stringify(window.__app.toDocument()).includes('sk-selftest');
    window.__app.ai.setProvider(window.__aiMock); // 截图后恢复 Mock，不发真实请求
    return { stored: stored.model === 'demo-model' && stored.apiKey === 'sk-selftest-not-a-real-key', docHasKey, pwd: document.querySelector('.ai-field[data-name="apiKey"]').type };
  });
  await settle(100);
  await aiPanelShot(`${OUT}/panel_settings.png`);
  await page.evaluate(() => { localStorage.removeItem('director-stage.ai'); const p = window.__aiPanel; p.showSettings = false; p.render(); });
  ok('设置：只存本机 localStorage、不进场景文档、密钥输入框为密码框', v8.stored && !v8.docHasKey && v8.pwd === 'password', JSON.stringify(v8));

  // 三种模式的抽屉截图（产品侧手动验收）
  for (const mode of ['generate', 'modify', 'image']) {
    await page.click(`.ai-mode[data-mode="${mode}"]`);
    await settle(80);
    await aiPanelShot(`${OUT}/panel_mode_${mode}.png`);
  }
  console.log(`📸 截图在 ${OUT}/（gen_t2.5 / gen_viewport / image_viewport / panel_*）`);
}

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
