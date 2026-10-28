import { editCameraConstraints } from '../doc/cameraMotionState.js';
import * as THREE from 'three';
import { Emitter } from '../util/Emitter.js';
import { updateDraft } from '../doc/Store.js';
import { genId } from '../entities/Entity.js';
import { usedIds, newId } from '../doc/edit.js';
import { Pose } from '../rig/Pose.js';
import { Track } from './Track.js';
import { sameKeyTime, upsertKeys } from './keyframes.js';
import { PathTrack } from './PathTrack.js';
import { pathOptionsFor } from './Path.js';
import { fitStops, fitPathToDuration } from './pathGen.js';
import { applyLocomotion } from './Locomotion.js';
import { applyConstraint, constraintActive } from './Constraint.js';
import { round6, clone, D2R } from '../util/math.js';

const GOLDEN = 0.6180339887; // 群众成员步伐错开：第 i 个成员相位偏移 frac(i·φ)

/**
 * 时间轴：通过 getter 读取 Store 里的 timeline / paths / constraints，
 * 并由它们算出任意时刻的场景状态 evaluate(t)。
 *
 * 手动值与动画值共存：
 * - idle：不碰任何实体，场景完全是手动值。evaluate() / seek() / play() 进入 active，stop() 回到 idle。
 * - active：对每个被驱动的实体记一份 base（transform / fov / pose.values 的拷贝）。evaluate(t) 每次都从 base 出发，
 *   按固定顺序 关键帧轨道 → 路径轨道 → 约束 叠加，最后写入 root / camera。内部没有"上一帧"状态，
 *   同一份文档同一个 t 结果逐数值相同。
 * - active 期间编辑提交使用 baseOf 保留手动值；导出与补丁历史只读取 Store，不写入播放瞬时值。
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

  }

  get duration() { return this.app.store.document.timeline.duration; }
  get fps() { return this.app.store.document.timeline.fps; }
  get mainCameraId() { return this.app.store.document.timeline.mainCameraId; }
  get tracks() { return this.app.store.document.timeline.tracks; }
  get paths() { return this.app.store.document.paths; }
  get constraints() { return this.app.store.document.constraints; }

  toJSON() { return clone(this.view()); }
  view() {
    const { timeline, paths, constraints } = this.app.store.document;
    return { timeline, paths, constraints };
  }

  fromJSON(doc) {
    this.app.store.transact('替换动画', (draft) => {
      updateDraft(draft.timeline, doc.timeline);
      draft.paths = clone(doc.paths);
      draft.constraints = clone(doc.constraints);
    });
  }

  invalidateBase(ent) { this._base.delete(ent); }

  documentChanged({ reset = false } = {}) {
    if (reset) this._base.clear();
    for (const ent of this._base.keys()) if (!this.app.findEntity(ent.id)) this._base.delete(ent);
    if (this.active) this.evaluate(this.time);
    this.emit('change');
  }

  // ---- 求值 ----
  /** 实体 id → 被驱动的属性集合（'pos' | 'rot' | 'scale' | 'fov' | 'pose'）。空轨道不驱动任何属性。 */
  _drivenProps(tracks = this.tracks, paths = this.paths) {
    const map = new Map();
    const add = (id, ...props) => {
      if (!map.has(id)) map.set(id, new Set());
      for (const p of props) map.get(id).add(p);
    };
    for (const t of tracks) if (t.keys.length) add(t.target, t.property);
    for (const p of paths) {
      add(p.target, 'pos');
      if (p.orient === 'tangent') add(p.target, 'rot');
      // 步态：角色自己，或组的全部成员（整组沿路径时成员一起走）
      const ent = this.app.findEntity(p.target);
      if (ent?.type === 'character') add(p.target, 'pose');
      else if (ent) for (const m of ent.children) add(m.id, 'pose');
    }
    for (const c of this.constraints) {
      if (c.type === 'follow') add(c.target, 'pos');
      else add(c.target, 'rot');
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

  _documentBase(ent) {
    const json = this.app.store.document.entities.find((e) => e.id === ent.id);
    const opts = ent.docTransformOpts();
    const { pos, rot, scale } = json.transform;
    return {
      position: new THREE.Vector3(...pos.map((v, i) => v + opts.posOffset[i])),
      rotation: new THREE.Euler(...rot.map((v) => v * D2R)),
      scale: new THREE.Vector3(...scale.map((v, i) => v * opts.scaleDiv[i])),
      fov: json.fov,
      values: json.type === 'character' ? Pose.fromJSON(json.pose).values : undefined,
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
      if (!this._base.has(ent)) this._base.set(ent, this._documentBase(ent));
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
      opts: ent.docTransformOpts(),
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

  /** 文档路径 / 轨道对应的运行时对象（按文档对象缓存）。 */
  _pathTrack(json) { return this._rt(json, j => new PathTrack(j, pathOptionsFor(this.app.findEntity(j.target)?.type))); }
  _track(json) { return this._rt(json, j => new Track(j)); }

  pathModel(json) { return this._pathTrack(json).path; }

  positionChannel(json) { return this._track(json).channel; }

  /**
   * 求 t 时刻的场景状态并写入实体（纯函数语义：结果只取决于文档与 t）。
   * 固定顺序：关键帧轨道 → 路径轨道 → 约束。
   */
  evaluate(t, preview = null) {
    if (!this.active) { this.active = true; this.emit('active', true); }
    this.time = t;
    // Only replace an existing source; preview never changes the document or driver kinds.
    const tracks = preview?.kind === 'pos' ? this.tracks.map(j => j.id === preview.source.id ? preview.source : j) : this.tracks;
    const paths = preview?.kind === 'path' ? this.paths.map(j => j.id === preview.source.id ? preview.source : j) : this.paths;
    const driven = this._drivenProps(tracks, paths);
    this._syncBase(driven);

    const states = new Map(); // entityId → state
    for (const [ent, base] of this._base) states.set(ent.id, this._state(ent, base));

    // 1 关键帧轨道
    for (const json of tracks) {
      const st = states.get(json.target);
      if (!st || !json.keys.length) continue;
      this._track(json).apply(t, st);
    }

    // 2 路径轨道
    for (const json of paths) {
      // An appended path takes over only after the existing position animation ends.
      if (t < json.start && tracks.some(track => track.target === json.target && track.property === 'pos' && track.keys.length)) continue;
      const st = states.get(json.target);
      if (st) this._pathTrack(json).apply(t, st);
    }

    for (const st of states.values()) this._write(st);
    this._locomote(states);

    // 3 约束：读的是已写入的 subject（关键帧 / 路径 / 步态之后），改完机位再写一次。follow 先于 lookAt。
    const touched = new Set();
    for (const type of ['follow', 'lookAt']) {
      for (const c of this.constraints) {
        if (c.type !== type || !constraintActive(c, t)) continue;
        const st = states.get(c.target);
        if (!st) continue;
        applyConstraint(this.app, c, st, t, this.constraints);
        this._write(st);
        touched.add(st);
      }
    }
    for (const st of touched) st.ent.update();
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
   * active 期间实体被修改且不涉及可打键属性（姿势 / 颜色等）：把它没被动画驱动的属性记进 base（视为改手动值），
   * 再按当前时刻重新求值。被驱动的属性不记（否则会把动画瞬时值固化成手动值）。
   * 位置 / 旋转 / 缩放 / FOV 的修改走 editAt（打键或改手动值，见 editAt）。
   */
  refreshBase(ent) {
    const base = ent && this._base.get(ent);
    if (!base) return;
    const props = this._drivenProps().get(ent.id) || new Set();
    const cur = this._capture(ent);
    this._updateManualBase(base, cur, props);
    this.evaluate(this.time);
  }

  /** 仅同步未被动画驱动的手动属性；打键中的属性也由调用方排除。 */
  _updateManualBase(base, cur, driven) {
    if (!driven.has('pos')) base.position.copy(cur.position);
    if (!driven.has('rot')) base.rotation.copy(cur.rotation);
    if (!driven.has('scale')) base.scale.copy(cur.scale);
    if (base.fov !== undefined && !driven.has('fov')) base.fov = cur.fov;
    if (base.values && !driven.has('pose')) base.values = cur.values;
  }

  /**
   * 实体此刻（root 上）某属性的值，口径同文档 / setKey（复用 transformJSON 的换算：角色 pos 相对站立基准、
   * scale 相对素体自然尺寸、rot 为 XYZ 欧拉角度数）。fov 只对机位有意义。
   */
  valueOf(ent, prop) {
    if (prop === 'fov') return ent.type === 'camera' ? round6(ent.cam.fov) : undefined;
    return ent.transformJSON(ent.root)[prop];
  }

  /** 路径和实体位置都使用父坐标系的文档坐标；一次提交保留曲线形状与停顿。 */
  translatePathTo(ent, value) {
    const path = this.paths.find(p => p.target === ent.id);
    if (!path) return false;
    const model = this.pathModel(path);
    const from = this.active
      ? model.positionAt(model.distanceAt(this.time)).toArray()
      : this.app.store.document.entities.find(e => e.id === ent.id).transform.pos;
    const delta = value.map((v, i) => v - from[i]);
    this.app.store.transact('平移轨迹', doc => {
      const p = doc.paths.find(p => p.id === path.id);
      p.points = p.points.map(point => point.map((v, i) => round6(v + delta[i])));
      const base = doc.entities.find(e => e.id === ent.id).transform.pos;
      base.forEach((v, i) => { base[i] = round6(v + delta[i]); });
    });
    return true;
  }

  /** 关闭切线朝向时把当前姿态交给已有轨道或手动值，保持当前画面连续。 */
  setPathOrientation(pathId, orient) {
    this.app.playback.pause();
    const path = this.paths.find(p => p.id === pathId);
    if (!path) return;
    const ent = this.app.findEntity(path.target);
    const rotation = this.valueOf(ent, 'rot');
    this.app.store.batch('修改路径朝向', () => {
      this.updatePath(pathId, { orient });
      if (orient !== 'keep') return;
      const track = this.tracks.find(t => t.target === ent.id && t.property === 'rot');
      if (track && this.active) this.setKey(track.id, this.time, rotation);
      else this.app.store.transact('保持当前朝向', doc => { doc.entities.find(e => e.id === ent.id).transform.rot = rotation; });
    });
  }

  /** 路径只接管朝向；X/Z 倾斜仍可通过既有旋转轨道或手动姿态编辑。 */
  editPathTilt(ent) {
    const value = this.valueOf(ent, 'rot');
    const track = this.tracks.find(t => t.target === ent.id && t.property === 'rot');
    if (track && this.active) this.setKey(track.id, this.time, value);
    else this.app.store.transact('修改路径对象倾斜', doc => { doc.entities.find(e => e.id === ent.id).transform.rot = value; });
  }

  /**
   * t 时刻被路径 / 生效中的约束强制驱动的属性：prop → '路径' | '跟随' | '注视'。
   * 这些属性在该时刻手动改了也会被求值覆盖，打键也不起作用。
   */
  forcedProps(entId, t) {
    const out = new Map();
    for (const p of this.paths) {
      if (p.target !== entId) continue;
      out.set('pos', '路径');
      if (p.orient === 'tangent') out.set('rot', '路径');
    }
    for (const c of this.constraints) {
      if (c.target !== entId || !constraintActive(c, t)) continue;
      if (c.type === 'follow') out.set('pos', '跟随');
      else out.set('rot', '注视');
    }
    return out;
  }

  /**
   * active 期间实体被 gizmo / 面板修改后的归属。props 为刚改过的属性：
   * 'pos' | 'rot' | 'scale' | 'fov' 按下面规则处理；其它（'pose' / 'color' …）视为改手动值。
   * - 被路径 / 生效中的约束驱动 → 不记（下一次求值覆盖），列入 blocked；
   * - 有轨道（含空轨道）→ 在 t 写键：同刻已有键则覆盖，ease 沿用被覆盖键，否则 linear；
   * - 无轨道 → autoKey ? 新建轨道并写键 : 记进 base（改手动值，同 refreshBase）。
   * 所有键改动合成一次提交（一次撤销）；最后按当前时刻重新求值。
   * @returns {{keyed:string[], blocked:[string,string][], manual:string[]}}
   */
  editAt(ent, props, t, { autoKey = false } = {}) {
    const out = { keyed: [], blocked: [], manual: [] };
    if (!ent) return out;
    // 先取值：提交会按 t 重新求值并覆盖 root
    const cur = this._capture(ent);
    const forced = this.forcedProps(ent.id, t);
    let tracks = this.tracks;
    const used = usedIds(this.app.store.document);
    for (const p of props) {
      const value = ['pos', 'rot', 'scale', 'fov'].includes(p) ? this.valueOf(ent, p) : undefined;
      if (value === undefined) { out.manual.push(p); continue; }
      if (forced.has(p)) { out.blocked.push([p, forced.get(p)]); continue; }
      let tr = tracks.find((x) => x.target === ent.id && x.property === p);
      if (!tr && !autoKey) { out.manual.push(p); continue; }
      if (!tr) {
        let id;
        do id = genId(); while (used.has(id));
        used.add(id);
        tr = { id, target: ent.id, property: p, keys: [] };
        tracks = [...tracks, tr];
      }
      const old = tr.keys.find((k) => sameKeyTime(k.t, t));
      const keys = upsertKeys(tr.keys, { t, value, ease: old?.ease ?? 'linear' });
      const next = { ...tr, keys };
      tracks = tracks.map((x) => (x === tr ? next : x));
      out.keyed.push(p);
    }

    // 首次打键先从已提交文档取 base，不能把拖动预览当作原手动值。
    if (out.keyed.length && !this._base.has(ent)) this._base.set(ent, this._documentBase(ent));
    // 手动值：没被驱动、也不是这次打键的属性记进 base。
    const base = this._base.get(ent);
    if (base) {
      const driven = this._drivenProps().get(ent.id) || new Set();
      this._updateManualBase(base, cur, new Set([...driven, ...out.keyed]));
    }

    if (out.keyed.length) this._commit({ tracks }); // 校验 + 'change' + 撤销 + 重新求值
    else this.evaluate(this.time);
    return out;
  }

  // ---- 编辑 API（时间轴面板 / AI 调用）：全部返回文档形状的拷贝；每次变更记一步撤销 ----
  /**
   * 以 next 覆盖部分字段，先拼成整份文档校验（规则与导入完全一致），不合法抛 DocumentError、数据不变。
   * 合法则提交：emit 'change'、记撤销、active 时按当前时刻重新求值。
   */
  _commit(next) {
    this.app.store.transact('编辑动画', (doc) => {
      for (const [key, value] of Object.entries(next)) {
        if (key === 'constraints') editCameraConstraints(doc, () => updateDraft(doc.constraints, value));
        else if (key === 'paths') updateDraft(doc.paths, value);
        else if (key === 'tracks') updateDraft(doc.timeline.tracks, value);
        else doc.timeline[key] = value;
      }
      if ('paths' in next || 'duration' in next) {
        doc.paths = doc.paths.map((p) => fitPathToDuration(p, doc.timeline.duration));
      }
    });
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
    const track = { id: newId(this.app.store.document), target, property, keys: [] };
    this._commit({ tracks: [...this.tracks, track] });
    return clone(track);
  }

  /** 打键：同一时刻覆盖，否则按时间插入。value 口径同文档（rot 为欧拉角度数）。 */
  setKey(trackId, t, value, ease = 'linear') {
    const old = this._find(this.tracks, trackId, '轨道');
    const keys = upsertKeys(old.keys, { t, value, ease });
    const track = { ...old, keys };
    this._commit({ tracks: this.tracks.map((x) => (x === old ? track : x)) });
    return clone(track);
  }

  removeKey(trackId, t) {
    const old = this._find(this.tracks, trackId, '轨道');
    const track = { ...old, keys: old.keys.filter((k) => !sameKeyTime(k.t, t)) };
    this._commit({ tracks: this.tracks.map((x) => (x === old ? track : x)) });
    return clone(track);
  }

  removeTrack(trackId) {
    const old = this._find(this.tracks, trackId, '轨道');
    this._commit({ tracks: this.tracks.filter((x) => x !== old) });
  }

  /** 新建路径。缺省：不闭合、0 秒开始、时长 4 秒、匀速、朝向切线。 */
  addPath({ target, points, closed = false, start = 0, duration = 4, speed = 'linear', orient = 'tangent', interpolation }) {
    const path = { id: newId(this.app.store.document), target, points: clone(points), closed, start, duration, speed, orient, ...(interpolation ? { interpolation } : {}) };
    this._commit({ paths: [...this.paths, path] });
    return clone(this.paths.find((p) => p.id === path.id));
  }

  /** 修改路径字段（id 不可改）。 */
  updatePath(id, patch) {
    const old = this._find(this.paths, id, '路径');
    if (patch.start >= this.duration) throw new Error(`开始时间需早于场景结束（${this.duration} 秒）`);
    const path = fitStops(old, { ...old, ...clone(patch), id }, patch); // 停顿随顶点数 / 时长调整
    this._commit({ paths: this.paths.map((x) => (x === old ? path : x)) });
    return clone(this.paths.find((p) => p.id === id));
  }

  removePath(id) {
    const old = this._find(this.paths, id, '路径');
    this._commit({ paths: this.paths.filter((x) => x !== old) });
  }

  /** 新建约束。缺省：offset [0,0,0]、全程生效。 */
  addConstraint({ type, target, subject, offset = [0, 0, 0], start = null, end = null }) {
    const c = { id: newId(this.app.store.document), type, target, subject: clone(subject), offset: clone(offset), start, end };
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
}
