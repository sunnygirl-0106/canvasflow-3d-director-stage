// @ts-check
import { remapSchedule } from './pathGen.js';
import { sameKeyTime } from './keyframes.js';
import { round6 } from '../util/math.js';

const transformTrack = (track, target) => track.target === target && ['pos', 'rot', 'scale'].includes(track.property);

/** 对象自身的变换动画范围；不包含空轨道、约束或群组成员。 */
export function objectAnimationRange(doc, target) {
  let start = Infinity, end = -Infinity, hasAnimation = false;
  for (const path of doc.paths) {
    if (path.target !== target) continue;
    start = Math.min(start, path.start, path.start + path.duration);
    end = Math.max(end, path.start, path.start + path.duration);
    hasAnimation = true;
  }
  for (const track of doc.timeline.tracks) {
    if (!transformTrack(track, target)) continue;
    for (const key of track.keys) {
      if (!Number.isFinite(key.t)) continue;
      start = Math.min(start, key.t);
      end = Math.max(end, key.t);
      hasAnimation = true;
    }
  }
  return hasAnimation ? { start, end } : null;
}

/** 在一次文档事务中统一变换时间；路径内部时间只由 remapSchedule 缩放一次。 */
export function retimeObjectAnimation(doc, target, start, end) {
  const range = objectAnimationRange(doc, target);
  if (!range || (start === range.start && end === range.end)) return;
  const length = range.end - range.start;
  if (start < 0 || end > doc.timeline.duration || end < start ||
      (length > 0 && end - start < 1 / doc.timeline.fps - 1e-6) || (!length && end !== start)) {
    throw new Error('对象动画需位于场景范围内，非零区间至少保留一帧');
  }
  const scale = length ? (end - start) / length : 1;
  const time = t => round6(start + (t - range.start) * scale);
  const precisionError = () => { throw new Error('时间精度不足，不能继续缩短：请保留关键帧和路径节点之间的间隔'); };
  const tracks = doc.timeline.tracks.map(track => {
    if (!transformTrack(track, target)) return track;
    const keys = track.keys.map(key => ({ ...key, t: time(key.t) }));
    if (keys.some((key, i) => i && sameKeyTime(key.t, keys[i - 1].t))) precisionError();
    return { ...track, keys };
  });
  const paths = doc.paths.map(path => {
    if (path.target !== target) return path;
    const next = remapSchedule(path, { start: time(path.start), duration: round6(path.duration * scale) }, { roundTime: round6 });
    const entries = next.schedule.filter(entry => !entry.caption);
    if (next.duration <= 0 || entries.some((entry, i) => i && entry.t <= entries[i - 1].t)) precisionError();
    return next;
  });
  doc.timeline.tracks = tracks;
  doc.paths = paths;
}
