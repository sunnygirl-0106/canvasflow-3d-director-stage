import { ok, openApp, page } from '../harness.mjs';
import { canvasShot, gizmoDrag, pickInOutliner, scr, settle } from '../helpers.mjs';
import fs from 'node:fs';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
export async function run() {
  const out = 'test-output/motion';
  fs.mkdirSync(out, { recursive: true });
  const ids = await page.evaluate(async () => {
    const a = window.__app;
    const { createEmptyDocument } = await import('/src/doc/schema.js');
    await a.loadDocument(createEmptyDocument());
    const actor = await a.addCharacter('male'), other = await a.addCharacter('female');
    other.root.position.x = -4;
    a.edited(other);
    const p = a.timeline.addPath({ target: actor.id, points: [[-2, 0, 0], [0, .4, -1], [3, 0, -3]], start: 0, duration: 6, speed: 'linear',
      orient: 'keep', interpolation: 'polyline' });
    const tr = a.timeline.addTrack({ target: other.id, property: 'pos' });
    a.timeline.setKey(tr.id, 0, [-3, 0, 1], 'smooth');
    a.timeline.setKey(tr.id, 3, [0, 1, 1], 'linear');
    a.timeline.setKey(tr.id, 6, [3, 0, 1], 'linear');
    a.select(actor.id);
    a.setCameraView(false);
    a.rig.controls.target.set(0, 0, -1);
    a.stage.camera.position.set(6, 7, 10);
    a.rig.controls.update();
    a.history.reset();
    return { actorName: actor.name, otherName: other.name, actor: actor.id, other: other.id, path: p.id, track: tr.id };
  });
  const state = () => page.evaluate(ids => {
    const a = window.__app, ed = a.pathEditor;
    return { points: a.timeline.paths.find(p => p.id === ids.path)?.points, keys: a.timeline.tracks.find(t => t.id === ids.track)?.keys,
      base: a.store.document.entities.find(e => e.id === ids.actor)?.transform, actor: a.timeline.valueOf(a.findEntity(ids.actor), 'pos'), other: a
        .timeline.valueOf(a.findEntity(ids.other), 'pos'),
      ref: ed.ref, rev: a.store.revision, history: a.history.entries.length, drag: !!ed.drag, time: a.playback.time,
      proxy: ed.proxy.position.toArray(), gizmo: a.gizmo.visible, binding: a.gizmo.attached === ed.proxy, orbit: a.rig.controls.enabled,
      preview: !!a.pathOverlay.displayState.preview, count: a.pathOverlay.itemCount,
    };
  }, ids);
  const selectPath = async () => {
    await page.evaluate(ids => { const a = window.__app; a.select(ids.actor); a.pathEditor.selectNode({ kind: 'path', sourceId: ids.path, index: 1 }); }, ids);
    await settle();
  };
  await page.evaluate(() => window.__app.select(null));
  await pickInOutliner(ids.actorName);
  await settle();
  await canvasShot(`${out}/line-on.png`);
  await page.evaluate(() => window.__app.pathOverlay.setHidden(true));
  await canvasShot(`${out}/line-off.png`);
  const on = PNG.sync.read(fs.readFileSync(`${out}/line-on.png`)), off = PNG.sync.read(fs.readFileSync(`${out}/line-off.png`));
  const pixels = pixelmatch(on.data, off.data, null, on.width, on.height, { threshold: .05 });
  ok('选中路径角色实际绘制可见线像素', pixels > 30, `差异 ${pixels}px`);
  await pickInOutliner(ids.otherName);
  await settle();
  await canvasShot(`${out}/pos-line-on.png`);
  await page.evaluate(() => window.__app.pathOverlay.setHidden(true));
  await canvasShot(`${out}/pos-line-off.png`);
  const pon = PNG.sync.read(fs.readFileSync(`${out}/pos-line-on.png`)), poff = PNG.sync.read(fs.readFileSync(`${out}/pos-line-off.png`));
  ok('左栏选位置键角色也显示真实轨迹像素', pixelmatch(pon.data, poff.data, null, pon.width, pon.height, { threshold: .05 }) > 30);
  const body = await page.evaluate(async (ids) => {
    const a = window.__app;
    const { worldBox } = await import('/src/util/measure.js');
    const v = a.stage.camera.position.clone();
    worldBox(a.findEntity(ids.actor).root, { useBones: true }).getCenter(v);
    v.project(a.getRenderCamera());
    const r = a.stage.renderer.domElement.getBoundingClientRect();
    return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height];
  }, ids);
  await page.mouse.click(...body);
  await settle();
  ok('真实点击角色本体自动恢复其路径线', await page.evaluate(ids => window.__app.selectedId === ids.actor && window.__app.pathOverlay.visible && window.__app
    .pathOverlay.itemCount === 1, ids));
  await page.evaluate(ids => window.__app.select(ids.actor), ids);
  await settle();
  const line = await page.evaluate(id => { const m = window.__app.pathOverlay.pathOf(id); return m.positionAt(m.length * .7).toArray(); }, ids.path);
  await page.mouse.click(...await scr(line));
  await settle();
  await page.mouse.click(...await scr([-0, .41, -1]));
  await settle();
  let before = await state();
  ok('真实点击线和节点绑定唯一世界轴 Gizmo 并定位', before.binding && before.gizmo && before.ref?.index === 1 && before.time > 0);
  await page.evaluate(() => window.__timelinePanel.setCollapsed(false));
  await settle();
  ok('视口选点展开并高亮时间轴行', await page.$eval('.tl-path-node.is-selected', n => n.dataset.nodeIndex === '1'));
  await page.evaluate(() => {
    const a = window.__app, render = a.stage.render.bind(a.stage);
    window.motionFrames = [];
    a.stage.render = () => {
      const d = a.pathEditor.drag;
      if (d?.moved) {
        const it = a.pathOverlay.displayState.paths.find(it => it.source.id === d.ref.sourceId), p = a.pathEditor.point(d.ref, d.candidate);
        window.motionFrames.push({ consistent: JSON.stringify(it?.source) === JSON.stringify(d.candidate) && p.every((v, i) => Math.abs(v - a
            .pathEditor.proxy.position.getComponent(i)) < 1e-6) && p.every((v, i) => Math.abs(v - a.timeline.valueOf(a.selected, 'pos')[i]) < 1e-5),
          revision: a.store.revision, history: a.history.entries.length });
      }
      return render();
    };
  });
  await gizmoDrag('y', 1.1, { hold: async () => {
      await settle();
      const mid = await state();
      ok('未松手角色与点实时升高且 Store 和历史不变', mid.drag && mid.preview && mid.actor[1] > before.actor[1] + .8 && mid.rev === before.rev && mid
        .history === before.history, JSON.stringify(mid));
      await page.screenshot({ path: `${out}/y-preview-timeline.png` });
    } });
  const frames = await page.evaluate(() => window.motionFrames);
  ok('逐渲染帧角色、线、代理使用同一候选且历史/版本稳定', frames.length > 0 && frames.every(f => f.consistent && f.revision === before.rev && f.history === before.history),
    `${frames.length} 帧`);
  let after = await state();
  ok('Y 轴拖动只改当前点且一次提交', after.rev === before.rev + 1 && after.history === before.history + 1 && after.points[1][1] > before.points[1][1] + .8 && JSON
    .stringify(after.points[0]) === JSON.stringify(before.points[0]) && JSON.stringify(after.points[2]) === JSON.stringify(before.points[2]) && JSON
    .stringify(after.base) === JSON.stringify(before.base));
  await page.evaluate(() => window.__app.history.undo());
  await settle();
  ok('一次撤销恢复全部点', JSON.stringify((await state()).points) === JSON.stringify(before.points));
  await page.evaluate(() => window.__app.history.redo());
  await settle();
  ok('重做恢复三维编辑', JSON.stringify((await state()).points) === JSON.stringify(after.points));
  await selectPath();
  before = await state();
  await gizmoDrag('y', -.6);
  after = await state();
  ok('真实 Y 轴向下拖动降低高度', after.points[1][1] < before.points[1][1] - .4, JSON.stringify({ before, after }));
  before = after;
  await gizmoDrag('y', .8, { hold: async () => { await page.keyboard.press('Escape'); } });
  after = await state();
  ok('Esc 取消保持节点、文档、历史、播放头且恢复 Orbit', after.rev === before.rev && after.history === before.history && after.time === before.time && after
    .ref?.index === 1 && !after.drag && !after.preview && after.orbit && JSON.stringify(after.actor) === JSON.stringify(before.actor));
  for (const event of ['pointercancel', 'blur']) {
    before = await state();
    await gizmoDrag('y', .5, { hold: async () => {
        await page.evaluate(event => event === 'blur' ? window.dispatchEvent(new Event('blur')) : window
          .__app.stage.renderer.domElement.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, pointerType: 'mouse' })), event);
      } });
    after = await state();
    ok(`${event} 取消无提交且控制器恢复`, after.rev === before.rev && !after.preview && !after.drag && after.orbit);
  }
  before = await state();
  await gizmoDrag('y', 0);
  ok('零位移无历史', (await state()).history === before.history, JSON.stringify({ before, after: await state() }));
  // Timeline position keys use the same editor, preserving time/ease.
  await page.evaluate(ids => {
    const a = window.__app;
    a.select(ids.other);
    const p = window.__timelinePanel;
    p.trackRows.expandedEnts.add(ids.other);
    p.rebuild();
  }, ids);
  await settle();
  await page.click(`.tl-key[data-track="${ids.track}"][data-t="3"]`);
  await settle();
  before = await state();
  ok('时间轴位置键进入空间编辑', before.ref?.kind === 'pos' && before.ref.keyTime === 3 && before.binding && before.count === 1);
  await gizmoDrag('y', .8, { hold: async () => {
      const mid = await state();
      ok('位置键预览同步角色、原键保持不变', mid.other[1] > before.other[1] + .5 && mid.rev === before.rev, JSON.stringify({ before, mid }));
    } });
  after = await state();
  ok('位置键空间拖动保留 t、ease 和其他键', after.keys[1].value[1] > before.keys[1].value[1] + .5 && after.keys.every((k, i) => k.t === before.keys[i].t && k
    .ease === before.keys[i].ease) && JSON.stringify(after.keys[0]) === JSON.stringify(before.keys[0]));
  const box = await page.$eval(`.tl-key[data-track="${ids.track}"][data-t="3"]`, n => {
    const r = n.getBoundingClientRect();
    return [r.x + r
        .width / 2, r.y + r.height / 2];
  });
  await page.mouse.move(...box);
  await page.mouse.down();
  await page.mouse.move(box[0] + 50, box[1], { steps: 8 });
  await page.mouse.up();
  await settle();
  const moved = await state();
  ok('拖键改时间后节点引用跟随存活键', moved.ref?.keyTime !== 3 && moved.keys.some(k => k.t === moved.ref?.keyTime && JSON.stringify(k.value) === JSON
    .stringify(after.keys[1].value)), JSON.stringify(moved.ref));
  await gizmoDrag('y', -.4);
  ok('拖时间后可继续用 Gizmo 修改正确键', (await state()).rev === moved.rev + 1);
  const saved = await page.evaluate(() => window.__app.exportDocument());
  await page.evaluate(doc => window.__app.loadDocument(doc), saved);
  await settle();
  ok('存档重载位置与路径数据一致', await page.evaluate(doc => JSON.stringify(window.__app.store.document.paths) === JSON.stringify(doc.paths) && JSON
    .stringify(window.__app.timeline.tracks) === JSON.stringify(doc.timeline.tracks), saved));
  await selectPath();
  // Isolated coordinate fixture: leave room for the 200% scene and its handles.
  await page.evaluate(() => {
    const a = window.__app;
    a.rig.applyView(a.stage.camera.position.clone().set(9, 12, 16), a.rig.controls.target.clone()
      .set(0, 1, -1), 42);
  });
  // Full world matrix conversion under transformed stage; use the actual world-axis handle.
  for (const scale of [.5, 2]) {
    await page.evaluate(scale => {
      const w = window.__app.stage.world;
      w.scale.setScalar(scale);
      w.position.set(.3, .2, -.4);
      w.rotation.y = .4;
      w
        .updateMatrixWorld(true);
    }, scale);
    await settle();
    before = await state();
    await gizmoDrag('y', .4);
    after = await state();
    ok(`场景 ${scale * 100}% 缩放和平移旋转下世界 Y 换算正确`, Math.abs(after.points[1][1] - before.points[1][1] - .4 / scale) < .04, JSON.stringify({ before: before
        .points[1], after: after.points[1] }));
  }
  await page.evaluate(() => { const w = window.__app.stage.world; w.scale.setScalar(1); w.rotation.set(.2, .4, .1); w.updateMatrixWorld(true); });
  await settle();
  const worldPoint = () => page.evaluate(() => {
    const a = window.__app;
    return a.pathEditor.proxy.getWorldPosition(a.stage.camera.position.clone())
      .toArray();
  });
  const worldBefore = await worldPoint();
  await gizmoDrag('x', .4);
  const worldAfter = await worldPoint();
  ok('完整父矩阵旋转后世界 X 轴方向及局部回写正确', Math.abs(worldAfter[0] - worldBefore[0] - .4) < .03 && Math.abs(worldAfter[1] - worldBefore[1]) < .03 && Math
    .abs(worldAfter[2] - worldBefore[2]) < .03);
  await page.evaluate(() => {
    const w = window.__app.stage.world;
    w.scale.setScalar(1);
    w.position.set(0, 0, 0);
    w.rotation.set(0, 0, 0);
    w
      .updateMatrixWorld(true);
  });
  await selectPath();
  before = await state();
  await gizmoDrag('y', .4, { hold: async () => { await page.evaluate(ids => window.__app.rename(ids.actor, '改名中断'), ids); } });
  after = await state();
  ok('并发文档提交取消旧候选，不覆盖新版本', after.rev === before.rev + 1 && JSON.stringify(after.points) === JSON.stringify(before.points) && !after.drag && after.orbit);
  await page.screenshot({ path: `${out}/final.png` });
  // Single-key and empty tracks retain their actual semantics.
  const edge = await page.evaluate(ids => {
    const a = window.__app;
    a.select(ids.other);
    const tr = a.timeline.tracks.find(t => t.id === ids.track);
    a.store.batch('边界测试', () => {
      for (const k of tr.keys.slice(1))
        a.timeline.removeKey(tr.id, k.t);
    });
    const hidden = !a.pathOverlay.displayState.paths.some(it => it.source.id === tr.id);
    a.pathEditor.selectNode({ kind: 'pos', sourceId: tr.id, keyTime: tr.keys[0].t });
    const it = a.pathOverlay.displayState.paths.find(it => it.source.id === tr.id);
    const single = hidden && it.nodes.length === 1 && !it.hasLine;
    const point = a.pathEditor.point().slice();
    a.pathEditor.begin('direct');
    a.pathEditor.candidate([point[0], point[1] + 1, point[2]]);
    a.pathEditor.preview();
    const rev = a.store.revision;
    a.withCleanRender(() => {
      if (a.gizmo.visible || a.pathOverlay.visible)
        throw new Error('辅助层未隐藏');
    });
    const clean = !a.pathEditor.drag && a.store.revision === rev && JSON.stringify(a.pathEditor.point()) === JSON.stringify(point);
    a.timeline.removeKey(tr.id, tr.keys[0].t);
    return { single, clean, empty: !a.pathEditor.hasPoint && !a.pathOverlay.displayState.paths.some(it => it.source.id === tr.id) };
  }, ids);
  ok('单键仅在明确编辑时显示点、空轨道无点、截图统一取消预览', edge.single && edge.clean && edge.empty, JSON.stringify(edge));
  const boundaries = await page.evaluate(ids => {
    const a = window.__app;
    a.select(ids.actor);
    const results = [];
    for (const points of [[[0, 0, 0], [0, 3, 0]], [[0, 0, 0], [0, 0, 0]], [[0, 0, 0], [1, 2, 0], [3, 0, 1]]]) {
      a.timeline.updatePath(ids.path, { points, closed: false });
      a.pathEditor.selectNode({ kind: 'path', sourceId: ids.path, index: 1 });
      a.pathEditor.begin('direct');
      a.pathEditor.candidate([points[1][0], points[1][1] + .2, points[1][2]]);
      a.pathEditor.preview();
      results.push(a.pathEditor.proxy.position.toArray().every(Number.isFinite) && a.timeline.valueOf(a.selected, 'pos').every(Number.isFinite));
      a.pathEditor.cancel();
    }
    a.timeline.updatePath(ids.path, { closed: true });
    a.pathEditor.selectNode({ kind: 'path', sourceId: ids.path, index: 0, arrival: 'end' });
    const end = a.playback.time, p = a.timeline.paths.find(p => p.id === ids.path);
    a.pathEditor.begin('direct', true);
    a.pathEditor.candidate([0, .7, 0]);
    a.pathEditor.finish();
    const shifted = a.timeline.paths.find(p => p.id === ids.path);
    const closed = a.playback.time === end && end === p.start + p.duration && a.pathEditor.ref.arrival === 'end';
    const all = shifted.points.every((q, i) => Math.abs(q[1] - p.points[i][1] - .7) < 1e-6);
    a.timeline.updatePath(ids.path, { points: shifted.points.slice(0, 2), closed: false });
    a.pathEditor.selectNode({ kind: 'path', sourceId: ids.path, index: 1 });
    a.pathEditor.begin('direct');
    a.pathEditor.candidate([2, 2, 2]);
    a.pathEditor.preview();
    const rev = a.store.revision;
    a.timeline.removePath(ids.path);
    return { finite: results.every(Boolean), closed, all, deleted: !a.pathEditor.drag && !a.pathEditor.hasPoint && a.gizmo.attached !== a.pathEditor
        .proxy && a.store.revision === rev + 1 };
  }, ids);
  ok('竖直段/重合点/闭合末次到达/Shift整条位移/删除中断', Object.values(boundaries).every(Boolean), JSON.stringify(boundaries));
  await page.evaluate(ids => {
    const a = window.__app;
    for (const [t, value] of [[0, [-3, 0, 1]], [3, [0, 1, 1]], [6, [3, 0, 1]]])
      a.timeline.setKey(ids.track, t, value, 'smooth');
    a.select(ids.other);
    const p = window.__timelinePanel;
    p.trackRows.expandedEnts.add(ids.other);
    p.rebuild();
  }, ids);
  await settle();
  const keySelector = t => `.tl-key[data-track="${ids.track}"][data-t="${t}"]`;
  await page.click(keySelector(3));
  await settle();
  const copyStart = await page.$eval(keySelector(3), n => { const r = n.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  const dx = await page.evaluate(() => 3 * window.__timelinePanel.pps);
  await page.keyboard.down('Alt');
  await page.mouse.move(...copyStart);
  await page.mouse.down();
  await page.mouse.move(copyStart[0] + dx, copyStart[1], { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await settle();
  let copied = await state();
  ok('Alt 拖键同刻覆盖后高亮最终存活键，原键保留', copied.ref?.keyTime === 6 && copied.keys.length === 3 && JSON.stringify(copied.keys[1].value) === JSON
    .stringify(copied.keys[2].value));
  before = copied;
  await gizmoDrag('y', .3);
  copied = await state();
  ok('复制覆盖后的 Gizmo 只编辑最终存活键', copied.keys[2].value[1] > before.keys[2].value[1] + .2 && JSON.stringify(copied.keys[1]) === JSON.stringify(before.keys[1]));
  await page.click(keySelector(0));
  await page.keyboard.down('Shift');
  await page.click(keySelector(3));
  await page.keyboard.up('Shift');
  await settle();
  ok('时间轴多选保留集合并隐藏点 Gizmo', await page.evaluate(() => window.__timelinePanel.selKeys.size === 2 && !window.__app.pathEditor.hasPoint && !window.__app
    .gizmo.visible));
  await page.keyboard.press('Delete');
  await settle();
  ok('时间轴聚焦删除键而非角色', await page.evaluate(ids => !!window.__app.findEntity(ids.other) && window.__app.timeline.tracks.find(t => t.id === ids.track)
    .keys.length === 1, ids));
  const follow = await page.evaluate(ids => {
    const a = window.__app, c = a.addCamera('front_mid'), tr = a.timeline.addTrack({ target: c.id, property: 'pos' });
    a.timeline.setKey(tr.id, 0, [0, 1, 3]);
    a.timeline.setKey(tr.id, 5, [3, 1, 3]);
    a.timeline.addConstraint({ type: 'follow', target: c.id, subject: ids.actor, offset: [0, 1, 3] });
    a.select(c.id);
    a.playback.seek(0);
    const noEdit = !a.pathEditor.selectNode({ kind: 'pos', sourceId: tr.id, keyTime: 0 });
    return noEdit && !a.pathOverlay.displayState.paths.find(it => it.source.id === tr.id).visible && !a.pathEditor.hasPoint;
  }, ids);
  ok('follow 覆盖位置时隐藏误导轨迹并拒绝空间入口', follow);
  await checkMotionFields();
}
async function checkMotionFields() {
  await page.evaluate(() => localStorage.clear());
  await page.setViewport({ width: 1440, height: 810, deviceScaleFactor: 1 });
  await openApp();
  const OUT = 'test-output/motion/checkMotionFields';
  const snap = async (name) => {
    await page.mouse.move(450, 30);
    await settle(100);
    const style = await page.addStyleTag({ content: '#uiTooltip, #toast { visibility:hidden; }' });
    await page.screenshot({ path: `${OUT}/${name}.png` });
    await style.dispose();
    await page
      .evaluate(() => document.querySelectorAll('style').forEach(s => {
      if (s.textContent === '#uiTooltip, #toast { visibility:hidden; }')
        s.remove();
    }));
  };
  const field = async (label, index, value) => {
    const selector = await page.evaluate(({ label, index }) => {
      const row = [...document.querySelectorAll('#inspector .field')].find(n => n.querySelector('label')?.textContent === label);
      const input = row?.querySelectorAll('input:not([type=range])')[index];
      if (!input)
        throw new Error('缺少字段 ' + label);
      input.dataset.testInput = 'edit';
      return '[data-test-input="edit"]';
    }, { label, index });
    await page.focus(selector);
    await page.$eval(selector, (input, value) => {
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input
        .dispatchEvent(new Event('change', { bubbles: true }));
      input.blur();
      delete input.dataset.testInput;
    }, value);
    await settle(100);
  };
  fs.mkdirSync(OUT, { recursive: true });
  const seed = await page.evaluate(() => window.__app.exportDocument());
  await page.evaluate(() => window.__timelinePanel.setCollapsed(false));
  const pathId = await page.evaluate(async (doc) => {
    const a = window.__app;
    await a.loadDocument(doc);
    const e = a.entities[0];
    const path = a.timeline.addPath({ target: e.id, points: [[-1, 0, 0], [1, 1, 0], [3, 2, 0]], start: 1, duration: 8, orient: 'tangent',
      interpolation: 'polyline' });
    a.timeline.updatePath(path.id, { stops: [1], stopTimes: [4] });
    a.select(e.id);
    a.playback.seek(2);
    a.emit('inspect', { id: e.id, section: 'path' });
    const p = window.__timelinePanel;
    p.trackRows.expandedEnts.add(e.id);
    p.rebuild();
    a.history.reset();
    return path.id;
  }, seed);
  await snap('path-before');
  ok('运动轨迹页恰好六字段、Y朝向锁定', await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.character-path > .field > label, .character-path > .toggle-row > .t-label')].map(n => n.textContent);
    return labels.join() === '时长,位置,旋转,缩放,统一缩放,绑定对象沿路径朝向' && document.querySelectorAll('.character-path .triple')[1].querySelectorAll('input')[1].disabled;
  }));
  await page.click(`.tl-track[data-path="${pathId}"] .tl-key-toggle`);
  await snap('path-after');
  const inserted = await page.evaluate(id => {
    const a = window.__app, p = a.timeline.paths.find(p => p.id === id);
    a.history.capture();
    return { p, noPos: !a.timeline.tracks.some(t => t.property === 'pos'), selected: a.pathOverlay.selVertex, filled: document
        .querySelector(`.tl-track[data-path="${id}"] .tl-key-toggle`).dataset.filled, history: a.history.entries.length, time: a.playback.time };
  }, pathId);
  ok('路径插点保持高度/停顿/时长、不建pos轨道，选中并实心，一次撤销', inserted.p.points.length === 4 && inserted.p.points[1][1] > 0 && inserted.p.points[1][1] < 1 && inserted.p
    .stops[0] === 2 && inserted.p.stopTimes[0] === 4 && inserted.p.start === 1 && inserted.p.duration === 8 && inserted.noPos && inserted.selected
    .index === 1 && inserted.filled === 'true' && inserted.history === 2, JSON.stringify(inserted));
  await page.evaluate(() => window.__app.history.undo());
  ok('一步撤销恢复原路径', await page.evaluate(() => window.__app.timeline.paths[0].points.length === 3));
  await page.evaluate(() => {
    const a = window.__app;
    a.playback.seek(3);
    a.emit('inspect', { id: a.entities[0].id, section: 'path' });
    a.history
      .reset();
    window.pathBefore = a.exportDocument();
  });
  const oldPos = await page.evaluate(() => window.__app.timeline.valueOf(window.__app.entities[0], 'pos'));
  await field('位置', 0, oldPos[0] + 2);
  ok('位置字段平移整条轨迹和基准，形状/时序保留', await page.evaluate(() => {
    const a = window.__app, before = window.pathBefore, after = a.exportDocument();
    return after.paths[0].points.every((p, i) => Math.abs(p[0] - before.paths[0].points[i][0] - 2) < 1e-5 && p[1] === before.paths[0].points[i][1]) &&
      Math.abs(after.entities[0].transform.pos[0] - before.entities[0].transform.pos[0] - 2) < 1e-5 && after.paths[0].start === 1 && after.paths[0]
      .duration === 8;
  }));
  const orient = await page.evaluate(() => {
    const a = window.__app, e = a.entities[0];
    const before = e.root.quaternion.clone();
    a.timeline
      .setPathOrientation(a.timeline.paths[0].id, 'keep');
    return before.angleTo(e.root.quaternion);
  });
  ok('关闭沿路径朝向保持可见姿态', orient < 1e-5, String(orient));
  await settle();
  await field('统一缩放', 0, 1.4);
  ok('统一缩放即时同步XYZ且不改变路径长度', await page.evaluate(() => {
    const a = window.__app;
    return a.timeline.valueOf(a.entities[0], 'scale').every(v => Math
      .abs(v - 1.4) < 1e-5) && a.timeline.paths[0].points.length === 3;
  }));
  await field('时长', 0, 99);
  ok('时长夹取剩余场景范围，不重置start或延长场景', await page.evaluate(() => {
    const a = window.__app;
    return a.timeline.duration === 10 && a.timeline.paths[0]
      .start === 1 && a.timeline.paths[0].duration === 9;
  }));
  await snap('motion-six-fields');
  const roundtrip = await page.evaluate(async () => {
    const a = window.__app;
    const doc = a.exportDocument({ view: false });
    await a
      .loadDocument(doc);
    const restored = a.exportDocument({ view: false });
    delete doc.meta.updatedAt;
    delete restored.meta.updatedAt;
    return JSON
      .stringify(doc) === JSON.stringify(restored);
  });
  ok('六字段编辑后保存恢复一致', roundtrip);
  const performance = await page.evaluate(async () => {
    const a = window.__app;
    let rebuilds = 0;
    const observer = new MutationObserver(records => { rebuilds += records.filter(r => r.type === 'childList').length; });
    observer.observe(document.querySelector('.tl-rows'), { childList: true });
    for (let i = 0; i < 30; i++)
      a.playback.seek(i / 30);
    await new Promise(resolve => requestAnimationFrame(resolve));
    observer.disconnect();
    return rebuilds;
  });
  ok('播放tick不重建时间轴DOM', performance === 0, String(performance));
}
