import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatches } from 'immer';
import { DocumentStore } from '../src/doc/Store.js';

test('事务只复制修改的分支；补丁及逆补丁可往返', () => {
  const store = new DocumentStore();
  const before = store.document;
  let event;
  store.on('change', (e) => { event = e; });
  store.transact('地面', (d) => { d.scene.ground.height = 1; });
  assert.equal(store.document.entities, before.entities);
  assert.notEqual(store.document.scene, before.scene);
  assert.deepEqual(applyPatches(before, event.patches), store.document);
  assert.deepEqual(applyPatches(store.document, event.inversePatches), before);
  assert.throws(() => { store.document.scene.ground.height = 2; }, TypeError);
});

test('无改动不通知；校验失败及抛错不修改文档', () => {
  const store = new DocumentStore();
  const before = store.document;
  let changes = 0;
  store.on('change', () => changes++);
  assert.equal(store.transact('不变', (d) => { d.scene.scale = 1; }), false);
  assert.throws(() => store.transact('坏值', (d) => { d.scene.scale = -1; }));
  assert.throws(() => store.transact('异常', (d) => { d.scene.scale = 2; throw new Error('stop'); }));
  assert.equal(store.document, before);
  assert.equal(changes, 0);
});

test('异步准备的旧版本不能覆盖后续编辑；运行时提交失败不发布', () => {
  const store = new DocumentStore();
  const pending = store.prepare('加载', (d) => { d.meta.name = '旧请求'; });
  store.transact('后来编辑', (d) => { d.meta.name = '新编辑'; });
  assert.throws(() => store.commit(pending), /场景已被修改/);
  const before = store.document;
  assert.throws(() => store.transact('失败', (d) => { d.meta.name = '失败'; }, { apply() { throw new Error('load failed'); } }));
  assert.equal(store.document, before);
});

test('整份导入相同文档不产生补丁，外部数据不会被冻住或共享可变引用', () => {
  const store = new DocumentStore();
  const input = structuredClone(store.document);
  assert.equal(store.prepareReplacement('相同', input), null);
  input.meta.name = '导入';
  const change = store.prepareReplacement('导入', input);
  store.commit(change);
  input.scene.ground.height = 7;
  assert.equal(store.document.scene.ground.height, 0);
  assert.deepEqual(change.patches.map((p) => p.path), [['meta', 'name']]);
});

test('批量事务只发布最终结果；异常回滚全部步骤；缩短数组没有空洞', () => {
  const store = new DocumentStore();
  let changes = 0;
  store.on('change', () => changes++);
  store.batch('组合', () => {
    store.transact('一', (d) => { d.meta.name = '一'; });
    store.transact('二', (d) => { d.meta.name += '二'; });
  });
  assert.equal(store.document.meta.name, '一二');
  assert.equal(changes, 1);
  assert.throws(() => store.batch('失败', () => {
    store.transact('先修改', (d) => { d.meta.name = '丢弃'; });
    throw new Error('失败');
  }));
  assert.equal(store.document.meta.name, '一二');
  const input = structuredClone(store.document);
  input.scene.pos = [1, 2, 3];
  store.commit(store.prepareReplacement('数组', input));
  assert.deepEqual(store.document.scene.pos, [1, 2, 3]);
});
