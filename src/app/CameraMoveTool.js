import * as THREE from 'three';
import { toast } from '../util/dom.js';
import { aimPoint } from '../anim/Constraint.js';
import { cameraMove, defaultParams, appendMove, lookAtWindows, pathEnd, MoveError, MOVE_LABEL } from '../anim/cameraMoves.js';
import { toastError } from '../ui/timeline/Transport.js';
import { confirmToast } from './PathTool.js';

const SUBJECT_AHEAD = 3; // 场景里没有可注视的实体时：主体 = 机位前方 3 m
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const fmt = (s) => (Math.round(s * 10) / 10).toString();

/**
 * 机位运镜（阶段 F）：把 cameraMoves 的生成结果写成 path + lookAt 约束（+ pan 的 rot 轨道），一次撤销。
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
    const pos = new THREE.Vector3(...this.context(cam).position);
    const all = [];
    for (const e of this.app.entities) {
      if (e === cam) continue;
      all.push(e, ...e.children);
    }
    const pool = all.filter((e) => e.type === 'character');
    let best = null, bd = Infinity;
    for (const e of pool.length ? pool : all) {
      const p = aimPoint(this.app, e.id);
      const d = p ? p.distanceTo(pos) : Infinity;
      if (d < bd) { bd = d; best = e.id; }
    }
    return best ?? this._aheadPoint(cam);
  }

  _aheadPoint(cam) {
    const r = this.app.timeline.baseOf(cam) || cam.root;
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(r.rotation);
    return r.position.clone().addScaledVector(dir, SUBJECT_AHEAD).toArray().map(r4);
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
      path: path && { points: path.points, closed: path.closed, start: path.start, duration: path.duration },
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
    const tr = cam._transformJSON(app.timeline.baseOf(cam) || cam.root);
    const roll = cam._roll * 180 / Math.PI;
    const { path } = this._anim(cam);
    const segs = this.segments(cam);
    if (path) return { position: pathEnd(path), rot: tr.rot, roll, time: r4(path.start + path.duration), append: true, path };
    const lastPan = segs[segs.length - 1];
    if (lastPan) return { position: tr.pos, rot: lastPan.rotEnd, roll, time: r4(lastPan.start + lastPan.duration), append: true, path: null };
    return { position: tr.pos, rot: tr.rot, roll, time: app.timeline.active ? r4(app.playback.time) : 0, append: false, path: null };
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
   * 写入一段运镜（同一同步流程 = 一次撤销）。b = build() 的结果。
   * @returns {object|null} 新段（会话态），失败 null
   */
  commit(cam, b) {
    const { app } = this;
    const tl = app.timeline;
    const { move, ctx, subject, name } = b;
    const start = ctx.time;
    const before = this._anim(cam);
    const seg = { name, params: this.params(cam), subject, start, duration: move.duration, kind: move.points ? 'path' : 'pan', undo: {} };
    try {
      // 1 路径 / 摇镜头的 rot 键
      if (move.points) {
        if (before.path) {
          seg.undo.path = { points: before.path.points, closed: before.path.closed, duration: before.path.duration };
          tl.updatePath(before.path.id, appendMove(before.path, move));
        } else {
          if (before.posTrack) tl.removeTrack(before.posTrack.id);
          tl.addPath({ target: cam.id, points: move.points, closed: move.closed, start, duration: move.duration, speed: 'smooth', orient: 'keep' });
          seg.undo.path = null;
        }
      } else {
        const own = this.segments(cam).some((s) => s.kind === 'pan');
        let track = before.rotTrack;
        if (track && !own) { tl.removeTrack(track.id); track = null; }
        if (!track) { track = tl.addTrack({ target: cam.id, property: 'rot' }); seg.undo.track = track.id; }
        const end = r4(start + move.duration);
        tl.setKey(track.id, start, move.rotKeys[0], 'smooth');
        tl.setKey(track.id, end, move.rotKeys[1], 'smooth');
        seg.undo.keys = { track: track.id, times: [start, end] };
        seg.rotEnd = move.rotKeys[1];
      }
      // 2 注视窗口：带路径的段从 start 开始注视，摇镜头摇完（start + duration）才开始
      const lookStart = move.points ? start : r4(start + move.duration);
      const w = lookAtWindows(before.lookAts, { subject, cut: start, start: lookStart });
      seg.undo.removed = before.lookAts.filter((c) => w.remove.includes(c.id));
      seg.undo.patched = w.patch.map((p) => ({ id: p.id, end: before.lookAts.find((c) => c.id === p.id).end }));
      for (const id of w.remove) tl.removeConstraint(id);
      for (const p of w.patch) tl.updateConstraint(p.id, { end: p.end });
      if (w.add) seg.undo.added = tl.addConstraint({ type: 'lookAt', target: cam.id, ...w.add }).id;
    } catch (err) { toastError(err); return null; }

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
    const tl = this.app.timeline;
    const { path, constraints, rotTrack } = this._anim(cam);
    try {
      if (path) tl.removePath(path.id);
      for (const c of constraints) tl.removeConstraint(c.id);
      if (rotTrack) tl.removeTrack(rotTrack.id);
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
