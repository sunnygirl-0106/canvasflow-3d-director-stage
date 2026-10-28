import fs from 'node:fs';
import { page, ok } from '../harness.mjs';
import { camAim, settle } from '../helpers.mjs';
export async function run() {
  const ids = await page.evaluate(() => {
    const a = window.__app;
    a.playback.stop();
    const cam = a.cameras[0], actors = a.entities.filter(e => e.type === 'character');
    const document = JSON.stringify(a.store.document);
    a.select(cam.id, { user: true });
    return { cam: cam.id, a: actors[0].id, b: actors[1].id, document };
  });
  await settle();
  ok('默认手动坐标且显示 XYZ，无不持续注视选项，打开属性不改文档', await page.evaluate(ids => {
    const section = document.querySelector('[data-constraint-type="lookAt"]'), select = section.querySelector('select');
    return select.value === '__point' && ![...select.options].some(o => o.value === '') && section.querySelectorAll('.triple input').length === 3 &&
      JSON.stringify(window.__app.store.document) === ids.document;
  }, ids));
  await (await page.$$('#inspector .ptabs button'))[1].click();
  await page.click('[data-preset="circle"]');
  const orbit = await page.evaluate(id => {
    const a = window.__app, cam = a.findCamera(id);
    const target = cam.lookTarget.clone().set(0, 1.2, 0), errors = [];
    for (let frame = 0; frame <= 60; frame++) {
      a.playback.seek(frame / 30);
      cam.cam.updateMatrixWorld(true);
      const projected = target.clone().applyMatrix4(a.stage.world.matrixWorld).project(cam.cam);
      errors.push(Math.hypot(projected.x, projected.y));
    }
    a.playback.stop();
    const looks = a.timeline.constraints.filter(c => c.target === id && c.type === 'lookAt');
    return { maxError: Math.max(...errors), subject: looks[0]?.subject, count: looks.length };
  }, ids.cam);
  ok('默认整圈环绕的 61 帧中，手动坐标 (0, 1.2, 0) 始终位于画面中心', orbit.count === 1 && JSON.stringify(orbit.subject) === '[0,1.2,0]' && orbit.maxError < 1e-5, JSON
    .stringify(orbit));
  await page.evaluate(id => {
    const p = window.__timelinePanel;
    p.setCollapsed(false);
    p.setHeight(330);
    p.trackRows.expandedEnts.add(id);
    p.rebuild();
    window.__app.playback.seek(1);
  }, ids.cam);
  await settle();
  ok('两秒运镜仅显示位置、焦点、视角；焦点和恒定视角均止于 2 秒，不产生额外关键帧', await page.evaluate(id => {
    const a = window.__app, rows = [...document.querySelectorAll(`.tl-track[data-ent="${id}"]`)];
    const spans = rows.flatMap(r => [...r.querySelectorAll('.tl-camera-span')]);
    return rows.map(r => r.querySelector('.tl-label').textContent).join() === '位置,焦点,视角'
      && spans.length === 2 && spans.every(n => +n.style.getPropertyValue('--t0') === 0 && +n.style.getPropertyValue('--t1') === 2)
      && rows[1].querySelector('.tl-value').textContent === '0, 1.2, 0'
      && rows[2].querySelector('.tl-value').textContent === '50'
      && !document.querySelector(`.tl-track[data-ent="${id}"] .tl-bar-constraint`)
      && !a.timeline.tracks.some(t => t.target === id);
  }, ids.cam));
  fs.mkdirSync('test-output/camera-look', { recursive: true });
  await page.$eval(`.tl-track[data-ent="${ids.cam}"][data-property-row="focus"]`, n => n.scrollIntoView({ block: 'nearest' }));
  await (await page.$('#timeline')).screenshot({ path: 'test-output/camera-look/timeline-two-seconds.png' });
  await page.evaluate(() => { window.__app.playback.stop(); window.__timelinePanel.setCollapsed(true); });
  await page.evaluate(async () => { await window.__app.history.undo(); });
  await settle();
  ok('一次撤销同时撤销环绕路径与默认注视', await page.evaluate(ids => JSON.stringify(window.__app.store.document) === ids.document, ids));
  await (await page.$$('#inspector .ptabs button'))[0].click();
  await settle();
  await page.$eval('[data-constraint-type="lookAt"] .triple input', input => {
    input.value = '1.25';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
  });
  await settle();
  ok('默认坐标可直接编辑并创建点注视', await page.evaluate(ids => {
    const list = window.__app.timeline.constraints.filter(c => c.target === ids.cam && c.type === 'lookAt');
    return list.length === 1 && Array.isArray(list[0].subject) && list[0].subject[0] === 1.25;
  }, ids));
  await page.evaluate(async () => { await window.__app.history.undo(); });
  await settle();
  ok('撤销坐标编辑恢复默认手动坐标', await page.evaluate(ids => JSON.stringify(window.__app.store.document) === ids.document && document
    .querySelector('[data-constraint-type="lookAt"] select').value === '__point', ids));
  await page.select('[data-constraint-type="lookAt"] select', ids.a);
  await settle();
  const idleAim = await camAim(ids.cam, ids.a);
  ok('未播放时选择注视目标立即对准角色 A', idleAim.angle < .01, JSON.stringify(idleAim));
  await page.evaluate(ids => {
    const a = window.__app;
    a.timeline.addPath({ target: ids.a, points: [[-.7, 0, 0], [2, 0, 1]], duration: 4 });
    a.playback.seek(2);
  }, ids);
  await settle();
  await page.select('[data-constraint-type="follow"] select', ids.b);
  await settle();
  const followedAim = await camAim(ids.cam, ids.a);
  ok('跟随 B 时仍注视移动中的 A，属性标明朝向由注视控制', followedAim.angle < .01 && await page.evaluate(ids => window.__app.timeline.forcedProps(ids.cam, 2)
    .get('rot') === '注视', ids), JSON.stringify(followedAim));
  await page.select('[data-constraint-type="lookAt"] select', ids.b);
  await settle();
  ok('切换注视目标立即生效', (await camAim(ids.cam, ids.b)).angle < .01);
  await page.evaluate(async () => { window.__app.history.capture(); await window.__app.history.undo(); });
  await settle();
  ok('撤销恢复注视 A', (await camAim(ids.cam, ids.a)).angle < .01);
  await page.evaluate(() => window.__app.playback.stop());
  const applied = await page.evaluate(async () => {
    const a = window.__app;
    return a.ai.applyOps([{ op: 'look_at', target: '机位1', subject: '角色A' }]);
  });
  const aiAim = await camAim(ids.cam, ids.a);
  ok('AI 注视指令在未播放状态立即生效', applied.ok && aiAim.angle < .01, JSON.stringify(aiAim));
  const repaired = await page.evaluate(async (ids) => {
    const a = window.__app;
    await a.loadDocument(JSON.parse(ids.document));
    const cam = a.findCamera(ids.cam), tool = a.cameraMoves;
    tool.applyPreset(cam, 'circle', { params: { sweep: 270, duration: 4 } });
    a.timeline.removeConstraint(a.timeline.constraints.find(c => c.target === cam.id && c.type === 'lookAt').id);
    const old = a.exportDocument();
    await a.loadDocument(old);
    const before = JSON.stringify(a.store.document.paths);
    const result = tool.applyPreset(a.findCamera(ids.cam), 'circle');
    return result && JSON.stringify(a.store.document.paths.map(p => ({ ...p, id: '' }))) === JSON.stringify(JSON.parse(before).map(p => ({ ...p,
      id: '' }))) && a.timeline.constraints.some(c => c.target === ids.cam && c.type === 'lookAt');
  }, ids);
  ok('重新载入缺失注视的旧环绕后，重选相同预设补齐注视并保留原角度和时长', repaired);
  await page.evaluate(async (ids) => {
    const a = window.__app, p = window.__timelinePanel;
    a.playback.stop();
    await a.loadDocument(JSON.parse(ids.document));
    a.playback.seek(3);
    a.cameraMoves.applyPreset(a.findCamera(ids.cam), 'truck');
    a.timeline.addConstraint({ type: 'follow', target: ids.cam, subject: ids.a, offset: [0, 2, 6] });
    p.setCollapsed(false);
    p.trackRows.expandedEnts.add(ids.cam);
    p.rebuild();
  }, ids);
  await settle();
  ok('从 3 秒插入两秒运镜，跟随合并到位置，所有状态线限定在 3–5 秒', await page.evaluate(id => {
    const rows = [...document.querySelectorAll(`.tl-track[data-ent="${id}"]`)];
    const spans = rows.flatMap(r => [...r.querySelectorAll('.tl-camera-span')]);
    return rows.map(r => r.querySelector('.tl-label').textContent).join() === '位置,焦点,视角'
      && spans.length === 3 && spans.every(n => +n.style.getPropertyValue('--t0') === 3 && +n.style.getPropertyValue('--t1') === 5);
  }, ids.cam));
  await page.evaluate(id => {
    const a = window.__app, path = a.timeline.paths.find(p => p.target === id);
    a.timeline.updatePath(path.id, { start: 4, duration: 1 });
  }, ids.cam);
  await settle();
  ok('调整片段范围后状态线同步更新，不修改实际注视生效时间', await page.evaluate(id => {
    const a = window.__app, spans = [...document.querySelectorAll(`.tl-track[data-ent="${id}"] .tl-camera-span`)];
    const look = a.timeline.constraints.find(c => c.target === id && c.type === 'lookAt');
    return spans.every(n => +n.style.getPropertyValue('--t0') === 4 && +n.style.getPropertyValue('--t1') === 5) && look.start === 3 && look.end === null;
  }, ids.cam));
}
