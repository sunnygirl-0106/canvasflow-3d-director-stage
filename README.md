<div align="center">

# 🎬 3D 导演台

**浏览器里的轻量 3D 分镜 / 导演台** — 摆角色、布机位、透过镜头取景截图。

基于 **Vite + three.js**（原生 ES Module，无框架）构建。

[![Deploy](https://github.com/sunnygirl-0106/canvasflow-3d-director-stage/actions/workflows/deploy.yml/badge.svg)](https://github.com/sunnygirl-0106/canvasflow-3d-director-stage/actions/workflows/deploy.yml)
[![three.js](https://img.shields.io/badge/three.js-r160-000000?logo=three.js)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)

**[▶ 在线体验](https://sunnygirl-0106.github.io/canvasflow-3d-director-stage/)**

</div>

---

## ✨ 功能

- **多角色素体** — 男 / 女关节人偶（BodyKun / BodyChan，CC0）及 高大 / 矮小 / 宽厚 / 纤细 派生体型，另有 Xbot 备选；自动归一化身高并落地，默认自然站立；同一模型只下载一次，角色间共享几何体。
- **全身姿势** — 右侧「姿势」面板按关节分组的 FK 滑条实时驱动骨骼（0° = 自然站立）；内置行走、挥手、抱臂等姿势预设一键套用。姿势只认语义关节，换模型只需一份骨骼档案。
- **群众阵列** — 行×列网格批量生成群众，可整组平移/旋转，也可随时解组为独立角色。
- **几何道具** — 方块 / 圆柱 / 球体 / 人体素模，颜色与尺寸可调。
- **机位系统** — 相机作为一等实体，支持景别预设与对准主体；**机位视角（POV）** 下透过镜头实时取景，并可直接选中、平移、旋转画面里的角色与道具。
- **取景与截图** — 多比例取景框（21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 自由），所见即所得裁剪导出 PNG（不含辅助 gizmo），截图带历史管理。
- **全景背景** — 载入 2:1 等距柱状全景图作为环境，或自定义天空颜色。
- **场景编排** — 左侧清单支持搜索、显隐、改名、多选，以及打组 / 副本 / 批量删除等右键操作。
- **动画内核（无界面，供时间轴 / AI 调用）** — 角色 / 道具 / 组 / 机位的位置 · 旋转 · 缩放 · FOV 关键帧；沿 Catmull-Rom 路径移动（切线朝向、匀速 / 缓入缓出）；角色沿路径自动切程序化步行 / 跑步（脚踩点 + 腿部 IK，不悬空不打滑，停下恢复原姿势）；机位注视 / 刚性跟随约束。任意时刻状态 = `timeline.evaluate(t)`，播放与跳转结果逐数值一致；播放中导出 / 撤销记的是手动值。

## 🚀 快速开始

```bash
npm install
npm run dev          # 打开终端给出的 http://localhost:5173

npm run build        # 生产构建 → dist/
npm run preview      # 本地预览构建产物

npm run lint         # ESLint
npm run test:e2e     # 端到端自测（headless Chrome，自动起 dev server）
                     # 非 macOS 需设 CHROME_PATH 指向 Chrome 可执行文件

# selftest 子命令（截图输出到 test-output/，不入库）
node selftest.mjs poses <outDir> [bodyKey]   # 单角色逐个套姿势预设截图（默认 xbot）
node selftest.mjs posediff <dirA> <dirB>     # 两组姿势截图逐像素对比（pixelmatch）
node selftest.mjs calib [profileId ...]      # 校准页整页截图 → test-output/calib_<id>.png
node selftest.mjs collide [preset,...]       # 姿势预设 + 步态（gait：走 / 跑各 8 相位）穿模检测（改预设 / 步态后必跑）
node selftest.mjs doc                        # 场景文档验收：往返一致 / 坏文档拒绝 / 撤销重做 → test-output/doc/
node selftest.mjs anim                       # 动画内核验收：纯函数 / 跳转 / 导出不污染 / 往返 / 撤销 / 步态 / 约束 → test-output/anim/
```

开发时校准页：`npm run dev` 后打开 `/calib.html?profile=bodykun_male`。

## 🎞️ 动画 API（阶段 C，暂无界面）

控制台里通过 `__app.timeline` / `__app.playback` 调用；所有增删改都会校验（规则与导入文档一致，不合法抛 `DocumentError`）并记一步撤销。值的口径与文档 `transform` 相同（角色 pos 相对站立基准，rot 为 XYZ 欧拉角度数）。

```js
const tl = __app.timeline, pb = __app.playback;
const [a] = __app.entities;                                   // 某个角色
tl.addPath({ target: a.id, points: [[0,0,0],[2,0,3],[4,0,3]], duration: 4, speed: 'smooth', orient: 'tangent' });
const cam = __app.cameras[0];
tl.addConstraint({ type: 'lookAt', target: cam.id, subject: a.id });
const fov = tl.addTrack({ target: cam.id, property: 'fov' });
tl.setKey(fov.id, 0, 40); tl.setKey(fov.id, 4, 25, 'smooth');
pb.play();            // pause() / seek(t) / stop()（回到手动值）/ loop = true
```

词汇表（AI 用，定了不改）：property `pos / rot / scale / fov`；ease `linear / smooth / step`；路径 speed `linear / smooth`、orient `tangent / keep`；约束 `lookAt / follow`。文档形状见 `src/doc/schema.js` 顶部注释。

## ⌨️ 操作

| 操作 | 效果 |
| --- | --- |
| 空白处拖动 | 环绕视角 |
| 滚轮 | 缩放 |
| 拖动三色 gizmo | 按当前模式变换选中对象 |
| `V` / `R` / `S` | 切换 移动 / 旋转 / 缩放 |
| `Del` / `Backspace` | 删除选中对象 |
| `⌘Z` / `Ctrl+Z` | 撤销 |
| `⇧⌘Z` / `Ctrl+Shift+Z` / `Ctrl+Y` | 重做 |
| 底部工具坞「场景」 | 撤销 / 重做 / 导出场景（.json）/ 导入场景 |
| 底部工具坞 `＋` | 添加角色 / 几何道具 / 本地上传 |

## 🗂️ 项目结构

```
src/
├─ main.js              入口：实例化并串联各模块（UI 订阅 app 事件）
├─ config.js            体型 / 道具 / 取景比例 / 全景规则（单一事实来源）
├─ app/
│  ├─ App.js            应用状态：实体清单 / 选择 / 视角切换 / 场景参数；变化以事件广播
│  ├─ History.js        撤销 / 重做（场景文档快照栈）
│  ├─ SceneFile.js      导出 / 导入 .json + localStorage 自动保存与恢复
│  ├─ ShotManager.js    截图（Blob + ObjectURL）与发送
│  ├─ Panorama.js       全景背景载入 / 校验（资源 assetId + url|dataURL）
│  └─ Labels.js         3D 名牌层
├─ core/
│  ├─ Stage.js          场景 / 渲染器 / 光照 / 地面 / 按需渲染循环 / 离屏快照
│  ├─ CameraRig.js      OrbitControls + 自动取景 + 取景框 + 重置视角
│  ├─ Selection.js      Raycaster 拾取 + 地面选中环
│  ├─ TransformGizmo.js TransformControls 封装（模式切换 / 与环绕互斥）
│  ├─ NavGizmo.js       右上角坐标指示器
│  └─ cameraPresets.js  机位景别预设
├─ doc/                 场景文档：导演台全部场景状态 ↔ 一份可校验的 JSON
│  ├─ schema.js         版本号 / 文档形状说明 / 默认值 / validate（错误定位到字段路径）
│  ├─ serialize.js      toDocument / loadDocument（先建好再一次性替换，失败不留半个场景）
│  └─ migrate.js        按版本逐级升级
├─ anim/                动画内核（无界面）：文档里的 timeline / paths / constraints → evaluate(t)
│  ├─ Timeline.js       数据持有 + idle/active + base 快照 + evaluate（关键帧 → 路径/步态 → 约束）+ 编辑 API
│  ├─ Playback.js       play / pause / stop / seek / loop（挂在 Stage 按需渲染循环上）
│  ├─ Channel.js        关键帧插值（位置/缩放/FOV 线性，旋转四元数 slerp）· Track.js 轨道
│  ├─ Path.js           Catmull-Rom + 弧长表 + 速度曲线 · PathTrack.js 沿路径移动 / 切线朝向
│  ├─ Locomotion.js     程序化步态（相位按路程；脚踩点 + 两段腿 IK；走跑混合）
│  ├─ Constraint.js     lookAt / follow
│  └─ ease.js           linear / smooth / step
├─ rig/                 姿势与模型解耦层
│  ├─ jointSchema.js    语义关节表（与模型无关；min/max 相对站立）
│  ├─ profiles/         骨骼档案：每个模型一份（骨头 / 轴向 / 正负 / 站立偏移）
│  ├─ RigProfile.js     resolveRig：档案 → 模型骨头，返回缺失关节
│  └─ Pose.js           姿势数据（values，0 = 站立）
├─ calib.js             骨骼档案校准页（calib.html，开发用）
├─ entities/            Entity 基类 + Character / Prop / Camera / Crowd / 姿势预设
├─ ui/                  Dock / Outliner / Inspector / ScenePanel / 姿势滑条 / 弹层 / 图标
├─ util/                事件总线 / 度量 / 骨骼 / 素材库 / DOM helper
└─ styles/style.css
public/assets/          Xbot.glb（中性素体，meshopt 压缩）
public/assets/figures/  BodyKun / BodyChan 关节人偶 GLB + 交接文档
docs/                   交接文档 / 技术规划 / 任务说明（已完成的在 docs/done/）
```

## 🧍 人偶资产规范

姿势系统通过「骨骼档案」驱动模型，新模型满足以下规范即可接入：

| 项 | 要求 |
| --- | --- |
| 骨骼命名 | Mixamo 标准命名（`mixamorig:Hips`、`mixamorig:LeftArm` …）；GLTFLoader 清洗冒号无妨，查找时会归一化 |
| 静止位 | 标准 **T-Pose**：手臂水平 ±X，腿垂直，角色面朝 +Z |
| 单位 / 朝向 | 米，Y 向上，脚底在 y=0 |
| 变换 | 导出前 **Apply Transforms**（根节点无残余旋转 / 缩放） |
| 材质 | 无材质、无贴图（应用统一上素体色） |
| 动画 | 无动画轨道 |
| 格式 | **GLB**（单文件；可选 meshopt 压缩） |
| 局部轴向 | 尽量与 Xbot 同名骨一致（Blender 可用 `align_roll` 对齐），这样档案可直接复用 |

## ➕ 新增一个人偶

1. **放模型**：GLB 放到 `public/assets/figures/<id>.glb`。
2. **复制档案**：`src/rig/profiles/bodykun_male.js` → `src/rig/profiles/<id>.js`，改 `id` / `label` / `file` / `heightM`；
   在 `src/rig/profiles/index.js` 登记。
   - `joints`：语义关节 → `{ bone, axis, sign }`；骨名不同就改 `bone`。`axis` 是**身体坐标系**的轴
     （X=角色左侧、Y=上、Z=前方，以 T-Pose 为准；`twist` = 沿骨头自转），加载时按骨头静止朝向换算成局部轴，
     所以与骨头 roll / 局部朝向无关，标准 T-Pose 的 Mixamo 骨骼通常可直接复用现有档案。
   - `sign` 保证「正值 = 标签动作」（前举 / 外展 / 外旋 / 弯曲 / 抬腿 为正，左右一致）。
   - `neutralOffset`：T-Pose → 自然站立 的逐关节偏移（度），通常沿用 `{ lArmAbd: -80, rArmAbd: -80, lFore: 8, rFore: 8 }`。
3. **跑校准页**：`npm run dev`，打开 `/calib.html?profile=<id>`（或 `node selftest.mjs calib <id>` 出图）。
   每格是该关节 +30°，灰色残影是站立参考；对照 `?profile=xbot` 的同一格看方向。
4. **修方向**：某关节转反了 → 该关节改 `sign`；转错了轴（如前臂不弯、抬腿变侧摆）→ 改 `axis`（多半是 T-Pose 不标准）。
   格子灰掉并标「缺失」= 骨头没找到，检查 `bone` 名。重复 3–4 直到每格与 Xbot 同向。
5. **注册体型**：在 `src/config.js` 的 `BODY_TYPES` 加一项 `{ profile: PROFILES.<id>, label, height, girth }`，
   底部「＋」菜单即出现该体型。加载时若仍有缺失关节，会 toast 提示并禁用对应滑条。

## 🛠️ 技术栈

- [three.js](https://threejs.org/) r160 — 渲染、`GLTFLoader`、`OrbitControls`、`TransformControls`
- [Vite](https://vitejs.dev/) 5 — 开发服务与构建
- 原生 ES Module + Vanilla JS，无前端框架依赖

## 📦 部署

推送到 `main` 分支后由 GitHub Actions 自动构建并发布到 GitHub Pages（见 `.github/workflows/deploy.yml`）。
