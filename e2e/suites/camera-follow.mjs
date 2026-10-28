import { page, ok } from '../harness.mjs';
import { settle, camAim } from '../helpers.mjs';
export async function run() {
  const ids = await page.evaluate(() => {
    const a = window.__app, cam = a.cameras[0], actors = a.entities.filter(e => e.type === 'character');
    a.store.transact('跟随测试场景', doc => {
      doc.scene.rot = [0, 35, 0];
      doc.scene.scale = 1.4;
      doc.entities.find(e => e.id === actors[1].id).transform.rot = [0, 70, 0];
    });
    a.select(cam.id, { user: true });
    return { cam: cam.id, a: actors[0].id, b: actors[1].id };
  });
  await settle();
  const pose = () => page.evaluate(id => {
    const c = window.__app.findCamera(id);
    return { pos: c.root.position.toArray(), rot: c.root.quaternion.toArray() };
  }, ids.cam);
  const before = await pose();
  await page.select('[data-constraint-type="follow"] select', ids.b);
  await settle();
  const after = await pose();
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-5);
  ok('初次跟随静止角色：有场景旋转/缩放及角色转向时，位置和朝向不跳', near(before.pos, after.pos) && near(before.rot, after.rot), JSON.stringify({ before, after }));
  ok('仅跟随时旋转输入可编辑，注视显示默认手动坐标且不创建注视约束', await page.evaluate(() => {
    const root = document.querySelector('#inspector');
    const rot = [...root.querySelectorAll('.field')].find(f => f.querySelector('label')?.textContent.startsWith('旋转'));
    return !rot.querySelector('input').disabled && root.querySelector('[data-constraint-type="lookAt"] select').value === '__point'
      && !window.__app.timeline.constraints.some(c => c.target === window.__app.selectedId && c.type === 'lookAt');
  }));
  await page.select('[data-constraint-type="lookAt"] select', ids.a);
  await settle();
  ok('跟随 B、注视 A：只改变朝向，不改变位置', near(after.pos, (await pose()).pos) && (await camAim(ids.cam, ids.a)).angle < .01);
  const look = await page.evaluate(() => JSON.stringify(window.__app.timeline.constraints.filter(c => c.type === 'lookAt')));
  const beforeSwitch = await pose();
  await page.select('[data-constraint-type="follow"] select', ids.a);
  await settle();
  ok('切换跟随目标重新计算偏移，机位不跳且不改注视约束', near(beforeSwitch.pos, (await pose()).pos) && await page.evaluate(look => JSON.stringify(window.__app.timeline
    .constraints.filter(c => c.type === 'lookAt')) === look, look));
  await page.evaluate(async () => { const a = window.__app; a.history.capture(); await a.history.undo(); });
  await settle();
  ok('撤销切换恢复跟随 B，独立注视 A 不变', await page.$eval('[data-constraint-type="follow"] select', (s, id) => s.value === id, ids.b) && (await camAim(ids.cam,
    ids.a)).angle < .01);
  await page.evaluate(ids => {
    const a = window.__app;
    a.timeline.addPath({ target: ids.a, points: [[-.7, 0, 0], [3, 0, 2]], duration: 4 });
  }, ids);
  const samples = [];
  for (const t of [0, 1, 2, 4, 8]) {
    await page.evaluate(t => window.__app.playback.seek(t), t);
    samples.push({ ...(await pose()), aim: await camAim(ids.cam, ids.a) });
  }
  ok('跟随静止 B、注视移动 A：相机位置固定，朝向持续跟住 A', samples.every(s => near(s.pos, after.pos) && s.aim.angle < .01) && !near(samples[0].rot, samples[3].rot));
  await page.select('[data-constraint-type="follow"] select', ids.a);
  await page.select('[data-constraint-type="lookAt"] select', ids.b);
  await settle();
  const moving = [];
  for (const t of [0, 1, 2, 4, 8]) {
    await page.evaluate(t => window.__app.playback.seek(t), t);
    moving.push({ ...(await pose()), aim: await camAim(ids.cam, ids.b) });
  }
  ok('跟随移动 A、注视静止 B：相机随 A 移动，始终对准 B', moving.every(s => s.aim.angle < .01) && !near(moving[0].pos, moving[3].pos));
  const snapshot = await page.evaluate(() => window.__app.exportDocument());
  await page.evaluate(async (doc) => { await window.__app.loadDocument(doc); window.__app.playback.seek(2); }, snapshot);
  ok('保存重载后两个目标仍独立生效', (await camAim(ids.cam, ids.b)).angle < .01 && near((await pose()).pos, moving[2].pos));
}
