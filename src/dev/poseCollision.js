// 姿势穿模检测（开发用）：selftest 的 collide 子命令通过页面调用。
// 做法：取蒙皮后的每个顶点，按主权重骨头归到身体部位；对不相邻的两个部位，
// 若 A 的顶点落在 B 最近表面顶点的法线背面（即在 B 体内），记为穿模，深度 = 到该表面的距离。
// 最近点 + 法线判内外是近似法，只用来找"明显扎进去"的部位，阈值默认 1cm。
import * as THREE from 'three';

const SEGMENTS = [
  // [部位, 骨名前缀（归一化后，按顺序匹配，长的写前面）]
  ['lHand', ['mixamoriglefthand']], ['rHand', ['mixamorigrighthand']],
  ['lForeArm', ['mixamorigleftforearm']], ['rForeArm', ['mixamorigrightforearm']],
  ['lUpperArm', ['mixamorigleftarm']], ['rUpperArm', ['mixamorigrightarm']],
  ['lFoot', ['mixamorigleftfoot', 'mixamoriglefttoe']], ['rFoot', ['mixamorigrightfoot', 'mixamorigrighttoe']],
  ['lThigh', ['mixamorigleftupleg']], ['rThigh', ['mixamorigrightupleg']],
  ['lShin', ['mixamorigleftleg']], ['rShin', ['mixamorigrightleg']],
  ['head', ['mixamorighead', 'mixamorigneck']],
  ['torso', ['mixamorighips', 'mixamorigspine', 'mixamorigleftshoulder', 'mixamorigrightshoulder']],
];

// 相邻部位在关节处本来就会重叠，不计
const ADJACENT = new Set([
  'head|torso', 'lUpperArm|torso', 'rUpperArm|torso', 'lThigh|torso', 'rThigh|torso',
  'lForeArm|lUpperArm', 'rForeArm|rUpperArm', 'lForeArm|lHand', 'rForeArm|rHand',
  'lShin|lThigh', 'rShin|rThigh', 'lFoot|lShin', 'rFoot|rShin', 'lThigh|rThigh',
].map((p) => p.split('|').sort().join('|')));

const norm = (s) => (s || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
function segmentOf(boneName) {
  const n = norm(boneName);
  for (const [seg, prefixes] of SEGMENTS) if (prefixes.some((p) => n.startsWith(p))) return seg;
  return null;
}

/** 当前姿势下蒙皮顶点的世界坐标 / 法线 / 部位。 */
function sampleSkin(model) {
  const pos = [], nrm = [], seg = [];
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const g = o.geometry, n = g.attributes.position.count;
    const boneSeg = o.skeleton.bones.map((b) => segmentOf(b.name));
    const sIdx = g.attributes.skinIndex, sW = g.attributes.skinWeight;
    const world = new Float32Array(n * 3), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld);
      world.set([v.x, v.y, v.z], i * 3);
      let best = -1, bw = -1;
      for (let k = 0; k < 4; k++) { const w = sW.getComponent(i, k); if (w > bw) { bw = w; best = sIdx.getComponent(i, k); } }
      seg.push(boneSeg[best]);
    }
    const tmp = new THREE.BufferGeometry();
    tmp.setAttribute('position', new THREE.BufferAttribute(world, 3));
    if (g.index) tmp.setIndex(g.index);
    tmp.computeVertexNormals();
    const na = tmp.attributes.normal.array;
    for (let i = 0; i < n * 3; i++) { pos.push(world[i]); nrm.push(na[i]); }
    tmp.dispose();
  });
  return { pos, nrm, seg };
}

/**
 * 检测当前姿势的穿模。
 * @returns {Array<{pair:string, count:number, depth:number}>} 按最大深度降序；depth 单位米
 */
export function detectPenetration(model, { minDepth = 0.01, radius = 0.06 } = {}) {
  const { pos, nrm, seg } = sampleSkin(model);
  const n = seg.length, cell = radius;
  const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const grid = new Map();
  for (let i = 0; i < n; i++) {
    if (!seg[i]) continue;
    const k = key(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    (grid.get(k) || grid.set(k, []).get(k)).push(i);
  }
  const hits = new Map();
  for (let i = 0; i < n; i++) {
    const a = seg[i]; if (!a) continue;
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    const nearest = new Map(); // 部位 → [距离², 顶点]
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) || []) {
        const b = seg[j];
        if (b === a || ADJACENT.has([a, b].sort().join('|'))) continue;
        const d2 = (pos[j * 3] - x) ** 2 + (pos[j * 3 + 1] - y) ** 2 + (pos[j * 3 + 2] - z) ** 2;
        const cur = nearest.get(b);
        if (!cur || d2 < cur[0]) nearest.set(b, [d2, j]);
      }
    }
    for (const [b, [, j]] of nearest) {
      const depth = -((x - pos[j * 3]) * nrm[j * 3] + (y - pos[j * 3 + 1]) * nrm[j * 3 + 1] + (z - pos[j * 3 + 2]) * nrm[j * 3 + 2]);
      if (depth < minDepth) continue;
      const pair = [a, b].sort().join('|');
      const h = hits.get(pair) || { pair, count: 0, depth: 0 };
      h.count++; h.depth = Math.max(h.depth, depth);
      hits.set(pair, h);
    }
  }
  return [...hits.values()].filter((h) => h.count >= 5).sort((p, q) => q.depth - p.depth);
}
