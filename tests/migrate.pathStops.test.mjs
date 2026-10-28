// The former stop editing cases now assert the one schedule representation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remapSchedule, markedSchedule } from '../src/anim/pathGen.js';
import { Path, WALK_RAMP, oldFields } from './migrate/pathModel.js';
import { migratePath } from '../src/doc/migrate.js';
import { createEmptyDocument, validate } from '../src/doc/schema.js';
import { stopEntries, motionEntries, scheduleSegments } from '../src/anim/schedule.js';
const PTS = [[0,0,0],[2,0,0],[2,0,3],[5,0,3],[5,0,6]];
const P = (extra = {}) => migratePath({ id:'pth00001',target:'prp00001',points:PTS,closed:false,start:0,duration:8,speed:'smooth',orient:'tangent',...extra });
const marks = path => stopEntries(path).map(entry => entry.i);
const times = path => stopEntries(path).map(entry => entry.t);
function docWith(path) {
  const doc = createEmptyDocument();
  doc.entities.push({type:'prop',id:'prp00001',name:'方块',kind:'box',color:'#888888',visible:true,transform:{pos:[0,0,0],rot:[0,0,0],scale:[1,1,1]}});
  doc.paths.push(path);
  return validate(doc).errors;
}
test('时刻表校验：默认、停顿、闭合合法；下标、顺序、时刻、端点错误均定位', () => {
  for (const extra of [{},{stops:[1,3]},{stops:[1,3],stopTimes:[2,6]},{stops:[]},{closed:true,stops:[4]}]) assert.deepEqual(docWith(P(extra)),[]);
  const valid=P({stops:[1,3],stopTimes:[2,6]});
  for (const mutate of [
    s=>{s[1].i=0;},s=>{s[1].i=4;},s=>{s[1].i=3;s[2].i=2;},s=>{s[1].i=1.5;},
    s=>{s[1].t=undefined;},s=>{s[2].t=8;},s=>{s[1].t=5;s[2].t=3;},s=>{s[0].t=1;},s=>{s.pop();},
  ]) {
    const bad=structuredClone(valid);mutate(bad.schedule);
    assert.ok(docWith(bad).some(error=>error.startsWith('paths[0].schedule')),JSON.stringify(bad));
  }
});
test('重排：顶点数变化清除标记、时长缩放、平移保留、显式清除与默认字段', () => {
  const old=P({stops:[1,3],stopTimes:[2,6]});
  assert.deepEqual(times(remapSchedule(old,{duration:4})),[1,3]);
  assert.deepEqual(marks(remapSchedule(old,{points:PTS.slice(0,4)})),[]);
  assert.deepEqual(marks(remapSchedule(old,{points:PTS.map(p=>[p[0]+1,0,p[2]])})),[1,3]);
  const none=remapSchedule(old,{schedule:markedSchedule(old)});
  assert.deepEqual(marks(none),[]);assert.equal(none.schedule.length,2);
  assert.deepEqual(Object.keys(remapSchedule(P(),{})),Object.keys(P()));
});
test('闭合改为开放成对移除末顶点标记，不修改输入', () => {
  const old=P({closed:true,stops:[1,4],stopTimes:[2,6]}),before=structuredClone(old);
  const fitted=remapSchedule(old,{closed:false,duration:4});
  assert.deepEqual(marks(fitted),[1]);assert.deepEqual(times(fitted),[1]);
  fitted.schedule[1].i=2;fitted.schedule[1].t=3;assert.deepEqual(old,before);
});
test('显式时刻表覆盖顶点数变化，不重复缩放；深拷贝保护 patch', () => {
  const old=P({stops:[1,3],stopTimes:[2,6]});
  const patch={points:PTS.slice(0,4),duration:4};
  patch.schedule=markedSchedule({...old,...patch},[2],[3]);
  const before=structuredClone(patch),fitted=remapSchedule(old,patch);
  assert.deepEqual(marks(fitted),[2]);assert.deepEqual(times(fitted),[3]);
  fitted.schedule[1].i=1;fitted.schedule[1].t=2;assert.deepEqual(patch,before);
});
test('缩放后失效的到达时刻回到路程分配，保留有效标记', () => {
  const old=P({stops:[1,3],stopTimes:[2,6]});
  for (const invalid of [[0,3],[1,4],[3,1],[2,2],[NaN,3],[1,Infinity]]) {
    let at=0;
    const fitted=remapSchedule(old,{duration:4},{roundTime:()=>invalid[at++ % 2]});
    assert.deepEqual(marks(fitted),[1,3]);assert.equal(fitted.schedule[0].allocation,'distance');
    assert.deepEqual(docWith(fitted),[]);
  }
});
test('插入、删除、反向、切换停顿保持原索引、时刻与到达位置', () => {
  const p=P({stops:[1,3],stopTimes:[2,6]});
  const inserted=PTS.slice();inserted.splice(2,0,[2,0,1]);
  assert.deepEqual(marks(remapSchedule(p,{points:inserted},{map:i=>i>=2?i+1:i})),[1,4]);
  const removed=remapSchedule(p,{points:PTS.filter((_,i)=>i!==1)},{map:i=>i===1?null:i>1?i-1:i});
  assert.deepEqual(marks(removed),[2]);assert.deepEqual(times(removed),[6]);
  assert.deepEqual(marks(remapSchedule(p,{points:PTS.filter((_,i)=>i!==2)},{map:i=>i===2?null:i>2?i-1:i})),[1,2]);
  const reversed=remapSchedule(p,{points:PTS.slice().reverse()},{map:i=>4-i,reverse:true});
  assert.deepEqual(marks(reversed),[1,3]);assert.deepEqual(times(reversed),[2,6]);
  assert.deepEqual(marks(remapSchedule(P({stops:[1]}),{points:PTS.slice().reverse()},{map:i=>4-i,reverse:true})),[3]);
  assert.deepEqual(marks(remapSchedule(P(),{},{stop:{index:2,on:true}})),[2]);
  const on=remapSchedule(p,{},{stop:{index:2,on:true}});
  assert.deepEqual(marks(on),[1,2,3]);assert.ok(times(on)[1]>2&&times(on)[1]<6);
  const model=new Path(p);assert.ok(Math.abs(model.distanceAt(times(on)[1])-model.vertexDistance(2))<.01);
  const off=remapSchedule(on,{},{stop:{index:2,on:false}});
  assert.deepEqual(marks(off),[1,3]);assert.deepEqual(times(off),[2,6]);
});
test('节点和带间隙的区间分别缩放，保留输入与全部时刻', () => {
  for (const timing of [{waypointTimes:[0,1,3,5,8]}, {timedSegments:[
    {from:0,to:2,start:0,end:3,speed:'linear'},{from:2,to:4,start:5,end:8,speed:'smooth'},
  ]}]) {
    const old=P(timing),before=structuredClone(old),fitted=remapSchedule(old,{duration:4});
    if(timing.waypointTimes) assert.deepEqual(motionEntries(fitted).map(e=>e.t),[0,.5,1.5,2.5,4]);
    else assert.deepEqual(scheduleSegments(fitted).map(s=>[s.from,s.to,s.start,s.end,s.curve]),[[0,2,0,1.5,'linear'],[2,4,2.5,4,'smooth']]);
    fitted.schedule[1].t=0;assert.deepEqual(old,before);
  }
});
test('顶点数变化清除旧时刻表，显式时刻表（含空数组）保持原样', () => {
  for(const timing of [{waypointTimes:[0,1,3,5,8]},{timedSegments:[{from:0,to:4,start:0,end:8}]}]) {
    const old=P(timing),geometry={points:PTS.slice(0,3),duration:4};
    const fitted=remapSchedule(old,geometry);
    assert.equal(fitted.schedule[0].curve,'smooth');assert.equal(fitted.schedule[0].segmented,undefined);
    for(const schedule of [[],[{i:0,t:0,curve:'cubic',baseCurve:'smooth'},{i:1,t:1},{i:2,t:4}]]) {
      const result=remapSchedule(old,{...geometry,schedule});assert.deepEqual(result.schedule,schedule);
      if(!schedule.length) assert.ok(docWith(result).length);
    }
  }
});
test('分段停顿拆分与合并保留外侧时刻，重复操作与输出修改不影响输入', () => {
  const path=P({points:[[0,0,0],[1,0,0],[2,0,0],[3,0,0]],interpolation:'polyline',start:10,timedSegments:[{from:0,to:3,start:0,end:8,speed:'linear'}]});
  const before=structuredClone(path),split=remapSchedule(path,{},{stop:{index:1,on:true}});
  const expected=[{from:0,to:1,start:0,end:2.666667,speed:'smooth'},{from:1,to:3,start:2.666667,end:8,speed:'smooth'}];
  assert.deepEqual(oldFields(split).timedSegments,expected);
  for(const index of [1,3]) assert.deepEqual(remapSchedule(split,{},{stop:{index,on:index===1}}).schedule,split.schedule);
  for(const [index,on] of [[0,true],[1,false]]) assert.deepEqual(remapSchedule(path,{},{stop:{index,on}}).schedule,path.schedule);
  assert.deepEqual(oldFields(remapSchedule(split,{},{stop:{index:1,on:false}})).timedSegments,[{from:0,to:3,start:0,end:8,speed:'smooth'}]);
  split.schedule[1].t=0;assert.deepEqual(path,before);
});
test('普通停顿重复操作保持完整时刻表；移除最后停顿回到端点', () => {
  const path=P({stops:[1,3],stopTimes:[2,6]}),before=structuredClone(path);
  assert.deepEqual(remapSchedule(path,{},{stop:{index:1,on:true}}),path);
  assert.deepEqual(remapSchedule(path,{},{stop:{index:2,on:false}}),path);
  const empty=remapSchedule(P({stops:[1],stopTimes:[2]}),{},{stop:{index:1,on:false}});
  assert.deepEqual(marks(empty),[]);assert.equal(empty.schedule.length,2);assert.deepEqual(path,before);
});
test('角色起步：ramp 秒内加到匀速，之后匀速；首尾速度 0、终点 = 全长、位移连续；机位（ramp=0）仍整段 smoothstep', () => {
  const json = { points: [[0, 0, 0], [13, 0, 0]], closed: false, start: 1, duration: 10, speed: 'smooth' };
  const P = new Path(json, { ramp: WALK_RAMP }), C = new Path(json);
  const V = 13 / (10 - WALK_RAMP);
  assert.equal(P.speedAt(1), 0);
  assert.ok(Math.abs(P.speedAt(1 + WALK_RAMP) - V) < 1e-9);
  assert.ok(Math.abs(P.speedAt(6) - V) < 1e-9);
  assert.ok(Math.abs(P.distanceAt(11) - 13) < 1e-9 && Math.abs(P.distanceAt(6) - 6.5) < 1e-9);
  let prev = 0;
  for (let i = 1; i <= 4000; i++) { // 数值导数 ≈ speedAt（C¹，无跳变）
    const t = 1 + i / 400, d = P.distanceAt(t);
    assert.ok(Math.abs((d - prev) * 400 - P.speedAt(t - 1 / 800)) < 1e-3);
    prev = d;
  }
  assert.ok(Math.abs(C.distanceAt(6) - 6.5) < 1e-9 && Math.abs(C.speedAt(6) - 1.5 * 1.3) < 1e-9);
  // 有 stops 时每段同样 ramp
  const S = new Path({ ...json, points: [[0, 0, 0], [6.5, 0, 0], [13, 0, 0]], stops: [1] }, { ramp: WALK_RAMP });
  assert.ok(S.speedAt(6) < 1e-12);
  assert.ok(Math.abs(S.speedAt(1 + WALK_RAMP) - 6.5 / (5 - WALK_RAMP)) < 1e-9);
});
