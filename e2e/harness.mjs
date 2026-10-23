// 端到端自测的运行环境：起 Vite dev server（关 HMR / 文件监听）+ headless Chrome，导出同一个 page 与断言工具。
// 被 import 时就启动（顶层 await），所以只在真正要跑浏览器的子命令里动态加载。
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';

export const ARGS = process.argv.slice(3);

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
];
const CHROME = process.env.CHROME_PATH || CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!CHROME) { console.error('找不到 Chrome：请设置 CHROME_PATH'); process.exit(2); }

export let server = null;
export let URL_ = process.env.TEST_URL;
if (!URL_) {
  server = await createServer({ mode: 'test', server: { port: 5181, strictPort: false, open: false, hmr: false, watch: null }, logLevel: 'error' });
  await server.listen();
  URL_ = server.resolvedUrls.local[0];
}

export const results = [];
export const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

export const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
console.log(`浏览器：${await browser.version()}；Node：${process.version}；路径：${CHROME}`);
export const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 810, deviceScaleFactor: 1 });
export const errs = [];
export const warns = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text() + (m.location()?.url ? ` @ ${m.location().url.slice(0, 120)}` : '')); if (m.type() === 'warn') warns.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

/** 打开应用并等待完整默认场景 ready。 */
export async function openApp() {
  await page.goto(URL_, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForFunction(() => window.__app?.ready, { timeout: 30000 });
  await page.evaluate(async () => {
    const family = getComputedStyle(document.body).fontFamily;
    await document.fonts.load(`400 14px ${family}`, '角色机位');
    await document.fonts.load(`400 12px ${family}`, '角色机位');
    await document.fonts.ready;
  });
}

/** 关浏览器与服务，以 code 退出。 */
export async function close(code) {
  const out = `test-output/reports/${process.argv[2] || 'default'}`;
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(`${out}/results.json`, JSON.stringify({ results, errors: errs, warnings: warns, browser: await browser.version(), node: process.version, code }, null, 2));
  if (code) await page.screenshot({ path: `${out}/failure.png`, fullPage: true }).catch(() => {});
  await browser.close();
  await server?.close();
  process.exit(code);
}

/** 套件统一收尾：查 console 错误、打印汇总、以失败数决定退出码。 */
export async function finish() {
  ok('运行期无 console 错误', errs.length === 0, errs.slice(0, 3).join(' | '));
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n=== ${results.length - failed}/${results.length} passed ===`);
  await close(failed ? 1 : 0);
}

/** 双人业务用例显式准备自己的场景，不依赖生产 seed。 */
export async function twoCharacterFixture() {
  await page.evaluate(async () => {
    const a = window.__app;
    const { createEmptyDocument } = await import('/src/doc/schema.js');
    const { addCharacter } = await import('/src/doc/edit.js');
    const doc = createEmptyDocument();
    addCharacter(doc, { name: '角色A', body: 'male', pos: [-1.1, 0, 0.2] });
    addCharacter(doc, { name: '角色B', body: 'female', pos: [1.1, 0, 0.2] });
    await a.loadDocument(doc, { history: false });
    a.frameSubjects(); a.select(null); a.history.reset();
  });
}

export async function fail(err) {
  errs.push(err.stack || String(err));
  console.error(err);
  await close(1);
}
process.on('SIGTERM', () => void fail(new Error('套件超时或作业取消')));
