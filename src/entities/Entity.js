// 实体基类（§7）：gizmo 与选择都作用于 root。
let _idSeq = 0;

export class Entity {
  /**
   * @param {'character'|'prop'} type
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
    root.userData.entityId = this.id; // §5.3 选择时向上回溯用
  }

  setVisible(v) {
    this.visible = v;
    this.root.visible = v;
  }

  /** 子类可覆盖以释放 GPU 资源。 */
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
