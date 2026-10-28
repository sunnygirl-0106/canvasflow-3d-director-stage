import { page, ok } from '../harness.mjs';
import { buildAnimScene, gizmoDrag, settle } from '../helpers.mjs';
export async function run() {
  const result = await page.evaluate(async () => {
    const a = window.__app;
    a.playback.stop();
    const p = a.addProp('box');
    a.history.reset();
    const initial = a.store.document;
    const pos = initial.entities.find((e) => e.id === p.id).transform.pos;
    p.root.position.x += 2;
    const previewOnly = a.exportDocument({ view: false }).entities.find((e) => e.id === p.id).transform.pos[0] === pos[0];
    a.edited(p);
    a.history.capture();
    const committed = a.store.document;
    const moved = committed.entities.find((e) => e.id === p.id).transform.pos[0] === Math.round((pos[0] + 2) * 1e6) / 1e6;
    const unrelated = committed.entities[0] === initial.entities[0];
    const count = a.history.entries.length;
    a.edited(p);
    a.history.capture();
    const noop = a.history.entries.length === count;
    await a.history.undo();
    const undo = p.root.position.x === pos[0] && a.findEntity(p.id) === p;
    await a.history.redo();
    const redo = p.root.position.x === Math.round((pos[0] + 2) * 1e6) / 1e6;
    a.setGroundOpacity(0.7, { preview: true });
    const scenePreview = a.store.document.scene.ground.opacity === initial.scene.ground.opacity;
    a.commitScenePreview();
    a.history.capture();
    const sceneCommit = a.store.document.scene.ground.opacity === 0.7;
    await a.history.undo();
    const sceneUndo = a.store.document.scene.ground.opacity === initial.scene.ground.opacity;
    // 第一次自动打键时，预览值写键，原手动值仍由文档提供。
    a.playback.seek(1);
    a.autoKey = true;
    const manual = a.store.document.entities.find((e) => e.id === p.id).transform.pos[0];
    p.root.position.x = manual + 3;
    a.edited(p, new Set(['pos']));
    const track = a.timeline.tracks.find((t) => t.target === p.id && t.property === 'pos');
    const autoKey = Math.abs((track?.keys[0].value[0] ?? Infinity) - manual - 3) < 1e-6 && a.store.document.entities.find((e) => e.id === p.id)
      .transform.pos[0] === manual;
    a.playback.stop();
    a.autoKey = false;
    const stopped = p.root.position.x === manual;
    return { previewOnly, moved, unrelated, noop, undo, redo, scenePreview, sceneCommit, sceneUndo, autoKey, stopped };
  });
  ok('实体预览不改文档；提交只替换改动分支；空操作不记历史', result.previewOnly && result.moved && result.unrelated && result.noop, JSON.stringify(result));
  ok('补丁撤销/重做复用实体；场景滑条预览松手提交且可撤销', result.undo && result.redo && result.scenePreview && result.sceneCommit && result.sceneUndo);
  ok('首次自动打键保留原手动值，stop 恢复原值', result.autoKey && result.stopped);
  const failures = await page.evaluate(async () => {
    const a = window.__app;
    a.history.capture();
    const original = a.panorama.prepare.bind(a.panorama);
    const before = a.store.document;
    const index = a.history.index;
    const runtime = a.entities.slice();
    const doc = a.exportDocument({ view: false });
    doc.meta.name = '加载失败';
    a.panorama.prepare = async () => { throw new Error('模拟资源加载失败'); };
    let rejected = false;
    try {
      await a.loadDocument(doc);
    }
    catch {
      rejected = true;
    }
    const atomic = rejected && a.store.document === before && a.history.index === index && a.entities.every((e, i) => e === runtime[i]);
    let release, started;
    const gate = new Promise((r) => { release = r; });
    const ready = new Promise((r) => { started = r; });
    a.panorama.prepare = async (ref) => { started(); await gate; return original(ref); };
    const pending = a.loadDocument(doc).then(() => false, () => true);
    await ready;
    const entity = a.entities[0];
    a.rename(entity.id, '加载期间的新编辑');
    release();
    const conflict = await pending;
    a.panorama.prepare = original;
    return { atomic, conflict, kept: a.store.document.entities.find((e) => e.id === entity.id).name === '加载期间的新编辑', name: a.store.document.meta.name };
  });
  ok('资源准备失败不改变文档、实体和历史索引', failures.atomic);
  ok('异步加载拒绝旧版本，保留准备期间的新编辑', failures.conflict && failures.kept && failures.name !== '加载失败');
  const batch = await page.evaluate(() => {
    const a = window.__app;
    const before = a.store.document;
    let events = 0;
    const off = a.store.on('change', () => events++);
    let failed = false;
    try {
      a.store.batch('失败的组合', () => {
        a.timeline.setDuration(12);
        a.timeline.setFps(-1);
      });
    }
    catch {
      failed = true;
    }
    off();
    return failed && a.store.document === before && events === 0 && a.timeline.duration === before.timeline.duration;
  });
  ok('复合编辑失败整批回滚，无中间通知', batch);
  const ids = await buildAnimScene();
  const structure = await page.evaluate(async ({ m, f, p }) => {
    const a = window.__app;
    const stable = (v) => JSON.stringify(v, (_, value) => value && !Array.isArray(value) && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value);
    const before = stable(a.store.document);
    const originalPrepare = a.store.prepare;
    a.store.prepare = function (label, recipe) { return originalPrepare.call(this, label, doc => { recipe(doc); doc.timeline.fps = -1; }); };
    let rejected = false;
    try {
      a.groupCharacters([m, f]);
    }
    catch {
      rejected = true;
    }
    a.store.prepare = originalPrepare;
    const groupAtomic = rejected && stable(a.store.document) === before
      && [m, f].every((id) => a.entities.includes(a.findEntity(id)) && a.findEntity(id).root.parent === a.stage.world);
    const group = a.groupCharacters([m, f, m]);
    a.history.capture();
    const grouped = a.store.document.entities.find((e) => e.id === group.id).members.length === 2;
    await a.history.undo();
    const groupUndo = stable(a.store.document) === before;
    await a.history.redo();
    const current = a.findEntity(group.id);
    current.root.rotation.y = 0.6;
    a.edited(current);
    a.history.capture();
    const positions = current.members.map((e) => e.root.getWorldPosition(e.root.position.clone()).toArray());
    const groupedDoc = stable(a.store.document);
    a.store.prepare = function (label, recipe) { return originalPrepare.call(this, label, doc => { recipe(doc); doc.timeline.fps = -1; }); };
    rejected = false;
    try {
      a.ungroupCrowd(group.id);
    }
    catch {
      rejected = true;
    }
    a.store.prepare = originalPrepare;
    const ungroupAtomic = rejected && stable(a.store.document) === groupedDoc
      && current.members.every((e) => e.root.parent === current.root);
    a.ungroupCrowd(group.id);
    a.history.capture();
    const ungrouped = [m, f].every((id, i) => {
      const e = a.findEntity(id);
      const pos = e.root.getWorldPosition(e.root.position.clone()).toArray();
      return e.root.parent === a.stage.world && pos.every((v, k) => Math.abs(v - positions[i][k]) < 1e-5);
    });
    await a.history.undo();
    const ungroupUndo = stable(a.store.document) === groupedDoc;
    const { Prop } = await import('/src/entities/Prop.js');
    const fromJSON = Prop.fromJSON;
    const doc = a.store.document, runtime = a.entities.slice();
    Prop.fromJSON = async () => { throw new Error('模拟复制资源失败'); };
    try {
      await a.duplicateMany([m, p]);
    }
    finally {
      Prop.fromJSON = fromJSON;
    }
    const duplicateAtomic = a.store.document === doc && a.entities.length === runtime.length && a.entities.every((e, i) => e === runtime[i]);
    a.history.capture();
    const index = a.history.index;
    await a.duplicateMany([m, p]);
    a.history.capture();
    const duplicated = a.store.document.entities.length === doc.entities.length + 2 && a.history.index === index + 1 && a.history.entries.length === index + 2;
    await a.history.undo();
    return { groupAtomic, grouped, groupUndo, ungroupAtomic, ungrouped, ungroupUndo, duplicateAtomic, duplicated, duplicateUndo: stable(a.store
        .document) === stable(doc) };
  }, ids);
  ok('打组校验失败不动父子树，重复选择去重，单步撤销恢复', structure.groupAtomic && structure.grouped && structure.groupUndo, JSON.stringify(structure));
  ok('解组校验失败不动父子树，旋转组解组保持世界位置且可撤销', structure.ungroupAtomic && structure.ungrouped && structure.ungroupUndo);
  ok('多实体复制资源失败无部分入场，成功一次提交且可撤销', structure.duplicateAtomic && structure.duplicated && structure.duplicateUndo);
  const activeFailure = await page.evaluate(({ m, f }) => {
    const a = window.__app;
    const group = a.entities.find((e) => e.type === 'group' && e.members.some((member) => member.id === m));
    a.ungroupCrowd(group.id);
    const track = a.timeline.addTrack({ target: m, property: 'pos' });
    a.timeline.setKey(track.id, 0, [-2, 0, 0]);
    a.timeline.setKey(track.id, 2, [2, 0, 0]);
    a.playback.seek(1);
    const before = a.store.document;
    const pos = a.findEntity(m).root.position.toArray();
    const prepare = a.store.prepare;
    a.store.prepare = function (label, recipe) { return prepare.call(this, label, doc => { recipe(doc); doc.timeline.fps = -1; }); };
    let rejected = false;
    try {
      a.groupCharacters([m, f]);
    }
    catch {
      rejected = true;
    }
    finally {
      a.store.prepare = prepare;
    }
    const kept = a.store.document === before && a.timeline.active
      && a.findEntity(m).root.position.toArray().every((v, i) => Math.abs(v - pos[i]) < 1e-6);
    a.playback.stop();
    return rejected && kept;
  }, ids);
  ok('动画预览期间打组校验失败，恢复原播放帧且文档不变', activeFailure);
  await page.evaluate(({ p }) => {
    const a = window.__app;
    a.playback.stop();
    a.select(p);
    a.setTransformMode('translate');
    a.history.capture();
    window.__cancelBefore = { doc: a.store.document, entries: a.history.entries.length, pos: a.selected.root.position.toArray() };
  }, ids);
  await settle();
  for (const kind of ['Escape', 'pointercancel']) {
    let moved = false;
    await gizmoDrag('x', 0.8, { hold: async () => {
        moved = await page.evaluate(() => {
          const a = window.__app;
          return a.gizmo.dragging && Math.abs(a.selected.root.position.x - window.__cancelBefore.pos[0]) > 0.1
            && a.store.document === window.__cancelBefore.doc;
        });
        if (kind === 'Escape')
          await page.keyboard.press('Escape');
        else
          await page.evaluate(() => window.__app.stage.renderer.domElement.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })));
      } });
    const restored = await page.evaluate(() => {
      const a = window.__app, before = window.__cancelBefore;
      a.history.capture();
      return !a.gizmo.dragging && a.store.document === before.doc && a.history.entries.length === before.entries
        && a.selected.root.position.toArray().every((v, i) => Math.abs(v - before.pos[i]) < 1e-6);
    });
    ok(`真实 gizmo 拖动 ${kind} 恢复预览，不写文档或历史`, moved && restored, JSON.stringify({ moved, restored }));
  }
  await page.evaluate(() => {
    const a = window.__app;
    a.history.reset();
    window.__undoPreview = { name: a.selected.name, pos: a.selected.root.position.toArray() };
    a.rename(a.selectedId, '拖动前已提交的改名');
    a.history.capture();
  });
  let undoDragged = false;
  await gizmoDrag('x', 0.8, { hold: async () => {
      undoDragged = await page.evaluate(async () => {
        const a = window.__app;
        const moved = a.gizmo.dragging && Math.abs(a.selected.root.position.x - window.__undoPreview.pos[0]) > 0.1;
        return await a.history.undo() && moved;
      });
    } });
  const undoPreview = await page.evaluate(() => {
    const a = window.__app, before = window.__undoPreview;
    a.history.capture();
    return !a.gizmo.dragging && a.history.index === 0 && a.history.canRedo && a.selected.name === before.name
      && a.selected.root.position.toArray().every((v, i) => Math.abs(v - before.pos[i]) < 1e-6);
  });
  ok('真实 gizmo 拖动中撤销：丢弃未提交预览，撤销前一操作并保留重做', undoDragged && undoPreview);
  const scrubPoint = await page.evaluate(async () => {
    const { tripleRow } = await import('/src/ui/widgets.js');
    const state = window.__scrubTest = { value: 2, commits: 0 };
    const row = tripleRow({ axes: [{ key: 'x', get: () => state.value, set: (v) => { state.value = v; } }], onCommit: () => state.commits++ });
    row.el.id = 'scrub-cancel-test';
    row.el.style.cssText = 'position:fixed;left:400px;top:100px;z-index:99999;width:200px';
    document.body.append(row.el);
    const r = row.el.querySelector('.ax').getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  });
  await page.mouse.move(...scrubPoint);
  await page.mouse.down();
  await page.mouse.move(scrubPoint[0] + 40, scrubPoint[1], { steps: 8 });
  const scrub = await page.evaluate(() => {
    const state = window.__scrubTest, row = document.querySelector('#scrub-cancel-test');
    const moved = state.value !== 2;
    row.querySelector('.ax').dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
    const restored = state.value === 2 && state.commits === 0 && row.querySelector('input').value === '2.00';
    row.remove();
    return moved && restored;
  });
  await page.mouse.up();
  ok('通用数值轴真实拖动 pointercancel 恢复数值与显示，不触发提交', scrub);
}
