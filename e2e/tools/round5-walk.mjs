// 真实离线导出：可在第五轮修改前后的检出中执行，同一场景、同一镜头、同一输出参数。
import fs from 'node:fs';
import * as h from '../harness.mjs';
const out = process.argv[2] || 'test-output/round5/walk-after';
fs.mkdirSync(out, { recursive: true });
await h.openApp();
await h.page.setViewport({width:1440,height:900});
const result = await h.page.evaluate(async () => {
  const a = window.__app;
  const { createEmptyDocument } = await import('/src/doc/schema.js');
  const { setPath } = await import('/src/doc/edit.js');
  const { WALK_PACE } = await import('/src/anim/pathGen.js');
  const { GAIT_CYCLES_PER_SECOND } = await import('/src/anim/Locomotion.js');
  const { exportVideo } = await import('/src/app/VideoExporter.js');
  const doc=createEmptyDocument(); doc.timeline.duration=8;
  await a.loadDocument(doc);
  const characters=[];
  for (const [index,body] of ['male','female','slim','broad'].entries()) {
    const e=await a.addCharacter(body); e.root.position.x=-4; e.root.position.z=(index-1.5)*2;
    a.edited(e); a.rename(e.id, {male:'男性素体',female:'女性素体',slim:'纤细素体',broad:'宽厚素体'}[body]); characters.push(e);
  }
  a.store.transact('行走比较', draft => {
    for(const e of characters) {
      const pos=draft.entities.find(x=>x.id===e.id).transform.pos;
      setPath(draft,e.id,[pos,[4,pos[1],pos[2]]]);
    }
  });
  a.stage.camera.position.set(9,8,16);a.rig.controls.target.set(0,.8,0);a.rig.controls.update();
  const camera=a.addCamera('current');a.timeline.setMainCamera(camera.id);a.setRatio('16:9');
  const times=[0,.1,.8,1.5,3,5.6,6.7,8];
  const sample=t=>{a.timeline.evaluate(t);return characters.map(e=>({pos:a.timeline.valueOf(e,'pos'),pose:{...e.values}}));};
  const sequential=times.map(sample);
  const deterministic=[...times].reverse().every(t=>JSON.stringify(sample(t))===JSON.stringify(sequential[times.indexOf(t)]));
  const data={pace:WALK_PACE,cycles:GAIT_CYCLES_PER_SECOND,deterministic,durations:a.timeline.paths.map(p=>p.duration),camera:camera.toJSON(),samples:sequential};
  a.stopPreview();
  const video=await exportVideo(a,{width:960,height:540,fps:24,range:[0,8],labels:true});
  const url=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(video.blob);});
  return {url,data};
});
fs.writeFileSync(`${out}/walk.mp4`,Buffer.from(result.url.split(',')[1],'base64'));
fs.writeFileSync(`${out}/metrics.json`,JSON.stringify(result.data,null,2));
console.log(JSON.stringify({pace:result.data.pace,cycles:result.data.cycles,durations:result.data.durations,deterministic:result.data.deterministic,errors:h.errs}));
await h.close(h.errs.length?1:0);
