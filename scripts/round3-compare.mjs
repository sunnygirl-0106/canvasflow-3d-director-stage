import fs from 'node:fs';
import { PNG } from 'pngjs';
const out='test-output/round3';
const load=p=>PNG.sync.read(fs.readFileSync(p));
const source=load('docs/references/director-round3-competitor.png');
const current=load(`${out}/scene-panel.png`);
const reference=new PNG({width:1920,height:1080});
for(let y=0;y<1080;y++)for(let x=0;x<1920;x++){
  const i=(Math.min(source.height-1,Math.floor(y*source.width/1920))*source.width+Math.floor(x*source.width/1920))*4;
  source.data.copy(reference.data,(y*1920+x)*4,i,i+4);
}
const regions=[['left',0,0,309,778],['right',1612,0,308,778],['dock-ai',700,650,600,128],['transport',0,778,365,42],['tracks',0,820,1500,240]];
for(const [name,x,y,w,h] of regions){
  const pair=new PNG({width:w*2,height:h});
  PNG.bitblt(reference,pair,x,y,w,h,0,0);PNG.bitblt(current,pair,x,y,w,h,w,0);
  fs.writeFileSync(`${out}/${name}-compare.png`,PNG.sync.write(pair));
}
const samples={sidebar:[100,350,'#181818'],panel:[1900,750,'#212121'],timeline:[1300,1050,'#2a2a2a']};
const report={referenceSize:[source.width,source.height],outputSize:[1920,1080],note:'参考按宽度等比缩放，底部不足区域延用最后一行；原图高2100物理像素，无法据此验收完整1080 CSS高的布局。参考与实际场景不同，裁区用于检查 UI 灰阶和结构，不作为 3D 或对象内容像素一致证据。',samples:{}};
for(const [name,[x,y,target]] of Object.entries(samples)){
 const values=[[],[],[]];for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++)for(let c=0;c<3;c++)values[c].push(current.data[((y+dy)*1920+x+dx)*4+c]);
 const median=values.map(v=>v.sort((a,b)=>a-b)[24]);const expected=target.slice(1).match(/../g).map(x=>parseInt(x,16));
 report.samples[name]={median,target,delta:median.map((v,i)=>v-expected[i])};
}
fs.writeFileSync(`${out}/color-comparison.json`,JSON.stringify(report,null,2));

const files=fs.readdirSync(out).filter(f=>f.endsWith('.png')).sort();
fs.writeFileSync(`${out}/gallery.html`, `<!doctype html><meta charset="utf-8"><title>第三轮验收截图</title><style>body{background:#181818;color:#eee;font:14px system-ui;margin:24px}section{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}img{width:100%}a{color:#ccc}figure{margin:0}figcaption{padding:8px}</style><h1>第三轮实测截图</h1><p>场景、视角、时间与机位参数见 states.json。裁区对比左为参考，右为实际；不同场景的 3D 内容不作像素对齐结论。</p><section>${files.map(f=>`<figure><a href="${f}"><img loading="lazy" src="${f}"></a><figcaption>${f}</figcaption></figure>`).join('')}</section>`);
