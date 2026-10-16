const T_EPS = 1e-6; // "当前时刻有键"的判定容差（播放头吸附到帧时为精确相等）

/**
 * 实体某属性在 t 时刻的动画状态（Inspector 菱形 / 灰字用）。
 * @param {object} anim timeline.toJSON() 的结果（同一次刷新里复用）
 * @returns {{ track: object|null, key: object|null, forced: string|null, driven: boolean }}
 *   forced：该时刻被 '路径' / '跟随' / '注视' 强制驱动；driven：显示的是求值结果（有键的轨道或 forced）。
 */
export function propState(app, anim, entId, prop, t) {
  const tl = app.timeline;
  const track = anim.timeline.tracks.find((x) => x.target === entId && x.property === prop) || null;
  const key = track?.keys.find((k) => Math.abs(k.t - t) < T_EPS) || null;
  const forced = tl.forcedProps(entId, t).get(prop) || null;
  const driven = tl.active && (!!track?.keys.length || !!forced);
  return { track, key, forced, driven };
}
