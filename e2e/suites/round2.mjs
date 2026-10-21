import fs from 'node:fs';
import { PNG } from 'pngjs';
import { page, ok } from '../harness.mjs';
import { settle, clickSel } from '../helpers.mjs';

const OUT = 'test-output/round2';
const rects = () => Object.fromEntries(['#viewport', '#stageTools', '#dock', '.ai-capsule', '#timeline', '.side.left', '.side.right'].map(s => [s, document.querySelector(s).getBoundingClientRect().toJSON()]));

export async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  await page.addStyleTag({ content: '#toast { visibility:hidden!important }' });
  const measurements = [];
  for (const [width, height] of [[1920,1080], [1440,900], [1440,810]]) {
    await page.setViewport({ width, height }); await settle(200);
    const ui = await page.evaluate(rects);
    measurements.push({ width, height, rects: ui });
    const v = ui['#viewport'], d = ui['#dock'], a = ui['.ai-capsule'];
    ok(`${width}×${height} 工具组居中且无重叠，视口顶部为0`, Math.abs((d.left + a.right)/2 - (v.left+v.right)/2) < 1 && a.left > d.right && d.left >= v.left && a.right <= v.right && v.top === 0);
    await page.screenshot({ path: `${OUT}/layout-${width}x${height}.png` });
  }
  const big = measurements[0].rects;
  const expected = { left: 329*1920/2048, right: 1718*1920/2048, timeline: 830*1080/1152, dockX:813*1920/2048, dockY:770*1080/1152, aiX:972*1920/2048 };
  const errors = { left: big['#viewport'].left-expected.left, right: big['#viewport'].right-expected.right, timeline: big['#timeline'].top-expected.timeline, dockX:big['#dock'].left-expected.dockX, dockY:big['#dock'].top-expected.dockY, aiX:big['.ai-capsule'].left-expected.aiX };
  ok('1920 基准主要边界和工具胶囊位置误差≤2 CSS px', Object.values(errors).every(n=>Math.abs(n)<=2), JSON.stringify(errors));
  const controls = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#dock > button')];
    return { three:btns.length===3 && btns[1].title==='截图' && btns[2].title.startsWith('时间轴'), empty:document.querySelector('.ai-send').disabled, hidden:document.querySelector('.ai-details').hidden, placeholder:document.querySelector('.ai-text').placeholder, rows:document.querySelectorAll('.tl-track').length };
  });
  ok('默认仅移动/截图/时间轴；AI单行空输入禁发送；无空位置子行', controls.three && controls.empty && controls.hidden && controls.placeholder==='描述想搭建的场景' && controls.rows===0);
  for (const selector of ['#sideRail button[title^="添加角色"]', '#sideRail button[title="添加道具"]', '#sideRail button[title^="添加机位"]', '#sideRail button[title^="全景"]', '#sceneActions button']) {
    await clickSel(selector); await settle(40);
    ok(`${selector} 菜单可见且锚点在屏幕内`, await page.evaluate(() => { const r=document.querySelector('.dockmenu.open')?.getBoundingClientRect();return r&&r.width>100&&r.left>=0&&r.top>=0&&r.bottom<=innerHeight; }));
    await page.click('#viewtabs [data-v="director"]');
  }
  // 草稿、IME 与全局快捷键隔离。
  await page.type('.ai-text', '保留草稿');
  const draft = await page.evaluate(() => {
    const p=window.__aiPanel, a=window.__app, count=a.entities.length;
    const before=a.playback.time;
    p.textarea.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));
    for(const key of [' ','ArrowRight','Delete'])p.textarea.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));
    p.toggle(true);p.toggle(false);
    return p.textarea.value==='保留草稿'&&!a.ai.busy&&!a.playback.playing&&a.playback.time===before&&a.entities.length===count;
  });
  ok('草稿跨展开保留，中文组合态Enter不发送，输入不触发舞台快捷键', draft);
  await page.setViewport({width:1920,height:1080});
  await page.screenshot({path:`${OUT}/ai-input.png`});
  // 忙碌/取消/失败均走原 agent；明确使用测试 provider，不调用真实模型。
  await page.evaluate(async () => {
    const {MockProvider}=await import('/src/ai/provider.js');
    const p=window.__aiPanel;
    p.agent.setProvider(new MockProvider([{match:'保留草稿',reply:{ops:[{op:'rename',target:'角色A',name:'新角色'}]}}],{delayMs:5000}));
    p.send();
  });
  await settle(80); await page.screenshot({path:`${OUT}/ai-busy.png`});
  ok('生成中发送变取消且输入禁用', await page.evaluate(()=>window.__app.ai.busy&&document.querySelector('.ai-send').getAttribute('aria-label')==='取消生成'&&document.querySelector('.ai-text').disabled));
  await clickSel('.ai-send');
  await page.waitForFunction(()=>!window.__app.ai.busy);
  ok('取消生成不改场景',await page.evaluate(()=>window.__app.entities.some(e=>e.name==='角色A')));
  await page.evaluate(()=>{ const p=window.__aiPanel;p.agent.setProvider({configured:true,chat:async()=>{throw new Error('测试连接失败');}});p.textarea.value='失败时保留';p.send(); });
  await page.waitForFunction(()=>!window.__app.ai.busy);await settle(60);
  ok('失败保留草稿并提供重试',await page.evaluate(()=>document.querySelector('.ai-text').value==='失败时保留'&&document.querySelector('.ai-result').textContent.includes('重试')));
  await page.screenshot({path:`${OUT}/ai-error.png`});
  await page.evaluate(()=>{const p=window.__aiPanel;p.agent.turns.length=0;p.textarea.value='';p.render();});

  for (const name of ['reference-standing','bench-seated']) {
    const doc=JSON.parse(fs.readFileSync(`e2e/fixtures/${name}.json`,'utf8'));
    await page.evaluate(async doc=>{const a=window.__app;a.stopPreview();await a.loadDocument(doc);a.setRatio('auto');a.setCameraView(true);a.playback.seek(0);},doc);
    await settle(150);
    const before=await page.evaluate(rects);
    const state=await page.evaluate(()=>{const a=window.__app; a.beforeRender();a.stage.render(); return {projection:a.getRenderCamera().projectionMatrix.toArray(),ground:a.stage.groundGroup.visible,grid:a.stage.grid.visible,labels:a.labels.debugRects().filter(x=>!x.text.startsWith('机位'))};});
    await page.screenshot({path:`${OUT}/${name}-before.png`});
    await page.evaluate(()=>{const a=window.__app;a.startPreview({play:false});a.beforeRender();a.stage.render();});
    await settle(60);await page.screenshot({path:`${OUT}/${name}-paused.png`});
    const after=await page.evaluate(rects);
    const preview=await page.evaluate(()=>{const a=window.__app;return {projection:a.getRenderCamera().projectionMatrix.toArray(),ground:a.stage.groundGroup.visible,grid:a.stage.grid.visible,aspect:a.getRenderCamera().aspect,viewport:a.viewportAspect(),frame:a.rig.frameRect,hidden:getComputedStyle(a.rig.frameEl).display==='none',scissor:a.stage.renderer.getScissorTest(),labels:a.labelSprites.debugRects(a.getRenderCamera(),a.stage.viewport.clientWidth,a.stage.viewport.clientHeight)};});
    ok(`${name} 播放前后所有布局边界完全一致、同时间同机位投影不变`,JSON.stringify(before)===JSON.stringify(after)&&JSON.stringify(state.projection)===JSON.stringify(preview.projection));
    ok(`${name} 全视口无框/遮罩/留边，地面网格不变`,preview.hidden&&preview.frame===null&&!preview.scissor&&preview.aspect===preview.viewport&&state.ground===preview.ground&&state.grid===preview.grid);
    const labelDelta=state.labels.map(a=>{const b=preview.labels.find(b=>b.text===a.text);return b?Math.max(Math.abs(a.h-b.h),Math.abs(a.y-b.y),Math.abs(a.w-b.w),Math.abs(a.x-b.x)):Infinity;});
    ok(`${name} 播放名牌位置和字号变化≤2px`,labelDelta.every(n=>n<=2),JSON.stringify(labelDelta));
    await page.evaluate(()=>window.__app.startPreview());await settle(200);
    await page.screenshot({path:`${OUT}/${name}-playing.png`});await page.evaluate(()=>window.__app.playback.pause());
    await page.setViewport({width:1440,height:810});await settle(100);
    ok(`${name} 暂停后resize仍铺满视口`,await page.evaluate(()=>Math.abs(window.__app.getRenderCamera().aspect-window.__app.viewportAspect())<1e-9));
    await page.setViewport({width:1920,height:1080});await settle(100);
    await page.evaluate(()=>{const a=window.__app;a.setRatio('9:16');a.stopPreview();});
    ok(`${name} 退出恢复显式编辑取景框`,await page.evaluate(()=>window.__app.rig.ratio===9/16&&window.__app.rig.frameRect!==null));
  }
  await page.evaluate(()=>{const a=window.__app;a.setRatio('auto');a.setCameraView(true);a.playback.seek(0);});await settle(100);
  await page.screenshot({path:`${OUT}/final.png`});
  const styles=await page.evaluate(()=>Object.fromEntries(['#dock','.ai-input','.tl-head','.tl-presence','.tl-clock','.tl-key','.label3d'].map(s=>{const e=document.querySelector(s),c=e&&getComputedStyle(e);return[s,c?{radius:c.borderRadius,font:c.fontSize,height:c.height,color:c.color,background:c.backgroundColor}:null];})));
  fs.writeFileSync(`${OUT}/measurements.json`,JSON.stringify({measurements,expected,errors,styles},null,2));
  comparison();
}

// 同尺寸参考与实际 UI 裁区；3D 舞台不参与差异比较。
function comparison() {
  const source=PNG.sync.read(fs.readFileSync('docs/references/director-round2-02.png'));
  const current=PNG.sync.read(fs.readFileSync(`${OUT}/final.png`));
  const ref=new PNG({width:1920,height:1080});
  for(let y=0;y<1080;y++)for(let x=0;x<1920;x++){
    const from=(Math.min(source.height-1,Math.floor(y*source.height/1080))*source.width+Math.min(source.width-1,Math.floor(x*source.width/1920)))*4;
    source.data.copy(ref.data,(y*1920+x)*4,from,from+4);
  }
  fs.writeFileSync(`${OUT}/reference-1920x1080.png`,PNG.sync.write(ref));
  for(const [name,x,y,w,h] of [['sidebar',0,0,309,778],['dock-ai',752,712,416,66],['transport',0,778,354,41],['tracks',0,819,700,240],['views',850,0,220,65]]){
    const paired=new PNG({width:w*2,height:h}),overlay=new PNG({width:w,height:h}),diff=new PNG({width:w,height:h});
    PNG.bitblt(ref,paired,x,y,w,h,0,0);PNG.bitblt(current,paired,x,y,w,h,w,0);
    for(let j=0;j<h;j++)for(let i=0;i<w;i++)for(let c=0;c<4;c++){
      const src=((y+j)*1920+x+i)*4+c,dst=(j*w+i)*4+c;
      overlay.data[dst]=c===3?255:Math.round((ref.data[src]+current.data[src])/2);
      diff.data[dst]=c===3?255:Math.abs(ref.data[src]-current.data[src]);
    }
    fs.writeFileSync(`${OUT}/${name}-compare.png`,PNG.sync.write(paired));
    fs.writeFileSync(`${OUT}/${name}-overlay.png`,PNG.sync.write(overlay));
    fs.writeFileSync(`${OUT}/${name}-diff.png`,PNG.sync.write(diff));
  }
}
