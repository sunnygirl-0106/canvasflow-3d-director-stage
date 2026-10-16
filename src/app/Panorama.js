import * as THREE from 'three';
import { isEquirectImage } from '../config.js';
import { toast } from '../util/dom.js';

// 全景背景：载入（本地文件 / 画布资产）→ 校验 2:1 → 交给 Stage 的全景球；管理 ObjectURL 回收。
export class Panorama {
  /**
   * @param {Stage} stage
   * @param {{getSky:()=>number, onChange:(applied:boolean)=>void}} hooks
   */
  constructor(stage, { getSky, onChange }) {
    this.stage = stage;
    this.getSky = getSky;
    this.onChange = onChange;
    this.active = false;
    this.info = null;       // { thumb, title }
    this.rotation = 0;      // 水平旋转（度）
    this.radius = 60;       // 球形半径
    this._objURL = null;    // 本地上传时的 ObjectURL（替换/清除时回收）
    this._loader = new THREE.TextureLoader();
  }

  setFromFile(file) {
    const objURL = URL.createObjectURL(file);
    this._loader.load(
      objURL,
      (tex) => { if (this._apply(tex, { thumb: objURL, title: file.name || '本地全景图' }, objURL)) toast('已设置全景背景'); },
      undefined,
      () => { URL.revokeObjectURL(objURL); toast('全景图加载失败'); },
    );
  }

  setFromAsset(asset) {
    this._loader.load(
      asset.url,
      (tex) => { if (this._apply(tex, { thumb: asset.thumb || asset.url, title: asset.title || '全景图' }, null)) toast('已设置全景背景：' + (asset.title || '')); },
      undefined,
      () => toast('全景图加载失败'),
    );
  }

  clear() {
    this.stage.clearPanorama(this.getSky());
    this._revoke();
    this.active = false;
    this.info = null;
    this.onChange(false);
    toast('已移除全景背景');
  }

  setRotation(deg) { this.rotation = deg; this.stage.setPanoramaRotation(deg); }
  setRadius(r) { this.radius = r; this.stage.setPanoramaRadius(r); }

  // 校验 2:1 后再应用；非 2:1 直接拒绝并提示，返回 false。
  _apply(tex, info, objURL) {
    if (!isEquirectImage(tex.image)) {
      const w = tex.image?.naturalWidth || tex.image?.width || 0;
      const h = tex.image?.naturalHeight || tex.image?.height || 0;
      tex.dispose();
      if (objURL) URL.revokeObjectURL(objURL);
      toast(`仅支持 2:1 全景图（如 2048×1024）${w && h ? `，当前为 ${w}×${h}` : ''}`);
      return false;
    }
    tex.colorSpace = THREE.SRGBColorSpace;
    if (this._objURL !== objURL) this._revoke();
    this._objURL = objURL || null;
    this.stage.setPanoramaRotation(this.rotation);
    this.stage.setPanoramaRadius(this.radius);
    this.stage.setPanorama(tex);
    this.active = true;
    this.info = info;
    this.onChange(true);
    return true;
  }

  _revoke() {
    if (this._objURL) { URL.revokeObjectURL(this._objURL); this._objURL = null; }
  }
}
