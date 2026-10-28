import fs from 'node:fs';
import { page, ok } from '../harness.mjs';
import { settle, scr, dragPath, gizmoDrag, pickInOutliner } from '../helpers.mjs';
const OUT = 'test-output/round5-revision';
const snap = async name => { await page.mouse.move(450, 30); await settle(220); await page.screenshot({path:`${OUT}/${name}.png`}); };

export async function run() {
  fs.mkdirSync(OUT, {recursive:true});
  await page.evaluateOnNewDocument(() => {
    window.startupHandles = [];
    const sample = () => {
      const a = window.__app;
      if (a) window.startupHandles.push({ready:!!a.ready, visible:a.gizmo.visible, enabled:a.gizmo.control.enabled});
      if (!a?.ready || window.startupHandles.filter(s=>s.ready).length < 5) requestAnimationFrame(sample);
    }; requestAnimationFrame(sample);
  });
  await page.setViewport({width:1440,height:900});
  await page.reload({waitUntil:'networkidle0'}); await page.waitForFunction(()=>window.__app?.ready); await settle(300);
  const seed = await page.evaluate(()=>window.__app.exportDocument());
  ok('首帧到ready后均无可见/可拾取变换手柄', await page.evaluate(()=>window.startupHandles.length>0&&window.startupHandles.every(s=>!s.visible&&!s.enabled)));
  await snap('startup-no-gizmo');
  ok('默认导演视角显示机身、标签、视锥和导航', await page.evaluate(()=>{const a=window.__app,c=a.cameras[0];return c.body.visible&&c.helper.visible&&c.helper.geometry.drawRange.count>0&&c.labelEl.style.display!=='none'&&!!document.querySelector('#navsvg circle');}));
  const projections=[];
  for (const [width,height] of [[1440,900],[1920,1080]]) {
    await page.setViewport({width,height}); await settle();
    for (const ratio of ['16:9','9:16']) {
      await page.evaluate(r=>window.__app.setRatio(r),ratio);
      const result=await page.evaluate(async()=>{
        const a=window.__app,{worldBox}=await import('/src/util/measure.js');a.beforeRender();
        const cam=a.cameras[0].cam, director=a.stage.camera, V=director.position.constructor;
        const points=a.entities.filter(e=>e.type==='character').flatMap(e=>{const b=worldBox(e.root,{useBones:true}),c=b.getCenter(new V());return [c.clone().setY(b.min.y),c.clone().setY(b.max.y)];});
        const stable=points.map(p=>p.clone().project(director).toArray());
        a.setCameraView(true);a.beforeRender();
        const clean=a.cameras.every(c=>!c.body.visible&&!c.helper.visible);
        a.setCameraView(false);window.__timelinePanel.setCollapsed(false);a.beforeRender();
        return {position:director.position.toArray(),target:a.rig.controls.target.toArray(),fov:director.fov,cameraPosition:cam.getWorldPosition(new V()).toArray(),cameraTarget:a.cameras[0].lookTarget.toArray(),clean,restored:a.cameras[0].body.visible&&a.cameras[0].helper.visible,stable:JSON.stringify(stable)===JSON.stringify(points.map(p=>p.clone().project(director).toArray())),gizmo:a.gizmo.visible};
      });
      projections.push({width,height,ratio,...result});
      ok(`${width}×${height} ${ratio} 导演与机位独立、切换/时间轴不跳动且辅助元素恢复`,result.position.every((v,i)=>Math.abs(v-[2,3.2,13][i])<1e-6)&&result.target.join()==='0,0.8,3'&&result.fov===50&&result.cameraPosition.join()==='0,2.2,10'&&result.cameraTarget.join()==='0,1.2,0'&&result.clean&&result.restored&&result.stable&&!result.gizmo,JSON.stringify(result));
      if(ratio==='16:9') {
        await snap(`director-${width}x${height}`);
        await page.evaluate(()=>window.__app.setCameraView(true)); await snap(`camera-${width}x${height}`);
        await page.evaluate(()=>window.__app.setCameraView(false));
      }
      await page.evaluate(()=>window.__timelinePanel.setCollapsed(true));
    }
  }
  await page.setViewport({width:1440,height:900});
  const sync=await page.evaluate(()=>{
    const a=window.__app,c=a.cameras[0],director=a.stage.camera;
    const position=director.position.clone(),direction=director.quaternion.clone(),target=a.rig.controls.target.clone();
    c.lookTarget.y=-.9;c.aimAt(c.lookTarget);c.root.position.x=.3;c.setFov(55);a.edited(c);a.beforeRender();
    return {fov:director.fov,position:director.position.distanceTo(position),direction:director.quaternion.angleTo(direction),target:a.rig.controls.target.distanceTo(target),cameraChanged:c.fov===55&&c.root.position.x===.3&&c.lookTarget.y===-.9};
  });
  ok('机位位置/朝向/FOV修改不覆盖独立导演视角',sync.fov===50&&sync.position<1e-6&&sync.direction<1e-6&&sync.target<1e-6&&sync.cameraChanged,JSON.stringify(sync));
  const cameraBefore=await page.evaluate(()=>JSON.stringify(window.__app.cameras[0].toJSON()));
  await page.mouse.move(800,210);await page.mouse.down();await page.mouse.move(900,260,{steps:15});await page.mouse.up();await settle(800);
  const detached=await page.evaluate(before=>{
    const a=window.__app,c=a.cameras[0],p=a.stage.camera.position.clone(),q=a.stage.camera.quaternion.clone();const unchanged=JSON.stringify(c.toJSON())===before;
    c.lookTarget.y=-.71;c.aimAt(c.lookTarget);c.setFov(50);a.edited(c);a.beforeRender();
    return a.directorDetached&&unchanged&&p.distanceTo(a.stage.camera.position)<1e-8&&q.angleTo(a.stage.camera.quaternion)<1e-6;
  },cameraBefore);
  ok('真实环绕不写机位；后续机位编辑不覆盖观察视角',detached);
  await page.click('#navg');await settle();
  ok('reset恢复导演home，保留机位编辑',await page.evaluate(()=>{const a=window.__app;a.beforeRender();return a.directorDetached&&a.stage.camera.fov===50&&a.stage.camera.position.toArray().every((v,i)=>Math.abs(v-[2,3.2,13][i])<1e-6)&&a.rig.controls.target.toArray().join()==='0,0.8,3'&&a.cameras[0].root.position.x===.3&&a.cameras[0].lookTarget.y===-.71;}));
  const persistence=await page.evaluate(async seed=>{
    const a=window.__app;const d=a.exportDocument();await a.loadDocument(d,{applyView:true});const current=a.directorDetached&&JSON.stringify(a.exportDocument().meta.editorView)===JSON.stringify(d.meta.editorView)&&JSON.stringify(a.exportDocument().entities.filter(e=>e.type==='camera'))===JSON.stringify(d.entities.filter(e=>e.type==='camera'));
    const old=structuredClone(seed);delete old.meta.editorView.fov;const oldCam=JSON.stringify(old.entities.filter(e=>e.type==='camera'));
    await a.loadDocument(old,{applyView:true});const legacy=a.stage.camera.fov===40&&a.directorDetached&&JSON.stringify(a.exportDocument().entities.filter(e=>e.type==='camera'))===oldCam;
    a.stage.camera.fov=70;a.resetView();const home=a.stage.camera.fov===40;
    await a.loadDocument(seed,{applyView:true});return {current,legacy,home};
  },seed);
  ok('独立导演视角完整保存恢复；旧字段缺失40；机位不改写；home带FOV',Object.values(persistence).every(Boolean),JSON.stringify(persistence));
  await page.evaluate(()=>{const a=window.__app;a.select(a.entities[0].id,{activateTransform:false});a.withCleanRender(()=>a.stage.snapshot(a.cameras[0].cam,{width:160,height:90}));a.playback.seek(1);a.playback.stop();});
  await page.setViewport({width:1450,height:900});await settle();
  ok('恢复/截图结束/播放停止/resize不重新激活首屏手柄',await page.evaluate(()=>!window.__app.gizmo.visible&&!window.__app.gizmo.control.enabled));
  await page.setViewport({width:1440,height:900});await pickInOutliner('角色A');
  await page.evaluate(()=>{window.__app.history.reset();window.actorBefore=window.__app.selected.toJSON().transform.pos;});
  await gizmoDrag('x',.5);
  const drag=await page.evaluate(async()=>{const a=window.__app;const changed=Math.abs(a.selected.toJSON().transform.pos[0]-window.actorBefore[0])>.2;await a.history.undo();return {changed,restored:JSON.stringify(a.selected.toJSON().transform.pos)===JSON.stringify(window.actorBefore),enabled:a.gizmo.control.enabled};});
  ok('明确选择后真实拖动并一步撤销',drag.changed&&drag.restored&&drag.enabled,JSON.stringify(drag));
  await page.evaluate(()=>window.__app.select(null));
  ok('取消选择同步禁用隐藏手柄',await page.evaluate(()=>!window.__app.gizmo.visible&&!window.__app.gizmo.control.enabled));

  // 长度与场景总长矩阵经过UI公共提交入口，验证原子扩时、提示及终点。
  const timing=[];
  for(const total of [5,10,30]) for(const length of [1,8,20]) {
    const data=await page.evaluate(async({seed,total,length})=>{
      const a=window.__app;await a.loadDocument(seed,{applyView:true});a.timeline.setDuration(total);const e=a.entities[0];a.select(e.id);a.history.reset();
      const from=e.toJSON().transform.pos,to=[from[0]+length,from[1],from[2]];
      a.pathTool.begin('points',e);a.pathTool.draft=[from,to];a.pathTool.finish();const id=a.timeline.paths.find(p=>p.target===e.id).id;
      const p=a.timeline.paths.find(p=>p.id===id);a.history.capture();const one=a.history.entries.length===2;
      a.playback.seek(10);const endpoint=a.timeline.valueOf(e,'pos');const toast=document.querySelector('#toast').textContent;
      const result={total,length,start:p.start,duration:p.duration,scene:a.timeline.duration,one,endError:Math.hypot(...endpoint.map((v,i)=>v-to[i])),toast};
      await a.history.undo();result.undo=a.timeline.duration===total&&a.timeline.paths.length===0;
      await a.history.redo();a.emit('inspect',{id:e.id,section:'path'});window.__timelinePanel.setCollapsed(false);window.__timelinePanel.trackRows.expandedEnts.add(e.id);window.__timelinePanel.rebuild();return result;
    },{seed,total,length});
    timing.push(data);
    ok(`${length}m / ${total}s场景：0～10秒、终点正确、一步撤销总长`,data.start===0&&data.duration===10&&data.scene===Math.max(10,total)&&data.one&&data.undo&&data.endError<1e-5&&data.toast.includes('0–10 s'),JSON.stringify(data));
    if(total===10) await snap(`path-${length}m-10s`);
  }
  // 真实鼠标绘制五类路径，角色和机位各一次（重绘同样重置10秒）。
  for(const type of ['character','camera']) for(const mode of ['circle','line','rectangle','freehand','points']) {
    await page.evaluate(async({seed,type,mode})=>{
      const a=window.__app;await a.loadDocument(seed,{applyView:true});const e=a.entities.find(e=>e.type===type);a.select(e.id);a.directorDetached=true;
      a.rig.applyView(a.stage.camera.position.clone().set(0,12,20),a.rig.controls.target.clone().set(0,0,4),50);window.__timelinePanel.setCollapsed(true);
      a.timeline.addPath({target:e.id,points:[e.toJSON().transform.pos,[3,0,0]],duration:5.1});a.pathTool.begin(mode,e);
    },{seed,type,mode});await settle();
    const start=await page.evaluate(()=>window.__app.pathTool.start);
    const end=[start[0]+2,start[1],start[2]-2];
    if(mode==='freehand')await dragPath([await scr(start),await scr([start[0]+1,start[1],start[2]-1]),await scr(end)],{steps:10});
    else {await page.mouse.click(...await scr(end));if(mode==='points')await page.keyboard.press('Enter');}
    await settle();
    ok(`${type} ${mode}真实重绘为10秒`,await page.evaluate(()=>{const a=window.__app,p=a.timeline.paths[0];return !a.pathTool.mode&&p.start===0&&p.duration===10;}));
  }
  const extra=await page.evaluate(async seed=>{
    const a=window.__app;await a.loadDocument(seed,{applyView:true});const prop=a.addProp('box'),group=await a.addCrowd(1,2,1);
    const durations=[];for(const e of [prop,group]){a.select(e.id);a.pathTool.begin('points',e);const p=a.pathTool.start;a.pathTool.draft=[p,[p[0]+2,p[1],p[2]]];a.pathTool.finish();const id=a.timeline.paths.find(p=>p.target===e.id).id;durations.push(a.timeline.paths.find(p=>p.id===id).duration);}
    const e=a.entities.find(e=>e.type==='character');const old=a.timeline.addPath({target:e.id,points:[[0,0,0],[4,1,0]],duration:5.1,interpolation:'polyline'});
    a.select(e.id);a.pathOverlay.setSelectedPath(old.id);a.pathEditor.insertAt(old.id,1);const after=a.timeline.paths.find(p=>p.id===old.id);a.timeline.updatePath(old.id,{points:after.points.map(p=>[p[0]+1,p[1],p[2]])});
    const kept=a.timeline.paths.find(p=>p.id===old.id).duration===5.1;const doc=a.exportDocument();await a.loadDocument(doc);const loaded=a.timeline.paths.find(p=>p.id===old.id).duration===5.1;
    a.timeline.updatePath(old.id,{duration:6});const explicit=a.timeline.paths.find(p=>p.id===old.id).duration===6;
    const {setPath}=await import('/src/doc/edit.js');a.store.transact('显式AI业务时长',d=>setPath(d,e.id,[[0,0,0],[8,0,0]],{set:{duration:6}}));
    return {durations,kept,loaded,explicit,api:a.timeline.paths.find(p=>p.id===old.id).duration===6};
  },seed);
  ok('群众/道具10秒；旧5.1秒插点/移动/载入保持；显式6秒保持',extra.durations.every(x=>x===10)&&extra.kept&&extra.loaded&&extra.explicit&&extra.api,JSON.stringify(extra));
  const exported=await page.evaluate(async seed=>{
    const a=window.__app;await a.loadDocument(seed,{applyView:true});const e=a.entities[0];a.select(e.id);a.pathTool.begin('points',e);a.pathTool.draft=[[0,0,0],[1,0,0]];a.pathTool.finish();
    const samples=[];for(let i=0;i<60;i++){a.playback.seek(i/6);samples.push(JSON.stringify({pos:a.timeline.valueOf(e,'pos'),pose:e.values}));}
    const {renderFrames}=await import('/src/app/VideoExporter.js');let index=0,match=true;
    await renderFrames(a,{width:160,height:90,fps:6,range:[0,10],labels:false},()=>{match&&=samples[index]===JSON.stringify({pos:a.timeline.valueOf(e,'pos'),pose:e.values});index++;});
    a.playback.seek(10);return {match,index,end:a.timeline.valueOf(e,'pos')};
  },seed);
  ok('1m短路径离线导出与逐帧跳转一致，第10秒抵达终点',exported.match&&exported.index===60&&Math.abs(exported.end[0]-1)<1e-6,JSON.stringify(exported));
  fs.writeFileSync(`${OUT}/measurements.json`,JSON.stringify({projections,timing,sync,persistence,drag,extra,exported},null,2));
}
