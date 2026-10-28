import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCameraMove } from '../src/doc/edit.js';
import * as THREE from 'three';
import { fakeApp, addProp, addCamera, closeVec } from './helpers.mjs';
import { aimPoint } from '../src/anim/Constraint.js';


test('默认环绕、半弧和螺旋逐帧注视手动坐标，跳转和文档往返保持一致', () => {
  for (const name of ['circle', 'half_orbit', 'spiral']) {
    const app = fakeApp(), cam = addCamera(app), aim = [0, 1.2, 0];
    cam.aimAt(new THREE.Vector3(...aim));
    app.store.transact('生成默认运镜', doc => {
      doc.entities = app.entities.map(e => e.toJSON());
      applyCameraMove(doc, cam.id, { name, subject: aim, aim, params: { duration: 2 }, mode: 'replace', preserveConstraints: true });
    });
    const saved = app.exportDocument(), initial = cam.root.quaternion.clone();
    app.timeline.fromJSON(JSON.parse(JSON.stringify(saved)));
    for (const t of [...Array.from({ length: 61 }, (_, i) => i / 30), 1.5, .25, 2, 0]) {
      app.timeline.evaluate(t);
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.root.quaternion);
      const targetDir = new THREE.Vector3(...aim).sub(cam.root.position).normalize();
      assert.ok(dir.angleTo(targetDir) < 1e-6, `${name} t=${t} 应持续对准手动坐标`);
      assert.equal(app.timeline.forcedProps(cam.id, t).get('rot'), '注视');
    }
    app.timeline.stop();
    assert.ok(cam.root.quaternion.angleTo(initial) < 1e-6);
    assert.deepEqual(app.exportDocument(), saved, '播放不得修改文档');
  }
});

test('默认注视不覆盖显式旋转轨道，也不抢占摇镜头的插值', () => {
  for (const name of ['circle', 'pan']) {
    const app = fakeApp(), cam = addCamera(app), aim = [0, 1.2, 0];
    app.store.transact('生成运镜', doc => {
      if (name === 'circle') doc.timeline.tracks.push({ id: 'rottrack', target: cam.id, property: 'rot', keys: [
        { t: 0, value: [0, 0, 0], ease: 'linear' }, { t: 2, value: [0, 60, 0], ease: 'linear' },
      ] });
      applyCameraMove(doc, cam.id, { name, subject: aim, aim, params: { duration: 2 }, mode: 'replace', preserveConstraints: true });
    });
    assert.equal(app.timeline.constraints.length, 0);
    app.timeline.evaluate(0);
    const start = cam.root.quaternion.clone();
    app.timeline.evaluate(2);
    const end = cam.root.quaternion.clone();
    app.timeline.evaluate(1);
    assert.ok(cam.root.quaternion.angleTo(start.clone().slerp(end, .5)) < 1e-6);
    assert.ok(start.angleTo(end) > .01, '旋转动画应实际转动镜头');
  }
});

test('跟随静止但已转向的主体只驱动位置，保留机位手动朝向', () => {
  const app = fakeApp(), subject = addProp(app), cam = addCamera(app);
  subject.root.rotation.y = Math.PI / 2;
  cam.root.rotation.set(.1, .3, -.2);
  app.store.transact('初始姿态', doc => {
    doc.entities = app.entities.map(e => e.toJSON());
  });
  const rotation = cam.root.quaternion.clone();
  app.timeline.addConstraint({ type: 'follow', target: cam.id, subject: subject.id, offset: [0, 1, 3] });
  for (const t of [0, 3, 8, 1]) {
    app.timeline.evaluate(t);
    assert.ok(closeVec(cam.root.position.toArray(), [3, 1, 0]));
    assert.ok(cam.root.quaternion.angleTo(rotation) < 1e-6, '跟随不能改变朝向');
    assert.equal(app.timeline.forcedProps(cam.id, t).get('rot'), undefined);
  }
});

test('跟随移动主体时旋转轨道仍独立生效；注视另一主体不改变位置', () => {
  const app = fakeApp(), subject = addProp(app), focus = addProp(app, 'box', [3, 0, 4]), cam = addCamera(app);
  app.timeline.addPath({ target: subject.id, points: [[0, 0, 0], [4, 0, 0]], duration: 4, orient: 'tangent' });
  const track = app.timeline.addTrack({ target: cam.id, property: 'rot' });
  app.timeline.setKey(track.id, 0, [0, 0, 0]);
  app.timeline.setKey(track.id, 4, [0, 60, 0]);
  app.timeline.addConstraint({ type: 'follow', target: cam.id, subject: subject.id, offset: [0, 2, 3] });
  app.timeline.evaluate(2);
  const expected = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 6, 0));
  assert.ok(cam.root.quaternion.angleTo(expected) < 1e-6);
  const pos = cam.root.position.clone();
  const look = app.timeline.addConstraint({ type: 'lookAt', target: cam.id, subject: focus.id });
  assert.ok(cam.root.position.distanceTo(pos) < 1e-9);
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.root.quaternion);
  assert.ok(dir.angleTo(aimPoint(app, focus.id).sub(pos).normalize()) < 1e-6);
  app.timeline.removeConstraint(look.id);
  assert.ok(cam.root.quaternion.angleTo(expected) < 1e-6, '取消注视后恢复独立旋转轨道');
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

test('lookAt 入退场混合及相邻目标接力不回摆到手动朝向', () => {
  const app = fakeApp(), cam = addCamera(app), a = addProp(app, 'box', [-3, 0, 0]), b = addProp(app, 'box', [3, 0, 0]);
  const manual = cam.root.quaternion.clone();
  const sample = t => { app.timeline.evaluate(t); return cam.root.quaternion.clone(); };
  app.timeline.addConstraint({ type: 'lookAt', target: cam.id, subject: a.id, start: 2, end: 5 });
  const aimed = sample(3);
  assert.ok(aimed.angleTo(manual) > .1);
  assert.ok(sample(2).angleTo(manual) < 1e-6);
  assert.ok(sample(2.5).angleTo(aimed) < 1e-6);
  assert.ok(sample(2.25).angleTo(manual) > .01);
  assert.ok(sample(2.25).angleTo(aimed) > .01);
  assert.ok(sample(4.5).angleTo(aimed) < 1e-6);
  assert.ok(sample(5).angleTo(manual) < 1e-6);
  app.timeline.addConstraint({ type: 'lookAt', target: cam.id, subject: b.id, start: 5, end: 8 });
  assert.ok(sample(4.9).angleTo(aimed) < 1e-6);
  assert.ok(sample(5).angleTo(aimed) < 1e-6);
  assert.ok(sample(5.25).angleTo(aimed) > .01);
  assert.ok(sample(5.5).angleTo(sample(6)) < 1e-6);
});
