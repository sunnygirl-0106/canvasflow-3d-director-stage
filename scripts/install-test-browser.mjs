import { install, Browser } from '@puppeteer/browsers';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// 与 puppeteer-core 25.2.0 的 PUPPETEER_REVISIONS 一致；升级必须显式修改。
const buildId = '150.0.7871.24';
const browser = await install({ browser: Browser.CHROME, buildId, cacheDir: path.resolve('.cache/test-browser') });
console.log(browser.executablePath);
mkdirSync('test-output', { recursive: true });
writeFileSync('test-output/browser-install.json', JSON.stringify({ buildId, executablePath: browser.executablePath }, null, 2));
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `CHROME_PATH=${browser.executablePath}\n`);
