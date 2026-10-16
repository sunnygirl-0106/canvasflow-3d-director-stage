// 语义关节表（与模型无关）。字段：{key, label, group, side, min, max}
// - key：姿势数据的唯一键（posePresets / Pose.values 都用它）。
// - 哪根骨头、转哪个轴、正负号、站立偏移 → 由各模型档案 src/rig/profiles/*.js 提供。
// - min/max 是"相对自然站立"的语义范围（度）：0 = 站立，写死在这里，与档案无关。
// - 正值 = 标签上的动作，左右两侧一致：前倾/点头/前举/外展/外旋/弯曲/抬腿/绷脚 为正；
//   转身/扭转/转头 正值向角色左侧，侧倾/歪头 正值向角色右侧。
export const JOINT_SCHEMA = [
  // 身体（整体朝向）
  { group: '身体', side: '', key: 'bodyX', label: '前倾', min: -30, max: 30 },
  { group: '身体', side: '', key: 'bodyY', label: '转身', min: -90, max: 90 },
  { group: '身体', side: '', key: 'bodyZ', label: '侧倾', min: -30, max: 30 },
  // 躯干
  { group: '躯干', side: '', key: 'spineX', label: '前倾(弯腰)', min: -35, max: 35 },
  { group: '躯干', side: '', key: 'spineY', label: '扭转', min: -40, max: 40 },
  { group: '躯干', side: '', key: 'spineZ', label: '侧倾', min: -30, max: 30 },
  // 头部
  { group: '头部', side: '', key: 'headX', label: '点头', min: -45, max: 45 },
  { group: '头部', side: '', key: 'headY', label: '转头', min: -60, max: 60 },
  { group: '头部', side: '', key: 'headZ', label: '歪头', min: -35, max: 35 },
  // 手臂—肩 · 左 / 右
  { group: '手臂—肩', side: '左', key: 'lArmFwd', label: '前举', min: -60, max: 180 },
  { group: '手臂—肩', side: '左', key: 'lArmAbd', label: '外展', min: -15, max: 170 },
  { group: '手臂—肩', side: '左', key: 'lArmTwist', label: '外旋', min: -90, max: 90 },
  { group: '手臂—肩', side: '右', key: 'rArmFwd', label: '前举', min: -60, max: 180 },
  { group: '手臂—肩', side: '右', key: 'rArmAbd', label: '外展', min: -15, max: 170 },
  { group: '手臂—肩', side: '右', key: 'rArmTwist', label: '外旋', min: -90, max: 90 },
  // 肘部
  { group: '肘部', side: '左', key: 'lFore', label: '弯曲', min: -8, max: 145 },
  { group: '肘部', side: '右', key: 'rFore', label: '弯曲', min: -8, max: 145 },
  // 手腕
  { group: '手腕', side: '左', key: 'lHand', label: '弯曲', min: -60, max: 60 },
  { group: '手腕', side: '右', key: 'rHand', label: '弯曲', min: -60, max: 60 },
  // 腿部—髋 · 左 / 右
  { group: '腿部—髋', side: '左', key: 'lLegFwd', label: '抬腿', min: -45, max: 110 },
  { group: '腿部—髋', side: '左', key: 'lLegAbd', label: '外展', min: -20, max: 60 },
  { group: '腿部—髋', side: '右', key: 'rLegFwd', label: '抬腿', min: -45, max: 110 },
  { group: '腿部—髋', side: '右', key: 'rLegAbd', label: '外展', min: -20, max: 60 },
  // 膝
  { group: '膝', side: '左', key: 'lKnee', label: '弯曲', min: 0, max: 140 },
  { group: '膝', side: '右', key: 'rKnee', label: '弯曲', min: 0, max: 140 },
  // 踝
  { group: '踝', side: '左', key: 'lFoot', label: '绷脚', min: -40, max: 40 },
  { group: '踝', side: '右', key: 'rFoot', label: '绷脚', min: -40, max: 40 },
];

export const JOINT_KEYS = JOINT_SCHEMA.map((j) => j.key);

/** 按出现顺序分组：[{group, sides:[{side, joints:[...]}]}] —— 供 PoseSliders 渲染。 */
export function groupJoints(joints = JOINT_SCHEMA) {
  const groups = [];
  const gmap = new Map();
  for (const j of joints) {
    let g = gmap.get(j.group);
    if (!g) {
      g = { group: j.group, sides: [], _smap: new Map() };
      gmap.set(j.group, g);
      groups.push(g);
    }
    const sideKey = j.side || '';
    let s = g._smap.get(sideKey);
    if (!s) {
      s = { side: sideKey, joints: [] };
      g._smap.set(sideKey, s);
      g.sides.push(s);
    }
    s.joints.push(j);
  }
  groups.forEach((g) => delete g._smap);
  return groups;
}
