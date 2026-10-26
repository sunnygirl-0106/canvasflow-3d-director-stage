import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';
import { SCENE_PRESETS } from '../src/ai/presets.js';

const out = path.resolve('test-output/presets');
fs.mkdirSync(out, { recursive: true });
const server = await createServer({ mode: 'test', server: { port: 5191, strictPort: false, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 810, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForFunction(() => window.__app?.ready, { timeout: 30000 });
  const indices = process.argv.slice(2).length ? process.argv.slice(2).map(v => Number(v) - 1) : Array.from({ length: 8 }, (_, i) => i);
  for (const i of indices) {
    const info = await page.evaluate(async i => {
      const { createPresetScene } = await import('/src/ai/presets.js');
      const app = window.__app, doc = createPresetScene(i);
      app.playback.stop();
      await app.loadDocument(doc, { history: false });
      app.setCameraView(false);
      app.playback.seek(Math.min(doc.timeline.duration * 0.58, 8));
      app.select(null);
      app.stage.invalidate();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { name: doc.meta.name, duration: doc.timeline.duration, trails: app.pathOverlay.itemCount };
    }, i);
    await page.screenshot({ path: path.join(out, `${i + 1}-director.png`) });
    const data = await page.evaluate(async duration => {
      const { exportVideo } = await import('/src/app/VideoExporter.js');
      const result = await exportVideo(window.__app, { width: 480, height: 270, fps: 8, range: [0, duration], labels: false });
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(result.blob);
      });
    }, info.duration);
    fs.writeFileSync(path.join(out, `${i + 1}-preview.mp4`), Buffer.from(data, 'base64'));
    console.log(`${i + 1}. ${info.name}: ${info.trails} 条轨迹，${info.duration} 秒`);
  }
  fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>八个预制场景验收预览</title><style>body{margin:32px;background:#111821;color:#e7edf5;font:16px system-ui}main{max-width:1200px;margin:auto}section{margin:32px 0;padding:24px;background:#1b2633;border-radius:12px}video{width:48%;vertical-align:top}img{width:48%;margin-left:2%}p{color:#aebdd0}a{color:#93c5fd}</style><main><h1>八个预制场景</h1><p>左侧为主机位完整预览（480×270，8 fps），右侧为带彩色轨迹的导演视角。预览帧率用于快速审阅，正式导出可使用 30 fps。</p>${SCENE_PRESETS.map((p, i) => `<section><h2>${i + 1}. ${p.title}</h2><p>${p.detail}</p><video controls preload="metadata" src="${i + 1}-preview.mp4"></video><a href="${i + 1}-director.png"><img alt="${p.title}导演视角" src="${i + 1}-director.png"></a></section>`).join('')}</main></html>`);
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
  await server.close();
}
