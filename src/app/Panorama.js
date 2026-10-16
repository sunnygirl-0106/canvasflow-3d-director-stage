import * as THREE from 'three';
import { isEquirectImage } from '../config.js';
import { toast } from '../util/dom.js';
import { genId } from '../entities/Entity.js';

/** 全景纹理加载 + 2:1 校验；非 2:1 则 dispose 并抛错（错误信息可直接 toast）。 */
async function loadEquirect(loader, src) {
  const tex = await loader.loadAsync(src);
  if (!isEquirectImage(tex.image)) {
    const w = tex.image?.naturalWidth || tex.image?.width || 0;
    const h = tex.image?.naturalHeight || tex.image?.height || 0;
    tex.dispose();
    throw new Error(`仅支持 2:1 全景图（如 2048×1024）${w && h ? `，当前为 ${w}×${h}` : ''}`);
  }
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/**
 * 全景背景：载入（本地文件 / 画布资产）→ 校验 2:1 → 交给 Stage 的全景球。
 * 场景文档里全景是一条资源：asset = { type:'image', name, url | dataURL }，按 assetId 引用。
 * - 本地上传：读成 dataURL（可随文档导出）；
 * - 画布资产：存同源 url（./assets/…），不把大图塞进文档。
 */
export class Panorama {
  /**
   * @param {Stage} stage
   * @param {{getSky:()=>number, onChange:(applied:boolean, opts:{silent:boolean})=>void}} hooks
   */
  constructor(stage, { getSky, onChange }) {
    this.stage = stage;
    this.getSky = getSky;
    this.onChange = onChange;
    this.active = false;
    this.info = null;       // { thumb, title }
    this.rotation = 0;      // 水平旋转（度）
    this.radius = 60;       // 球形半径
    this.assetId = null;    // 当前全景在文档 assets 表里的 id
    this.asset = null;      // { type:'image', name, url | dataURL }
    this._loader = new THREE.TextureLoader();
  }

  async setFromFile(file) {
    try {
      const dataURL = await readAsDataURL(file);
      await this._setAsset({ type: 'image', name: file.name || '本地全景图', dataURL });
      toast('已设置全景背景');
    } catch (err) { toast(err?.message?.startsWith('仅支持') ? err.message : '全景图加载失败'); }
  }

  async setFromAsset(asset) {
    try {
      await this._setAsset({ type: 'image', name: asset.title || '全景图', url: asset.url });
      toast('已设置全景背景：' + (asset.title || ''));
    } catch (err) { toast(err?.message?.startsWith('仅支持') ? err.message : '全景图加载失败'); }
  }

  async _setAsset(asset) {
    const tex = await loadEquirect(this._loader, asset.url || asset.dataURL);
    this._apply(tex, genId(), asset, { silent: false });
  }

  clear({ silent = false } = {}) {
    this.stage.clearPanorama(this.getSky());
    this.active = false;
    this.info = null;
    this.assetId = null;
    this.asset = null;
    this.onChange(false, { silent });
    if (!silent) toast('已移除全景背景');
  }

  setRotation(deg) { this.rotation = deg; this.stage.setPanoramaRotation(deg); }
  setRadius(r) { this.radius = r; this.stage.setPanoramaRadius(r); }

  /**
   * 为加载文档预备全景（异步、不改动当前画面）。返回句柄交给 commit；加载失败抛错。
   * 与当前全景是同一资源时复用已有纹理（撤销重做不重新解码大图）。
   * @param {{id:string, type:'image', name:string, url?:string, dataURL?:string}|null} ref
   */
  async prepare(ref) {
    if (!ref) return { kind: 'none', discard() {} };
    const { id, ...asset } = ref;
    const src = asset.url || asset.dataURL;
    if (this.active && this.asset && (this.asset.url || this.asset.dataURL) === src) {
      return { kind: 'reuse', id, asset, discard() {} };
    }
    const tex = await loadEquirect(this._loader, src);
    return { kind: 'load', id, asset, tex, discard: () => tex.dispose() };
  }

  /** 应用 prepare 的结果（静默：不 toast、不自动取景）。 */
  commit(handle, { rotation = 0, radius = 60 } = {}) {
    this.rotation = rotation;
    this.radius = radius;
    this.stage.setPanoramaRotation(rotation);
    this.stage.setPanoramaRadius(radius);
    if (handle.kind === 'none') { if (this.active) this.clear({ silent: true }); return; }
    if (handle.kind === 'reuse') {
      this.assetId = handle.id;
      this.asset = handle.asset;
      this.info = { thumb: handle.asset.url || handle.asset.dataURL, title: handle.asset.name };
      return;
    }
    this._apply(handle.tex, handle.id, handle.asset, { silent: true });
  }

  _apply(tex, assetId, asset, { silent }) {
    this.stage.setPanoramaRotation(this.rotation);
    this.stage.setPanoramaRadius(this.radius);
    this.stage.setPanorama(tex);
    this.active = true;
    this.assetId = assetId;
    this.asset = asset;
    this.info = { thumb: asset.url || asset.dataURL, title: asset.name };
    this.onChange(true, { silent });
  }
}
