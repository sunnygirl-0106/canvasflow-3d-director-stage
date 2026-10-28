import fs from 'node:fs';
import { page, ok } from '../harness.mjs';
import { settle, clickSel } from '../helpers.mjs';

const OUT = 'test-output/round5';
const snap = async name => { await page.mouse.move(450, 30); await settle(100); const style = await page.addStyleTag({content:'#uiTooltip, #toast { visibility:hidden; }'}); await page.screenshot({ path: `${OUT}/${name}.png` }); await style.dispose(); await page.evaluate(()=>document.querySelectorAll('style').forEach(s=>{if(s.textContent==='#uiTooltip, #toast { visibility:hidden; }')s.remove();})); };
const field = async (label, index, value) => {
  const selector = await page.evaluate(({ label, index }) => {
    const row = [...document.querySelectorAll('#inspector .field')].find(n => n.querySelector('label')?.textContent === label);
    const input = row?.querySelectorAll('input:not([type=range])')[index];
    if (!input) throw new Error('缺少字段 ' + label);
    input.dataset.testInput = 'edit'; return '[data-test-input="edit"]';
  }, { label, index });
  await page.focus(selector);
  await page.$eval(selector, (input, value) => { input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); input.blur(); delete input.dataset.testInput; }, value);
  await settle(100);
};

export async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  await page.setViewport({ width: 1440, height: 900 });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__app?.ready);
  const seed = await page.evaluate(() => { window.round5Seed = window.__app.exportDocument(); return window.round5Seed; });
  ok('默认角色A/B；主机位固定参数', seed.entities.filter(e => e.type === 'character').map(e => e.name).join() === '角色A,角色B' && JSON.stringify(seed.entities.find(e => e.type === 'camera').transform.pos) === '[0,2.2,10]' && seed.entities.find(e => e.type === 'camera').fov === 50);
  const calibration = [];
  for (const [width, height] of [[1440, 900], [1920, 1080]]) {
    await page.setViewport({ width, height });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle0' }); await page.waitForFunction(() => window.__app?.ready);
    for (const ratio of ['16:9', '9:16']) {
      const samples = [];
      for (const collapsed of [true, false]) {
        await page.evaluate(({ ratio, collapsed }) => { window.__app.setRatio(ratio); window.__timelinePanel.setCollapsed(collapsed); }, { ratio, collapsed });
        await settle();
        samples.push(await page.evaluate(async () => {
          const a = window.__app, { worldBox } = await import('/src/util/measure.js');
          a.stage.camera.updateMatrixWorld();
          const actors = a.entities.filter(e => e.type === 'character').map(e => {
            const b = worldBox(e.root, { useBones: true }), c = b.getCenter(a.stage.camera.position.clone());
            const y = n => (1 - c.clone().setY(n).project(a.stage.camera).y) / 2;
            return { name: e.name, center: y(c.y), head: y(b.max.y), feet: y(b.min.y), height: y(b.min.y)-y(b.max.y), pos: e.toJSON().transform.pos };
          });
          const cam = a.cameras[0], direction = cam.cam.getWorldDirection(a.stage.camera.position.clone());
          return { actors, direction: direction.toArray(), collapsed: window.__timelinePanel.collapsed };
        }));
        await snap(`director-${width}x${height}-${ratio.replace(':','x')}-${collapsed ? 'closed' : 'open'}`);
      }
      ok(`${width}×${height} ${ratio} 统一构图、人物完整、时间轴开合不跳位`, samples[0].actors.every(e => e.head > 0 && e.feet < 1 && e.pos[1] === 0) && JSON.stringify(samples[0].actors) === JSON.stringify(samples[1].actors));
      calibration.push({ width, height, ratio, samples });
    }
  }
  fs.writeFileSync(`${OUT}/calibration.json`, JSON.stringify(calibration, null, 2));
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluate(async doc => { await window.__app.loadDocument(doc); window.__timelinePanel.setCollapsed(true); }, seed);
  await page.click('#sideRail button:nth-child(2)'); await snap('characters');
  ok('真实角色列表7项', await page.$$eval('.sidebar-tool [data-body]', nodes => nodes.length === 7));
  await clickSel('.sidebar-tool [data-body="male"]'); await page.waitForFunction(() => window.__app.entities.some(e => e.name === '角色C'));
  await clickSel('.sidebar-tool [data-body="female"]'); await page.waitForFunction(() => window.__app.entities.some(e => e.name === '角色D'));
  const naming = await page.evaluate(async () => {
    const a = window.__app; a.rename(a.selectedId, '自定义演员'); const doc = a.exportDocument(); await a.loadDocument(doc); const e = await a.addCharacter('slim');
    return { preserved: a.entities.some(e => e.name === '自定义演员'), next: e.name };
  });
  ok('添加C/D，保存恢复保留自定义名且继续递增', naming.preserved && naming.next === '角色E', JSON.stringify(naming)); // 会话序号保留已发放的D；载入不回退。
  await page.click('#sideRail button:nth-child(3)'); await snap('cameras');
  ok('15机位卡片', await page.$$eval('.sidebar-tool [data-preset]', n => n.length === 15));
  await page.click('.sidebar-tool [data-preset="front_closeup"]');
  ok('机位卡片实际创建', await page.evaluate(() => window.__app.cameras.length === 2));
  await page.click('#sideRail button:nth-child(4)'); await snap('panorama');
  ok('全景仅真实上传与历史入口', await page.$eval('.sidebar-tool', n => n.innerText.includes('本地上传') && n.innerText.includes('历史记录') && !n.innerText.includes('AI生成')));
  await page.click('#sideRail button:nth-child(5)'); await snap('ratios');
  ok('画幅7项及自适应文案', await page.$$eval('.ratio-card', n => n.length === 7 && n[0].innerText === '自适应'));
  await page.evaluate(()=>{window.__app.setRatio('16:9'); window.__app.history.capture();});
  await page.click('[data-ratio="9:16"]');
  ok('画幅使用真实文档数据，撤销同步边框', await page.evaluate(async () => { const a = window.__app; a.history.capture(); const selected = document.querySelector('[data-ratio="9:16"]').classList.contains('selected'); await a.history.undo(); return selected && document.querySelector('[data-ratio="16:9"]').classList.contains('selected'); }));
  await page.keyboard.press('Escape');
  ok('Esc回场景并返回导航焦点', await page.evaluate(() => !document.querySelector('.sidebar-scene').hidden && document.activeElement === document.querySelector('#sideRail button:nth-child(5)')));

  await page.evaluate(async doc => {
    const a = window.__app; await a.loadDocument(doc); a.select(a.entities[0].id); a.history.reset();
    const p = window.__timelinePanel; p.setCollapsed(false); p.trackRows.expandedEnts.add(a.entities[0].id); p.rebuild();
  }, seed);
  await snap('ordinary-empty');
  ok('无动画也有位置/旋转/缩放三行，不创建空轨道', await page.evaluate(() => document.querySelectorAll('.tl-track').length === 3 && window.__app.timeline.tracks.length === 0 && !document.querySelector('.tl-fold')));
  await page.click('.tl-track[data-property-row="pos"] .tl-key-toggle'); await snap('ordinary-filled');
  ok('空心创建首键并实心，一次撤销', await page.evaluate(() => { const a = window.__app; a.history.capture(); return a.timeline.tracks[0].keys.length === 1 && a.history.entries.length === 2 && document.querySelector('.tl-key-toggle').dataset.filled === 'true'; }));
  await page.click('.tl-track[data-property-row="pos"] .tl-key-toggle');
  ok('实心删除原始时刻的键', await page.evaluate(() => window.__app.timeline.tracks[0].keys.length === 0));
  const matching = await page.evaluate(async () => {
    const a = window.__app, { toggleKey, propState } = await import('/src/ui/timeline/animState.js');
    const e = a.entities[0], track = a.timeline.tracks[0];
    a.timeline.setKey(track.id, 1.001, [1,0,0]); a.timeline.setKey(track.id, 1.012, [2,0,0]); a.playback.seek(1.01);
    const hit = propState(a, a.timeline.view(), e.id, 'pos', a.playback.time).key.t;
    toggleKey(a, e, 'pos'); return { hit, times: a.timeline.tracks[0].keys.map(k => k.t) };
  });
  ok('同帧导入键选最近者，删除保留精确相邻时间', matching.hit === 1.012 && matching.times.join() === '1.001', JSON.stringify(matching));

  const pathId = await page.evaluate(async doc => {
    const a = window.__app; await a.loadDocument(doc); const e = a.entities[0];
    const path = a.timeline.addPath({ target: e.id, points: [[-1,0,0],[1,1,0],[3,2,0]], start: 1, duration: 8, orient: 'tangent', interpolation: 'polyline' });
    a.timeline.updatePath(path.id, { stops: [1], stopTimes: [4] });
    a.select(e.id); a.playback.seek(2); a.emit('inspect', { id: e.id, section: 'path' });
    const p = window.__timelinePanel; p.trackRows.expandedEnts.add(e.id); p.rebuild(); a.history.reset();
    return path.id;
  }, seed);
  await snap('path-before');
  ok('运动轨迹页恰好六字段、Y朝向锁定', await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.character-path > .field > label, .character-path > .toggle-row > .t-label')].map(n => n.textContent);
    return labels.join() === '时长,位置,旋转,缩放,统一缩放,绑定对象沿路径朝向' && document.querySelectorAll('.character-path .triple')[1].querySelectorAll('input')[1].disabled;
  }));
  await page.click(`.tl-track[data-path="${pathId}"] .tl-key-toggle`); await snap('path-after');
  const inserted = await page.evaluate(id => {
    const a = window.__app, p = a.timeline.paths.find(p => p.id === id); a.history.capture();
    return { p, noPos: !a.timeline.tracks.some(t => t.property === 'pos'), selected: a.pathOverlay.selVertex, filled: document.querySelector(`.tl-track[data-path="${id}"] .tl-key-toggle`).dataset.filled, history: a.history.entries.length, time: a.playback.time };
  }, pathId);
  ok('路径插点保持高度/停顿/时长、不建pos轨道，选中并实心，一次撤销', inserted.p.points.length === 4 && inserted.p.points[1][1] > 0 && inserted.p.points[1][1] < 1 && inserted.p.stops[0] === 2 && inserted.p.stopTimes[0] === 4 && inserted.p.start === 1 && inserted.p.duration === 8 && inserted.noPos && inserted.selected.index === 1 && inserted.filled === 'true' && inserted.history === 2, JSON.stringify(inserted));
  await page.evaluate(() => window.__app.history.undo());
  ok('一步撤销恢复原路径', await page.evaluate(() => window.__app.timeline.paths[0].points.length === 3));
  await page.evaluate(() => { const a = window.__app; a.playback.seek(3); a.emit('inspect', {id:a.entities[0].id, section:'path'}); a.history.reset(); window.pathBefore = a.exportDocument(); });
  const oldPos = await page.evaluate(() => window.__app.timeline.valueOf(window.__app.entities[0], 'pos'));
  await field('位置', 0, oldPos[0] + 2);
  ok('位置字段平移整条轨迹和基准，形状/时序保留', await page.evaluate(() => {
    const a = window.__app, before = window.pathBefore, after = a.exportDocument();
    return after.paths[0].points.every((p,i) => Math.abs(p[0]-before.paths[0].points[i][0]-2)<1e-5 && p[1]===before.paths[0].points[i][1]) && Math.abs(after.entities[0].transform.pos[0]-before.entities[0].transform.pos[0]-2)<1e-5 && after.paths[0].start === 1 && after.paths[0].duration === 8;
  }));
  const orient = await page.evaluate(() => { const a = window.__app, e = a.entities[0]; const before = e.root.quaternion.clone(); a.timeline.setPathOrientation(a.timeline.paths[0].id, 'keep'); return before.angleTo(e.root.quaternion); });
  ok('关闭沿路径朝向保持可见姿态', orient < 1e-5, String(orient));
  await settle(); await field('统一缩放', 0, 1.4);
  ok('统一缩放即时同步XYZ且不改变路径长度', await page.evaluate(() => { const a=window.__app; return a.timeline.valueOf(a.entities[0], 'scale').every(v=>Math.abs(v-1.4)<1e-5) && a.timeline.paths[0].points.length===3; }));
  await field('时长', 0, 99);
  ok('时长夹取剩余场景范围，不重置start或延长场景', await page.evaluate(() => { const a=window.__app; return a.timeline.duration===10&&a.timeline.paths[0].start===1&&a.timeline.paths[0].duration===9; }));
  await snap('motion-six-fields');
  const roundtrip = await page.evaluate(async () => { const a=window.__app; const doc=a.exportDocument({view:false}); await a.loadDocument(doc); const restored=a.exportDocument({view:false}); delete doc.meta.updatedAt; delete restored.meta.updatedAt; return JSON.stringify(doc)===JSON.stringify(restored); });
  ok('六字段编辑后保存恢复一致', roundtrip);
  const performance = await page.evaluate(async () => {
    const a=window.__app; let rebuilds=0;
    const observer = new MutationObserver(records => { rebuilds += records.filter(r => r.type === 'childList').length; });
    observer.observe(document.querySelector('.tl-rows'), { childList: true });
    for(let i=0;i<30;i++)a.playback.seek(i/30);
    await new Promise(resolve=>requestAnimationFrame(resolve));observer.disconnect();
    return rebuilds;
  });
  ok('播放tick不重建时间轴DOM', performance === 0, String(performance));
  const icons = await page.evaluate(() => [...document.querySelectorAll('#dock .dockbtn, #sideRail .dockbtn, .tl-transport .tl-btn')].filter(n=>!n.disabled).map(n=>getComputedStyle(n).color));
  ok('正常功能图标统一亮白', icons.every(c=>['rgb(244, 244, 245)','rgb(255, 255, 255)'].includes(c)), [...new Set(icons)].join());
  await page.click('#sceneActions button'); await snap('scene-menu');
  await page.evaluate(() => [...document.querySelectorAll('.dockmenu.open .menu-item')].find(n=>n.textContent.includes('全屏')).click()); await settle();
  await page.click('#sideRail button:nth-child(3)'); await snap('fullscreen-cameras');
  ok('全屏内侧栏和弹层可见', await page.evaluate(() => document.fullscreenElement===document.documentElement && !document.querySelector('.sidebar-tool').hidden));
  await page.evaluate(() => document.exitFullscreen());
}
