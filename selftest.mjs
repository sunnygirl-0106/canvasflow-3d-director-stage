import { execFileSync } from 'node:child_process';
import { SUITES } from './e2e/suites.mjs';

const [CMD = 'default'] = process.argv.slice(2);

// all：逐个套件各起一个子进程（套件之间不共享页面状态），汇总退出码
if (CMD === 'all') {
  try { execFileSync(process.execPath, ['scripts/run-e2e.mjs', 'all'], { stdio: 'inherit' }); }
  catch { process.exit(1); }
  process.exit(0);
}

if (!SUITES.includes(CMD)) {
  console.error(`未知子命令：${CMD}（可用：${[...SUITES, 'all'].join(' / ')}）`);
  process.exit(2);
}

const h = await import('./e2e/harness.mjs');

try {
  await h.openApp();
  await (await import(`./e2e/suites/${CMD}.mjs`)).run();
  await h.finish();
} catch (err) {
  await h.fail(err);
}
