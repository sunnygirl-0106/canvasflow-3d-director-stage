import test from 'node:test';
import assert from 'node:assert/strict';
import { App } from '../src/app/App.js';

test('视角派生保持编辑模式、播放机位、导演绑定与主机位提示相互独立', () => {
  const app = Object.create(App.prototype);
  app.view = { mode: 'director', director: 'free' };
  app.store = { document: { scene: { activeCameraId: 'camera-a' } } };
  app.timeline = { active: false, mainCameraId: 'camera-a' };
  const cameras = new Map(['camera-a', 'camera-b'].map(id => [id, { id }]));
  app.findCamera = id => cameras.get(id);
  const state = () => [app.cameraView, app.directorDetached, app.povCameraId, app.mainPreview, app.povUnset];
  assert.deepEqual(state(), [false, true, null, false, false]);
  app.setView({ director: 'camera' });
  app.setView({ mode: 'camera' });
  assert.deepEqual(state(), [true, false, 'camera-a', false, false]);
  app.timeline.active = true;
  assert.deepEqual(state(), [true, false, 'camera-a', true, false]);
  app.preview = true;
  app.playbackCameraId = 'camera-b';
  app.setView({ director: 'free' });
  assert.deepEqual(state(), [true, true, 'camera-b', false, false]);
  cameras.delete('camera-a');
  assert.deepEqual(state(), [true, true, 'camera-b', false, true]);
  app.preview = false;
  app.setView({ mode: 'director' });
  assert.deepEqual(state(), [false, true, null, false, false]);
  for (const field of ['cameraView', 'directorDetached', 'povCameraId', 'mainPreview', 'povUnset']) {
    assert.throws(() => { app[field] = true; }, TypeError);
  }
});
