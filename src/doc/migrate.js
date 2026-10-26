// 文档版本迁移：按版本号逐级升级到 SCHEMA_VERSION。
// 新增版本时：在 STEPS 里登记 { from, to, up(doc) → doc }，up 只负责相邻两版之间的差异。
import { SCHEMA_VERSION } from './schema.js';
import * as THREE from 'three';

/** 迁移步骤（按顺序串联）。目前只有 0.1，没有需要升级的旧版本。 */
const STEPS = [
  // 示例：{ from: 'director-stage/0.1', to: 'director-stage/0.2', up: (doc) => ({ ...doc, schema: 'director-stage/0.2' }) },
];

/**
 * 把文档升级到当前版本。不修改入参（深拷贝后升级）。
 * 版本无法识别时原样返回，交给 validate 报"版本未知"。
 */
export function migrate(input) {
  if (input === null || typeof input !== 'object') return input;
  let doc = JSON.parse(JSON.stringify(input));
  for (let guard = 0; doc.schema !== SCHEMA_VERSION && guard <= STEPS.length; guard++) {
    const step = STEPS.find((s) => s.from === doc.schema);
    if (!step) break;
    doc = step.up(doc);
    doc.schema = step.to;
  }
  if (doc.schema === SCHEMA_VERSION && Array.isArray(doc.entities)) {
    const palette = ['#4dd9ed', '#ff897d', '#f4c85c', '#83d69a', '#76a9ff', '#f49ec4'];
    const used = new Set(doc.entities.map(e => e.trailColor).filter(Boolean));
    for (const e of doc.entities) {
      if (e.type !== 'character' || e.trailColor) continue;
      e.trailColor = palette.find(c => !used.has(c));
      if (!e.trailColor) {
        let i = 0;
        do { e.trailColor = `#${new THREE.Color().setHSL(((i++ * 0.61803398875) + 0.12) % 1, 0.72, 0.66).getHexString()}`; } while (used.has(e.trailColor));
      }
      used.add(e.trailColor);
    }
  }
  return doc;
}
