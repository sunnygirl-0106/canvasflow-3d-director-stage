/** 请求起点与资源准备期间都使用同一守卫；取消和过期不进入模型纠错重试。 */
export class StaleRequestError extends Error {
  constructor() { super('请求期间场景已被修改，请基于当前场景重新发送'); this.name = 'StaleRequestError'; }
}
/** @param {{revision:number}} store @param {{expectedRevision?:number,signal?:AbortSignal}} [options] */
export function checkRequestState(store, { expectedRevision = store.revision, signal } = {}) {
  if (signal?.aborted) { const err = new Error('已取消'); err.name = 'AbortError'; throw err; }
  if (store.revision !== expectedRevision) throw new StaleRequestError();
}
