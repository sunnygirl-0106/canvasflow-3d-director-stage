// 把 bodychan_female 调得中性一点：胸 / 臀整体缩小（仍圆润）、胯收窄、腰略宽、肩加宽（手臂骨骼 + 网格同步外移）。
// 直接改 GLB 的 POSITION / NORMAL / 手臂节点平移 / inverseBindMatrices，其余（骨骼轴向、权重、索引）逐字节不动；法线按变形雅可比的逆转置变换。
// 输入必须是【原始】模型（已处理过的再跑会叠加）：
//   git show 1bb3f44:public/assets/figures/bodychan_female.glb > /tmp/orig.glb
//   node scripts/figure-neutral.mjs /tmp/orig.glb /tmp/stage.glb [chest=0.16 butt=0.2 …]
//   然后跑 scripts/figure-bust.py（Blender）把胸形收圆，输出到 public/assets/figures/bodychan_female.glb
// 参数：chest / butt = 胸 / 臀峰朝内部中心缩的比例（整体缩小，保持圆形）；hip / waist = 胯 / 腰宽度增量（高斯带峰值，-0.11 即外侧 ×0.89）；sh = 每侧肩外移（米）；chestW = 上胸加宽比例。
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
const K = { chest: 0.16, butt: 0.2, hip: -0.11, waist: 0.08, sh: 0.03, chestW: 0.05, ...Object.fromEntries(kv.map((s) => s.split('=')).map(([k, v]) => [k, +v])) };
const { json, bin, acc } = readGlb(src);
const P = acc(0), N = acc(1), J = acc(2), W = acc(3), IBM = acc(5);
const sk = json.skins[0], jn = sk.joints.map((n) => json.nodes[n].name.replace('mixamorig:', ''));
const nodeJoint = new Map(sk.joints.map((n, j) => [n, j]));
const nv = P.length / 3;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
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

function f(p, inf) {
  let [x, y, z] = p;
  const ax = Math.abs(x);
  if (inf.aw > 0) x += inf.side * K.sh * inf.aw; // 手臂整体外移（与骨骼同步）
  const torso = !/Arm|Hand|Fore|Head|Neck/.test(inf.dom);
  if (torso && inf.aw < 0.5) {
    // 胸 / 臀：朝内部中心整体缩而不是只压前后厚度——只压厚度会把圆弧压成斜坡 + 平顶
    // （胸形的进一步收圆在 Blender 里做，见 scripts/figure-bust.py）
    const pull = (cx, cy, cz, ox, oy, oz, sg, k, kx = 1) => {
      let dx = 0, dy = 0, dz = 0;
      for (const sd of [1, -1]) {
        const w = Math.exp(-((x - sd * cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2) / (2 * sg * sg)) * k;
        dx += w * kx * (sd * ox - x); dy += w * (oy - y); dz += w * (oz - z);
      }
      x += dx; y += dy; z += dz;
    };
    pull(0.070, 1.224, 0.154, 0.070, 1.21, 0.06, 0.055, K.chest);
    // 臀：每侧臀峰 (±6.5, 89.5, −10.2 cm) 附近朝臀内中心点缩（σ 7 cm），左右叠加，往外自然衰减到 0，无边界
    pull(0.065, 0.895, -0.102, 0.065, 0.87, 0, 0.07, K.butt, 0); // 左右不收：否则大腿内侧被推向外，撞跑步摆臂的手
    // 宽度用宽高斯带（σ 6–8 cm）平滑过渡，不出台阶 / 鼓包：腰 (y≈1.075) 加宽、胯 + 大腿根 (y≈0.80) 外侧收窄、上胸随肩略加宽
    const g = (m, sg) => Math.exp(-((y - m) ** 2) / (2 * sg * sg));
    // 胯只收外侧：|x| 超过 6 cm 的部分按比例往里收（softplus 过渡宽 1.5 cm 无折痕），大腿内侧 / 裆部不动，免得大腿整体内移撞上摆臂的手
    const sp = (d, w) => w * Math.log1p(Math.exp(d / w));
    const sx = 1 + K.waist * g(1.075, 0.06) + K.chestW * smooth(1.16, 1.31, y) * (1 - smooth(1.33, 1.38, y));
    x = x * sx + Math.sign(x) * K.hip * g(0.80, 0.08) * sp(ax - 0.06, 0.015);
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
