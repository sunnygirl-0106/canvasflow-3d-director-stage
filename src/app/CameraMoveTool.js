import { toast, toastError, confirmToast } from '../util/dom.js';
import { aimPoint } from '../anim/Constraint.js';
import { cameraMove, defaultParams, MoveError, MOVE_LABEL } from '../anim/cameraMoves.js';
import { moveContext, aheadPoint, nearestSubject, applyCameraMove, clearCameraMoves } from '../doc/edit.js';
import { round4 } from '../util/math.js';

const fmt = (s) => (Math.round(s * 10) / 10).toString();

/**
 * 机位运镜：把 cameraMoves 的生成结果写成 path + lookAt 约束（+ pan 的 rot 轨道），一次撤销。
 * Inspector「运镜」段只管显示，写操作全在这里（selftest 也直接调）。
 *
 * 会话态（不进文档）：app.moveMeta[cameraId] = { segments: [...] }，每段记 预设名 / 参数 / 主体 / 时间窗，
 * 以及删末段要用的逆操作和写入后的签名 sig。签名 = 机位路径（points / closed / start / duration）+ rot 轨道键；
 * 段列表只显示签名仍与文档一致的前缀（拖过顶点 / 刷新页面后退化为普通路径；撤销后自然回到对应的段数）。
 *
 * 编辑表单的状态（预设 / 主体 / 用户改过的参数）按机位记在 this.form，同样是会话态。
 */
export class CameraMoveTool {
  constructor(app) {
    this.app = app;
    this.form = {}; // cameraId → { name, subject: '' | id | '__point', point, params }
  }

  get meta() { return this.app.moveMeta; }

  // ---- 表单 ----
  formOf(cam) {
    let f = this.form[cam.id];
    if (!f) f = this.form[cam.id] = { name: 'push_in', subject: '', point: null, params: {} };
    if (!f.point) f.point = this._aheadPoint(cam);
    return f;
  }

  /** 改预设：参数回到默认。 */
  setName(cam, name) { const f = this.formOf(cam); f.name = name; f.params = {}; }

  // ---- 主体 ----
  /** 可选主体：除自己外的实体（含群众成员）。 */
  subjects(cam) {
    const out = [];
    for (const e of this.app.entities) {
      if (e !== cam) out.push({ value: e.id, label: e.name });
      for (const m of e.children) out.push({ value: m.id, label: `${e.name} / ${m.name}` });
    }
    return out;
  }

  /** 默认主体：离机位最近的角色（含群众成员）；没有角色取最近的其他实体；什么都没有 = 机位前方 3 m 的点。 */
  nearestSubject(cam) {
    const doc = this.app.toDocument({ view: false });
    const aimOf = (id) => aimPoint(this.app, id)?.toArray() ?? null; // 场景实测注视点
    return nearestSubject(doc, cam.id, this.context(cam).position, aimOf) ?? this._aheadPoint(cam);
  }

  _aheadPoint(cam) { return aheadPoint(cam.transformJSON(this.app.timeline.baseOf(cam) || cam.root)); }

  /** 只含本机位条目 + 动画字段的文档视图（edit.moveContext 用；不必整份 toDocument）。 */
  _camDoc(cam) {
    const anim = this.app.timeline.toJSON();
    return { entities: [cam.toJSON({ base: this.app.timeline.baseOf(cam) })], ...anim };
  }

  /** 表单里的主体 → 约束 subject（实体 id 或 [x,y,z]）。 */
  resolveSubject(cam) {
    const f = this.formOf(cam);
    if (f.subject === '__point') return f.point.slice();
    if (f.subject && this.app.findEntity(f.subject)) return f.subject;
    return this.nearestSubject(cam);
  }

  // ---- 现状 ----
  _anim(cam) {
    const anim = this.app.timeline.toJSON();
    return {
      path: anim.paths.find((p) => p.target === cam.id) || null,
      lookAts: anim.constraints.filter((c) => c.target === cam.id && c.type === 'lookAt'),
      rotTrack: anim.timeline.tracks.find((t) => t.target === cam.id && t.property === 'rot') || null,
      posTrack: anim.timeline.tracks.find((t) => t.target === cam.id && t.property === 'pos') || null,
      constraints: anim.constraints.filter((c) => c.target === cam.id),
    };
  }

  /** 签名：机位路径 + rot 轨道键（判断会话态的段是否仍与文档一致）。 */
  _sig({ path, rotTrack }) {
    return JSON.stringify({
      path: path && { points: path.points, closed: path.closed, start: path.start, duration: path.duration, stops: path.stops, stopTimes: path.stopTimes },
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
    return moveContext(this._camDoc(cam), cam.id, { time: app.timeline.active ? round4(app.playback.time) : 0, lastPan: segs[segs.length - 1] || null });
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
      const doc = app.toDocument({ view: false });
      res = applyCameraMove(doc, cam.id, {
        name, subject, aim: this._aim(subject), params, time: ctx.time,
        lastPan: segs[segs.length - 1] || null, ownPan: segs.some((s) => s.kind === 'pan'),
      });
      tl.commitAnim(doc);
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
      if (seg.kind === 'path') {
        if (u.path) tl.updatePath(cur.path.id, u.path);
        else tl.removePath(cur.path.id);
      } else {
        if (u.track) tl.removeTrack(u.track);
        else for (const t of u.keys.times) tl.removeKey(u.keys.track, t);
      }
      if (u.added && cur.lookAts.some((c) => c.id === u.added)) tl.removeConstraint(u.added);
      for (const p of u.patched) if (cur.lookAts.some((c) => c.id === p.id)) tl.updateConstraint(p.id, { end: p.end });
      for (const c of u.removed) tl.addConstraint(c);
    } catch (err) { toastError(err); return false; }
    // 不截断 meta：签名回到上一段，段列表自然少一段；⌘Z 后签名又等于这一段，列表恢复
    toast(`已删除运镜段：${MOVE_LABEL[seg.name]}`);
    return true;
  }

  /** 清除运镜：删路径 + 该机位全部约束 + rot 轨道（一次撤销）。 */
  clear(cam) {
    const { app } = this;
    try {
      const doc = app.toDocument({ view: false });
      if (clearCameraMoves(doc, cam.id)) app.timeline.commitAnim(doc);
    } catch (err) { toastError(err); return; }
    delete this.meta[cam.id];
    toast('已清除运镜');
  }

  /** 是否有可清除的运镜数据。 */
  hasMoves(cam) {
    const { path, constraints, rotTrack } = this._anim(cam);
    return !!(path || constraints.length || rotTrack);
  }
}
