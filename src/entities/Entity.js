// 实体基类：gizmo 与选择都作用于 root。
// 各类型差异通过覆盖下列钩子表达，App 不再按 type 字符串逐个分支。
let _idSeq = 0;

export class Entity {
  /**
   * @param {'character'|'prop'|'camera'|'crowd'} type
   * @param {string} name
   * @param {THREE.Object3D} root
   */
  constructor(type, name, root) {
    this.id = `e${++_idSeq}`;
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
