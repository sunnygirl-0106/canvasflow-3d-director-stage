import fs from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
process.argv[2] = 'model-candidates';
const h = await import('../e2e/harness.mjs');
const { page } = h;
const dir = 'test-output/model-candidates';
const report = JSON.parse(fs.readFileSync(`${dir}/report.json`));
report.runtime = [];
try {
  await h.openApp();
  const presets = await page.evaluate(async () => {
    const { POSE_PRESETS } = await import('/src/entities/posePresets.js');
    for (const e of window.__app.entities) e.setVisible(false);
    window.__app.setLabelsVisible(false); window.__app.select(null);
    return POSE_PRESETS.map((p) => p.key);
  });
  for (const body of ['male', 'female', 'tall', 'small', 'broad', 'slim', 'xbot']) for (const variant of ['lossless', 'compact']) {
    if (body === 'xbot' && variant === 'compact') continue;
    const result = { body, variant, samples: [] };
    try {
      result.structure = await page.evaluate(async ({ body, variant }) => {
        const { Character } = await import('/src/entities/Character.js');
        const { bodySpec } = await import('/src/config.js');
        const spec = bodySpec(body), a = window.__app;
        const start = performance.now();
        const original = await Character.load('原始', body === 'xbot' ? spec : { ...spec, url: `/test-output/model-candidates/${spec.profile.id}-original.glb` });
        const originalLoadMs = performance.now() - start;
        const then = performance.now();
        const url = body === 'xbot' ? spec.url : `/test-output/model-candidates/${spec.profile.id}-${variant}.glb`;
        const candidate = await Character.load('候选', { ...spec, url });
        const candidateLoadMs = performance.now() - then;
        a.stage.add(original.root); a.stage.add(candidate.root);
        window.__modelPair = [original, candidate];
        const meshes = (c) => { const out = []; c.model.traverse((o) => { if (o.isSkinnedMesh) out.push(o); }); return out; };
        const inverseBinds = (c) => meshes(c).flatMap((m) => m.skeleton.boneInverses.flatMap((b) => b.elements));
        const b1 = inverseBinds(original), b2 = inverseBinds(candidate);
        const weights = (c) => {
          let maxSumError = 0, invalidJoints = 0;
          for (const m of meshes(c)) {
            const sw = m.geometry.attributes.skinWeight, si = m.geometry.attributes.skinIndex;
            for (let i = 0; i < sw.count; i++) {
              let sum = 0;
              for (let k = 0; k < 4; k++) { sum += sw.getComponent(i, k); if (si.getComponent(i, k) >= m.skeleton.bones.length) invalidJoints++; }
              maxSumError = Math.max(maxSumError, Math.abs(1 - sum));
            }
          }
          return { maxSumError, invalidJoints };
        };
        return { originalLoadMs, candidateLoadMs, missingJoints: candidate.missingJoints,
          sameBoneNames: JSON.stringify([...original.bones.keys()]) === JSON.stringify([...candidate.bones.keys()]),
          inverseBindMaxError: b1.length === b2.length ? Math.max(...b1.map((v, i) => Math.abs(v - b2[i]))) : null,
          originalWeights: weights(original), candidateWeights: weights(candidate) };
      }, { body, variant });
      for (const pose of [...presets, ...Array.from({ length: 8 }, (_, i) => `gait:${i}`)]) {
        const sample = await page.evaluate(async (pose) => {
          const { gaitPose } = await import('/src/anim/Locomotion.js');
          const { worldBox } = await import('/src/util/measure.js');
          const a = window.__app, pair = window.__modelPair;
          const Cam = a.stage.camera.constructor;
          const cameras = [[0, 5.2], [3.7, 3.7]].map(([x, z]) => {
            const cam = new Cam(30, 360 / 480, .05, 100); cam.position.set(x, 1, z); cam.lookAt(0, .9, 0); cam.updateMatrixWorld(true); return cam;
          });
          const shots = [], bounds = [], soles = [];
          for (const c of pair) {
            for (const other of pair) other.setVisible(other === c);
            if (pose.startsWith('gait:')) {
              c.resetPose(); const g = gaitPose(c.legGeom, Number(pose.split(':')[1]) / 8, 1.6);
              Object.assign(c.values, g.values); c.applyPose();
            } else c.applyPosePreset(pose);
            c.root.updateMatrixWorld(true);
            soles.push(c.lowestSoleY() * c.root.scale.y);
            const b = worldBox(c.root, { useBones: true }); bounds.push([...b.min.toArray(), ...b.max.toArray()]);
            const cv = document.createElement('canvas'); cv.width = 720; cv.height = 480;
            cameras.forEach((cam, i) => cv.getContext('2d').drawImage(a.stage.snapshot(cam, { width: 360, height: 480 }), i * 360, 0));
            shots.push(cv.toDataURL());
          }
          return { shots, soleError: Math.abs(soles[0] - soles[1]), boundsMaxError: Math.max(...bounds[0].map((v, i) => Math.abs(v - bounds[1][i]))) };
        }, pose);
        const pngs = sample.shots.map((s) => PNG.sync.read(Buffer.from(s.split(',')[1], 'base64')));
        const diff = new PNG({ width: pngs[0].width, height: pngs[0].height });
        const ratio = pixelmatch(pngs[0].data, pngs[1].data, diff.data, diff.width, diff.height, { threshold: .1 }) / (diff.width * diff.height);
        result.samples.push({ pose, ratio, soleError: sample.soleError, boundsMaxError: sample.boundsMaxError });
        if (ratio > .001 && !result.firstFailure) {
          result.firstFailure = pose;
          fs.writeFileSync(`${dir}/${body}-${variant}-diff.png`, PNG.sync.write(diff));
          fs.writeFileSync(`${dir}/${body}-${variant}-original.png`, Buffer.from(sample.shots[0].split(',')[1], 'base64'));
          fs.writeFileSync(`${dir}/${body}-${variant}-candidate.png`, Buffer.from(sample.shots[1].split(',')[1], 'base64'));
        }
      }
      result.acceptable = result.structure.sameBoneNames && !result.structure.missingJoints.length
        && result.structure.inverseBindMaxError !== null && result.structure.inverseBindMaxError < 1e-6
        && result.structure.candidateWeights.invalidJoints === 0
        && result.structure.candidateWeights.maxSumError < 1e-5
        && result.samples.every((s) => s.ratio <= .001 && s.boundsMaxError < .001 && s.soleError < .001);
    } catch (err) { result.error = err.message; result.acceptable = false; }
    finally {
      await page.evaluate(() => { for (const c of window.__modelPair || []) { window.__app.stage.remove(c.root); c.dispose(); } window.__modelPair = null; });
    }
    report.runtime.push(result);
    fs.writeFileSync(`${dir}/runtime-report.json`, JSON.stringify(report, null, 2));
    console.log(`${body} ${variant}: ${result.acceptable ? '通过' : '未通过'} ${result.error || result.firstFailure || ''}`);
  }
} finally { await h.close(0); }
