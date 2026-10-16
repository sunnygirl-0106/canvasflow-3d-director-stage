import { Entity } from './Entity.js';

// 群众 / 组：一个 THREE.Group 轴心 + N 个 Character 成员。
// 选中整组时 gizmo 作用于轴心 → 整组一起变换；颜色/姿势由 Inspector 广播到全部成员。
// 成员仍是独立 Character（保留摆姿/名牌），只是 root 挂在 group 轴心下。
export class Crowd extends Entity {
  /**
   * @param {string} name 组名，如「群众 (3x3)」
   * @param {THREE.Group} root 轴心（已含各成员 root 为子节点）
   * @param {import('./Character.js').Character[]} members
   * @param {{rows?:number, cols?:number}} meta
   */
  constructor(name, root, members, meta = {}) {
    super('crowd', name, root);
    this.members = members;
    this.rows = meta.rows;
    this.cols = meta.cols;
    for (const m of members) m.root.userData.entityId = this.id; // 视口点击成员 → 选中整组
  }

  get children() { return this.members; }

  labelTargets() { return this.members; }

  /** 代表色（取首个成员），供 Inspector 颜色行初值。 */
  get color() { return this.members[0]?.color ?? 0x4f8ef7; }

  setColor(hex) { this.members.forEach((m) => m.setColor(hex)); }

  setVisible(v) {
    super.setVisible(v);
    this.members.forEach((m) => { m.visible = v; }); // 同步成员 visible 标志（名牌据此显隐）
  }

  /** 移出一个成员（不销毁）；恢复其独立选择。 */
  removeMember(m) {
    const i = this.members.indexOf(m);
    if (i < 0) return;
    this.members.splice(i, 1);
    this.root.remove(m.root);
    m.root.userData.entityId = m.id;
  }

  /** 解组：成员恢复独立选择，返回成员列表（世界位姿由调用方处理）。 */
  release() {
    for (const m of this.members) m.root.userData.entityId = m.id;
    return this.members.slice();
  }

  dispose() { this.members.forEach((m) => m.dispose()); }
}
