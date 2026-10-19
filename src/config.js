// 全局配置（单一事实来源）：素体体型、道具、取景比例、全景图规则。
// App 与 UI 都从这里读，UI 不再反向 import App.js。

// 体型素体注册表：每项绑定一份骨骼档案（src/rig/profiles），模型文件取自档案的 file。
// male / female 为真实人偶模型；tall/small/broad/slim 暂由 bodykun_male 按 height(身高) +
// girth(横向围度) 程序化派生（后续换成真实体型模型）；xbot 保留作备选。
import { PROFILES } from './rig/profiles/index.js';

export const BODY_TYPES = {
  male:   { profile: PROFILES.bodykun_male,    label: '男性素体', height: 1.75, girth: 1.00 },
  female: { profile: PROFILES.bodychan_female, label: '女性素体', height: 1.62, girth: 1.00 },
  tall:   { profile: PROFILES.bodykun_male,    label: '高大素体', height: 2.05, girth: 1.06 },
  small:  { profile: PROFILES.bodykun_male,    label: '矮小素体', height: 1.25, girth: 0.94 },
  broad:  { profile: PROFILES.bodykun_male,    label: '宽厚素体', height: 1.70, girth: 1.30 },
  slim:   { profile: PROFILES.bodykun_male,    label: '纤细素体', height: 1.78, girth: 0.80 },
  xbot:   { profile: PROFILES.xbot,            label: 'Xbot 素体', height: 1.75, girth: 1.00 },
};

/** 体型 key → 角色加载规格 { url, profile, height, girth, body }。 */
export function bodySpec(key) {
  const b = BODY_TYPES[key];
  return b ? { url: b.profile.file, profile: b.profile, height: b.height, girth: b.girth, body: key } : null;
}

export const PROP_KINDS = [['box', '方块'], ['cylinder', '圆柱'], ['sphere', '球体'], ['mannequin', '人体素模']];
export const PROP_LABEL = Object.fromEntries(PROP_KINDS);

// 角色默认颜色（截图同款素体绿）
export const CHARACTER_COLOR = 0x34c759;

// 群众阵列成员配色
export const CROWD_PALETTE = [0x4f8ef7, 0xff9f43, 0xee5253, 0x10ac84, 0xfeca57, 0xa55eea, 0x00d2d3, 0xff6b9d, 0x9b59b6];

// 取景比例候选。'auto' 等价自由（不显示取景框）。
export const RATIO_OPTIONS = [
  ['auto', 'Auto（默认）'], ['21:9', '21:9'], ['16:9', '16:9'],
  ['4:3', '4:3'], ['1:1', '1:1'], ['3:4', '3:4'], ['9:16', '9:16'],
];

// 全景图限制（一期）：仅接受等距柱状（equirectangular）全景，宽:高 = 2:1。
// 非 2:1（局部/柱面全景、普通照片）贴到全景球会上下拉伸且盖不住天地，故拒绝并提示。
export const PANO_RATIO = 2;
export const PANO_RATIO_TOL = 0.05; // 相对容差 ±5% → 宽高比落在 [1.9, 2.1] 视为合法

/** 按宽高判定是否 2:1 全景。拿不到尺寸时放行（极少见，避免误杀）。 */
export function isPanoRatio(w, h) {
  if (!w || !h) return true;
  return Math.abs(w / h - PANO_RATIO) <= PANO_RATIO * PANO_RATIO_TOL;
}
export function isEquirectImage(img) {
  return isPanoRatio(img?.naturalWidth || img?.width || 0, img?.naturalHeight || img?.height || 0);
}
