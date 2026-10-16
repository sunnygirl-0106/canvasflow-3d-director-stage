// 骨骼档案：BodyKun 男
// BlendSwap #23521 (vinchau, CC0)；局部轴向已用 align_roll 对齐 Xbot，见 public/assets/figures/README-handoff.md。
// joints：语义关节 key → { bone, axis, sign }。sign 缺省为 1；校准页发现方向反了就改 sign 或 axis。
// 同一骨头上的多个轴按 JOINT_SCHEMA 顺序依次相乘。
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
    lArmFwd: { bone: 'mixamorig:LeftArm', axis: 'x' },
    lArmAbd: { bone: 'mixamorig:LeftArm', axis: 'z' },
    lArmTwist: { bone: 'mixamorig:LeftArm', axis: 'y' },
    rArmFwd: { bone: 'mixamorig:RightArm', axis: 'x' },
    rArmAbd: { bone: 'mixamorig:RightArm', axis: 'z' },
    rArmTwist: { bone: 'mixamorig:RightArm', axis: 'y' },
    lFore: { bone: 'mixamorig:LeftForeArm', axis: 'y' },
    rFore: { bone: 'mixamorig:RightForeArm', axis: 'y' },
    lHand: { bone: 'mixamorig:LeftHand', axis: 'x' },
    rHand: { bone: 'mixamorig:RightHand', axis: 'x' },
    lLegFwd: { bone: 'mixamorig:LeftUpLeg', axis: 'x' },
    lLegAbd: { bone: 'mixamorig:LeftUpLeg', axis: 'z' },
    rLegFwd: { bone: 'mixamorig:RightUpLeg', axis: 'x' },
    rLegAbd: { bone: 'mixamorig:RightUpLeg', axis: 'z' },
    lKnee: { bone: 'mixamorig:LeftLeg', axis: 'x' },
    rKnee: { bone: 'mixamorig:RightLeg', axis: 'x' },
    lFoot: { bone: 'mixamorig:LeftFoot', axis: 'x' },
    rFoot: { bone: 'mixamorig:RightFoot', axis: 'x' },
  },
  neutralOffset: { lArmAbd: -80, rArmAbd: 80, lFore: -8, rFore: 8 },
};
