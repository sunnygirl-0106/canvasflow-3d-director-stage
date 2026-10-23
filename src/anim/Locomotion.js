// 程序化步态（贴地方式："脚踩点 + 腿部 IK"）。纯函数，无状态。
//
// - 相位只按路径内经过的时间推进：每秒固定 1.6 个完整周期（左右各一步）。
// - 移动速度只影响步幅和站姿混合，不影响迈腿频率。
// - 与原姿势混合：w = clamp(speed / 0.5, 0, 1)，整身替换——所有关节从原姿势混合到步态姿势，
//   步态没用到的关节目标为 0（自然站立）。速度为 0 时 w = 0，就是原姿势。
// - 腿：正常步速下支撑脚钉在地上（脚跟着地 → 放平 → 脚尖蹬离）；超过步频上限时保留路径时序与慢步态，摆动脚走抬脚弧线到下一个落脚点；
//   骨盆高度 = 两条腿都够得着的最高处（软最小值，连续无跳变），髋 / 膝角由两段腿 IK 反解，踝角让脚底符合当前俯仰。
// - 手臂与同侧腿反相前后摆（±18°，肘屈 12°），躯干保持直立。
// - 关节一律写语义关节 values（jointSchema 键），不直接转骨头；骨盆起伏由调用方写到 model.position.y。
import { JOINT_KEYS, JOINT_SCHEMA } from '../rig/jointSchema.js';
import { clamp01, EASE } from './ease.js';
import { D2R, R2D } from '../util/math.js';

export const BLEND_SPEED = 0.5; // m/s，w 达到 1 的速度
// 起步短步：速度低于 STRIDE_FULL 时步幅（周期长度 / 支撑行程 / 抬脚）按 v / STRIDE_FULL 缩短（下限 STRIDE_MIN），
// 步频保持正常步速的水平。周期长度固定的话步频 ∝ 速度，起步加速段腿会像慢动作；适当保留步幅，避免小步快迈。
export const STRIDE_FULL = 0.7; // m/s，≥ 全步幅，普通步速即可迈开完整步幅
export const STRIDE_MIN = 0.3;
export const GAIT_CYCLES_PER_SECOND = 1.6; // 每分钟 192 步，角色身高、路径长短均不改变节奏。

// 走路参数。cycle：周期长度 / 身高；reach：支撑期内支撑脚相对髋的前后行程 / 身高
// （支撑期占比 = reach / cycle > 0.5，始终有脚着地）；
// lift：摆动脚抬起高度 / 腿长；heel / toe：脚跟着地时脚尖上翘角 / 蹬离时脚跟抬起角（度）；
// arm / abd / elbow / lean：手臂摆幅、外展（手不擦过大腿 / 胯）、肘屈、躯干前倾（度）。
export const GAIT = {
  walk: { cycle: 0.7, reach: 0.385, lift: 0.08, heel: 12, toe: 25, arm: 18, abd: 8, elbow: 12, lean: 0 },
};
const REACH = 0.99;    // 腿最多伸到全长的比例（留一点膝弯，IK 不在奇点附近抖）
const SOFTMIN_K = 0.03; // 骨盆软最小值的平滑尺度（米）
const PELVIS_GRID = 48; // 骨盆曲线在一个周期内的采样数
const PELVIS_WIN = 4;   // 平滑窗口半宽（采样数）：先滑动最小、再同宽均值
const START_PHASE = 0.3; // 路程 0 处的相位：左腿支撑中段（骨盆最高），从站立起步时骨盆下沉最少

const JOINT_RANGE = Object.fromEntries(JOINT_SCHEMA.map((j) => [j.key, [j.min, j.max]]));

const lerp = (a, b, k) => a + (b - a) * k;
const frac = (x) => x - Math.floor(x);
const clampJoint = (key, v) => Math.min(Math.max(v, JOINT_RANGE[key][0]), JOINT_RANGE[key][1]);

/** 与原姿势的混合权重。 */
export const gaitWeight = (speed) => clamp01(speed / BLEND_SPEED);

/** 起步短步的步幅缩放（≤ 1）。 */
export const strideScale = (speed) => Math.min(1, Math.max(STRIDE_MIN, speed / STRIDE_FULL));

/** σ = 起步短步缩放（周期、支撑行程、抬脚同比缩，支撑期占比不变）。 */
function params(sigma = 1) {
  const P = { ...GAIT.walk };
  P.cycle *= sigma;
  P.reach *= sigma;
  P.lift *= sigma;
  P.stance = Math.min(0.7, P.reach / P.cycle);
  return P;
}

/** 平滑最小值（多项式 smin），保证骨盆高度连续且没有折角。 */
function smin(a, b, k) {
  const h = clamp01(0.5 + 0.5 * (b - a) / k);
  return lerp(b, a, h) - k * h * (1 - h);
}

/** 二维向量 [y,z] 绕 X 轴转 a（正 = 脚尖上翘，即 z 前方向朝 y 上转）。 */
function rot([y, z], a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [y * c + z * s, z * c - y * s];
}

/**
 * 每条腿的静态量（只依赖站立几何，按 legGeom 缓存）。
 * 角度约定（矢状面）：腿段"前摆角" = 段向量相对竖直向下、朝 +z 的偏角。
 */
const _legCache = new WeakMap();
function legStatics(geom) {
  let s = _legCache.get(geom);
  if (s) return s;
  const seg = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const swing = (a, b) => Math.atan2(b[1] - a[1], a[0] - b[0]); // 从 a 指向 b 的前摆角
  s = geom.legs.map((L) => {
    const lt = seg(L.hip, L.knee), ls = seg(L.knee, L.ankle);
    const t0 = swing(L.hip, L.knee), s0 = swing(L.knee, L.ankle);
    return {
      lt, ls, t0, s0,
      sole: L.sole.map((q) => [q[0] - L.ankle[0], q[1] - L.ankle[1]]), // 脚底采样点相对踝（站立、脚放平）
      soleMin: Math.min(...L.sole.map((q) => q[0] - L.ankle[0])),
      ankle: L.ankle, hip: L.hip,
    };
  });
  _legCache.set(geom, s);
  return s;
}

/**
 * 脚以俯仰 ψ 滚动着地时踝的位置：接触点 = 转过 ψ 后最低的脚底采样点；它贴在地面上，
 * 并停在脚放平时它所在的水平位置（滚动不滑动），踝由它反推。脚底是弧面，固定脚跟 / 脚尖支点会悬空或入地。
 */
function rolledAnkle(L, flatAnkle, psi) {
  let q = null, r = null;
  for (const s of L.sole) {
    const t = rot(s, psi);
    if (!r || t[0] < r[0]) { q = s; r = t; }
  }
  return [flatAnkle[0] + L.soleMin - r[0], flatAnkle[1] + q[1] - r[1]];
}

/**
 * 一条腿在腿相位 p（0 = 脚跟着地）时的踝目标 [y,z]（相对站立 root 坐标）与脚底俯仰 ψ（弧度，正 = 脚尖上翘）。
 * 支撑期 [0, β)：脚相对髋以步速后移，接触点不动（脚跟着地 → 放平 → 脚尖蹬离，滚动接触）；
 * 摆动期 [β, 1)：从蹬离位姿平滑移到下一次着地位姿，叠加抬脚弧线。
 */
function footAt(p, L, P, stride, legLen) {
  const beta = P.stance;
  const heelA = P.heel * D2R, toeA = -P.toe * D2R;
  // 放平时踝的 z：在支撑期中点经过髋下方（相对站立踝位置）
  const flatZ = (q) => L.ankle[1] + stride * (beta / 2 - q);
  const stanceAt = (q) => {
    const r1 = 0.18 * beta, r2 = 0.55 * beta; // 脚跟滚动段 / 脚尖蹬离段的分界
    const psi = q < r1 ? heelA * (1 - EASE.smooth(q / r1)) : q > r2 ? toeA * EASE.smooth((q - r2) / (beta - r2)) : 0;
    return { a: rolledAnkle(L, [L.ankle[0], flatZ(q)], psi), psi };
  };
  if (p < beta) return stanceAt(p);
  const u = (p - beta) / (1 - beta);
  const e = EASE.smooth(u);
  const from = stanceAt(beta);
  const to = stanceAt(0); // 下一次着地：相对髋的位置与本次着地时相同（一个周期身体恰好前进一个周期长度）
  return {
    // 抬脚弧线用 sin²：离地 / 落地时竖直速度为 0（sin 在落地前下降最快，会把骨盆一帧拽下几厘米）
    a: [lerp(from.a[0], to.a[0], e) + P.lift * legLen * Math.sin(Math.PI * u) ** 2, lerp(from.a[1], to.a[1], e)],
    psi: lerp(from.psi, to.psi, e),
  };
}

/**
 * 两段腿 IK（矢状面）：髋在 hip，踝目标 a → 大腿前摆角、膝屈角、小腿前摆角（弧度）。
 * 膝朝前弯；够不着时腿伸到 REACH 上限（脚会略微离开目标）。
 */
function solveLeg(hip, a, S) {
  const dy = a[0] - hip[0], dz = a[1] - hip[1];
  const max = (S.lt + S.ls) * 0.9999, min = Math.abs(S.lt - S.ls) + 1e-6;
  const d = Math.min(Math.max(Math.hypot(dy, dz), min), max);
  const line = Math.atan2(dz, -dy);
  const cosA = (S.lt * S.lt + d * d - S.ls * S.ls) / (2 * S.lt * d);
  const cosG = (S.lt * S.lt + S.ls * S.ls - d * d) / (2 * S.lt * S.ls);
  const thigh = line + Math.acos(Math.min(1, Math.max(-1, cosA)));
  const knee = Math.PI - Math.acos(Math.min(1, Math.max(-1, cosG)));
  return { thigh, knee, shank: thigh - knee };
}

/** 某相位的骨盆原始高度变化：每条腿都够得着（踝到髋 ≤ REACH×腿长）的最高处（软最小值），≤ 0。 */
function rawDrop(S, feet) {
  let hipY = S[0].hip[0];
  S.forEach((L, i) => {
    const r = REACH * (L.lt + L.ls);
    const dz = feet[i].a[1] - L.hip[1];
    const reach = feet[i].a[0] + Math.sqrt(Math.max(0, r * r - dz * dz));
    hipY = smin(hipY, reach + (S[0].hip[0] - L.hip[0]), SOFTMIN_K);
  });
  return Math.min(0, hipY - S[0].hip[0]);
}

/**
 * 骨盆高度变化（相位域平滑，无状态）：原始曲线在脚跟着地时是 V 形，会一帧掉好几厘米。
 * 在一个周期的网格上先做滑动最小（腐蚀）、再做同宽均值：结果处处 ≤ 原始值（脚始终够得着地），且没有尖角。
 */
function pelvisDrop(S, feetAt, phase) {
  const N = PELVIS_GRID, W = PELVIS_WIN;
  const base = Math.floor(phase * N);
  const u = phase * N - base;
  const raw = new Map();
  const r = (i) => { if (!raw.has(i)) raw.set(i, rawDrop(S, feetAt(i / N))); return raw.get(i); };
  const ero = (i) => { let m = 0; for (let j = -W; j <= W; j++) m = Math.min(m, r(i + j)); return m; };
  const blur = (i) => { let sum = 0; for (let j = -W; j <= W; j++) sum += ero(i + j); return sum / (2 * W + 1); };
  return lerp(blur(base), blur(base + 1), u);
}

/**
 * 步态姿势（w=1 时的完整步态）。
 * @param {object} geom Character.legGeom
 * @param {number} phase 周期数（可大于 1）
 * @param {number} [speed] 速度（m/s；决定起步短步缩放，省略 = 全步幅）
 * @returns {{values:Object<string,number>, drop:number}} drop：骨盆相对站立的高度变化（米，≤ 0，相对素体尺寸）
 */
export function gaitPose(geom, phase, speed = Infinity) {
  const P = params(strideScale(speed));
  const S = legStatics(geom);
  const stride = P.cycle * geom.height;
  const feetAt = (ph) => S.map((L, i) => footAt(frac(ph + i * 0.5), L, P, stride, L.lt + L.ls));
  const feet = feetAt(phase);
  const drop = pelvisDrop(S, feetAt, phase);

  const values = {};
  S.forEach((L, i) => {
    const side = i ? 'r' : 'l';
    const hip = [L.hip[0] + drop, L.hip[1]];
    const { thigh, knee, shank } = solveLeg(hip, feet[i].a, L);
    values[`${side}LegFwd`] = clampJoint(`${side}LegFwd`, (thigh - L.t0) * R2D);
    values[`${side}Knee`] = clampJoint(`${side}Knee`, (knee - (L.t0 - L.s0)) * R2D);
    // 脚的俯仰 = 小腿前摆变化 − 绷脚；要让脚底俯仰 = ψ
    values[`${side}Foot`] = clampJoint(`${side}Foot`, ((shank - L.s0) - feet[i].psi) * R2D);
  });
  // 手臂与同侧腿反相：左脚着地（左腿最靠前）时左臂最靠后
  const armL = -Math.cos(2 * Math.PI * frac(phase));
  values.lArmFwd = P.arm * armL;
  values.rArmFwd = -P.arm * armL;
  values.lArmAbd = P.abd;
  values.rArmAbd = P.abd;
  values.lFore = P.elbow;
  values.rFore = P.elbow;
  values.spineX = P.lean;
  return { values, drop };
}

/**
 * 整身混合：out[key] = lerp(base[key], gait[key] ?? 0, w)；骨盆起伏同样乘 w。
 * @param {Object<string,number>} base 原姿势 values
 * @param {object} geom Character.legGeom（null 时只混合手臂 / 躯干，不做腿）
 * @param {{speed:number, phase:number, blend?:number}} m blend 只控制与站姿的衔接，不改变步频。
 * @returns {{values:Object<string,number>, drop:number, w:number}}
 */
export function locomotionPose(base, geom, { speed, phase, blend = 1 }) {
  const w = gaitWeight(speed) * clamp01(blend);
  const g = geom ? gaitPose(geom, phase, speed) : { values: {}, drop: 0 };
  const values = {};
  for (const key of JOINT_KEYS) values[key] = lerp(base[key] || 0, g.values[key] || 0, w);
  return { values, drop: g.drop * w, w };
}

/**
 * 把步态写到角色上（Timeline 在写入 transform 之后调用）。
 * 骨盆高度：w=1 时 = 站立高度 + drop（脚踩点 IK 算出的起伏）；0<w<1 时与原姿势的自动贴地结果按 w 混合，连续过渡；
 * 介入期间 autoGround=false，w=0 时恢复 autoGround=true 并重新贴地（就是原姿势）。
 * @param {import('../entities/Character.js').Character} ch
 * @param {Object<string,number>} base 原姿势 values
 * @param {{speed:number, gaitTime:number, blend?:number}} motion 来自 PathTrack
 * @param {number} scale 角色相对素体自然尺寸的缩放（含所在组的缩放）
 * @param {number} [phaseOffset] 相位偏移（周期数；群众成员错开步伐）
 * @returns {{w:number, phase:number}}
 */
export function applyLocomotion(ch, base, motion, _scale, phaseOffset = 0) {
  const phase = START_PHASE + motion.gaitTime * GAIT_CYCLES_PER_SECOND + phaseOffset;
  const g = locomotionPose(base, ch.legGeom, { speed: motion.speed, phase, blend: motion.blend });
  Object.assign(ch.values, g.values);
  ch.autoGround = true;
  ch.applyPose();
  if (g.w > 0) {
    const yAuto = ch.model.position.y;
    ch.autoGround = false;
    ch.model.position.y = lerp(yAuto, ch.standModelY + g.drop / ch.baseScale, g.w);
  }
  return { w: g.w, phase };
}
