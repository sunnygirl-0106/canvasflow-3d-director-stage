// Report-only speed metrics; deterministic cleanup/transaction failures still fail the job.
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';
process.argv[2] = 'performance';
const h = await import('../e2e/harness.mjs');
const { page } = h;
const dir = 'test-output/performance'; fs.mkdirSync(dir, { recursive: true });
const stats = (xs) => { const values = xs.slice().sort((a, b) => a - b); return { n: values.length, median: values[Math.floor(values.length / 2)], p95: values[Math.min(values.length - 1, Math.ceil(values.length * .95) - 1)] }; };
const report = { environment: { platform: os.platform(), arch: os.arch(), node: process.version, browser: await h.browser.version(), viewport: [1440, 810], backend: 'SwiftShader', repeats: 3 }, runs: [], summary: {} };
const save = () => fs.writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2));
try {
  for (const scenario of ['small', 'crowd36', 'crowds72', 'props200', 'denseTracks']) {
    for (let repeat = 0; repeat < 3; repeat++) {
      // 每轮刷新，JS 模型缓存重新建立；浏览器 HTTP 缓存保留，不能称为网络冷启动。
      await page.setCacheEnabled(false);
      const nav = performance.now(); await h.openApp();
      const startupMs = performance.now() - nav;
      const result = await page.evaluate(async (scenario) => {
        const a = window.__app;
        const { createEmptyDocument } = await import('/src/doc/schema.js');
        const { compileOps } = await import('/src/ai/apply.js');
        const { setPath } = await import('/src/doc/edit.js');
        const ops = [{ op: 'add_camera', name: '测量机位', pos: [0, 12, 25], lookAt: [0, 0, 0] }];
        if (scenario === 'small') for (const [i, body] of ['male', 'female'].entries()) ops.push({ op: 'add_character', name: `角色${i}`, body, pos: [i * 2, 0, 0] });
        if (scenario.startsWith('crowd')) for (let i = 0; i < (scenario === 'crowd36' ? 1 : 2); i++) ops.push({ op: 'add_crowd', name: `群众${i}`, rows: 6, cols: 6, pos: [i * 9 - 4, 0, 0], body: 'male' });
        if (scenario === 'props200' || scenario === 'denseTracks') for (let i = 0; i < (scenario === 'props200' ? 200 : 50); i++) ops.push({ op: 'add_prop', name: `道具${i}`, kind: 'box', pos: [i % 20 - 10, 0, Math.floor(i / 20) - 5] });
        const compiled = compileOps(createEmptyDocument(), ops, { mode: 'generate' });
        if (compiled.errors.length) throw new Error(compiled.errors.join('\n'));
        const doc = compiled.doc, tops = doc.entities.filter((e) => e.type !== 'camera' && !e.parent);
        const points = Array.from({ length: 24 }, (_, i) => [i / 4 - 3, 0, Math.sin(i / 6)]);
        // 一条可编辑路径用于统一测量真实节点拖动；群众额外沿各自路径行走。
        const { path: p } = setPath(doc, tops[0].id, points, { set: { start: 0, duration: 10, speed: 'linear', orient: 'keep' } });
        if (scenario === 'crowds72') setPath(doc, tops[1].id, points.map((p) => [p[0] + 9, p[1], p[2]]), { set: { start: 0, duration: 10, speed: 'linear', orient: 'keep' } });
        if (scenario === 'denseTracks') for (const [i, e] of tops.entries()) for (const property of ['pos', 'rot', 'scale']) {
          if (i === 0 && property === 'pos') continue;
          doc.timeline.tracks.push({ id: `t${i}${property}`, target: e.id, property, keys: Array.from({ length: 41 }, (_, k) => ({ t: k / 4, ease: 'linear', value: property === 'rot' ? [0, k * 4, 0] : property === 'scale' ? [1 + k / 100, 1, 1] : [e.transform.pos[0], k % 2 * .1, e.transform.pos[2]] })) });
        }
        const longTasks = [];
        const observer = new PerformanceObserver((entries) => longTasks.push(...entries.getEntries().map((e) => ({ start: e.startTime, duration: e.duration }))));
        observer.observe({ type: 'longtask', buffered: false });
        window.__perfObserver = observer; window.__perfLongTasks = longTasks;
        const start = performance.now();
        await a.loadDocument(doc, { history: false });
        a.select(null); a.rig.frameAll(a.entities, { overview: true }); a.stage.render();
        await new Promise(requestAnimationFrame);
        const loadToFrameMs = performance.now() - start;
        const memory = () => ({ ...a.stage.renderer.info.memory, heap: performance.memory?.usedJSHeapSize ?? null });
        const before = memory();
        const evaluate = [];
        for (let i = 0; i < 90; i++) { const t = performance.now(); a.timeline.evaluate(i / 9); evaluate.push(performance.now() - t); }
        a.playback.stop();
        const interaction = performance.now(); a.select(tops[0].id); a.stage.render();
        await new Promise(requestAnimationFrame);
        const firstInteractionMs = performance.now() - interaction;
        const playbackFrames = []; let last = performance.now();
        a.playback.play();
        for (let i = 0; i < 40; i++) await new Promise((resolve) => requestAnimationFrame((now) => { playbackFrames.push(now - last); last = now; resolve(); }));
        a.playback.stop();
        a.rig.applyView(a.stage.camera.position.clone().set(10, 12, 15), a.rig.controls.target.clone().set(0, 0, 0), 42);
        a.pathEditor.selectNode({ kind: 'path', sourceId: p.id, index: 12 }); a.stage.render();
        window.__perfPath = p.id;
        const gl = a.stage.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
        return { loadToFrameMs, firstInteractionMs, evaluate, playbackFrames, before, afterPlayback: memory(), render: { ...a.stage.renderer.info.render }, entities: doc.entities.length, tracks: doc.timeline.tracks.length,
          gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
      }, scenario);
      // 从可见 Y 手柄发出真实鼠标拖动，记录预览 CPU 与帧间隔。
      const coords = await page.evaluate(() => {
        const a = window.__app, hand = a.gizmo.translateHandle('y');
        const p = hand.position.clone(); p.y += .4 * hand.scale.x; const q = p.clone(); q.y += .6;
        const rect = a.stage.renderer.domElement.getBoundingClientRect();
        const perf = window.__dragPerf = { times: [], frames: [], revision: a.store.revision, done: false };
        const preview = a.pathEditor.preview.bind(a.pathEditor);
        a.pathEditor.preview = () => { const t = performance.now(); preview(); perf.times.push(performance.now() - t); };
        let last = performance.now();
        const frame = (now) => { perf.frames.push(now - last); last = now; if (!perf.done) requestAnimationFrame(frame); };
        requestAnimationFrame(frame);
        return [p, q].map((v) => { v.project(a.stage.camera); return [rect.left + (v.x + 1) / 2 * rect.width, rect.top + (1 - v.y) / 2 * rect.height]; });
      });
      await page.mouse.move(...coords[0]); await page.mouse.down();
      for (let i = 1; i <= 30; i++) {
        await page.mouse.move(coords[0][0] + (coords[1][0] - coords[0][0]) * i / 30, coords[0][1] + (coords[1][1] - coords[0][1]) * i / 30);
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      const held = await page.evaluate(() => !!window.__app.pathEditor.drag);
      await page.mouse.up();
      const ending = await page.evaluate(async () => {
        const a = window.__app, p = window.__dragPerf; p.done = true;
        p.commits = a.store.revision - p.revision;
        const steadyResources = [];
        for (let i = 0; i < 12; i++) {
          a.pathOverlay.setSelectedPath(null); a.pathEditor.selectNode({ kind: 'path', sourceId: window.__perfPath, index: 12 }); a.stage.render();
          await new Promise(requestAnimationFrame); steadyResources.push({ ...a.stage.renderer.info.memory });
        }
        window.__perfObserver.disconnect();
        return { drag: p, steadyResources, longTasks: window.__perfLongTasks, memoryEnd: { ...a.stage.renderer.info.memory, heap: performance.memory?.usedJSHeapSize ?? null }, idle: !a.exporting && !a.loadingDocument && !a.pathEditor.drag };
      });
      assert(held, '真实拖动必须命中手柄'); assert(ending.drag.times.length > 0); assert.equal(ending.drag.commits, 1); assert(ending.idle);
      assert.deepEqual(ending.steadyResources.at(-1), ending.steadyResources[0], '重复选择不得持续增加 GPU 资源');
      Object.assign(result, { scenario, repeat, startupMs, ...ending });
      report.runs.push(result); save(); console.log(`${scenario} ${repeat + 1}/3: load ${result.loadToFrameMs.toFixed(0)}ms, eval p95 ${stats(result.evaluate).p95.toFixed(2)}ms`);
    }
  }
  report.exports = [];
  await h.openApp();
  for (const height of [720, 1080]) for (let repeat = 0; repeat < 3; repeat++) {
    const measurement = await page.evaluate(async (height) => {
      const a = window.__app, { exportVideo } = await import('/src/app/VideoExporter.js');
      const before = { doc: JSON.stringify(a.store.document), history: a.history.index, time: a.playback.time, memory: { ...a.stage.renderer.info.memory } };
      const start = performance.now(), result = await exportVideo(a, { width: height * 16 / 9, height, fps: 24, range: [0, 1], labels: true });
      const ms = performance.now() - start;
      return { height, ms, frames: result.frames, framesPerSecond: result.frames / (ms / 1000), bytes: result.blob.size,
        unchanged: before.doc === JSON.stringify(a.store.document) && before.history === a.history.index && before.time === a.playback.time,
        idle: !a.exporting && !a.stage.suspended, beforeMemory: before.memory, afterMemory: { ...a.stage.renderer.info.memory } };
    }, height);
    assert(measurement.unchanged && measurement.idle); assert.equal(measurement.frames, 24); assert(measurement.bytes > 0);
    report.exports.push({ ...measurement, repeat }); save(); console.log(`export ${height}p ${repeat + 1}/3: ${measurement.framesPerSecond.toFixed(2)} frames/s`);
  }
  for (const height of [720, 1080]) {
    const samples = report.exports.filter((r) => r.height === height);
    assert.deepEqual(samples[2].afterMemory, samples[1].afterMemory, '相同导出重复后 GPU 资源必须稳定');
  }
  for (const scenario of [...new Set(report.runs.map((r) => r.scenario))]) {
    const runs = report.runs.filter((r) => r.scenario === scenario);
    report.summary[scenario] = Object.fromEntries(['startupMs', 'loadToFrameMs', 'firstInteractionMs'].map((key) => [key, stats(runs.map((r) => r[key]))]));
    for (const key of ['evaluate', 'playbackFrames']) report.summary[scenario][key] = stats(runs.flatMap((r) => r[key]));
    report.summary[scenario].dragUpdate = stats(runs.flatMap((r) => r.drag.times));
    report.summary[scenario].dragFrames = stats(runs.flatMap((r) => r.drag.frames));
    report.summary[scenario].longTasks = { count: runs.reduce((sum, r) => sum + r.longTasks.length, 0), duration: stats(runs.flatMap((r) => r.longTasks.map((t) => t.duration))) };
  }
  for (const height of [720, 1080]) report.summary[`export${height}`] = { ms: stats(report.exports.filter((r) => r.height === height).map((r) => r.ms)), framesPerSecond: stats(report.exports.filter((r) => r.height === height).map((r) => r.framesPerSecond)) };
  report.errors = h.errs; assert.deepEqual(h.errs, []); report.passed = true; save();
  await h.close(0);
} catch (err) { report.error = err.stack; save(); await h.fail(err); }
