import fs from 'node:fs';
import * as h from '../harness.mjs';
const out='test-output/round5';
await h.openApp();
await h.page.setViewport({width:1440,height:900});
const seed=await h.page.evaluate(()=>window.__app.exportDocument());
await h.page.evaluate(()=>{const a=window.__app;a.select(a.cameras[0].id);a.setCameraView(true);});
await h.page.mouse.move(450,30);
await h.page.screenshot({path:`${out}/camera-parameters.png`});
const camera=await h.page.evaluate(()=>{
 const a=window.__app,c=a.cameras[0];const direction=c.cam.getWorldDirection(c.root.position.clone());
 return {json:c.toJSON(),direction:direction.toArray(),image:a.withCleanRender(()=>a.stage.snapshot(c.cam,{width:960,height:540})).toDataURL()};
});
fs.writeFileSync(`${out}/camera-view.png`,Buffer.from(camera.image.split(',')[1],'base64'));delete camera.image;
h.ok('主机位前向平行[0,-2.91,-10]',Math.abs(camera.direction[0])<1e-7 && Math.abs(camera.direction[1]+2.91/Math.hypot(2.91,10))<1e-7 && Math.abs(camera.direction[2]+10/Math.hypot(2.91,10))<1e-7);
const cases=await h.page.evaluate(async seed=>{
 const a=window.__app,panel=window.__timelinePanel;
 const {Path,pathOptionsFor}=await import('/src/anim/Path.js');
 const results={};
 await a.loadDocument(seed);a.setCameraView(false);a.select(a.entities[0].id);
 const ent=a.entities[0];
 const path=a.timeline.addPath({target:ent.id,points:[[-3,0,0],[-1,1,-2],[1,2,1],[3,1,-1]],start:1,duration:8,orient:'tangent'});
 panel.setCollapsed(false);panel.trackRows.expandedEnts.add(ent.id);panel.rebuild();
 a.playback.seek(3);const old=new Path(a.timeline.paths[0],pathOptionsFor('character'));const sample=old.positionAt(old.distanceAt(3));
 a.startPreview();a.pathEditor.selectNode({ kind: 'path', sourceId: path.id, index: 0 });
 const node=a.pathOverlay.selVertex,next=new Path(a.timeline.paths[0],pathOptionsFor('character'));
 const inserted=next.positionAt(next.distanceAt(a.playback.time));
 results.playingCurve={paused:!a.playback.playing,editView:!a.cameraView,selected:node.index,sampleError:sample.distanceTo(inserted),time:a.playback.time,noPos:!a.timeline.tracks.some(t=>t.property==='pos')};
 const before=JSON.stringify(a.timeline.paths);a.playback.seek(0);a.pathEditor.selectNode({ kind: 'path', sourceId: path.id, index: 0 });
 results.outsideUnchanged=JSON.stringify(a.timeline.paths)===before;
 a.playback.seek(4);a.emit('inspect',{id:ent.id,section:'path'});
 // 同步浮点到达时间和高亮，不用显示舍入伪造命中。
 results.currentTime=next.vertexTime(node.index);
 const data=a.exportDocument({view:false});await a.loadDocument(data);a.playback.seek(4);
 const snap=JSON.stringify(a.timeline.valueOf(a.entities[0],'pos'));a.playback.seek(2);a.playback.seek(4);
 results.seekStable=snap===JSON.stringify(a.timeline.valueOf(a.entities[0],'pos'));
 // 群众路径使用组局部坐标，不给成员独立创建路径。
 a.stopPreview();const crowd=await a.addCrowd(1,2,1.2);crowd.root.position.set(3,0,-2);crowd.root.rotation.y=.7;a.edited(crowd);
 const groupPath=a.timeline.addPath({target:crowd.id,points:[[3,0,-2],[5,1,-4]],duration:5,orient:'keep'});
 a.playback.seek(2);const gp=a.timeline.valueOf(crowd,'pos');a.timeline.translatePathTo(crowd,[gp[0]+1,gp[1]+2,gp[2]-1]);
 results.groupPoints=a.timeline.paths.find(p=>p.id===groupPath.id).points;
 try {a.timeline.addPath({target:crowd.members[0].id,points:[[0,0,0],[1,0,0]]});results.memberBlocked=false;}catch{results.memberBlocked=true;}
 return results;
},seed);
h.ok('播放中曲线插点锁定时刻、暂停并显示新控制点',cases.playingCurve.paused&&cases.playingCurve.editView&&cases.playingCurve.selected===1&&cases.playingCurve.sampleError<.001&&cases.playingCurve.noPos,JSON.stringify(cases.playingCurve));
h.ok('路径范围外不插点；跳转确定',cases.outsideUnchanged&&cases.seekStable);
h.ok('组路径局部平移，禁止群众成员独立路径',JSON.stringify(cases.groupPoints)==='[[4,2,-3],[6,3,-5]]'&&cases.memberBlocked);
const old=JSON.parse(fs.readFileSync('e2e/fixtures/round4-default.json','utf8'));
const oldCamera=await h.page.evaluate(async old=>{const a=window.__app;await a.loadDocument(old);return a.exportDocument().entities.filter(e=>e.type==='camera');},old);
h.ok('旧文件机位参数不改写',JSON.stringify(oldCamera)===JSON.stringify(old.entities.filter(e=>e.type==='camera')));
fs.writeFileSync(`${out}/extra-checks.json`,JSON.stringify({camera,cases},null,2));
await h.finish();
