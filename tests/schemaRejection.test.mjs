import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyDocument, validate } from '../src/doc/schema.js';
import { addCharacter } from '../src/doc/edit.js';
import { CameraEntity } from '../src/entities/Camera.js';
import { DocumentStore } from '../src/doc/Store.js';
import { loadDocument } from '../src/doc/serialize.js';

// 原 doc/anim 套件：坏文档必须在资源加载之前被定位拒绝。
test('十种场景/动画错误定位准确，拒绝加载且不改变已提交文档', async () => {
  const good = createEmptyDocument();
  const character = addCharacter(good, { name: '角色', body: 'male' });
  const camera = new CameraEntity('机位').toJSON();
  good.entities.push(camera);
  good.timeline.tracks = [
    { id: 'track001', target: character.id, property: 'rot', keys: [0, 2.5, 4].map(t => ({ t, value: [0, t * 20, 0], ease: 'linear' })) },
    { id: 'track002', target: camera.id, property: 'fov', keys: [{ t: 0, value: 40, ease: 'linear' }] },
  ];
  good.paths = [{ id: 'path0001', target: character.id, points: [[0, 0, 0], [2, 0, 0]], closed: false, start: 0, duration: 4, speed: 'linear', orient: 'tangent' }];
  assert.deepEqual(validate(good).errors, []);
  const cases = [
    [d => { d.entities[0].body = 'giant'; }, 'entities[0].body'],
    [d => { d.entities[0].pose.values.lFore = 170; }, 'entities[0].pose.values.lFore'],
    [d => { d.entities[0].parent = 'ghost000'; }, 'entities[0].parent'],
    [d => { d.entities[1].id = character.id; }, 'entities[1].id'],
    [d => { d.schema = 'director-stage/9.9'; }, 'schema'],
    [d => { d.timeline.tracks[0].target = 'ghost000'; }, 'timeline.tracks[0].target'],
    [d => { d.timeline.tracks[0].keys[2].t = 2.5; }, 'timeline.tracks[0].keys[2].t'],
    [d => { d.timeline.tracks[1].target = character.id; }, 'timeline.tracks[1].target'],
    [d => { d.paths[0].id = character.id; }, 'paths[0].id'],
    [d => { d.paths[0].points = [[0, 0, 0]]; }, 'paths[0].points'],
  ];
  const app = { store: new DocumentStore() }, before = app.store.document;
  for (const [mutate, location] of cases) {
    const broken = structuredClone(good);
    mutate(broken);
    const result = validate(broken);
    assert.equal(result.ok, false, location);
    assert.ok(result.errors.some(error => error.startsWith(location)), result.errors.join('\n'));
    await assert.rejects(loadDocument(app, broken), { name: 'DocumentError' });
    assert.equal(app.store.document, before);
  }
});
