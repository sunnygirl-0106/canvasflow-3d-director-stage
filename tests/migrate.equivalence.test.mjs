import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { Timeline } from '../src/anim/Timeline.js';
import { Path, pathOptionsFor } from '../src/anim/Path.js';
import { Path as LegacyPath } from './migrate/legacyPath.js';
import { PathTrack as LegacyTrack } from './migrate/legacyPathTrack.js';
import * as legacyEdit from './migrate/legacypathGen.js';
import { remapSchedule } from '../src/anim/pathGen.js';
import { migrate, migratePath } from '../src/doc/migrate.js';
import { validate } from '../src/doc/schema.js';
import { cameraMotionState, motionSignature } from '../src/doc/cameraMotionState.js';
import { compileOps } from '../src/ai/apply.js';
const geometry = JSON.parse(fs.readFileSync(new URL('./fixtures/legGeom.json',import.meta.url)));
let maximum = 0;
function compare(a,b,label) {
  assert.equal(a.length,b.length,label);
  for(let i=0;i<a.length;i++) {
    const error=Math.abs(a[i]-b[i]); maximum=Math.max(maximum,error);
    assert.ok(error<=1e-6,`${label}: ${a[i]} vs ${b[i]}, error ${error}`);
  }
}
function runtime(doc,legacy) {
  const entities=doc.entities.map(json=>{
    const root=new THREE.Object3D();root.position.fromArray(json.transform.pos);root.rotation.set(...json.transform.rot.map(v=>v*Math.PI/180));root.scale.fromArray(json.transform.scale);
    const ent={id:json.id,name:json.name,type:json.type,root,children:[],baseScale:1,rootY0:0,height:1.7,roll:json.roll||0,values:{...json.pose?.values},legGeom:geometry[json.body||'male'],model:new THREE.Object3D(),standModelY:0,
      cam:new THREE.PerspectiveCamera(json.fov||40),docTransformOpts:()=>({posOffset:[0,0,0],scaleDiv:[1,1,1]}),update(){},applyPose(){this.model.position.y=0;},setFov(v){this.cam.fov=v;}};
    return ent;
  });
  const app={entities,store:{document:doc},findEntity:id=>entities.find(e=>e.id===id)};
  for(const json of doc.entities) if(json.parent) {const parent=app.findEntity(json.parent),child=app.findEntity(json.id);parent.children.push(child);parent.root.add(child.root);}
  const timeline=new Timeline(app);
  if(legacy) timeline._pathTrack=function(json){return this._rt(json,j=>new LegacyTrack(j,pathOptionsFor(app.findEntity(j.target).type)));};
  return {timeline,entities};
}
function sceneEqual(old,next,label) {
  const a=runtime(old,true),b=runtime(next,false);
  assert.deepEqual(a.entities.map(e=>[e.name,e.type]),b.entities.map(e=>[e.name,e.type]));
  for(let frame=0;frame<=Math.ceil(old.timeline.duration*120);frame++) {
    const t=Math.min(frame/120,old.timeline.duration);a.timeline.evaluate(t);b.timeline.evaluate(t);
    for(let i=0;i<a.entities.length;i++) {
      const x=a.entities[i],y=b.entities[i];
      compare([...x.root.position,...x.root.quaternion,...x.root.scale,x.cam.fov,x.model.position.y], [...y.root.position,...y.root.quaternion,...y.root.scale,y.cam.fov,y.model.position.y],`${label} ${x.name} @${t}`);
      assert.deepEqual(Object.keys(x.values),Object.keys(y.values));compare(Object.values(x.values),Object.values(y.values),`${label} joints @${t}`);
    }
  }
}
const base={points:[[0,0,0],[2,0,1],[4,0,0],[6,0,2]],closed:false,start:0,duration:4,speed:'smooth',orient:'tangent'};
const cases=[];
for(let i=0;i<3;i++) {
  const p={...base,interpolation:i===1?'polyline':'centripetal',speed:i===2?'linear':'smooth'};
  cases.push(p,{...p,stops:[1,2],...(i===1?{}:{stopTimes:[1,3]})},
    {...p,timedSegments:[{from:0,to:1,start:.25,end:1,speed:'linear'},{from:1,to:3,start:1.5,end:3.5,speed:'smooth'}]},
    {...p,waypointTimes:[0,.7,2.8,4],...(i===2?{stops:[2]}:{})});
}
cases.push({...base,stops:[1,2],stopTimes:[1,3],waypointTimes:[0,.7,2.8,4]});
cases.push({...base,points:[[0,0,0],[2,0,0],[2,0,2],[0,0,0],[0,0,4]],duration:4,timedSegments:[{from:0,to:3,start:0,end:2,closed:true},{from:3,to:4,start:2.5,end:4}]});
test('迁移：所有场景夹具与四类路径每类至少三例，120Hz 场景与关节等价且 JSON 往返一致',()=>{
  const template=JSON.parse(fs.readFileSync(new URL('./fixtures/round4-default.json',import.meta.url)));
  const docs=fs.readdirSync(new URL('./fixtures/',import.meta.url)).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(fs.readFileSync(new URL('./fixtures/'+f,import.meta.url)))).filter(d=>d.schema);
  for(const path of cases) {const doc=structuredClone(template);doc.paths=[{...path,id:'schedule-case',target:doc.entities.find(e=>e.type==='character').id}];doc.timeline.duration=4;docs.push(doc);}
  for(const [i,doc] of docs.entries()) {const next=migrate(doc);assert.deepEqual(validate(next).errors,[]);assert.deepEqual(migrate(JSON.parse(JSON.stringify(next))),next);sceneEqual(doc,next,`case ${i}`);}
});
test('旧 AI 单测全部 24 批 ops 的返回与 120Hz 场景求值保持一致',()=>{
  const records=JSON.parse(fs.readFileSync(new URL('./migrate/ai-cases.json',import.meta.url)));
  assert.equal(records.length,24);
  for(const [i,r] of records.entries()) {
    const actual=compileOps(migrate(r.base),r.ops,r.options);
    for(const key of ['errors','warnings','applied','renames']) assert.deepEqual(actual[key],r.result[key],`AI ${i} ${key}`);
    if(!r.result.errors.length) {assert.deepEqual(validate(actual.doc).errors,[]);sceneEqual(r.result.doc,actual.doc,`AI ${i}`);}
  }
});
test('插点、删点、反向、切换停顿和改时长与旧编辑实现逐帧等价',()=>{
  for(const path of cases) {
    const points=structuredClone(path.points);points.splice(1,0,points[0].map((v,i)=>(v+points[1][i])/2));
    const deletion=path.points.filter((_,i)=>i!==1),reverse=path.points.slice().reverse();
    const operations=[
      [{points,...legacyEdit.stopsAfterInsert(path,1)},{points},{map:i=>i>=1?i+1:i}],
      [{points:deletion,...legacyEdit.stopsAfterDelete(path,1)},{points:deletion},{map:i=>i===1?null:i>1?i-1:i}],
      [{points:reverse,...legacyEdit.stopsAfterReverse(path)},{points:reverse},{map:i=>path.points.length-1-i,reverse:true}],
      [legacyEdit.toggleStop(path,1,true),{},{stop:{index:1,on:true}}],
      [legacyEdit.toggleStop(path,1,false),{},{stop:{index:1,on:false}}],
      [{duration:6},{duration:6},{}],
    ];
    for(const [patch,newPatch,options] of operations) {
      const oldPath=legacyEdit.fitStops(path,{...path,...patch},patch),newPath=remapSchedule(migratePath(path),newPatch,options);
      const before=new LegacyPath(oldPath),after=new Path(newPath);
      const doc=JSON.parse(fs.readFileSync(new URL('./fixtures/round4-default.json',import.meta.url)));
      doc.paths=[{...oldPath,id:'edited-path',target:doc.entities.find(e=>e.type==='character').id}];doc.timeline.duration=6;
      const next=migrate(doc);next.paths=[{...newPath,id:'edited-path',target:doc.paths[0].target}];
      sceneEqual(doc,next,'edited timeline');
      for(let frame=0;frame<=720;frame++) {const t=frame/120;compare([before.distanceAt(t),before.speedAt(t),...before.positionAt(before.distanceAt(t))],[after.distanceAt(t),after.speedAt(t),...after.positionAt(after.distanceAt(t))],`edit ${JSON.stringify(patch)} @${t}`);}
    }
  }
});
test('迁移只刷新原来有效的运镜签名，失效的签名保持失效',()=>{
  const doc=JSON.parse(fs.readFileSync(new URL('./fixtures/round4-default.json',import.meta.url)));
  const id=doc.entities.find(e=>e.type==='camera').id;
  doc.meta.cameraMoves={[id]:{signature:motionSignature(doc,id),segments:[]}};
  const next=migrate(doc);assert.ok(cameraMotionState(next,id));assert.deepEqual(validate(next).errors,[]);
  doc.meta.cameraMoves[id].signature='stale';assert.equal(cameraMotionState(migrate(doc),id),null);
});
test.after(()=>console.log(`A1 maximum numerical error: ${maximum}`));
