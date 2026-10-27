import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';
import { SCENE_PRESETS } from '../src/ai/presets.js';

const out = path.resolve('test-output/editor-review');
fs.mkdirSync(out, { recursive: true });
const server = await createServer({ mode: 'test', server: { port: 5193, strictPort: false, open: false, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const errors = [], report = [], gallery = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__app?.ready, { timeout: 60000 });
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  for (const [width, height] of [[1440, 900], [1280, 800]]) {
    await page.setViewport({ width, height });
    await page.evaluate(async () => {
      const a = window.__app, { createPresetScene } = await import('/src/ai/presets.js');
      a.playback.stop(); await a.loadDocument(createPresetScene(0), { newScene: true });
      const c = a.cameras[0]; a.setCameraView(false); a.select(c.id, { user: true });
      a.timeline.addConstraint({ type: 'lookAt', target: c.id, subject: a.entities.find(e => e.type === 'character').id });
      a.emit('inspect', { id: c.id, section: 'constraint' });
      window.__timelinePanel.setCollapsed(false);
      for (const b of [...document.querySelectorAll('.tl-head .tl-caret.folded')]) { const id = b.closest('.tl-head').dataset.ent; window.__timelinePanel.trackRows.expandedEnts.add(id); }
      window.__timelinePanel.rebuild();
    });
    await settle();
    await page.screenshot({ path: path.join(out, `attributes-timeline-${width}.png`) });
    // Also capture the lower camera properties without the expanded timeline covering them.
    await page.evaluate(() => window.__timelinePanel.setCollapsed(true)); await settle();
    await page.screenshot({ path: path.join(out, `attributes-${width}.png`) });
    await page.evaluate(() => window.__timelinePanel.setCollapsed(false)); await settle();
    await page.evaluate(() => [...document.querySelectorAll('#inspector .ptabs button')].find(b => b.textContent === '运动轨迹').click());
    await settle(); await page.screenshot({ path: path.join(out, `moves-${width}.png`) });
    await page.click('#scenePresets'); await settle();
    await page.screenshot({ path: path.join(out, `presets-${width}.png`) });
    await page.keyboard.press('Escape');
  }
  await page.setViewport({ width: 540, height: 800 });
  await page.click('#scenePresets'); await settle();
  await page.screenshot({ path: path.join(out, 'presets-narrow.png') });
  await page.keyboard.press('Escape');
  await page.setViewport({ width: 1280, height: 800 }); await settle();
  await page.evaluate(() => {
    const a = window.__app, panel = window.__timelinePanel;
    const c = a.cameras[0];
    a.rename(c.id, '用于检查长名称省略与按钮对齐的摄像机');
    panel.setHeight(360); panel.trackRows.expandedEnts.clear(); panel.trackRows.expandedEnts.add(c.id); panel.rebuild();
  }); await settle();
  const cameraPath = await page.evaluate(() => window.__app.timeline.paths.find(p => p.target === window.__app.cameras[0].id).id);
  const lane = `.tl-track[data-path="${cameraPath}"] .tl-bar-path`;
  await page.$eval(lane, n => n.scrollIntoView({ block: 'nearest' }));
  await page.screenshot({ path: path.join(out, 'timeline-normal.png') });
  await page.hover(lane); await settle(); await page.screenshot({ path: path.join(out, 'timeline-hover.png') });
  await page.click(`[data-node-path="${cameraPath}"][data-node-index="12"]`); await settle();
  await page.screenshot({ path: path.join(out, 'timeline-selected.png') });
  await page.evaluate(() => { const p = window.__timelinePanel; p.setZoom(p.pps * 1.5); }); await settle();
  await page.screenshot({ path: path.join(out, 'timeline-zoom.png') });
  const handle = await page.$eval(`${lane} .tl-bar-end.start`, n => { const r = n.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await page.mouse.move(...handle); await page.mouse.down(); await page.mouse.move(handle[0] + 20, handle[1], { steps: 5 });
  await page.screenshot({ path: path.join(out, 'timeline-drag.png') });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await page.setViewport({ width: 1440, height: 900 });
  const phaseTimes = [[0, 3, 4.5, 6.25, 8, 9.25, 10.5, 12], [0, 2, 4, 6, 8, 10, 12, 14], [0, 2, 4, 6, 8, 9, 10, 12], [0, 2.75, 5.5, 6.5, 8, 9.5, 11, 12], [0, 2, 3.5, 5, 6.5, 8, 9, 10], [0, 2.25, 4.5, 6.75, 9, 9.75, 10.5, 12], [0, 3, 5, 7, 8, 9, 11, 14], [0, 1.5, 3, 5.5, 8, 9, 10, 12]];
  for (const ratio of ['16:9', '9:16']) for (let index = 0; index < 8; index++) {
    if (ratio === '9:16' && ![4, 5, 7].includes(index)) continue;
    const metrics = await page.evaluate(async ({ index, ratio }) => {
      const a = window.__app, { createPresetScene } = await import('/src/ai/presets.js'), T = await import('/node_modules/three/build/three.module.js');
      a.playback.stop(); await a.loadDocument(createPresetScene(index, { ratio }), { newScene: true });
      const c = a.cameras[0], chars = a.entities.filter(e => e.type === 'character'), props = a.entities.filter(e => e.type === 'prop');
      const boxes = props.map(e => new T.Box3().setFromObject(e.root));
      const duration = a.timeline.duration, sample = [];
      let maxStep = 0, maxAngle = 0, maxFraming = 0, clearance = 1000, previous;
      for (let frame = 0; frame <= duration * 30; frame++) {
        const time = frame / 30; a.playback.seek(time);
        const p = c.root.position.clone(), q = c.root.quaternion.clone();
        if (previous) { maxStep = Math.max(maxStep, p.distanceTo(previous.p)); maxAngle = Math.max(maxAngle, q.angleTo(previous.q)); }
        previous = { p, q };
        c.cam.aspect = ratio === '9:16' ? 9 / 16 : 16 / 9; c.cam.updateProjectionMatrix(); a.stage.world.updateMatrixWorld(true);
        for (const box of boxes) clearance = Math.min(clearance, box.distanceToPoint(c.cam.getWorldPosition(new T.Vector3())));
        // Other group members intentionally enter the opening shot; require the full group after 3s.
        for (const e of index === 7 && time < 3 ? chars.slice(0, 1) : chars) {
          const foot = e.root.position.clone(); foot.y -= e.rootY0;
          for (const x of [-.25, .25]) for (const y of [.05, e.height * e.root.scale.y / e.baseScale]) {
            const v = a.stage.world.localToWorld(foot.clone().add(new T.Vector3(x, y, 0))).project(c.cam);
            maxFraming = Math.max(maxFraming, Math.abs(v.x), Math.abs(v.y));
          }
        }
        if (frame % 30 === 0) sample.push({ time, pos: p.toArray(), rot: q.toArray() });
      }
      a.playback.loop = false; a.playback.seek(0); a.playback.play();
      await new Promise(resolve => setTimeout(resolve, 220)); a.playback.pause();
      const played = a.playback.time > 0;
      const pausedAt = a.playback.time;
      await new Promise(resolve => setTimeout(resolve, 120));
      const paused = a.playback.time === pausedAt;
      a.playback.play();
      const deadline = performance.now() + 30000;
      while (a.playback.playing && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
      const fullPlayback = !a.playback.playing && a.playback.time === duration;
      const doc = a.exportDocument(); await a.loadDocument(doc, { history: false });
      let reloadError = 0;
      for (const s of sample) { a.playback.seek(s.time); reloadError = Math.max(reloadError, a.cameras[0].root.position.distanceTo(new T.Vector3(...s.pos)), a.cameras[0].root.quaternion.angleTo(new T.Quaternion(...s.rot))); }
      a.select(null); return { index, ratio, duration, played, paused, fullPlayback, maxStep, maxAngle, maxFraming, clearance, reloadError };
    }, { index, ratio });
    report.push(metrics); console.log(JSON.stringify(metrics));
    const frames = [];
    for (const t of phaseTimes[index]) {
      const png = await page.evaluate(({ t, ratio }) => {
        const a = window.__app; a.playback.seek(t);
        return a.withCleanRender(() => a.stage.snapshot(a.cameras[0].cam, ratio === '9:16' ? { width: 405, height: 720 } : { width: 960, height: 540 }).toDataURL('image/png'));
      }, { t, ratio });
      const file = `${index + 1}-${ratio.replace(':', 'x')}-${t}.png`;
      fs.writeFileSync(path.join(out, file), Buffer.from(png.split(',')[1], 'base64'));
      frames.push({ t, file, png });
    }
    const sheet = await browser.newPage();
    const portrait = ratio === '9:16';
    await sheet.setViewport({ width: 1440, height: portrait ? 1400 : 620, deviceScaleFactor: 1 });
    await sheet.setContent(`<html lang="zh-CN"><meta charset="UTF-8"><style>body{margin:20px;background:#202225;color:#eee;font:14px system-ui}h2{margin:0 0 14px}main{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}img{width:100%;display:block}figure{margin:0}figcaption{padding:5px;color:#bbc2ca}</style><h2>${index + 1}. ${SCENE_PRESETS[index].title} · ${ratio}</h2><main>${frames.map(f => `<figure><img src="${f.png}"><figcaption>${f.t} 秒</figcaption></figure>`).join('')}</main></html>`);
    const contact = `${index + 1}-${portrait ? 'portrait' : 'landscape'}-contact.png`;
    await sheet.screenshot({ path: path.join(out, contact), fullPage: true }); await sheet.close();
    gallery.push(`<h2>${SCENE_PRESETS[index].title} · ${ratio}</h2><img src="${contact}" alt="${SCENE_PRESETS[index].title}阶段截图">`);
  }
  fs.writeFileSync(path.join(out, 'metrics.json'), JSON.stringify({ report, errors }, null, 2));
  fs.writeFileSync(path.join(out, 'index.html'), `<html lang="zh-CN"><meta charset="UTF-8"><title>动画编辑器验收</title><style>body{margin:24px auto;max-width:1440px;background:#202225;color:#eee;font:16px system-ui}img{width:100%;border:1px solid #444}a{color:#b5d6e2}</style><h1>动画编辑器验收截图</h1><p>两种桌面尺寸；八个场景阶段边界与中间帧；单人与群像竖屏。采样指标见 <a href="metrics.json">metrics.json</a>。</p>${['attributes','attributes-timeline','moves','presets'].flatMap(n => [1440,1280].map(w => `<h2>${n} · ${w}</h2><img src="${n}-${w}.png">`)).join('')}<h2>预制场景 · 窄屏</h2><img src="presets-narrow.png">${['normal','hover','selected','zoom','drag'].map(s => `<h2>时间轴 · ${s}</h2><img src="timeline-${s}.png">`).join('')}${gallery.join('')}</html>`);
  if (errors.length) throw new Error(errors.join('\n'));
  if (report.some(r => !r.played || !r.paused || !r.fullPlayback || r.reloadError > 1e-6 || r.maxStep > .1 || r.maxAngle > .025 || r.clearance < .3 || r.maxFraming > .96)) throw new Error('场景采样验收未达标，请查看 metrics.json');
} finally { await browser.close(); await server.close(); }
// Match the E2E harness: Vite's build service can retain handles after close.
process.exit(0);
