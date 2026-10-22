import { page, ok } from '../harness.mjs';

// 检查真正渲出的角色像素，避免仅断言 visible 却漏掉雾效导致的隐形。
export async function run() {
  const samples = await page.evaluate(() => {
    const a = window.__app, c = a.stage.camera, controls = a.rig.controls;
    const back = c.position.clone().sub(controls.target).normalize();
    a.select(null);
    const count = () => {
      a.beforeRender();
      const cv = a.stage.snapshot(c);
      const pixels = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let blue = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 2] > 50 && pixels[i + 2] > pixels[i] * 1.7 && pixels[i + 2] > pixels[i + 1] * 1.1) blue++;
      }
      return blue;
    };
    const samples = [];
    for (const distance of [12, 32, controls.maxDistance]) {
      c.position.copy(controls.target).addScaledVector(back, distance);
      controls.update();
      samples.push({ distance, pixels: count() });
    }
    // 场景缩放与视角拉远是两个独立操作，两者都应可见。
    a.setSceneScale(0.1);
    c.position.copy(controls.target).addScaledVector(back, 12);
    controls.update();
    samples.push({ scale: 0.1, pixels: count() });
    return samples;
  });
  for (const sample of samples) ok('缩小后仍渲染人物', sample.pixels > 10, JSON.stringify(sample));
}
