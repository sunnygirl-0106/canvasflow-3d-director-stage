// 固定任务的上下文证据与 Mock 校验基线；不代表真实模型质量或网络延迟。
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { summarize } from '../src/ai/context.js';
import { contextFixture, contextTasks } from '../tests/contextFixtures.mjs';
import { MockProvider } from '../src/ai/provider.js';
import { validateOps, sceneIndex } from '../src/ai/ops.js';
const sourceRevision = '7717264';
const source = execFileSync('git', ['show', `${sourceRevision}:src/ai/apply.js`], { encoding: 'utf8' });
const oldCode = `import { pathLength } from ${JSON.stringify(pathToFileURL(process.cwd() + '/src/anim/pathGen.js').href)};\nconst r2 = (x) => Math.round(x * 100) / 100;\n` + source.slice(source.indexOf('// ---- 场景摘要 ----'));
const previous = (await import('data:text/javascript;base64,' + Buffer.from(oldCode).toString('base64'))).summarize;
const report = { sourceRevision, scope: 'deterministic context evidence + MockProvider; no live LLM or network benchmark', runs: [], summary: {} };
const stats = (xs) => { const a = xs.slice().sort((a, b) => a - b); return { median: a[Math.floor(a.length / 2)], p95: a[Math.ceil(a.length * .95) - 1] }; };
const doc = contextFixture();
for (const [version, summaryOf] of [['before', previous], ['after', summarize]]) {
  for (const task of contextTasks) for (let repeat = 0; repeat < 10; repeat++) {
    const start = performance.now(), context = summaryOf(doc, { input: task.input });
    const evidence = context.includes(task.target) && task.needles.every((needle) => context.includes(needle));
    const provider = new MockProvider([{ match: task.input, reply: { ops: evidence ? task.ops : [{ op: 'remove', target: '摘要缺少目标信息' }] } }]);
    let attempts = 0, valid = false;
    while (attempts < 3 && !valid) {
      attempts++;
      const reply = JSON.parse(await provider.chat([{ role: 'user', content: context + '\n用户：' + task.input }]));
      valid = validateOps(reply.ops, sceneIndex(doc), { mode: 'modify' }).ok;
    }
    report.runs.push({ version, task: task.name, repeat, targetEvidence: evidence, firstValidationPass: valid && attempts === 1, correctionRounds: attempts - 1, ms: performance.now() - start, contextCharacters: context.length });
  }
  const rows = report.runs.filter((r) => r.version === version);
  report.summary[version] = { targetEvidenceRate: rows.filter((r) => r.targetEvidence).length / rows.length,
    firstValidationPassRate: rows.filter((r) => r.firstValidationPass).length / rows.length,
    correctionRounds: stats(rows.map((r) => r.correctionRounds)), ms: stats(rows.map((r) => r.ms)), contextCharacters: stats(rows.map((r) => r.contextCharacters)) };
}
fs.mkdirSync('test-output/context', { recursive: true });
fs.writeFileSync('test-output/context/report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.summary, null, 2));
