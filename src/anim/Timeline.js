import { Emitter } from '../util/Emitter.js';
import { DEFAULT_TIMELINE } from '../doc/schema.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * 时间轴：持有场景文档里的 timeline / paths / constraints 三个字段（文档形状的纯数据，是唯一的源）。
 * 事件：'change' —— 轨道 / 路径 / 约束 / 时长等任一变化。
 */
export class Timeline extends Emitter {
  constructor(app) {
    super();
    this.app = app;
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

  /** 从已校验的文档恢复（整体替换）。 */
  fromJSON(doc) {
    const { timeline, paths, constraints } = clone({ timeline: doc.timeline, paths: doc.paths, constraints: doc.constraints });
    this.duration = timeline.duration;
    this.fps = timeline.fps;
    this.mainCameraId = timeline.mainCameraId;
    this.tracks = timeline.tracks;
    this.paths = paths;
    this.constraints = constraints;
    this.emit('change');
  }

  /**
   * 实体被删除：引用它的轨道 / 路径 / 约束（target 或 subject）与主机位一并删除。
   * 由 App 在删除实体的同一同步流程里调用，因此与删除记在同一次撤销快照里。
   * @param {Iterable<string>} ids
   */
  pruneEntities(ids) {
    const dead = new Set(ids);
    if (!dead.size) return false;
    const n = this.tracks.length + this.paths.length + this.constraints.length;
    this.tracks = this.tracks.filter((t) => !dead.has(t.target));
    this.paths = this.paths.filter((p) => !dead.has(p.target));
    this.constraints = this.constraints.filter((c) => !dead.has(c.target) && !(typeof c.subject === 'string' && dead.has(c.subject)));
    const camGone = dead.has(this.mainCameraId);
    if (camGone) this.mainCameraId = null;
    const changed = camGone || n !== this.tracks.length + this.paths.length + this.constraints.length;
    if (changed) this.emit('change');
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
    if (changed) this.emit('change');
    return changed;
  }
}
