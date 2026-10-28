import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeApp, addProp, addCamera, animatedPropFixture } from './helpers.mjs';
import { hitTime, toggleKey } from '../src/ui/timeline/animState.js';
import { TimelinePanel } from '../src/ui/timeline/TimelinePanel.js';


test('读取关键帧保留精确时刻和独立值副本；缺失的键返回 null', () => {
  const app = fakeApp(), ent = addProp(app);
  const track = app.timeline.addTrack({ target: ent.id, property: 'pos' });
  app.timeline.setKey(track.id, 1.012345, [1, 2, 3], 'smooth');
  const panel = Object.assign(Object.create(TimelinePanel.prototype), { app });
  const node = { dataset: { track: track.id, t: '1.012345' } };
  const value = panel._keyData(node);
  assert.deepEqual(value, { trackId: track.id, t: 1.012345, value: [1, 2, 3], ease: 'smooth' });
  value.value[0] = 99;
  assert.deepEqual(app.timeline.tracks[0].keys[0].value, [1, 2, 3]);
  app.timeline.removeKey(track.id, 1.012345);
  assert.equal(panel._keyData(node), null);
  app.timeline.removeTrack(track.id);
  assert.equal(panel._keyData(node), null);
});

test('删除对象全部动画在一次事务内完成，保留其他对象和以它为主体的约束', () => {
  const app = fakeApp(), ent = addProp(app), cam = addCamera(app);
  const path = app.timeline.addPath({ target: ent.id, points: [[0, 0, 0], [2, 0, 0]] });
  app.timeline.addTrack({ target: ent.id, property: 'rot' });
  app.timeline.addTrack({ target: ent.id, property: 'scale' });
  const cameraTrack = app.timeline.addTrack({ target: cam.id, property: 'fov' });
  const look = app.timeline.addConstraint({ type: 'lookAt', target: cam.id, subject: ent.id });
  const before = app.store.document;
  const panel = Object.assign(Object.create(TimelinePanel.prototype), { app });
  app.history.scheduled = 0;
  panel.removeAllAnimation(ent.id);
  assert.equal(app.history.scheduled, 1);
  assert.deepEqual(app.timeline.tracks.map(t => t.id), [cameraTrack.id]);
  assert.deepEqual(app.timeline.paths, []);
  assert.deepEqual(app.timeline.constraints.map(c => c.id), [look.id]);
  assert.equal(before.paths[0].id, path.id);
  assert.equal(before.timeline.tracks.length, 3);
});


test('UI frame hit preserves imported precision, nearest match and deterministic ties', () => {
  const keys = [{t:1.012}, {t:1.001}, {t:1.03}];
  assert.equal(hitTime(keys, 1.01, 30).t, 1.012);
  assert.equal(hitTime(keys, 1, 30).t, 1.001);
  assert.equal(hitTime([{t:0}, {t:0.125}], .0625, 1).t, 0);
  assert.equal(hitTime(keys, 2, 30), null);
  assert.equal(keys[0].t, 1.012);
});


test('key command pauses at captured time, rejects driven properties without empty tracks', () => {
  const {app, ent} = animatedPropFixture();
  const p = app.timeline.addPath({target:ent.id,points:[[0,0,0],[5,0,0]],duration:5});
  app.playback.seek(2); app.playback.play();
  assert.throws(()=>toggleKey(app, ent, 'pos'), /驱动/);
  assert.equal(app.playback.time, 2); assert.equal(app.playback.playing, false);
  assert.equal(app.timeline.tracks.length, 0);
  assert.throws(()=>toggleKey(app, ent, 'rot'), /关闭/);
  app.timeline.setPathOrientation(p.id, 'keep');
  app.history.scheduled=0;
  toggleKey(app, ent, 'rot');
  assert.equal(app.timeline.tracks.length, 1); assert.equal(app.timeline.tracks[0].keys[0].t, 2);
  assert.equal(app.history.scheduled, 1);
});
