import { build } from 'vite';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const run = (plugins = []) => build({ mode: 'test', logLevel: 'error', plugins, build: { write: false } });
const before = await run();
const after = await run([{ name: 'business-only-cache-probe', transform(code, id) {
  if (id.endsWith('/src/main.js')) return code + '\nconsole.info("business-copy-probe");';
} }]);
const vendor = (result) => Object.fromEntries(result.output.filter((x) => x.type === 'chunk' && /^(three|immer)-/.test(x.name + '-')).map((c) => [c.name, { file: c.fileName, code: c.code }]));
assert.deepEqual(vendor(before), vendor(after), '仅业务改动不应改变 vendor 文件名或内容');
const report = JSON.parse(before.output.find((x) => x.fileName === 'build-report.json').source);
assert.equal(report.chunks.filter((r) => r.threeModules).length, 1, 'Three 只出现在一个 chunk');
fs.mkdirSync('test-output/build', { recursive: true });
fs.writeFileSync('test-output/build/cache-check.json', JSON.stringify({ vendorStable: true, vendorFiles: Object.values(vendor(before)).map((x) => x.file), report }, null, 2));
console.log(`缓存隔离通过；首屏 JS ${report.initial.bytes} bytes / gzip ${report.initial.gzipBytes} bytes`);
