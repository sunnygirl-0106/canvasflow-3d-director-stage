import { page } from './harness.mjs';

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export async function settle(ms = 60) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await sleep(ms);
}

export async function gizmoDrag(axis, delta, { hold } = {}) {
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
  if (hold)
    await hold();
  await page.mouse.up();
  await settle();
}

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

export function mp4Info(buf) {
  const out = {};
  const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);
  const walk = (start, end) => {
    for (let p = start; p + 8 <= end;) {
      let size = buf.readUInt32BE(p);
      const type = buf.toString('latin1', p + 4, p + 8);
      let hdr = 8;
      if (size === 1) {
        size = Number(buf.readBigUInt64BE(p + 8));
        hdr = 16;
      }
      if (size < hdr)
        break;
      const body = p + hdr;
      if (CONTAINERS.has(type))
        walk(body, p + size);
      else if (type === 'mvhd') {
        const v = buf[body];
        const ts = v === 1 ? buf.readUInt32BE(body + 20) : buf.readUInt32BE(body + 12);
        const du = v === 1 ? Number(buf.readBigUInt64BE(body + 24)) : buf.readUInt32BE(body + 16);
        out.duration = du / ts;
      }
      else if (type === 'tkhd' && out.width == null) {
        const v = buf[body];
        const off = body + (v === 1 ? 88 : 76);
        out.width = buf.readUInt32BE(off) / 65536;
        out.height = buf.readUInt32BE(off + 4) / 65536;
      }
      else if (type === 'stsd' && !out.codec)
        out.codec = buf.toString('latin1', body + 12, body + 16);
      else if (type === 'stsz' && out.frames == null)
        out.frames = buf.readUInt32BE(body + 8);
      p += size;
    }
  };
  walk(0, buf.length);
  return out;
}
