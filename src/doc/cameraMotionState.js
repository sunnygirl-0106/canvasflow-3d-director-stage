/** Persisted preset identity is valid only while its generated motion still matches. */
export function motionSignature(doc, id) {
  return JSON.stringify({
    paths: doc.paths.filter(p => p.target === id),
    tracks: doc.timeline.tracks.filter(t => t.target === id && ['pos', 'rot'].includes(t.property)),
    constraints: doc.constraints.filter(c => c.target === id),
  });
}

export function cameraMotionState(doc, id) {
  const state = doc.meta.cameraMoves?.[id];
  return state?.signature === motionSignature(doc, id) ? state : null;
}
