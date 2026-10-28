import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { page, ok, errs } from '../harness.mjs';
import { gizmoDrag, scr, settle, mp4Info } from '../helpers.mjs';

const out = path.resolve('test-output/smoke');
const readDocument = () => page.evaluate(() => window.__app.exportDocument());
const content = doc => ['entities', 'paths', 'timeline', 'constraints', 'scene'].map(key => doc[key]);
async function clickText(text) {
  const button = await page.$(`::-p-text(${text})`);
  assert.ok(button, `找不到控件：${text}`);
  await button.click();
  await settle();
}
async function shortcut(key, shift = false) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.down('Meta');
  if (shift) await page.keyboard.down('Shift');
  await page.keyboard.press(key);
  if (shift) await page.keyboard.up('Shift');
  await page.keyboard.up('Meta');
  await settle();
}
async function download(extension) {
  for (let i = 0; i < 100; i++) {
    const name = fs.readdirSync(out).find(name => name.endsWith(extension));
    if (name) return path.join(out, name);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`未生成 ${extension} 文件`);
}

export async function run() {
  fs.mkdirSync(out, { recursive: true });
  // 只清理本套件上轮下载；不使用旧文件作为通过证据。
  for (const name of fs.readdirSync(out)) if (/\.(png|mp4|json)$/.test(name)) fs.unlinkSync(path.join(out, name));
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: out });
  const initial = await readDocument();
  assert.equal(initial.entities.length, 3);
  assert.deepEqual(errs, []);
  ok('1 启动并加载默认场景', true);

  await page.click('[aria-label="添加角色 / 模型"]');
  await page.click('[data-body="male"]');
  await page.waitForFunction(() => window.__app.entities.length === 4);
  const actor = await page.evaluate(() => ({ id: window.__app.selectedId, pos: window.__app.selected.toJSON().transform.pos }));
  await settle();
  await gizmoDrag('x', .8);
  const moved = await readDocument();
  const position = doc => doc.entities.find(e => e.id === actor.id).transform.pos;
  assert.ok(Math.abs(position(moved)[0] - actor.pos[0]) > .1, '真实 gizmo 拖动提交位置');
  await shortcut('z');
  assert.deepEqual(position(await readDocument()), actor.pos);
  await shortcut('z', true);
  assert.deepEqual(position(await readDocument()), position(moved));
  ok('2 添加角色、拖动 gizmo、撤销重做', true);

  await clickText('运动轨迹');
  await page.click('#inspector [data-sec="path"] .sec-btn');
  await clickText('直线路径');
  const start = position(moved);
  await page.mouse.click(...await scr([start[0] + 1.5, 0, start[2]]));
  await page.waitForFunction(id => window.__app.timeline.paths.some(p => p.target === id), {}, actor.id);
  const drawn = await readDocument();
  assert.equal(drawn.paths.find(p => p.target === actor.id).points.length, 2);
  await page.evaluate(() => document.activeElement?.blur());
  await page.click('[aria-label^="时间轴（展开"]');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__app.playback.playing && window.__app.playback.time > .2);
  await page.click('.tl-more summary');
  await page.click('[aria-label="停止并回到手动值（Esc）"]');
  await page.waitForFunction(() => !window.__app.playback.playing && window.__app.playback.time === 0);
  assert.deepEqual(position(await readDocument()), start);
  assert.deepEqual(await page.evaluate(id => window.__app.findEntity(id).toJSON().transform.pos, actor.id), start);
  await page.click('.tl-more summary');
  ok('3 绘制角色路径、播放、停止恢复手动值', true);

  await page.click('[aria-label="添加机位（预设）"]');
  await page.click('.sidebar-card[data-preset="front_mid"]');
  await page.waitForFunction(() => window.__app.selected?.type === 'camera');
  const camera = await page.evaluate(() => window.__app.selectedId);
  await clickText('运动轨迹');
  await page.click('.move-card[data-preset="half_orbit"]');
  await page.waitForFunction(id => window.__app.timeline.paths.some(p => p.target === id), {}, camera);
  await page.click('#viewtabs [data-v="camera"]');
  await page.waitForFunction(() => window.__app.cameraView);
  ok('4 添加机位、应用运镜预设、切到机位视角', true);

  await page.click('[aria-label="截图"]');
  await page.waitForFunction(() => window.__app.shots.list.length > 0);
  await clickText('截图');
  await page.hover('.shot-card');
  await page.click('.shot-op[title="全屏扩大"]');
  await page.click('.modal-dl');
  const png = fs.readFileSync(await download('.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  await page.click('.modal-close');
  await page.click('#sceneActions button');
  await clickText('导出视频');
  await page.select('[data-name="res"]', '720');
  await page.select('[data-name="fps"]', '24');
  await page.select('[data-name="range"]', 'custom');
  await page.focus('[data-name="t1"]');
  await page.keyboard.down('Meta');
  await page.keyboard.press('a');
  await page.keyboard.up('Meta');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('0.5');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => !document.querySelector('.ex-start').disabled);
  await page.click('.ex-start');
  await page.waitForFunction(() => window.__exportModal.lastResult?.frames === 12, { timeout: 60000 });
  const mp4 = fs.readFileSync(await download('.mp4'));
  assert.equal(mp4.subarray(4, 8).toString(), 'ftyp');
  assert.equal(mp4Info(mp4).frames, 12);
  ok('5 PNG 和 MP4 下载成功，半秒 24fps 导出 12 帧', true);

  await page.click('#viewtabs [data-v="director"]');
  const beforeAI = await readDocument();
  await page.evaluate(async () => {
    const { MockProvider } = await import('/src/ai/provider.js');
    window.__app.ai.setProvider(new MockProvider([{ match: '冒烟场景', reply: { ops: [
      { op: 'clear' }, { op: 'add_character', name: '冒烟角色', body: 'female', pos: [0, 0, 0], pose: 'wave' },
      { op: 'add_camera', name: '冒烟机位', pos: [0, 1.4, 4], lookAt: [0, 1, 0] },
    ] } }]));
  });
  await page.click('.ai-plus');
  await page.click('.ai-mode[data-mode="generate"]');
  await page.type('.ai-text', '生成冒烟场景');
  await page.keyboard.press('Enter');
  await settle();
  if (await page.$('#toast.show .toast-action')) await clickText('清空并生成');
  await page.waitForFunction(() => !window.__app.ai.busy && window.__app.entities.some(e => e.name === '冒烟角色'));
  await shortcut('z');
  await page.waitForFunction(id => window.__app.entities.some(e => e.id === id), {}, actor.id);
  assert.deepEqual(content(await readDocument()), content(beforeAI));
  ok('6 MockProvider 一句话生成场景、一步撤销', true);

  const saved = await readDocument();
  await page.click('#sceneActions button');
  await clickText('导出场景');
  const file = await download('.json');
  assert.deepEqual(content(JSON.parse(fs.readFileSync(file, 'utf8'))), content(saved));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__app?.ready);
  await page.click('#sceneActions button');
  const [chooser] = await Promise.all([page.waitForFileChooser(), clickText('导入场景')]);
  await chooser.accept([file]);
  await page.waitForFunction(id => window.__app.entities.some(e => e.id === id), {}, actor.id);
  assert.deepEqual(content(await readDocument()), content(saved));
  ok('7 导出场景 JSON、重新导入后文档一致', true);
  await cdp.detach();
}
