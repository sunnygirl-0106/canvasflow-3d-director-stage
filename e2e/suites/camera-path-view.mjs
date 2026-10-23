import fs from 'node:fs';
import path from 'node:path';
import { page, ok } from '../harness.mjs';
import { settle, pickInOutliner, toastClick, dragPath, scr } from '../helpers.mjs';

const OUT = 'test-output/camera-path-view';
const modes = [['circle', '圆环路径'], ['line', '直线路径'], ['rectangle', '矩形路径'], ['freehand', '铅笔路径'], ['points', '钢笔路径']];

async function choose(label) {
  if (!await page.$('#inspector [data-sec="path"] .sec-btn')) {
    await (await page.$('#inspector ::-p-text(运动轨迹)')).click();
    await settle();
  }
  await page.click('#inspector [data-sec="path"] .sec-btn');
  const item = await page.$(`::-p-text(${label})`);
  await item.click();
  await settle();
}
async function draw(mode) {
  const points = await Promise.all([[2, 0, 1], [3, 0, 2], [4, 0, 1]].map(scr));
  await page.mouse.move(...points[0]);
  if (mode === 'freehand') await dragPath(points, { steps: 12 });
  else if (mode === 'points') {
    for (const point of points) await page.mouse.click(...point);
    await page.keyboard.press('Enter');
  } else await page.mouse.click(...points[0]);
  await settle();
}
export async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT).filter(f => f.endsWith('.json'))) fs.unlinkSync(path.join(OUT, f));
  const seed = await page.evaluate(() => window.__app.exportDocument());
  const camera = seed.entities.find(e => e.type === 'camera');
  const initialView = await page.evaluate(() => window.__app.stage.camera.matrixWorld.toArray());
  ok('默认导演视角；无保存状态、恢复点入口及后台写入器', await page.evaluate(() =>
    !window.__app.cameraView && !window.__app.autosave && !document.querySelector('#saveStatus, .save-status, .save-panel') && !/已保存于|恢复点/.test(document.body.innerText)));

  for (const [mode, label] of modes) {
    await page.evaluate(async doc => { const a = window.__app; a.stopPreview(); await a.loadDocument(doc, { applyView: true }); }, seed);
    await pickInOutliner(camera.name);
    const before = await page.evaluate(() => JSON.stringify(window.__app.store.document));
    await choose(label);
    await page.mouse.move(...await scr([2, 0, 1]));
    if (mode === 'freehand') { await page.mouse.down(); await page.mouse.move(...await scr([3, 0, 2]), { steps: 5 }); }
    if (mode === 'points') await page.mouse.click(...await scr([2, 0, 1]));
    const drawing = await page.evaluate(() => {
      const a = window.__app, t = a.pathTool;
      return t.mode && t.ent.id === a.selectedId && !t.hintEl.hidden && a.pathOverlay.visible && a.pathOverlay.draftGroup.children.length > 0 && a.rig.controls.mouseButtons.LEFT === -1 && !a.cameraView;
    });
    await page.screenshot({ path: `${OUT}/${mode}-draft.png` });
    await page.keyboard.press('Escape');
    if (mode === 'freehand') await page.mouse.up();
    const cancelled = await page.evaluate(before => {
      const a = window.__app;
      return !a.pathTool.busy && !a.pathTool._stroke && !a.pathTool._orbiting && a.pathTool.hintEl.hidden && a.rig.controls.mouseButtons.LEFT === 0 && JSON.stringify(a.store.document) === before;
    }, before);
    ok(`${label}：默认同高视角可绘制、有草稿反馈，Esc 无文档副作用`, drawing && cancelled);
    await choose(label); await draw(mode);
    let created = await page.evaluate(id => window.__app.timeline.toJSON().paths.find(p => p.target === id), camera.id);
    ok(`${label}：完成后关联当前机位，保持高度和朝向，退出绘制状态`, created?.points.length >= 2 && created.points.every(p => p[1] === camera.transform.pos[1]) && created.orient === 'keep' && await page.evaluate(id => !window.__app.pathTool.busy && window.__app.selectedId === id && !window.__app.cameraView, camera.id), JSON.stringify(created && { points: created.points.length, duration: created.duration }));
    await choose(label); await toastClick('替换'); await page.keyboard.press('Escape');
    ok(`${label}：替换确认后取消仍保留旧路径`, await page.evaluate(p => JSON.stringify(window.__app.timeline.toJSON().paths.find(x => x.target === p.target)) === JSON.stringify(p), created));
    await choose(label); await toastClick('替换'); await draw(mode);
    created = await page.evaluate(id => window.__app.timeline.toJSON().paths.find(p => p.target === id), camera.id);
    ok(`${label}：再次绘制可完成，机位仅保留一条路径`, created?.points.length >= 2 && await page.evaluate(id => window.__app.timeline.paths.filter(p => p.target === id).length === 1 && !window.__app.pathTool.busy, camera.id));
    ok(`${label}：时间轴可驱动机位运动，停止保持导演位置`, await page.evaluate(id => {
      const a = window.__app, c = a.findCamera(id), start = c.root.position.clone(), view = a.stage.camera.matrixWorld.toArray();
      a.playback.seek(5); a.beforeRender();
      const moved = c.root.position.distanceTo(start) > .01;
      a.playback.stop(); a.beforeRender();
      return moved && !a.cameraView && c.root.position.distanceTo(start) < 1e-6 && JSON.stringify(view) === JSON.stringify(a.stage.camera.matrixWorld.toArray());
    }, camera.id));
  }
  ok('选择、创建和再次绘制均未移动导演观察位置', await page.evaluate(before => JSON.stringify(window.__app.stage.camera.matrixWorld.toArray()) === JSON.stringify(before), initialView));

  // 手动环绕后点击播放：保留导演观察视角，机位独立沿路径运动。
  await page.evaluate(() => window.__timelinePanel.setCollapsed(false));
  const camerasBeforeOrbit = await page.evaluate(() => JSON.stringify(window.__app.cameras.map(c => c.toJSON())));
  const orbit = await page.evaluate(() => {
    const r = window.__app.stage.renderer.domElement.getBoundingClientRect();
    return [r.left + r.width * .25, r.top + r.height * .25];
  });
  await page.mouse.move(...orbit); await page.mouse.down();
  await page.mouse.move(orbit[0] + 100, orbit[1] + 30, { steps: 12 }); await page.mouse.up(); await settle(1000);
  const beforePlay = await page.evaluate(() => {
    const a = window.__app;
    // 消耗手势剩余阻尼，避免把惯性尾帧误判为播放改变观察位置。
    const damping = a.rig.controls.enableDamping;
    a.rig.controls.enableDamping = false; a.rig.controls.update();
    a.rig.controls.enableDamping = damping; a.beforeRender(); a.stage.camera.updateMatrixWorld(true);
    return { view: a.stage.camera.matrixWorld.toArray(), pos: a.cameras[0].root.position.toArray(), selected: a.selectedId };
  });
  ok('手动环绕已改变观察视角', JSON.stringify(beforePlay.view) !== JSON.stringify(initialView));
  ok('手动环绕不改写机位位置、朝向或镜头参数', await page.evaluate(before => JSON.stringify(window.__app.cameras.map(c => c.toJSON())) === before, camerasBeforeOrbit));
  await page.click('.tl-play'); await settle(450);
  ok('导演视角播放中：可观察机位，隐藏运动轨迹，仍可操作观察视角', await page.evaluate(() => {
    const a = window.__app;
    return !a.cameraView && a.playback.playing && !a.stage.activeCamera && !a.pathOverlay.visible && a.rig.controls.enabled && a.cameras.every(c => c.helper.visible);
  }));
  await page.click('.tl-play');
  ok('手动观察后播放/暂停：导演位置不跟随机位，暂停恢复所选对象轨迹', await page.evaluate(before => {
    const a = window.__app;
    return !a.cameraView && !a.playback.playing && a.playback.time > 0 && !a.stage.activeCamera && a.pathOverlay.visible && a._cleanDepth === 0 && a.selectedId === before.selected && a.stage.camera.matrixWorld.toArray().every((v, i) => Math.abs(v - before.view[i]) < 1e-8) && a.cameras[0].root.position.distanceTo(a.stage.camera.position.clone().fromArray(before.pos)) > .01;
  }, beforePlay));
  await page.keyboard.press('Escape'); await page.keyboard.press('Space'); await settle(100); await page.keyboard.press('Space');
  ok('导演视角停止/Space重播保持用户观察位置', await page.evaluate(before => !window.__app.cameraView && window.__app.stage.camera.matrixWorld.toArray().every((v, i) => Math.abs(v - before.view[i]) < 1e-8), beforePlay));
  await page.keyboard.press('Escape');

  const second = await page.evaluate(() => { const a = window.__app, c = a.addCamera('front_mid'); a.timeline.setMainCamera(c.id); return { id: c.id, name: c.name }; });
  await pickInOutliner(camera.name);
  await page.click('#viewtabs [data-v="camera"]');
  await page.click('.tl-play'); await settle(120); await page.click('.tl-play');
  await pickInOutliner(second.name);
  ok('手动机位视角播放/暂停及选择其他机位：保持原机位，不被主机位接管', await page.evaluate(id => window.__app.cameraView && window.__app.povCameraId === id, camera.id));
  await page.keyboard.press('Escape');
  ok('机位视角停止仍保留用户选择', await page.evaluate(id => window.__app.cameraView && window.__app.povCameraId === id && window.__app.playback.time === 0, camera.id));
  await page.keyboard.press('Space'); await settle(100);
  await page.click('#viewtabs [data-v="director"]');
  ok('播放中手动切回导演视角，播放继续且选择被保留', await page.evaluate(() => !window.__app.cameraView && window.__app.playback.playing && !window.__app.preview && window.__app._cleanDepth === 0));
  await page.keyboard.press('Escape'); await page.keyboard.press('Space'); await settle(100); await page.keyboard.press('Escape');
  ok('切回导演视角后停止/重播不再自动进入机位视角', await page.evaluate(() => !window.__app.cameraView));

  await page.evaluate(() => window.__timelinePanel.setCollapsed(true));
  // 在用户主动选定的机位视角绘制，既保留视角，也显示投影草稿。
  await pickInOutliner(camera.name); await page.click('#viewtabs [data-v="camera"]');
  await choose('钢笔路径'); await toastClick('替换');
  await page.mouse.click(...await scr([2, 0, 1]));
  ok('机位视角创建轨迹不切导演视角，草稿可见', await page.evaluate(() => window.__app.cameraView && window.__app.pathOverlay.visible && window.__app.pathTool.draft.length === 2));
  await page.mouse.click(...await scr([3, 0, 2]));
  await page.mouse.click(...await scr([3, 0, 2]), { count: 2 });
  ok('钢笔双击完成恢复交互状态和机位视角', await page.evaluate(() => !window.__app.pathTool.busy && window.__app.cameraView && !window.__app.pathOverlay.visible));
  await page.click('#viewtabs [data-v="director"]');

  // 真实场景菜单下载文件 → 刷新 → 文件选择器重新导入。
  const client = await page.createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: path.resolve(OUT) });
  const saved = await page.evaluate(() => window.__app.exportDocument());
  await page.click('#sceneActions button'); await (await page.$('::-p-text(导出场景)')).click();
  let file;
  for (let n = 0; n < 30 && !file; n++) { await settle(50); file = fs.readdirSync(OUT).find(f => f.endsWith('.json')); }
  if (!file) throw new Error('场景文件未下载');
  const exported = JSON.parse(fs.readFileSync(path.join(OUT, file), 'utf8'));
  await page.reload({ waitUntil: 'networkidle0' }); await page.waitForFunction(() => window.__app?.ready);
  await page.click('#sceneActions button');
  const [chooser] = await Promise.all([page.waitForFileChooser(), (await page.$('::-p-text(导入场景)')).click()]);
  await chooser.accept([path.resolve(OUT, file)]);
  await page.waitForFunction(id => window.__app?.timeline.paths.some(p => p.target === id), {}, camera.id);
  const reopened = await page.evaluate(() => window.__app.exportDocument());
  ok('场景文件导出并重新打开：实体、路径、时间轴完整保留', ['entities', 'paths', 'timeline', 'constraints', 'scene'].every(k => JSON.stringify(saved[k]) === JSON.stringify(exported[k]) && JSON.stringify(exported[k]) === JSON.stringify(reopened[k])));
  await page.screenshot({ path: `${OUT}/reopened.png` });
  await client.detach();
}
