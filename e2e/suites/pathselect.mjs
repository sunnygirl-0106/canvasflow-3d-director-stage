import fs from 'node:fs';
import { page, ok } from '../harness.mjs';
import { settle, scr, dragPath } from '../helpers.mjs';

export async function run() {
  const out = 'test-output/pathselect';
  fs.mkdirSync(out, { recursive: true });
  const ids = await page.evaluate(async () => {
    const a = window.__app;
    const { createEmptyDocument } = await import('/src/doc/schema.js');
    await a.loadDocument(createEmptyDocument());
    const actor = await a.addCharacter('male');
    const other = await a.addCharacter('female');
    other.root.position.x = -2; a.edited(other);
    const p = a.timeline.addPath({ target: actor.id, points: [[0, 0, 0], [2, 0, -1], [3, 0, -4]], start: 0, duration: 5, speed: 'linear', orient: 'tangent' });
    a.addCamera('front_mid');
    a.select(actor.id);
    a.rig.controls.target.set(1, 0, -1.5);
    a.stage.camera.position.set(5, 7, 9); a.rig.controls.update();
    a.history.reset();
    return { actor: actor.id, other: other.id, path: p.id };
  });
  const state = () => page.evaluate(ids => {
    const a = window.__app, ov = a.pathOverlay;
    return {
      selected: ov.selectedPathId, vertex: ov.selVertex,
      points: a.timeline.toJSON().paths.find(p => p.id === ids.path)?.points,
      paths: a.timeline.toJSON().paths.length, actor: !!a.findEntity(ids.actor),
      handles: ov._items.reduce((n, it) => n + it.vertices.length, 0),
      gizmo: a.gizmo.visible, bar: !a.pathEditor.bar.hidden,
    };
  }, ids);
  const linePoint = () => page.evaluate(id => {
    const p = window.__app.pathOverlay.pathOf(id); return p.positionAt(p.length * .65).toArray();
  }, ids.path);
  await settle();
  let s = await state();
  ok('选人物只显示轨迹线，没有箭头 / 控制点 / 编辑栏', !s.selected && s.handles === 0 && s.gizmo && !s.bar);
  await page.screenshot({ path: `${out}/01-entity.png` });
  const point = await linePoint();
  await page.mouse.click(...await scr(point)); await settle();
  s = await state();
  ok('单击轨迹选中整条，显示控制点和编辑栏，隐藏人物变换手柄，不增加点', s.selected === ids.path && s.handles === 3 && s.points.length === 3 && s.bar && !s.gizmo);
  await page.screenshot({ path: `${out}/02-path.png` });
  await page.mouse.click(...await scr(point)); await settle();
  ok('重复单击轨迹仍不增加控制点', (await state()).points.length === 3);
  await page.mouse.click(...await scr(point), { count: 2 }); await settle();
  s = await state();
  ok('双击轨迹才添加点，新增点被选中', s.points.length === 4 && !!s.vertex, JSON.stringify(s));
  if (s.points.length !== 4 || !s.vertex) return;
  await page.keyboard.press('Delete'); await settle();
  s = await state();
  ok('Delete 可删除选中的点，保留轨迹和人物', s.points.length === 3 && s.actor && s.selected === ids.path);
  const original = s.points;
  await dragPath([await scr(original[1]), await scr([original[1][0] + .5, 0, original[1][2]])]);
  s = await state();
  ok('选中的轨迹仍可拖点调整', Math.abs(s.points[1][0] - original[1][0] - .5) < .03);
  // Backspace 始终删除整条轨迹，即使最后点中了顶点。
  await page.keyboard.down('Backspace'); await page.keyboard.down('Backspace'); await settle();
  s = await state();
  ok('Backspace 删除整条轨迹，长按不会继续误删人物，编辑状态清除', !s.paths && s.actor && !s.selected && !s.bar && s.gizmo);
  await page.keyboard.up('Backspace');
  await page.evaluate(async () => { await window.__app.history.undo(); }); await settle();
  s = await state();
  ok('一次撤销恢复整条轨迹及全部控制点，返回干净的线条状态', s.paths === 1 && s.points.length === 3 && s.actor && !s.selected && !s.handles);
  await page.mouse.click(...await scr(await linePoint())); await settle();
  await page.evaluate(() => { const input = document.createElement('input'); input.id = 'path-input-test'; input.value = 'abc'; document.body.append(input); input.focus(); input.setSelectionRange(3, 3); });
  await page.keyboard.press('Backspace');
  ok('输入框内 Backspace 编辑文字，不删轨迹', (await state()).paths === 1 && await page.$eval('#path-input-test', e => e.value === 'ab'));
  await page.evaluate(() => document.querySelector('#path-input-test').remove());
  await page.keyboard.press('Escape'); await settle();
  s = await state();
  ok('Esc 退出轨迹编辑，保留人物和轨迹线', !s.selected && !s.handles && !s.bar && s.gizmo && s.paths === 1);
  await page.mouse.click(...await scr(await linePoint())); await settle();
  await page.click('.path-edit-done'); await settle();
  ok('完成按钮退出编辑', !(await state()).selected);
  await page.mouse.click(...await scr(await linePoint())); await settle();
  await page.evaluate(id => window.__app.select(id), ids.other); await settle();
  ok('切换人物清除原轨迹编辑状态', !(await state()).selected && !(await state()).handles);
  await page.evaluate(id => window.__app.select(id), ids.actor); await settle();
  await page.mouse.click(...await scr(await linePoint())); await settle();
  await page.evaluate(() => window.__app.setCameraView(true)); await settle();
  ok('机位视角隐藏编辑栏', !(await state()).bar);
  await page.evaluate(() => window.__app.setCameraView(false)); await settle();
  await page.evaluate(id => window.__app.select(id), ids.actor); await settle();
  await page.mouse.click(...await scr(await linePoint())); await settle();
  await page.click('.path-edit-delete'); await settle();
  s = await state();
  ok('编辑栏删除按钮也只删除轨迹', !s.paths && s.actor);
  await page.evaluate(async () => { await window.__app.history.undo(); }); await settle();
  await page.mouse.click(...await scr(await linePoint())); await settle();
  await page.evaluate(() => window.__timelinePanel.setCollapsed(false)); await settle();
  await page.click('#timeline .tl-head'); await settle();
  ok('点击时间轴只交还键盘焦点，保留轨迹编辑状态', (await state()).selected === ids.path);
}
