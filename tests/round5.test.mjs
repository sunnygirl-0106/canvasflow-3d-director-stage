import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeApp, addProp } from './helpers.mjs';
import { Playback } from '../src/anim/Playback.js';
import { Path, pathOptionsFor } from '../src/anim/Path.js';
import { PathEditor } from '../src/app/PathEditor.js';
import { hitTime, toggleKey } from '../src/ui/timeline/animState.js';
import { setPath, addCharacter } from '../src/doc/edit.js';
import { createEmptyDocument } from '../src/doc/schema.js';

function setup() {
  const app = fakeApp(), ent = addProp(app);
  app.playback = new Playback(app.timeline);
  app.store.project = () => {
    const json = app.store.document.entities.find(e => e.id === ent.id);
    ent.applyTransform(json.transform); app.timeline.invalidateBase(ent); app.timeline.documentChanged();
  };
  return {app, ent};
}

test('UI frame hit preserves imported precision, nearest match and deterministic ties', () => {
  const keys = [{t:1.012}, {t:1.001}, {t:1.03}];
  assert.equal(hitTime(keys, 1.01, 30).t, 1.012);
  assert.equal(hitTime(keys, 1, 30).t, 1.001);
  assert.equal(hitTime([{t:0}, {t:0.125}], .0625, 1).t, 0);
  assert.equal(hitTime(keys, 2, 30), null);
  assert.equal(keys[0].t, 1.012);
});

test('key command pauses at captured time, rejects driven properties without empty tracks', () => {
  const {app, ent} = setup();
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

test('translation moves path and base in the same local document space, preserves times and stops', () => {
  const {app, ent} = setup();
  const path = app.timeline.addPath({target:ent.id,points:[[0,0,0],[2,1,0],[4,2,0]],start:1,duration:6,interpolation:'polyline'});
  app.timeline.updatePath(path.id, {stops:[1],stopTimes:[3]});
  app.playback.seek(3); const before = structuredClone(app.timeline.paths[0]);
  const pos=app.timeline.valueOf(ent,'pos'); app.history.scheduled=0;
  app.timeline.translatePathTo(ent,pos.map((v,i)=>v+[3,2,-1][i]));
  const after=app.timeline.paths[0];
  assert.deepEqual(after.points,before.points.map(p=>p.map((v,i)=>v+[3,2,-1][i])));
  assert.deepEqual(app.store.document.entities[0].transform.pos,[3,2,-1]);
  assert.deepEqual(after.stops,before.stops); assert.deepEqual(after.stopTimes,before.stopTimes);
  assert.equal(after.duration,6); assert.equal(after.start,1); assert.equal(app.history.scheduled,1);
  app.timeline.valueOf(ent,'pos').forEach((v,i)=>assert.ok(Math.abs(v-pos[i]-[3,2,-1][i])<1e-6));
});

test('orientation handoff uses existing rotation track and keeps current quaternion', () => {
  const {app, ent} = setup();
  const p=app.timeline.addPath({target:ent.id,points:[[0,0,0],[5,0,0]],duration:5});
  const track=app.timeline.addTrack({target:ent.id,property:'rot'});
  app.timeline.setKey(track.id,0,[0,10,0]); app.timeline.setKey(track.id,5,[0,30,0]);
  app.playback.seek(2); const q=ent.root.quaternion.clone(); app.history.scheduled=0;
  app.timeline.setPathOrientation(p.id,'keep');
  assert.ok(q.angleTo(ent.root.quaternion)<1e-6); assert.equal(app.history.scheduled,1);
  assert.equal(app.timeline.tracks.length,1); assert.equal(app.timeline.tracks[0].keys.length,3);
});

test('insert sampled height, shift stop indices, preserve timing; prevent seam/duplicate/zero-length insertion', () => {
  const {app,ent}=setup();
  const p=app.timeline.addPath({target:ent.id,points:[[0,0,0],[2,2,0],[4,0,0]],duration:6,interpolation:'polyline'});
  app.timeline.updatePath(p.id,{stops:[1],stopTimes:[3]});
  app.pathOverlay={pathOf:id=>new Path(app.timeline.paths.find(p=>p.id===id),pathOptionsFor(ent.type)),setSelectedVertex:()=>{}};
  const editor=Object.create(PathEditor.prototype); editor.app=app;
  const result=editor.insertAt(p.id,Math.sqrt(2));
  assert.equal(result.index,1); assert.equal(result.inserted,true);
  assert.deepEqual(app.timeline.paths[0].points[1],[1,1,0]);
  assert.deepEqual(app.timeline.paths[0].stops,[2]); assert.deepEqual(app.timeline.paths[0].stopTimes,[3]);
  assert.equal(editor.insertAt(p.id,Math.sqrt(2)).inserted,false);
  app.timeline.updatePath(p.id,{closed:true});
  assert.deepEqual(editor.insertAt(p.id,app.pathOverlay.pathOf(p.id).length),{index:0,inserted:false});
  app.timeline.updatePath(p.id,{points:[[0,0,0],[0,0,0]],closed:false});
  assert.equal(editor.insertAt(p.id,0),null);
});

test('时间轴可对视口尚未显示的路径插点，保留原路径时间和高度', () => {
  const { app, ent } = setup();
  const path = app.timeline.addPath({ target: ent.id, points: [[0, 0, 0], [2, 2, 0]], start: 1, duration: 6, interpolation: 'polyline' });
  let selected;
  app.pathOverlay = { pathOf: () => null, setSelectedVertex: ref => { selected = ref; } };
  const editor = Object.assign(Object.create(PathEditor.prototype), { app });
  assert.deepEqual(editor.insertAt(path.id, Math.sqrt(2)), { index: 1, inserted: true });
  assert.deepEqual(app.timeline.paths[0].points[1], [1, 1, 0]);
  assert.deepEqual(selected, { pathId: path.id, index: 1 });
  assert.equal(app.timeline.paths[0].start, 1);
  assert.equal(app.timeline.paths[0].duration, 6);
});

test('20% faster defaults only affect new character paths; saved timing and camera pace remain unchanged', () => {
  const doc=createEmptyDocument(); doc.timeline.duration=100;
  const actor=addCharacter(doc,{name:'角色A',body:'male'});
  const path=setPath(doc,actor.id,[[0,0,0],[72,0,0]]).path;
  assert.equal(path.duration,50); // 原 1.2 m/s 需要60秒。
  setPath(doc,actor.id,[[0,0,0],[36,0,0]]);
  assert.equal(doc.paths[0].duration,50);
  const {app,ent}=setup();
  const propDoc=structuredClone(app.store.document); propDoc.timeline.duration=100;
  assert.equal(setPath(propDoc,ent.id,[[0,0,0],[12,0,0]],{set:{speed:'linear'}}).path.duration,10);
});
