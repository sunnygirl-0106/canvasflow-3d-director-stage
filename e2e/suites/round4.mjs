import fs from 'node:fs';
import { page, ok } from '../harness.mjs';
import { settle, scr, dragPath } from '../helpers.mjs';
const OUT = 'test-output/round4';
export async function run() {
  fs.mkdirSync(OUT, {recursive:true});
  const shot = async name => { await settle(100); await page.screenshot({path:`${OUT}/${name}.png`}); };
  const seed = await page.evaluate(() => {
    const a=window.__app;
    window.__seed=a.exportDocument();
    return {n:a.entities.length,paths:a.timeline.toJSON().paths.length,collapsed:window.__timelinePanel.collapsed,h:document.querySelector('#timeline').offsetHeight,playing:a.playback.playing,handles:a.pathOverlay._items.reduce((n,i)=>n+i.vertices.length,0)};
  });
  ok('新鲜双人无路径、不自动播放、无控制点、时间轴零高度',seed.n===3&&seed.paths===0&&seed.collapsed&&seed.h===0&&!seed.playing&&seed.handles===0,JSON.stringify(seed));
  for(const [width,height] of [[2048,1120],[1440,900],[1440,810]]) { await page.setViewport({width,height});await shot(`initial-${width}x${height}`); }
  const ids=await page.evaluate(()=>window.__app.entities.map(e=>e.id));
  const initial=await page.evaluate(()=>JSON.stringify(window.__app.store.document));
  await page.click('#dock button:last-child');await shot('timeline');
  ok('三主行默认折叠，开合不改文档',await page.evaluate(before=>document.querySelectorAll('.tl-head').length===3&&document.querySelectorAll('.tl-track').length===0&&JSON.stringify(window.__app.store.document)===before,initial));
  await page.click(`.tl-head[data-ent="${ids[1]}"] .tl-addkey`);await shot('path-menu');
  ok('菜单打开不启动工具、不改变选择',await page.evaluate(id=>!window.__app.pathTool.mode&&window.__app.selectedId===id,ids[0]));
  await page.keyboard.press('Escape');
  ok('菜单取消文档逐字相同',await page.evaluate(before=>JSON.stringify(window.__app.store.document)===before,initial));
  await page.evaluate(()=>window.__app.startPreview());
  await page.click(`.tl-head[data-ent="${ids[1]}"] .tl-addkey`);
  await page.keyboard.press('Escape');
  ok('播放中打开/取消菜单不暂停，导演页签保持且继续临时出画',await page.evaluate(()=>window.__app.playback.playing&&!window.__app.cameraView&&window.__app.preview&&!window.__app.pathTool.mode));
  await page.evaluate(()=>window.__app.stopPreview());
  const projection=await page.evaluate(()=>{
    const a=window.__app,c=a.cameras[0];a.beforeRender();const before=c._viz.far,far=c.cam.far,g=c.helper.geometry;
    c.setFov(65);a.beforeRender();
    return {before,far:far===c.cam.far,fov:c._viz.fov,aspect:c._viz.aspect===c.cam.aspect,geometry:g===c.helper.geometry,width:2*c._viz.far*Math.tan(c._viz.fov*Math.PI/360)*c._viz.aspect};
  });await shot('frustum-fov65');
  ok('视锥延伸主体、同步FOV/aspect、不改变真实far或重建几何',projection.before>.5&&projection.far&&projection.fov===65&&projection.aspect&&projection.geometry,JSON.stringify(projection));
  await page.evaluate(()=>{window.__app.startPreview();});await shot('playback-clean');
  ok('播放画面隐藏视锥',await page.evaluate(()=>window.__app.cameras.every(c=>!c.helper.visible)));
  await page.evaluate(()=>window.__app.playback.pause());
  ok('暂停恢复导演视角及主机位视锥',await page.evaluate(()=>!window.__app.cameraView&&!window.__app.preview&&window.__app.cameras.some(c=>c.helper.visible)));
  await page.evaluate(()=>window.__app.stopPreview());
  const presetBefore = await page.evaluate(() => {
    window.__aiPanel.textarea.value = '保留这份草稿';
    return JSON.stringify(window.__app.store.document);
  });
  await page.click('#scenePresets');await shot('presets');
  await page.focus('.ai-preset'); await page.keyboard.press('Space');
  ok('托盘Space不启动播放',await page.evaluate(()=>!window.__app.playback.playing));
  await shot('preset-draft');
  ok('预制卡片只改变预览选择，保留草稿和场景且不请求模型', await page.evaluate(before => {
    const panel = window.__aiPanel;
    return panel.textarea.value === '保留这份草稿' && panel.browsePresets && !!panel.pendingPreset
      && document.querySelectorAll('.ai-preset[aria-pressed="true"]').length === 1
      && !window.__app.ai.busy && JSON.stringify(window.__app.store.document) === before;
  }, presetBefore));
  ok('选中预制后显示明确的创建按钮与替换场景提示', await page.evaluate(() => {
    const footer = document.querySelector('.scene-preset-footer');
    return footer.querySelector('.primary').textContent === '创建' && !footer.querySelector('.primary').disabled && footer.textContent.includes('将替换当前场景');
  }));
  await page.keyboard.press('Escape');
  ok('取消预制保留当前文档和草稿', await page.evaluate(before => !document.querySelector('#scenePresetTray')
    && window.__aiPanel.textarea.value === '保留这份草稿' && JSON.stringify(window.__app.store.document) === before, presetBefore));
  for(const title of ['添加角色','添加机位','全景图','选择画幅比例']) {
    await page.click(`#sideRail button[title^="${title}"]`);await shot(`nav-${title}`);await page.mouse.click(800,80);
  }
  const importBefore = await page.evaluate(()=>JSON.stringify({draft:window.__aiPanel.textarea.value,mode:window.__aiPanel.mode,image:window.__aiPanel.image,doc:window.__app.store.document}));
  const [cancelChooser] = await Promise.all([page.waitForFileChooser(),page.click('#sideRail button[title="识图导入"]')]);
  await cancelChooser.cancel();
  ok('识图取消不污染草稿、模式、附件或场景',await page.evaluate(before=>JSON.stringify({draft:window.__aiPanel.textarea.value,mode:window.__aiPanel.mode,image:window.__aiPanel.image,doc:window.__app.store.document})===before,importBefore));
  const [imageChooser] = await Promise.all([page.waitForFileChooser(),page.click('#sideRail button[title="识图导入"]')]);
  await imageChooser.accept([`${OUT}/initial-1440x810.png`]);
  await page.waitForFunction(()=>window.__aiPanel.mode==='image'&&!!window.__aiPanel.image);
  await shot('image-import');
  ok('识图入口实际压缩附图、保持草稿、不自动请求',await page.evaluate(()=>window.__aiPanel.image.startsWith('data:image/jpeg')&&window.__aiPanel.textarea.value.length>0&&!window.__app.ai.busy));
  await page.evaluate(()=>{const p=window.__aiPanel;p.image=null;p.mode='generate';p.toggle(false);});
  ok('六项导航',await page.$$eval('#sideRail button',bs=>bs.length===6&&bs[5].title==='识图导入'));
  await page.evaluate(()=>{const a=window.__app;a.directorDetached=true;a.rig.controls.target.set(0,0,0);a.stage.camera.position.set(0,8,8);a.rig.controls.update();});
  // 路径替换用例显式创建自己的路径，不依赖已取消的双路径启动场景。
  await page.evaluate(id=>{const a=window.__app;a.timeline.addPath({target:id,points:[[.7,0,0],[1,0,-1]],duration:5});},ids[1]);
  for (const [mode,label] of [['circle','圆环路径'],['line','直线路径'],['rectangle','矩形路径'],['freehand','铅笔路径'],['points','钢笔路径']]) {
    await page.click(`.tl-head[data-ent="${ids[1]}"] .tl-addkey`);
    await page.evaluate(label=>[...document.querySelectorAll('.ctx-item')].find(e=>e.textContent===label).click(),label);
    const prior = await page.evaluate(()=>JSON.stringify(window.__app.timeline.toJSON()));
    ok(`${label}锁定点击行对象`,await page.evaluate(id=>window.__app.pathTool.ent?.id===id,ids[1]));
    if(mode==='freehand') await dragPath([await scr([.7,0,0]),await scr([1.3,0,-.5]),await scr([1.8,0,-1])],{steps:12});
    else { await page.mouse.click(...await scr(mode==='circle'?[1.7,0,0]:[2,0,-1.5]));if(mode==='points')await page.keyboard.press('Enter'); }
    await settle(120);await shot(`path-${mode}`);
    ok(`${label}完成`,await page.evaluate(()=>!window.__app.pathTool.mode));
    const persistence = await page.evaluate(async (before) => {
      const a=window.__app, after=JSON.stringify(a.timeline.toJSON());
      await a.history.undo(); const undo=JSON.stringify(a.timeline.toJSON())===before;
      await a.history.redo(); const redo=JSON.stringify(a.timeline.toJSON())===after;
      const doc=a.exportDocument(); await a.loadDocument(doc);
      return undo&&redo&&JSON.stringify(a.timeline.toJSON())===after;
    },prior);
    ok(`${label}一步撤销、重做、保存往返`,persistence);
  }
  const roundtrip=await page.evaluate(async()=>{const a=window.__app;const d=a.exportDocument();await a.loadDocument(d);return JSON.stringify(d.paths)===JSON.stringify(a.exportDocument().paths);});
  ok('路径导入导出保留',roundtrip);
  fs.writeFileSync(`${OUT}/camera-parameters.json`,JSON.stringify(await page.evaluate(()=>({director:window.__app.stage.camera.position.toArray(),seed:window.__seed})),null,2));
}
