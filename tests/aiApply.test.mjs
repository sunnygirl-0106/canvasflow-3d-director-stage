// ops 编译 / 场景摘要 / 提示词范例单元测试（阶段 H 第 3–4 步）：node 直接跑，不起浏览器。
// 运行：npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileOps, summarize, docAimPoint } from '../src/ai/apply.js';
import { validateOps, sceneIndex } from '../src/ai/ops.js';
import { EXAMPLES, systemPrompt, userMessage, retryMessage, aiVocabMarkdown, README_MARKERS } from '../src/ai/prompt.js';
import fs from 'node:fs';
import { parseReply } from '../src/ai/agent.js';
import { VOCAB, MOVE_PARAM_KEYS } from '../src/ai/vocab.js';
import { OP_NAMES } from '../src/ai/ops.js';
import { createEmptyDocument, validate } from '../src/doc/schema.js';
import { BODY_TYPES } from '../src/config.js';

const hd = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const last = (a) => a[a.length - 1];
const byName = (doc, n) => doc.entities.find((e) => e.name === n);

/** validate → compile → 文档校验（与 applyOps 同流程，只是不加载）。 */
function run(base, ops, mode = 'modify') {
  const v = validateOps(ops, sceneIndex(base), { mode });
  assert.deepEqual(v.errors, [], '校验');
  const r = compileOps(base, ops, { mode });
  assert.deepEqual(r.errors, [], '执行');
  assert.deepEqual(validate(r.doc).errors, [], '文档校验');
  return r;
}

const GEN = [
  { op: 'clear' },
  { op: 'scene', sky: '#8899AA' },
  { op: 'add_character', name: '小红', body: 'female', pos: [-0.8, 0, 0], yaw: 90, pose: 'wave' },
  { op: 'add_character', name: '小王', body: 'male', pos: [0.8, 0, 0], yaw: -90, pose: 'sit' },
  { op: 'add_camera', name: '机位1', pos: [0, 1.4, 3], lookAt: [0, 0.8, 0] },
  { op: 'camera_move', target: '机位1', preset: 'half_orbit', subject: '小红' },
  { op: 'timeline', duration: 5 },
];

test('生成：实体 / 姿势 / 机位路径 + 注视 / 时长 / 自动主机位', () => {
  const base = createEmptyDocument();
  base.entities.push({ type: 'prop', id: 'old00001', name: '旧方块', kind: 'box', color: '#ffffff', visible: true, transform: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] } });
  const { doc, warnings } = run(base, GEN, 'generate');
  assert.equal(doc.entities.length, 3);
  assert.equal(byName(doc, '小红').pose.preset, 'wave');
  assert.equal(byName(doc, '小王').pose.preset, 'sit');
  const cam = byName(doc, '机位1');
  assert.equal(doc.paths[0].target, cam.id);
  assert.equal(doc.constraints[0].type, 'lookAt');
  assert.equal(doc.constraints[0].subject, byName(doc, '小红').id);
  assert.equal(doc.timeline.duration, 5);
  assert.equal(doc.timeline.mainCameraId, cam.id);
  assert.equal(doc.scene.activeCameraId, cam.id);
  assert.equal(doc.scene.sky, '#8899aa');
  assert.ok(warnings.some((w) => w.includes('主机位')));
  // 半环绕：半径恒定、高度不变
  const center = docAimPoint(doc, byName(doc, '小红').id);
  const radii = doc.paths[0].points.map((p) => hd(p, center));
  assert.ok(Math.max(...radii) - Math.min(...radii) < 1e-3);
});

test('修改：站起来走到旁边 0.8 m、运镜换成推、其它实体不动', () => {
  const g = run(createEmptyDocument(), GEN, 'generate').doc;
  const { doc } = run(g, [
    { op: 'set_pose', target: '小王', preset: 'stand' },
    { op: 'set_path', target: '小王', path: { kind: 'toward', target: '小红' } },
    { op: 'clear_moves', target: '机位1' },
    { op: 'camera_move', target: '机位1', preset: 'push_in', subject: '小红' },
  ]);
  const wang = byName(doc, '小王');
  const path = doc.paths.find((p) => p.target === wang.id);
  assert.ok(Math.abs(hd(last(path.points), byName(doc, '小红').transform.pos) - 0.8) < 1e-6);
  assert.equal(path.orient, 'tangent');
  const camPath = doc.paths.find((p) => p.target === byName(doc, '机位1').id);
  assert.equal(camPath.points.length, 2);
  assert.equal(doc.constraints.length, 1);
  assert.deepEqual(byName(doc, '小红'), byName(g, '小红'));
});

test('重名 → renames；删除连带清理引用；follow 默认偏移 = 当前相对位置', () => {
  const g = run(createEmptyDocument(), GEN, 'generate').doc;
  const r = run(g, [
    { op: 'add_character', name: '小王', body: 'small', pos: [3, 0, 3] },
    { op: 'follow', target: '机位1', subject: '小红' },
    { op: 'remove', target: '小红' },
  ]);
  assert.deepEqual(r.renames, { 小王: '小王2' });
  assert.ok(byName(r.doc, '小王2'));
  assert.equal(r.doc.constraints.length, 0); // 注视 + 跟随都引用了小红
  const r2 = run(g, [{ op: 'follow', target: '机位1', subject: '小红' }]);
  const f = r2.doc.constraints.find((c) => c.type === 'follow');
  // 小红 yaw 90：偏移在其 yaw 坐标系下 —— 世界偏移 (0.8, 1.4, 3) 绕 Y 转 −90° → (−3, 1.4, 0.8)
  assert.deepEqual(f.offset.map((v) => Math.round(v * 1e4) / 1e4), [-3, 1.4, 0.8]);
});

test('群众 / 打组 / 关键帧 / 道具 / 路径各种写法', () => {
  const g = run(createEmptyDocument(), GEN, 'generate').doc;
  const { doc } = run(g, [
    { op: 'add_crowd', name: '路人', rows: 2, cols: 2, pos: [0, 0, -4] },
    { op: 'add_group', name: '主角', members: ['小红', '小王'] },
    { op: 'set_pose', target: '路人', preset: 'cross' },
    { op: 'set_path', target: '路人', path: { kind: 'line', to: [2, 0, -4] }, duration: 3 },
    { op: 'add_prop', name: '球', kind: 'sphere', pos: [2, 0, 2], scale: 0.5 },
    { op: 'set_path', target: '球', path: { kind: 'arc', center: [2, 0, 0], sweep: 360 } },
    { op: 'keyframe', target: '机位1', property: 'fov', t: 0, value: 40 },
    { op: 'keyframe', target: '机位1', property: 'fov', t: 4, value: 25, ease: 'smooth' },
    { op: 'keyframe', target: '主角', property: 'rot', t: 2, value: [0, 45, 0] },
  ]);
  const crowd = byName(doc, '路人');
  assert.equal(crowd.members.length, 4);
  assert.ok(crowd.members.every((id) => doc.entities.find((e) => e.id === id).pose.preset === 'cross'));
  assert.equal(doc.paths.find((p) => p.target === crowd.id).duration, 3);
  const ball = doc.paths.find((p) => p.target === byName(doc, '球').id);
  assert.equal(ball.closed, true);
  assert.equal(doc.timeline.tracks.find((t) => t.property === 'fov').keys.length, 2);
  assert.equal(byName(doc, '小红').parent, byName(doc, '主角').id);
});

test('执行期错误带定位且第一处即停：推过头 / 走到太近 / 有路径还打位置键', () => {
  const g = run(createEmptyDocument(), GEN, 'generate').doc;
  const bad = (ops, expect) => {
    const r = compileOps(g, ops, { mode: 'modify' });
    assert.ok(r.errors[0]?.startsWith(expect), r.errors.join('\n'));
  };
  bad([{ op: 'camera_move', target: '机位1', preset: 'push_in', subject: '小红', amount: 10 }], 'ops[0] 运镜 push_in（推）无法生成：推进距离过大');
  bad([{ op: 'move', target: '小王', pos: [-0.5, 0, 0] }, { op: 'set_path', target: '小王', path: { kind: 'toward', target: '小红' } }], 'ops[1].path.target 离目标太近');
  bad([{ op: 'set_path', target: '小王', path: { kind: 'line', to: [3, 0, 0] } }, { op: 'keyframe', target: '小王', property: 'pos', t: 1, value: [0, 0, 0] }], 'ops[1].property 该实体有路径');
});

test('识图模式：姿势默认站立、不清空则保留已有实体', () => {
  const g = run(createEmptyDocument(), GEN, 'generate').doc;
  const { doc } = run(g, [{ op: 'add_character', name: '甲', body: 'male', pos: [2, 0, 2] }], 'image');
  assert.equal(doc.entities.length, 4);
  assert.equal(byName(doc, '甲').pose.preset, 'stand');
});

test('注视点：角色半身高 / 组成员平均 / 道具几何中心', () => {
  const doc = run(createEmptyDocument(), [...GEN, { op: 'add_prop', name: '箱', kind: 'box', pos: [5, 0, 0], scale: 2 }], 'generate').doc;
  assert.deepEqual(docAimPoint(doc, byName(doc, '小红').id).map((v) => Math.round(v * 1e6) / 1e6), [-0.8, BODY_TYPES.female.height / 2, 0]);
  assert.deepEqual(docAimPoint(doc, byName(doc, '箱').id).map((v) => Math.round(v * 1e6) / 1e6), [5, 0.8, 0]);
});

test('摘要：每实体一行、含路径 / 注视 / 时间轴', () => {
  const doc = run(createEmptyDocument(), GEN, 'generate').doc;
  const s = summarize(doc);
  assert.ok(s.includes('时间轴：5 s · 30 fps · 主机位 机位1'));
  assert.ok(s.includes('- 小红 · 角色 female · pos (-0.8, 0, 0) · yaw 90 · 姿势 wave'));
  assert.ok(/机位1 · 机位 .* 路径 \d+ 点 .* 注视 小红 0–全程/.test(s), s);
  assert.ok(summarize(createEmptyDocument()).includes('空场景'));
});

test('提示词：范例全部合法、包含每一个词、用户消息与重试消息格式', () => {
  for (const e of EXAMPLES) {
    const r = validateOps(e.output.ops, e.scene.map((x) => ({ parent: null, ...x })), { mode: e.mode });
    assert.deepEqual(r.errors, [], e.input);
  }
  const p = systemPrompt();
  const words = [...Object.values(VOCAB).flat(), ...MOVE_PARAM_KEYS, ...OP_NAMES];
  assert.deepEqual(words.filter((w) => !p.includes(w)), []);
  assert.ok(p.length < 16000, `系统提示 ${p.length} 字`);
  const m = userMessage({ mode: 'image', summary: 'S', input: 'I', image: 'data:image/png;base64,AA' });
  assert.equal(m.content[1].image_url.url, 'data:image/png;base64,AA');
  assert.ok(retryMessage(['ops[0].preset 未知运镜 "orbit"']).content.includes('- ops[0].preset 未知运镜 "orbit"'));
});

test('parseReply：围栏 / 前后杂字 / 顶层数组 / 坏 JSON', () => {
  assert.deepEqual(parseReply('```json\n{"ops":[{"op":"clear"}],"note":"n"}\n```'), { ops: [{ op: 'clear' }], note: 'n' });
  assert.deepEqual(parseReply('好的：{"ops":[]} 完成').ops, []);
  assert.deepEqual(parseReply('[{"op":"clear"}]').ops, [{ op: 'clear' }]);
  assert.ok(parseReply('{ops:').error.startsWith('输出不是合法 JSON'));
  assert.ok(parseReply('{"x":1}').error.includes('缺少 ops'));
});

test('README「AI 生成」的词汇表块与代码生成结果一致（不一致请 npm run docs:ai）', () => {
  const text = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const [a, b] = README_MARKERS;
  assert.equal(text.slice(text.indexOf(a) + a.length, text.indexOf(b)).trim(), aiVocabMarkdown().trim());
});
