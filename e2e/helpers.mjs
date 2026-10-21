// 端到端自测的共用操作：截图 / 像素对比 / 真实点击拖拽 / 读状态。都作用在 harness 的同一个 page 上。
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { page } from './harness.mjs';

/** 视口截图（含名牌 / 取景框叠加层），先等两帧让按需渲染出图。 */
export async function shootViewport(file) {
  await page.evaluate(() => new Promise((r) => { window.__app.stage.invalidate(); requestAnimationFrame(() => requestAnimationFrame(r)); }));
  await new Promise((r) => setTimeout(r, 150));
  const vp = await page.$('#viewport');
  await vp.screenshot({ path: file });
  return file;
}

/** 两张 PNG 的差异像素占比（pixelmatch threshold 0.1），差异图写到 diffFile。 */
export function pixelDiff(fa, fb, diffFile) {
  const a = PNG.sync.read(fs.readFileSync(fa));
  const b = PNG.sync.read(fs.readFileSync(fb));
  if (a.width !== b.width || a.height !== b.height) return 1;
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  if (n && diffFile) fs.writeFileSync(diffFile, PNG.sync.write(diff));
  return n / (a.width * a.height);
}

/** 动画验收场景：2 角色、1 道具、2 机位（从空场景搭起）。返回各实体 id。 */
export async function buildAnimScene() {
  return page.evaluate(async () => {
    const { createEmptyDocument } = await import('/src/doc/schema.js');
    const a = window.__app;
    a.playback?.stop();
    await a.loadDocument(createEmptyDocument());
    const m = await a.addCharacter('male');
    m.root.position.x = -1.2; m.root.rotation.y = 0.4; a.edited(m);
    const f = await a.addCharacter('female');
    f.root.position.set(1.0, f.root.position.y, 0.6);
    f.applyPosePreset('think'); a.edited(f);
    const p = a.addProp('box'); p.root.position.set(0.2, 0, -1.4); a.edited(p);
    a.select(m.id);
    const c1 = a.addCamera('front_mid');
    a.select(f.id);
    const c2 = a.addCamera('front_closeup');
    a.select(null);
    a.rig.controls.target.set(0, 0.9, -0.5); a.stage.camera.position.set(3.5, 3.2, 8.5); a.rig.controls.update();
    a.history.reset();
    return { m: m.id, f: f.id, p: p.id, c1: c1.id, c2: c2.id };
  });
}

// ---- 时间轴面板验收（阶段 D）：真实点击 / 拖拽 ----
// 用函数声明（会提升）：子命令分发在文件前部，调用时这些定义还没执行到
export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** 等界面刷新：两帧 rAF（Inspector / 标尺都是 rAF 节流）+ 一点余量。 */
export async function settle(ms = 60) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await sleep(ms);
}

export async function centerOf(sel) {
  const r = await page.$eval(sel, (n) => { const b = n.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; });
  return r;
}

export async function clickSel(sel, opts) { const [x, y] = await centerOf(sel); await page.mouse.click(x, y, opts); }

export async function dragFromTo([x0, y0], [x1, y1], { steps = 10, hold } = {}) {
  await page.mouse.move(x0, y0);
  await sleep(30);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps });
  if (hold) await hold();
  await page.mouse.up();
  await settle();
}

/** 左栏点选实体（按名字）。 */
export async function pickInOutliner(name) {
  const xy = await page.evaluate((name) => {
    const n = [...document.querySelectorAll('#outliner .node')].find((x) => x.querySelector('.nm')?.textContent === name);
    if (!n) return null;
    const b = n.getBoundingClientRect();
    return [b.x + 40, b.y + b.height / 2];
  }, name);
  if (!xy) throw new Error('左栏找不到 ' + name);
  await page.mouse.click(...xy);
  await settle();
}

/** 时刻 t 在标尺上的屏幕坐标。 */
export async function rulerPoint(t) {
  return page.evaluate((t) => {
    const p = window.__timelinePanel;
    const r = p.scroll.getBoundingClientRect();
    const rr = p.rulerRow.getBoundingClientRect();
    return [r.left + p.timeToX(t) - p.scroll.scrollLeft, rr.top + rr.height / 2];
  }, t);
}

/** 拖播放头：从当前位置按下，拖到 t。 */
export async function dragPlayhead(t) {
  const cur = await page.evaluate(() => window.__app.playback.time);
  await dragFromTo(await rulerPoint(cur), await rulerPoint(t), { steps: 8 });
}

/**
 * 真实拖 gizmo 的某个轴箭头，使选中对象沿该轴移动 worldDelta（世界坐标）：
 * 按在箭头上（拾取体 0..0.6 × 手柄尺度），拖到"箭头点 + 位移"的投影处。
 */
export async function gizmoDrag(axis, delta) {
  const pts = await page.evaluate((axis, delta) => {
    const a = window.__app;
    a.stage.render();
    const h = a.gizmo.translateHandle(axis);
    const V = () => a.stage.camera.position.clone().set(0, 0, 0);
    const dir = V().set(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
    const p0 = h.position.clone().add(dir.clone().multiplyScalar(0.4 * h.scale.x));
    const p1 = p0.clone().add(dir.clone().multiplyScalar(delta));
    const cam = a.getRenderCamera();
    const r = a.stage.renderer.domElement.getBoundingClientRect();
    const scr = (p) => { const n = p.clone().project(cam); return [r.left + (n.x + 1) / 2 * r.width, r.top + (1 - n.y) / 2 * r.height]; };
    return [scr(p0), scr(p1)];
  }, axis, delta);
  await page.mouse.move(pts[0][0] - 6, pts[0][1]);
  await page.mouse.move(...pts[0], { steps: 3 }); // 悬停：TransformControls 先拾取到轴
  await sleep(40);
  await page.mouse.down();
  await page.mouse.move(...pts[1], { steps: 16 });
  await page.mouse.up();
  await settle();
}

/** 视口画布像素（同步渲染后立即读，时刻与画面严格对应），写成 PNG。 */
export async function canvasShot(file) {
  const url = await page.evaluate(() => { const a = window.__app; a.stage.render(); return a.stage.renderer.domElement.toDataURL('image/png'); });
  fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  return file;
}

// ---- 角色路径验收（阶段 E）：真实点击 / 拖拽 ----
/** 文档口径的点（stage.world 局部坐标）→ 屏幕坐标。 */
export async function scr(p) {
  return page.evaluate((p) => {
    const a = window.__app;
    a.stage.world.updateMatrixWorld(true);
    const v = a.stage.camera.position.clone().set(p[0], p[1], p[2]);
    a.stage.world.localToWorld(v).project(a.getRenderCamera());
    const r = a.stage.renderer.domElement.getBoundingClientRect();
    return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height];
  }, p);
}

/** Dock「路径」→ 选一种方式。 */
export async function pathMenu(label) {
  await clickSel('#dock .dockbtn[title^="路径"]');
  await settle();
  await page.evaluate((l) => [...document.querySelectorAll('#dock .dockmenu.open .menu-item')].find((n) => n.textContent.includes(l)).click(), label);
  await settle();
}

export function toastText() { return page.$eval('#toast', (n) => (n.classList.contains('show') ? n.textContent : '')); }

export async function toastClick(label) {
  await page.evaluate((l) => [...document.querySelectorAll('#toast .toast-action')].find((b) => b.textContent === l).click(), label);
  await settle();
}

export function animJSON() { return page.evaluate(() => window.__app.timeline.toJSON()); }

export async function pathOf(id) { return (await animJSON()).paths.find((p) => p.target === id); }

/** 洁净渲染（无 gizmo / 选中环 / 路径 overlay）导演视角画面，写成 PNG。 */
export async function cleanShot(file) {
  const url = await page.evaluate(() => { const a = window.__app; return a.withCleanRender(() => a.stage.snapshot(a.stage.camera)).toDataURL('image/png'); });
  fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  return file;
}

export async function dragPath(points, { steps = 3, hold, shift } = {}) {
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(...points[0]);
  await sleep(30);
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(...p, { steps });
  if (hold) await hold();
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
  await settle(120);
}

export function hdist(a, b) { return Math.hypot(a[0] - b[0], a[2] - b[2]); }

/**
 * 单角色姿势截图：隐藏其余实体与名牌，角色放原点，固定相机出 正面 + 3/4 侧面 两视图拼一张。
 * 渲染走 Stage.snapshot（主渲染器），保证与应用内画面一致且确定。
 */
// ---- 阶段 F：机位运镜 ----
/** Inspector 运镜段：按标签找下拉 / 输入并设值（触发 change）。 */
export async function moveField(label, value) {
  await page.evaluate((label, value) => {
    const f = [...document.querySelectorAll('#inspector [data-sec="move"] .field')].find((x) => x.querySelector('label')?.textContent === label);
    const n = f.querySelector('select, input');
    n.value = String(value);
    n.dispatchEvent(new Event('change'));
  }, label, value);
  await settle();
}

export async function moveBtn(text) {
  await page.evaluate((t) => [...document.querySelectorAll('#inspector [data-sec="move"] .anim-btns button')].find((b) => b.textContent === t).click(), text);
  await settle(120);
}

/** 机位 −Z 与主体注视点方向的夹角（度）+ 注视点投影到画面的偏差（占画幅比例）。 */
export function camAim(camId, subjectId) {
  return page.evaluate(async (camId, subjectId) => {
    const a = window.__app;
    const { aimPoint } = await import('/src/anim/Constraint.js');
    const cam = a.findEntity(camId);
    cam.root.updateMatrixWorld(true);
    const p = aimPoint(a, subjectId);
    const world = a.stage.world;
    world.updateMatrixWorld(true);
    const pw = world.localToWorld(p.clone());
    const fwd = cam.cam.getWorldDirection(p.clone());
    const to = pw.clone().sub(cam.cam.getWorldPosition(p.clone())).normalize();
    const ndc = pw.clone().project(cam.cam);
    return { angle: fwd.angleTo(to) * 180 / Math.PI, off: Math.max(Math.abs(ndc.x), Math.abs(ndc.y)) / 2 };
  }, camId, subjectId);
}

/** 机位位姿（场景根节点坐标）+ 各角色脚底位置（水平距离用）。 */
export function camPose(camId) {
  return page.evaluate((camId) => {
    const a = window.__app;
    const c = a.findEntity(camId);
    const foot = {};
    for (const e of a.entities) if (e.type === 'character') foot[e.id] = e.toJSON().transform.pos;
    return { pos: c.root.position.toArray(), rot: c.root.rotation.toArray().slice(0, 3), foot };
  }, camId);
}

/** 机位的动画数据：路径 / 约束 / rot 轨道。 */
export function camAnim(camId) {
  return page.evaluate((id) => {
    const t = window.__app.timeline.toJSON();
    return {
      path: t.paths.find((p) => p.target === id) || null,
      cns: t.constraints.filter((c) => c.target === id),
      rot: t.timeline.tracks.find((x) => x.target === id && x.property === 'rot') || null,
    };
  }, camId);
}

/** 机位画面（洁净渲染 stage.snapshot），写成 PNG。 */
export async function camShot(camId, file) {
  const url = await page.evaluate((id) => {
    const a = window.__app;
    const c = a.findEntity(id);
    return a.withCleanRender(() => a.stage.snapshot(c.cam, { width: 640, height: 360 })).toDataURL('image/png');
  }, camId);
  fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  return file;
}

// ---- 阶段 G：导出视频 ----
export function md5(buf) { return crypto.createHash('md5').update(buf).digest('hex'); }

export function dataURLBuf(url) { return Buffer.from(url.split(',')[1], 'base64'); }

/** 导出验收场景：走路角色（直线路径）+ 第二个角色 + 半环绕盯人的主机位 + 全景图。 */
export async function buildExportScene() {
  return page.evaluate(async () => {
    const { createEmptyDocument } = await import('/src/doc/schema.js');
    const { aimPoint } = await import('/src/anim/Constraint.js');
    const a = window.__app;
    a.playback.stop();
    await a.loadDocument(createEmptyDocument());
    const m = await a.addCharacter('male');
    m.root.position.x = -1.6; a.edited(m);
    const f = await a.addCharacter('female');
    f.root.position.set(1.2, f.root.position.y, -0.8); a.edited(f);
    const tl = a.timeline;
    tl.setDuration(6);
    tl.addPath({ target: m.id, points: [[-1.6, 0, 0], [1.6, 0, 0.4]], start: 0, duration: 4, speed: 'smooth', orient: 'tangent' });
    a.select(m.id);
    const c = a.addCamera('front_full');
    c.aimAt(a.stage.world.localToWorld(aimPoint(a, m.id).clone())); a.edited(c);
    const mv = a.cameraMoves;
    mv.setName(c, 'half_orbit');
    mv.formOf(c).subject = m.id;
    const seg = mv.commit(c, mv.build(c));
    tl.setMainCamera(c.id);
    await a.panorama.setFromAsset({ url: './assets/panoramas/pano-sunset.jpg', title: '威尼斯黄昏' });
    for (let i = 0; i < 50 && !a.panorama.active; i++) await new Promise((r) => setTimeout(r, 100));
    a.select(null);
    a.rig.controls.target.set(0, 0.9, 0); a.stage.camera.position.set(2.5, 4.5, 9); a.rig.controls.update();
    a.history.reset();
    return { m: m.id, f: f.id, c: c.id, mName: m.name, cName: c.name, seg: !!seg, pano: a.panorama.active };
  });
}

/** 播放头 / 文档 / 撤销栈的状态指纹（导出前后比对）。 */
export function exportState() {
  return page.evaluate(() => {
    const a = window.__app;
    const d = a.exportDocument();
    d.meta.updatedAt = null;
    return { active: a.timeline.active, time: a.playback.time, doc: JSON.stringify(d), hist: a.history.entries.length, idx: a.history.index };
  });
}

/** ffprobe 读时长 / 帧数 / 编码 / 宽高；本机没有 ffprobe 返回 null。 */
export function ffprobe(file) {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries',
      'stream=codec_name,width,height,nb_read_frames:format=duration', '-of', 'json', file], { encoding: 'utf8' });
    const j = JSON.parse(out);
    const st = j.streams[0];
    return { duration: +j.format.duration, frames: +st.nb_read_frames, codec: st.codec_name, width: st.width, height: st.height };
  } catch { return null; }
}

/** 最小 mp4 盒子解析：mvhd 时长、首个视频轨 tkhd 宽高、stsd 编码、stsz 帧数。 */
export function mp4Info(buf) {
  const out = {};
  const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);
  const walk = (start, end) => {
    for (let p = start; p + 8 <= end;) {
      let size = buf.readUInt32BE(p);
      const type = buf.toString('latin1', p + 4, p + 8);
      let hdr = 8;
      if (size === 1) { size = Number(buf.readBigUInt64BE(p + 8)); hdr = 16; }
      if (size < hdr) break;
      const body = p + hdr;
      if (CONTAINERS.has(type)) walk(body, p + size);
      else if (type === 'mvhd') {
        const v = buf[body];
        const ts = v === 1 ? buf.readUInt32BE(body + 20) : buf.readUInt32BE(body + 12);
        const du = v === 1 ? Number(buf.readBigUInt64BE(body + 24)) : buf.readUInt32BE(body + 16);
        out.duration = du / ts;
      } else if (type === 'tkhd' && out.width == null) {
        const v = buf[body];
        const off = body + (v === 1 ? 88 : 76);
        out.width = buf.readUInt32BE(off) / 65536;
        out.height = buf.readUInt32BE(off + 4) / 65536;
      } else if (type === 'stsd' && !out.codec) out.codec = buf.toString('latin1', body + 12, body + 16);
      else if (type === 'stsz' && out.frames == null) out.frames = buf.readUInt32BE(body + 8);
      p += size;
    }
  };
  walk(0, buf.length);
  return out;
}

// ---- 阶段 H：AI 生成（全部用 MockProvider，不依赖网络）----
// 预录回复：按用户输入里的关键字命中（MockProvider 只匹配「用户：」之后的输入）。
// 函数声明（会提升）：子命令在文件前部的顶层 await 里就会调用 aiTest
export function aiInputs() { return { gen: '两个人在广场对话，一个女的站着挥手，一个男的坐着，一个机位半环绕拍他们，5 秒', mod: '让男的站起来走到女的旁边，机位改成推' }; }

export function aiFixturesSrc() {
  return `({
  gen: { ops: [
    { op: 'clear' },
    { op: 'scene', sky: '#6f8fb0', ground: { visible: true, height: 0 } },
    { op: 'add_character', name: '小红', body: 'female', pos: [-0.8, 0, 0], yaw: 90, pose: 'wave' },
    { op: 'add_character', name: '小王', body: 'male', pos: [0.8, 0, 0.1], yaw: -90, pose: 'sit' },
    { op: 'add_camera', name: '机位1', pos: [0, 1.4, 3.6], lookAt: [0, 0.8, 0] },
    { op: 'camera_move', target: '机位1', preset: 'half_orbit', subject: [0, 0.8, 0], duration: 5 },
    { op: 'timeline', duration: 5, mainCamera: '机位1' },
  ], note: '小红站着挥手、小王坐着，两人面对面；机位1 绕两人中点半环绕 5 秒' },
  mod: { ops: [
    { op: 'set_pose', target: '小王', preset: 'stand' },
    { op: 'set_path', target: '小王', path: { kind: 'toward', target: '小红' } },
    { op: 'clear_moves', target: '机位1' },
    { op: 'camera_move', target: '机位1', preset: 'push_in', subject: '小红' },
  ], note: '小王站起来走到小红旁边 0.8 m 处；机位1 改为推近小红' },
})`;
}

export async function aiSend(mode, text, { confirm = true } = {}) {
  await page.click(`.ai-mode[data-mode="${mode}"]`);
  await page.$eval('.ai-text', (t) => { t.value = ''; });
  if (text) await page.type('.ai-text', text);
  await page.focus('.ai-text');
  await page.keyboard.press('Enter');
  await sleep(80);
  if (confirm && await page.$('#toast.show .toast-action')) await toastClick('清空并生成');
  await page.waitForFunction(() => !window.__app.ai.busy, { timeout: 30000 });
  await settle(150);
  return page.evaluate(() => { const t = window.__app.ai.turns.at(-1); return { status: t.status, attempts: t.attempts.length, errors: t.attempts.at(-1).errors, result: t.result, mode: t.mode }; });
}

/** 文档指纹（不含 updatedAt / 导演视角）+ 撤销栈长度。 */
export function aiState() {
  return page.evaluate(() => {
    const a = window.__app;
    const d = a.exportDocument({ view: false });
    d.meta.updatedAt = null;
    return { doc: JSON.stringify(d), hist: a.history.entries.length, idx: a.history.index };
  });
}

export async function aiPanelShot(file) {
  const clip = await page.$eval('.ai-drawer', (n) => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
  await page.screenshot({ path: file, clip });
}
