// 静态姿势预设：每项 = { 关节key: 角度(度), ... }（键取自 jointConfig.js 的 key）。
// 静止位是 Mixamo T-Pose（手臂水平张开），故"站立"需把手臂放下；"T型"才是全 0。
// 复用基线：STAND = 手臂自然下垂于体侧（多数站立类预设以此为基础叠加）。
// 所有保留姿势都不需要位移根节点（双脚/单脚着地，纯骨骼旋转），故不引入 rootY 等下沉字段。

const STAND = { lArmAbd: -80, rArmAbd: 80, lFore: -8, rFore: 8 };

// 说明：左右成对关节通常镜像（外展 lArmAbd 取负、rArmAbd 取正；前举/弯曲同理）。
// ⚠️ 下列角度为"起始值"，需按规划文档 §6 在浏览器实测校准（骨骼本地轴方向不完全一致）。
export const POSE_PRESETS = [
  { key: 'stand',  label: '站立', values: { ...STAND } },
  { key: 'tpose',  label: 'T型',  values: {} },                                     // 全 0 = 静止位
  { key: 'walk',   label: '行走', values: { ...STAND, lLegFwd: -25, rLegFwd: 20, lKnee: 20, rKnee: 10,
                                             lArmFwd: -25, rArmFwd: 30, lFore: -25, rFore: 25 } },
  { key: 'run',    label: '跑步', values: { ...STAND, spineX: 15, lLegFwd: -40, rLegFwd: 30, lKnee: 30, rKnee: 85,
                                             lArmFwd: 45, rArmFwd: -35, lFore: -95, rFore: 95 } },
  { key: 'akimbo', label: '叉腰', values: { lArmAbd: -62, rArmAbd: 62, lArmFwd: 12, rArmFwd: 12,
                                             lFore: -95, rFore: 95, lArmTwist: 30, rArmTwist: -30 } },
  { key: 'bow',    label: '鞠躬', values: { bodyX: 18, spineX: 35, headX: 12, lArmAbd: -82, rArmAbd: 82 } },
  { key: 'think',  label: '思考', values: { headX: 12, headZ: 8, lArmAbd: -70, lArmFwd: 18, lFore: -85,
                                             rArmAbd: 38, rArmFwd: 28, rFore: 110, rArmTwist: 40 } },
  { key: 'fight',  label: '格斗', values: { spineX: 10, spineY: 12, lLegFwd: -15, rLegFwd: 10, lKnee: 20, rKnee: 20,
                                             lArmFwd: 40, rArmFwd: 50, lArmAbd: -50, rArmAbd: 45, lFore: -100, rFore: 105,
                                             lArmTwist: 30, rArmTwist: -30 } },
  { key: 'kick',   label: '踢球', values: { spineX: -10, rLegFwd: -70, rKnee: 20, lKnee: 12,
                                             lArmAbd: -45, rArmAbd: 60, lArmFwd: -20, rArmFwd: -20 } },
  { key: 'throw',  label: '投掷', values: { bodyY: -20, spineY: -28, lLegFwd: -20, rLegFwd: 15,
                                             rArmFwd: 160, rArmAbd: 30, rFore: 90, lArmFwd: 70, lArmAbd: -50 } },
  { key: 'push',   label: '推进', values: { spineX: 18, lLegFwd: -20, rLegFwd: 12, rKnee: 15,
                                             lArmFwd: 90, rArmFwd: 90, lArmAbd: -70, rArmAbd: 70, lFore: -15, rFore: 15 } },
  { key: 'wave',   label: '招手', values: { lArmAbd: -80, lFore: -8,                                  // 左臂保持下垂
                                             rArmAbd: 95, rArmFwd: 18, rFore: 85, rArmTwist: -40, headY: -10 } },
  { key: 'reach',  label: '伸手', values: { lArmAbd: -80, lFore: -8, spineX: 8,
                                             rArmFwd: 85, rArmAbd: 55, rFore: 0 } },
  { key: 'cross',  label: '抱臂', values: { lArmFwd: 25, rArmFwd: 25, lArmAbd: -55, rArmAbd: 55,
                                             lFore: -100, rFore: 100, lArmTwist: 40, rArmTwist: -40 } },
];

export const POSE_PRESET_MAP = Object.fromEntries(POSE_PRESETS.map((p) => [p.key, p]));
