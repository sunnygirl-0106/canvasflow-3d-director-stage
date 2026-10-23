import { createEmptyDocument } from '../src/doc/schema.js';
import { compileOps } from '../src/ai/apply.js';
export function contextFixture() {
  const ops = Array.from({ length: 70 }, (_, i) => ({ op: 'add_prop', name: `道具${i + 1}号`, kind: 'box', pos: [i % 10, 0, Math.floor(i / 10)] }));
  for (let i = 1; i <= 12; i++) ops.push({ op: 'add_character', name: `成员${i}号`, body: 'male', pos: [i, 0, 10] });
  ops.push({ op: 'add_group', name: '远处群众', members: Array.from({ length: 12 }, (_, i) => `成员${i + 1}号`) },
    { op: 'add_camera', name: '长镜头', pos: [0, 2, 15], lookAt: '道具68号' },
    { op: 'look_at', target: '长镜头', subject: '道具68号' },
    { op: 'set_path', target: '道具68号', path: { kind: 'points', points: Array.from({ length: 120 }, (_, i) => [i / 4, .125, i / 8]) }, duration: 10 });
  for (let i = 0; i <= 20; i++) ops.push({ op: 'keyframe', target: '长镜头', property: 'fov', t: i / 2, value: 53 + i, ease: 'linear' });
  const result = compileOps(createEmptyDocument(), ops, { mode: 'generate' });
  if (result.errors.length) throw new Error(result.errors.join('\n'));
  // 三维编辑器可产生非零高度的道具路径；AI points 生成器本身按对象高度投影。
  result.doc.paths[0].points.forEach((point, i) => { if (i) point[1] = .125; });
  return result.doc;
}
export const contextTasks = [
  { name: '普通目标对照', input: '把道具1号向右移一米', target: '道具1号', needles: ['道具1号'], ops: [{ op: 'move', target: '道具1号', pos: [1, 0, 0] }] },
  { name: '第61个实体', input: '把道具61号向右移一米', target: '道具61号', needles: ['道具61号'], ops: [{ op: 'move', target: '道具61号', pos: [1, 0, 6] }] },
  { name: '组第9成员', input: '让成员9号挥手', target: '成员9号', needles: ['成员9号'], ops: [{ op: 'set_pose', target: '成员9号', preset: 'wave' }] },
  { name: '长路径中间点', input: '道具68号的路线经过高度.125的位置，把终点保持在相同高度', target: '道具68号', needles: ['.125', '[29.75,0.125,14.875]'], ops: [{ op: 'move', target: '道具68号', yaw: 90 }] },
  { name: '关键帧值', input: '长镜头在5秒的视野是什么？保持这个值打到6秒', target: '长镜头', needles: ['"t":5,"value":63'], ops: [{ op: 'keyframe', target: '长镜头', property: 'fov', t: 6, value: 63 }] },
];
