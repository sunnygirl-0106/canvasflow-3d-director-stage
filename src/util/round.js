// 数值舍入：场景文档里的数统一保留 6 位小数并消除 -0。
// 度↔弧度、相对缩放的往返误差在 1e-12 量级，舍入后"导出→导入→导出"严格相等。
export function round6(x) {
  const v = Math.round(x * 1e6) / 1e6;
  return v === 0 ? 0 : v;
}

/** Vector3 / Euler(弧度→度) / 任意 {x,y,z} → [x,y,z]（已舍入）。 */
export const xyz = (o, k = 1) => [o.x * k, o.y * k, o.z * k].map(round6);
