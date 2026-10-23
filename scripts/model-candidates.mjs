// 可重复实验：候选只写入 test-output；未经运行时/像素验收不得替换生产资产。
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const dir = 'test-output/model-candidates'; fs.mkdirSync(dir, { recursive: true });
const sourceRevision = '7717264';
const variants = { lossless: ['-cc', '-ce', 'ext', '-kn', '-km', '-ke', '-noq'], compact: ['-cc', '-ce', 'ext', '-kn', '-km', '-ke', '-vpf', '-vp', '16', '-vn', '12', '-kv'] };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (bytes) => JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
const results = [];
for (const name of ['bodykun_male', 'bodychan_female']) for (const [variant, flags] of Object.entries(variants)) {
  const logicalSource = `public/assets/figures/${name}.glb`;
  const source = `${dir}/${name}-original.glb`, output = `${dir}/${name}-${variant}.glb`;
  fs.writeFileSync(source, execFileSync('git', ['show', `${sourceRevision}:${logicalSource}`]));
  const args = ['-i', source, '-o', output, ...flags];
  execFileSync(process.execPath, ['node_modules/gltfpack/cli.js', ...args], { stdio: 'inherit' });
  const before = fs.readFileSync(source), after = fs.readFileSync(output);
  const a = json(before), b = json(after);
  const skeleton = (doc) => (doc.skins || []).map((skin) => skin.joints.map((i) => doc.nodes[i].name));
  results.push({ name, variant, args, sourceHash: hash(before), outputHash: hash(after), sourceBytes: before.length, outputBytes: after.length,
    extensions: b.extensionsUsed || [], sameJointNamesAndOrder: JSON.stringify(skeleton(a)) === JSON.stringify(skeleton(b)),
    sourceSkins: a.skins?.length, outputSkins: b.skins?.length, sourceNodes: a.nodes.length, outputNodes: b.nodes.length });
}
fs.writeFileSync(`${dir}/report.json`, JSON.stringify({ tool: 'gltfpack@1.3.0', sourceRevision, results }, null, 2));
console.log(results.map((r) => `${r.name} ${r.variant}: ${r.sourceBytes} -> ${r.outputBytes}, joints ${r.sameJointNamesAndOrder}`).join('\n'));
