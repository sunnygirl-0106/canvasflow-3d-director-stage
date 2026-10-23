// 仅通过生产界面/运行时 API 驱动，禁止 /src 动态 import；验证非根路径与首次导出。
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const out = 'test-output/build';
fs.mkdirSync(out, { recursive: true });
const executablePath = process.env.CHROME_PATH || JSON.parse(fs.readFileSync('test-output/browser-install.json')).executablePath;
const server = await preview({ mode: 'test', base: '/director/', preview: { port: 5189, open: false }, logLevel: 'error' });
let browser;
const report = { errors: [], requests: [] };
try {
  browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  report.browser = await browser.version();
  const page = await browser.newPage();
  page.on('pageerror', (e) => report.errors.push(e.message));
  page.on('requestfailed', (r) => report.errors.push(r.url() + ': ' + r.failure()?.errorText));
  page.on('request', (r) => report.requests.push(r.url()));
  await page.setViewport({ width: 1440, height: 810 });
  report.url = server.resolvedUrls.local[0];
  await page.goto(report.url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__app?.ready);
  report.startup = await page.evaluate(() => ({ entities: window.__app.entities.length, gizmo: window.__app.gizmo.visible }));
  assert.equal(report.startup.entities, 3); assert.equal(report.startup.gizmo, false);
  assert.equal(report.requests.some((u) => u.includes('VideoExporter-')), false);
  await page.evaluate(async () => {
    const a = window.__app;
    await a.panorama.setFromAsset({ url: './assets/panoramas/pano-sunset.jpg', title: '旧逻辑路径' });
    a.timeline.setDuration(12); a.history.capture();
  });
  await page.evaluate(async () => {
    const a = window.__app;
    for (const body of ['female', 'xbot']) await a.addCharacter(body);
  });
  const manifest = JSON.parse(fs.readFileSync('dist/asset-manifest.json'));
  for (const logical of ['./assets/figures/bodykun_male.glb', './assets/figures/bodychan_female.glb', './assets/Xbot.glb', './assets/panoramas/pano-sunset.jpg']) {
    assert(report.requests.some((url) => url.endsWith('/director/' + manifest[logical])), logical);
    assert.equal(fs.existsSync('dist/' + logical), false, '不复制原名资产');
  }
  report.panorama = await page.evaluate(() => ({ active: window.__app.panorama.active, url: window.__app.panorama.asset.url }));
  assert.deepEqual(report.panorama, { active: true, url: './assets/panoramas/pano-sunset.jpg' });
  const saved = await page.evaluate(() => window.__app.exportDocument());
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__app?.ready);
  assert.equal(await page.$('#saveStatus, .save-status'), null);
  await page.evaluate(doc => window.__app.loadDocument(doc), saved);
  assert.equal(await page.evaluate(() => window.__app.panorama.active && window.__app.timeline.duration === 12), true);
  const downloads = path.resolve(`${out}/downloads`); fs.mkdirSync(downloads, { recursive: true });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await page.evaluate(async () => {
    const m = window.__exportModal;
    m.form = { short: 720, fps: 24, whole: false, t0: 0, t1: .5, labels: true };
    m.open(); await m.start();
  });
  report.video = await page.evaluate(() => window.__exportModal.lastResult);
  assert.equal(report.video?.frames, 12);
  assert(report.requests.some((u) => u.includes('VideoExporter-')));
  assert.equal(report.requests.some((u) => /\/src\//.test(u)), false);
  assert.deepEqual(report.errors, []);
  await page.screenshot({ path: `${out}/production.png` });
  report.passed = true;
  console.log('生产构建 /director/：场景保存加载、全景、首次延迟加载与 MP4 导出通过');
} finally {
  fs.writeFileSync(`${out}/production.json`, JSON.stringify(report, null, 2));
  await browser?.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
