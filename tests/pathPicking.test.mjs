import test from 'node:test';
import assert from 'node:assert/strict';
import { Path, pathOptionsFor } from '../src/anim/Path.js';
import { rectangle } from '../src/anim/pathGen.js';
import { animatedPropFixture } from './helpers.mjs';
import { PathEditor } from '../src/app/PathEditor.js';
import { Vector3 } from 'three';
import { safePathPlanePoint } from '../src/core/pathPicking.js';


const origin = new Vector3(0, 3, 12);
const focus = new Vector3(0, 1, 0);
const pick = (target, distance = origin.distanceTo(focus), y = 0) => safePathPlanePoint(origin, target.clone().sub(origin).normalize(), y, focus, distance);

test('地平线附近和远处地面不会生成巨长路径，普通落点不偏移', () => {
  assert.deepEqual(pick(new Vector3(2, 0, 1)), [2, 0, 1]);
  assert.equal(pick(new Vector3(0, 0, -1000)), null);
  assert.equal(pick(new Vector3(100, 0, 0)), null);
  assert.equal(pick(new Vector3(0, 4, 0)), null);
  assert.equal(safePathPlanePoint(origin, new Vector3(0, 0, -1), 0, focus, 12), null);
});

test('保护区域跟随观察中心，缩放后可绘制更大范围，也支持机位高度平面', () => {
  assert.deepEqual(pick(new Vector3(1, 1.5, 3), 12, 1.5), [1, 1.5, 3]);
  const o = new Vector3(100, 30, 120), f = new Vector3(100, 0, 100);
  const d = new Vector3(110, 0, 95).sub(o).normalize();
  assert.deepEqual(safePathPlanePoint(o, d, 0, f, 40), [110, 0, 95]);
  assert.equal(safePathPlanePoint(origin, new Vector3(NaN, 0, 0), 0, focus, 12), null);
});


test('rectangle drawing plane preserves camera height under translated, rotated and scaled world', async () => {
  const THREE = await import('three');
  const { PathTool } = await import('../src/app/PathTool.js');
  const world = new THREE.Group();
  world.position.set(4, 2, -3); world.rotation.set(.1, .7, -.2); world.scale.setScalar(1.8); world.updateMatrixWorld(true);
  const origin = new THREE.Vector3(3, 7, 4).applyMatrix4(world.matrixWorld);
  const direction = new THREE.Vector3(0, -1, 0).transformDirection(world.matrixWorld);
  const tool = { app: {stage:{world}, rig:{controls:{target:new THREE.Vector3(3, 1.55, 4).applyMatrix4(world.matrixWorld)}}}, _setRay() {}, _ray: {ray:new THREE.Ray(origin,direction)} };
  const hit = PathTool.prototype.planePoint.call(tool, {}, 1.55);
  assert.deepEqual(hit, [3, 1.55, 4]);
  const points = rectangle([0,1.55,0],hit);
  assert.ok(points.every(p=>p[1]===1.55));
  assert.equal(new Path({points,closed:true,interpolation:'polyline',start:0,duration:10,speed:'linear'}).length,14);
});


test('insert sampled height, shift stop indices, preserve timing; prevent seam/duplicate/zero-length insertion', () => {
  const {app,ent}=animatedPropFixture();
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
  const { app, ent } = animatedPropFixture();
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
