import fs from 'node:fs';
import { page, ok } from '../harness.mjs';
import { settle, dragPlayhead } from '../helpers.mjs';

export async function run() {
  fs.mkdirSync('test-output/editor-ui', { recursive: true });
  const ids = await page.evaluate(async () => {
    const a = window.__app, { createPresetScene } = await import('/src/ai/presets.js');
    a.playback.stop(); await a.loadDocument(createPresetScene(0), { newScene: true });
    const c = a.cameras[0], chars = a.entities.filter(e => e.type === 'character');
    a.cameraMoves.clear(c); a.select(c.id, { user: true });
    a.playback.seek(2); a.cameraMoves.applyPreset(c, 'truck', { mode: 'append', params: { amount: .65, dir: 'right', duration: 3.5 } });
    window.__timelinePanel.setCollapsed(false);
    return { cam: c.id, a: chars[0].id, b: chars[1].id };
  });
  const repeat = await page.evaluate(ids => {
    const a = window.__app, cam = a.findCamera(ids.cam), tool = a.cameraMoves;
    const before = JSON.stringify(a.timeline.paths.filter(p => p.target !== cam.id));
    const first = tool.current(cam).segments[0];
    a.playback.seek(0); tool.applyPreset(cam, 'truck', { mode: 'append' }); tool.applyPreset(cam, 'truck', { mode: 'append' });
    const state = tool.current(cam);
    const same = state.segments.every(s => JSON.stringify(s.params) === JSON.stringify(first.params));
    const custom = state.segments.map(s => ({ time: s.origin.time, params: s.params }));
    const unchanged = before === JSON.stringify(a.timeline.paths.filter(p => p.target !== cam.id));
    const snapshot = JSON.stringify(a.store.document), history = a.history.index;
    const rejected = !tool.applyPreset(cam, 'push_in', { mode: 'append', params: { amount: 100 } });
    return { same, unchanged, custom, atomic: rejected && snapshot === JSON.stringify(a.store.document) && history === a.history.index, firstTime: first.origin.time };
  }, ids);
  ok('首段使用播放头；重复追加继承 3.5s / .65m / 向右，其他对象时刻不变', repeat.same && repeat.unchanged && repeat.firstTime === 2 && repeat.custom.map(s => s.time).join() === '2,5.5,9', JSON.stringify(repeat));
  ok('非法推进不改文档、不新增历史', repeat.atomic);
  const prefix = await page.evaluate(async ids => {
    const a = window.__app, { Path } = await import('/src/anim/Path.js');
    const p = new Path(a.timeline.paths.find(p => p.target === ids.cam));
    a.emit('inspect', { id: ids.cam, section: 'move' });
    return Array.from({ length: 91 }, (_, i) => p.positionAt(p.distanceAt(i / 10)).toArray());
  }, ids); await settle();
  await page.evaluate(() => {
    const field = [...document.querySelectorAll('.camera-moves .field')].find(f => f.querySelector('label')?.textContent === '距离');
    const input = field.querySelector('input'); input.value = '.9'; input.dispatchEvent(new Event('change'));
  }); await settle();
  ok('多段参数表只修改末段，已有前缀逐帧不变', await page.evaluate(async ({ ids, prefix }) => {
    const a = window.__app, { Path } = await import('/src/anim/Path.js'), p = new Path(a.timeline.paths.find(p => p.target === ids.cam));
    const state = a.cameraMoves.current(a.findCamera(ids.cam));
    return state.segments.length === 3 && state.segments.at(-1).params.amount === .9 && state.segments[0].params.amount === .65 && prefix.every((v, i) => p.positionAt(p.distanceAt(i / 10)).toArray().every((x, k) => Math.abs(x - v[k]) < 1e-8));
  }, { ids, prefix }));
  await page.evaluate(ids => {
    const a = window.__app; a.playback.seek(3);
    // 本用例只验证两个分段区间，先移除预设生成的默认全程注视。
    for (const c of a.timeline.constraints.filter(c => c.target === ids.cam && c.type === 'lookAt')) a.timeline.removeConstraint(c.id);
    a.timeline.addConstraint({ type: 'lookAt', target: ids.cam, subject: ids.a, start: 0, end: 5 });
    a.timeline.addConstraint({ type: 'lookAt', target: ids.cam, subject: ids.b, start: 6, end: 10 });
    a.emit('inspect', { id: ids.cam, section: 'constraint' });
  }, ids); await settle();
  const original = await page.evaluate(() => JSON.stringify(window.__app.timeline.paths));
  await page.evaluate(id => { const s = [...document.querySelectorAll('[data-constraint-type="lookAt"] select')].at(-1); s.value = id; s.dispatchEvent(new Event('change')); }, ids.b); await settle();
  ok('属性修改仅影响选中注视区间，路径不重画，预设身份有效', await page.evaluate(({ ids, original }) => {
    const a = window.__app, c = a.timeline.constraints.filter(c => c.target === ids.cam);
    return JSON.stringify(a.timeline.paths) === original && c.length === 2 && c[0].subject === ids.b && c[1].start === 6 && !!a.cameraMoves.current(a.findCamera(ids.cam));
  }, { ids, original }));
  await page.evaluate(() => window.__app.playback.seek(5.5)); await settle();
  ok('播放头在区间外明确标记，手动旋转恢复', await page.evaluate(() => {
    const section = document.querySelector('[data-constraint-type="lookAt"]');
    return section.querySelector('select').selectedOptions[0].textContent === '播放头不在生效区间' && [...document.querySelectorAll('#inspector .field')].find(f => f.querySelector('label')?.textContent.startsWith('旋转')).querySelector('input').disabled === false;
  }));
  const interval = await page.evaluate(ids => {
    const a = window.__app; const c = a.timeline.constraints.filter(c => c.target === ids.cam)[1];
    window.__timelinePanel.trackRows.expandedEnts.add(ids.cam); window.__timelinePanel.rebuild(); return c.id;
  }, ids); await settle();
  await page.$eval(`.tl-camera-span[data-constraint-span="${interval}"]`, n => n.scrollIntoView({ block: 'nearest' }));
  await page.click(`.tl-camera-span[data-constraint-span="${interval}"]`, { count: 2 }); await settle();
  ok('双击焦点状态线打开属性并选中对应区间', await page.evaluate(interval => document.querySelector('#inspector .ptabs .on')?.textContent === '属性' && document.querySelector('[data-constraint-type="lookAt"]').dataset.interval === interval, interval));
  await page.evaluate(ids => {
    const a = window.__app; a.playback.seek(7); a.emit('inspect', { id: ids.cam, section: 'constraint' });
  }, ids); await settle();
  await page.select('[data-constraint-type="follow"] select', ids.a); await settle();
  ok('生效跟随禁用位置，仍保留底层路径', await page.evaluate(({ ids, original }) => {
    const fields = [...document.querySelectorAll('#inspector .field')], pos = fields.find(f => f.querySelector('label')?.textContent.startsWith('位置'));
    return pos.querySelector('input').disabled && document.querySelector('#inspector').textContent.includes('此时段位置由跟随控制') && JSON.stringify(window.__app.timeline.paths) === original && window.__app.cameraMoves.current(window.__app.findCamera(ids.cam));
  }, { ids, original }));
  await page.screenshot({ path: 'test-output/editor-ui/constraints.png' });
  ok('跟随覆盖末端位置时明确拒绝追加，文档与历史不变', await page.evaluate(ids => {
    const a = window.__app, doc = JSON.stringify(a.store.document), history = a.history.index;
    const rejected = !a.cameraMoves.applyPreset(a.findCamera(ids.cam), 'truck', { mode: 'append' });
    return rejected && a.cameraMoves.error.includes('跟随') && JSON.stringify(a.store.document) === doc && a.history.index === history;
  }, ids));
  await page.evaluate(ids => window.__app.emit('inspect', { id: ids.cam, section: 'move' }), ids); await settle();
  const beforeFailedAppend = await page.evaluate(() => ({ doc: JSON.stringify(window.__app.store.document), history: window.__app.history.index }));
  await page.click('.move-append'); await settle(); await page.click('[data-preset="truck"]'); await settle();
  ok('追加失败保留卡片、取消入口和明确错误，文档与历史不变', await page.evaluate(before => !!document.querySelector('.move-cancel') && document.querySelector('.move-error').textContent.includes('跟随') && JSON.stringify(window.__app.store.document) === before.doc && window.__app.history.index === before.history, beforeFailedAppend));
  await page.click('.move-cancel');
  await page.evaluate(ids => window.__app.emit('inspect', { id: ids.cam, section: 'constraint' }), ids); await settle();
  await page.evaluate(ids => window.__app.rename(ids.a, '跟随目标改名验收'), ids); await settle();
  ok('目标改名后属性选项同步', await page.$eval('[data-constraint-type="follow"] select', n => n.selectedOptions[0].textContent === '跟随目标改名验收'));
  await page.evaluate(ids => window.__app.remove(ids.a), ids); await settle();
  ok('删除目标清理约束与控件，不留悬空跟随', await page.evaluate(ids => !window.__app.timeline.constraints.some(c => c.subject === ids.a) && document.querySelector('[data-constraint-type="follow"] select').value === '', ids));
  await page.evaluate(async () => { await window.__app.history.undo(); }); await settle();
  ok('撤销删除恢复目标与跟随控件', await page.$eval('[data-constraint-type="follow"] select', (n, id) => n.value === id, ids.a));
  ok('清除运镜保留用户的跟随及分段注视', await page.evaluate(ids => {
    const a = window.__app, before = JSON.stringify(a.timeline.constraints); a.cameraMoves.clear(a.findCamera(ids.cam));
    return before === JSON.stringify(a.timeline.constraints) && !a.timeline.paths.some(p => p.target === ids.cam);
  }, ids));
  await page.evaluate(async () => { await window.__app.history.undo(); }); await settle();
  ok('撤销清除恢复位置轨迹与合法预设身份', await page.evaluate(ids => !!window.__app.cameraMoves.current(window.__app.findCamera(ids.cam)), ids));
  const reload = await page.evaluate(async ids => {
    const a = window.__app, doc = a.exportDocument(); await a.loadDocument(doc);
    const valid = !!a.cameraMoves.current(a.findCamera(ids.cam));
    const p = a.timeline.paths.find(p => p.target === ids.cam), points = structuredClone(p.points); points[1][0] += .2;
    a.timeline.updatePath(p.id, { points });
    const c = a.timeline.constraints.find(c => c.target === ids.cam && c.type === 'lookAt');
    a.timeline.updateConstraint(c.id, { subject: ids.a });
    return { valid, invalid: a.cameraMoves.current(a.findCamera(ids.cam)) === null };
  }, ids);
  ok('保存重载身份保留；手工节点修改后属性编辑不掩盖失效', reload.valid && reload.invalid);

  // Anchored non-modal popover: browsing is read-only; submission is atomic.
  await page.$eval('.ai-text', n => { n.value = '保留我的输入草稿'; });
  await page.evaluate(() => window.__app.setRatio('auto'));
  const beforeModal = await page.evaluate(() => JSON.stringify(window.__app.store.document));
  await page.click('#scenePresets'); await settle();
  ok('打开不默认选中，创建禁用；非模态小浮层紧邻入口', await page.evaluate(() => {
    const tray = document.querySelector('#scenePresetTray'), r = tray.getBoundingClientRect(), t = document.querySelector('#scenePresets').getBoundingClientRect();
    return !tray.matches(':modal') && tray.getAttribute('aria-modal') === 'false' && r.width >= 360 && r.width <= 400 && r.height <= 360 && Math.abs(r.bottom + 8 - t.top) < 2 && !tray.querySelector('.selected') && tray.querySelector('.primary').disabled;
  }));
  await (await page.$$('.ai-preset'))[3].click();
  await page.keyboard.press('Escape');
  ok('选择再取消不改变场景与草稿，焦点回到入口', await page.evaluate(before => JSON.stringify(window.__app.store.document) === before && document.querySelector('.ai-text').value === '保留我的输入草稿' && document.activeElement.id === 'scenePresets', beforeModal));
  await page.click('#scenePresets'); await settle();
  await (await page.$$('.ai-preset'))[3].click();
  await page.screenshot({ path: 'test-output/editor-ui/presets.png' });
  await page.evaluate(() => { const a = window.__app; window.__originalLoad = a.loadDocument; a.loadDocument = async () => { throw new Error('验收注入的加载失败'); }; });
  await page.click('.scene-preset-footer .primary'); await settle();
  ok('创建失败保留场景、选择和弹层，并显示原因', await page.evaluate(before => JSON.stringify(window.__app.store.document) === before && document.querySelector('#scenePresetTray .move-error').textContent.includes('验收注入') && document.querySelector('.ai-preset.selected strong').textContent === '错身后回望', beforeModal));
  await page.evaluate(() => {
    const a = window.__app; window.__createCount = 0;
    a.loadDocument = async function (...args) { window.__createCount++; await new Promise(resolve => setTimeout(resolve, 300)); return window.__originalLoad.apply(this, args); };
    const button = document.querySelector('.scene-preset-footer .primary'); button.click(); button.click();
  });
  await page.keyboard.press('Escape');
  await page.click('#scenePresets');
  ok('提交期间关闭、入口与重复操作均受保护', await page.evaluate(() => !!document.querySelector('#scenePresetTray') && document.querySelector('#scenePresetTray .scene-preset-heading button').disabled && window.__createCount === 1));
  await page.waitForFunction(() => !document.querySelector('#scenePresetTray')); await settle();
  ok('连续提交只创建一次，成功进入本地场景并保留草稿', await page.evaluate(() => window.__createCount === 1 && window.__app.store.document.meta.name === '错身后回望' && document.querySelector('.ai-text').value === '保留我的输入草稿'));
  await page.evaluate(async () => { window.__app.loadDocument = window.__originalLoad; await window.__app.history.undo(); });
  ok('场景替换一次撤销恢复原文档', await page.evaluate(before => JSON.stringify(window.__app.store.document) === before, beforeModal));
  await page.click('#scenePresets'); await settle();
  await page.evaluate(() => { document.querySelectorAll('#scenePresetTray button').item(8).focus(); });
  await page.keyboard.press('Tab');
  ok('Tab 自然离开浮层，不循环锁定焦点', await page.evaluate(() => !document.activeElement.closest('#scenePresetTray')));
  await page.mouse.click(10, 10); await settle();
  ok('点击页面外部关闭浮层', !await page.$('#scenePresetTray'));
  await dragPlayhead(1); // Exercise normal timeline input again after closing the popover.
  await correctedMotionUI();
}

async function correctedMotionUI() {
  const id = await page.evaluate(async () => {
    const a = window.__app, { createPresetScene } = await import('/src/ai/presets.js');
    a.playback.stop(); await a.loadDocument(createPresetScene(0), { newScene: true });
    a.setRatio('auto');
    const cam = a.cameras[0]; a.cameraMoves.clear(cam); a.select(cam.id, { user: true });
    a.emit('inspect', { id: cam.id, section: 'move' });
    a.history.capture();
    window.__motionBefore = JSON.stringify(a.store.document); window.__motionHistory = a.history.index;
    return cam.id;
  }); await settle();
  ok('空运镜为普通标题，无追加入口、监看、FOV 或放大控件', await page.evaluate(() => document.querySelector('.move-heading > span').textContent === '运镜' && !document.querySelector('.move-append, #inspector .cam-preview, #inspector .cam-monitor-head')));
  ok('只有 FOV、跟随或注视不误判为可追加', await page.evaluate(id => {
    const a = window.__app, c = a.findCamera(id);
    a.store.transact('independent attributes', d => {
      d.timeline.tracks.push({ id: 'fovonly01', target: id, property: 'fov', keys: [{ t: 0, value: 45, ease: 'linear' }] });
      d.constraints.push({ id: 'followonly01', type: 'follow', target: id, subject: d.entities.find(e => e.type === 'character').id, offset: [0, 1, 5], start: 0, end: 1 });
      d.constraints.push({ id: 'lookonly01', type: 'lookAt', target: id, subject: [0, 1, 0], offset: [0, 0, 0], start: 0, end: 1 });
    });
    return !a.cameraMoves.hasMoves(c);
  }, id)); await settle();
  ok('约束与 FOV 单独存在时界面不显示追加', !await page.$('.move-append'));
  const independent = await page.evaluate(() => ({ constraints: JSON.stringify(window.__app.store.document.constraints), fov: JSON.stringify(window.__app.store.document.timeline.tracks.filter(t => t.property === 'fov')) }));
  await page.click('[data-preset="truck"]'); await settle();
  ok('创建首段后出现追加入口，只有一个当前项', await page.evaluate(() => !!document.querySelector('.move-append') && document.querySelectorAll('.move-card.applied').length === 1));
  await page.screenshot({ path: 'test-output/editor-ui/normal-motion.png' });
  const first = await page.evaluate(() => ({ doc: JSON.stringify(window.__app.store.document), history: window.__app.history.index }));
  await page.click('.move-append'); await settle();
  ok('进入追加仅改变临时界面，卡片不重复，路径后摇镜头禁用', await page.evaluate(first => document.querySelector('.move-heading > span').textContent === '追加运镜' && document.querySelectorAll('.move-card').length === 8 && document.querySelector('[data-preset="pan"]').disabled && JSON.stringify(window.__app.store.document) === first.doc && window.__app.history.index === first.history, first));
  await page.screenshot({ path: 'test-output/editor-ui/append-motion.png' });
  await page.click('.move-cancel'); await settle();
  ok('取消不写文档和历史，普通替换摇镜头可用', await page.evaluate(first => !document.querySelector('.move-cancel') && !document.querySelector('[data-preset="pan"]').disabled && JSON.stringify(window.__app.store.document) === first.doc && window.__app.history.index === first.history, first));
  await page.click('.move-append'); await settle();
  await page.evaluate(() => [...document.querySelectorAll('#inspector .ptabs button')].find(b => b.textContent === '属性').click()); await settle();
  ok('摄像机属性页保留实时预览', !!await page.$('#inspector .cam-preview canvas'));
  await page.evaluate(id => window.__app.emit('inspect', { id, section: 'move' }), id); await settle();
  ok('离开运动轨迹页后追加状态清除', !await page.$('.move-cancel'));
  await page.click('.move-append'); await settle();
  await page.evaluate(id => { const a = window.__app; a.select(a.entities.find(e => e.type === 'character').id); a.select(id); }, id); await settle();
  ok('切换选择后追加状态清除', !await page.$('.move-cancel'));
  await page.click('.move-append'); await settle();
  await page.evaluate(id => { const a = window.__app; a.addCamera('front_mid'); a.select(id); }, id); await settle();
  ok('切换机位后返回也不会残留追加状态', !await page.$('.move-cancel'));

  await page.click('.move-append'); await settle();
  await page.click('[data-preset="crane"]'); await settle();
  await page.mouse.move(10, 10);
  ok('组合显示整套替换提示、末段参数及简短摘要', await page.evaluate(() => document.querySelector('.camera-moves').textContent.includes('选择预设将替换当前运镜') && document.querySelector('.camera-moves').textContent.includes('末段参数') && document.querySelector('.move-description').title.includes(' → ') && !document.querySelector('.move-cancel')));
  await page.click('[data-preset="crane"]'); await settle();
  ok('组合普通点击末段同名预设也替换整套，保留独立属性', await page.evaluate(({ id, independent }) => {
    const a = window.__app, state = a.cameraMoves.current(a.findCamera(id));
    return state.segments.length === 1 && state.segments[0].name === 'crane' && a.timeline.paths.find(p => p.target === id).duration === 2 && JSON.stringify(a.store.document.constraints) === independent.constraints && JSON.stringify(a.store.document.timeline.tracks.filter(t => t.property === 'fov')) === independent.fov;
  }, { id, independent }));
  await page.click('[data-preset="pan"]'); await settle();
  ok('普通模式从路径替换摇镜头成功，旋转单独存在仍有追加入口', await page.evaluate(id => !window.__app.timeline.paths.some(p => p.target === id) && window.__app.cameraMoves.current(window.__app.findCamera(id)).segments[0].name === 'pan' && !!document.querySelector('.move-append'), id));
  await page.evaluate(async () => { await window.__app.history.undo(); }); await settle();
  ok('单步撤销恢复路径，重做恢复摇镜头', await page.evaluate(async id => {
    const a = window.__app, restored = a.cameraMoves.current(a.findCamera(id)).segments[0].name === 'crane';
    await a.history.redo(); return restored && a.cameraMoves.current(a.findCamera(id)).segments[0].name === 'pan';
  }, id));

  const sampled = await page.evaluate(async id => {
    const a = window.__app, c = a.findCamera(id); a.cameraMoves.clear(c);
    a.store.transact('position keys', d => {
      d.constraints = d.constraints.filter(c => c.target !== id);
      d.timeline.tracks.push({ id: 'prefixpos01', target: id, property: 'pos', keys: [{ t: 0, value: [0, 2, 8], ease: 'smooth' }, { t: 3, value: [1, 2, 8], ease: 'linear' }] });
    });
    const samples = Array.from({ length: 31 }, (_, i) => { a.playback.seek(i / 10); return c.root.position.toArray(); });
    a.playback.seek(0);
    const added = a.cameraMoves.applyPreset(c, 'truck', { mode: 'append' });
    const same = samples.every((p, i) => { a.playback.seek(i / 10); return c.root.position.toArray().every((v, j) => Math.abs(v - p[j]) < 1e-7); });
    const end = a.timeline.paths.find(p => p.target === id)?.start;
    const doc = a.exportDocument(); await a.loadDocument(doc); a.select(id); a.emit('inspect', { id, section: 'move' });
    return added && same && end === 3 && !!a.cameraMoves.current(a.findCamera(id));
  }, id); await settle();
  ok('位置关键帧后的追加保留所有旧帧并从终点开始，保存重载有效', sampled);
  await page.evaluate(id => {
    const a = window.__app, panel = window.__timelinePanel;
    panel.setCollapsed(false); panel.setHeight(350); panel.trackRows.expandedEnts.clear(); panel.trackRows.expandedEnts.add(id); panel.rebuild();
    window.__snapshot = a.stage.snapshot; window.__previewCalls = 0;
    a.stage.snapshot = function (cam, options) { if (options?.width === 248 && options?.height === 140) window.__previewCalls++; return window.__snapshot.call(this, cam, options); };
    a.playback.seek(3.5);
  }, id); await settle();
  ok('运动页播放头刷新不再渲染侧栏小画面', await page.evaluate(() => window.__previewCalls === 0 && !document.querySelector('#inspector .cam-preview')));
  const node = `.tl-track[data-ent="${id}"] .tl-path-node[data-node-index="0"]`;
  await page.$eval(node, n => n.scrollIntoView({ block: 'nearest' })); await page.click(node); await settle();
  ok('路径选中只强化菱形，按钮无矩形 outline', await page.$eval(node, n => getComputedStyle(n).outlineStyle === 'none' && getComputedStyle(n, '::before').backgroundColor === 'rgb(93, 227, 236)'));
  await page.screenshot({ path: 'test-output/editor-ui/nodes-selected.png' });
  await page.keyboard.press('Tab'); await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
  ok('路径键盘焦点贴合菱形，尺寸稳定', await page.$eval(node, n => n.matches(':focus-visible') && getComputedStyle(n).outlineStyle === 'none' && getComputedStyle(n, '::before').boxShadow !== 'none' && getComputedStyle(n, '::before').width === '9px'));
  await page.screenshot({ path: 'test-output/editor-ui/nodes-focus.png' });
  const key = '.tl-key[data-track="prefixpos01"][data-t="0"]';
  await page.$eval(key, n => { n.scrollIntoView({ block: 'nearest' }); n.focus(); }); await page.keyboard.press('Enter'); await settle();
  ok('普通关键帧同样支持键盘选择与菱形焦点', await page.$eval(key, n => n.classList.contains('sel') && getComputedStyle(n).outlineStyle === 'none' && getComputedStyle(n, '::before').backgroundColor === 'rgb(93, 227, 236)' && getComputedStyle(n, '::before').boxShadow !== 'none'));
  const frames = await page.evaluate(async () => {
    const a = window.__app; let valid = true;
    for (const cameraView of [false, true]) for (const ratio of ['16:9', '9:16', '1:1']) {
      a.setCameraView(cameraView); a.setRatio(ratio); a.playback.seek(1);
      valid &&= ['none', 'normal'].includes(getComputedStyle(document.querySelector('#frame'), '::after').content);
    }
    a.playback.play(); await new Promise(resolve => setTimeout(resolve, 100)); a.playback.pause();
    valid &&= ['none', 'normal'].includes(getComputedStyle(document.querySelector('#frame'), '::after').content);
    a.setRatio('16:9'); a.setCameraView(false); a.stage.snapshot = window.__snapshot;
    return valid;
  });
  ok('导演视角、机位视角、比例切换和播放均无机位取景框文字', frames);
  await page.evaluate(() => [...document.querySelectorAll('#inspector .ptabs button')].find(b => b.textContent === '截图').click()); await settle();
  ok('独立截图标签页仍可打开', await page.evaluate(() => document.querySelector('#inspector .ptabs .on').textContent === '截图'));
  await page.click('#stageTools [aria-label="截图"]');
  await page.waitForFunction(() => window.__app.shots.list.length > 0); await settle();
  ok('底部截图入口实际生成截图，并在独立标签页显示', await page.evaluate(() => window.__app.shots.list.at(-1).blob.size > 0 && !!document.querySelector('#inspector .shot-card')));

  await page.setViewport({ width: 540, height: 800 });
  await page.click('#scenePresets'); await settle();
  ok('窄屏浮层保持视口边距和小面板高度', await page.$eval('#scenePresetTray', n => { const r = n.getBoundingClientRect(); return r.left >= 12 && r.right <= innerWidth - 12 && r.top >= 12 && r.bottom <= innerHeight - 12 && r.height <= 360; }));
  await page.screenshot({ path: 'test-output/editor-ui/presets-narrow.png' });
  await page.click('#scenePresets'); await settle();
  ok('再次点击入口关闭浮层', !await page.$('#scenePresetTray'));
  await page.setViewport({ width: 1440, height: 810 });
  await page.evaluate(id => { const a = window.__app; a.emit('inspect', { id, section: 'move' }); window.__timelinePanel.setCollapsed(true); }, id); await settle();
  await page.click('.move-append'); await settle();
  await page.$eval('.move-clear', n => n.scrollIntoView({ block: 'nearest' })); await page.click('.move-clear'); await settle();
  ok('追加状态下清除运镜后恢复普通空状态', await page.evaluate(() => !document.querySelector('.move-append, .move-cancel') && document.querySelector('.move-heading > span').textContent === '运镜'));

}
