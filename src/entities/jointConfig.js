// 全身多轴关节表（§6）—— 与《人偶姿势体验_技术改造文档.md》同源。
// 字段：{group, side, key, label, bone, axis, min, max}
// 注意（§5.4）：axis 与 min/max 是起始值；各骨头本地轴方向不一致，必要时在浏览器里
// 实测校准（翻转 min/max 正负或换 axis）。左右成对动作通常镜像（正负相反）。
export const JOINTS = [
  // 身体（根 Hips：整体朝向）
  { group: '身体', side: '', key: 'bodyX', label: '前倾', bone: 'mixamorig:Hips', axis: 'x', min: -30, max: 30 },
  { group: '身体', side: '', key: 'bodyY', label: '转身', bone: 'mixamorig:Hips', axis: 'y', min: -90, max: 90 },
  { group: '身体', side: '', key: 'bodyZ', label: '侧倾', bone: 'mixamorig:Hips', axis: 'z', min: -30, max: 30 },
  // 躯干（Spine1）
  { group: '躯干', side: '', key: 'spineX', label: '前倾(弯腰)', bone: 'mixamorig:Spine1', axis: 'x', min: -35, max: 35 },
  { group: '躯干', side: '', key: 'spineY', label: '扭转', bone: 'mixamorig:Spine1', axis: 'y', min: -40, max: 40 },
  { group: '躯干', side: '', key: 'spineZ', label: '侧倾', bone: 'mixamorig:Spine1', axis: 'z', min: -30, max: 30 },
  // 头部（Head）
  { group: '头部', side: '', key: 'headX', label: '点头', bone: 'mixamorig:Head', axis: 'x', min: -45, max: 45 },
  { group: '头部', side: '', key: 'headY', label: '转头', bone: 'mixamorig:Head', axis: 'y', min: -60, max: 60 },
  { group: '头部', side: '', key: 'headZ', label: '歪头', bone: 'mixamorig:Head', axis: 'z', min: -35, max: 35 },
  // 手臂—肩 · 左 / 右（Arm）
  { group: '手臂—肩', side: '左', key: 'lArmFwd', label: '前举', bone: 'mixamorig:LeftArm', axis: 'x', min: -90, max: 180 },
  { group: '手臂—肩', side: '左', key: 'lArmAbd', label: '外展', bone: 'mixamorig:LeftArm', axis: 'z', min: -95, max: 35 },
  { group: '手臂—肩', side: '左', key: 'lArmTwist', label: '扭转', bone: 'mixamorig:LeftArm', axis: 'y', min: -90, max: 90 },
  { group: '手臂—肩', side: '右', key: 'rArmFwd', label: '前举', bone: 'mixamorig:RightArm', axis: 'x', min: -90, max: 180 },
  { group: '手臂—肩', side: '右', key: 'rArmAbd', label: '外展', bone: 'mixamorig:RightArm', axis: 'z', min: -35, max: 95 },
  { group: '手臂—肩', side: '右', key: 'rArmTwist', label: '扭转', bone: 'mixamorig:RightArm', axis: 'y', min: -90, max: 90 },
  // 肘部（ForeArm）
  { group: '肘部', side: '左', key: 'lFore', label: '弯曲', bone: 'mixamorig:LeftForeArm', axis: 'y', min: -110, max: 10 },
  { group: '肘部', side: '右', key: 'rFore', label: '弯曲', bone: 'mixamorig:RightForeArm', axis: 'y', min: -10, max: 110 },
  // 手腕（Hand，可选）
  { group: '手腕', side: '左', key: 'lHand', label: '弯曲', bone: 'mixamorig:LeftHand', axis: 'x', min: -60, max: 60 },
  { group: '手腕', side: '右', key: 'rHand', label: '弯曲', bone: 'mixamorig:RightHand', axis: 'x', min: -60, max: 60 },
  // 腿部—髋 · 左 / 右（UpLeg）
  { group: '腿部—髋', side: '左', key: 'lLegFwd', label: '抬腿', bone: 'mixamorig:LeftUpLeg', axis: 'x', min: -90, max: 50 },
  { group: '腿部—髋', side: '左', key: 'lLegAbd', label: '外展', bone: 'mixamorig:LeftUpLeg', axis: 'z', min: -30, max: 45 },
  { group: '腿部—髋', side: '右', key: 'rLegFwd', label: '抬腿', bone: 'mixamorig:RightUpLeg', axis: 'x', min: -90, max: 50 },
  { group: '腿部—髋', side: '右', key: 'rLegAbd', label: '外展', bone: 'mixamorig:RightUpLeg', axis: 'z', min: -45, max: 30 },
  // 膝（Leg）
  { group: '膝', side: '左', key: 'lKnee', label: '弯曲', bone: 'mixamorig:LeftLeg', axis: 'x', min: 0, max: 130 },
  { group: '膝', side: '右', key: 'rKnee', label: '弯曲', bone: 'mixamorig:RightLeg', axis: 'x', min: 0, max: 130 },
  // 踝（Foot）
  { group: '踝', side: '左', key: 'lFoot', label: '勾绷', bone: 'mixamorig:LeftFoot', axis: 'x', min: -40, max: 40 },
  { group: '踝', side: '右', key: 'rFoot', label: '勾绷', bone: 'mixamorig:RightFoot', axis: 'x', min: -40, max: 40 },
];

/** 按出现顺序分组：[{group, sides:[{side, joints:[...]}]}] —— 供 PoseSliders 渲染。 */
export function groupJoints(joints = JOINTS) {
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
