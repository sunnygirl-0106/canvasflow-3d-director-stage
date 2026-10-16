import * as THREE from 'three';
import { Emitter } from '../util/Emitter.js';
import { DEFAULT_TIMELINE, validate, DocumentError } from '../doc/schema.js';
import { genId } from '../entities/Entity.js';
import { Track } from './Track.js';
import { PathTrack } from './PathTrack.js';
import { applyLocomotion } from './Locomotion.js';

const GOLDEN = 0.6180339887; // 群众成员步伐错开：第 i 个成员相位偏移 frac(i·φ)

const clone = (v) => JSON.parse(JSON.stringify(v));
const T_EPS = 1e-9; // 同一时刻判定（setKey 覆盖 / removeKey）

/**
 * 时间轴：持有场景文档里的 timeline / paths / constraints 三个字段（文档形状的纯数据，是唯一的源），
 * 并由它们算出任意时刻的场景状态 evaluate(t)。
 *
 * 手动值与动画值共存（任务说明 3.3）：
 * - idle：不碰任何实体，场景完全是手动值。evaluate() / seek() / play() 进入 active，stop() 回到 idle。
 * - active：对每个被驱动的实体记一份 base（transform / fov / pose.values 的拷贝）。evaluate(t) 每次都从 base 出发，
 *   按固定顺序 关键帧轨道 → 路径轨道 → 约束 叠加，最后写入 root / camera。内部没有"上一帧"状态，
 *   同一份文档同一个 t 结果逐数值相同。
 * - active 期间 toDocument() 对被驱动实体导出 base（baseOf），所以播放中导出 / 撤销快照不会把瞬时值当成手动值。
 *
 * 事件：'change' —— 轨道 / 路径 / 约束 / 时长等文档数据变化；'active'(bool) —— idle ↔ active。
 */
export class Timeline extends Emitter {
  constructor(app) {
    super();
    this.app = app;
    this.active = false;
    this.time = 0;            // 最近一次 evaluate 的时刻（数据变化后按它重新求值）
    this._base = new Map();   // Entity → base（只在 active 时非空）
    this._runtime = new WeakMap(); // 文档对象 → 运行时对象（Track 等）；文档对象只整体替换，不原地改
    this._reset();
  }

  _reset() {
    const d = clone(DEFAULT_TIMELINE);
    this.duration = d.duration;
    this.fps = d.fps;
    this.mainCameraId = d.mainCameraId;
    this.tracks = [];
    this.paths = [];
    this.constraints = [];
  }

  // ---- 场景文档 ----
  /** → { timeline, paths, constraints }（深拷贝，可直接并入文档）。 */
  toJSON() {
    return clone({
      timeline: { duration: this.duration, fps: this.fps, mainCameraId: this.mainCameraId, tracks: this.tracks },
      paths: this.paths,
      constraints: this.constraints,
    });
  }

  /**
   * 从已校验的文档恢复（整体替换）。实体此时已整体重建（都是手动值）：
   * active 时丢掉旧实体的 base，按新数据在原时刻重新求值（播放中撤销 / 导入不打断播放）。
   */
  fromJSON(doc) {
    const { timeline, paths, constraints } = clone({ timeline: doc.timeline, paths: doc.paths, constraints: doc.constraints });
    this.duration = timeline.duration;
    this.fps = timeline.fps;
    this.mainCameraId = timeline.mainCameraId;
    this.tracks = timeline.tracks;
    this.paths = paths;
    this.constraints = constraints;
    this._base.clear();
    if (this.active) this.evaluate(this.time);
    this.emit('change');
  }

  // ---- 求值 ----
  /** 实体 id → 被驱动的属性集合（'pos' | 'rot' | 'scale' | 'fov' | 'pose'）。空轨道不驱动任何属性。 */
  _drivenProps() {
    const map = new Map();
    const add = (id, ...props) => {
      if (!map.has(id)) map.set(id, new Set());
      for (const p of props) map.get(id).add(p);
    };
    for (const t of this.tracks) if (t.keys.length) add(t.target, t.property);
    for (const p of this.paths) {
      add(p.target, 'pos');
      if (p.orient === 'tangent') add(p.target, 'rot');
      // 步态：角色自己，或组的全部成员（整组沿路径时成员一起走）
      const ent = this.app.findEntity(p.target);
      if (ent?.type === 'character') add(p.target, 'pose');
      else if (ent) for (const m of ent.children) add(m.id, 'pose');
    }
    return map;
  }

  _rt(json, make) {
    let r = this._runtime.get(json);
    if (!r) { r = make(json); this._runtime.set(json, r); }
    return r;
  }

  /** 实体当前（手动）值的拷贝。 */
  _capture(ent) {
    const r = ent.root;
    return {
      position: r.position.clone(),
      rotation: r.rotation.clone(), // 存欧拉而不是四元数：写回后文档里的度数逐位不变
      scale: r.scale.clone(),
      fov: ent.type === 'camera' ? ent.cam.fov : undefined,
      values: ent.type === 'character' ? { ...ent.values } : undefined,
    };
  }

  /** 把 base 原样写回实体。 */
  _restore(ent, base, props) {
    const r = ent.root;
    r.position.copy(base.position);
    r.rotation.copy(base.rotation);
    r.scale.copy(base.scale);
    r.updateMatrixWorld(true);
    if (base.fov !== undefined && ent.cam.fov !== base.fov) ent.setFov(base.fov);
    if (base.values && (!props || props.has('pose'))) {
      Object.assign(ent.values, base.values);
      ent.autoGround = true;
      ent.applyPose();
    }
  }

  /** 进入 active / 同步 base：新被驱动的实体记 base；不再被驱动的写回 base 并移除。 */
  _syncBase(driven) {
    const live = new Set();
    for (const id of driven.keys()) {
      const ent = this.app.findEntity(id);
      if (!ent) continue;
      live.add(ent);
      if (!this._base.has(ent)) this._base.set(ent, this._capture(ent));
    }
    for (const [ent, base] of this._base) {
      if (live.has(ent)) continue;
      this._restore(ent, base);
      this._base.delete(ent);
    }
  }

  /** 实体的求值状态：从 base 出发（root 口径）。 */
  _state(ent, base) {
    return {
      ent, base,
      opts: ent._docTransformOpts(),
      position: base.position.clone(),
      quaternion: new THREE.Quaternion().setFromEuler(base.rotation),
      rotTouched: false, // 未改旋转时写回 base 欧拉（避免四元数 → 欧拉的表示变化）
      scale: base.scale.clone(),
      fov: base.fov,
    };
  }

  _write(st) {
    const { ent } = st;
    const r = ent.root;
    r.position.copy(st.position);
    if (st.rotTouched) r.quaternion.copy(st.quaternion);
    else r.rotation.copy(st.base.rotation);
    r.scale.copy(st.scale);
    r.updateMatrixWorld(true);
    if (st.fov !== undefined && ent.cam.fov !== st.fov) ent.setFov(st.fov);
  }

  /**
   * 求 t 时刻的场景状态并写入实体（纯函数语义：结果只取决于文档与 t）。
   * 固定顺序：关键帧轨道 → 路径轨道 → 约束。
   */
  evaluate(t) {
    if (!this.active) { this.active = true; this.emit('active', true); }
    this.time = t;
    const driven = this._drivenProps();
    this._syncBase(driven);

    const states = new Map(); // entityId → state
    for (const [ent, base] of this._base) states.set(ent.id, this._state(ent, base));

    // 1 关键帧轨道
    for (const json of this.tracks) {
      const st = states.get(json.target);
      if (!st || !json.keys.length) continue;
      this._rt(json, (j) => new Track(j)).apply(t, st);
    }

    // 2 路径轨道
    for (const json of this.paths) {
      const st = states.get(json.target);
      if (st) this._rt(json, (j) => new PathTrack(j)).apply(t, st);
    }

    for (const st of states.values()) this._write(st);
    this._locomote(states);
    this.app.stage?.invalidate();
  }

  /**
   * 步态：沿路径移动的角色 / 组成员按速度与路程切程序化步态（Locomotion）；其余被驱动角色的姿势保持 base。
   * 每次都从 base.values 出发，无"上一帧"状态。
   */
  _locomote(states) {
    for (const st of states.values()) {
      const { ent, motion } = st;
      if (!motion) continue;
      if (ent.type === 'character') {
        applyLocomotion(ent, st.base.values, motion, st.scale.y / ent.baseScale);
      } else {
        ent.children.forEach((m, i) => {
          const base = this._base.get(m);
          if (!base || m.type !== 'character') return;
          applyLocomotion(m, base.values, motion, (m.root.scale.y / m.baseScale) * st.scale.y, (i * GOLDEN) % 1);
        });
      }
    }
  }

  /** 回到 idle：全部被驱动实体写回 base。 */
  stop() {
    for (const [ent, base] of this._base) this._restore(ent, base);
    this._base.clear();
    this.time = 0;
    if (this.active) { this.active = false; this.emit('active', false); }
    this.app.stage?.invalidate();
  }

  /** active 期间某实体的手动值（文档导出用）；idle 或未被驱动时为 null。 */
  baseOf(ent) { return this._base.get(ent) || null; }

  /**
   * active 期间实体被 gizmo / 面板修改：把它没被动画驱动的属性记进 base（视为改手动值），再按当前时刻重新求值。
   * 被驱动的属性不记（否则会把动画瞬时值固化成手动值），修改会被下一次求值覆盖 —— 阶段 D 再改成打关键帧。
   */
  refreshBase(ent) {
    const base = ent && this._base.get(ent);
    if (!base) return;
    const props = this._drivenProps().get(ent.id) || new Set();
    const cur = this._capture(ent);
    if (!props.has('pos')) base.position.copy(cur.position);
    if (!props.has('rot')) base.rotation.copy(cur.rotation);
    if (!props.has('scale')) base.scale.copy(cur.scale);
    if (base.fov !== undefined && !props.has('fov')) base.fov = cur.fov;
    if (base.values && !props.has('pose')) base.values = cur.values;
    this.evaluate(this.time);
  }

  // ---- 编辑 API（阶段 D 面板 / 阶段 H AI 调用）：全部返回文档形状的拷贝；每次变更记一步撤销 ----
  _allIds() {
    const ids = new Set();
    for (const e of this.app.entities) { ids.add(e.id); for (const c of e.children) ids.add(c.id); }
    for (const x of [...this.tracks, ...this.paths, ...this.constraints]) ids.add(x.id);
    return ids;
  }

  _newId() {
    const used = this._allIds();
    let id;
    do id = genId(); while (used.has(id));
    return id;
  }

  /**
   * 以 next 覆盖部分字段，先拼成整份文档校验（规则与导入完全一致），不合法抛 DocumentError、数据不变。
   * 合法则提交：emit 'change'、记撤销、active 时按当前时刻重新求值。
   */
  _commit(next) {
    const cur = { duration: this.duration, fps: this.fps, mainCameraId: this.mainCameraId, tracks: this.tracks, paths: this.paths, constraints: this.constraints };
    const n = { ...cur, ...next };
    const doc = this.app.toDocument({ view: false });
    doc.timeline = { duration: n.duration, fps: n.fps, mainCameraId: n.mainCameraId, tracks: n.tracks };
    doc.paths = n.paths;
    doc.constraints = n.constraints;
    const { ok, errors } = validate(clone(doc));
    if (!ok) throw new DocumentError(errors);
    Object.assign(this, n);
    if (this.active) this.evaluate(this.time);
    this.emit('change');
    this.app.history?.schedule();
  }

  _find(list, id, what) {
    const x = list.find((o) => o.id === id);
    if (!x) throw new Error(`${what}不存在：${id}`);
    return x;
  }

  setDuration(s) { this._commit({ duration: s }); }
  setFps(n) { this._commit({ fps: n }); }
  setMainCamera(id) { this._commit({ mainCameraId: id ?? null }); }

  /** 新建一条空轨道（keys = []）。 */
  addTrack({ target, property }) {
    const track = { id: this._newId(), target, property, keys: [] };
    this._commit({ tracks: [...this.tracks, track] });
    return clone(track);
  }

  /** 打键：同一时刻覆盖，否则按时间插入。value 口径同文档（rot 为欧拉角度数）。 */
  setKey(trackId, t, value, ease = 'linear') {
    const old = this._find(this.tracks, trackId, '轨道');
    const key = { t, value: clone(value), ease };
    const keys = old.keys.filter((k) => Math.abs(k.t - t) > T_EPS);
    keys.push(key);
    keys.sort((a, b) => a.t - b.t);
    const track = { ...old, keys };
    this._commit({ tracks: this.tracks.map((x) => (x === old ? track : x)) });
    return clone(track);
  }

  removeKey(trackId, t) {
    const old = this._find(this.tracks, trackId, '轨道');
    const track = { ...old, keys: old.keys.filter((k) => Math.abs(k.t - t) > T_EPS) };
    this._commit({ tracks: this.tracks.map((x) => (x === old ? track : x)) });
    return clone(track);
  }

  removeTrack(trackId) {
    const old = this._find(this.tracks, trackId, '轨道');
    this._commit({ tracks: this.tracks.filter((x) => x !== old) });
  }

  /** 新建路径。缺省：不闭合、0 秒开始、时长 4 秒、匀速、朝向切线。 */
  addPath({ target, points, closed = false, start = 0, duration = 4, speed = 'linear', orient = 'tangent' }) {
    const path = { id: this._newId(), target, points: clone(points), closed, start, duration, speed, orient };
    this._commit({ paths: [...this.paths, path] });
    return clone(path);
  }

  /** 修改路径字段（id 不可改）。 */
  updatePath(id, patch) {
    const old = this._find(this.paths, id, '路径');
    const path = { ...old, ...clone(patch), id };
    this._commit({ paths: this.paths.map((x) => (x === old ? path : x)) });
    return clone(path);
  }

  removePath(id) {
    const old = this._find(this.paths, id, '路径');
    this._commit({ paths: this.paths.filter((x) => x !== old) });
  }

  /** 新建约束。缺省：offset [0,0,0]、全程生效。 */
  addConstraint({ type, target, subject, offset = [0, 0, 0], start = null, end = null }) {
    const c = { id: this._newId(), type, target, subject: clone(subject), offset: clone(offset), start, end };
    this._commit({ constraints: [...this.constraints, c] });
    return clone(c);
  }

  updateConstraint(id, patch) {
    const old = this._find(this.constraints, id, '约束');
    const c = { ...old, ...clone(patch), id };
    this._commit({ constraints: this.constraints.map((x) => (x === old ? c : x)) });
    return clone(c);
  }

  removeConstraint(id) {
    const old = this._find(this.constraints, id, '约束');
    this._commit({ constraints: this.constraints.filter((x) => x !== old) });
  }

  // ---- 实体增删联动 ----
  /**
   * 结构变化（打组 / 解组改父节点）之前调用：这些实体写回手动值并退出 base，
   * 之后在新坐标系下若仍被驱动，下次求值会重新记 base。
   */
  release(ids) {
    const set = new Set(ids);
    for (const [ent, base] of [...this._base]) {
      if (!set.has(ent.id)) continue;
      this._restore(ent, base);
      this._base.delete(ent);
    }
  }

  /**
   * 实体被删除：引用它的轨道 / 路径 / 约束（target 或 subject）与主机位一并删除。
   * 由 App 在删除实体的同一同步流程里调用，因此与删除记在同一次撤销快照里。
   * @param {Iterable<string>} ids
   */
  pruneEntities(ids) {
    const dead = new Set(ids);
    for (const ent of [...this._base.keys()]) if (dead.has(ent.id)) this._base.delete(ent); // 实体已销毁，不写回
    const n = this.tracks.length + this.paths.length + this.constraints.length;
    this.tracks = this.tracks.filter((t) => !dead.has(t.target));
    this.paths = this.paths.filter((p) => !dead.has(p.target));
    this.constraints = this.constraints.filter((c) => !dead.has(c.target) && !(typeof c.subject === 'string' && dead.has(c.subject)));
    const camGone = dead.has(this.mainCameraId);
    if (camGone) this.mainCameraId = null;
    const changed = camGone || n !== this.tracks.length + this.paths.length + this.constraints.length;
    if (changed) this._afterStructural();
    return changed;
  }

  /**
   * 实体的坐标系变了（打组 / 解组）：它的轨道与路径按旧坐标系记录，直接删除，避免跳变或产生非法文档
   * （打组后成员不能有路径）。约束只引用实体位置，不受影响。
   */
  dropTransformAnimation(ids) {
    const set = new Set(ids);
    const n = this.tracks.length + this.paths.length;
    this.tracks = this.tracks.filter((t) => !(set.has(t.target) && t.property !== 'fov'));
    this.paths = this.paths.filter((p) => !set.has(p.target));
    const changed = n !== this.tracks.length + this.paths.length;
    if (changed) this._afterStructural();
    return changed;
  }

  _afterStructural() {
    if (this.active) this.evaluate(this.time);
    this.emit('change');
  }
}
