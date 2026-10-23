// @ts-check
// 数值小工具：舍入、角度换算、JSON 深拷贝与类型判断。全仓共用，不要在模块里另写一份。

/** 保留 digits 位小数并消除 -0。
 * @param {number} x @param {number} digits */
export function roundTo(x, digits) {
  const k = 10 ** digits;
  const v = Math.round(x * k) / k;
  return v === 0 ? 0 : v;
}

// 场景文档里的数统一保留 6 位小数。度↔弧度、相对缩放的往返误差在 1e-12 量级，舍入后"导出→导入→导出"严格相等。
/** @param {number} x */
export const round6 = (x) => roundTo(x, 6);
/** 界面 / 生成器坐标（0.1 mm）。 @param {number} x */
export const round4 = (x) => roundTo(x, 4);

/** Vector3 / Euler(弧度→度) → [x,y,z]。
 * @param {{x:number,y:number,z:number}} o @param {number} [k]
 * @returns {import("../types/contracts.js").Vec3} */
export const xyz = (o, k = 1) => [round6(o.x * k), round6(o.y * k), round6(o.z * k)];

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;

/** JSON 值深拷贝（调用方保证纯 JSON）。 @template T @param {T} v @returns {T} */
export const clone = (v) => JSON.parse(JSON.stringify(v));

/** @param {unknown} v @returns {v is Record<string, unknown>} */
export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** @param {unknown} v @returns {v is number} */
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
