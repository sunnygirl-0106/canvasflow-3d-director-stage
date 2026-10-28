import fs from 'node:fs';
import { PNG } from 'pngjs';
import { page, ok } from '../harness.mjs';
import { settle, shootViewport } from '../helpers.mjs';

const OUT = 'test-output/depth-playback';

// Measure the rendered stroke across its screen-space normal, away from edit nodes.
async function strokeWidths(file) {
  const samples = await page.evaluate(() => {
    const a = window.__app, it = a.pathOverlay.displayState.paths[0], camera = a.getRenderCamera();
    const rect = a.stage.renderer.domElement.getBoundingClientRect();
    const project = s => {
      const p = a.timeline.pathModel(it.source).positionAt(s); p.y += .01; p.applyMatrix4(a.stage.world.matrixWorld.clone().fromArray(it.matrix)); p.project(camera);
      return [(p.x+1)*rect.width/2, (1-p.y)*rect.height/2];
    };
    return [.07,.11,.15,.83,.87,.91].map(t => {
      const s = a.timeline.pathModel(it.source).length*t, p = project(s), q = project(s+.01);
      const dx = q[0]-p[0], dy = q[1]-p[1], len = Math.hypot(dx,dy);
      return { p, normal: [-dy/len, dx/len] };
    });
  });
  const png = PNG.sync.read(fs.readFileSync(file));
  const widths = samples.map(({ p, normal }) => {
    let width = 0;
    for (let step=-32;step<=32;step++) {
      const x = Math.round(p[0]+normal[0]*step/4), y = Math.round(p[1]+normal[1]*step/4);
      const i = (y*png.width+x)*4, [r,g,b] = png.data.subarray(i,i+3);
      if (b > 120 && b-r > 50 && b-g > 20) width += .25;
    }
    return width;
  });
  const median = values => values.sort((a,b) => a-b)[1];
  return { start: median(widths.slice(0,3)), end: median(widths.slice(3)), samples: widths };
}

export async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const seed = await page.evaluate(() => window.__app.exportDocument());
  // Identical default scene, camera, lighting and material; only the old/new palette differs.
  await page.evaluate(() => {
    const a = window.__app;
    a.select(null);
    a.entities.filter(e => e.type === 'character').forEach((e, i) => e.setColor([0x468de5, 0xe35e61][i]));
    a.stage.invalidate();
  });
  await shootViewport(`${OUT}/characters-before.png`);
  await page.evaluate(() => {
    const a = window.__app;
    a.entities.filter(e => e.type === 'character').forEach(e => e.setColor(a.store.document.entities.find(j => j.id === e.id).color));
    a.stage.invalidate();
  });
  await shootViewport(`${OUT}/characters-after.png`);
  const before = PNG.sync.read(fs.readFileSync(`${OUT}/characters-before.png`));
  const after = PNG.sync.read(fs.readFileSync(`${OUT}/characters-after.png`));
  let changed = 0, gain = 0;
  for (let i = 0; i < before.data.length; i += 4) {
    const b = before.data[i] + before.data[i+1] + before.data[i+2];
    const a = after.data[i] + after.data[i+1] + after.data[i+2];
    if (Math.abs(a-b) > 6) { changed++; gain += a-b; }
  }
  ok('默认场景同视角截图：角色明显提亮，场景大部分像素不变', changed > 1000 && changed < before.width * before.height * .06 && gain / changed > 25, JSON.stringify({ changed, meanRGBGain: gain / changed }));

  await page.evaluate(async () => {
    const a = window.__app, { setPath } = await import('/src/doc/edit.js');
    const c = a.entities.find(e => e.type === 'character');
    // 像素探针识别蓝色；夹具显式指定颜色，不依赖默认身份配色。
    a.store.transact('探针颜色', doc => { doc.entities.find(e => e.id === c.id).trailColor = '#60a5fa'; });
    a.select(c.id);
    a.store.transact('深度验收轨迹', doc => setPath(doc, c.id, [[-1.5,0,4],[-2,0,-4],[2,0,-25]], { set: { duration: 10 } }));
    a.pathOverlay.setSelectedPath(a.timeline.paths[0].id);
    a.setCameraHelpersVisible(false);
    const V = a.stage.camera.position.constructor;
    a.rig.applyView(new V(0,3,10), new V(0,0,-8), 50);
    a.pathTool.request('points', c.id);
    a.pathOverlay.setDraft([[-1.5,0,4],[-2,0,-4],[2,0,-25]]);
  });
  await shootViewport(`${OUT}/depth-draft.png`);
  await page.keyboard.press('Escape');
  await shootViewport(`${OUT}/depth-front.png`);
  const frontWidths = await strokeWidths(`${OUT}/depth-front.png`);
  ok('远处细线仍有独立的 6px 拾取范围', await page.evaluate(() => {
    const a = window.__app, it = a.pathOverlay.displayState.paths[0], p = a.timeline.pathModel(it.source).positionAt(a.timeline.pathModel(it.source).length * .85);
    p.y += .01; p.applyMatrix4(a.stage.world.matrixWorld.clone().fromArray(it.matrix)); p.project(a.getRenderCamera());
    const r = a.stage.renderer.domElement.getBoundingClientRect();
    const hit = a.pathOverlay.hitTest(r.left + (p.x+1)*r.width/2 + 4, r.top + (1-p.y)*r.height/2);
    return hit?.pathId === it.source.id;
  }));
  await page.evaluate(() => {
    const a = window.__app, V = a.stage.camera.position.constructor;
    a.rig.applyView(new V(1,3,-29), new V(0,0,-10), 50);
  });
  await shootViewport(`${OUT}/depth-reverse.png`);
  const reverseWidths = await strokeWidths(`${OUT}/depth-reverse.png`);
  ok('真实像素：近粗远细，反向观察后粗细关系反转', frontWidths.start > frontWidths.end + .5 && reverseWidths.end > reverseWidths.start + .5, JSON.stringify({ frontWidths, reverseWidths }));

  // Replacement commits only on completion, is scoped to the target, and remains undoable.
  const replacement = await page.evaluate(async () => {
    const a = window.__app, { setPath } = await import('/src/doc/edit.js');
    const chars = a.entities.filter(e => e.type === 'character');
    a.store.transact('其他角色路径', doc => setPath(doc, chars[1].id, [[1,0,0],[4,0,0]]));
    a.history.reset();
    const original = JSON.stringify(a.store.document), other = JSON.stringify(a.timeline.paths.find(p => p.target === chars[1].id));
    a.pathTool.request('points', chars[0].id);
    const direct = a.pathTool.mode === 'points' && !document.querySelector('#toast.show .toast-action');
    a.pathTool.cancel();
    const cancelled = JSON.stringify(a.store.document) === original;
    a.pathTool.request('points', chars[0].id);
    a.pathTool.draft = [[0,0,0],[0,0,0]]; a.pathTool.finish();
    const invalid = JSON.stringify(a.store.document) === original;
    a.pathTool.cancel(); a.pathTool.request('points', chars[0].id);
    a.pathTool.draft = [[0,0,0],[2,0,3]]; a.pathTool.finish();
    const scoped = JSON.stringify(a.timeline.paths.find(p => p.target === chars[1].id)) === other && a.timeline.paths.length === 2;
    await a.history.undo();
    return { direct, cancelled, invalid, scoped, undo: JSON.stringify(a.store.document) === original };
  });
  ok('重绘无确认；取消/无效路径保留旧内容；成功仅替换目标且可撤销', Object.values(replacement).every(Boolean), JSON.stringify(replacement));

  await page.evaluate(async doc => { const a = window.__app; await a.loadDocument(doc, { applyView: true }); window.__timelinePanel.setCollapsed(false); }, seed);
  const lockCamera = await page.evaluate(() => {
    const a = window.__app; a.setCameraView(false);
    return { shot: a.cameras[0].cam.matrixWorld.toArray(), director: a.stage.camera.matrixWorld.toArray() };
  });
  await page.click('.tl-play');
  ok('按钮从导演视角开始播放，立即进入机位并显示播放标识', await page.evaluate(() => {
    const a = window.__app;
    return a.playback.playing && !a.cameraView && a.getRenderCamera() === a.cameras[0].cam && !a.rig.controls.enabled && !document.querySelector('#povLabel');
  }));
  const point = await page.$eval('#viewport canvas', el => { const r = el.getBoundingClientRect(); return [r.x+r.width*.4,r.y+r.height*.4]; });
  await page.mouse.move(...point); await page.mouse.down(); await page.mouse.move(point[0]+90,point[1]+40,{steps:8});
  ok('左键拖动显示视口锁定提示', await page.evaluate(() => !window.__app.playbackHint.hidden));
  await shootViewport(`${OUT}/playback-locked.png`);
  await settle(2400);
  await page.mouse.move(point[0]+120,point[1]+60,{steps:5});
  ok('提示自动消失，同一次拖动不重复弹出', await page.evaluate(() => window.__app.playbackHint.hidden));
  await page.mouse.up(); await page.mouse.wheel({ deltaY: -300 });
  await page.click('#viewtabs [data-v="director"]'); await page.click('#navg');
  const locked = await page.evaluate(b => {
    const a = window.__app; a.beforeRender();
    return { playing: a.playback.playing, directorTab: !a.cameraView, camera: a.getRenderCamera() === a.cameras[0].cam,
      directorDelta: Math.max(...a.stage.camera.matrixWorld.toArray().map((v, i) => Math.abs(v - b.director[i]))),
      shotDelta: Math.max(...a.cameras[0].cam.matrixWorld.toArray().map((v, i) => Math.abs(v - b.shot[i]))) };
  }, lockCamera);
  ok('拖动/滚轮/导演标签/重置均不能改变播放视角', locked.playing && locked.directorTab && locked.camera && locked.directorDelta < 1e-8 && locked.shotDelta < 1e-8, JSON.stringify(locked));
  await page.click('.tl-play'); await page.click('#viewtabs [data-v="director"]');
  const directorBeforeDrag = await page.evaluate(() => window.__app.stage.camera.position.toArray());
  await page.mouse.move(...point); await page.mouse.down(); await page.mouse.move(point[0]+100,point[1]+30,{steps:8}); await page.mouse.up(); await settle(300);
  ok('暂停后可切回导演视角并自由环绕，提示消失', await page.evaluate(b => {
    const a = window.__app; return !a.playback.playing && !a.cameraView && a.rig.controls.enabled && a.playbackHint.hidden && JSON.stringify(a.stage.camera.position.toArray()) !== JSON.stringify(b);
  }, directorBeforeDrag));
  await page.keyboard.press('Space');
  ok('Space 继续播放重新锁定机位', await page.evaluate(() => !window.__app.cameraView && window.__app.playback.playing));
  ok('直接 play、停止后重播、末端重播、循环、自然结束均满足机位规则', await page.evaluate(() => {
    const a = window.__app, p = a.playback; let pass = true;
    for (let n=0;n<3;n++) {
      a.stopPreview(); a.setCameraView(false); p.seek(n === 2 ? a.timeline.duration : 2);
      p.play(); pass &&= !a.cameraView && a.getRenderCamera() === a.cameras[0].cam && p.playing && (n !== 2 || p.time === 0);
    }
    p.loop = true; p.seek(a.timeline.duration); p.update(); pass &&= p.playing && !a.cameraView;
    p.loop = false; p.seek(a.timeline.duration); p.update(); pass &&= !p.playing && !a.cameraView && a.playbackHint.hidden;
    return pass;
  }));
  ok('机位有路径时主画面跟随机位运动，播放期间禁止换机位', await page.evaluate(async () => {
    const a = window.__app, { setPath } = await import('/src/doc/edit.js');
    a.stopPreview(); const c = a.cameras[0], other = a.addCamera('front_mid'); a.setActiveCamera(c.id);
    a.store.transact('运镜', doc => setPath(doc, c.id, [[0,2.2,10],[3,2.2,7]], { set: { duration: 10 } }));
    a.playback.play(); const initial = c.root.position.clone(); a.playback.seek(5); a.beforeRender();
    a.setActiveCamera(other.id);
    return a.getRenderCamera() === c.cam && c.root.position.distanceTo(initial) > 1 && a.povCameraId === c.id;
  }));
  ok('删除播放机位先停止；无机位时阻止所有播放入口', await page.evaluate(() => {
    const a = window.__app; a.removeMany(a.cameras.map(c => c.id));
    const stopped = !a.playback.playing;
    const blocked = !a.startPreview() && !a.playback.play() && !a.playback.playing;
    return stopped && blocked && document.querySelector('#toast').textContent.includes('请先添加播放机位');
  }));
}
