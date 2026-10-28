import fs from 'node:fs';
import { page, ok } from '../harness.mjs';
import { settle } from '../helpers.mjs';
const OUT = 'test-output/object-playback';
async function load(index = 4, duration) {
  return page.evaluate(async ({ index, duration }) => {
    const a = window.__app, p = window.__timelinePanel;
    const { createPresetScene } = await import('/src/ai/presets.js');
    const doc = createPresetScene(index);
    if (duration)
      doc.timeline.duration = duration;
    a.stopPreview();
    await a.loadDocument(doc, { applyView: true });
    const c = a.entities.find(e => e.type === 'character');
    a.select(c.id, { user: true });
    p.setCollapsed(false);
    p.setHeight(300);
    p.trackRows.expandedEnts.add(c.id);
    p.rebuild();
    p.setZoom(0);
    p.scroll.scrollLeft = 0;
    p.scroll.scrollTop = 0;
    a.history.reset();
    return c.id;
  }, { index, duration });
}
async function read(id) {
  return page.evaluate(id => {
    const a = window.__app, head = [...document.querySelectorAll('.tl-head')].find(n => n.dataset.ent === id);
    const bar = head.querySelector('.tl-bar-object');
    return { range: bar && ['--t0', '--t1'].map(k => +bar.style.getPropertyValue(k)),
      path: a.timeline.paths.find(p => p.target === id), tracks: a.timeline.tracks.filter(t => t.target === id),
      history: a.history.entries.length, document: JSON.stringify(a.store.document) };
  }, id);
}
async function drag(id, edge, seconds, cancel = false) {
  const selector = `.tl-head[data-ent="${id}"] .tl-bar-object` + (edge === 'mid' ? '' : ` .tl-bar-end.${edge}`);
  const { x, y, pps } = await page.$eval(selector, n => {
    const r = n.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2,
      pps: window.__timelinePanel.pps };
  });
  const before = await read(id);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + seconds * pps, y, { steps: 8 });
  const during = await page.evaluate(id => {
    const row = [...document.querySelectorAll('.tl-track[data-property-row="rot"]')].find(n => n.dataset.ent === id);
    return { last: +row.querySelector('.tl-key:last-child').style.getPropertyValue('--t'), document: JSON.stringify(window.__app.store.document) };
  }, id);
  if (cancel)
    await page.keyboard.press('Escape');
  await page.mouse.up();
  await settle();
  return { before, during, after: await read(id) };
}
export async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  await page.setViewport({ width: 1600, height: 1000 });
  await page.addStyleTag({ content: '#toast { visibility: hidden !important; }' });
  for (let i = 0; i < 8; i++) {
    const id = await load(i);
    ok(`预制 ${i + 1}：完整角色名，角色/机位轨迹无名称精灵，头顶同名`, await page.evaluate(() => {
      const a = window.__app, chars = a.entities.filter(e => e.type === 'character');
      const names = chars.every((c, n) => c.name === `角色${String.fromCharCode(65 + n)}`);
      let clean = true;
      for (const ent of a.entities.filter(e => ['character', 'camera'].includes(e.type))) {
        a.select(ent.id, { user: true });
        a.pathOverlay.group.traverse(o => {
          if (o.isSprite)
            clean = false;
        });
      }
      a.setLabelPreview(true);
      a.beforeRender();
      const spriteNames = chars.every(c => a.labelSprites.labels[c.id] === c.name);
      a.setLabelPreview(false);
      a.playback.play();
      a.playback.pause();
      a.pathOverlay.rebuild();
      a.pathOverlay.group.traverse(o => {
        if (o.isSprite)
          clean = false;
      });
      return names && clean && spriteNames;
    }));
    if (i === 7) {
      ok('六人预制后新增角色继续序号；导入小美、阿杰及单字母名字不改名', await page.evaluate(async (id) => {
        const a = window.__app, next = await a.addCharacter('female');
        const unique = next.name === '角色G';
        a.rename(id, '小美');
        const other = a.entities.find(e => e.type === 'character' && e.id !== id);
        a.rename(other.id, '阿杰');
        const doc = a.exportDocument();
        doc.entities.find(e => e.id === next.id).name = 'A';
        await a.loadDocument(doc);
        return unique && a.findEntity(id).name === '小美' && a.findEntity(other.id).name === '阿杰' && a.findEntity(next.id).name === 'A';
      }, id));
    }
  }
  let id = await load();
  // 用户事先手动选定的导演总览；播放/暂停必须原样恢复，不能重新取景。
  await page.evaluate(() => { const a = window.__app, V = a.stage.camera.position.constructor; a.rig.applyView(new V(6, 5, 12), new V(0, 1, 0), 50); });
  await settle();
  ok('越过门槛展开时间轴：对象 0–6、位置路径 0–5、旋转至 6', await page.evaluate(id => {
    const head = document.querySelector(`.tl-head[data-ent="${id}"] .tl-bar-object`);
    const path = document.querySelector(`.tl-track[data-ent="${id}"][data-path] .tl-bar-path`);
    const rot = [...document.querySelectorAll(`.tl-track[data-ent="${id}"][data-property-row="rot"] .tl-key`)];
    return +head.style.getPropertyValue('--t1') === 6 && +path.style.getPropertyValue('--t1') === 5 && +rot.at(-1).dataset.t === 6;
  }, id));
  await page.screenshot({ path: `${OUT}/threshold-expanded.png` });
  const snapshot = await page.evaluate(() => {
    const a = window.__app, p = window.__timelinePanel;
    a.beforeRender();
    a.stage.camera.updateMatrixWorld(true);
    return { view: a.stage.camera.matrixWorld.toArray(), target: a.rig.controls.target.toArray(), zoom: a.stage.camera.zoom,
      doc: JSON.stringify(a.store.document), selected: a.selectedId, expanded: [...p.trackRows.expandedEnts], scroll: [p.scroll.scrollLeft, p.scroll
          .scrollTop], history: a.history.entries.length };
  });
  await page.click('.tl-play');
  // Keep the screenshot time deterministic without changing the playing state.
  await page.evaluate(() => { window.__app.playback.seek(3); window.__app.playback.update = () => window.__app.playback.playing; });
  await page.mouse.move(300, 40);
  await page.screenshot({ path: `${OUT}/playing-director-tab.png` });
  ok('播放临时机位画面，导演页签保持，洁净渲染且文档不变', await page.evaluate(before => {
    const a = window.__app;
    return !a.cameraView && a.playback.playing && a.preview && a.getRenderCamera() === a.cameras[0].cam &&
      document.querySelector('#viewtabs .on').dataset.v === 'director' && a.cleanRenderDepth === 1 && !a.pathOverlay.visible &&
      !a.rig.controls.enabled && a.cameras.every(c => !c.helper.visible) && JSON.stringify(a.store.document) === before.doc;
  }, snapshot));
  await page.click('.tl-play');
  await page.mouse.move(300, 40);
  await page.screenshot({ path: `${OUT}/paused-director-tab.png` });
  ok('第3秒暂停：恢复原导演位置/中心/缩放、选择、展开/滚动、轨迹和相机模型', await page.evaluate(before => {
    const a = window.__app, p = window.__timelinePanel;
    a.beforeRender();
    const cam = a.cameras[0], at3 = cam.root.position.clone();
    a.timeline.evaluate(3);
    return a.playback.time === 3 && !a.cameraView && !a.preview && !a.stage.activeCamera && a.cleanRenderDepth === 0 &&
      a.rig.controls.enabled && a.pathOverlay.visible && a.pathOverlay.displayState.paths.every(it => it.source.target === a.selectedId && !a
      .pathOverlay.group.children.some(o => o.isSprite)) &&
      a.selectedId === before.selected && JSON.stringify([...p.trackRows.expandedEnts]) === JSON.stringify(before.expanded) &&
      p.scroll.scrollLeft === before.scroll[0] && p.scroll.scrollTop === before.scroll[1] &&
      a.stage.camera.matrixWorld.toArray().every((v, i) => Math.abs(v - before.view[i]) < 1e-8) &&
      a.rig.controls.target.toArray().every((v, i) => v === before.target[i]) && a.stage.camera.zoom === before.zoom &&
      cam.helper.visible && at3.distanceTo(cam.root.position) < 1e-9 && JSON.stringify(a.store.document) === before.doc && a.history.entries
      .length === before.history;
  }, snapshot));
  ok('五次播放/暂停、手动机位开始、自然结束、循环、Esc及编辑暂停统一清理', await page.evaluate(async (before) => {
    const a = window.__app, pb = a.playback;
    delete pb.update;
    let pass = true;
    for (let i = 0; i < 5; i++) {
      pb.play();
      pass &&= !a.cameraView && a.preview && a.cleanRenderDepth === 1;
      pb.pause();
      pass &&= !a.cameraView && !a.preview && a.cleanRenderDepth === 0 && a.rig.controls.enabled;
    }
    a.setCameraView(true);
    pb.play();
    pass &&= a.cameraView && document.querySelector('#viewtabs .on').dataset.v === 'camera';
    pb.pause();
    pass &&= !a.cameraView && document.querySelector('#viewtabs .on').dataset.v === 'director';
    pb.loop = true;
    pb.play();
    pb.seek(a.timeline.duration);
    pb.update();
    pass &&= pb.playing && a.preview && !a.cameraView;
    pb.loop = false;
    pb.seek(a.timeline.duration);
    pb.update();
    pass &&= !pb.playing && !a.preview && pb.time === a.timeline.duration;
    pb.play();
    a.endPreview();
    pass &&= !pb.playing && !a.preview && a.cleanRenderDepth === 0;
    pb.play();
    a.stopPreview();
    pass &&= pb.time === 0 && !a.timeline.active && !a.cameraView && a.cleanRenderDepth === 0;
    pb.seek(3);
    pass &&= !a.preview && !a.cameraView;
    a.stage.camera.updateMatrixWorld(true);
    return pass && a.stage.camera.matrixWorld.toArray().every((v, i) => Math.abs(v - before.view[i]) < 1e-8);
  }, snapshot));
  await page.keyboard.press('Space');
  await page.keyboard.press('Escape');
  ok('真实 Space/Esc 回导演并归零', await page.evaluate(() => !window.__app.cameraView && !window.__app.preview && window.__app.playback.time === 0));
  // Retiming fixture has room for the requested 12-second stretch; dragging never changes scene duration.
  id = await load(4, 14);
  let result = await drag(id, 'end', 6);
  ok('右端6→12：子轨道同步预览、松手一次事务，路径0–10、旋转到12', result.after.range[1] === 12 && result.after.path.duration === 10 && result.after.tracks.find(t => t
    .property === 'rot').keys.at(-1).t === 12 && result.during.last === 12 && result.during.document === result.before.document && result.after
    .history === result.before.history + 1, JSON.stringify({ range: result.after.range, path: [result.after.path.start, result.after.path.duration],
    preview: result.during.last, history: [result.before.history, result.after.history] }));
  ok('撤销重做及保存重新打开保持完整动画', await page.evaluate(async (before) => {
    const a = window.__app, saved = JSON.stringify(a.store.document);
    await a.history.undo();
    const undo = JSON.stringify(a.store.document) === before;
    await a.history.redo();
    const redo = JSON.stringify(a.store.document) === saved;
    const doc = a.exportDocument();
    await a.loadDocument(JSON.parse(JSON.stringify(doc)));
    const reopened = a.exportDocument();
    reopened.meta.updatedAt = doc.meta.updatedAt;
    return undo && redo && JSON.stringify(reopened) === JSON.stringify(doc);
  }, result.before.document));
  id = await load(4, 14);
  result = await drag(id, 'mid', 2);
  ok('整体右移2秒：总条2–8、路径2–7、旋转至8', JSON.stringify(result.after.range) === '[2,8]' && result.after.path.start === 2 && result.after.path.duration === 5 &&
    result.after.tracks.find(t => t.property === 'rot').keys.at(-1).t === 8);
  id = await load(4, 14);
  result = await drag(id, 'start', 3);
  ok('左端0→3固定结束6：路径3–5.5、旋转末帧6', JSON.stringify(result.after.range) === '[3,6]' && result.after.path.start === 3 && result.after.path
    .duration === 2.5 && result.during.last === 6);
  result = await drag(id, 'mid', 2, true);
  ok('Esc取消拖动完整恢复，无新撤销记录', result.before.document === result.after.document && JSON.stringify(result.before.range) === JSON.stringify(result.after
    .range) && result.before.history === result.after.history);
  ok('无路径旋转/缩放总条、删除最晚关键帧、单点/空摘要及删除范围', await page.evaluate(async (id) => {
    const a = window.__app, p = window.__timelinePanel;
    const { objectAnimationRange } = await import('/src/anim/objectAnimation.js');
    a.timeline.removePath(a.timeline.paths.find(path => path.target === id).id);
    const rot = a.timeline.tracks.find(t => t.target === id && t.property === 'rot');
    const scale = a.timeline.addTrack({ target: id, property: 'scale' });
    a.timeline.setKey(scale.id, 8, [1, 1, 1]);
    let pass = objectAnimationRange(a.store.document, id).end === 8 && !!document.querySelector('.tl-bar-object');
    a.timeline.removeKey(scale.id, 8);
    await Promise.resolve();
    pass &&= objectAnimationRange(a.store.document, id).end === 6;
    for (const k of [...rot.keys].slice(1))
      a.timeline.removeKey(rot.id, k.t);
    await Promise.resolve();
    pass &&= !!document.querySelector('.tl-bar-point') && !document.querySelector('.tl-bar-point .tl-bar-end');
    p.removeAllAnimation(id);
    await Promise.resolve();
    pass &&= !document.querySelector(`.tl-head[data-ent="${id}"] .tl-bar-object`) && document.querySelector(`.tl-head[data-ent="${id}"]`).textContent
      .includes('无动画');
    return pass;
  }, id));
  id = await load();
  await page.evaluate(id => {
    const a = window.__app;
    a.timeline.removePath(a.timeline.paths.find(p => p.target === id).id);
    const track = a.timeline.tracks.find(t => t.target === id && t.property === 'rot');
    for (const key of track.keys.slice(1))
      a.timeline.removeKey(track.id, key.t);
  }, id);
  result = await drag(id, 'mid', 2);
  ok('单点摘要可以整体平移，没有时长手柄', JSON.stringify(result.after.range) === '[2,2]' && result.after.tracks.find(t => t.property === 'rot').keys[0].t === 2);
  await load();
}
