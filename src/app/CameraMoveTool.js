// @ts-check
import { toast, toastError } from '../util/dom.js';
import { aimPoint } from '../anim/Constraint.js';
import { defaultParams, PANEL_LABEL, PANEL_DURATION } from '../anim/cameraMoves.js';
import { cameraAnimation, moveContext, aheadPoint, applyCameraMove, clearCameraMoves, removeCameraMoveTail } from '../doc/edit.js';
import { cameraMotionState, motionSignature } from '../doc/cameraMotionState.js';
import { round4, clone, R2D } from '../util/math.js';

/** 机位当前朝向（XYZ 欧拉角，度；不舍入）。 */
const rotationDeg = (cam) => [cam.root.rotation.x, cam.root.rotation.y, cam.root.rotation.z].map(v => v * R2D);

/**
 * 机位运镜：手动卡片写入路径 / 旋转，缺省时补充注视，保留已有约束；一次撤销。
 * Inspector「运镜」段只管显示，写操作全在这里（selftest 也直接调）。
 *
 * 手动卡片使用 doc.meta.cameraMoves 保存参数、主体、生成起始位姿与结果签名；
 */
export class CameraMoveTool {
  constructor(app) {
    this.app = app;
  }

  current(cam) { return cameraMotionState(this.app.store.document, cam.id); }

  /** 新建从播放头的实际位姿开始；已有预设替换/调参复用保存的起点。 */
  presetOrigin(cam) {
    const saved = this.current(cam)?.segments[0]?.origin;
    if (saved) return clone(saved);
    const time = round4(this.app.playback.time);
    return this.atTime(time, () => ({
      position: cam.root.position.toArray(),
      rot: rotationDeg(cam),
      roll: cam.rollRad * R2D, time,
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
  /** @param {import('../entities/Camera.js').CameraEntity} cam
   * @param {string} name
   * @param {{params?:import('../anim/cameraMoves.js').MoveParams, subject?:string|number[], reset?:boolean, mode?:string}} [options] */
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
    /** @type {import('../anim/cameraMoves.js').MoveParams} */
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

  // ---- 现状 ----
  _anim(cam) { return cameraAnimation(this.app.store.document, cam.id); }

  /**
   * 下一段运镜从哪里开始：已有路径 → 路径终点 + 结束时刻；只有摇镜头段 → 最后一段结束时刻、摇到的朝向；
   * 否则 = 机位手动值（active 时取 base）+ 当前时刻。
   */
  context(cam) {
    const { app } = this;
    const saved = this.current(cam)?.segments.at(-1);
    const pan = saved?.name === 'pan' ? { start: saved.origin.time, duration: saved.params.duration, rotEnd: this._anim(cam).rotTrack.keys.at(-1).value } : null;
    const ctx = moveContext(app.store.document, cam.id, { time: round4(app.playback.time), lastPan: pan });
    if (!ctx.path) {
      const { posTrack, rotTrack } = this._anim(cam);
      const ends = [posTrack, rotTrack].flatMap(t => t?.keys.length ? [t.keys.at(-1).t] : []);
      if (ends.length) { ctx.time = Math.max(...ends); ctx.append = true; }
    }
    this.atTime(ctx.time, () => {
      ctx.position = cam.root.position.toArray();
      ctx.rot = rotationDeg(cam);
    });
    return ctx;
  }

  /** Sample the same evaluator used by playback, restoring all runtime state afterwards. */
  atTime(time, read) {
    const tl = this.app.timeline, active = tl.active, previous = tl.time;
    try { tl.evaluate(time); return read(); }
    finally { if (active) tl.evaluate(previous); else tl.stop(); }
  }

  _aim(subject) {
    const p = aimPoint(this.app, subject);
    return p ? p.toArray() : null;
  }

  /** 清除运镜：删除位置与旋转动画，保留摄像机属性中的约束（一次撤销）。 */
  clear(cam) {
    const { app } = this;
    try {
      app.store.transact('清除运镜', (doc) => { clearCameraMoves(doc, cam.id, { preserveConstraints: true }); });
    } catch (err) { toastError(err); return; }
    this.error = null; this.appendCameraId = null;
    toast('已清除运镜');
  }

  /** 是否有可清除的运镜数据。 */
  hasMoves(cam) {
    const { path, rotTrack, posTrack } = this._anim(cam);
    return !!(path || rotTrack?.keys.length || posTrack?.keys.length);
  }
}
