import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../src/ai/context.js';
import { contextFixture, contextTasks } from './contextFixtures.mjs';
import { validate } from '../src/doc/schema.js';
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
