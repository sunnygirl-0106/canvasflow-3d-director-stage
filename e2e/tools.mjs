// 开发工具子命令（需要浏览器）：calib / collide / poses。posediff 不起浏览器，在 posediff.mjs。
import fs from 'node:fs';
import path from 'node:path';
import { page, URL_, errs } from './harness.mjs';
export async function calib(ids) {
  if (!ids.length)
    ids = ['xbot', 'bodykun_male', 'bodychan_female'];
  fs.mkdirSync('test-output', { recursive: true });
  for (const id of ids) {
    await page.goto(new URL(`calib.html?profile=${id}`, URL_).href, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForFunction(() => window.__calibReady, { timeout: 60000 });
    const err = await page.$eval('#err', (e) => e.textContent);
    const out = `test-output/calib_${id}.png`;
    await page.screenshot({ path: out, fullPage: true });
    console.log(`${err ? '❌' : '📸'} ${out}${err ? ' — ' + err : ''}`);
  }
  if (errs.length)
    console.log('❌ console 错误：\n' + errs.join('\n'));
  return errs.length ? 1 : 0;
}
/** 穿模检测：三个档案逐个预设 + 步态（正常 / 加速走各 8 相位）。返回退出码。 */
export async function collide(only) {
  await page.goto(new URL('calib.html?profile=xbot', URL_).href, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForFunction(() => window.__calibReady, { timeout: 60000 });
  const report = await page.evaluate(async (only) => {
    const { Character } = await import('/src/entities/Character.js');
    const { PROFILES } = await import('/src/rig/profiles/index.js');
    const { POSE_PRESETS } = await import('/src/entities/posePresets.js');
    const { detectPenetration } = await import('/src/dev/poseCollision.js');
    const { gaitPose } = await import('/src/anim/Locomotion.js');
    const out = [];
    for (const p of Object.values(PROFILES)) {
      const ch = await Character.load(p.id, { url: p.file, profile: p, height: p.heightM });
      for (const pr of POSE_PRESETS) {
        if (only && !only.split(',').includes(pr.key))
          continue;
        ch.applyPosePreset(pr.key);
        out.push({ profile: p.id, preset: pr.key, hits: detectPenetration(ch.model) });
      }
      // 步态：正常 / 加速走各 8 个相位（w=1 的完整步态，阶段 C Locomotion）
      if (!only || only.split(',').includes('gait')) {
        for (const [name, speed] of [['walk', 1.6], ['fastWalk', 4]]) {
          for (let i = 0; i < 8; i++) {
            const g = gaitPose(ch.legGeom, i / 8, speed);
            ch.resetPose();
            Object.assign(ch.values, g.values);
            ch.applyPose();
            out.push({ profile: p.id, preset: `${name}@${i}/8`, hits: detectPenetration(ch.model) });
          }
        }
      }
    }
    return out;
  }, only || '');
  let bad = 0;
  for (const r of report) {
    if (!r.hits.length)
      continue;
    bad++;
    console.log(`❌ ${r.profile.padEnd(16)} ${r.preset.padEnd(7)} ` + r.hits.map((h) => `${h.pair} ${(h.depth * 100).toFixed(1)}cm×${h.count}`).join('  '));
  }
  console.log(`\n=== ${report.length - bad}/${report.length} 无穿模 ===`);
  return bad ? 1 : 0;
}
export async function shootPoses(outDir, bodyKey) {
  fs.mkdirSync(outDir, { recursive: true });
  const keys = await page.evaluate(async (bodyKey) => {
    const { BODY_TYPES } = await import('/src/config.js');
    const { POSE_PRESETS } = await import('/src/entities/posePresets.js');
    const a = window.__app;
    const key = bodyKey || (BODY_TYPES.xbot ? 'xbot' : Object.keys(BODY_TYPES)[0]);
    const c = await a.addCharacter(key);
    a.select(null);
    for (const e of a.entities)
      if (e !== c)
        e.setVisible(false);
    a.setLabelsVisible(false);
    a.stage.grid.visible = false; // 姿势比较保留地面阴影，排除编辑网格密度的变化。
    c.root.position.set(0, c.root.position.y, 0);
    c.root.rotation.set(0, 0, 0);
    c.root.updateMatrixWorld(true);
    const Cam = a.stage.camera.constructor; // THREE.PerspectiveCamera（页面内无法直接 import 裸模块名）
    const mk = (x, z) => {
      const cam = new Cam(30, 1, 0.05, 100);
      cam.position.set(x, 1.0, z);
      cam.lookAt(0, 0.9, 0);
      cam.updateMatrixWorld(true);
      return cam;
    };
    window.__poseCams = [mk(0, 5.2), mk(3.7, 3.7)];
    window.__poseChar = c;
    return { body: key, presets: POSE_PRESETS.map((p) => p.key) };
  }, bodyKey);
  console.log(`📐 姿势截图：body=${keys.body} → ${outDir}`);
  for (const preset of keys.presets) {
    const url = await page.evaluate((preset) => {
      const c = window.__poseChar;
      c.applyPosePreset(preset);
      c.root.updateMatrixWorld(true);
      const W = 360, H = 480;
      const out = document.createElement('canvas');
      out.width = W * 2;
      out.height = H;
      const g = out.getContext('2d');
      window.__poseCams.forEach((cam, i) => g.drawImage(window.__app.stage.snapshot(cam, { width: W, height: H }), i * W, 0, W, H));
      window.__app.stage.render();
      return out.toDataURL('image/png');
    }, preset);
    fs.writeFileSync(path.join(outDir, preset + '.png'), Buffer.from(url.split(',')[1], 'base64'));
    console.log('  📸 ' + preset);
  }
  if (errs.length)
    console.log('❌ console 错误：\n' + errs.join('\n'));
}
