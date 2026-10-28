import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fakeApp, addCamera } from './helpers.mjs';
import { CameraMoveTool } from '../src/app/CameraMoveTool.js';
import { aimRotation } from '../src/anim/cameraMoves.js';

for (const name of ['pan', 'circle']) {
  test(`手动 ${name} 预设保留非零荷兰角`, (t) => {
    const previous = globalThis.document;
    globalThis.document = { getElementById: () => null };
    t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
    const app = fakeApp(), cam = addCamera(app), aim = [1, 1, 0];
    cam.rollRad = Math.PI / 6;
    cam.aimAt(new THREE.Vector3(0, 1, 0));
    app.store.transact('设置荷兰角', doc => { doc.entities = [cam.toJSON()]; });
    app.playback = { time: 0, pause() {} };
    app.history.capture = () => {};
    app.stage = { invalidate() {} };
    const tool = new CameraMoveTool(app);
    assert.equal(tool.applyPreset(cam, name, { subject: aim, params: { duration: 2 } }), true);
    const origin = tool.current(cam).segments[0].origin;
    assert.ok(Math.abs(origin.roll - 30) < 1e-6, '预设起点保存角度制荷兰角');
    app.timeline.evaluate(2);
    const expected = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      ...aimRotation(cam.root.position.toArray(), aim, 30).map(v => v * Math.PI / 180),
    ));
    assert.ok(cam.root.quaternion.angleTo(expected) < 1e-6, '生成的旋转保留 30° 荷兰角');
  });
}
