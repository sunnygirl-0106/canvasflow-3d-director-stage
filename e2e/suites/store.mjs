import { page, ok } from '../harness.mjs';

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
    a.edited(p); a.history.capture();
    const committed = a.store.document;
    const moved = committed.entities.find((e) => e.id === p.id).transform.pos[0] === pos[0] + 2;
    const unrelated = committed.entities[0] === initial.entities[0];
    const count = a.history.entries.length;
    a.edited(p); a.history.capture();
    const noop = a.history.entries.length === count;
    await a.history.undo();
    const undo = p.root.position.x === pos[0] && a.findEntity(p.id) === p;
    await a.history.redo();
    const redo = p.root.position.x === pos[0] + 2;
    a.setGroundOpacity(0.7, { preview: true });
    const scenePreview = a.store.document.scene.ground.opacity === initial.scene.ground.opacity;
    a.commitScenePreview(); a.history.capture();
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
    const autoKey = Math.abs((track?.keys[0].value[0] ?? Infinity) - manual - 3) < 1e-6 && a.store.document.entities.find((e) => e.id === p.id).transform.pos[0] === manual;
    a.playback.stop(); a.autoKey = false;
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
    const doc = a.exportDocument({ view: false }); doc.meta.name = '加载失败';
    a.panorama.prepare = async () => { throw new Error('模拟资源加载失败'); };
    let rejected = false;
    try { await a.loadDocument(doc); } catch { rejected = true; }
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
    } catch { failed = true; }
    off();
    return failed && a.store.document === before && events === 0 && a.timeline.duration === before.timeline.duration;
  });
  ok('复合编辑失败整批回滚，无中间通知', batch);
}
