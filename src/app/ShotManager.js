import { capture, sendToCanvas } from '../util/capture.js';
import { toast } from '../util/dom.js';

/**
 * 截图小王国（§C）：管理会话内的截图数据与相关操作。
 * 自成一体——状态与方法之间互相调用多，对外只暴露少量入口。
 * 需要场景 / 相机 / 渲染等运行时依赖时，通过构造函数传入的 app 拿。
 */
export class ShotManager {
  constructor(app) {
    this.app = app;                  // 通过 app 取 stage / rig / entities / 渲染洁净钩子
    this.list = [];                  // { id, cameraId, cameraName, name, dataURL, createdAt }
    this.selectedShotIds = new Set();
    this._seq = {};                  // 每机位序号 { [cameraId]: n }
    this._count = 0;
    this.latestShot = null;
  }

  /** 确定本次截图归属的机位实体；导演视角下若无机位上下文则按当前视角自动新建（§C.2/G.1）。 */
  _resolveShotCamera() {
    const app = this.app;
    if (app.cameraView && app.activeCameraId) {
      const a = app.entities.find((e) => e.id === app.activeCameraId && e.type === 'camera');
      if (a) return { ent: a, created: false };
    }
    if (app.selected?.type === 'camera') return { ent: app.selected, created: false };
    // 无机位上下文：按当前视角新建机位（克隆导演相机位姿）
    const ent = app.addCamera('current');
    return { ent, created: true };
  }

  captureShot() {
    const app = this.app;
    const { ent: camEnt, created } = this._resolveShotCamera();
    camEnt.cam.aspect = app._viewportAspect();
    camEnt.cam.updateProjectionMatrix();

    const url = capture({
      renderer: app.stage.renderer, scene: app.stage.scene, camera: camEnt.cam,
      viewport: app.stage.viewport, frameRect: app.rig.frameRect,
      beforeRender: () => app._beginCleanRender(),
      afterRender: () => app._endCleanRender(),
    });

    const n = (this._seq[camEnt.id] = (this._seq[camEnt.id] || 0) + 1);
    const shot = {
      id: 'shot' + (++this._count),
      cameraId: camEnt.id,
      cameraName: camEnt.name,
      name: `${camEnt.name}-截图${String(n).padStart(2, '0')}`,
      dataURL: url,
      createdAt: Date.now(),
    };
    this.list.push(shot);
    this.latestShot = url;
    app.ui?.outliner?.refresh();
    app.ui?.inspector?.onShotsChanged?.();
    toast(created ? `已截图（已新建${camEnt.name}）` : '已截图：' + shot.name);
    return shot;
  }

  shotsForCamera(cameraId) { return this.list.filter((s) => s.cameraId === cameraId); }

  sendShotsToCanvas(ids) {
    const ids2 = (ids && ids.length) ? ids : [...this.selectedShotIds];
    if (!ids2.length) { toast('请先选择截图'); return; }
    const sel = this.list.filter((s) => ids2.includes(s.id));
    sel.forEach((s) => sendToCanvas(s.dataURL));
    toast(`已发送 ${sel.length} 张到画布（示意）`);
  }

  removeShot(id) {
    const i = this.list.findIndex((s) => s.id === id);
    if (i < 0) return;
    this.list.splice(i, 1);
    this.selectedShotIds.delete(id);
    this.app.ui?.inspector?.onShotsChanged?.();
    toast('已删除截图');
  }

  clearShots() {
    this.list = [];
    this.selectedShotIds.clear();
    this._seq = {};
    this.app.ui?.inspector?.onShotsChanged?.();
    toast('已清空全部截图');
  }

  toggleShotSelected(id) {
    if (this.selectedShotIds.has(id)) this.selectedShotIds.delete(id);
    else this.selectedShotIds.add(id);
    this.app.ui?.inspector?.onShotsChanged?.();
  }
}
