import fs from 'node:fs';
import { page, ok } from '../harness.mjs';
import { settle } from '../helpers.mjs';

export async function run() {
  const out = 'test-output/polish';
  fs.mkdirSync(out, { recursive: true });
  // 对比实际 WebGL 像素与相机投影，防止面板缩放间接改变构图。
  const stability = await page.evaluate(async () => {
    const a = window.__app, panel = window.__timelinePanel;
    const settleLayout = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const capture = () => {
      a.beforeRender(); a.stage.render();
      const camera = a.getRenderCamera(), canvas = a.stage.renderer.domElement;
      return {
        pixels: canvas.toDataURL(), size: [canvas.width, canvas.height].join(),
        projection: camera.projectionMatrix.toArray().join(),
        pose: [...camera.position.toArray(), ...camera.quaternion.toArray()].join(),
        doc: JSON.stringify(a.store.document), history: a.history.index,
      };
    };
    const results = [];
    for (const mode of ['director', 'camera', 'preview']) {
      a.stopPreview(); a.setCameraView(mode === 'camera');
      if (mode === 'preview') a.startPreview();
      panel.setCollapsed(true); await settleLayout();
      const before = capture();
      const samples = [];
      for (const [collapsed, height] of [[false, 160], [false, 300], [false, 480], [true, 480], [false, 180]]) {
        panel.setHeight(height); panel.setCollapsed(collapsed); await settleLayout();
        const after = capture();
        const timeline = panel.container.getBoundingClientRect();
        const tools = document.querySelector('#stageTools').getBoundingClientRect();
        const side = document.querySelector('.side.right').getBoundingClientRect();
        samples.push({
          collapsed, height, pixels: before.pixels === after.pixels, size: before.size === after.size,
          projection: before.projection === after.projection, pose: before.pose === after.pose,
          doc: before.doc === after.doc && before.history === after.history,
          controls: collapsed || (tools.bottom <= timeline.top && side.bottom <= timeline.top + 1),
        });
      }
      results.push({ mode, samples });
    }
    a.stopPreview(); a.setCameraView(false); panel.resetHeight(); panel.setCollapsed(false);
    return results;
  });
  for (const result of stability) ok(`${result.mode}：时间轴增高/缩小/折叠，画布像素、投影、机位和文档均不变`,
    result.samples.every(s => s.pixels && s.size && s.projection && s.pose && s.doc && s.controls), JSON.stringify(result.samples));
  await page.evaluate(() => { window.__timelinePanel.setCollapsed(false); window.__timelinePanel.resetHeight(); });
  await settle(100);
  const initial = await page.evaluate(() => ({ doc: JSON.stringify(window.__app.store.document), history: window.__app.history.index, height: document.querySelector('#timeline').offsetHeight }));
  ok('无轨迹仅保留弱文字提示，不生成整行持续色条', await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.tl-head.no-path')];
    return rows.length > 0 && rows.every(r => !r.querySelector('.tl-presence') && r.querySelector('.tl-path-status')?.textContent === (r.classList.contains('camera') ? '无轨迹' : '无动画'));
  }));
  const edge = async () => page.$eval('.tl-resize-handle', n => { const r = n.getBoundingClientRect(); return { x: r.width / 2, y: r.top + r.height / 2 }; });
  let handle = await edge();
  await page.mouse.move(handle.x, handle.y);
  await settle(200);
  ok('上沿悬浮显示握柄与上下拖动光标', await page.$eval('.tl-resize-handle', n => getComputedStyle(n).cursor === 'ns-resize' && getComputedStyle(n, '::after').opacity === '1'));
  await page.mouse.down();
  await page.mouse.move(handle.x, handle.y - 100, { steps: 10 });
  await page.mouse.up();
  ok('真实向上拖动增高 100px，结束后释放拖动态', await page.evaluate(h => Math.abs(document.querySelector('#timeline').offsetHeight - h - 100) <= 1 && !document.body.classList.contains('resizing-timeline'), initial.height));
  handle = await edge();
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down(); await page.mouse.move(handle.x, 810, { steps: 8 }); await page.mouse.up();
  ok('向下拖动保留最小可用高度', await page.$eval('#timeline', n => n.offsetHeight === 160));
  handle = await edge();
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down(); await page.mouse.move(handle.x, 0, { steps: 8 }); await page.mouse.up();
  ok('向上拖动有上限，舞台仍保留可用空间', await page.evaluate(() => document.querySelector('#timeline').offsetHeight <= innerHeight * 0.7 + 1 && document.querySelector('main').offsetHeight >= 220));
  await page.evaluate(() => window.__timelinePanel.setHeight(300));
  await page.focus('.tl-resize-handle');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End');
  await page.keyboard.press('Home');
  ok('键盘可调高度，Home / End 不会跳动播放头', await page.evaluate(() => document.querySelector('#timeline').offsetHeight === 160 && window.__app.playback.time === 0));
  handle = await edge();
  await page.mouse.click(handle.x, handle.y, { count: 2 });
  ok('双击还原默认高度', await page.evaluate(h => Math.abs(document.querySelector('#timeline').offsetHeight - h) <= 1 && window.__timelinePanel.height === null, initial.height));
  await page.evaluate(() => window.__timelinePanel.setHeight(300));
  await page.focus('.tl-resize-handle'); await page.keyboard.press('ArrowUp');
  await page.evaluate(() => { const p = window.__timelinePanel; p.setCollapsed(true); p.setCollapsed(false); });
  ok('折叠后恢复自定高度，所有尺寸操作不改场景或撤销栈', await page.evaluate(before => document.querySelector('#timeline').offsetHeight === 324 && JSON.stringify(window.__app.store.document) === before.doc && window.__app.history.index === before.history, initial));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__app?.ready);
  // 每次进入默认收起，但再次打开仍使用保存高度。
  await page.click('#dock button:last-child');
  ok('刷新后再次展开记住时间轴高度', await page.$eval('#timeline', n => n.offsetHeight === 324));
  await page.mouse.move(800, 180); await settle(240);
  ok('预制入口只占一个图标位，侧栏不再有独立入口', await page.evaluate(() => !!document.querySelector('.ai-input #scenePresets') && !document.querySelector('.side.left #scenePresets') && document.querySelector('.ai-presets-label').getBoundingClientRect().width === 0));
  await page.screenshot({ path: `${out}/timeline.png` });
  await page.hover('#scenePresets'); await settle(420);
  ok('预制入口悬浮显示提示，按钮和空输入框不扩高或挤换行', await page.evaluate(() => {
    const input = document.querySelector('.ai-input').getBoundingClientRect();
    const button = document.querySelector('#scenePresets').getBoundingClientRect();
    const tooltip = document.querySelector('#uiTooltip');
    return input.height === 44 && button.width === 32 && button.height === 32 && !tooltip.hidden && tooltip.textContent.includes('预制场景');
  }));
  await page.screenshot({ path: `${out}/capsule-hover.png` });
  const beforePreset = await page.evaluate(() => JSON.stringify(window.__app.store.document));
  await page.click('#scenePresets');
  ok('入口打开 8 个场景并更新展开状态', await page.evaluate(() => document.querySelectorAll('.ai-preset').length === 8 && document.querySelector('#scenePresets').getAttribute('aria-expanded') === 'true'));
  await settle(220);
  await page.screenshot({ path: `${out}/presets.png` });
  await page.click('.ai-preset');
  ok('预制只填草稿，不触发生成、不改场景', await page.evaluate(before => window.__aiPanel.textarea.value.length > 0 && !window.__app.ai.busy && !document.querySelector('.ai-preset-tray') && JSON.stringify(window.__app.store.document) === before, beforePreset));
  await page.evaluate(() => { window.__aiPanel.textarea.value = ''; window.__aiPanel.renderInput(); });
  for (const [width, height] of [[2048, 1120], [1440, 900], [900, 700], [680, 700]]) {
    await page.setViewport({ width, height }); await settle(160);
    ok(`${width}×${height} 工具坞及胶囊完整显示`, await page.evaluate(() => {
      const stage = document.querySelector('#viewport').getBoundingClientRect();
      const tools = document.querySelector('#stageTools').getBoundingClientRect();
      const input = document.querySelector('.ai-text').getBoundingClientRect();
      const capsule = document.querySelector('.ai-input').getBoundingClientRect();
      const dock = document.querySelector('#dock').getBoundingClientRect();
      return tools.left >= stage.left && tools.right <= stage.right && tools.top >= stage.top && tools.bottom <= stage.bottom && input.width > 70 && capsule.height === 44 && dock.height === 44 && input.height === 24;
    }));
    await page.screenshot({ path: `${out}/layout-${width}.png` });
  }
  await page.setViewport({ width: 1024, height: 760, deviceScaleFactor: 2 });
  await page.hover('#scenePresets'); await settle(200);
  ok('高像素密度下仍保持单行，不发生截图中的胶囊撑高', await page.$eval('.ai-input', n => n.getBoundingClientRect().height === 44));
  await page.screenshot({ path: `${out}/layout-retina.png` });
}
