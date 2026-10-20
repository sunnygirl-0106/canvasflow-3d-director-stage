# 人偶资产交接：BodyKun / BodyChan

## 文件
| 文件 | 内容 | 身高 | 顶点 | 骨骼 | 大小 |
|---|---|---|---|---|---|
| `bodykun_male.glb` | BodyKun 男款关节人偶 | 1.75 m | 17,230 | 65（Mixamo 命名） | 0.96 MB |
| `bodychan_female.glb` | BodyChan 女款关节人偶 | 1.62 m | 15,466 | 65（Mixamo 命名） | 0.86 MB |
| `rig-profile.json` | 骨骼档案草稿（映射、轴向状态、已知问题） | | | | |
| `verify_grid.png` | 与 Xbot 并排套 8 个预设的验证图 | | | | |

来源：BlendSwap #23521，作者 vinchau，**CC0**（无需署名，可商用）。

## 符合的资产规范
- 骨骼：Mixamo 标准 65 骨，名字形如 `mixamorig:Hips`（与 Xbot 完全一致，`boneUtil.norm()` 可直接命中）
- 静止位：Mixamo 标准 **T-Pose**（手臂水平 ±X，腿垂直，脚朝 -Z）
- 单位米、Y 向上、所有变换已应用、脚底在 y=0
- 无材质、无贴图、无动画；单一 SkinnedMesh + 一个 skin
- 每顶点最多 4 个骨骼权重（glTF 限制，导出时已归一化）

## 制作流程（可复现，脚本在我这边）
1. 打开 .blend，取 Rigify 的 `DEF-*` 变形骨头尾坐标，按映射表新建 65 根 Mixamo 骨骼
   （Rigify 双段四肢合并为一根；`spine/.001/.002/.003` → Hips/Spine/Spine1/Spine2；`.004+.005` → Neck；`.006` → Head；`palm.*` 权重并入 Hand）
2. 合并全部体块网格为一个对象，顶点组按同一张映射表改名合并，归一化
3. 摆成 T-Pose（大臂/小臂/手对齐 ±X，大腿/小腿对齐 -Z），应用为静止位
4. 导入 Xbot.glb，对每根同名骨用 `align_roll` 把局部 Z 轴对齐到 Xbot 的 Z 轴 → 局部轴向与 Xbot 一致
5. 缩放到目标身高、落地、Apply Transforms，导出 GLB

## 验证结果
用 demo 现有 `jointConfig.js` + `posePresets.js` + `boneUtil.js`（未改）驱动：
- 28 个关节在两个模型上全部找到（missing = []）
- T型/站立/行走/跑步/招手/鞠躬/叉腰/思考 八个预设，三个模型动作方向一致（见 `verify_grid.png`）

## 已知差异 / 注意
- 关节人偶是分块网格，髋、肩大角度旋转时体块间会露缝——这是手办本身的特性，原模型即如此
- `jointConfig.js` 里的轴向 **不需要** 为这两个模型单独改；若校准页发现个别关节偏差，写进 `rig-profile.json` 的 `axisCalibration.overrides` 即可
- 手指 15×2 根骨有权重但 demo 暂无滑条
- `Spine2` 权重极少（源文件如此），弯腰主要由 Spine1 完成，与现有 `spineX` 滑条绑定的 Spine1 一致

## 接入方式（最小改动）
`App.js` 体型注册表里把 `url` 指向 `./assets/figures/bodykun_male.glb` / `bodychan_female.glb`，`height` 填 1.75 / 1.62。其余代码不动。

## 后续修改：女款中性化（2026-10-20）
`bodychan_female.glb` 已参照竞品女模特比例调整：胸 / 臀凸起按比例缩小到 60% / 50%（保持圆润），腰略加宽 8%，胯和大腿根外侧收窄，上胸略加宽，肩每侧外移 2.5 cm；宽度变化都用宽高斯带过渡，无台阶。
由 `scripts/figure-neutral.mjs` 从原始文件生成（用法见脚本头注释，原始文件在 git 历史 1bb3f44）；
只改了 POSITION / NORMAL、左右 `LeftArm`/`RightArm` 节点平移和手臂链的 inverseBindMatrices，骨骼轴向 / 权重 / 索引不变。
