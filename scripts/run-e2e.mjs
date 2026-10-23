import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { SUITES, REQUIRED } from '../e2e/suites.mjs';

const requested = process.argv.slice(2);
const suites = requested[0] === 'all' ? SUITES : requested[0] === 'required' ? REQUIRED : requested;
if (!suites.length || suites.some((s) => !SUITES.includes(s))) throw new Error('指定 required、all 或已登记的套件名');
const dir = process.env.E2E_REPORT_DIR || 'test-output/reports';
fs.mkdirSync(dir, { recursive: true });
const results = [];
let child, cancelled = false;
const report = () => fs.writeFileSync(`${dir}/summary.json`, JSON.stringify(results, null, 2));
process.on('SIGTERM', () => { cancelled = true; child?.kill('SIGTERM'); report(); process.exitCode = 1; });
for (const suite of suites) {
  const start = Date.now(), log = fs.createWriteStream(`${dir}/${suite}.log`);
  console.log(`\n##### ${suite} #####`);
  const result = { suite, status: 'running', startedAt: new Date().toISOString() };
  results.push(result); report();
  child = spawn(process.execPath, ['selftest.mjs', suite], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => { log.write(data); process.stdout.write(data); });
  let timedOut = false, forceKill;
  const timeout = setTimeout(() => {
    timedOut = true; child.kill('SIGTERM');
    forceKill = setTimeout(() => child.kill('SIGKILL'), 10000);
  }, Number(process.env.E2E_SUITE_TIMEOUT_MS || 900000));
  const code = await new Promise((resolve) => {
    child.on('error', (err) => { log.write(String(err)); resolve(1); });
    child.on('close', (code) => resolve(code));
  });
  clearTimeout(timeout); clearTimeout(forceKill); log.end();
  Object.assign(result, { code, status: timedOut ? 'timeout' : cancelled ? 'cancelled' : code === 0 ? 'passed' : 'failed', durationMs: Date.now() - start });
  report();
  if (cancelled) break;
}
console.log('\n' + results.map((r) => `${r.suite}: ${r.status}`).join('\n'));
process.exitCode = results.some((r) => r.status !== 'passed') ? 1 : 0;
