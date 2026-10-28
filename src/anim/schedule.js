// @ts-check
/** Schedule entries own timing; these views never become document fields. */
export const pathCurve = path => path.schedule[0].baseCurve ?? path.schedule[0].curve;
export const motionEntries = path => path.schedule.filter(entry => !entry.caption);
export const stopEntries = path => motionEntries(path).filter(entry => entry.stop && entry.i > 0 && entry.i < path.points.length - (path.closed ? 0 : 1));
export const captionEntries = path => path.schedule.filter(entry => entry.caption);

/** Explicit motion intervals exclude repeated-vertex dwell intervals. */
export function scheduleSegments(path) {
  const entries = motionEntries(path);
  return entries.slice(1).flatMap((end, i) => {
    const start = entries[i];
    return start.i === end.i ? [] : [{ from: start.i, to: end.i, start: start.t, end: end.t,
      curve: end.curve ?? pathCurve(path), ...(end.inherited ? { inherited: true } : {}), ...(end.closed !== undefined ? { closed: end.closed } : {}) }];
  });
}

/** Fresh paths use the same default curve in both the editor and evaluator. */
export function endpointSchedule(points, closed, duration, curve = 'linear') {
  return [{ i: 0, t: 0, curve, allocation: 'distance' }, { i: points.length - (closed ? 0 : 1), t: duration }];
}

/** The speed selector changes the default curve, not explicitly authored intervals. */
export function curveSchedule(path, curve) {
  return path.schedule.map((entry, i) => i === 0
    ? { ...entry, ...(entry.curve === 'cubic' ? { baseCurve: curve } : { curve }) }
    : entry.inherited ? { ...entry, curve } : { ...entry });
}
