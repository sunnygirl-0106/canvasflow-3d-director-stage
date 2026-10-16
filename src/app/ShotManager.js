import { toast } from '../util/dom.js';

/** 占位：发送到画布 / 接生成链路（首版仅打日志）。 */
function sendToCanvas(shot) {
  console.log('[sendToCanvas] 占位：截图将作为参考图发送到生成链路。', shot.name, `${shot.blob.size} bytes`);
}

/** 下载一张图片（url 可为 ObjectURL / dataURL）。 */
export function downloadURL(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

/**
 * 截图管理：会话内的截图数据与相关操作。
 * 截图以 Blob + ObjectURL 保存（不常驻巨大的 dataURL 字符串），删除时回收。
 * 变更后通过 app.emit('shots') 通知 UI。
 */
export class ShotManager {
  constructor(app) {
    this.app = app;
    this.list = [];                  // { id, cameraId, cameraName, name, url, blob, createdAt }
    this.selectedShotIds = new Set();
    this._seq = {};                  // 每机位序号 { [cameraId]: n }
    this._count = 0;
  }

  /** 截图归属的机位：机位视角下的出画机位 > 选中的机位 > 按当前视角新建。 */
  _resolveShotCamera() {
    const app = this.app;
    if (app.cameraView && app.activeCameraId) {
      const a = app.findCamera(app.activeCameraId);
      if (a) return { ent: a, created: false };
    }
    if (app.selected?.type === 'camera') return { ent: app.selected, created: false };
    return { ent: app.addCamera('current'), created: true };
  }

  async captureShot() {
    const app = this.app;
    const { ent: camEnt, created } = this._resolveShotCamera();
    camEnt.cam.aspect = app.viewportAspect();
    camEnt.cam.updateProjectionMatrix();

    const canvas = app.withCleanRender(() => app.stage.snapshot(camEnt.cam, { crop: app.rig.frameRect }));
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));

    const n = (this._seq[camEnt.id] = (this._seq[camEnt.id] || 0) + 1);
    const shot = {
      id: 'shot' + (++this._count),
      cameraId: camEnt.id,
      cameraName: camEnt.name,
      name: `${camEnt.name}-截图${String(n).padStart(2, '0')}`,
      blob,
      url: URL.createObjectURL(blob),
      createdAt: Date.now(),
    };
    this.list.push(shot);
    app.emit('shots');
    toast(created ? `已截图（已新建${camEnt.name}）` : '已截图：' + shot.name);
    return shot;
  }

  shotsForCamera(cameraId) { return this.list.filter((s) => s.cameraId === cameraId); }

  sendShotsToCanvas(ids) {
    const ids2 = (ids && ids.length) ? ids : [...this.selectedShotIds];
    if (!ids2.length) { toast('请先选择截图'); return; }
    const sel = this.list.filter((s) => ids2.includes(s.id));
    sel.forEach(sendToCanvas);
    toast(`已发送 ${sel.length} 张到画布（示意）`);
  }

  removeShot(id) {
    if (!this._drop((s) => s.id === id)) return;
    this.app.emit('shots');
    toast('已删除截图');
  }

  /** 机位被删除时一并清理其截图（否则成为 UI 不可见、却仍可被发送的孤儿）。 */
  removeForCamera(cameraId) {
    if (this._drop((s) => s.cameraId === cameraId)) this.app.emit('shots');
  }

  /** 清掉找不到所属机位的截图（导入别的场景后）。 */
  pruneOrphans() {
    if (this._drop((s) => !this.app.findCamera(s.cameraId))) this.app.emit('shots');
  }

  clearShots() {
    this._drop(() => true);
    this._seq = {};
    this.app.emit('shots');
    toast('已清空全部截图');
  }

  toggleShotSelected(id) {
    if (this.selectedShotIds.has(id)) this.selectedShotIds.delete(id);
    else this.selectedShotIds.add(id);
    this.app.emit('shots');
  }

  /** 删除满足条件的截图并回收 ObjectURL，返回删除数量。 */
  _drop(pred) {
    const keep = [];
    let n = 0;
    for (const s of this.list) {
      if (pred(s)) { URL.revokeObjectURL(s.url); this.selectedShotIds.delete(s.id); n++; }
      else keep.push(s);
    }
    this.list = keep;
    return n;
  }
}
