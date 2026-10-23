import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { migrate } from '../src/doc/migrate.js';
import { createEmptyDocument, validate } from '../src/doc/schema.js';
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
    const source = JSON.parse(fs.readFileSync(`e2e/fixtures/${file}.json`, 'utf8'));
    const before = structuredClone(source), migrated = migrate(source);
    assert.deepEqual(validate(migrated).errors, [], file);
    assert.deepEqual(source, before); assert.deepEqual(migrate(migrated), migrated);
  }
});
