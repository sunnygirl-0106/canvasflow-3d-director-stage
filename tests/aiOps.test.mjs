import { oldFields } from './migrate/pathModel.js';
// AI ops 词汇表 + 校验器单元测试（阶段 H 第 1 步）：node 直接跑，不起浏览器。
// 运行：npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOCAB, NOTES, MOVE_PARAM_KEYS, DEFAULT_POSE, vocabText } from '../src/ai/vocab.js';
import { validateOps, sceneIndex, uniqueName, opsText, OP_NAMES, PATH_FIELDS, IMAGE_OPS } from '../src/ai/ops.js';
import { BODY_TYPES, PROP_KINDS, RATIO_OPTIONS } from '../src/config.js';
import { POSE_PRESET_MAP } from '../src/entities/posePresets.js';
import { CAMERA_MOVES, MOVE_PARAMS, MOVE_DIRS } from '../src/anim/cameraMoves.js';
import { PATH_MODES } from '../src/anim/pathGen.js';
import { EASES, PATH_SPEEDS, PATH_ORIENTS, TRACK_PROPERTIES, CONSTRAINT_TYPES } from '../src/doc/schema.js';

const setEq = (a, b, msg) => assert.deepEqual([...new Set(a)].sort(), [...new Set(b)].sort(), msg);

// 场景：两个独立角色、一个机位、一个道具、一个组（含一名成员）
const SCENE = sceneIndex({
  entities: [
    { id: 'a', type: 'character', name: '小王', parent: null },
    { id: 'b', type: 'character', name: '小红', parent: null },
    { id: 'c', type: 'camera', name: '机位1' },
    { id: 'd', type: 'prop', name: '方块1' },
    { id: 'g', type: 'group', name: '组1', members: ['m'] },
    { id: 'm', type: 'character', name: '角色C', parent: 'g' },
  ],
});

// ---- 词汇表一致性 ----
test('词汇表 ≡ 代码枚举', () => {
  setEq(VOCAB.body, Object.keys(BODY_TYPES), '体型');
  setEq(VOCAB.prop, PROP_KINDS.map(([k]) => k), '道具');
  setEq(VOCAB.pose, Object.keys(POSE_PRESET_MAP), '姿势');
  setEq(VOCAB.move, CAMERA_MOVES.map(([k]) => k), '运镜');
  setEq(VOCAB.pathKind, PATH_MODES.map(([k]) => k).filter((k) => k !== 'freehand'), '路径 kind');
  setEq(VOCAB.arcDir, MOVE_DIRS.half_orbit.map(([k]) => k), '环绕方向');
  setEq(VOCAB.ease, EASES, 'ease');
  setEq(oldFields(VOCAB).speed, PATH_SPEEDS, 'speed');
  setEq(VOCAB.orient, PATH_ORIENTS, 'orient');
  setEq(VOCAB.property, TRACK_PROPERTIES, 'property');
  setEq(VOCAB.constraint, CONSTRAINT_TYPES, '约束');
  setEq(VOCAB.ratio, RATIO_OPTIONS.map(([k]) => k), '比例');
  assert.equal(DEFAULT_POSE, 'stand');
});

test('中文解释表的键 ≡ 代码枚举（不多不少）', () => {
  setEq(Object.keys(NOTES.move), CAMERA_MOVES.map(([k]) => k));
  setEq(Object.keys(NOTES.moveParam), Object.values(MOVE_PARAMS).flat());
  setEq(MOVE_PARAM_KEYS, Object.values(MOVE_PARAMS).flat());
  setEq(Object.keys(NOTES.pathKind), VOCAB.pathKind);
  setEq(Object.keys(PATH_FIELDS), VOCAB.pathKind);
  setEq(Object.keys(NOTES.ease), EASES);
  setEq(Object.keys(oldFields(NOTES).speed), PATH_SPEEDS);
  setEq(Object.keys(NOTES.orient), PATH_ORIENTS);
  setEq(Object.keys(NOTES.property), TRACK_PROPERTIES);
  setEq(Object.keys(NOTES.constraint), CONSTRAINT_TYPES);
});

test('词汇表文本包含每一个词', () => {
  const text = vocabText() + '\n' + opsText();
  const words = [
    ...VOCAB.body, ...VOCAB.prop, ...VOCAB.pose, ...VOCAB.move, ...VOCAB.pathKind, ...VOCAB.arcDir,
    ...VOCAB.ease, ...oldFields(VOCAB).speed, ...VOCAB.orient, ...VOCAB.property, ...VOCAB.constraint, ...VOCAB.ratio,
    ...MOVE_PARAM_KEYS, ...Object.values(MOVE_DIRS).flat().map(([k]) => k), ...OP_NAMES,
  ];
  const missing = words.filter((w) => !text.includes(w));
  assert.deepEqual(missing, []);
});

test('uniqueName：重名加数字后缀', () => {
  assert.equal(uniqueName('小王', new Set(['小红'])), '小王');
  assert.equal(uniqueName('小王', new Set(['小王'])), '小王2');
  assert.equal(uniqueName('小王', new Set(['小王', '小王2'])), '小王3');
});

// ---- 合法 ops ----
const GOOD = [
  { op: 'scene', sky: '#203040', ground: { visible: true, height: 0 }, ratio: '16:9', panorama: 'none' },
  { op: 'add_character', name: '老李', body: 'male', pos: [1, 0, 2], yaw: 180, pose: 'sit', color: '#ff8800' },
  { op: 'add_prop', name: '桌子', kind: 'box', pos: [0, 0, 1], yaw: 15, scale: 1.5 },
  { op: 'add_prop', name: '柱子', kind: 'cylinder', pos: [3, 0, 0], scale: [1, 2, 1] },
  { op: 'add_camera', name: '机位2', pos: [0, 1.4, 5], lookAt: '老李', fov: 35 },
  { op: 'add_camera', name: '机位3', pos: [4, 1.4, 4], lookAt: [0, 1, 0] },
  { op: 'add_group', name: '二人组', members: ['小王', '小红'] },
  { op: 'add_crowd', name: '路人', rows: 2, cols: 3, spacing: 1.1, pos: [-4, 0, -3], yaw: 0, body: 'female' },
  { op: 'move', target: '老李', pos: [1, 0, 3], yaw: 90 },
  { op: 'move', target: '机位3', pos: [5, 1.6, 5] },
  { op: 'set_pose', target: '老李', preset: 'wave' },
  { op: 'set_pose', target: '二人组', preset: 'cross' },
  { op: 'set_pose', target: '角色C', preset: 'think' },
  { op: 'set_path', target: '老李', path: { kind: 'toward', target: '桌子', stop: 1 }, start: 0.5, duration: 3, speed: 'linear', orient: 'keep' },
  { op: 'set_path', target: '二人组', path: { kind: 'line', to: [2, 0, -2] } },
  { op: 'set_path', target: '柱子', path: { kind: 'arc', center: '桌子', sweep: 90, dir: 'cw' } },
  { op: 'set_path', target: '机位2', path: { kind: 'points', points: [[1, 1.4, 5], [2, 1.4, 4]] } },
  { op: 'clear_path', target: '柱子' },
  { op: 'camera_move', target: '机位1', preset: 'half_orbit', subject: '老李', sweep: 180, dir: 'ccw', duration: 5 },
  { op: 'camera_move', target: '机位1', preset: 'push_in', amount: 1, append: true },
  { op: 'camera_move', target: '机位3', preset: 'truck', dir: 'right', subject: [0, 1, 0] },
  { op: 'camera_move', target: '机位3', preset: 'pan' },
  { op: 'clear_moves', target: '机位3' },
  { op: 'look_at', target: '机位3', subject: '角色C', start: 1, end: 4 },
  { op: 'follow', target: '机位2', subject: '老李', offset: [0, 1.5, -3] },
  { op: 'keyframe', target: '桌子', property: 'scale', t: 2, value: [1, 1, 1], ease: 'smooth' },
  { op: 'keyframe', target: '机位3', property: 'fov', t: 0, value: 50 },
  { op: 'timeline', duration: 8, fps: 24, mainCamera: '机位1' },
  { op: 'remove', target: '方块1' },
  { op: 'timeline', mainCamera: null },
];

test('合法 ops 全部通过（修改模式）', () => {
  const r = validateOps(GOOD, SCENE, { mode: 'modify' });
  assert.deepEqual(r.errors, []);
  assert.ok(r.ok);
});

test('生成模式：从空场景开始，clear 可省略；clear 在第一条合法', () => {
  const ops = [{ op: 'add_character', name: '小王', body: 'female', pos: [0, 0, 0] }, { op: 'add_camera', name: 'C', pos: [0, 1.4, 3], lookAt: '小王' }];
  const r = validateOps(ops, SCENE, { mode: 'generate' });
  assert.ok(r.ok, r.errors.join('\n'));
  assert.deepEqual(r.renames, {}); // 生成模式不与旧场景重名
  assert.ok(validateOps([{ op: 'clear' }, ...ops], SCENE, { mode: 'generate' }).ok);
  assert.ok(validateOps([{ op: 'clear' }, ...ops], SCENE, { mode: 'image' }).ok);
});

test('重名：第二个自动改名并记入 renames，之后按原名引用的是第一个', () => {
  const r = validateOps([
    { op: 'add_character', name: '甲', body: 'male', pos: [0, 0, 0] },
    { op: 'add_character', name: '甲', body: 'male', pos: [1, 0, 0] },
    { op: 'add_character', name: '小王', body: 'male', pos: [2, 0, 0] },
    { op: 'set_pose', target: '甲2', preset: 'wave' },
  ], SCENE);
  assert.ok(r.ok, r.errors.join('\n'));
  assert.deepEqual(r.renames, { 甲: '甲2', 小王: '小王2' });
});

// ---- 错误定位：每种错误各一例，断言路径 + 关键词 ----
const BAD = [
  ['ops 不是数组', { x: 1 }, 'ops 应为数组'],
  ['条目不是对象', [42], 'ops[0] 应为对象'],
  ['缺 op', [{ name: 'x' }], 'ops[0].op 缺少字段'],
  ['未知 op', [{ op: 'spawn' }], 'ops[0].op 未知操作 "spawn"，可选 clear'],
  ['缺必填字段', [{ op: 'add_character', name: 'x', pos: [0, 0, 0] }], 'ops[0].body 缺少字段'],
  ['未知字段', [{ op: 'add_prop', name: 'x', kind: 'box', pos: [0, 0, 0], size: 2 }], 'ops[0].size 是未知字段'],
  ['名字为空', [{ op: 'add_prop', name: '  ', kind: 'box', pos: [0, 0, 0] }], 'ops[0].name 应为非空字符串'],
  ['pos 少一个分量', [{ op: 'add_character', name: 'x', body: 'male', pos: [1, 0] }], 'ops[0].pos 应为长度 3 的数组'],
  ['pos 超范围', [{ op: 'add_prop', name: 'x', kind: 'box', pos: [0, 0, 51] }], 'ops[0].pos 应为有限数，范围 [-50..50]'],
  ['未知运镜', [{ op: 'camera_move', target: '机位1', preset: 'orbit' }], 'ops[0].preset 应为 push_in / pull_out'],
  ['未知体型', [{ op: 'add_character', name: 'x', body: 'robot', pos: [0, 0, 0] }], 'ops[0].body 应为 male / female'],
  ['未知姿势', [{ op: 'set_pose', target: '小王', preset: 'dance' }], 'ops[0].preset 应为 stand / tpose'],
  ['颜色格式', [{ op: 'add_prop', name: 'x', kind: 'box', pos: [0, 0, 0], color: 'red' }], 'ops[0].color 应为 #rrggbb'],
  ['时长超范围', [{ op: 'timeline', duration: 0 }], 'ops[0].duration 应为有限数，范围 (0..120]'],
  ['时长过长', [{ op: 'set_path', target: '小王', path: { kind: 'line', to: [1, 0, 1] }, duration: 121 }], 'ops[0].duration 应为有限数，范围 (0..120]'],
  ['引用不存在', [{ op: 'remove', target: '老张' }], 'ops[0].target 引用的实体不存在："老张"'],
  ['引用类型不对', [{ op: 'camera_move', target: '小王', preset: 'push_in' }], 'ops[0].target 应为机位，"小王" 是角色'],
  ['引用已删除', [{ op: 'remove', target: '小王' }, { op: 'move', target: '小王', pos: [0, 0, 0] }], 'ops[1].target 引用的实体已在 ops[0] 删除'],
  ['修改模式 clear', [{ op: 'clear' }], 'ops[0].op 修改模式不允许 clear'],
  ['clear 不在第一条', [{ op: 'scene', sky: '#000000' }, { op: 'clear' }], 'ops[1].op clear 必须是第一条', 'generate'],
  ['识图模式不允许的操作', [{ op: 'set_path', target: '小王', path: { kind: 'line', to: [1, 0, 1] } }], 'ops[0].op 识图模式不允许 "set_path"', 'image'],
  ['识图模式姿势', [{ op: 'add_character', name: 'x', body: 'male', pos: [0, 0, 0], pose: 'wave' }], 'ops[0].pose 识图模式姿势固定为 stand', 'image'],
  ['参数不属于该运镜', [{ op: 'camera_move', target: '机位1', preset: 'push_in', sweep: 90 }], 'ops[0].sweep 运镜 push_in 没有参数 sweep'],
  ['方向不属于该运镜', [{ op: 'camera_move', target: '机位1', preset: 'truck', dir: 'up' }], 'ops[0].dir 未知方向 "up"，truck 可选 left / right'],
  ['组成员不能单独移动', [{ op: 'move', target: '角色C', pos: [0, 0, 0] }], 'ops[0].target "角色C" 是组 "组1" 的成员'],
  ['打组不足 2 人', [{ op: 'add_group', name: 'g', members: ['小王'] }], 'ops[0].members 至少要 2 个角色'],
  ['打组成员已在组里', [{ op: 'add_group', name: 'g', members: ['小王', '角色C'] }], 'ops[0].members[1] "角色C" 是组 "组1" 的成员'],
  ['属性不适用', [{ op: 'keyframe', target: '小王', property: 'fov', t: 0, value: 40 }], 'ops[0].target 应为机位，"小王" 是角色'],
  ['fov 超范围', [{ op: 'keyframe', target: '机位1', property: 'fov', t: 0, value: 200 }], 'ops[0].value 应为有限数，范围 [10..120]'],
  ['缩放非正', [{ op: 'keyframe', target: '小王', property: 'scale', t: 0, value: [1, 0, 1] }], 'ops[0].value 应为有限数，范围 (0..10]'],
  ['区间 end ≤ start', [{ op: 'look_at', target: '机位1', subject: '小王', start: 3, end: 2 }], 'ops[0].end 应大于 start 3'],
  ['主体是自己', [{ op: 'look_at', target: '机位1', subject: '机位1' }], 'ops[0].subject 不能是自己'],
  ['move 什么都没给', [{ op: 'move', target: '小王' }], 'ops[0] move 至少要给 pos / yaw / scale 之一'],
  ['机位不能 yaw', [{ op: 'move', target: '机位1', yaw: 30 }], 'ops[0].yaw 机位不能用 yaw 转向'],
  ['路径类型未知', [{ op: 'set_path', target: '小王', path: { kind: 'spiral' } }], 'ops[0].path.kind 未知路径类型 "spiral"，可选 points / line / arc / toward'],
  ['路径字段缺失', [{ op: 'set_path', target: '小王', path: { kind: 'toward' } }], 'ops[0].path.target 缺少字段'],
  ['群众行数', [{ op: 'add_crowd', name: 'x', rows: 7, cols: 2, pos: [0, 0, 0] }], 'ops[0].rows 应为整数，范围 [1..6]'],
  ['群众行数非整数', [{ op: 'add_crowd', name: 'x', rows: 1.5, cols: 2, pos: [0, 0, 0] }], 'ops[0].rows 应为整数'],
  ['主机位不是机位', [{ op: 'timeline', mainCamera: '小王' }], 'ops[0].mainCamera 应为机位'],
  ['全景只能清除', [{ op: 'scene', panorama: 'beach' }], "ops[0].panorama 只能是 'none'"],
  ['重名实体无法引用', [{ op: 'remove', target: '重名' }], 'ops[0].target 场景里有多个叫 "重名" 的实体', 'modify',
    [...SCENE, { name: '重名', type: 'prop', parent: null }, { name: '重名', type: 'prop', parent: null }]],
];

for (const [title, ops, expect, mode = 'modify', scene = SCENE] of BAD) {
  test(`错误定位：${title}`, () => {
    const r = validateOps(ops, scene, { mode });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.startsWith(expect)), `期望以「${expect}」开头，实际：\n${r.errors.join('\n')}`);
  });
}

test('识图模式只允许 6 种操作', () => {
  assert.deepEqual(IMAGE_OPS, ['clear', 'scene', 'add_character', 'add_prop', 'add_camera', 'move']);
  for (const op of OP_NAMES.filter((o) => !IMAGE_OPS.includes(o))) {
    const r = validateOps([{ op }], SCENE, { mode: 'image' });
    assert.ok(r.errors[0].includes('识图模式不允许'), op);
  }
});

test('一条错 → 整批拒绝，多条错误全部列出', () => {
  const r = validateOps([
    { op: 'camera_move', target: '机位1', preset: 'orbit' },
    { op: 'add_character', name: 'x', body: 'male', pos: [0, 0] },
    { op: 'add_character', name: 'y', body: 'male', pos: [0, 0, 0] },
  ], SCENE);
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 2);
  assert.ok(r.errors[0].startsWith('ops[0].preset'));
  assert.ok(r.errors[1].startsWith('ops[1].pos'));
});
