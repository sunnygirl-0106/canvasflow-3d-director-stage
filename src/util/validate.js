import { isNum, isObj } from './math.js';

export const fmt = v => v === undefined ? 'undefined' : JSON.stringify(v, (k, x) => typeof x === 'number' && !Number.isFinite(x) ? String(x) : x);
export const rule = (test, reason) => ({ check(v, p, err) { if (v !== undefined && !test(v)) err(p, `${reason}，实际为 ${fmt(v)}`); } });
export const optional = type => ({ type, required: false });
export const nullable = type => ({ check(v, p, err) { if (v !== null) return type.check(v, p, err); } });
export const hex = rule(v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v), '应为 #rrggbb 颜色');
export const enumOf = list => rule(v => list.includes(v), `应为 ${list.join(' / ')}`);

/** @typedef {{min?:number,max?:number,gt?:number,int?:boolean}} Bounds */
/** 有限数及范围；所有检查器由 err(path, reason) 输出定位。
 * @param {Bounds} [options] */
export function num({ min = -Infinity, max = Infinity, gt, int = false } = {}) {
  return rule(v => isNum(v) && (!int || Number.isInteger(v)) && v >= min && v <= max && (gt == null || v > gt),
    `应为${int ? '整数' : '有限数'}，范围 ${gt == null ? `[${min}` : `(${gt}`}..${max}]`);
}

/** 文档定位到分量；AI 向量的既有反馈定位到整个字段。
 * @param {Bounds & {components?:boolean}} [options] */
export function vec3({ components = true, ...bounds } = {}) {
  const scalar = num(bounds);
  return { check(v, p, err) {
    if (v === undefined) return;
    if (!Array.isArray(v) || v.length !== 3) { err(p, '应为长度 3 的数组'); return; }
    v.forEach((x, i) => {
      if (x === undefined) err(components ? `${p}[${i}]` : p, '应为有限数');
      else scalar.check(x, components ? `${p}[${i}]` : p, err);
    });
  } };
}

export function arrayOf(type, min = 0) {
  return { check(v, p, err) {
    if (v === undefined) return;
    if (!Array.isArray(v) || v.length < min) { err(p, `应为至少 ${min} 项的数组`); return; }
    v.forEach((value, i) => type.check(value, `${p}[${i}]`, err));
  } };
}

/** 字段默认必填；missingAt 保留文档与 ops 原有的缺字段定位口径。 */
export function obj(fields, { strict = true, missingAt = 'field' } = {}) {
  return { check(v, p, err) {
    if (v === undefined) return false;
    if (!isObj(v)) { err(p, `应为对象，实际为 ${fmt(v)}`); return false; }
    for (const [key, field] of Object.entries(fields)) {
      const missing = missingAt === 'parent' ? !(key in v) : v[key] === undefined;
      if (missing && field.required !== false) {
        const at = field.missingAt || missingAt;
        if (at !== 'field') err(p, `缺少字段 ${key}`);
        if (at !== 'parent') err(`${p}.${key}`, `缺少字段 ${key}`);
      }
      else if (v[key] !== undefined) (field.type || field).check(v[key], `${p}.${key}`, err);
    }
    if (strict) for (const key of Object.keys(v)) if (!Object.hasOwn(fields, key)) err(`${p}.${key}`, '是未知字段');
    return true;
  } };
}
