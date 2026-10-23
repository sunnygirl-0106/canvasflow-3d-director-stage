import fs from 'node:fs';
import { page, ok, errs } from '../harness.mjs';
import { settle, clickSel, mp4Info } from '../helpers.mjs';

const OUT = 'test-output/director';
export async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  await page.addStyleTag({ content: '#toast { visibility: hidden !important; }' });
  const seed = await page.evaluate(() => {
    const a = window.__app, d = a.exportDocument();
    return { doc: d, ready: a.ready, selected: a.selectedId, collapsed: window.__timelinePanel.collapsed, hist: a.history.entries.length };
  });
  const d = seed.doc, char = d.entities.find(e => e.type === 'character'), cam = d.entities.find(e => e.type === 'camera');
  ok('第五轮双人一机、无初始路径、10s/30fps、选中角色、时间轴关闭', seed.ready && d.entities.length === 3 && !!char && !!cam && d.timeline.duration === 10 && d.timeline.fps === 30 && d.timeline.mainCameraId === cam.id && d.scene.activeCameraId === cam.id && d.paths.length === 0 && !d.timeline.tracks.length && !d.constraints.length && seed.selected === char.id && seed.collapsed && seed.hist === 1);
  const calibration = [];
  for (const [width, height] of [[1440,900], [1920,1080], [1440,810]]) {
    await page.setViewport({ width, height }); await settle(160);
    calibration.push(await page.evaluate(async () => {
      const a = window.__app, V = a.stage.camera.position.constructor;
      const { worldBox } = await import('/src/util/measure.js');
      const b = worldBox(a.selected.root, { useBones: true }), c = b.getCenter(new V());
      const extent = camera => [b.min.y, b.max.y].map(y => (1 - new V(c.x, y, c.z).project(camera).y) / 2);
      const e = extent(a.stage.camera);
      return { viewport: [innerWidth, innerHeight], director: { height: e[0] - e[1], feet: e[0], pos: a.stage.camera.position.toArray(), target: a.rig.controls.target.toArray() }, camera: a.cameras[0].toJSON(), character: a.selected.toJSON() };
    }));
    await page.screenshot({ path: `${OUT}/director-${width}x${height}.png` });
  }
  fs.writeFileSync(`${OUT}/calibration.json`, JSON.stringify(calibration, null, 2));
  // 第五轮最新构图与 defaultview 同合同：机位 [0,2.2,10] 看向 [0,1.2,0]，FOV 50。
  // 旧的约43%来自调整注视高度前的画面，不再作为当前产品基线。
  ok('复验统一构图：全身入镜、脚底约63%，保留最新机位参数', calibration.every(x =>
    x.director.height >= .15 && x.director.height <= .22 && x.director.feet >= .61 && x.director.feet <= .65
    && x.camera.transform.pos.join() === '0,2.2,10' && x.camera.lookAt.join() === '0,1.2,0' && x.camera.fov === 50
    && x.director.pos.every((v, i) => Math.abs(v - x.camera.transform.pos[i]) < 1e-6)
    && x.director.target.every((v, i) => Math.abs(v - x.camera.lookAt[i]) < 1e-6)), JSON.stringify(calibration.map(x => x.director)));
  await page.setViewport({width:1440,height:900}); await settle();
  const preview = await page.evaluate(() => {
    const a = window.__app, before = JSON.stringify(a.store.document), sel = a.selectedId, hist = a.history.entries.length;
    a.startPreview();
    const immediate = a.getRenderCamera() === a.findCamera(a.timeline.mainCameraId).cam;
    a.playback.pause(); a.playback.seek(2);
    a.beforeRender();
    return { immediate, pause: !!a.preview && a.cameraView && !a.playback.playing && a.playback.time === 2, clean: a._cleanDepth === 1 && !a.pathOverlay.group.visible && !a.selection.ring.visible, stable: before === JSON.stringify(a.store.document) && sel === a.selectedId && hist === a.history.entries.length };
  });
  ok('播放首帧即机位，暂停保持画面，辅助物隐藏，文档/选择/撤销不变', Object.values(preview).every(Boolean), JSON.stringify(preview));
  await page.screenshot({path:`${OUT}/camera-paused.png`});
  const labels = await page.evaluate(async () => {
    const a = window.__app, c = a.selected;
    a.rename(c.id, '预览改名'); a.beforeRender();
    const renamed = a.labelSprites._items.get(c)?.text === '预览改名';
    a.rename(c.id, '角色A');
    const prop = await a.addCharacter('female'); a.beforeRender();
    const added = a.labelSprites._items.has(prop);
    a.remove(prop.id); a.beforeRender();
    const removed = !a.labelSprites._items.has(prop);
    a.select(c.id);
    return { renamed, added, removed };
  });
  ok('持续预览中名牌随重命名/新增/删除同步，不残留旧对象', Object.values(labels).every(Boolean), JSON.stringify(labels));
  const shot = await page.evaluate(async () => {
    const a = window.__app;
    const result = await a.shots.captureShot();
    const bitmap = await createImageBitmap(result.blob);
    const ratio = bitmap.width / bitmap.height; bitmap.close();
    return { ratio, clean: a._cleanDepth, preview: !!a.preview };
  });
  ok('预览截图使用有效画幅并恢复嵌套洁净状态', Math.abs(shot.ratio - 16/9) < .005 && shot.clean === 1 && shot.preview, JSON.stringify(shot));
  const ratios = await page.evaluate(async () => {
    const a = window.__app, V = a.stage.camera.position.constructor;
    const {worldBox}=await import('/src/util/measure.js');
    const b=worldBox(a.selected.root,{useBones:true}), c=b.getCenter(new V());
    const out=[];
    for (const ratio of ['16:9','9:16']) {
      a.setRatio(ratio); a.beforeRender(); a.stage.render();
      const cam=a.getRenderCamera(), lo=new V(c.x,b.min.y,c.z).project(cam), hi=new V(c.x,b.max.y,c.z).project(cam);
      out.push({ratio, aspect:cam.aspect, height:(hi.y-lo.y)/2, full:lo.y>=-1&&hi.y<=1, frame:a.rig.frameRect, viewport:a.viewportAspect(), hidden:getComputedStyle(a.rig.frameEl).display === 'none'});
    }
    return out;
  });
  ok('横竖导出设置均不改变普通播放的全视口 aspect，框和遮罩隐藏', ratios.every(r=>r.full&&r.height>=.15&&r.height<=.25&&Math.abs(r.aspect-r.viewport)<.001&&r.frame===null&&r.hidden),JSON.stringify(ratios));
  await page.screenshot({path:`${OUT}/camera-portrait.png`});
  await page.evaluate(()=>{const a=window.__app;a.setRatio('16:9');a.stopPreview();});
  ok('停止回0和导演编辑视角，洁净计数归零',await page.evaluate(()=>{const a=window.__app;return !a.preview&&!a.cameraView&&!a.timeline.active&&a.playback.time===0&&a._cleanDepth===0;}));
  await page.keyboard.press('Space'); await settle(100);
  ok('Space复用预览入口',await page.evaluate(()=>!!window.__app.preview&&window.__app.playback.playing));
  await page.click('#viewtabs [data-v="director"]');
  ok('导演标签暂停退出预览，拖播放头不强制切机位',await page.evaluate(()=>{const a=window.__app;a.playback.seek(3);return !a.preview&&!a.cameraView&&!a.playback.playing&&a._cleanDepth===0;}));
  const lifecycle=await page.evaluate(async()=>{
    const a=window.__app;
    a.startPreview();a.playback.pause();a.playback.loop=false;a.playback.seek(a.timeline.duration);a.playback.play();
    const restart=a.playback.time===0&&!!a.preview;
    a.playback.loop=true;a.playback._last-=11000;a.playback.update();
    const loop=!!a.preview&&a.playback.time<a.timeline.duration;
    a.playback.pause();a.playback.loop=false;
    a.playback.seek(9.9);a.playback.play();a.playback._last-=200;a.playback.update();
    const end=a.playback.time===10&&!a.playback.playing&&!!a.preview;
    const c2=a.addCamera('front_mid'); const main=a.timeline.mainCameraId;
    a.remove(main);const fallback=!a.playback.playing&&a.getRenderCamera()===c2.cam;
    a.remove(c2.id);const empty=!a.preview&&!a.cameraView&&!a.startPreview()&&!a.playback.playing&&a._cleanDepth===0;
    return {restart,loop,end,fallback,empty};
  });
  ok('末端重播/循环/自然结束/主机位删除回退/无机位拒绝',Object.values(lifecycle).every(Boolean),JSON.stringify(lifecycle));
  await page.evaluate(async doc=>{const a=window.__app;await a.loadDocument(doc,{applyView:true});a.select(doc.entities[0].id);a.history.reset();},d);
  const replaced = await page.evaluate(async doc => {
    const a = window.__app;
    a.startPreview();
    await a.loadDocument(doc);
    const camera = !!a.preview && !a.playback.playing && a.getRenderCamera() === a.cameras[0].cam && a._cleanDepth === 1;
    const { createEmptyDocument } = await import('/src/doc/schema.js');
    await a.loadDocument(createEmptyDocument());
    const empty = !a.preview && !a.cameraView && a._cleanDepth === 0 && a.entities.length === 0;
    await a.loadDocument(doc); a.select(doc.entities[0].id);
    return { camera, empty };
  }, d);
  ok('预览中导入暂停并解析新机位；导入空场景清理预览且不补seed', replaced.camera && replaced.empty, JSON.stringify(replaced));
  const frames=await page.evaluate(()=>{
    const a=window.__app,p=window.__timelinePanel;a.stopPreview();
    for(let i=0;i<30;i++)p.stepFrames(1);const forward=a.playback.time;
    for(let i=0;i<30;i++)p.stepFrames(-1);const back=a.playback.time;
    a.playback.seek(299/30); const display=p.transport.timeEl.textContent;
    a.timeline.setFps(24);a.timeline.setFps(25);a.timeline.setFps(60);a.timeline.setFps(30);
    a.timeline.setDuration(1.01);a.playback.seek(1);p.stepFrames(1);const edge=a.playback.time;
    a.timeline.setDuration(10);a.stopPreview();
    return {forward,back,display,edge,duration:a.timeline.duration};
  });
  ok('30次步进到1s再返回0；299帧显示9.97；非整帧终点夹取',frames.forward===1&&frames.back===0&&frames.display==='9.97'&&frames.edge===1.01&&frames.duration===10,JSON.stringify(frames));
  const track=await page.evaluate(()=>{const a=window.__app;window.__timelinePanel.setCollapsed(false);window.__timelinePanel.trackRows.expandedEnts.add(a.entities[0].id);const path=a.timeline.paths.find(p=>p.target===a.entities[0].id);if(path)a.timeline.removePath(path.id);const t=a.timeline.addTrack({target:a.entities[0].id,property:'pos'});a.timeline.setKey(t.id,0,[0,0,0]);a.timeline.setKey(t.id,4,[0.4,0,0]);a.timeline.setKey(t.id,10,[1,0,0]);a.history.capture();return t.id;});await settle();
  const coords=await page.evaluate(()=>{
    const p=window.__timelinePanel, r=p.scroll.getBoundingClientRect();
    p.setZoom(900);p.scroll.scrollLeft=3100;
    const t=p.clientXToTime(r.left+p.timeToX(4)-p.scroll.scrollLeft);
    return {t,pps:p.pps,scroll:p.scroll.scrollLeft};
  });
  ok('缩放与横滚共用坐标原点',Math.abs(coords.t-4)<1e-9&&coords.scroll>0,JSON.stringify(coords));
  await page.screenshot({path:`${OUT}/timeline-frames.png`});
  await page.evaluate(()=>{const p=window.__timelinePanel;p.seek(10);p.scroll.scrollLeft=p.content.clientWidth;});await settle();
  await page.screenshot({path:`${OUT}/timeline-end.png`});
  await page.evaluate(()=>{const p=window.__timelinePanel;p.setZoom(p._fitPps());p.scroll.scrollLeft=0;});
  await clickSel(`.tl-track[data-track="${track}"] .tl-label`);
  await clickSel('#timeline button[title^="移除选中"]'); await settle();
  const deleted=await page.evaluate(id=>!window.__app.timeline.tracks.some(t=>t.id===id),track);
  await page.evaluate(()=>window.__app.history.undo());
  ok('移除轨道保留实体，一步撤销恢复',deleted&&await page.evaluate(id=>window.__app.entities.length===3&&window.__app.timeline.tracks.some(t=>t.id===id),track));
  await page.evaluate(async doc=>{const a=window.__app;await a.loadDocument(doc);const c=a.cameras[0],pos=c.toJSON().transform.pos;a.timeline.addPath({target:c.id,points:[pos,[pos[0]+1,pos[1],pos[2]]],duration:10,orient:'keep'});a.history.capture();a.startPreview();},d);await settle(150);
  await page.screenshot({path:`${OUT}/moving.png`});
  const video=await page.evaluate(async()=>{
    const a=window.__app; a.playback.pause();a.playback.seek(2);
    const {exportVideo,renderFrames}=await import('/src/app/VideoExporter.js');
    const before=JSON.stringify(a.store.document), hist=a.history.entries.length;
    const abort=new AbortController();let cancelled=false;
    try {await renderFrames(a,{width:160,height:90,fps:30,range:[0,10],labels:false,signal:abort.signal},()=>abort.abort());}catch(e){cancelled=e.name==='AbortError';}
    let failed=false;
    try {await renderFrames(a,{width:160,height:90,fps:30,range:[0,1]},()=>{throw new Error('test failure');});}catch(e){failed=e.message==='test failure';}
    let last;
    const v=await exportVideo(a,{width:320,height:180,fps:30,range:[0,10],onProgress:(i)=>{last=(i-1)/30;}});
    return {bytes:Array.from(new Uint8Array(await v.blob.arrayBuffer())),frames:v.frames,last,cancelled,failed,restored:a._cleanDepth===1&&!!a.preview&&a.cameraView&&a.playback.time===2&&before===JSON.stringify(a.store.document)&&hist===a.history.entries.length};
  });
  const bytes=Buffer.from(video.bytes);fs.writeFileSync(`${OUT}/sample-10s-30fps.mp4`,bytes);const info=mp4Info(bytes);
  ok('10s/30fps视频300帧，末样本299/30；取消/失败恢复预览与文档',video.frames===300&&video.last===299/30&&video.cancelled&&video.failed&&video.restored&&info.frames===300,JSON.stringify({...video,bytes:undefined,info}));
  fs.writeFileSync(`${OUT}/video-info.json`,JSON.stringify({...video,bytes:undefined,info},null,2));
  // 已存在存档不会被新鲜启动覆盖；明确恢复仍保留旧场景。
  const saved=await page.evaluate(async()=>{const a=window.__app;a.stopPreview();a.timeline.setDuration(7);const text=JSON.stringify(a.exportDocument());localStorage.setItem('director-stage:autosave',text);return text;});
  await page.reload({waitUntil:'networkidle0'});await page.waitForFunction(()=>window.__app?.ready);await settle(1200);
  ok('刷新不累积对象、不覆盖旧存档',await page.evaluate(text=>window.__app.entities.length===3&&localStorage.getItem('director-stage:autosave')===text,saved));
  await page.evaluate(async text=>window.__app.loadDocument(JSON.parse(text)),saved);
  ok('旧双人场景恢复保留实体和7秒时长',await page.evaluate(()=>window.__app.entities.filter(e=>e.type==='character').length===2&&window.__app.timeline.duration===7));
  // 加载资源失败：不能 ready，遮罩阻止交互；解除故障后点击重试。
  let fail=true; const intercept=req=>{if(fail&&/\.glb(?:\?|$)/.test(req.url()))req.abort();else req.continue();};
  await page.setRequestInterception(true);page.on('request',intercept);
  const oldErrors=errs.length;
  await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('.startup button');
  await page.screenshot({path:`${OUT}/loading-error.png`});
  ok('资源失败不暴露半成品，提供重试',await page.evaluate(()=>!window.__app.ready&&window.__app.entities.length===0&&document.querySelector('#app').inert));
  const expected=errs.splice(oldErrors);ok('故障注入只产生预期资源错误',expected.every(e=>e.includes('ERR_FAILED')||e.includes('ERR_ABORTED')),expected.join(' | '));
  fail=false;await page.click('.startup button');await page.waitForFunction(()=>window.__app.ready);page.off('request',intercept);await page.setRequestInterception(false);
  ok('重试成功恢复完整默认场景',await page.evaluate(()=>window.__app.entities.length===3&&!document.querySelector('#app').inert));
}
