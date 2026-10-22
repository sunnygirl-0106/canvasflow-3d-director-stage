import fs from 'node:fs';
import { page, ok } from '../harness.mjs';
import { settle, clickSel } from '../helpers.mjs';
const OUT = 'test-output/round3';
export async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const states = [];
  const shot = async name => {
    await settle(100);
    states.push(await page.evaluate(name => {
      const a = window.__app, camera = a.getRenderCamera(), v = a.stage.viewport;
      return { name, camera: { position: camera.getWorldPosition(camera.position.clone()).toArray(), target: a.cameraView ? a.cameras[0]?.toJSON().lookAt : a.rig.controls.target.toArray(), fov: camera.fov }, viewport: [v.clientWidth, v.clientHeight], selected: a.selectedId, time: a.playback.time, view: a.cameraView ? 'camera' : 'director' };
    }, name));
    await page.screenshot({ path: `${OUT}/${name}.png` });
  };
  for (const [width, height] of [[1920,1080], [1440,900], [1440,810]]) {
    await page.setViewport({width,height});
    await page.evaluate(() => { const a=window.__app;a.stopPreview();a.setCameraView(false);a.select(a.entities.find(e=>e.type==='character').id); });
    await shot(`single-director-${width}x${height}`);
    await page.evaluate(() => {const a=window.__app;a.select(a.cameras[0].id);a.setCameraView(true);});
    await shot(`single-camera-${width}x${height}`);
  }
  await page.setViewport({width:1920,height:1080});
  for (const type of ['character','camera']) {
    await page.evaluate(type=>{const a=window.__app;a.setCameraView(false);a.select(a.entities.find(e=>e.type===type).id);},type);
    for (const label of type==='character'?['属性','姿势','运动轨迹']:['属性','运动轨迹','截图']) {
      const index=await page.evaluate(label=>[...document.querySelectorAll('.ptabs button')].findIndex(e=>e.textContent===label),label);
      await clickSel(`.ptabs button:nth-child(${index+1})`);await shot(`${type}-${label}`);
      ok(`${type} ${label} tab visible`,await page.evaluate(label=>document.querySelector('.ptabs button.on')?.textContent===label,label));
    }
  }
  await page.evaluate(()=>window.__app.select(null)); await shot('scene-panel');
  await page.evaluate(()=>{document.querySelector('.side.right').scrollTop=10000;});await shot('scene-background');
  // Deterministic provider: real agent/compile/load lifecycle, explicit 4.8m meeting scene.
  await page.evaluate(async()=>{
    const a=window.__app,p=window.__aiPanel;
    const {MockProvider}=await import('/src/ai/provider.js');
    p.agent.setProvider(new MockProvider([{match:'迎面相遇',reply:{ops:[
      {op:'clear'},
      {op:'add_character',name:'蓝',body:'male',pos:[-2.4,0,0],yaw:90},
      {op:'add_character',name:'红',body:'female',pos:[2.4,0,0],yaw:-90},
      {op:'add_camera',name:'主机位',pos:[0,1.6,7],lookAt:[0,.9,0],fov:48},
      {op:'set_path',target:'蓝',path:{kind:'points',points:[[-2.4,0,0],[-.75,0,0]]},duration:6},
      {op:'set_path',target:'红',path:{kind:'points',points:[[2.4,0,0],[.75,0,0]]},duration:6},
      {op:'timeline',duration:6,mainCamera:'主机位'}
    ]}}]));
    await p._run({input:'迎面相遇',mode:'generate',image:null});
    a.select(a.entities.find(e=>e.type==='character').id);
  });
  ok('生成成功进入继续对话、成功卡片隐藏、导演视角',await page.evaluate(()=>window.__app.entities.filter(e=>e.type==='character').length===2&&window.__aiPanel.continuing&&!window.__app.cameraView&&document.querySelector('.ai-result').hidden));
  await shot('ai-success');
  await clickSel('.ai-history-head button:last-child');await shot('ai-history');
  await clickSel('.ai-history-head button:last-child');
  await shot('pair-director');
  fs.writeFileSync(`${OUT}/meeting-scene.json`,JSON.stringify(await page.evaluate(()=>window.__app.exportDocument()),null,2));
  for (const [width,height] of [[1920,1080],[1440,900],[1440,810]]) {
    await page.setViewport({width,height});await settle(100);
    for (const t of [0,1.5,3,4.5,6]) {
      const bounds=await page.evaluate(async t=>{
        const a=window.__app; a.setCameraView(true);a.playback.seek(t);a.beforeRender();
        const {worldBox}=await import('/src/util/measure.js');const V=a.stage.camera.position.constructor,cam=a.getRenderCamera();cam.updateMatrixWorld();
        return a.entities.filter(e=>e.type==='character').map(e=>{const b=worldBox(e.root,{useBones:true}).expandByScalar(.1);const points=[];for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){const p=new V(x,y,z).project(cam);points.push([p.x,p.y,p.z]);}return points;});
      },t);
      ok(`${width}x${height} 双人 ${t}s 头脚与两侧不裁切`,bounds.flat().every(p=>Math.abs(p[0])<.95&&Math.abs(p[1])<.95&&p[2]<1));
      await shot(`pair-camera-${width}-${t}`);
    }
  }
  await page.setViewport({width:1920,height:1080});
  await page.evaluate(()=>{const a=window.__app;a.playback.seek(0);a.startPreview();});await shot('pair-playing');
  await page.evaluate(()=>window.__app.playback.pause());await shot('pair-paused');
  await page.evaluate(()=>{const a=window.__app;a.stopPreview();a.select(a.cameras[0].id);});await shot('camera-track-selected');
  await page.evaluate(()=>window.__app.select(null));await shot('camera-track-unselected');
  await page.evaluate(()=>{const p=window.__aiPanel;p.textarea.value='草稿保留';});
  await clickSel('.ai-history-head button:first-child');
  ok('退出继续对话保留草稿',await page.evaluate(()=>window.__aiPanel.textarea.value==='草稿保留'&&!window.__aiPanel.continuing));
  await page.evaluate(() => window.__timelinePanel.setCollapsed(false));
  for (const [name,selector] of [
    ['transform-menu','#dock button:first-child'], ['add-character','#sideRail button[title^="添加角色"]'],
    ['add-camera','#sideRail button[title^="添加机位"]'], ['add-prop','#sideRail button[title="选择画幅比例"]'],
    ['assets','#sideRail button[title^="全景"]'], ['scene-actions','#sceneActions button'],
    ['path-menu','.tl-head .tl-addkey']
  ]) { await clickSel(selector); await shot(name); await page.keyboard.press('Escape'); await page.click('#viewtabs [data-v="director"]'); }
  await clickSel('.tl-export');await shot('export-dialog');await page.keyboard.press('Escape');
  await page.evaluate(()=>{const p=window.__aiPanel;p.showSettings=true;p.toggle(true);});await shot('ai-settings');
  await page.evaluate(()=>{const p=window.__aiPanel;p.showSettings=false;p.openPresets();});await shot('ai-presets');
  await page.evaluate(()=>window.__aiPanel.toggle(false));
  await page.evaluate(()=>window.__timelinePanel.toggleCollapsed());await shot('timeline-collapsed');
  await page.evaluate(()=>window.__timelinePanel.toggleCollapsed());await shot('timeline-expanded');
  const modify = await page.evaluate(async()=>{
    const a=window.__app,p=window.__aiPanel;
    const {MockProvider}=await import('/src/ai/provider.js');
    const before=a.stage.camera.position.toArray().join();
    p.agent.setProvider(new MockProvider([{match:'改名',reply:{ops:[{op:'set_pose',target:'蓝',preset:'wave'}]}}]));
    await p._run({input:'改名',mode:'modify',image:null});
    return {same:before===a.stage.camera.position.toArray().join(),mode:p.effectiveMode,ok:p.agent.turns.at(-1).status==='ok'};
  });
  ok('继续对话默认修改，修改不改变导演视角',modify.ok&&modify.same&&modify.mode==='modify');
  await clickSel('.ai-history-head button:last-child');
  ok('历史恢复失败不提前标记已撤销', await page.evaluate(async () => {
    const a = window.__app, panel = window.__aiPanel, turn = panel.agent.turns.at(-1);
    const undo = a.history.undo;
    try {
      a.history.undo = async () => false;
      await panel._undoTurn(turn);
      return !turn.undone && !turn.undoing;
    } finally { a.history.undo = undo; }
  }));
  const undos=await page.$$('.ai-undo');await undos.at(-1).evaluate(n=>n.scrollIntoView({block:'center'}));await shot('history-before-undo');await undos.at(-1).click();await settle(150);
  ok('历史当前轮撤销可达并恢复姿势',await page.evaluate(()=>window.__app.exportDocument().entities.find(e=>e.name==='蓝').pose.preset!=='wave'));
  await shot('history-undo');
  await page.evaluate(()=>{const p=window.__aiPanel;p.continuing=false;p.showHistory=false;p.toggle(false);const a=window.__app;for(const c of [...a.cameras])a.remove(c.id);a.startPreview();});
  await shot('no-camera');
  fs.writeFileSync(`${OUT}/states.json`,JSON.stringify(states,null,2));
}
