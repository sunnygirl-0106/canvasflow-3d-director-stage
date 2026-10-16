// 静态姿势预设：每项 = { 关节key: 角度(度), ... }（键取自 src/rig/jointSchema.js）。
// 零点 = 自然站立（手臂下垂），由各模型档案的 neutralOffset 提供；故"站立"为空，
// 其余预设都是相对站立的增量。"T型"是特殊预设：values = -neutralOffset（由 Character 按档案计算），
// 与 neutralOffset 相加后总角度为 0，即回到文件静止位。
// 预设只转骨头；整体高度由 Character 自动贴地处理（最低骨头落地，如坐姿自动下沉）。

// 约定（见 jointSchema）：正值 = 标签动作，左右一致 —— 前举/外展/外旋/弯曲/抬腿 为正。
export const POSE_PRESETS = [
  { key: 'stand',  label: '站立', values: {} },
  { key: 'tpose',  label: 'T型',  special: 'tpose' },
  { key: 'walk',   label: '行走', values: { lLegFwd: 22, lKnee: 8, rLegFwd: -18, rKnee: 25, rFoot: 12, rArmFwd: 22,
                                             rFore: 20, lArmFwd: -18, lFore: 10, spineY: 5, lArmAbd: 3, rArmAbd: 3 } },
  { key: 'run',    label: '跑步', values: { spineX: 15, headX: -8, lLegFwd: 60, lKnee: 75, rLegFwd: -25, rKnee: 90,
                                             rFoot: 20, rArmFwd: 50, rFore: 95, lArmFwd: -40, lFore: 85, lArmAbd: 5,
                                             rArmAbd: 5, lArmTwist: 9, rArmTwist: 9 } },
  { key: 'akimbo', label: '叉腰', values: { lArmAbd: 35, rArmAbd: 35, lArmFwd: -3, rArmFwd: -3, lArmTwist: -50,
                                             rArmTwist: -50, lFore: 88, rFore: 88 } },
  { key: 'bow',    label: '鞠躬', values: { bodyX: 30, lLegFwd: 30, rLegFwd: 30, spineX: 20, headX: 10, lArmFwd: 9,
                                             rArmFwd: 9 } },
  { key: 'think',  label: '思考', values: { headX: 15, headZ: -6, spineX: 5, rArmFwd: 45, rArmAbd: 20, rArmTwist: -25,
                                             rFore: 118, rHand: 15, lArmFwd: 37, lArmTwist: -63, lFore: 91 } },
  { key: 'fight',  label: '格斗', values: { spineX: 10, spineY: -10, lLegFwd: 20, lKnee: 25, rLegFwd: -12, rKnee: 25,
                                             lLegAbd: 5, rLegAbd: 5, lArmFwd: 45, lArmAbd: 15, lArmTwist: -35, lFore: 115,
                                             rArmFwd: 36, rArmAbd: 20, rArmTwist: -35, rFore: 118 } },
  { key: 'kick',   label: '踢球', values: { spineX: -8, rLegFwd: 65, rKnee: 15, rFoot: 15, lKnee: 10,
                                             lArmAbd: 40, lArmFwd: 20, rArmAbd: 30, rArmFwd: -25, lFore: 20, rFore: 20 } },
  { key: 'throw',  label: '投掷', values: { spineY: -25, spineZ: -5, lLegFwd: 25, rLegFwd: -15, rKnee: 15,
                                             rArmAbd: 80, rArmTwist: 70, rFore: 95, lArmFwd: 75, lArmAbd: 10, lFore: 10 } },
  { key: 'push',   label: '推进', values: { spineX: 15, lLegFwd: 25, lKnee: 25, rLegFwd: -25, rKnee: 5,
                                             lArmFwd: 80, rArmFwd: 80, lArmTwist: -80, rArmTwist: -80,
                                             lFore: 15, rFore: 15, lHand: -70, rHand: -70 } },
  { key: 'wave',   label: '招手', values: { rArmAbd: 75, rArmTwist: 80, rFore: 70, headY: -10, headZ: 5 } },
  { key: 'reach',  label: '伸手', values: { spineX: 8, rArmFwd: 85, rArmAbd: 5, rFore: 5 } },
  { key: 'sit',    label: '坐姿', values: { lLegFwd: 90, rLegFwd: 90, lKnee: 90, rKnee: 90, lLegAbd: 6, rLegAbd: 6,
                                             spineX: 5, lArmFwd: 12, rArmFwd: 12, lArmTwist: -33, rArmTwist: -33, lFore: 74,
                                             rFore: 74 } },
  { key: 'cross',  label: '抱臂', values: { lArmFwd: 38, rArmFwd: 43, lArmAbd: 29, rArmAbd: 29, lArmTwist: -66,
                                             rArmTwist: -66, lFore: 97, rFore: 106 } },
];

export const POSE_PRESET_MAP = Object.fromEntries(POSE_PRESETS.map((p) => [p.key, p]));
