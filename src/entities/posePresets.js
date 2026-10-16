// 静态姿势预设：每项 = { 关节key: 角度(度), ... }（键取自 src/rig/jointSchema.js）。
// 零点 = 自然站立（手臂下垂），由各模型档案的 neutralOffset 提供；故"站立"为空，
// 其余预设都是相对站立的增量。"T型"是特殊预设：values = -neutralOffset（由 Character 按档案计算），
// 与 neutralOffset 相加后总角度为 0，即回到文件静止位。
// 所有保留姿势都不需要位移根节点（双脚/单脚着地，纯骨骼旋转），故不引入 rootY 等下沉字段。

// 说明：左右成对关节通常镜像（外展 lArmAbd 取正为抬起、rArmAbd 取负为抬起；前举/弯曲同理）。
export const POSE_PRESETS = [
  { key: 'stand',  label: '站立', values: {} },
  { key: 'tpose',  label: 'T型',  special: 'tpose' },
  { key: 'walk',   label: '行走', values: { lLegFwd: -25, rLegFwd: 20, lKnee: 20, rKnee: 10,
                                             lArmFwd: -25, rArmFwd: 30, lFore: -17, rFore: 17 } },
  { key: 'run',    label: '跑步', values: { spineX: 15, lLegFwd: -40, rLegFwd: 30, lKnee: 30, rKnee: 85,
                                             lArmFwd: 45, rArmFwd: -35, lFore: -87, rFore: 87 } },
  { key: 'akimbo', label: '叉腰', values: { lArmAbd: 18, rArmAbd: -18, lArmFwd: 12, rArmFwd: 12,
                                             lFore: -87, rFore: 87, lArmTwist: 30, rArmTwist: -30 } },
  { key: 'bow',    label: '鞠躬', values: { bodyX: 18, spineX: 35, headX: 12, lArmAbd: -2, rArmAbd: 2,
                                             lFore: 8, rFore: -8 } },
  { key: 'think',  label: '思考', values: { headX: 12, headZ: 8, lArmAbd: 10, lArmFwd: 18, lFore: -77,
                                             rArmAbd: -42, rArmFwd: 28, rFore: 102, rArmTwist: 40 } },
  { key: 'fight',  label: '格斗', values: { spineX: 10, spineY: 12, lLegFwd: -15, rLegFwd: 10, lKnee: 20, rKnee: 20,
                                             lArmFwd: 40, rArmFwd: 50, lArmAbd: 30, rArmAbd: -35, lFore: -92, rFore: 97,
                                             lArmTwist: 30, rArmTwist: -30 } },
  { key: 'kick',   label: '踢球', values: { spineX: -10, rLegFwd: -70, rKnee: 20, lKnee: 12,
                                             lArmAbd: 35, rArmAbd: -20, lArmFwd: -20, rArmFwd: -20, lFore: 8, rFore: -8 } },
  { key: 'throw',  label: '投掷', values: { bodyY: -20, spineY: -28, lLegFwd: -20, rLegFwd: 15,
                                             rArmFwd: 160, rArmAbd: -50, rFore: 82, lArmFwd: 70, lArmAbd: 30, lFore: 8 } },
  { key: 'push',   label: '推进', values: { spineX: 18, lLegFwd: -20, rLegFwd: 12, rKnee: 15,
                                             lArmFwd: 90, rArmFwd: 90, lArmAbd: 10, rArmAbd: -10, lFore: -7, rFore: 7 } },
  { key: 'wave',   label: '招手', values: { rArmAbd: 15, rArmFwd: 18, rFore: 77, rArmTwist: -40, headY: -10 } },
  { key: 'reach',  label: '伸手', values: { spineX: 8, rArmFwd: 85, rArmAbd: -25, rFore: -8 } },
  { key: 'cross',  label: '抱臂', values: { lArmFwd: 25, rArmFwd: 25, lArmAbd: 25, rArmAbd: -25,
                                             lFore: -92, rFore: 92, lArmTwist: 40, rArmTwist: -40 } },
];

export const POSE_PRESET_MAP = Object.fromEntries(POSE_PRESETS.map((p) => [p.key, p]));
