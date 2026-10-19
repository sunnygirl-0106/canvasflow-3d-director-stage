# 任务说明 · 阶段 G · 导出 MP4：3D 名牌 + WebCodecs 离线逐帧

> 读者：Claude Code 执行者。先读《交接文档_导演台重构.md》4.3（主机位规则）、6 节，再读本文。
> 分支：阶段 F 合入主线后从主线开 `feat/export-video`。
> `src/anim/` 不动。本阶段**例外允许引入一个依赖**：`mp4-muxer`（纯 JS、MIT、无 native 依赖），见第 6 节。

## 1. 背景

到阶段 F，导演台已经能摆场景、让角色走、让机位动、从主机位播放。差最后一步：把它变成一个 MP4 文件，喂给后续的 AI 视频生成节点（"生成画布节点"那条线不在本阶段，但它要的就是这个文件）。

导出规则在阶段 F 已经定了：**第 i 帧 = `evaluate(i/fps)` 后用主机位渲染**。因为 `evaluate` 是纯函数（铁律 2），导出可以完全离线、逐帧、不受电脑快慢影响，也不需要真的"播放"。

两个硬问题：名牌现在是 DOM 元素，不在 WebGL 画面里，截图和导出都带不上；视口 canvas 的尺寸随窗口变，导出要固定分辨率。

## 2. 要解决的问题

1. 名牌进画面：导出时名牌必须出现在视频里（产品要求，AI 生成要靠它认人）。
2. 固定分辨率离线渲染：与窗口大小无关，输出 1280×720 / 1920×1080 等。
3. 逐帧编码成 MP4（H.264），在 Chrome / Edge 里跑，不传服务器。
4. 导出 UI：参数、进度、取消、下载。
5. 导出结果可验证：帧与 `snapshot` 一致，两次导出逐帧相同。

## 3. 目标架构

### 3.1 3D 名牌 `src/app/LabelSprites.js`

- 每个有名牌的目标（与 `Labels.attach` 相同的 `labelTargets()`）生成一个 `THREE.Sprite`：文字画到 canvas 纹理（字体、圆角底色、机位的橙色样式都照抄现有 CSS `.label3d / .cam`），`sizeAttenuation=false`，锚点在底部中央，位置 = DOM 名牌同一个锚点（头顶 / 机位上方，复用 Labels 里的投影锚点计算），`depthTest=false`、`renderOrder` 最高，始终面向相机。
- 像素尺寸：以 1080p 为基准，名牌高 ≈ 44 px；分辨率变化按比例缩放（sprite scale = 像素高 / 目标画面高 × 2，正交比例）。
- 纹理按 devicePixelRatio=2 绘制避免糊；文字变更（改名）时重绘。
- **只在导出时启用**：`enable()` 建精灵并挂到 `stage.world` 之外的专用 group，同时隐藏 DOM 名牌层；`disable()` 反之。不改变平时的 DOM 名牌（它更清晰、不占 GPU）。
- 也挂到 `withCleanRender()`：截图（ShotManager）同样走精灵名牌，让截图和导出一致——这是顺带修一个老问题（现在截图里没名牌）。`scene.labels=false` 时精灵也不显示。
- 导出面板里给一个「预览名牌」开关：打开时在视口里也用精灵名牌（方便看效果），关闭回 DOM。

### 3.2 离线渲染 `src/app/VideoExporter.js`

```
export async function exportVideo(app, { width, height, fps, range:[t0,t1], labels:true, onProgress, signal })
```
- 分辨率：由「取景比例」决定宽高比（`auto` 视为 16:9），用户选短边 720 / 1080 / 1440；宽高取偶数（H.264 要求）。
- 渲染：新建一个**离屏** `WebGLRenderTarget(width, height, { samples: 4 })`，用主机位相机（`mainCameraId`；未设用当前机位；都没有则拒绝并提示"请先添加机位"）设置 `aspect = width/height` 渲染进去，再 `readRenderTargetPixels` → `ImageData` → `createImageBitmap`（翻转 Y）→ `VideoFrame`。不要动主 canvas 的尺寸（避免闪烁和布局抖动）。
- 帧循环：`for i in 0..N-1: t = t0 + i/fps; timeline.evaluate(t); render; encode`。N = `round((t1−t0)·fps)+1`。每帧 `await` 一次让出主线程，进度条才能动；`signal` 取消时停止并清理。
- 导出期间：`timeline` 进入 active（用现有 `evaluate`），结束后恢复导出前的播放头（`seek(原 t)` 或 `stop()` 回 idle，取决于导出前状态）；`withCleanRender` 包住全程（gizmo / 选中环 / 视锥 / 路径 overlay / 播放亮点都不出现）；History、自动保存不触发（导出不改文档）。
- 编码：`VideoEncoder`，codec `avc1.42001f`（Baseline，720p）/ `avc1.4d002a`（Main，1080p+），`bitrate` 按分辨率（720p 6 Mbps、1080p 12 Mbps、1440p 20 Mbps），`framerate=fps`，`latencyMode:'quality'`，关键帧每 2 秒。编码后的 chunk 交给 `mp4-muxer`（`Muxer` + `ArrayBufferTarget`，`fastStart:'in-memory'`），结束 `finalize()` → Blob → 下载。
- 文件名：`${meta.name}_${width}x${height}_${fps}fps.mp4`。
- 能力检测：`'VideoEncoder' in window` 且 `VideoEncoder.isConfigSupported(cfg)` 为真，否则 toast"导出视频需要 Chrome 或 Edge 浏览器"，按钮禁用。

### 3.3 导出 UI

- Dock「场景」菜单加「导出视频…」，打开弹层（沿用 HistoryModal 的弹层样式）：
  - 分辨率（720p / 1080p / 1440p，显示实际宽×高）、帧率（沿用时间轴 fps，可改）、范围（全程 / 自定义 起–止 秒）、名牌（开关，默认开）、「预览名牌」。
  - 顶部显示将使用的机位名（主机位 / 当前机位 / 未设置时报错）和估算帧数、时长。
  - 「开始导出」→ 进度条（帧 i/N、已用时、预计剩余）+ 「取消」；完成后自动下载并 toast 文件大小；失败 toast 错误。
- 导出中锁住：时间轴面板、Inspector、Dock 置灰，视口不响应；`Esc` = 取消。

### 3.4 selftest 的离屏一致性

为了能自动验收，`VideoExporter` 暴露 `renderFrame(t) → ImageBitmap/canvas`（内部函数），selftest 用它取帧与 `stage.snapshot(主机位, {width,height})` 比对。

## 4. 分步执行（每步一个 commit）

1. **LabelSprites**：精灵名牌 + `withCleanRender` 接入 + 截图带名牌；视口「预览名牌」开关（先放在 Dock「场景」菜单，第 3 步挪进弹层）。
2. **离屏渲染 + 帧循环**：`renderFrame(t)` 与 `renderFrames()`，不编码，先能输出 PNG 序列到 `test-output/export/frames/`（selftest 用）；取消 / 恢复播放头 / withCleanRender。
3. **WebCodecs + mp4-muxer**：编码、封装、下载；能力检测；导出弹层 + 进度 + 取消。
4. **验收 + 文档**：selftest `export` 子命令；README（导出说明、浏览器要求）；交接文档 3 阶段表、4.7 导出已定设计、5 代码地图、6 下一步（阶段 H）、已知问题；本文件移到 `docs/done/`。

## 5. 验收标准（selftest `export` 子命令，截图与文件到 `test-output/export/`）

1. **名牌进画面**：开精灵名牌后 `snapshot` 里能找到名牌（在名牌锚点投影位置附近采样到底色像素）；DOM 名牌隐藏；关闭后 DOM 恢复、精灵移除；`scene.labels=false` 时两者都不显示。
2. **名牌位置一致**：精灵名牌底部中心的屏幕投影与 DOM 名牌锚点位置差 < 4 px（1080p）。
3. **帧 = 快照**：场景含走路角色 + 半环绕机位（主机位）+ 全景图；`renderFrame(2.0)` 与 `evaluate(2.0)` 后 `stage.snapshot(主机位, 1920×1080)` 像素差 < 0.5%（抗锯齿差异允许）。
4. **离线确定性**：同一文档导出两次 30 帧的 PNG 序列，逐帧 md5 相同；导出后播放头回到导出前（时间与 active 状态都一致）、文档 `toDocument()` 不变、History 长度不变。
5. **分辨率与比例**：取景比例 9:16 + 1080p → 1080×1920；`auto` → 1920×1080；宽高均为偶数。
6. **MP4 文件**：导出 3 秒 30 fps 1080p：文件存在、≥ 100 KB；用 `ffprobe`（CI 机器上有就用，没有则用 mp4 盒子解析器读 `mvhd/stsz`）验证：时长 3.00 ± 0.05 s、90 帧、avc1、1920×1080。无 `ffprobe` 时在报告里说明。
7. **取消**：导出到 30% 取消：无文件、播放头恢复、UI 解锁、无 console 错误。
8. **不支持的浏览器**：模拟 `window.VideoEncoder = undefined` → 按钮禁用 + 提示。
9. **导出期间干净**：任一导出帧里没有 gizmo / 选中环 / 视锥 / 路径线（在它们应出现的屏幕位置采样颜色不含 accent 蓝 / 红）。
10. 所有回归（e2e / doc / anim / tl / path / cam / collide）+ lint 全过；截图回归（原有 e2e 的截图）如因名牌进截图而变化，更新基线并在报告里说明。
11. 产品侧手动验收：导出弹层截图、进度中截图、一个 5 秒的 1080p 示例 MP4（放 `test-output/export/sample.mp4`，不入库）。

## 6. 约束

- 唯一允许新增的依赖是 `mp4-muxer`（`npm i mp4-muxer`，锁定版本写进 package.json）。不要自己写 MP4 封装，也不要引入 ffmpeg.wasm（体积和许可都不合适）。
- 不动 `src/anim/`；导出只调用 `timeline.evaluate(t)` 和 `playback.seek/stop`。
- 不改变平时视口的名牌实现（DOM 保留），精灵只在导出 / 截图 / 预览开关时启用。
- 导出不改文档、不记撤销、不触发自动保存。
- 不做：音频、字幕、水印、服务器端渲染、WebM 回退（Safari / Firefox 直接提示不支持）、"生成画布节点"回传。
- 说明没覆盖的决策：停下来列选项问。预计会碰到的：1440p 在集成显卡上内存是否够（可先只放 720p / 1080p，1440p 标"实验"）；headless Chrome 若缺 H.264 软编码器，selftest 第 6 条如何替代（建议：用 `avc1` 不可用时退 `vp09` 仅在测试里验证管线，报告里说明）。
