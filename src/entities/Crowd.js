// 群众阵列（组实体）：一个 THREE.Group 轴心 + N 个 Character 成员。
// 选中整组时 gizmo 作用于轴心 → 整组一起变换；颜色/姿势由 Inspector 广播到全部成员。
// 成员仍是独立 Character（保留摆姿/预设动画/名牌），只是 root 挂在 group 轴心下。
let _seq = 0;

export class Crowd {
  /**
   * @param {string} name 组名，如「群众 (3x3)」
   * @param {THREE.Group} root 轴心（已含各成员 root 为子节点）
   * @param {import('./Character.js').Character[]} members
   * @param {{rows:number, cols:number, spacing:number}} meta
   */
  constructor(name, root, members, meta = {}) {
    this.id = 'crowd' + (++_seq);
    this.type = 'crowd';
    this.name = name;
    this.root = root;
    this.members = members;
    this.visible = true;
    this.baseScale = 1; // 轴心基准缩放（统一缩放滑条以此为 1.0）
    this.rows = meta.rows;
    this.cols = meta.cols;
    root.userData.entityId = this.id; // 视口点击任一成员都回溯到整组
  }

  /** 代表色（取首个成员），供 Inspector 颜色行初值。 */
  get color() { return this.members[0]?.color ?? 0x4f8ef7; }

  /** 同步着色到全部成员。 */
  setColor(hex) { this.members.forEach((m) => m.setColor(hex)); }

  setVisible(v) {
    this.visible = v;
    this.root.visible = v;
    this.members.forEach((m) => { m.visible = v; }); // 同步成员 visible 标志（名牌据此显隐）
  }

  dispose() { this.members.forEach((m) => m.dispose()); }
}
