import fs from 'node:fs';
import { PNG } from 'pngjs';
import { page, ok } from '../harness.mjs';
import { shootViewport, settle, camShot, aiInputs, aiFixturesSrc, aiSend, aiState, aiPanelShot } from '../helpers.mjs';

export async function run() {
  const OUT = 'test-output/ai';
  const { gen: AI_GEN_INPUT, mod: AI_MOD_INPUT } = aiInputs();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await settle(200);

  // Mock：生成 / 修改 / 校验回路 / 永远失败 / 重名 / 删不存在 / 识图 / 识图越权
  await page.evaluate(async (FX) => {
    const { MockProvider } = await import('/src/ai/provider.js');
    const fx = eval(FX);
    const snap = () => { const d = window.__app.exportDocument({ view: false }); d.meta.updatedAt = null; return JSON.stringify(d); };
    const BAD = JSON.parse(JSON.stringify(fx.gen));
    BAD.ops[5].preset = 'orbit';
    BAD.ops[3].pos = [0.8, 0];
    window.__aiMock = new MockProvider([
      { match: '广场对话', reply: fx.gen },
      { match: '男的站起来', reply: fx.mod },
      { match: '校验回路', reply: (msgs, n) => { if (n === 1) window.__snapAtRetry = snap(); return n === 0 ? BAD : fx.gen; } },
      { match: '永远失败', reply: BAD },
      { match: '两个阿明', reply: { ops: [
        { op: 'add_character', name: '阿明', body: 'male', pos: [2, 0, 2] },
        { op: 'add_character', name: '阿明', body: 'slim', pos: [3, 0, 2] },
      ], note: '加了两个阿明' } },
      { match: '删掉老张', reply: { ops: [{ op: 'remove', target: '老张' }], note: '删老张' } },
      { match: '照图摆位', reply: { ops: [
        { op: 'clear' },
        { op: 'add_character', name: '红', body: 'female', pos: [-1.5, 0, 0], yaw: 90 },
        { op: 'add_character', name: '绿', body: 'male', pos: [0, 0, -0.5], yaw: 0 },
        { op: 'add_character', name: '蓝', body: 'male', pos: [1.5, 0, 0], yaw: -90 },
        { op: 'add_camera', name: '机位1', pos: [0, 1.4, 3.5], lookAt: '绿' },
      ], note: '按图摆了 3 个人，机位在正前方' } },
      { match: '还要走动', reply: { ops: [{ op: 'set_path', target: '红', path: { kind: 'line', to: [0, 0, 2] } }], note: '红走过来' } },
    ], { delayMs: 30 });
    window.__app.ai.setProvider(window.__aiMock);
    window.__aiPanel.toggle(true);
  }, aiFixturesSrc());
  await settle(200);
  await aiPanelShot(`${OUT}/panel_empty.png`);

  // 预制场景仅填入草稿；真正发送仍遵守生成确认与忙碌状态。
  await page.evaluate(() => {
    window.__presetBefore = { doc: window.__app.store.document, hist: window.__app.history.index };
  });
  await page.evaluate(() => window.__aiPanel.toggle(false));
  await page.click('#scenePresets');
  await page.click('.ai-preset');
  const preset = await page.evaluate(async () => {
    const { SCENE_PRESETS } = await import('/src/ai/presets.js');
    const p = window.__aiPanel, a = window.__app;
    return !document.querySelector('.ai-preset-tray') && SCENE_PRESETS.length === 8
      && p.mode === 'generate' && p.textarea.value === SCENE_PRESETS[0].prompt && document.activeElement === p.textarea
      && a.store.document === window.__presetBefore.doc && a.history.index === window.__presetBefore.hist && window.__aiMock.calls.length === 0;
  });
  ok('8 个预制场景：真实点击仅填入提示词并切生成模式，不调用模型或改文档', preset);
  await page.click('.ai-send');
  const confirmation = await page.evaluate(() => document.querySelector('#toast').textContent.includes('清空并生成') && window.__aiMock.calls.length === 0);
  await page.click('#toast .toast-action.secondary');
  ok('预制场景发送保留清空确认，取消不改变现有场景', confirmation && await page.evaluate(() => window.__app.store.document === window.__presetBefore.doc && window.__aiMock.calls.length === 0));
  await page.evaluate(() => window.__aiPanel.openPresets());
  const controls = await page.evaluate(() => {
    const p = window.__aiPanel;
    p.openPresets(); p.renderInput();
    const collapsed = !document.querySelector('.ai-preset-tray');
    p.openPresets();
    p.agent.busy = true; p.renderInput();
    const disabled = [...document.querySelectorAll('.ai-preset')].every((button) => button.disabled);
    p.agent.busy = false; p.toggle(false); p.toggle(true); p.mode = 'image'; p.renderInput();
    const hidden = !document.querySelector('.ai-preset-tray');
    p.mode = 'modify'; p.presetsOpen = true; p.textarea.value = ''; p.renderInput();
    return collapsed && disabled && hidden;
  });
  ok('预制场景折叠状态跨重绘保留，忙碌时禁用，识图模式隐藏', controls);

  // ---- 验收 1 一句话生成 ----
  const h0 = (await aiState()).hist;
  const r1 = await aiSend('generate', AI_GEN_INPUT);
  const g = await page.evaluate(async () => {
    const a = window.__app;
    const { aimPoint } = await import('/src/anim/Constraint.js');
    const doc = a.exportDocument({ view: false });
    const by = (n) => doc.entities.find((e) => e.name === n);
    const cam = by('机位1');
    a.playback.seek(2.5);
    const c = a.findCamera(cam.id);
    c.root.updateMatrixWorld(true);
    c.cam.updateMatrixWorld(true);
    const inFrame = ['小红', '小王'].map((n) => {
      const p = a.stage.world.localToWorld(aimPoint(a, by(n).id).clone()).project(c.cam);
      return Math.abs(p.x) < 0.95 && Math.abs(p.y) < 0.95 && p.z < 1;
    });
    return {
      n: doc.entities.length, poses: [by('小红').pose.preset, by('小王').pose.preset],
      camPath: doc.paths.some((p) => p.target === cam.id), lookAt: doc.constraints.some((k) => k.target === cam.id && k.type === 'lookAt'),
      duration: doc.timeline.duration, main: doc.timeline.mainCameraId === cam.id, inFrame, camId: cam.id,
    };
  });
  await camShot(g.camId, `${OUT}/gen_t2.5.png`);
  await page.evaluate(() => window.__app.playback.stop());
  await shootViewport(`${OUT}/gen_viewport.png`);
  ok('验收 1 一句话生成：3 实体 / 挥手 + 坐 / 机位路径 + 注视 / 时长 5 / 一步撤销',
    r1.status === 'ok' && g.n === 3 && g.poses.join() === 'wave,sit' && g.camPath && g.lookAt && g.duration === 5 && g.main && (await aiState()).hist === h0 + 1,
    JSON.stringify({ r1: r1.status, ...g, camId: undefined }));
  ok('验收 1 t=2.5 s 主机位画面两人都入画（gen_t2.5.png）', g.inFrame.every(Boolean), JSON.stringify(g.inFrame));
  // 胶囊的选项浮层不再改变取景或工具位置。
  const stable = await page.evaluate(() => {
    const p = window.__aiPanel, a = window.__app;
    const read = () => JSON.stringify({ rect: document.querySelector('#stageTools').getBoundingClientRect().toJSON(), pos: a.stage.camera.position.toArray(), target: a.rig.controls.target.toArray() });
    const before = read(); p.toggle(false); const closed = read(); p.toggle(true);
    return before === closed && before === read() && !a.frameInsetRight;
  });
  ok('AI 选项展开/关闭不移动工具组、不改取景、不挤占视口', stable);

  // ---- 验收 4 修改模式（在验收 1 的场景上）----
  const before4 = await aiState();
  const pre = await page.evaluate(() => JSON.stringify(window.__app.exportDocument({ view: false }).entities.find((e) => e.name === '小红')));
  const r4 = await aiSend('modify', AI_MOD_INPUT);
  const m = await page.evaluate(async () => {
    const a = window.__app;
    const { cameraMove } = await import('/src/anim/cameraMoves.js');
    const { aimPoint } = await import('/src/anim/Constraint.js');
    const doc = a.exportDocument({ view: false });
    const by = (n) => doc.entities.find((e) => e.name === n);
    const red = by('小红'), wang = by('小王'), cam = by('机位1');
    const wp = doc.paths.find((p) => p.target === wang.id);
    const end = wp.points[wp.points.length - 1];
    const cp = doc.paths.find((p) => p.target === cam.id);
    const expect = cameraMove('push_in', { position: cam.transform.pos, aim: aimPoint(a, red.id).toArray() }).points;
    return {
      dist: Math.hypot(end[0] - red.transform.pos[0], end[2] - red.transform.pos[2]),
      pose: wang.pose.preset, push: JSON.stringify(cp.points) === JSON.stringify(expect),
      looks: doc.constraints.filter((c) => c.target === cam.id).map((c) => c.subject === red.id),
      red: JSON.stringify(red),
    };
  });
  ok('验收 4 修改：小王站立、路径终点距小红 0.8 m、运镜 = push_in、小红未动',
    r4.status === 'ok' && r4.mode === 'modify' && Math.abs(m.dist - 0.8) < 1e-4 && m.pose === 'stand' && m.push && m.looks.join() === 'true' && m.red === pre,
    JSON.stringify({ ...m, red: m.red === pre }));
  await aiPanelShot(`${OUT}/panel_modify.png`);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta');
  await page.waitForFunction(() => !window.__app.loadingDocument, { timeout: 30000 });
  await settle(300);
  const after4 = await aiState();
  ok('验收 4 ⌘Z 一次回到修改前（文档逐字节相等）', after4.doc === before4.doc && after4.idx === before4.idx, `idx ${before4.idx} → ${after4.idx}`);

  // ---- 验收 2 校验回路 ----
  const before2 = await aiState();
  const r2 = await aiSend('generate', '校验回路：' + AI_GEN_INPUT.replace('广场对话', '对话'));
  const v2 = await page.evaluate((s0) => {
    const calls = window.__aiMock.calls;
    const last = calls[calls.length - 1];
    const msg = last[last.length - 1].content;
    return {
      msg, posErr: msg.includes('ops[3].pos 应为 [x, y, z] 三个数，实际为 [0.8,0]'), presetErr: msg.includes('ops[5].preset 未知运镜 "orbit"'),
      unchangedAtRetry: window.__snapAtRetry === s0,
    };
  }, before2.doc);
  const after2 = await aiState();
  ok('验收 2 校验回路：第 1 次坏（未知运镜 + pos 缺分量）→ 第 2 次成功', r2.status === 'ok' && r2.attempts === 2 && after2.idx === before2.idx + 1 && after2.hist === after2.idx + 1, JSON.stringify({ status: r2.status, attempts: r2.attempts, idx: `${before2.idx} → ${after2.idx}` }));  // 之前 ⌘Z 留下的重做分支被这一步截掉
  ok('验收 2 第 2 次请求带两条错误原文（ops[i].字段）且失败那次场景不变', v2.posErr && v2.presetErr && v2.unchangedAtRetry, v2.msg.split('\n').slice(1, 3).join(' | '));
  await aiPanelShot(`${OUT}/panel_retry.png`);

  // ---- 验收 3 三次失败 ----
  const before3 = await aiState();
  const r3 = await aiSend('modify', '永远失败的请求');
  const toast3 = await page.$eval('#toast', (t) => ({ show: t.classList.contains('show'), text: t.textContent }));
  const after3 = await aiState();
  ok('验收 3 三次失败：toast 出现、文档逐字节相等、撤销栈不变',
    r3.status === 'failed' && r3.attempts === 3 && toast3.show && toast3.text.includes('AI 生成失败') && after3.doc === before3.doc && after3.hist === before3.hist && after3.idx === before3.idx,
    JSON.stringify({ status: r3.status, attempts: r3.attempts, toast: toast3.text.split('\n')[0] }));
  await aiPanelShot(`${OUT}/panel_failed.png`);

  // ---- 验收 5 名字 ----
  const r5 = await aiSend('modify', '加两个阿明');
  const r5b = await aiSend('modify', '删掉老张');
  const names5 = await page.evaluate(() => window.__app.entities.map((e) => e.name));
  ok('验收 5 重名第二个自动改名并出现在回执 renames', r5.status === 'ok' && r5.result.renames['阿明'] === '阿明2' && names5.includes('阿明') && names5.includes('阿明2'), JSON.stringify(r5.result?.renames));
  ok('验收 5 remove 不存在的名字 → 定位错误', r5b.status === 'failed' && r5b.errors[0].startsWith('ops[0].target 引用的实体不存在："老张"'), r5b.errors[0]);

  // ---- 验收 6 识图 ----
  // 合成图：白底 3 个色块代表站位（红 / 绿 / 蓝）
  const png = new PNG({ width: 1600, height: 900 });
  for (let y = 0; y < 900; y++) for (let x = 0; x < 1600; x++) {
    const i = (y * 1600 + x) * 4;
    let c = [255, 255, 255];
    if (y > 300 && y < 700) { if (x > 250 && x < 450) c = [220, 40, 40]; else if (x > 700 && x < 900 && y > 250) c = [40, 180, 60]; else if (x > 1150 && x < 1350) c = [40, 80, 220]; }
    png.data[i] = c[0]; png.data[i + 1] = c[1]; png.data[i + 2] = c[2]; png.data[i + 3] = 255;
  }
  fs.writeFileSync(`${OUT}/stance.png`, PNG.sync.write(png));
  await page.click('.ai-mode[data-mode="image"]');
  const fileInput = await page.$('.ai-imgrow input[type=file]');
  await fileInput.uploadFile(`${OUT}/stance.png`);
  await page.waitForSelector('.ai-imgprev img', { timeout: 10000 });
  await aiPanelShot(`${OUT}/panel_image.png`);
  const r6 = await aiSend('image', '照图摆位，机位从正前方拍');
  const v6 = await page.evaluate(() => {
    const calls = window.__aiMock.calls;
    const user = calls[calls.length - 1].find((m) => m.role === 'user');
    const img = Array.isArray(user.content) && user.content.find((p) => p.type === 'image_url');
    const doc = window.__app.exportDocument({ view: false });
    return {
      img: img ? img.image_url.url.slice(0, 23) : null,
      chars: doc.entities.filter((e) => e.type === 'character').map((e) => [e.name, e.pose.preset]),
      cams: doc.entities.filter((e) => e.type === 'camera').length,
    };
  });
  const imgSize = await page.evaluate(() => new Promise((res) => {
    const calls = window.__aiMock.calls;
    const url = calls[calls.length - 1].find((m) => m.role === 'user').content[1].image_url.url;
    const im = new Image(); im.onload = () => res([im.naturalWidth, im.naturalHeight]); im.src = url;
  }));
  ok('验收 6 识图：图片以 data URL 发给模型（压到 1024 px）、3 个站立角色 + 1 机位',
    r6.status === 'ok' && v6.img === 'data:image/jpeg;base64,' && Math.max(...imgSize) === 1024 && v6.chars.length === 3 && v6.chars.every(([, p]) => p === 'stand') && v6.cams === 1,
    JSON.stringify({ ...v6, imgSize }));
  await shootViewport(`${OUT}/image_viewport.png`);
  const before6 = await aiState();
  await page.click('.ai-plus');
  await page.click('.ai-mode[data-mode="image"]');
  const fileInput2 = await page.$('.ai-imgrow input[type=file]');
  await fileInput2.uploadFile(`${OUT}/stance.png`);
  await page.waitForSelector('.ai-imgprev img', { timeout: 10000 });
  const r6b = await aiSend('image', '还要走动');
  const after6 = await aiState();
  ok('验收 6 识图模式下 set_path 被拒绝（说明该模式不允许）、场景不变',
    r6b.status === 'failed' && r6b.errors[0].startsWith('ops[0].op 识图模式不允许 "set_path"') && after6.doc === before6.doc,
    r6b.errors[0]);

  // ---- 验收 7 词汇表一致 ----
  const v7 = await page.evaluate(async () => {
    const { VOCAB, MOVE_PARAM_KEYS } = await import('/src/ai/vocab.js');
    const { OP_NAMES } = await import('/src/ai/ops.js');
    const { systemPrompt } = await import('/src/ai/prompt.js');
    const { BODY_TYPES, PROP_KINDS } = await import('/src/config.js');
    const { POSE_PRESET_MAP } = await import('/src/entities/posePresets.js');
    const { CAMERA_MOVES } = await import('/src/anim/cameraMoves.js');
    const { PATH_MODES } = await import('/src/anim/pathGen.js');
    const S = await import('/src/doc/schema.js');
    const eq = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
    const sets = {
      body: eq(VOCAB.body, Object.keys(BODY_TYPES)), prop: eq(VOCAB.prop, PROP_KINDS.map(([k]) => k)), pose: eq(VOCAB.pose, Object.keys(POSE_PRESET_MAP)),
      move: eq(VOCAB.move, CAMERA_MOVES.map(([k]) => k)), pathKind: eq(VOCAB.pathKind, PATH_MODES.map(([k]) => k).filter((k) => k !== 'freehand')),
      ease: eq(VOCAB.ease, S.EASES), speed: eq(VOCAB.speed, S.PATH_SPEEDS), orient: eq(VOCAB.orient, S.PATH_ORIENTS),
    };
    const p = systemPrompt();
    const missing = [...Object.values(VOCAB).flat(), ...MOVE_PARAM_KEYS, ...OP_NAMES].filter((w) => !p.includes(w));
    return { sets, missing };
  });
  ok('验收 7 词汇表 ≡ 代码枚举（姿势 / 体型 / 道具 / 运镜 / 路径 kind / ease / speed / orient），提示词含每个词',
    Object.values(v7.sets).every(Boolean) && !v7.missing.length, JSON.stringify(v7));

  // ---- 设置 / 隐私 ----
  const v8 = await page.evaluate(async () => {
    const p = window.__aiPanel;
    p.showSettings = true; p.render();
    const set = (name, v) => { const i = document.querySelector(`.ai-field[data-name="${name}"]`); i.value = v; i.dispatchEvent(new Event('input')); };
    set('baseURL', 'https://example.invalid/v1'); set('apiKey', 'sk-selftest-not-a-real-key'); set('model', 'demo-model');
    [...document.querySelectorAll('.ai-frow-btns .minibtn')].find((b) => b.textContent === '保存').click();
    const stored = JSON.parse(localStorage.getItem('director-stage.ai'));
    const docHasKey = JSON.stringify(window.__app.exportDocument()).includes('sk-selftest');
    window.__app.ai.setProvider(window.__aiMock); // 截图后恢复 Mock，不发真实请求
    return { stored: stored.model === 'demo-model' && stored.apiKey === 'sk-selftest-not-a-real-key', docHasKey, pwd: document.querySelector('.ai-field[data-name="apiKey"]').type };
  });
  await settle(100);
  await aiPanelShot(`${OUT}/panel_settings.png`);
  await page.evaluate(() => { localStorage.removeItem('director-stage.ai'); const p = window.__aiPanel; p.showSettings = false; p.render(); });
  ok('设置：只存本机 localStorage、不进场景文档、密钥输入框为密码框', v8.stored && !v8.docHasKey && v8.pwd === 'password', JSON.stringify(v8));

  // 三种模式的抽屉截图（产品侧手动验收）
  for (const mode of ['generate', 'modify', 'image']) {
    await page.click(`.ai-mode[data-mode="${mode}"]`);
    await settle(80);
    await aiPanelShot(`${OUT}/panel_mode_${mode}.png`);
  }
  // 常见笔记本高度：同时展开设置和预制场景，发送按钮仍可见；更矮窗口可滚动触达。
  await page.setViewport({ width: 1440, height: 810, deviceScaleFactor: 1 });
  await page.evaluate(() => { const p = window.__aiPanel; p.showSettings = true; p.mode = 'generate'; p.render(); });
  await settle();
  const laptop = await page.evaluate(() => {
    const drawer = document.querySelector('.ai-capsule').getBoundingClientRect();
    const send = document.querySelector('.ai-send').getBoundingClientRect();
    return send.bottom <= drawer.bottom && send.top >= drawer.top;
  });
  await aiPanelShot(`${OUT}/panel_laptop.png`);
  await page.setViewport({ width: 1440, height: 600, deviceScaleFactor: 1 });
  await page.$eval('.ai-send', (button) => button.scrollIntoView({ block: 'nearest' }));
  const compact = await page.evaluate(() => {
    const drawer = document.querySelector('.ai-capsule').getBoundingClientRect();
    const send = document.querySelector('.ai-send').getBoundingClientRect();
    return send.bottom <= drawer.bottom && send.top >= drawer.top;
  });
  ok('设置与预制互斥展开：810px 高窗口发送按钮可见，600px 高窗口可滚动触达', laptop && compact);
  console.log(`📸 截图在 ${OUT}/（gen_t2.5 / gen_viewport / image_viewport / panel_*）`);
}
