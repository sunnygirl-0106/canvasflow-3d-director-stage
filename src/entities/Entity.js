import { round6, xyz, D2R, R2D } from '../util/math.js';

// 实体基类：gizmo 与选择都作用于 root。
// 各类型差异通过覆盖下列钩子表达，App 不再按 type 字符串逐个分支。


/**
 * 实体 id：8 位 base36 随机串。场景文档按 id 互相引用（parent / members / activeCameraId），
 * 必须稳定且永不复用 —— 自增计数器在"导入文档后再新建"时会与文档里的 id 撞车。
 */
export function genId() {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  return (buf[0].toString(36) + buf[1].toString(36)).padStart(8, '0').slice(-8);
}

/** '#rrggbb'（文档颜色格式）。 */
export const hexColor = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6);

export class Entity {
  /**
   * @param {'character'|'prop'|'camera'|'group'} type（与文档的 type 同名）
   * @param {string} name
   * @param {THREE.Object3D} root
   * @param {string} [id] 从文档重建时传入原 id；新建时随机生成
   */
  constructor(type, name, root, id = genId()) {
    this.id = id;
    this.type = type;
    this.name = name;
    this.root = root;
    this.visible = true;
    this.baseScale = 1; // 归一化基准缩放（统一缩放滑条以此为 1.0 基准）
    this.labelEl = null; // 名牌 DOM，由 Labels 管理
    root.userData.entityId = this.id; // 选择时向上回溯用
  }

  setVisible(v) {
    this.visible = v;
    this.root.visible = v;
  }

  /** 子实体（群众成员等）；普通实体为空。 */
  get children() { return []; }

  /** 需要显示名牌的实体（自身或成员）。 */
  labelTargets() { return []; }

  /** 名牌相对 root 的世界高度偏移（未乘场景缩放）。 */
  labelOffset() { return 0; }

  /** 辅助可视化（相机体/视锥）显隐；只有相机需要。 */
  setHelpersVisible() {}

  /** 每帧渲染前同步（相机视锥等）。 */
  update() {}

  // ---- 场景文档 ----
  // 子类实现 toJSON({ base }) 与 static async fromJSON(json, ctx)（ctx = { app, assets, entity(id) }）。
  // base：时间轴 active 期间该实体的手动值（Timeline.baseOf），有则导出 base 而不是 root 上的动画瞬时值。

  /** 文档 transform 与 root 变换之间的换算：pos = root.pos − posOffset，scale = root.scale ÷ scaleDiv。 */
  docTransformOpts() { return { posOffset: [0, 0, 0], scaleDiv: [1, 1, 1] }; }

  /**
   * root 的局部变换 → 文档 transform（rot 为度）。
   * @param {{position, rotation, scale}} [src] 取值来源，默认 root；传 Timeline base 时导出手动值
   */
  transformJSON(src = this.root) {
    const { posOffset, scaleDiv } = this.docTransformOpts();
    const r = src;
    const pos = xyz(r.position).map((v, i) => round6(v - posOffset[i]));
    const scale = [r.scale.x / scaleDiv[0], r.scale.y / scaleDiv[1], r.scale.z / scaleDiv[2]].map(round6);
    return { pos, rot: xyz(r.rotation, R2D), scale };
  }

  /** 文档 transform → root 的局部变换（transformJSON 的逆）。 */
  applyTransform({ pos, rot, scale }) {
    const { posOffset, scaleDiv } = this.docTransformOpts();
    const r = this.root;
    r.position.set(pos[0] + posOffset[0], pos[1] + posOffset[1], pos[2] + posOffset[2]);
    r.rotation.set(rot[0] * D2R, rot[1] * D2R, rot[2] * D2R);
    r.scale.set(scale[0] * scaleDiv[0], scale[1] * scaleDiv[1], scale[2] * scaleDiv[2]);
    r.updateMatrixWorld(true);
  }

  /** 释放 GPU 资源。 */
  dispose() {
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
        else m?.dispose?.();
      }
    });
  }
}
