import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { migrate } from '../src/doc/migrate.js';
import { createEmptyDocument, validate } from '../src/doc/schema.js';
import { DocumentStore } from '../src/doc/Store.js';
import { loadDocument } from '../src/doc/serialize.js';
import { addCharacter } from '../src/doc/edit.js';
test('当前版本深拷贝、输入不变、再次迁移语义幂等', () => {
  const source = createEmptyDocument(), before = structuredClone(source), migrated = migrate(source);
  assert.deepEqual(migrated, source); assert.notEqual(migrated.scene.ground, source.scene.ground);
  assert.deepEqual(migrate(migrated), migrated);
  migrated.scene.ground.height = 3;
  assert.deepEqual(source, before);
});
test('原始值保持并由校验器拒绝', () => {
  for (const input of [null, undefined, 1, 'scene', false]) {
    assert.equal(migrate(input), input); assert.equal(validate(migrate(input)).ok, false);
  }
});
test('未知版本不被虚构迁移，后续校验拒绝', () => {
  const source = { ...createEmptyDocument(), schema: 'unsupported/version' };
  const result = migrate(source);
  assert.deepEqual(result, source); assert.equal(validate(result).ok, false);
});
test('真实旧文件缺可选字段仍兼容：旧镜头/路径/默认场景', () => {
  for (const file of ['round4-default', 'bench-seated', 'reference-standing']) {
    const source = JSON.parse(fs.readFileSync(`tests/fixtures/${file}.json`, 'utf8'));
    const before = structuredClone(source), migrated = migrate(source);
    assert.deepEqual(validate(migrated).errors, [], file);
    assert.deepEqual(source, before); assert.deepEqual(migrate(migrated), migrated);
  }
});

test('损坏的实体条目交给校验器定位，加载拒绝且不改变当前文档', async () => {
  const source = createEmptyDocument();
  source.entities = [null, false, 3, '角色', [], {}];
  const before = structuredClone(source);
  const migrated = migrate(source);
  assert.deepEqual(migrated.entities, source.entities);
  assert.deepEqual(source, before);
  const result = validate(migrated);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.startsWith('entities[0]')));
  const store = new DocumentStore(), current = store.document;
  await assert.rejects(loadDocument({ store }, source), error => error.name === 'DocumentError' && error.errors.some(message => message.startsWith('entities[0]')));
  assert.equal(store.document, current);
  assert.equal(store.revision, 0);
});

test('旧角色补色与新建角色使用相同顺序，预置色用尽后不重复且保留已有颜色', () => {
  const doc = createEmptyDocument();
  for (let i = 0; i < 12; i++) addCharacter(doc, { name: `角色${i}`, body: 'male' });
  const colors = doc.entities.map(e => e.trailColor);
  assert.equal(new Set(colors).size, colors.length);
  const old = structuredClone(doc);
  old.entities.forEach(e => { delete e.trailColor; });
  assert.deepEqual(migrate(old).entities.map(e => e.trailColor), colors);
  old.entities[5].trailColor = colors[0];
  const migrated = migrate(old);
  assert.equal(migrated.entities[0].trailColor, colors[1]);
  assert.equal(migrated.entities[5].trailColor, colors[0]);
  assert.equal(new Set(migrated.entities.map(e => e.trailColor)).size, colors.length);
  assert.deepEqual(migrate(migrated), migrated);
});
