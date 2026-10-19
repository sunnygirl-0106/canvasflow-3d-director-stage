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

/**
 * 菱形点击（Inspector 属性菱形与时间轴面板「◇ 打键」共用）：当前时刻无键 → 打键（无轨道先建）；有键 → 删键（轨道空了保留）。
 * 时间轴 idle 时 = 在 0 秒打键并 seek(0) 进入 active（"第一次打键"的入口）。出错抛给调用方（toast）。
 */
export function toggleKey(app, ent, prop) {
  const tl = app.timeline, pb = app.playback;
  const idle = !tl.active;
  const t = idle ? 0 : pb.time;
  const st = propState(app, tl.toJSON(), ent.id, prop, t);
  if (st.key) tl.removeKey(st.track.id, st.key.t);
  else {
    const value = tl.valueOf(ent, prop); // 此刻显示的值（idle = 手动值，active = 求值结果）
    const track = st.track || tl.addTrack({ target: ent.id, property: prop });
    tl.setKey(track.id, t, value);
  }
  if (idle) pb.seek(0);
}
