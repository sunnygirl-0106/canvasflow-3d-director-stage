/** Director trajectory policy. Selection intent and the displayed target are independent. */
export function pathTarget(doc, { selectedId, userSelectedId, editingTarget } = {}) {
  const visible = e => e?.visible !== false && !!e && (!e.parent || doc.entities.find(p => p.id === e.parent)?.visible !== false);
  const find = id => doc.entities.find(e => e.id === id);
  const editing = find(editingTarget);
  if (visible(editing)) return editing.id;
  const selected = find(selectedId);
  if (visible(selected) && (selected.type === 'camera' || selected.type === 'character' && selected.id === userSelectedId)) return selected.id;
  const cameras = doc.entities.filter(e => e.type === 'camera' && visible(e));
  for (const id of [doc.timeline.mainCameraId, doc.scene.activeCameraId]) {
    if (cameras.some(e => e.id === id)) return id;
  }
  return cameras.find(e => doc.paths.some(p => p.target === e.id && hasDisplacement(p)) || doc.timeline.tracks.some(t => t.target === e.id && t.property === 'pos' && hasDisplacement(t)))?.id ?? cameras[0]?.id ?? null;
}

export function hasDisplacement(source) {
  const points = source.points || source.keys?.map(k => k.value) || [];
  return points.some(p => p.some((v, i) => Math.abs(v - points[0][i]) > 1e-6));
}
