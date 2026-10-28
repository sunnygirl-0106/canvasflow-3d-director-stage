import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Scene, Vector3 } from 'three';
import { LabelSprites, labelAnchor, layoutLabels } from '../src/app/LabelSprites.js';

test('名牌锚点使用世界坐标和场景缩放；避让只上移重叠且更远的名牌', () => {
  const parent = new Group(), root = new Group();
  parent.position.set(2, 3, 4); parent.scale.setScalar(2); parent.add(root);
  root.position.set(1, 1, 0);
  assert.deepEqual(labelAnchor({ root, labelOffset: () => 1.5 }, 2, new Vector3()).toArray(), [4, 8, 4]);
  const items = [
    { x: 0, bottom: 20, w: 20, h: 10, depth: 2, dy: 0 },
    { x: 0, bottom: 20, w: 20, h: 10, depth: 1, dy: 0 },
    { x: 100, bottom: 20, w: 20, h: 10, depth: 3, dy: 0 },
  ];
  layoutLabels(items);
  assert.deepEqual(items.map(item => item.dy), [14, 0, 0]);
  layoutLabels(items);
  assert.deepEqual(items.map(item => item.dy), [14, 0, 0]);
});

test('名牌导出显隐可嵌套；退出后恢复场景设置', () => {
  const app = { stage: { scene: new Scene() }, entities: [], sceneState: { labels: true }, cameraView: false };
  const labels = new LabelSprites(app);
  labels.update(); assert.equal(labels.group.visible, true);
  labels.beginClean({ labels: false }); assert.equal(labels.group.visible, false);
  labels.beginClean(); assert.equal(labels.group.visible, true);
  labels.endClean(); assert.equal(labels.group.visible, false);
  labels.endClean(); assert.equal(labels.group.visible, true);
  app.sceneState.labels = false;
  labels.beginClean(); assert.equal(labels.group.visible, false);
  labels.endClean(); assert.equal(labels.group.visible, false);
});
