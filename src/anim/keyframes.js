// @ts-check
import { clone } from '../util/math.js';

/** 文档编辑使用的同刻容差；UI 命中容差由界面自行决定。 */
export const KEY_TIME_EPS = 1e-9;
export const sameKeyTime = (a, b) => Math.abs(a - b) <= KEY_TIME_EPS;

/** 同刻覆盖并按时间排序；不修改输入，新增键的值与调用方隔离。 */
export function upsertKeys(keys, ...incoming) {
  return [
    ...keys.filter((key) => !incoming.some((next) => sameKeyTime(key.t, next.t))),
    ...clone(incoming),
  ].sort((a, b) => a.t - b.t);
}
