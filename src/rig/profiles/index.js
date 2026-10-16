// 档案注册表：id → 档案。新增人偶：复制一份档案文件并在这里登记。
import xbot from './xbot.js';
import bodykun_male from './bodykun_male.js';
import bodychan_female from './bodychan_female.js';

export const PROFILES = { xbot, bodykun_male, bodychan_female };

/** 档案对象或 id → 档案对象；未知 id 返回 null。 */
export function getProfile(p) {
  if (!p) return null;
  return typeof p === 'string' ? PROFILES[p] || null : p;
}
