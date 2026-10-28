import { Color } from 'three';

const PALETTE = ['#4dd9ed', '#ff897d', '#f4c85c', '#83d69a', '#76a9ff', '#f49ec4'];

/** 优先用预置轨迹色；用尽后按固定色相序列选取未占用的颜色。 */
export function unusedTrailColor(used) {
  const preset = PALETTE.find(color => !used.has(color));
  if (preset) return preset;
  let index = 0, color;
  do {
    color = `#${new Color().setHSL(((index++ * 0.61803398875) + 0.12) % 1, 0.72, 0.66).getHexString()}`;
  } while (used.has(color));
  return color;
}
