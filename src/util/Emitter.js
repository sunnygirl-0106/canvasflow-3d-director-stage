// 极简事件总线：App 只负责 emit，UI 自行订阅，取代 App 直接调用各面板的 refresh。
export class Emitter {
  constructor() { this._listeners = new Map(); }

  /** 订阅事件，返回取消订阅函数。 */
  on(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
    return () => this._listeners.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const set = this._listeners.get(type);
    if (set) for (const fn of [...set]) fn(payload);
  }
}
