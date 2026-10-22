// AI 词汇表：从代码里的枚举生成，不手抄任何一个词。
// 提示词（prompt.js）、ops 校验器（ops.js）、README「AI 生成」三处都用这里的同一份表。
// 本文件只补"中文解释"：解释表按代码枚举的值做键，tests/ai.test.mjs 断言键集合与代码枚举逐项相等
// （代码里加了新预设而没补解释 → 单测失败；解释表里多出代码没有的词 → 同样失败）。
import { BODY_TYPES, PROP_KINDS, RATIO_OPTIONS } from '../config.js';
import { POSE_PRESETS } from '../entities/posePresets.js';
import { CAMERA_MOVES, MOVE_PARAMS, MOVE_DIRS, MOVE_DURATION } from '../anim/cameraMoves.js';
import { PATH_MODES } from '../anim/pathGen.js';
import { EASES, PATH_SPEEDS, PATH_ORIENTS, TRACK_PROPERTIES, CONSTRAINT_TYPES, FOV_RANGE } from '../doc/schema.js';

// ---- 中文解释（键 = 代码枚举值）----
export const NOTES = {
  move: {
    push_in: '推：沿机位→主体的水平连线靠近',
    pull_out: '拉：沿连线远离主体',
    truck: '横移：垂直于连线水平平移（左右以机位视角为准）',
    crane: '升降：竖直平移',
    pan: '摇：机位不动，从当前朝向摇到对准主体',
    half_orbit: '半环绕：以主体为圆心、当前水平距离为半径、在当前高度绕行',
    circle: '环绕：同半环绕，默认绕满一整圈（闭合）',
  },
  moveParam: {
    amount: '距离（米；推默认当前距离 × 0.4、拉 × 0.6、横移 2、升降 1；推进后离主体至少留 0.3 m）',
    dir: '方向',
    sweep: '扫过角度（度，0–360；半环绕默认 180、环绕 360）',
  },
  pathKind: {
    points: '从实体当前位置出发，依次经过 points 里的点',
    line: '从实体当前位置直线走到 to（坐标或实体名）',
    arc: '以 center（坐标或实体名）为圆心、当前位置到圆心的水平距离为半径绕行 sweep 度（默认 180，dir 默认 ccw）',
    toward: '朝 target（实体名）走，停在它前方 stop 米处（水平距离；角色默认 0.8，机位默认 1.5）',
  },
  ease: { linear: '线性插值', smooth: '缓入缓出', step: '阶跃（保持到下一键）' },
  speed: { linear: '匀速（人物 / 群众默认）', smooth: '缓入缓出（机位 / 道具默认，人物始终匀速）' },
  orient: { tangent: '朝向跟随路径切线（角色 / 道具 / 组默认）', keep: '保持原朝向（机位默认）' },
  property: {
    pos: '位置 [x,y,z]（米）',
    rot: '旋转 [x,y,z]（XYZ 欧拉角，度）',
    scale: '缩放 [x,y,z]（倍数，机位不可用）',
    fov: `视野（度，${FOV_RANGE[0]}–${FOV_RANGE[1]}，只有机位）`,
  },
  constraint: {
    lookAt: '注视：机位始终对准主体（look_at）',
    follow: '跟随：机位与主体保持相对位置刚性跟随（follow）',
  },
};

/** 不给 AI 用的路径绘制方式：手绘需要指针轨迹，没有对应的数据描述。 */
const POINTER_ONLY_PATH_MODES = new Set(['freehand']);

// ---- 词汇表（全部从代码枚举生成）----
export const BODIES = Object.entries(BODY_TYPES).map(([key, b]) => ({ key, label: b.label, note: `身高 ${b.height} m` }));
export const PROPS = PROP_KINDS.map(([key, label]) => ({ key, label }));
export const POSES = POSE_PRESETS.map(({ key, label }) => ({ key, label }));
/** 默认姿势 = 没有任何关节增量的预设（自然站立）。识图模式固定用它。 */
export const DEFAULT_POSE = POSE_PRESETS.find((p) => !p.special && !Object.keys(p.values || {}).length).key;
export const MOVES = CAMERA_MOVES.map(([key, label]) => ({
  key, label, note: NOTES.move[key],
  params: MOVE_PARAMS[key],
  dirs: (MOVE_DIRS[key] || []).map(([k, l]) => ({ key: k, label: l })),
  duration: MOVE_DURATION[key],
}));
export const MOVE_PARAM_KEYS = [...new Set(Object.values(MOVE_PARAMS).flat())];
export const PATH_KINDS = PATH_MODES.filter(([k]) => !POINTER_ONLY_PATH_MODES.has(k)).map(([key, label]) => ({ key, label, note: NOTES.pathKind[key] }));
/** 环绕路径的 dir：与环绕运镜同一组取值（俯视 ccw = 逆时针）。 */
export const ARC_DIRS = MOVE_DIRS.half_orbit.map(([key, label]) => ({ key, label }));
export const EASE_LIST = EASES.map((key) => ({ key, note: NOTES.ease[key] }));
export const SPEED_LIST = PATH_SPEEDS.map((key) => ({ key, note: NOTES.speed[key] }));
export const ORIENT_LIST = PATH_ORIENTS.map((key) => ({ key, note: NOTES.orient[key] }));
export const PROPERTY_LIST = TRACK_PROPERTIES.map((key) => ({ key, note: NOTES.property[key] }));
export const CONSTRAINT_LIST = CONSTRAINT_TYPES.map((key) => ({ key, note: NOTES.constraint[key] }));
export const RATIOS = RATIO_OPTIONS.map(([key, label]) => ({ key, label }));

export const keysOf = (list) => list.map((x) => x.key);

/** 各词汇集合（校验器用；集合即代码枚举）。 */
export const VOCAB = {
  body: keysOf(BODIES),
  prop: keysOf(PROPS),
  pose: keysOf(POSES),
  move: keysOf(MOVES),
  pathKind: keysOf(PATH_KINDS),
  arcDir: keysOf(ARC_DIRS),
  ease: EASES.slice(),
  speed: PATH_SPEEDS.slice(),
  orient: PATH_ORIENTS.slice(),
  property: TRACK_PROPERTIES.slice(),
  constraint: CONSTRAINT_TYPES.slice(),
  ratio: keysOf(RATIOS),
};

const join = (list, f) => list.map(f).join(' / ');

/** 词汇表文本（提示词 / README 共用）。 */
export function vocabText() {
  const moveLines = MOVES.map((m) => {
    const params = m.params.map((p) => (p === 'dir' ? `dir（${join(m.dirs, (d) => `${d.key} ${d.label}`)}）` : p));
    return `- ${m.key}（${m.note}）· 参数：${params.length ? params.join('、') : '无'} · 默认时长 ${m.duration} s`;
  });
  return [
    `体型 body：${join(BODIES, (b) => `${b.key}（${b.label}，${b.note}）`)}`,
    `姿势 pose：${join(POSES, (p) => `${p.key}（${p.label}）`)}`,
    `道具 kind：${join(PROPS, (p) => `${p.key}（${p.label}）`)}`,
    '运镜 preset（camera_move）：',
    ...moveLines,
    `运镜参数：${MOVE_PARAM_KEYS.map((k) => `${k} = ${NOTES.moveParam[k]}`).join('；')}`,
    '路径 path.kind（set_path）：',
    ...PATH_KINDS.map((k) => `- ${k.key}（${k.label}）：${k.note}`),
    `环绕路径 dir：${join(ARC_DIRS, (d) => `${d.key}（${d.label}，俯视）`)}`,
    `路径速度 speed：${join(SPEED_LIST, (s) => `${s.key}（${s.note}）`)}`,
    `路径朝向 orient：${join(ORIENT_LIST, (s) => `${s.key}（${s.note}）`)}`,
    `关键帧属性 property：${join(PROPERTY_LIST, (s) => `${s.key}（${s.note}）`)}`,
    `缓动 ease：${join(EASE_LIST, (s) => `${s.key}（${s.note}）`)}`,
    `约束：${join(CONSTRAINT_LIST, (s) => `${s.key}（${s.note}）`)}`,
    `取景比例 ratio：${join(RATIOS, (r) => r.key)}`,
  ].join('\n');
}
