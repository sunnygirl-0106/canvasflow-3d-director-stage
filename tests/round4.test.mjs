import test from 'node:test';
import assert from 'node:assert/strict';
import { Path } from '../src/anim/Path.js';
import { rectangle, arcPoints, defaultDuration } from '../src/anim/pathGen.js';
import { createEmptyDocument, validate } from '../src/doc/schema.js';
import { addCharacter, setPath } from '../src/doc/edit.js';

test('rectangle uses exact edges, closure, unequal lengths and correct insertion indices', () => {
  const points = rectangle([0, 2, 0], [3, 99, 4]);
  const json = { points, closed: true, interpolation: 'polyline', start: 0, duration: 14, speed: 'linear' };
  const p = new Path(json);
  assert.equal(p.length, 14);
  assert.deepEqual(p.positionAt(3).toArray(), [3, 2, 0]);
  assert.deepEqual(p.positionAt(7).toArray(), [3, 2, 4]);
  assert.deepEqual(p.positionAt(14).toArray(), [0, 2, 0]);
  assert.equal(p.edgeAt(5), 1);
  for (let s = 0; s <= 14; s += .01) {
    const v = p.positionAt(s);
    assert.ok(v.x >= 0 && v.x <= 3 && v.z >= 0 && v.z <= 4);
    assert.ok(v.x === 0 || v.x === 3 || v.z === 0 || v.z === 4);
  }
  assert.equal(rectangle([0, 0, 0], [.01, 0, 4]), null);
  assert.equal(defaultDuration(points, { closed: true, interpolation: 'polyline', speed: 1, ramp: 0 }), 14);
});

test('polyline validates and survives JSON; legacy curves unchanged; redraw clears interpolation', () => {
  const d = createEmptyDocument();
  const e = addCharacter(d, { body: 'male' });
  const points = rectangle([0, 0, 0], [3, 0, 4]);
  setPath(d, e.id, points, { closed: true, set: { interpolation: 'polyline' } });
  assert.equal(validate(d).ok, true, JSON.stringify(validate(d).errors));
  const p = new Path(d.paths[0]);
  const q = new Path(JSON.parse(JSON.stringify(d)).paths[0]);
  assert.deepEqual(p.positionAt(4).toArray(), q.positionAt(4).toArray());
  const legacy = { ...d.paths[0] }; delete legacy.interpolation;
  assert.deepEqual(new Path(legacy).positionAt(3).toArray(), new Path({...legacy, interpolation:'centripetal'}).positionAt(3).toArray());
  setPath(d, e.id, [[0,0,0],[1,0,0]]);
  assert.equal(d.paths[0].interpolation, undefined);
  d.paths[0].interpolation = 'bad'; assert.equal(validate(d).ok, false);
});

test('circle is full 360 degrees and closes without duplicate endpoint', () => {
  const r = arcPoints({kind:'arc',center:[0,0,0],radius:2,startDeg:0,sweepDeg:360}, 0);
  assert.equal(r.closed, true);
  const p = new Path({...r,start:0,duration:10,speed:'linear'});
  assert.ok(Math.abs(p.length - 4 * Math.PI) < .03);
  assert.ok(p.positionAt(0).distanceTo(p.positionAt(p.length)) < 1e-9);
});

test('frustum tracks true projection, world transform and finite depth without touching far', async () => {
  const { CameraEntity } = await import('../src/entities/Camera.js');
  const THREE = await import('three');
  const c = new CameraEntity('test');
  c.root.position.set(2, 1.55, 5);
  c.aimAt(new THREE.Vector3(0, 1, 0));
  const geometry = c.helper.geometry, far = c.cam.far;
  c.cam.aspect = 4 / 3; c.setFov(60); c.update();
  assert.equal(c._viz.aspect, 4 / 3);
  assert.equal(c._viz.fov, 60);
  assert.equal(c.cam.far, far);
  assert.ok(c._viz.far > 5 && c._viz.far < 7);
  const width = 2 * c._viz.far * Math.tan(Math.PI / 6) * 4 / 3;
  const pos = c.helper.geometry.getAttribute('position');
  const f1 = c.helper.pointMap.f1[0], f2 = c.helper.pointMap.f2[0];
  assert.ok(Math.abs(Math.abs(pos.getX(f1) - pos.getX(f2)) - width) < 1e-5);
  for (let i = 0; i < 100; i++) c.update();
  assert.equal(c.helper.geometry, geometry);
  c.lookTarget.set(2, 1.55, 20); c.update();
  assert.equal(c._viz.far, 4);
  c.setHelpersVisible(false); assert.equal(c.helper.visible, false);
  c.setHelpersVisible(true); assert.equal(c.helper.visible, true);
  c.dispose();
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

test('fallback fixture contains two separate 10-second paths starting at the actors', async () => {
  const { readFile } = await import('node:fs/promises');
  const d = JSON.parse(await readFile(new URL('../e2e/fixtures/round4-default.json', import.meta.url), 'utf8'));
  assert.equal(validate(d).ok, true);
  assert.equal(d.entities.length,3); assert.equal(d.paths.length,2);
  assert.equal(d.timeline.duration,10); assert.equal(d.timeline.fps,30);
  for (const p of d.paths) {
    const e=d.entities.find(e=>e.id===p.target);
    assert.deepEqual(p.points[0],e.transform.pos);
    assert.deepEqual(p.points[1],[e.transform.pos[0],0,-.8]);
    assert.equal(p.duration,10);
  }
});
