// Existing numerical scenarios also exercise the 0.1 -> 0.2 boundary.
import { Path as SchedulePath } from '../../src/anim/Path.js';
import { PathTrack as ScheduleTrack } from '../../src/anim/PathTrack.js';
import { appendMove as appendScheduleMove } from '../../src/anim/cameraMoves.js';
import { migratePath } from '../../src/doc/migrate.js';
import { pathCurve, stopEntries, captionEntries, motionEntries, scheduleSegments } from '../../src/anim/schedule.js';
export * from '../../src/anim/Path.js';
export * from '../../src/anim/cameraMoves.js';
export const upgradePath = path => path.schedule ? path : migratePath(path);
export class Path extends SchedulePath {
  constructor(path, options) { super(upgradePath(path), options); }
}
export class PathTrack extends ScheduleTrack {
  constructor(path, options) { super(upgradePath(path), options); }
}
export const appendMove = (path, next) => appendScheduleMove(upgradePath(path), next);

// Assert the old contract's numerical values without retaining old document fields.
export function oldFields(path) {
  if (!path.schedule) return path;
  const first = path.schedule[0], markers = stopEntries(path), captions = captionEntries(path);
  const view = { ...path, speed: pathCurve(path) };
  delete view.schedule;
  if (first.segmented) view.timedSegments = scheduleSegments(path).map(section => ({
    from: section.from, to: section.to, start: section.start, end: section.end,
    speed: section.curve, ...(section.closed ? { closed: true } : {}),
  }));
  else {
    if (markers.length) view.stops = markers.map(entry => entry.i);
    if (captions.length) view.stopTimes = captions.map(entry => entry.t);
    else if (markers.some(entry => entry.captionTime)) view.stopTimes = markers.map(entry => entry.t);
    if (first.curve === 'cubic') view.waypointTimes = motionEntries(path).map(entry => entry.t);
  }
  return view;
}
