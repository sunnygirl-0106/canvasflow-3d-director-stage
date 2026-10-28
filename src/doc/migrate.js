// @ts-check
// 文档版本迁移：按版本号逐级升级到 SCHEMA_VERSION。
// 新增版本时：在 STEPS 里登记 { from, to, up(doc) → doc }，up 只负责相邻两版之间的差异。
import { SCHEMA_VERSION } from './schema.js';
import { clone } from '../util/math.js';
import { unusedTrailColor } from './trailColor.js';
import { Path } from '../anim/Path.js';
import { motionSignature, cameraMotionState } from './cameraMotionState.js';

/** Convert only the serialized representation; geometry and curve choices stay intact. */
export function migratePath(path) {
  // Invalid structural input must reach validate rather than throw during migration.
  if (!path || !Array.isArray(path.points) || path.points.length < 2 || path.points.some(point => !Array.isArray(point) || point.length !== 3 || point.some(value => !Number.isFinite(value)))) return path;
  const { speed, stops, stopTimes, timedSegments, waypointTimes, ...next } = path;
  const lastMarker = path.points.length - (path.closed ? 1 : 2);
  if (stops !== undefined && (!Array.isArray(stops) || stops.some((i, j) => !Number.isInteger(i) || i < 1 || i > lastMarker || (j && i <= stops[j - 1])))) return path;
  if (stopTimes !== undefined && (!Array.isArray(stops) || !Array.isArray(stopTimes) || stopTimes.length !== stops.length || stopTimes.some((t, i) => !Number.isFinite(t) || t <= 0 || t >= path.duration || (i && t <= stopTimes[i - 1])))) return path;
  if (timedSegments !== undefined && (!Array.isArray(timedSegments) || !timedSegments.length || stops?.length || stopTimes?.length || timedSegments.some((part, i) => !part || !Number.isInteger(part.to) || part.from !== (i ? timedSegments[i - 1].to : 0) || part.to <= part.from || part.to >= path.points.length || !Number.isFinite(part.start) || !Number.isFinite(part.end) || part.start < (i ? timedSegments[i - 1].end : 0) || part.end <= part.start || part.end > path.duration))) return path;
  if (waypointTimes !== undefined && (path.closed || timedSegments || !Array.isArray(waypointTimes) || waypointTimes.length !== path.points.length || waypointTimes.some((t, i) => !Number.isFinite(t) || (i ? t <= waypointTimes[i - 1] : t !== 0)) || waypointTimes.at(-1) !== path.duration)) return path;
  const end = path.points.length - (path.closed ? 0 : 1);
  const first = { i: 0, t: 0, curve: speed };
/** @type {import('../types/contracts.js').PathDocument['schedule']} */
  let schedule;
  if (timedSegments?.length) {
    first.segmented = true;
    schedule = [first];
    for (const [index, part] of timedSegments.entries()) {
      const previous = schedule.at(-1);
      if (part.start > previous.t) schedule.push({ i: previous.i, t: part.start });
      schedule.push({ i: index === timedSegments.length - 1 ? end : part.to, t: part.end,
        curve: part.speed ?? speed, ...(part.speed === undefined ? { inherited: true } : {}),
        ...(index < timedSegments.length - 1 ? { stop: true } : {}), ...(part.closed ? { closed: true } : {}) });
    }
    if (schedule.at(-1).t < path.duration) schedule.push({ i: end, t: path.duration });
  } else if (waypointTimes) {
    schedule = waypointTimes.map((t, i) => ({ i, t, ...(i === 0 ? { curve: 'cubic', baseCurve: speed } : {}),
      ...(stops?.includes(i) ? { stop: true } : {}) }));
    if (stopTimes) schedule.push(...stops.map((i, j) => ({ i, t: stopTimes[j], caption: true })));
  } else {
    if (!stopTimes) first.allocation = 'distance';
    schedule = [first, ...(stops || []).map((i, j) => ({ i, t: stopTimes?.[j] ?? 0, stop: true,
      ...(stopTimes ? { captionTime: true } : {}) })), { i: end, t: path.duration }];
  }
  next.schedule = schedule;
  if (first.allocation === 'distance' && stops?.length) {
    const model = new Path(next);
    schedule.slice(1, -1).forEach((entry, index) => { entry.t = model.segmentTimes[index]; });
  }
  return next;
}

/** Only valid preset signatures are refreshed; stale signatures must remain stale. */
const STEPS = [{ from: 'director-stage/0.1', to: 'director-stage/0.2', up(doc) {
  const valid = Object.keys(doc.meta?.cameraMoves || {}).filter(id => cameraMotionState(doc, id));
  if (Array.isArray(doc.paths)) doc.paths = doc.paths.map(migratePath);
  for (const id of valid) doc.meta.cameraMoves[id].signature = motionSignature(doc, id);
  return doc;
} }];

/**
 * 把文档升级到当前版本。不修改入参（深拷贝后升级）。
 * 版本无法识别时原样返回，交给 validate 报"版本未知"。
 */
export function migrate(input) {
  if (input === null || typeof input !== 'object') return input;
  let doc = clone(input);
  for (let guard = 0; doc.schema !== SCHEMA_VERSION && guard <= STEPS.length; guard++) {
    const step = STEPS.find((s) => s.from === doc.schema);
    if (!step) break;
    doc = step.up(doc);
    doc.schema = step.to;
  }
  if (doc.schema === SCHEMA_VERSION && Array.isArray(doc.entities)) {
    // 迁移先于校验；损坏条目保持原样，由校验器提供字段位置。
    const used = new Set(doc.entities.map(e => e?.trailColor).filter(Boolean));
    for (const e of doc.entities) {
      if (e?.type !== 'character' || e.trailColor) continue;
      e.trailColor = unusedTrailColor(used);
      used.add(e.trailColor);
    }
  }
  return doc;
}
