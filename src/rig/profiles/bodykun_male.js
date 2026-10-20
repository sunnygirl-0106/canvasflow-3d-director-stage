// 骨骼档案：BodyKun 男
// BlendSwap #23521 (vinchau, CC0)；局部轴向已用 align_roll 对齐 Xbot。
// joints：语义关节 key → { bone, axis, sign }。sign 缺省为 1；校准页发现方向反了就改 sign 或 axis。
// axis 是【身体坐标系】轴（X=角色左侧，Y=上，Z=前方；以文件 T-pose 为准），'twist' = 沿骨头自转。
// 加载时按骨头静止朝向换算成局部轴，所以与骨头 roll 无关；同一骨头上的多个轴按 JOINT_SCHEMA 顺序相乘。
// sign 让左右两侧都满足「正值 = 标签上的动作」（前举/外展/外旋/弯曲/抬腿 为正）。
// neutralOffset：文件静止位(T-pose) → 自然站立 的逐关节偏移（度），与 values 逐关节相加后再旋转。
export default {
  id: 'bodykun_male',
  label: 'BodyKun 男',
  file: './assets/figures/bodykun_male.glb',
  heightM: 1.75,
  restPose: 'tpose',
  joints: {
    bodyX: { bone: 'mixamorig:Hips', axis: 'x' },
    bodyY: { bone: 'mixamorig:Hips', axis: 'y' },
    bodyZ: { bone: 'mixamorig:Hips', axis: 'z' },
    spineX: { bone: 'mixamorig:Spine1', axis: 'x' },
    spineY: { bone: 'mixamorig:Spine1', axis: 'y' },
    spineZ: { bone: 'mixamorig:Spine1', axis: 'z' },
    headX: { bone: 'mixamorig:Head', axis: 'x' },
    headY: { bone: 'mixamorig:Head', axis: 'y' },
    headZ: { bone: 'mixamorig:Head', axis: 'z' },
    lArmFwd: { bone: 'mixamorig:LeftArm', axis: 'x', sign: -1 },
    lArmAbd: { bone: 'mixamorig:LeftArm', axis: 'z' },
    lArmTwist: { bone: 'mixamorig:LeftArm', axis: 'twist', sign: -1 },
    rArmFwd: { bone: 'mixamorig:RightArm', axis: 'x', sign: -1 },
    rArmAbd: { bone: 'mixamorig:RightArm', axis: 'z', sign: -1 },
    rArmTwist: { bone: 'mixamorig:RightArm', axis: 'twist' },
    lFore: { bone: 'mixamorig:LeftForeArm', axis: 'y', sign: -1 },
    rFore: { bone: 'mixamorig:RightForeArm', axis: 'y' },
    lHand: { bone: 'mixamorig:LeftHand', axis: 'z', sign: -1 },
    rHand: { bone: 'mixamorig:RightHand', axis: 'z' },
    lLegFwd: { bone: 'mixamorig:LeftUpLeg', axis: 'x', sign: -1 },
    lLegAbd: { bone: 'mixamorig:LeftUpLeg', axis: 'z' },
    rLegFwd: { bone: 'mixamorig:RightUpLeg', axis: 'x', sign: -1 },
    rLegAbd: { bone: 'mixamorig:RightUpLeg', axis: 'z', sign: -1 },
    lKnee: { bone: 'mixamorig:LeftLeg', axis: 'x' },
    rKnee: { bone: 'mixamorig:RightLeg', axis: 'x' },
    lFoot: { bone: 'mixamorig:LeftFoot', axis: 'x' },
    rFoot: { bone: 'mixamorig:RightFoot', axis: 'x' },
  },
  neutralOffset: { lArmAbd: -80, rArmAbd: -80, lFore: 8, rFore: 8 },
};
