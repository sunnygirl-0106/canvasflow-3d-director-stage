// 本机浏览器冒烟入口；TEST_URL 可指向已有服务，CHROME_PATH 可指定浏览器。
import { SUITES } from './e2e/suites.mjs';
const [suite = 'smoke'] = process.argv.slice(2);
if (!SUITES.includes(suite)) throw new Error('只支持 smoke 冒烟套件');
const h = await import('./e2e/harness.mjs');
try {
  await h.openApp();
  await (await import('./e2e/suites/smoke.mjs')).run();
  await h.finish();
} catch (error) {
  await h.fail(error);
}
