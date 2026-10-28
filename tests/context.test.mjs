import { migratePath } from '../src/doc/migrate.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../src/ai/context.js';
import { contextFixture, contextTasks } from './contextFixtures.mjs';
import { createEmptyDocument, validate } from '../src/doc/schema.js';
import { characterJSON } from '../src/doc/edit.js';
test('目标摘要覆盖第61实体、第9组员、完整长路径与关键帧值', () => {
  const doc = contextFixture(); assert.deepEqual(validate(doc).errors, []);
  for (const task of contextTasks) {
    const summary = summarize(doc, { input: task.input });
    assert(summary.length <= 12000);
    assert(summary.includes(`"name":"${task.target}"`), task.name);
    for (const needle of task.needles) assert(summary.includes(needle), task.name + needle);
  }
});
test('选择对象优先，关联组、机位及约束可追溯', () => {
  const doc = contextFixture(), member = doc.entities.find((e) => e.name === '成员9号');
  const summary = summarize(doc, { selectedId: member.id });
  assert(summary.includes('"name":"成员9号"')); assert(summary.includes('"name":"远处群众"'));
  const path = summarize(doc, { input: '道具68号' });
  assert(path.includes('"name":"长镜头"')); assert(path.includes('约束详情'));
});
test('超长路径与密集键值显式裁剪，严格字符预算且不输出半截JSON', () => {
  const doc = contextFixture();
  doc.paths[0].points = Array.from({ length: 10000 }, (_, i) => [i / 1000, 0, 0]);
  const summary = summarize(doc, { input: '道具68号', budget: 2500 });
  assert(summary.length <= 2500); assert(summary.includes('摘要已裁剪')); assert(summary.includes('直接目标'));
  assert(summary.includes('"pointCount":10000')); assert(summary.includes('"index":9999'));
  for (const line of summary.split('\n').filter((l) => l.includes('：{'))) assert.doesNotThrow(() => JSON.parse(line.slice(line.indexOf('：') + 1)));
});

test('折线路径长度遵守 interpolation，不套用曲线长度', () => {
  const doc = contextFixture(), path = doc.paths[0];
  Object.assign(path, { points: [[0, 0, 0], [3, 0, 0], [3, 4, 0]], interpolation: 'polyline', closed: false });
  const summary = summarize(doc, { input: '道具68号' });
  assert(summary.includes('路径 3 点 长 7 m'));
});

test('实体与动画概览保留文本、顺序、数值精度及组员/关键帧截断规则', () => {
  const doc = contextFixture();
  doc.timeline.mainCameraId = null;
  const prop = doc.entities.find((e) => e.name === '道具68号');
  prop.transform.rot = [10.125, 20, -0.001];
  prop.transform.scale = [2, 1, 0.5];
  Object.assign(doc.paths[0], { points: [[0, 0, 0], [3, 0, 0], [3, 4, 0]], interpolation: 'polyline', start: 1, duration: 4 });
  doc.entities.push(characterJSON({ id: 'solo0001', name: '独立角色', body: 'female', pos: [-0.001, 1.234, -2.345], rot: [0, 45, 0], pose: 'wave' }));
  const camera = doc.entities.find((e) => e.type === 'camera');
  doc.constraints.push({ id: 'follow01', type: 'follow', target: camera.id, subject: [1.234, 0, -0.001], offset: [0, 0, 0], start: 2, end: 4 });
  doc.paths[0].schedule = [{ i: 0, t: 0, curve: 'linear', allocation: 'distance' }, { i: 2, t: 4 }];
  assert.deepEqual(validate(doc).errors, []);
  const before = structuredClone(doc);
  const prefixes = ['- 独立角色', '- 道具68号', '- 长镜头', '- 远处群众'];
  const summary = summarize(doc, { budget: 32000 });
  assert.deepEqual(summary.split('\n').filter((line) => prefixes.some((prefix) => line.startsWith(prefix))), [
    '- 道具68号 · 道具 box · pos (7, 0, 6) · rot (10.13, 20, 0) · scale (2, 1, 0.5) · 路径 3 点 长 7 m 1–5 s 终点 (3, 4, 0)',
    '- 远处群众 · 组 12 人（成员1号、成员2号、成员3号、成员4号、成员5号、成员6号、成员7号、成员8号 等）· pos (6.5, 0, 10) · yaw 0 · 姿势 stand',
    '- 长镜头 · 机位 · pos (0, 2, 15) · 对准 (7, 0.4, 6) · fov 40 · 注视 道具68号 0–全程 · 跟随 (1.23, 0, 0) 2–4 s · fov 关键帧 21 个（0/0.5/1/1.5/2/2.5/3/3.5 s，仅列前8个时刻）',
    '- 独立角色 · 角色 female · pos (0, 1.23, -2.35) · yaw 45 · 姿势 wave',
  ]);
  assert(!summary.includes('- 成员9号'));
  assert.deepEqual(doc, before, '生成摘要不改动文档');
});

test('无预设姿势区分站立与自定义，闭合路径的终点是首点', () => {
  const doc = createEmptyDocument();
  const character = characterJSON({ id: 'solo0001', name: '角色', body: 'female' });
  doc.entities.push(character);
  assert.equal(summarize(doc).split('\n').at(-1), '- 角色 · 角色 female · pos (0, 0, 0) · yaw 0 · 姿势 stand');
  character.pose.values = { lArmFwd: 10 };
  assert.equal(summarize(doc).split('\n').at(-1), '- 角色 · 角色 female · pos (0, 0, 0) · yaw 0 · 姿势 自定义');
  doc.paths.push(migratePath({ id: 'path0001', target: character.id, points: [[0, 0, 0], [3, 0, 0], [3, 0, 4]], closed: true, interpolation: 'polyline', start: 0, duration: 6, speed: 'linear', orient: 'tangent' }));
  assert.deepEqual(validate(doc).errors, []);
  assert.equal(summarize(doc).split('\n').at(-1), '- 角色 · 角色 female · pos (0, 0, 0) · yaw 0 · 姿势 自定义 · 路径 3 点 长 12 m 0–6 s 终点 (0, 0, 0)');
});

test('预算临界值保留完整行与裁剪提示，预算仍按原规则归一化', () => {
  const doc = createEmptyDocument();
  doc.entities.push(characterJSON({ id: 'solo0001', name: '长'.repeat(120), body: 'female' }));
  const notice = '\n【摘要已裁剪：未列出的实体、路径点或键值不可猜测；信息不足时请说明需要的目标或范围。】';
  const full = summarize(doc);
  const exactBudget = full.length + 1 + notice.length;
  assert(exactBudget > 256);
  assert.equal(summarize(doc, { budget: exactBudget }), full);
  assert.equal(summarize(doc, { budget: exactBudget - 1 }), full.split('\n').slice(0, -1).join('\n') + notice);
  assert.equal(summarize(doc, { budget: exactBudget - 0.5 }), summarize(doc, { budget: exactBudget - 1 }));
  assert.equal(summarize(doc, { budget: -1 }), summarize(doc, { budget: 256 }));
  assert.equal(summarize(doc, { budget: 40000 }), summarize(doc, { budget: 32000 }));
  for (const budget of [NaN, Infinity, '500']) assert.equal(summarize(doc, { budget }), full);
});

test('应用入口使用选中对象并关闭视角导出，目标顺序优先于关联详情', () => {
  const doc = contextFixture();
  const selectedId = doc.entities.find((e) => e.name === '成员9号').id;
  let exportOptions;
  const app = { selectedId, exportDocument(options) { exportOptions = options; return doc; } };
  const options = { input: '道具1号和长镜头', budget: 12000 };
  const summary = summarize(app, options);
  assert.deepEqual(exportOptions, { view: false });
  assert.equal(summary, summarize(doc, { ...options, selectedId }));
  const lines = summary.split('\n');
  const targets = lines.filter((line) => line.startsWith('直接目标：'));
  assert.deepEqual(targets.map((line) => JSON.parse(line.slice('直接目标：'.length)).name), ['成员9号', '道具1号', '长镜头']);
  assert(lines.indexOf(targets.at(-1)) < lines.findIndex((line) => line.startsWith('目标详情：')));
  assert(lines.findLastIndex((line) => line.startsWith('目标详情：')) < lines.findIndex((line) => line.startsWith('关联详情：')));
});
