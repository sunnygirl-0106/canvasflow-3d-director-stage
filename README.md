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
- **取景与截图** — 多比例取景框（21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 自由），所见即所得裁剪导出 PNG（不含辅助 gizmo，名牌画进画面），截图带历史管理。
- **全景背景** — 载入 2:1 等距柱状全景图作为环境，或自定义天空颜色。
- **场景编排** — 左侧清单支持搜索、显隐、改名、多选，以及打组 / 副本 / 批量删除等右键操作。
- **时间轴** — 底部面板按实体分组显示轨道 / 关键帧 / 路径与约束区间条，可拖播放头、拖键、改 ease、⌥ 复制、区间条拖动；右侧属性面板每个可动画属性旁一颗 ◇ 一键打键 / 删键，「自动打键」开启后在播放头处修改即记键；机位面板可设注视 / 跟随约束。
- **角色路径** — 底部工具坞「路径」或属性面板「新建路径 ▾」为选中角色 / 道具 / 组画移动路径：点击落点 / 手绘 / 直线 / 环绕 / 走到五种方式；视口里蓝线 + 球形顶点，可拖顶点、⇧ 拖整条平移、点线插入、`Del` 删顶点；起点自动取对象当前位置，创建后画面不跳；直接播放即沿线走 / 跑。
- **机位运镜** — 选中机位，属性面板「运镜」段选预设（推 / 拉 / 横移 / 升降 / 摇 / 半环绕 / 环绕）、主体（默认最近的角色）和参数，视口里虚线预览，点「应用」生成机位路径 + 注视约束；再点「追加」把下一个运镜接在后面（段列表可删最后一段）。机位也能用五种方式画路径（画在机位高度的水平面上）。时间轴「主机位」选好后，在机位视角下播放即透过主机位看成片。
- **导出视频** — 底部工具坞「场景 → 导出视频…」把主机位画面逐帧离线渲染成 H.264 MP4（720p / 1080p / 1440p 实验，宽高比跟随取景比例），角色名牌画进画面；第 i 帧 = `evaluate(t0 + i/fps)`，与电脑快慢无关，两次导出逐帧相同。**仅支持 Chrome / Edge**（WebCodecs），全程在浏览器内完成、不上传。
- **动画内核（供时间轴 / AI 调用）** — 角色 / 道具 / 组 / 机位的位置 · 旋转 · 缩放 · FOV 关键帧；沿 Catmull-Rom 路径移动（切线朝向、匀速 / 缓入缓出）；角色沿路径自动切程序化步行 / 跑步（脚踩点 + 腿部 IK，不悬空不打滑，停下恢复原姿势）；机位注视 / 刚性跟随约束。任意时刻状态 = `timeline.evaluate(t)`，播放与跳转结果逐数值一致；播放中导出 / 撤销记的是手动值。

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
node selftest.mjs tl                         # 时间轴面板验收（真实点击 / 拖拽）：打键 / 自动打键 / 拖键 / 区间条 / 约束段 / 播放 / 快捷键 / 性能 / 折叠 → test-output/tl/
node selftest.mjs path                       # 角色路径验收（真实点击 / 拖拽）：五种绘制 / 起点不跳 / 顶点编辑 / 冲突确认 / 可视化 / 播放 / 往返 → test-output/path/
node selftest.mjs export                     # 导出视频验收：精灵名牌 / 帧 ≡ 快照 / 逐帧确定性 / MP4（ffprobe 或盒子解析）/ 取消 / 不支持的浏览器 → test-output/export/
node selftest.mjs cam                        # 机位运镜验收（真实操作）：半环绕盯人 / 推拉 / 横移升降 / 摇 / 追加 + 删末段 / 机位路径 / 主机位播放 / 往返 → test-output/cam/
npm run test:unit                            # 路径生成器 + 运镜生成器单元测试（node:test，不起浏览器）
```

开发时校准页：`npm run dev` 后打开 `/calib.html?profile=bodykun_male`。

## 🎞️ 动画 API

界面见底部时间轴与右侧属性面板的 ◇；同样的操作也可在控制台里通过 `__app.timeline` / `__app.playback` 调用；所有增删改都会校验（规则与导入文档一致，不合法抛 `DocumentError`）并记一步撤销。值的口径与文档 `transform` 相同（角色 pos 相对站立基准，rot 为 XYZ 欧拉角度数）。

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

路径生成器 `src/anim/pathGen.js`（纯函数，输出文档口径的点，阶段 F 运镜 / 阶段 H AI 共用）：

```js
import { line, arc, toward, simplify, defaultDuration } from '/src/anim/pathGen.js';
const pts = toward([0,0,0], [3,0,4]);                          // 停在目标前 0.8 m（水平距离）；太近返回 null
const { points, closed } = arc({ center: [0,0,0], radius: 2, startDeg: 0, sweepDeg: 180, y: 0 }); // 角度从 +X 起、俯视逆时针为正
tl.addPath({ target: a.id, points, closed, duration: defaultDuration(points, { closed }) }); // 长度 ÷ 1.3 m/s，向上取 0.5 s
```

运镜生成器 `src/anim/cameraMoves.js`（纯函数，调 pathGen）与写入入口 `__app.cameraMoves`：

```js
import { cameraMove, appendMove } from '/src/anim/cameraMoves.js';
const m = cameraMove('half_orbit', { position: [0, 1.6, 5], aim: [0, 0.85, 0], params: { sweep: 180, dir: 'ccw' } });
// → { points, closed, duration: 5, rotKeys: null }；pan 返回 points = null、rotKeys = [起, 止]（欧拉度数）
const cm = __app.cameraMoves, cam = __app.cameras[0];
Object.assign(cm.formOf(cam), { name: 'push_in', subject: a.id }); cm.request(cam);   // = Inspector「应用 / 追加」
```

| 运镜 | 含义 | 几何（距离 / 连线取水平分量） | 参数（默认） | 默认时长 |
| --- | --- | --- | --- | --- |
| `push_in` | 推 | 沿机位→主体连线靠近 | `amount` 当前距离 × 0.4（离主体至少留 0.3 m） | 3 s |
| `pull_out` | 拉 | 沿连线远离 | `amount` 当前距离 × 0.6 | 3 s |
| `truck` | 横移 | 垂直于连线水平平移 | `amount` 2 m，`dir` left / right（以机位视角为准） | 3 s |
| `crane` | 升降 | 竖直平移 | `amount` 1 m，`dir` up / down | 3 s |
| `pan` | 摇 | 机位不动，从当前朝向摇到对准主体（rot 轨道两键） | — | 2 s |
| `half_orbit` | 半环绕 | 以主体为圆心、当前水平距离为半径、当前高度扫过 | `sweep` 180°，`dir` ccw / cw（俯视） | 5 s |
| `circle` | 环绕 | 同上整圈，闭合 | `sweep` 360°，`dir` | 8 s |

带路径的运镜：`speed = smooth`、`orient = keep`，并加 lookAt 约束指向主体（`subject`：实体 id 或 `[x,y,z]`），从该段开始一直注视到全程结束；`pan` 的注视从摇完那一刻开始。追加 = 新段从现有路径终点、结束时刻接上（同一主体的注视合并为一条，不同主体按段截断）；预设参数不进文档，文档只存生成的 points / keys / constraints。

词汇表（AI 用，定了不改）：运镜 `push_in / pull_out / truck / crane / pan / half_orbit / circle`，参数 `amount / dir / sweep / subject / duration`；路径绘制方式 `points / freehand / line / arc / toward`（前两者 AI 不用）；property `pos / rot / scale / fov`；ease `linear / smooth / step`；路径 speed `linear / smooth`、orient `tangent / keep`；约束 `lookAt / follow`。文档形状见 `src/doc/schema.js` 顶部注释。

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
| 底部工具坞「时间轴」/ 面板右端 ⌄ | 展开 / 折叠时间轴（记住选择；窗口高 < 900px 时默认折叠） |

**路径**（选中角色 / 道具 / 组 / 机位；底部工具坞「路径」或属性面板路径段「新建路径 ▾」。机位的路径画在机位高度的水平面上，默认保持手动朝向，「走到」叫「推到」、停在 1.5 m 外）

| 操作 | 效果 |
| --- | --- |
| 点击落点 | 逐次点击地面落点；`Enter` / 双击结束，`Backspace` 退一点 |
| 手绘 | 按住左键在地面上拖，松手结束（自动简化） |
| 直线 | 点一下终点 |
| 环绕 | 点一下中心（地面或对象），属性面板里改半径 / 起始角 / 扫过角度（≥ 360° 自动闭合） |
| 走到 | 点目标对象，停在 0.8 m 外；`⇧` + 点地面取任意点 |
| 绘制中 `⌥` + 拖动 / 右键拖 / 滚轮 | 环绕 / 平移 / 缩放视角（左键归绘制）；`Esc` 取消 |
| 拖顶点 / `⇧` 拖顶点 | 移动该顶点 / 整条路径平移（松手才写入，一次撤销；拖动中 `Esc` 回原位） |
| 点路径线 | 选中实体的路径：在该处插入顶点；其它实体的路径：选中该实体 |
| 点顶点 + `Del` | 删除顶点（至少保留 2 个）；优先级：选中关键帧 > 选中顶点 > 选中对象 |

已有位置关键帧的对象新建路径会先确认删除关键帧；已有路径会确认替换（保留开始时间 / 速度 / 朝向）。机位视角下不显示路径。

**运镜 / 主机位**（选中机位）

| 操作 | 效果 |
| --- | --- |
| 属性面板「运镜」段改预设 / 主体 / 参数 | 视口里虚线预览将要生成的路径（摇镜头没有路径） |
| 「应用」/「追加」 | 写入路径 + 注视约束（摇 = 旋转关键帧），一次撤销；已有路径时接在后面 |
| 段列表 × | 删除最后一段（中间段需「清除运镜」后重做） |
| 「清除运镜」 | 删除该机位的路径、全部约束与旋转轨道 |
| 播放条「主机位」+ 机位视角下播放 / 拖播放头 | 视口透过主机位（顶部显示「▶ 主机位 · 名字」，gizmo 隐藏）；停止后回到当前机位；未设主机位时用当前机位并提示 |

**导出视频**（底部工具坞「场景 → 导出视频…」；需要 Chrome / Edge，其它浏览器菜单项置灰）

| 设置 | 说明 |
| --- | --- |
| 机位 | 主机位（播放条「主机位」）；未设用当前机位；一个机位都没有时无法导出 |
| 分辨率 | 短边 720 / 1080 / 1440（实验）；宽高比 = 取景比例（Auto 按 16:9），如 9:16 + 1080p = 1080×1920 |
| 帧率 / 范围 | 默认跟时间轴 fps、全程；可自定义起止秒。帧数 = 时长 × fps（不含终点那一刻，3 s × 30 fps = 90 帧） |
| 名牌 | 「画进视频」默认开（AI 生成靠它认人；场景面板关了「角色标签」则不画）；「视口预览」= 视口临时改用导出样式的名牌 |
| 导出中 | 进度条（帧 i/N、已用 / 预计剩余），界面锁住；「取消」或 `Esc` 取消，不出文件；完成后自动下载 `场景名_宽x高_fps.mp4` |

导出不改场景、不进撤销；结束后播放头回到导出前的位置。编码：720p H.264 Baseline 6 Mbps，1080p Main 12 Mbps，1440p Main 20 Mbps，关键帧每 2 秒。

**时间轴**（输入框聚焦时不触发）

| 操作 | 效果 |
| --- | --- |
| `Space` | 播放 / 暂停 |
| `←` / `→` | 前 / 后一帧 |
| `⇧←` / `⇧→` | 前 / 后一秒 |
| `Home` / `End` | 跳到开头 / 结尾 |
| `Esc` | 停止：回到 0 秒，场景恢复手动值 |
| 点击 / 拖动标尺或播放头 | 跳转（吸附开启时按帧取整） |
| `⌘` / `Ctrl` + 滚轮 | 缩放时间轴（以光标处为中心） |
| 属性面板标题旁 ◇ | 当前时刻打键 / 删键（空心灰 = 无轨道，空心亮 = 有轨道无键，实心 = 有键）；时间轴未激活时在 0 秒打键并进入时间轴 |
| 单击关键帧 / `⇧` 单击 | 选中 / 多选 |
| 拖动关键帧 | 改时刻（按拖的那颗吸附，其余保持间距；落到已有键上即覆盖）；`⌥` 拖 = 复制 |
| `Del` / `Backspace` | 删除选中的关键帧（没有选中键时删除选中对象） |
| 双击关键帧 | 选缓动：linear / smooth / step |
| 拖路径条中间 / 右端 | 改开始时间 / 时长；双击打开属性面板的路径段 |
| 拖约束条两端 | 设生效区间（属性面板里清空 = 全程） |
| 右键轨道行 | 删除轨道 / 清空键 |
| 播放条 ● 自动打键 | 开：时间轴激活时修改没有轨道的属性也新建轨道并打键；关：只给已有轨道写键，其余算改手动值 |

## 🗂️ 项目结构

```
src/
├─ main.js              入口：实例化并串联各模块（UI 订阅 app 事件）
├─ config.js            体型 / 道具 / 取景比例 / 全景规则（单一事实来源）
├─ app/
│  ├─ App.js            应用状态：实体清单 / 选择 / 视角切换 / 场景参数；变化以事件广播
│  ├─ History.js        撤销 / 重做（场景文档快照栈）
│  ├─ SceneFile.js      导出 / 导入 .json + localStorage 自动保存与恢复
│  ├─ PathTool.js       路径绘制：五种方式的状态机 / 冲突确认 / 起点规则 / 绘制态改键
│  ├─ PathEditor.js     顶点编辑：拖动 / ⇧平移 / 插入 / 删除（松手一次写入）
│  ├─ CameraMoveTool.js 机位运镜：表单 → cameraMoves → path + lookAt（+ rot 键），追加 / 删末段 / 清除
│  ├─ ShotManager.js    截图（Blob + ObjectURL）与发送
│  ├─ Panorama.js       全景背景载入 / 校验（资源 assetId + url|dataURL）
│  ├─ Labels.js         DOM 名牌层（平时视口）
│  ├─ LabelSprites.js   3D 精灵名牌（截图 / 机位预览 / 导出 / 视口预览；与 DOM 同锚点同样式）
│  └─ VideoExporter.js  导出视频：离屏 RenderTarget 逐帧渲染 → WebCodecs H.264 → mp4-muxer
├─ core/
│  ├─ Stage.js          场景 / 渲染器 / 光照 / 地面 / 按需渲染循环 / 离屏快照
│  ├─ CameraRig.js      OrbitControls + 自动取景 + 取景框 + 重置视角
│  ├─ Selection.js      Raycaster 拾取 + 地面选中环
│  ├─ PathOverlay.js    视口路径可视化：等宽曲线 / 顶点球 / 起止标记 / 方向箭头 / 播放亮点 / 命中测试
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
│  ├─ pathGen.js        路径生成器（纯函数）：line / arc / toward / simplify / defaultDuration
│  ├─ cameraMoves.js    运镜生成器（纯函数）：7 种预设 / appendMove / lookAtWindows
│  └─ ease.js           linear / smooth / step
├─ rig/                 姿势与模型解耦层
│  ├─ jointSchema.js    语义关节表（与模型无关；min/max 相对站立）
│  ├─ profiles/         骨骼档案：每个模型一份（骨头 / 轴向 / 正负 / 站立偏移）
│  ├─ RigProfile.js     resolveRig：档案 → 模型骨头，返回缺失关节
│  └─ Pose.js           姿势数据（values，0 = 站立）
├─ calib.js             骨骼档案校准页（calib.html，开发用）
├─ entities/            Entity 基类 + Character / Prop / Camera / Crowd / 姿势预设
├─ ui/                  Dock / Outliner / Inspector / ScenePanel / 姿势滑条 / 弹层 / 图标
│  └─ timeline/         时间轴面板：TimelinePanel（布局 / 播放头 / 快捷键）· Transport 播放条 · Ruler 标尺
│                       · TrackRows 轨道行 · keyDrag 拖键 / 区间条 / 弹出菜单 · animState 菱形状态
├─ util/                事件总线 / 度量 / 骨骼 / 素材库 / DOM helper
└─ styles/             style.css · timeline.css
public/assets/          Xbot.glb（中性素体，meshopt 压缩）
public/assets/figures/  BodyKun / BodyChan 关节人偶 GLB + 交接文档
tests/                  node 单元测试（pathGen / cameraMoves）
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
- [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) 5.2.2（MIT）— 导出视频的 MP4 封装（编码用浏览器自带 WebCodecs）
- 原生 ES Module + Vanilla JS，无前端框架依赖

## 📦 部署

推送到 `main` 分支后由 GitHub Actions 自动构建并发布到 GitHub Pages（见 `.github/workflows/deploy.yml`）。
