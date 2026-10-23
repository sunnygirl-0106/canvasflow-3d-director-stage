import { Emitter } from '../util/Emitter.js';

/**
 * 播放器：play / pause / stop / seek / loop。只推进时间，画面一律由 timeline.evaluate(time) 算出。
 * 由 Stage 的按需渲染循环每帧调用 update()（经 App.tick）：播放中每帧求值并请求重绘。
 * 事件：'tick'(time) —— 时间变化；'state'('playing' | 'paused' | 'idle')。
 */
export class Playback extends Emitter {
  constructor(timeline, { invalidate = () => {}, beforePlay = () => true } = {}) {
    super();
    this.timeline = timeline;
    this.invalidate = invalidate;
    this.beforePlay = beforePlay;
    this.time = 0;
    this.playing = false;
    this.loop = false;
    this._last = 0;
  }

  get state() { return this.playing ? 'playing' : this.timeline.active ? 'paused' : 'idle'; }

  _apply(preview) {
    this.timeline.evaluate(this.time, preview);
    this.invalidate();
    this.emit('tick', this.time);
  }

  _setState(prev) {
    if (this.state !== prev) this.emit('state', this.state);
  }

  play() {
    if (this.playing) return true;
    if (!this.beforePlay()) return false;
    const prev = this.state;
    if (this.time >= this.timeline.duration) this.time = 0; // 已在末尾：从头播放
    this.playing = true;
    this._last = performance.now();
    this._apply();
    this._setState(prev);
    return true;
  }

  pause() {
    if (!this.playing) return;
    const prev = this.state;
    this.update(); // 先把时间推进到此刻
    this.playing = false;
    this._setState(prev);
  }

  /** 停止：回到 0，场景恢复手动值（timeline 回到 idle）。 */
  stop() {
    const prev = this.state;
    this.playing = false;
    this.time = 0;
    this.timeline.stop();
    this.invalidate();
    this.emit('tick', this.time);
    this._setState(prev);
  }

  /** 跳转（夹到 [0, duration]）；从 idle 进入 active（暂停态）。 */
  seek(t, preview) {
    const prev = this.state;
    this.time = Math.min(Math.max(Number(t) || 0, 0), this.timeline.duration);
    this._last = performance.now();
    this._apply(preview);
    this._setState(prev);
  }

  /** 吸附到帧（fps 只用于此处与导出）。 */
  snap(t) {
    const fps = this.timeline.fps;
    return Math.round(t * fps) / fps;
  }

  /** 每帧调用：播放中推进时间并求值。返回是否在播放（供渲染循环判断画面在动）。 */
  update() {
    if (!this.playing) return false;
    const now = performance.now();
    const dt = (now - this._last) / 1000;
    this._last = now;
    const d = this.timeline.duration;
    let t = this.time + dt;
    if (t >= d) {
      if (this.loop) t = d > 0 ? t % d : 0;
      else {
        this.time = d;
        this.playing = false; // 停在末尾（不 stop，保持 active）
        this._apply();
        this.emit('state', this.state);
        return false;
      }
    }
    this.time = t;
    this._apply();
    return true;
  }
}
