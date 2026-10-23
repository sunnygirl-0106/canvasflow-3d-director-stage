// Run independently: node e2e/tools/motion-performance.mjs. Same viewport/backend as baseline.json.
import fs from 'node:fs';
import { openApp, page, close, errs } from '../harness.mjs';
import { settle } from '../helpers.mjs';
await openApp();
await page.evaluate(async () => {
  const a = window.__app, e = await a.addCharacter('male');
  const points = Array.from({ length: 100 }, (_, i) => [i / 10, Math.sin(i / 10), Math.cos(i / 10)]);
  const p = a.timeline.addPath({ target: e.id, points, start: 0, duration: 10, speed: 'linear', orient: 'keep' });
  a.select(e.id); a.pathOverlay.setSelectedPath(p.id);
  window.perfPath = p.id;
});
const overlay = await page.evaluate(async () => {
  const a = window.__app, p = a.timeline.paths.find(p => p.id === window.perfPath), points = p.points;
  const rev = a.store.revision, times = [], frames = []; let last = performance.now(); const start = last;
  const before = { ...a.stage.renderer.info.memory };
  await new Promise(resolve => { function frame() {
    const now = performance.now(); frames.push(now - last); last = now;
    const t = performance.now(); a.pathOverlay.setPreview(p.id, points.map((v, i) => i === 50 ? [v[0], v[1] + Math.sin(now / 500), v[2]] : v)); times.push(performance.now() - t);
    if (now - start < 5000) requestAnimationFrame(frame); else resolve();
  } requestAnimationFrame(frame); });
  a.pathOverlay.clearPreview();
  return { times, frames, commits: a.store.revision - rev, before, after: { ...a.stage.renderer.info.memory } };
});
await page.evaluate(() => {
  const a = window.__app;
  a.rig.applyView(a.stage.camera.position.clone().set(10,12,15), a.rig.controls.target.clone().set(5,0,0), 42);
  a.pathEditor.selectNode({ kind: 'path', sourceId: window.perfPath, index: 50 });
});
await settle();
const pts = await page.evaluate(() => {
  const a = window.__app; a.stage.render(); const h = a.gizmo.translateHandle('y');
  const p = h.position.clone(); p.y += .4 * h.scale.x;
  const q = p.clone(); q.y += 1;
  const r = a.stage.renderer.domElement.getBoundingClientRect();
  return [p,q].map(v => { v.project(a.stage.camera); return [r.left+(v.x+1)/2*r.width,r.top+(1-v.y)/2*r.height]; });
});
await page.mouse.move(...pts[0]);
await page.evaluate(() => {
  const a = window.__app, ed = a.pathEditor;
  const perf = window.motionPerf = { times: [], frames: [], rev: a.store.revision, revisions: [], before: { ...a.stage.renderer.info.memory }, done: false };
  const preview = ed.preview.bind(ed);
  ed.preview = () => { const t = performance.now(); preview(); perf.times.push(performance.now()-t); perf.revisions.push(a.store.revision); };
  let last = performance.now();
  const frame = now => { perf.frames.push(now-last); last=now; if (!perf.done) requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
});
await page.mouse.down();
const start = Date.now();
while (Date.now() - start < 5000) {
  const t = (Date.now()-start)/5000;
  await page.mouse.move(pts[0][0] + (pts[1][0]-pts[0][0])*t, pts[0][1] + (pts[1][1]-pts[0][1])*t);
  await new Promise(resolve => setTimeout(resolve, 30));
}
const held = await page.evaluate(() => ({ drag: !!window.__app.pathEditor.drag, candidate: !!window.__app.pathOverlay._preview }));
await page.mouse.up(); await settle();
const full = await page.evaluate(async () => {
  const a = window.__app, p = window.motionPerf; p.done = true; p.after = { ...a.stage.renderer.info.memory }; p.commits = a.store.revision-p.rev;
  p.resources = [];
  for (let i=0;i<12;i++) {
    a.pathOverlay.setSelectedPath(null); a.pathEditor.selectNode({ kind:'path',sourceId:window.perfPath,index:50 }); a.stage.render();
    p.resources.push({ ...a.stage.renderer.info.memory });
    await new Promise(requestAnimationFrame);
  }
  const source = a.timeline.paths.find(p => p.id === window.perfPath), model = a.pathOverlay.pathOf(source.id);
  for (let i=0;i<30;i++) a.playback.seek(i/3);
  p.playbackModelStable = model === a.pathOverlay.pathOf(source.id);
  return p;
});
const stats = xs => { xs.sort((a,b)=>a-b); return { n:xs.length,p50:xs[Math.floor(xs.length*.5)],p95:xs[Math.floor(xs.length*.95)],max:xs.at(-1),over50:xs.filter(x=>x>50).length }; };
for (const p of [overlay,full]) { p.update=stats(p.times); delete p.times; p.frames=stats(p.frames); }
full.previewCommitCount = new Set(full.revisions).size - 1; delete full.revisions;
const result = { renderer:'headless Chrome SwiftShader',viewport:[1440,810],overlay,full,held,errors:errs };
fs.mkdirSync('test-output/motion',{recursive:true}); fs.writeFileSync('test-output/motion/performance.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
await close(errs.length || !held.drag || full.commits !== 1 || full.previewCommitCount || !full.playbackModelStable ? 1 : 0);
