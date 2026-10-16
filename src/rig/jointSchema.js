// 语义关节表（与模型无关）。字段：{key, label, group, side, min, max}
// - key：姿势数据的唯一键（posePresets / Pose.values 都用它）。
// - 哪根骨头、转哪个轴、正负号、站立偏移 → 由各模型档案 src/rig/profiles/*.js 提供。
// - min/max 是"相对自然站立"的语义范围（度）：0 = 站立。原 T-pose 基准的范围已按 Xbot 的
//   neutralOffset 平移一次后写死在这里，运行时不再按档案动态计算。
// 左右成对动作通常镜像（正负相反）。
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
  { group: '手臂—肩', side: '左', key: 'lArmFwd', label: '前举', min: -90, max: 180 },
  { group: '手臂—肩', side: '左', key: 'lArmAbd', label: '外展', min: -15, max: 115 },
  { group: '手臂—肩', side: '左', key: 'lArmTwist', label: '扭转', min: -90, max: 90 },
  { group: '手臂—肩', side: '右', key: 'rArmFwd', label: '前举', min: -90, max: 180 },
  { group: '手臂—肩', side: '右', key: 'rArmAbd', label: '外展', min: -115, max: 15 },
  { group: '手臂—肩', side: '右', key: 'rArmTwist', label: '扭转', min: -90, max: 90 },
  // 肘部
  { group: '肘部', side: '左', key: 'lFore', label: '弯曲', min: -102, max: 18 },
  { group: '肘部', side: '右', key: 'rFore', label: '弯曲', min: -18, max: 102 },
  // 手腕
  { group: '手腕', side: '左', key: 'lHand', label: '弯曲', min: -60, max: 60 },
  { group: '手腕', side: '右', key: 'rHand', label: '弯曲', min: -60, max: 60 },
  // 腿部—髋 · 左 / 右
  { group: '腿部—髋', side: '左', key: 'lLegFwd', label: '抬腿', min: -90, max: 50 },
  { group: '腿部—髋', side: '左', key: 'lLegAbd', label: '外展', min: -30, max: 45 },
  { group: '腿部—髋', side: '右', key: 'rLegFwd', label: '抬腿', min: -90, max: 50 },
  { group: '腿部—髋', side: '右', key: 'rLegAbd', label: '外展', min: -45, max: 30 },
  // 膝
  { group: '膝', side: '左', key: 'lKnee', label: '弯曲', min: 0, max: 130 },
  { group: '膝', side: '右', key: 'rKnee', label: '弯曲', min: 0, max: 130 },
  // 踝
  { group: '踝', side: '左', key: 'lFoot', label: '勾绷', min: -40, max: 40 },
  { group: '踝', side: '右', key: 'rFoot', label: '勾绷', min: -40, max: 40 },
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
