# 任务说明 · 阶段 C · 动画内核（无 UI）

> 读者：Claude Code 执行者。先读同目录《交接文档_导演台重构.md》第 2、4.2、4.3 节，再读本文。
> 分支：先把 `feat/scene-document` 合入主线（阶段 B 已验收通过），再从主线开 `feat/animation-core`。
> 本阶段**不做任何界面**。所有能力通过 `app.timeline` 的 API 和场景文档暴露，供阶段 D（时间轴面板）、H（AI 生成）调用。

## 1. 背景

阶段 B 之后，场景文档里 `paths / constraints / timeline.tracks` 三个字段还是空壳。阶段 C 把它们填实，并实现 `evaluate(t)`：给定任意时刻 t，由文档算出整个场景的状态。这是时间轴、路径、运镜、导出 MP4、AI 生成动画的共同地基。

两条铁律在本阶段的含义：
- **状态 = f(t)**：`evaluate(t)` 必须是纯函数——同一份文档、同一个 t，无论是播放到这里还是直接跳到这里，结果逐数值相同。内部不许有"上一帧"状态。
- **场景即数据**：轨道、关键帧、路径、约束全部是文档字段；对它们的每一次增删改都走 History，可撤销、可导出。

## 2. 要解决的问题

1. 时间轴驱动的属性与手动编辑的属性如何共存（"没打关键帧的属性保持手动值"；播放中导出不能把动画瞬时值当成手动值存进文档）。
2. 关键帧插值：位置/缩放/FOV 线性，旋转四元数 slerp，文档里旋转仍是欧拉角度数。
3. 路径是源头而不是关键帧：Catmull-Rom 曲线 + 时长 + 速度曲线，按弧长参数化，角色沿路径走且朝向切线。
4. 角色沿路径移动时自动切程序化步行/跑步，停下恢复原姿势；相位按路程不按时间；不能上下跳。
5. 约束（注视 / 跟随）在最后生效。
6. 播放器：播放/暂停/跳转/循环，和 Stage 的按需渲染配合。

## 3. 目标架构

### 3.1 文档形状（追加到 schema.js 顶部注释，版本号保持 `director-stage/0.1`——三个数组原本就是预留，旧文档 `[]` 仍合法）

```
timeline: {
  duration: 10,            // 秒，> 0
  fps: 30,                 // 只影响吸附与导出
  mainCameraId: null,      // 阶段 F 使用，本阶段只存
  tracks: [ Track ],
}
Track = {
  id,                      // 8 位 base36，与实体 id 同一命名空间内唯一
  target: entityId,        // character / prop / group / camera
  property: 'pos' | 'rot' | 'scale' | 'fov',   // fov 只允许 camera
  keys: [ { t, value, ease } ],                // t 秒，严格递增；value: vec3（rot 为欧拉角度数 XYZ）或 number（fov）
}                                              // ease ∈ 'linear' | 'smooth' | 'step'，作用于"从该键出发"的那一段；最后一键的 ease 忽略
paths: [ {
  id, target: entityId,    // character / prop / camera
  points: [[x,y,z], ...],  // ≥ 2 个，世界坐标；角色路径 y 即地面高度
  closed: false,
  start: 0, duration: 4,   // 秒；start ≥ 0，duration > 0
  speed: 'linear' | 'smooth',      // 弧长随时间的曲线：匀速 / 缓入缓出
  orient: 'tangent' | 'keep',      // 朝向跟随切线（只改 yaw）/ 保持手动朝向
} ]
constraints: [ {
  id, type: 'lookAt' | 'follow',
  target: cameraId,                 // 被约束的机位（本阶段只约束机位）
  subject: entityId | [x,y,z],      // 看向 / 跟随谁
  offset: [x,y,z],                  // follow 用：在 subject 的 yaw 坐标系下的偏移；lookAt 忽略
  start: null, end: null,           // 生效区间（秒），null = 全程
} ]
```

校验器新增规则（错误要定位到字段，如 `timeline.tracks[1].keys[3].t 应大于前一键 2.5，实际为 2.5`）：
- id 全局唯一（实体 + 轨道 + 路径 + 约束同一命名空间）；`target / subject / mainCameraId` 必须指向存在且类型匹配的实体。
- 同一实体同一 property 最多一条轨道；有路径的实体不允许再有 `pos` 轨道（路径优先，直接拒绝而不是静默覆盖）。
- keys 严格递增、至少 1 个、t 为有限数 ≥ 0；fov 值在 FOV_RANGE 内；scale 各分量 > 0。
- points ≥ 2；`follow` 的 subject 不能是 target 自己；一个机位同时有 follow 时其 pos 轨道/路径仍然合法但会被 follow 覆盖（交接文档 4.3 的既定行为，校验器不管）。

### 3.2 代码模块 `src/anim/`

```
ease.js         linear / smooth(smoothstep) / step
Channel.js      一条属性的关键帧序列：evaluate(t) → 值。t 在首键前取首键，末键后取末键。
                rot：相邻两键的欧拉角 → 四元数 → slerp → 回欧拉（只在最终写入 root 时转）。
Track.js        Channel + target 实体 + property，apply(t, state)
Path.js         由 points 建 THREE.CatmullRomCurve3（centripetal），弧长表（≥ 200 段），
                positionAt(s) / tangentAt(s)，s 为弧长；progress(t) 按 speed 曲线把 (t−start)/duration 映射到 [0,1]
PathTrack.js    Path + target，apply(t, state)：写 pos；orient='tangent' 时写 yaw；
                并把 { speed(m/s), distance(m) } 交给 Locomotion（只对 character）
Locomotion.js   程序化步态（见 3.4）
Constraint.js   LookAt / Follow，apply(t, state)
Timeline.js     持有 tracks / paths / constraints / duration / fps；evaluate(t)；base 快照；增删改 API
Playback.js     play / pause / stop / seek / loop；rAF 驱动；tick 事件
```

### 3.3 手动值与动画值的共存（本阶段的核心决定，按此实现）

- Timeline 有两种状态：**idle** 和 **active**。idle 时它不碰任何实体，场景完全是手动值；`seek()` 或 `play()` 进入 active，`stop()` 回到 idle。
- 进入 active 的瞬间，Timeline 对**所有被驱动的实体**（出现在 tracks / paths / constraints 的 target 里的）记一份 `base`：transform、fov、pose.values 的拷贝。
- `evaluate(t)` 每次都从 `base` 出发：先把 base 写回实体，再按固定顺序 **关键帧轨道 → 路径轨道（含步态） → 约束** 叠加，最后写入 root / camera。未被驱动的属性因此天然保持手动值。
- `stop()` 把 base 写回实体并清空 base。
- **active 期间 `toDocument()` 必须导出 base 而不是 root 上的瞬时值**：`Timeline.baseOf(entity)` 返回 base 或 null，`serialize` / 各实体 `toJSON` 对被驱动的属性取 base。History 快照走同一条路，所以播放中撤销不会把动画瞬时值记成手动值。
- 阶段 D 会在 active 状态下允许拖 gizmo 打关键帧，那时再扩展；本阶段 active 期间来自 gizmo / 面板的修改一律视为改 base（最简单：修改后调用 `timeline.refreshBase(entity)`）。

### 3.4 Locomotion（程序化步态）

- 只在角色有路径且 `evaluate` 算出的瞬时速度 > 0 时介入；速度 = 弧长对时间的导数（数值微分 Δt=1/240 即可）。
- 相位 φ = 已走路程 ÷ 步幅周期长度（一个完整周期 = 左右各一步），**不是**时间。步幅周期长度 = 1.3 × 身高（走）/ 1.9 × 身高（跑）。
- 步态选择无状态：speed ≤ 1.8 m/s 纯走，≥ 2.6 m/s 纯跑，中间线性混合两套关节角。
- 与原姿势的混合权重 w = clamp(speed / 0.5, 0, 1)：速度为 0 时 w=0，角色就是原来的姿势（"停下恢复原姿势"自动成立，`smooth` 速度曲线下起步/停步自然过渡）。
- 关节：髋前后摆（走 ±28°、跑 ±40°）、膝屈（走 0–45°、跑 0–70°，只在摆腿后半段）、对侧手臂前后摆（走 ±22°、跑 ±45°，跑时肘屈 70°）、躯干微前倾（跑 8°）、根部上下浮动（走 ±1.5 cm、跑 ±3 cm，写在 model.position.y 上）。用 jointSchema 的语义关节，按 Pose 的 values 写，不要直接转骨头。
- 介入期间 `character.autoGround = false`，脚底高度由路径点 y 决定；停下（w=0）时恢复 `autoGround = true` 并重新 `_ground()`。
- 跑 selftest 的穿模检测（45 项）时把步态周期的 8 个相位也加进去，确保不穿。

### 3.5 Timeline API（给阶段 D / H 用，全部返回文档形状的对象；每个变更 → `history.schedule()`）

```
timeline.setDuration(s) / setFps(n) / setMainCamera(id|null)
timeline.addTrack({ target, property })            → track（空 keys）
timeline.setKey(trackId, t, value, ease='linear')  → 同 t 覆盖，否则插入并保持有序
timeline.removeKey(trackId, t) / removeTrack(trackId)
timeline.addPath({ target, points, ... }) / updatePath(id, patch) / removePath(id)
timeline.addConstraint({...}) / updateConstraint(id, patch) / removeConstraint(id)
timeline.toJSON() / fromJSON(json, ctx)            // 并入 App.toDocument / loadDocument
timeline.evaluate(t)                               // 纯函数语义，见 3.3
playback.play() / pause() / stop() / seek(t) / loop = bool / time / playing
playback.on('tick', t) / on('state', 'playing'|'paused'|'idle')
```
实体被删除时，引用它的轨道/路径/约束一并删除（在同一次 History 快照里）。

### 3.6 Playback 与渲染

- Stage 是按需渲染：Playback 用 rAF 推进 `time`，每帧 `timeline.evaluate(time)` 后 `stage.requestRender()`（或现有等价方法）。
- 到达 duration：loop 为真回 0 继续，否则 pause 在 duration（不 stop，保持 active）。
- `seek(t)` 夹到 [0, duration]。
- 内部时间用秒；fps 只给 `snap(t)` 用。

## 4. 分步执行（每步一个 commit，报告改动文件、测试结果、截图路径）

1. **文档形状 + 校验 + 序列化**：schema.js 注释与校验规则；serialize/migrate 不变；`App.toDocument / loadDocument` 接上 `timeline.toJSON/fromJSON`。5 种坏文档被定位拒绝（未知 target、keys 乱序、character 打 fov、id 重复、points 只有 1 个）。
2. **Channel / Track / Timeline.evaluate（只关键帧）+ base 机制 + Playback**：能用控制台 API 给角色打 pos/rot 关键帧、给机位打 fov 关键帧并播放；`stop()` 后场景回到手动值；播放中 `toDocument()` 导出的是 base。
3. **Path / PathTrack**：道具、机位、角色（先不切步态，仍是原姿势滑行）沿 Catmull-Rom 路径移动，`orient='tangent'` 时朝向切线；`smooth` 速度曲线首尾速度为 0。
4. **Locomotion**：按 3.4 实现；穿模检测扩展到步态相位。
5. **Constraint**：lookAt（保留机位 roll）与 follow；evaluate 顺序固定；验证"开 follow 则 pos 轨道/路径失效"。
6. **验收 + 文档**：selftest 增加 `anim` 子命令（见第 5 节）；更新 README、交接文档 4.3 / 5 代码地图 / 3 阶段表；本文件移到 `docs/done/`。

## 5. 验收标准（selftest `anim` 子命令全部自动化，截图到 `test-output/anim/`）

1. **纯函数**：搭场景（2 角色、1 道具、2 机位），加 pos/rot/scale/fov 轨道各 1 条、角色路径 1 条、lookAt 1 条、follow 1 条。`play()` 真实走 2.0 s 后 `pause()`，记录全部被驱动属性；`stop()` 后 `seek(playback.time)`，再记录；两组数值逐项差 < 1e-6。
2. **跳转一致**：`seek(0) → seek(7.3) → seek(2.5)` 与直接 `seek(2.5)` 截图像素差 0%。
3. **手动值保持**：未打关键帧的道具在 t=0 / t=5 / stop 后位置不变；`stop()` 后全场景截图 ≡ 进入 active 前的截图。
4. **导出不污染**：在 t=5 时 `toDocument()`，角色 transform ≡ 进入 active 前导出的 transform（忽略 updatedAt）。
5. **往返**：含 timeline 的文档 导出 → 清空 → 导入 → 导出，doc1 ≡ doc2；导入后 `seek(3)` 截图 ≡ 导入前 `seek(3)` 截图。
6. **撤销**：addTrack → setKey → addPath 三步，撤销 3 次重做 3 次，每步 `timeline.toJSON()` 与操作时一致。
7. **步态**：角色沿 6 m 直线路径 `smooth` 4 s：t=0 和 t=4 姿势 ≡ 原姿势（values 逐项相等）；t=2 处于步行姿势且朝向 +path 方向（yaw 误差 < 1°）；逐帧（1/30 s）采样 root.position.y 与 model.position.y 之和的相邻帧差 < 2 cm（不跳）；穿模检测步态 8 相位全过。把路径压到 1.5 s（4 m/s）→ t=0.75 为跑步姿势（膝屈 > 45°）。
8. **约束**：lookAt 机位在 t=0..5 每 0.5 s 采样，机位 −Z 轴与指向 subject 的向量夹角 < 0.1°，roll 保持；follow 机位与 subject 的相对偏移恒等于 offset（subject yaw 坐标系）。
9. **坏文档** 5 种被定位拒绝；lint 通过；原有 e2e、穿模检测、`doc` 子命令全过。
10. 阶段 B 的 `doc` 子命令往返测试加一条含 timeline 的场景。

## 6. 约束

- 不新增任何 UI、不改 Dock / Inspector / Outliner 布局；允许在 `main.js` 把 `app.timeline / app.playback` 挂到 `window.__stage`（已有调试入口的话复用）供 selftest 使用。
- 不引入新依赖；曲线用 three 自带的 CatmullRomCurve3。
- 旋转文档口径仍是 XYZ 欧拉角度数；四元数只在插值内部使用。
- 预设名、property 名、ease 名、speed/orient 取值都是 AI 词汇表，定了就不改；新增一个词要在 commit message 里说明。
- 说明没覆盖的决策：停下来列选项问，不猜。预计会碰到的：Locomotion 具体用哪几个 jointSchema 关节键；Crowd（group）成员各自沿路径还是整组沿路径（本阶段只做整组，成员不单独有路径——如果实现上有困难再问）。
- 每个 commit message 写清超出说明的改动及理由。
