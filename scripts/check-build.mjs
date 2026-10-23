import { build } from 'vite';
import configure from '../vite.config.js';
import { versionAssetsPlugin } from './version-assets.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const run = (plugins = [], overrides) => {
  const config = configure({ mode: 'test', command: 'build' });
  if (overrides) config.plugins = config.plugins.map((p) => p.name === 'director-version-assets' ? versionAssetsPlugin({ overrides }) : p);
  return build({ ...config, configFile: false, mode: 'test', logLevel: 'error', plugins: [...config.plugins, ...plugins], build: { ...config.build, write: false } });
};
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

const manifestOf = (result) => JSON.parse(result.output.find((x) => x.fileName === 'asset-manifest.json').source);
const originalManifest = manifestOf(before);
assert.deepEqual(originalManifest, manifestOf(after), '业务变化不应使资产 URL 失效');
const key = './assets/panoramas/pano-sunset.jpg';
const altered = await run([], { [key]: Buffer.concat([fs.readFileSync('public/' + key.slice(2)), Buffer.from('asset-cache-probe')]) });
const changedManifest = manifestOf(altered);
for (const [logical, url] of Object.entries(originalManifest)) {
  if (logical === key) assert.notEqual(url, changedManifest[logical]);
  else assert.equal(url, changedManifest[logical]);
}
assert.equal(new Set(Object.values(originalManifest)).size, Object.keys(originalManifest).length);
fs.writeFileSync('test-output/build/asset-cache-check.json', JSON.stringify({ stableOnBusinessChange: true, changedAssetOnly: key, originalManifest, changedManifest }, null, 2));
console.log('资源版本通过：改内容只改变对应 URL，业务修改不改变资产 URL');
