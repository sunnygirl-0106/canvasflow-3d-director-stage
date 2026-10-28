import { toast, toastError, confirmToast } from '../util/dom.js';
import { aimPoint } from '../anim/Constraint.js';
import { cameraMove, defaultParams, MoveError, MOVE_LABEL, PANEL_LABEL, PANEL_DURATION } from '../anim/cameraMoves.js';
import { cameraAnimation, moveContext, aheadPoint, nearestSubject, applyCameraMove, clearCameraMoves, removeCameraMoveTail } from '../doc/edit.js';
import { cameraMotionState, motionSignature } from '../doc/cameraMotionState.js';
import { round4, clone, R2D } from '../util/math.js';

const fmt = (s) => (Math.round(s * 10) / 10).toString();

/**
 * 机位运镜：手动卡片写入路径 / 旋转，缺省时补充注视，保留已有约束；一次撤销。
 * Inspector「运镜」段只管显示，写操作全在这里（selftest 也直接调）。
 *
 * 手动卡片使用 doc.meta.cameraMoves 保存参数、主体、生成起始位姿与结果签名；
 * 节点编辑使签名失效后显示为自定义轨迹。旧 build/commit 段接口仍供现有集成调用，
 * 它的追加段逆操作与表单使用 app.moveMeta / this.form 会话状态。
 */
export class CameraMoveTool {
  constructor(app) {
    this.app = app;
    this.form = {}; // cameraId → { name, subject: '' | id | '__point', point, params }
  }

  get meta() { return this.app.moveMeta; }

  current(cam) { return cameraMotionState(this.app.store.document, cam.id); }

  /** 新建从播放头的实际位姿开始；已有预设替换/调参复用保存的起点。 */
  presetOrigin(cam) {
    const saved = this.current(cam)?.segments[0]?.origin;
    if (saved) return clone(saved);
    const time = round4(this.app.playback.time);
    return this.atTime(time, () => ({
      position: cam.root.position.toArray(),
      rot: [cam.root.rotation.x, cam.root.rotation.y, cam.root.rotation.z].map(v => v * R2D),
      roll: cam.roll || 0, time,
    }));
  }

  defaultSubject(cam, origin) {
    const valid = id => this.subjects(cam).some(s => s.value === id);
    const look = this._anim(cam).lookAts.findLast(c => (c.start ?? 0) <= origin.time && (c.end == null || c.end >= origin.time) && (Array.isArray(c.subject) || valid(c.subject)));
    if (look) return clone(look.subject);
    const manual = cam.lookTarget.toArray();
    return manual.every(Number.isFinite) && Math.hypot(...manual.map((v, i) => v - origin.position[i])) > .001 ? manual : aheadPoint({ pos: origin.position, rot: origin.rot });
  }

  /** 替换整条运镜、编辑已保存的末段，或追加一段；每次操作只提交一个事务。 */
  applyPreset(cam, name, { params, subject, reset = false, mode = 'replace' } = {}) {
    const current = this.current(cam), last = current?.segments.at(-1);
    const append = mode === 'append', editing = mode === 'edit';
    if (!['replace', 'edit', 'append'].includes(mode)) return this._presetError('未知运镜操作');
    if (editing && last?.name !== name) return this._presetError('当前运镜已变化，请重新选择参数');
    const hadMoves = this.hasMoves(cam);
    const { lookAts, rotTrack } = this._anim(cam);
    const needsDefaultLook = name !== 'pan' && !lookAts.length && !rotTrack?.keys.length;
    const samePreset = !current?.customPrefix && current?.segments.length === 1 && last.name === name;
    if (mode === 'replace' && !reset && !params && subject === undefined && samePreset) {
      if (needsDefaultLook) return this.applyPreset(cam, name, { mode: 'edit' });
      this.error = null; return true;
    }
    this.app.playback.pause();
    let origin = this.presetOrigin(cam);
    if (append) {
      const ctx = this.context(cam);
      origin = { position: ctx.position, rot: ctx.rot, roll: ctx.roll || 0, time: ctx.time };
      const endpoint = ctx.path && (ctx.path.closed ? ctx.path.points[0] : ctx.path.points.at(-1));
      if (endpoint && Math.hypot(...endpoint.map((v, i) => v - origin.position[i])) > .0001) return this._presetError('轨迹末端正由跟随控制，实际位置与轨迹终点不同。请先调整跟随生效时间，再追加运镜；原轨迹已保留。');
    }
    const editTail = editing && (current.customPrefix || current.segments.length > 1);
    const extendsMotion = append || editTail;
    if (editing) origin = clone(last.origin);
    const inherit = append && last?.name === name;
    let aim;
    this.atTime(origin.time, () => {
      subject = subject ?? (editing ? last.subject : this.defaultSubject(cam, origin));
      // With no explicit current target, repeating a preset keeps its generation subject.
      if (inherit && !this._anim(cam).lookAts.some(c => (c.start ?? 0) <= origin.time && (c.end == null || c.end >= origin.time))) subject = last.subject;
      aim = editing ? last.aim : this._aim(subject);
    });
    if (!aim) return this._presetError('生成参考对象已不存在，请在摄像机属性中选择目标');
    const defaults = { ...defaultParams(name, { position: origin.position, aim }), duration: PANEL_DURATION[name] };
    if (name === 'push_in') {
      const ent = typeof subject === 'string' && this.app.findEntity(subject);
      const height = ent?.type === 'character' ? ent.height * ent.root.scale.y / ent.baseScale : 1.7;
      defaults.minSubjectDist = Math.max(.3, .35 * height);
    }
    const next = { ...defaults, ...(!reset && (editing || inherit) ? last.params : {}), ...params };
    if (name === 'half_orbit' && (next.sweep < 30 || next.sweep > 180)) return this._presetError('半弧角度范围为 30–180°');
    if (['circle', 'spiral'].includes(name) && (next.sweep <= 0 || next.sweep > 360)) return this._presetError('角度范围为 1–360°');
    if (!needsDefaultLook && editing && JSON.stringify(next) === JSON.stringify(last.params) && JSON.stringify(subject) === JSON.stringify(last.subject)) { this.error = null; return true; }
    const detached = this.app.directorDetached;
    try {
      this.app.directorDetached = true;
      this.app.history.capture();
      this.app.store.transact(append ? '追加运镜' : editing ? '编辑运镜参数' : '替换运镜', doc => {
        if (editTail) removeCameraMoveTail(doc, cam.id, last);
        applyCameraMove(doc, cam.id, {
          name, subject, aim, params: next, origin, time: origin.time,
          preserveConstraints: true,
          preservePositionKeys: extendsMotion,
          ownPan: !editing || current?.segments.some(s => s.name === 'pan'),
          mode: extendsMotion ? 'append' : 'replace',
          lastPan: append && last?.name === 'pan'
            ? { start: last.origin.time, duration: last.params.duration, rotEnd: origin.rot }
            : null,
        });
        doc.timeline.duration = Math.max(doc.timeline.duration, origin.time + next.duration);
        const segment = { name, subject: clone(subject), aim: aim.slice(), params: next, origin };
        doc.meta.cameraMoves ||= {};
        const state = { signature: motionSignature(doc, cam.id), segments: [segment] };
        if (append) state.segments = [...(current?.segments || []), segment];
        else if (editTail) state.segments = [...current.segments.slice(0, -1), segment];
        if (extendsMotion && (current?.customPrefix || !current && hadMoves)) state.customPrefix = true;
        doc.meta.cameraMoves[cam.id] = state;
      });
      this.app.history.capture();
      this.error = null;
      toast(`已${append ? '追加' : editing ? '更新' : '替换为'}${PANEL_LABEL[name]}运镜`, { action: { label: '撤销', onClick: () => this.app.history.undo() } });
      this.app.stage.invalidate();
      return true;
    } catch (err) {
      this.app.directorDetached = detached;
      return this._presetError(err.errors?.[0] || err.message);
    }
  }

  _presetError(message) { this.error = message; return false; }

  // ---- 表单 ----
  formOf(cam) {
    let f = this.form[cam.id];
    if (!f) f = this.form[cam.id] = { name: 'push_in', subject: '__point', point: null, params: {} };
    if (!f.point) f.point = cam.lookTarget.toArray();
    return f;
  }

  /** 改预设：参数回到默认。 */
  setName(cam, name) { const f = this.formOf(cam); f.name = name; f.params = {}; }

  // ---- 主体 ----
  /** 可选主体：除自己外的实体（含群众成员）。 */
  subjects(cam) {
    const out = [];
    for (const e of this.app.entities) {
      if (e !== cam && e.visible && e.type !== 'camera') out.push({ value: e.id, label: e.name });
      for (const m of e.visible ? e.children : []) if (m.visible) out.push({ value: m.id, label: `${e.name} / ${m.name}` });
    }
    return out;
  }

  /** 默认主体：离机位最近的角色（含群众成员）；没有角色取最近的其他实体；什么都没有 = 机位前方 3 m 的点。 */
  nearestSubject(cam) {
    const doc = this.app.store.document;
    const aimOf = (id) => aimPoint(this.app, id)?.toArray() ?? null; // 场景实测注视点
    return nearestSubject(doc, cam.id, this.context(cam).position, aimOf) ?? this._aheadPoint(cam);
  }

  _aheadPoint(cam) { return aheadPoint(cam.transformJSON(this.app.timeline.baseOf(cam) || cam.root)); }

  /** 表单里的主体 → 约束 subject（实体 id 或 [x,y,z]）。 */
  resolveSubject(cam) {
    const f = this.formOf(cam);
    if (f.subject === '__point') return f.point.slice();
    if (f.subject && this.app.findEntity(f.subject)) return f.subject;
    return this.nearestSubject(cam);
  }

  // ---- 现状 ----
  _anim(cam) { return cameraAnimation(this.app.store.document, cam.id); }

  /** 签名：机位路径 + rot 轨道键（判断会话态的段是否仍与文档一致）。 */
  _sig({ path, rotTrack }) {
    return JSON.stringify({
      path: path && { points: path.points, closed: path.closed, start: path.start, duration: path.duration, stops: path.stops, stopTimes: path.stopTimes, timedSegments: path.timedSegments, waypointTimes: path.waypointTimes },
      rot: rotTrack?.keys || null,
    });
  }

  /** 签名为 sig 时仍有效的段：最后一段签名等于 sig 的最长前缀。 */
  _prefix(cam, sig) {
    const segs = this.meta[cam.id]?.segments || [];
    for (let i = segs.length - 1; i >= 0; i--) if (segs[i].sig === sig) return segs.slice(0, i + 1);
    return [];
  }

  /** 仍与文档一致的段。 */
  segments(cam) { return this._prefix(cam, this._sig(this._anim(cam))); }

  /**
   * 下一段运镜从哪里开始：已有路径 → 路径终点 + 结束时刻；只有摇镜头段 → 最后一段结束时刻、摇到的朝向；
   * 否则 = 机位手动值（active 时取 base）+ 当前时刻。
   */
  context(cam) {
    const { app } = this;
    const segs = this.segments(cam);
    const saved = this.current(cam)?.segments.at(-1);
    const pan = saved?.name === 'pan' ? { start: saved.origin.time, duration: saved.params.duration, rotEnd: this._anim(cam).rotTrack.keys.at(-1).value } : segs.at(-1) || null;
    const ctx = moveContext(app.store.document, cam.id, { time: round4(app.playback.time), lastPan: pan });
    if (!ctx.path) {
      const { posTrack, rotTrack } = this._anim(cam);
      const ends = [posTrack, rotTrack].flatMap(t => t?.keys.length ? [t.keys.at(-1).t] : []);
      if (ends.length) { ctx.time = Math.max(...ends); ctx.append = true; }
    }
    this.atTime(ctx.time, () => {
      ctx.position = cam.root.position.toArray();
      ctx.rot = [cam.root.rotation.x, cam.root.rotation.y, cam.root.rotation.z].map(v => v * R2D);
    });
    return ctx;
  }

  /** Sample the same evaluator used by playback, restoring all runtime state afterwards. */
  atTime(time, read) {
    const tl = this.app.timeline, active = tl.active, previous = tl.time;
    try { tl.evaluate(time); return read(); }
    finally { if (active) tl.evaluate(previous); else tl.stop(); }
  }

  /** 表单参数（缺省项 = 默认值，按当前起点与主体计算）。 */
  params(cam) {
    const f = this.formOf(cam);
    const ctx = this.context(cam);
    const aim = this._aim(this.resolveSubject(cam));
    return { ...defaultParams(f.name, { position: ctx.position, aim: aim || ctx.position }), ...f.params };
  }

  _aim(subject) {
    const p = aimPoint(this.app, subject);
    return p ? p.toArray() : null;
  }

  /**
   * 按表单生成（不写文档）：→ { name, subject, ctx, move } 或 { error }。
   * 摇镜头不能接在路径后面。
   */
  build(cam) {
    const f = this.formOf(cam);
    const ctx = this.context(cam);
    const subject = this.resolveSubject(cam);
    const aim = this._aim(subject);
    if (!aim) return { error: '主体不存在' };
    if (f.name === 'pan' && ctx.path) return { error: '摇镜头请单独使用或放在最前' };
    try {
      const move = cameraMove(f.name, { position: ctx.position, rot: ctx.rot, roll: ctx.roll, aim, params: this.params(cam) });
      return { name: f.name, subject, ctx, move };
    } catch (err) {
      if (err instanceof MoveError) return { error: err.message };
      throw err;
    }
  }

  // ---- 写入 ----
  /** 「应用 / 追加」：先处理冲突（已有位置关键帧 / 旋转关键帧 → 确认删除），再写入。 */
  request(cam) {
    const b = this.build(cam);
    if (b.error) { toast(b.error); return; }
    const { posTrack, rotTrack } = this._anim(cam);
    const go = () => this.commit(cam, b);
    const ownRot = this.segments(cam).some((s) => s.kind === 'pan');
    if (b.move.points && posTrack && !b.ctx.path) confirmToast('该机位已有位置关键帧，应用运镜将删除它们', '删除并继续', go);
    else if (b.move.rotKeys && rotTrack?.keys.length && !ownRot) confirmToast('该机位已有旋转关键帧，摇镜头将替换它们', '替换', go);
    else go();
  }

  /**
   * 写入一段运镜（一次撤销）。b = build() 的结果。数据由 edit.applyCameraMove 生成（与 AI 同一份）。
   * @returns {object|null} 新段（会话态），失败 null
   */
  commit(cam, b) {
    const { app } = this;
    const tl = app.timeline;
    const { ctx, subject, name } = b;
    const before = this._anim(cam);
    const segs = this.segments(cam);
    const params = this.params(cam);
    let res;
    try {
      app.store.transact('应用运镜', (doc) => {
        res = clone(applyCameraMove(doc, cam.id, {
          name, subject, aim: this._aim(subject), params, time: ctx.time,
          lastPan: segs[segs.length - 1] || null, ownPan: segs.some((s) => s.kind === 'pan'),
        }));
      });
    } catch (err) { toastError(err); return null; }
    const { move, start, undo } = res;
    const { rotEnd, ...rest } = undo;
    const seg = { name, params, subject, start, duration: move.duration, kind: move.points ? 'path' : 'pan', undo: rest };
    if (rotEnd) seg.rotEnd = rotEnd;

    seg.sig = this._sig(this._anim(cam));
    this.meta[cam.id] = { segments: [...this._prefix(cam, this._sig(before)), seg] };
    const end = start + move.duration;
    const over = end > tl.duration ? `（结束于 ${fmt(end)} s，超出时间轴时长）` : '';
    toast(`${ctx.append ? '已追加' : '已应用'}运镜：${MOVE_LABEL[name]} ${fmt(start)}–${fmt(end)} s${over}`);
    return seg;
  }

  /** 删除最后一段：路径切回上一段、注视窗口还原（一次撤销）。 */
  removeLast(cam) {
    const segs = this.segments(cam);
    const seg = segs[segs.length - 1];
    if (!seg) return false;
    const tl = this.app.timeline;
    const cur = this._anim(cam);
    const u = seg.undo;
    try {
      this.app.store.batch('删除运镜段', () => {
        if (seg.kind === 'path') {
          if (u.path) tl.updatePath(cur.path.id, u.path);
          else tl.removePath(cur.path.id);
        } else if (u.track) tl.removeTrack(u.track);
        else for (const t of u.keys.times) tl.removeKey(u.keys.track, t);
        if (u.added && cur.lookAts.some((c) => c.id === u.added)) tl.removeConstraint(u.added);
        for (const p of u.patched) if (cur.lookAts.some((c) => c.id === p.id)) tl.updateConstraint(p.id, { end: p.end });
        for (const c of u.removed) tl.addConstraint(c);
      });
    } catch (err) { toastError(err); return false; }
    // 不截断 meta：签名回到上一段，段列表自然少一段；⌘Z 后签名又等于这一段，列表恢复
    toast(`已删除运镜段：${MOVE_LABEL[seg.name]}`);
    return true;
  }

  /** 清除运镜：删除位置与旋转动画，保留摄像机属性中的约束（一次撤销）。 */
  clear(cam) {
    const { app } = this;
    try {
      app.store.transact('清除运镜', (doc) => { clearCameraMoves(doc, cam.id, { preserveConstraints: true }); });
    } catch (err) { toastError(err); return; }
    delete this.meta[cam.id];
    this.error = null; this.appendCameraId = null;
    toast('已清除运镜');
  }

  /** 是否有可清除的运镜数据。 */
  hasMoves(cam) {
    const { path, rotTrack, posTrack } = this._anim(cam);
    return !!(path || rotTrack?.keys.length || posTrack?.keys.length);
  }
}
