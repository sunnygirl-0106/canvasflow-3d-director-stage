// 把 bodychan_female 调得中性一点：胸压平、臀收、胯收窄、腰略宽、肩加宽（手臂骨骼 + 网格同步外移）。
// 直接改 GLB 的 POSITION / NORMAL / 手臂节点平移 / inverseBindMatrices，其余（骨骼轴向、权重、索引）逐字节不动；法线按变形雅可比的逆转置变换。
// 输入必须是【原始】模型（已处理过的再跑会叠加）：
//   git show 1bb3f44:public/assets/figures/bodychan_female.glb > /tmp/orig.glb
//   node scripts/figure-neutral.mjs /tmp/orig.glb public/assets/figures/bodychan_female.glb [chest=0.15 butt=0.3 …]
// 参数：chest / butt = 胸 / 臀凸出保留比例；hip / waist = 胯 / 腰宽度倍数；sh = 每侧肩外移（米）；chestW = 上胸加宽比例；c = 软压缩余量（米）。
import fs from 'node:fs';
import { Buffer } from 'node:buffer';
import process from 'node:process';
function readGlb(path) {
  const b = fs.readFileSync(path);
  const jl = b.readUInt32LE(12); const json = JSON.parse(b.slice(20, 20 + jl).toString());
  const binStart = 20 + jl + 8; const binLen = b.readUInt32LE(20 + jl);
  const bin = Buffer.from(b.slice(binStart, binStart + binLen));
  const acc = (i) => { const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
    const C = { 5126: Float32Array, 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array }[a.componentType];
    const n = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
    return new C(bin.buffer, bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0), a.count * n); };
  return { json, bin, acc };
}
function writeGlb(path, json, bin) {
  let js = Buffer.from(JSON.stringify(json)); while (js.length % 4) js = Buffer.concat([js, Buffer.from(' ')]);
  const h = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  h.writeUInt32LE(0x46546C67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4E4F534A, 4); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004E4942, 4);
  fs.writeFileSync(path, Buffer.concat([h, jh, js, bh, bin]));
}

import * as THREE from 'three';
const [src, out, ...kv] = process.argv.slice(2);
const K = { chest: 0.15, butt: 0.3, hip: 0.88, waist: 1.12, sh: 0.025, chestW: 0.18, c: 0.012, ...Object.fromEntries(kv.map((s) => s.split('=')).map(([k, v]) => [k, +v])) };
const { json, bin, acc } = readGlb(src);
const P = acc(0), N = acc(1), J = acc(2), W = acc(3), IBM = acc(5);
const sk = json.skins[0], jn = sk.joints.map((n) => json.nodes[n].name.replace('mixamorig:', ''));
const nodeJoint = new Map(sk.joints.map((n, j) => [n, j]));
const nv = P.length / 3;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// 软压缩：超出量 e ≥ 0 → s·e + (1−s)·c·(1 − e^(−e/c))。e=0 处值与斜率都连续（斜率 1），不起折痕；远处保留比例 s，外加 ≤ c 的余量
const soft = (e, s, c) => (e <= 0 ? e : s * e + (1 - s) * c * (1 - Math.exp(-e / c)));
const band = (y, a, b, c, d) => smooth(a, b, y) * (1 - smooth(c, d, y)); // a↗b 平台 c↘d
// 手臂链（含 Shoulder 之后的所有骨）：左 / 右
const armSet = { 1: new Set(), [-1]: new Set() };
const collect = (n, set) => { const j = nodeJoint.get(n); if (j != null) set.add(j); for (const c of json.nodes[n].children || []) collect(c, set); };
for (const [side, name] of [[1, 'LeftArm'], [-1, 'RightArm']]) collect(json.nodes.findIndex((n) => n.name === 'mixamorig:' + name), armSet[side]);

const info = [];
for (let i = 0; i < nv; i++) {
  let b = 0, aw = 0, side = 0;
  for (let k = 0; k < 4; k++) {
    const j = J[i * 4 + k], w = W[i * 4 + k];
    if (w > W[i * 4 + b]) b = k;
    for (const s of [1, -1]) if (armSet[s].has(j)) { aw += w; side = s; }
  }
  info.push({ dom: jn[J[i * 4 + b]], aw, side });
}

// 胸壁：下胸 (1.13, 0.142) → 上胸 (1.31, 0.078) 的直线；臀线：腰 (1.00, −0.046) → 大腿 (0.73, −0.056)
const chestWall = (y) => 0.142 + (y - 1.13) * (0.078 - 0.142) / (1.31 - 1.13);
const buttWall = (y) => -0.046 + (y - 1.00) * (-0.056 + 0.046) / (0.73 - 1.00);
function f(p, inf) {
  let [x, y, z] = p;
  const ax = Math.abs(x);
  if (inf.aw > 0) x += inf.side * K.sh * inf.aw; // 手臂整体外移（与骨骼同步）
  const torso = !/Arm|Hand|Fore|Head|Neck/.test(inf.dom);
  if (torso && inf.aw < 0.5) {
    // 胸：前表面向胸壁压
    if (/Spine/.test(inf.dom)) {
      const m = band(y, 1.12, 1.17, 1.28, 1.32) * (1 - smooth(0.12, 0.15, ax));
      const ex = z - chestWall(y);
      z = chestWall(y) + ex + (soft(ex, K.chest, K.c) - ex) * m;
    }
    // 臀：后表面向臀线收
    if (/Hips|UpLeg/.test(inf.dom)) {
      const m = band(y, 0.70, 0.76, 0.97, 1.02);
      const ex = buttWall(y) - z;
      z = buttWall(y) - (ex + (soft(ex, K.butt, K.c) - ex) * m);
    }
    // 宽度：胯收窄、腰略宽、上胸随肩加宽
    const sx = 1 + (K.hip - 1) * band(y, 0.66, 0.78, 0.92, 1.0) + (K.waist - 1) * band(y, 0.98, 1.04, 1.10, 1.16) + K.chestW * smooth(1.16, 1.31, y) * (1 - smooth(1.33, 1.38, y));
    x *= sx;
  }
  return [x, y, z];
}

const e = 1e-4, minV = [Infinity, Infinity, Infinity], maxV = [-Infinity, -Infinity, -Infinity];
const Jm = new THREE.Matrix3(), n3 = new THREE.Vector3();
let maxMove = 0;
for (let i = 0; i < nv; i++) {
  const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], q = f(p, info[i]);
  const cols = [0, 1, 2].map((a) => { const pp = p.slice(); pp[a] += e; const r = f(pp, info[i]); return r.map((v, k) => (v - q[k]) / e); });
  Jm.set(cols[0][0], cols[1][0], cols[2][0], cols[0][1], cols[1][1], cols[2][1], cols[0][2], cols[1][2], cols[2][2]);
  Jm.invert().transpose();
  n3.set(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]).applyMatrix3(Jm).normalize();
  maxMove = Math.max(maxMove, Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]));
  for (let k = 0; k < 3; k++) { P[i * 3 + k] = q[k]; minV[k] = Math.min(minV[k], q[k]); maxV[k] = Math.max(maxV[k], q[k]); }
  N[i * 3] = n3.x; N[i * 3 + 1] = n3.y; N[i * 3 + 2] = n3.z;
}
json.accessors[0].min = minV; json.accessors[0].max = maxV;

// 骨骼：LeftArm / RightArm 节点沿世界 X 外移 sh；父节点（Shoulder）世界旋转换到局部；整条手臂链的 IBM 右乘 T(−Δ)
const world = new Map();
const walk = (n, parentM) => { const nd = json.nodes[n]; const m = new THREE.Matrix4();
  if (nd.matrix) m.fromArray(nd.matrix); else m.compose(new THREE.Vector3(...(nd.translation || [0, 0, 0])), new THREE.Quaternion(...(nd.rotation || [0, 0, 0, 1])), new THREE.Vector3(...(nd.scale || [1, 1, 1])));
  const w = parentM.clone().multiply(m); world.set(n, w); for (const c of nd.children || []) walk(c, w); };
for (const r of json.scenes[0].nodes) walk(r, new THREE.Matrix4());
for (const [side, name] of [[1, 'LeftArm'], [-1, 'RightArm']]) {
  const idx = json.nodes.findIndex((n) => n.name === 'mixamorig:' + name);
  const parent = json.nodes.findIndex((n) => (n.children || []).includes(idx));
  const d = new THREE.Vector3(side * K.sh, 0, 0);
  const pw = world.get(parent), pr = new THREE.Quaternion(), ps = new THREE.Vector3(); pw.decompose(new THREE.Vector3(), pr, ps);
  const local = d.clone().applyQuaternion(pr.invert()).divide(ps);
  const t = json.nodes[idx].translation; json.nodes[idx].translation = [t[0] + local.x, t[1] + local.y, t[2] + local.z];
  const T = new THREE.Matrix4().makeTranslation(-d.x, -d.y, -d.z);
  for (const j of armSet[side]) { const M = new THREE.Matrix4().fromArray(IBM, j * 16).multiply(T); M.toArray(IBM, j * 16); }
}
writeGlb(out, json, bin);
console.log('K', JSON.stringify(K), 'maxMove', maxMove.toFixed(4), 'm');
