// 两组截图逐张像素对比（pixelmatch），差异像素占比 > maxRatio 判失败，差异图写到 dirB/_diff/。不起浏览器。
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export function poseDiff(dirA, dirB, maxRatio) {
  const files = fs.readdirSync(dirA).filter((f) => f.endsWith('.png')).sort();
  const diffDir = path.join(dirB, '_diff');
  fs.mkdirSync(diffDir, { recursive: true });
  let bad = 0;
  for (const f of files) {
    const pb = path.join(dirB, f);
    if (!fs.existsSync(pb)) { console.log(`❌ ${f} — ${dirB} 中缺失`); bad++; continue; }
    const a = PNG.sync.read(fs.readFileSync(path.join(dirA, f)));
    const b = PNG.sync.read(fs.readFileSync(pb));
    if (a.width !== b.width || a.height !== b.height) { console.log(`❌ ${f} — 尺寸不同`); bad++; continue; }
    const diff = new PNG({ width: a.width, height: a.height });
    const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
    const ratio = n / (a.width * a.height);
    const pass = ratio <= maxRatio;
    if (!pass) { bad++; fs.writeFileSync(path.join(diffDir, f), PNG.sync.write(diff)); }
    console.log(`${pass ? '✅' : '❌'} ${f} — 差异像素 ${n}（${(ratio * 100).toFixed(4)}%）`);
  }
  console.log(`\n=== ${files.length - bad}/${files.length} 一致（阈值 ${(maxRatio * 100).toFixed(2)}%）===`);
  return bad ? 1 : 0;
}
