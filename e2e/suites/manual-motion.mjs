import fs from 'node:fs';
import { page, ok } from '../harness.mjs';
import { settle, pickInOutliner, buildAnimScene } from '../helpers.mjs';
export async function run() {
  fs.mkdirSync('test-output/manual-motion', { recursive: true });
  const ids = await buildAnimScene();
  await page.evaluate(ids => {
    const a = window.__app;
    a.directorDetached = true;
    a.timeline.setMainCamera(ids.c1);
    a.store.transact('fixture paths', doc => {
      for (const [target, points] of [[ids.m, [[-1.2, 0, 0], [1, 0, 0]]], [ids.p, [[0, 0, -1.4], [2, 0, -1.4]]]])
        doc.paths.push({ id: 'path' + target, target, points, start: 0, duration: 5, closed: false, speed: 'linear', orient: 'keep' });
    });
    a.select(null, { user: true });
  }, ids);
  const names = await page.evaluate(ids => Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, window.__app.findEntity(id).name])), ids);
  await pickInOutliner(names.m);
  ok('主动选择角色仅显示该角色；选中对象不铺控制点', await page.evaluate(id => {
    const a = window.__app;
    return a.pathOverlay.displayState.paths.length === 1 && a.pathOverlay.displayState.paths[0].source.target === id && !a.pathOverlay.displayState
      .paths[0].nodes.length;
  }, ids.m));
  await pickInOutliner(names.f);
  ok('没有轨迹的角色不回退到机位', await page.evaluate(() => window.__app.pathOverlay.itemCount === 0));
  await pickInOutliner(names.c1);
  const before = await page.evaluate(() => JSON.stringify(window.__app.store.document));
  ok('选中摄像机默认属性页', !!await page.$('#inspector .cam-preview'));
  const overlayObjects = await page.evaluate(() => window.__app.pathOverlay.group.children.map(o => o.uuid));
  const tabs = await page.$$('#inspector .ptabs button');
  await tabs[1].click();
  await settle();
  ok('打开运镜页不写文档、不产生额外预览对象；八张运镜卡片', await page.evaluate(({ before, overlayObjects }) => JSON.stringify(window.__app.store.document) === before && JSON
    .stringify(window.__app.pathOverlay.group.children.map(o => o.uuid)) === JSON.stringify(overlayObjects) && document
    .querySelectorAll('.move-cards .move-card').length === 8, { before, overlayObjects }));
  ok('摄像机运动页不显示轨迹编辑区域', !await page.$('#inspector .motion-advanced, #inspector [data-sec="path"]'));
  const view = await page.evaluate(() => ({ pos: window.__app.stage.camera.position.toArray(), target: window.__app.rig.controls.target.toArray() }));
  await page.click('[data-preset="half_orbit"]');
  await settle();
  const applied = await page.evaluate(id => {
    const a = window.__app, state = a.cameraMoves.current(a.findCamera(id));
    return { state, count: a.pathOverlay.itemCount, pos: a.stage.camera.position.toArray(), target: a.rig.controls.target.toArray(), history: a
        .history.index, doc: JSON.stringify(a.store.document) };
  }, ids.c1);
  ok('半弧点击即应用 2 秒，身份持久化、导演观察位置不变', applied.state?.segments[0].params.duration === 2 && applied.count === 1 && JSON.stringify(applied.pos) === JSON
    .stringify(view.pos) && JSON.stringify(applied.target) === JSON.stringify(view.target));
  ok('场景中有角色时预设仍默认使用手动注视坐标', await page.evaluate(({ id, applied }) => {
    const subject = applied.state.segments[0].subject;
    return Array.isArray(subject) && JSON.stringify(subject) === JSON.stringify(window.__app.findCamera(id).lookTarget.toArray()) && !document
      .querySelector('#inspector [data-sec="path"]');
  }, { id: ids.c1, applied }));
  await page.click('[data-preset="half_orbit"]');
  await settle();
  ok('普通模式重复点击单段不新增历史、不改变文档或时长', await page.evaluate(applied => JSON.stringify(window.__app.store.document) === applied.doc && window.__app.history
    .index === applied.history, applied));
  await page.click('.move-append');
  await settle();
  await page.screenshot({ path: 'test-output/manual-motion/append.png' });
  await page.click('[data-preset="half_orbit"]');
  await settle();
  ok('显式追加继承参数并延长时间，完成后退出追加', await page.evaluate(({ applied, id }) => {
    const a = window.__app, state = a.cameraMoves.current(a.findCamera(id));
    return state.segments.length === 2 && JSON.stringify(state.segments[1].params) === JSON.stringify(state.segments[0].params) && state.segments[1]
      .origin.time === 2 && a.timeline.duration >= 4 && a.history.index === applied.history + 1 && !document.querySelector('.move-cancel');
  }, { applied, id: ids.c1 }));
  await page.evaluate(async () => { await window.__app.history.undo(); });
  await settle();
  await page.screenshot({ path: 'test-output/manual-motion/cards.png' });
  await page.evaluate(() => {
    const field = [...document.querySelectorAll('.camera-moves .field')].find(n => n
      .querySelector('label')?.textContent === '角度');
    const input = field.querySelector('input');
    input.value = '90';
    input
      .dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
  ok('改参数保持原始起点；替换没有追加旧线路', await page.evaluate(({ ids, applied }) => {
    const a = window.__app, p = a.timeline.paths.find(p => p.target === ids.c1);
    return p.duration === 2 && JSON.stringify(p.points[0]) === JSON.stringify(applied.state.segments[0].origin.position) && a.cameraMoves.current(a
      .findCamera(ids.c1)).segments[0].params.sweep === 90;
  }, { ids, applied }));
  const valid = await page.evaluate(() => JSON.stringify(window.__app.store.document));
  await page.evaluate(() => {
    const field = [...document.querySelectorAll('.camera-moves .field')].find(n => n
      .querySelector('label')?.textContent === '角度');
    const input = field.querySelector('input');
    input.value = '200';
    input
      .dispatchEvent(new Event('change', { bubbles: true }));
  });
  ok('无效角度保留有效结果，并显示字段错误', await page.evaluate(valid => JSON.stringify(window.__app.store.document) === valid && !document
    .querySelector('.move-error').hidden, valid));
  await page.click('[data-preset="spiral"]');
  await settle();
  ok('普通模式替换为螺旋，真实升高且仅保留新段', await page.evaluate(id => {
    const a = window.__app, p = a.timeline.paths.find(p => p.target === id);
    return p.points
      .at(-1)[1] > p.points[0][1] && a.cameraMoves.current(a.findCamera(id)).segments.length === 1;
  }, ids.c1));
  await page.evaluate(async () => { await window.__app.history.undo(); });
  await settle();
  ok('一次撤销完整恢复原预设和参数', await page.evaluate(id => window.__app.cameraMoves.current(window.__app.findCamera(id))?.segments[0].params.sweep === 90, ids.c1));
  await page.click('.move-append');
  await settle();
  await page.click('[data-preset="crane"]');
  await settle();
  ok('显式追加异类预设保留前缀', await page.evaluate(id => {
    const a = window.__app;
    return a.cameraMoves.current(a.findCamera(id))?.segments.length === 2 && a
      .timeline.paths.find(p => p.target === id).duration === 4;
  }, ids.c1));
  const saved = await page.evaluate(() => window.__app.exportDocument());
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__app?.ready);
  await page.evaluate(async (saved) => { const a = window.__app; await a.loadDocument(saved, { applyView: true }); }, saved);
  ok('刷新并重新载入还原运镜身份及参数；默认机位轨迹', await page.evaluate(id => {
    const a = window.__app;
    return a.cameraMoves.current(a.findCamera(id))?.segments
      .length === 2 && a.pathOverlay.displayState.paths[0]?.source.target === id && !a.userSelectedId;
  }, ids.c1));
  await pickInOutliner(names.m);
  await page.evaluate(() => { const a = window.__app; a.pathOverlay.setSelectedPath(a.timeline.paths.find(p => p.target === a.selectedId).id); });
  await settle();
  ok('编辑状态仅有扁平节点；点击热区与真实坐标', await page.evaluate(() => {
    const a = window.__app, it = a.pathOverlay.displayState.paths[0];
    return it.nodes.length === it.source.points.length && it.nodes.every((m, i) => m.geometry === 'PlaneGeometry' && m.position.every((v, j) =>
      v === it.source.points[i][j]));
  }));
  await page.screenshot({ path: 'test-output/manual-motion/nodes.png' });
  await page.keyboard.press('Escape');
  await settle();
  ok('Esc 退出保留角色轨迹，隐藏节点', await page.evaluate(() => !window.__app.pathOverlay.selectedPathId && window.__app.pathOverlay.displayState.paths
    .length === 1 && !window.__app.pathOverlay.displayState.paths[0].nodes.length));
  await pickInOutliner(names.p);
  ok('选道具恢复默认机位轨迹', await page.evaluate(id => window.__app.pathOverlay.displayState.paths[0]?.source.target === id, ids.c1));
  await page.evaluate(id => { const a = window.__app; a.pathOverlay.setSelectedPath(a.timeline.paths.find(p => p.target === id).id); }, ids.p);
  ok('明确编辑道具临时显示道具轨迹', await page.evaluate(id => window.__app.pathOverlay.displayState.paths[0]?.source.target === id, ids.p));
  await page.keyboard.press('Escape');
  ok('退出道具轨迹编辑恢复机位', await page.evaluate(id => window.__app.pathOverlay.displayState.paths[0]?.source.target === id, ids.c1));
  await page.evaluate(() => window.__app.setCameraView(true));
  ok('机位视角隐藏全部轨迹且不能拾取', await page.evaluate(() => {
    const a = window.__app;
    return !a.pathOverlay.visible && !a.pathOverlay.hitTest(500, 400) && a
      .pathOverlay.nameHint.hidden;
  }));
  await page.evaluate(() => window.__app.setCameraView(false));
  await page.setViewport({ width: 1440, height: 810, deviceScaleFactor: 2 });
  await settle();
  ok('高分屏线宽仍使用 CSS 分辨率', await page.evaluate(() => {
    const a = window.__app, it = a.pathOverlay.displayState.paths[0], rect = a.stage.renderer
      .domElement.getBoundingClientRect();
    return Math.abs(it.resolution[0] - rect.width) < 1;
  }));
  const rules = await page.evaluate(async (ids) => {
    const a = window.__app;
    a.setCameraView(false);
    a.select(null, { user: true });
    a.timeline.setMainCamera(ids.c2);
    const emptyMain = a.pathOverlay.itemCount === 0;
    a.timeline.setMainCamera(ids.c1);
    a.select(ids.m);
    const internal = a.pathOverlay.displayState.paths[0]?.source.target === ids.c1;
    a.select(ids.m, { user: true });
    const modified = a.exportDocument();
    modified.entities.find(e => e.id === ids.m).name = '保留聚焦';
    await a.loadDocument(modified, { applyView: false });
    const retained = a.pathOverlay.displayState.paths[0]?.source.target === ids.m;
    await a.loadDocument(modified, { newScene: true });
    const reset = a.pathOverlay.displayState.paths[0]?.source.target === ids.c1 && !a.userSelectedId && !a.pathOverlay.selectedPathId;
    return { emptyMain, internal, retained, reset };
  }, ids);
  ok('无轨迹主机位不回退；内部选角色不聚焦；普通修改保留选择；新场景清空聚焦', Object.values(rules).every(Boolean), JSON.stringify(rules));
  const pan = await page.evaluate(ids => {
    const a = window.__app, cam = a.findCamera(ids.c1), tool = a.cameraMoves;
    a.select(cam.id, { user: true });
    const beforeFov = cam.fov;
    tool.clear(cam);
    a.playback.stop();
    const first = tool.applyPreset(cam, 'pan');
    const noLine = a.pathOverlay.itemCount === 0;
    const panEnd = tool.current(cam).segments[0].params.duration;
    const appended = tool.applyPreset(cam, 'crane', { mode: 'append' });
    const correctStart = a.timeline.paths.find(p => p.target === cam.id)?.start === panEnd;
    return first && noLine && appended && correctStart && cam.fov === beforeFov;
  }, ids);
  ok('摇镜头不伪造位移路径；显式追加从摇镜头结束时刻开始，FOV 保留', pan);
  await page.evaluate(id => {
    const a = window.__app;
    a.cameraMoves.clear(a.findCamera(id));
    a.playback.seek(6.25);
    a.history.reset();
  }, ids.c2);
  await pickInOutliner(names.c2);
  await page.evaluate(() => document.querySelectorAll('#inspector .ptabs button')[1].click());
  await settle();
  await page.click('[data-preset="crane"]');
  await settle();
  ok('在 6.25 秒点击预设，从播放头插入且播放头不跳回开头', await page.evaluate(id => {
    const a = window.__app, p = a.timeline.paths.find(p => p.target === id);
    return p?.start === 6.25 && p.duration === 2 && a.playback.time === 6.25
      && a.cameraMoves.current(a.findCamera(id)).segments[0].origin.time === 6.25;
  }, ids.c2));
  await page.evaluate(async () => { await window.__app.history.undo(); });
  await settle();
  ok('播放头插入可一步撤销', await page.evaluate(id => !window.__app.timeline.paths.some(p => p.target === id), ids.c2));
  await page.evaluate(async () => { await window.__app.history.redo(); });
  await settle();
  ok('重做恢复插入时间', await page.evaluate(id => window.__app.timeline.paths.find(p => p.target === id)?.start === 6.25, ids.c2));
  await page.evaluate(() => window.__app.playback.seek(7));
  await page.evaluate(() => {
    const field = [...document.querySelectorAll('.camera-moves .field')].find(n => n.querySelector('label')?.textContent === '时长');
    const input = field.querySelector('input');
    input.value = '3';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
  ok('移动播放头后调参仍保留已插入的起点', await page.evaluate(id => {
    const p = window.__app.timeline.paths.find(p => p.target === id);
    return p.start === 6.25 && p.duration === 3;
  }, ids.c2));
  await page.click('.move-append');
  await settle();
  await page.click('[data-preset="truck"]');
  await settle();
  ok('显式追加仍接在已有运镜末尾', await page.evaluate(id => {
    const a = window.__app, state = a.cameraMoves.current(a.findCamera(id));
    return state.segments[1].origin.time === 9.25 && a.timeline.duration >= 11.25;
  }, ids.c2));
  await page.evaluate(id => {
    const a = window.__app;
    a.cameraMoves.clear(a.findCamera(id));
    a.playback.seek(a.timeline.duration);
    window.panInsertTime = a.playback.time;
  }, ids.c2);
  await settle();
  await page.click('[data-preset="pan"]');
  await settle();
  ok('摇镜头也从播放头插入，超出末尾自动延长时间轴', await page.evaluate(id => {
    const a = window.__app, keys = a.timeline.tracks.find(t => t.target === id && t.property === 'rot').keys;
    return keys[0].t === window.panInsertTime && keys.at(-1).t === window.panInsertTime + 2
      && a.timeline.duration >= keys.at(-1).t;
  }, ids.c2));
}
