# 3D 导演台 · 技术改动规划

> 范围：本文档只覆盖**功能一（底部 Banner）**与**功能二（导演视角下的摄像机显示）**。功能三（地面）维持现状，不在范围内。
> 原则：**不大改现有架构**，尽量在既有 `App / Stage / CameraRig / TransformGizmo / Dock / Outliner / Entity` 体系内做增量扩展，复用既有控件与样式约定。

---

## 1. 现状架构（关键约束）

复用现有约定，下列事实决定了改造方式：

- **状态中枢**：`App.js` 持有 `entities[]`（`Character` / `Prop`）、`selectedId`、场景级状态 `sceneState`，统一负责增删选改，UI 通过 `app.attachUI({...})` 反向回调刷新。
- **实体模型**：`Entity` 基类约定 `{ id, type, name, root(Object3D), visible }`，并在 `root.userData.entityId` 上挂 id 供选择回溯。所有实体都通过 `stage.add(root)` 加进 `world` 组。
- **变换**：`TransformGizmo` 封装单实例 `TransformControls`，已支持 `translate / rotate / scale` 三模式切换（`setMode`）。**旋转模式本身就是 three 的旋转环/旋转球**，缩放模式本身就支持 X/Y/Z 独立轴柄——能力已具备，缺的是 UI 入口。
- **相机/取景**：`stage.camera` 是导演视角相机；`CameraRig` 管 OrbitControls、取景框 overlay（`setRatio('16:9'|'9:16'|'1:1'|'free')`，内部已用 `'w:h'.split(':')` 解析比例）、`focus`、`resetView`。当前「机位视角」仅切换取景框 overlay，**并不真正切换渲染相机**。
- **底部工具坞**：`Dock.js` 用内联 SVG + `el()` 构建按钮，已有一套「添加菜单」popover（`_buildMenu / _toggleMenu / _closeMenu` + document click 关闭）。这是唯一的 popover 实现，可抽象复用。
- **左侧清单**：`Outliner.js` 目前**硬编码一个「机位1」节点**（点击只调用 `setCameraView(true)`），其余按 `entities[]` 渲染；相机图标 `ICON.camera` 已存在。
- **名牌**：`App._makeLabel / _updateLabels` 目前**仅对 `type==='character'`** 创建并跟踪头顶 DOM 名牌。
- **截图**：`capture()` 通过 `beforeRender/afterRender` 钩子隐藏 gizmo / 选中环 / 名牌，按取景框裁剪导出。
- **自测**：`selftest.mjs` 用 puppeteer 驱动真实 dev server，通过 `window.__app` 断言。新功能应在此补测。

---

## 2. 总体设计原则

1. **增量优先**：新增能力以「新文件 + 在 App 上加方法 + Dock 接线」的方式落地，尽量不动既有方法签名。
2. **统一 popover**：把 Dock 现有的一次性「添加菜单」抽象成可复用的 `dockMenu()` helper，供「变换 / 全景图 / 添加机位 / 比例」四个新菜单共用，避免四套重复的开合逻辑。
3. **相机即实体**：摄像机做成一等实体 `CameraEntity`（`type:'camera'`），复用 `entities[] / 选择 / gizmo / 名牌 / Outliner` 全链路，这样「添加机位（功能一·d）」与「导演视角看到机位（功能二）」天然合并为同一套数据结构。
4. **可替换的资产源**：全景图「历史记录」用一个 mock `assetLibrary` 服务隔离，未来接入「画布」产物时只替换该服务实现。

---

## 3. 功能一：底部 Banner（工具坞）改造

### 3.0 前置：抽象可复用的 Dock 菜单（`src/ui/dockMenu.js`，新增）

把现有 add 菜单的开合逻辑抽成 helper，统一管理「同一时刻只开一个菜单」与「点击空白关闭」：

```js
// dockMenu.js
// createDockPopover({ anchorBtn, build }) -> { el, open, close, toggle }
// 由 Dock 持有一个 this._openPopover，打开新菜单时先关旧菜单。
```

Dock 内保留一个 `this.menus = []`，`document` 级 click 统一关闭非命中菜单。**收益**：四个新菜单零重复代码，行为一致。

### 按钮总览（对齐截图，8 个）

| # | 功能 | 现状 | 改动类型 |
|---|------|------|----------|
| a | 变换操作（移动/旋转/缩放） | move、rotate 两个独立按钮 + 隐藏 dblclick 切 scale | **合并为 1 按钮 + 菜单** |
| b | 添加角色 | 已有添加菜单 | **不动** |
| c | 全景图（本地上传/历史记录） | 无 | **新增按钮 + 菜单 + 全景背景能力** |
| d | 添加机位（15 预设） | 无 | **新增按钮 + 菜单 + CameraEntity** |
| e | 比例 | `cycleRatio()` 循环 4 项 | **改为菜单，扩展为 7 项** |
| f | 截屏 | `captureShot()` | 复用，仅补「隐藏相机辅助物」 |
| g | 第七按钮 | 发送到画布（占位） | **不做**（保留占位） |
| h | 全屏 | `_toggleFullscreen()` | 复用，补按钮态高亮 |

### 3.a 变换操作

- Dock 把现有 `move` + `rotate` 两个按钮替换为单个「变换」按钮，点击弹出菜单：**移动 / 旋转 / 缩放**，菜单项分别调用既有 `app.setTransformMode('translate'|'rotate'|'scale')`。
- 按钮图标随当前模式变化或在菜单项上打勾（复用 `reflectMode(mode)`，已在 `App.setTransformMode` 末尾调用）。
- **旋转球**：选中实体并切到 `rotate` 模式时，`TransformControls` 原生渲染三色旋转环 + 外圈球——即需求所说的「旋转球」，无需额外实现。
- **X/Y/Z 独立缩放**：`scale` 模式下 `TransformControls` 原生提供三轴独立缩放柄 + 中心统一缩放，已满足；右侧 Inspector 的「缩放」三元行（`tripleRow`）亦可逐轴输入，二者已联动（gizmo `onObjectChange` → `syncFromObject`）。
- 保留键盘 `V/R/S` 快捷键（`main.js` 已有）。

> 结论：a 主要是 **UI 入口重构**，底层能力已存在，改动集中在 `Dock.js`，零核心逻辑风险。

### 3.b 添加角色

保持现有添加菜单（本地上传 `.glb` / 角色素体 / 几何模型子菜单）不变。

### 3.c 全景图（本地上传 + 历史记录）

需要两块：**菜单 UI** + **全景背景渲染能力**。

**(1) 全景背景能力（`src/core/Panorama.js` 新增，或并入 `Stage`）**

- 在 `Stage` 上新增：
  - `setPanorama(texture)`：把等距柱状（equirectangular）贴图设为场景背景。推荐用 `texture.mapping = THREE.EquirectangularReflectionMapping; scene.background = texture;`（最省事，渲染器原生支持）。需要可旋转/半径时，改用一个 `BackSide` 的大球 `panoSphere`（半径取自 ScenePanel「球形半径」滑条），把 ScenePanel 里现有的「全景球：水平旋转 / 球形半径」两个**占位滑条激活**（去掉 `disabled`）。
  - `clearPanorama()`：恢复 `scene.background = sky 颜色`（与现有 `setSkyColor` 协调，互斥：设了全景图就盖过纯色天空）。
- 资源释放：替换全景图时 `oldTexture.dispose()`。
- 与雾的关系：当前 `scene.fog` 会影响纯色背景观感；有全景背景时建议保留但记录原值，避免全景被雾染色（可在 `setPanorama` 时弱化或关闭 fog，`clearPanorama` 时恢复）。

**(2) App 接线**

- `App.setPanoramaFromFile(file)`：`new THREE.TextureLoader().load(URL.createObjectURL(file), ...)` → `stage.setPanorama(tex)`；`tex.colorSpace = THREE.SRGBColorSpace`。
- `App.setPanoramaFromAsset(asset)`：同上，URL 来自 mock 资产。
- 同步更新 ScenePanel「已连接全景图」占位区为缩略图 + 「移除」。

**(3) 历史记录 = 可替换的 mock 资产服务（`src/util/assetLibrary.js` 新增）**

```js
// 模拟「画布」历史资产；未来替换为真实画布 SDK 调用即可。
export async function listCanvasAssets() {
  // return [{ id, type:'image'|'video', url, thumb, createdAt, title }]
}
```

- 首版返回若干内置/占位全景图（放 `public/assets/pano/*.jpg`，或用渐变 canvas 动态生成缩略图，避免引入大体积素材）。
- Dock「全景图」菜单两个入口：
  - **本地上传**：`<input type=file accept="image/*">` → `app.setPanoramaFromFile`。
  - **历史记录**：弹出资产网格（缩略图九宫格，复用 popover），点选 → `app.setPanoramaFromAsset`。视频类资产首版可仅取封面帧或标灰禁用，并在文档注明「画布嵌入后开放」。

> 说明：需求点明该导演台将嵌入产品「画布」，「历史记录」即导入画布既有产物。`assetLibrary` 即未来对接点，接口先定形。

### 3.d 添加机位（15 预设）

**新增 Dock 按钮 + 预设菜单**，菜单项调用 `app.addCamera(presetKey)`。预设与实体实现见 **§4（功能二）**，二者共用 `CameraEntity`。菜单分组建议按截图语义：

- 视角：当前视角
- 正面：正面中景 / 正面特写 / 正面全景
- 侧/背：侧面跟拍 / 侧面近景 / 背面中景
- 俯仰：俯拍全景 / 45°俯拍 / 低角度仰拍 / 低角度广角
- 特殊：过肩镜头 / 过肩镜头（右）/ 鸟瞰 / 荷兰角

### 3.e 比例

- 现状 `cycleRatio()`（循环 16:9/9:16/1:1/free）改为**点击弹菜单**，选项：`Auto（默认）/ 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16`。
- `CameraRig.setRatio` 已能解析任意 `'w:h'`，**只需扩展候选集**；`'Auto'` 等价于现 `'free'`（不显示取景框，全幅）。
- App 侧：用 `app.ratio`（字符串，默认 `'auto'`）取代 `ratioIndex/RATIOS`，新增 `app.setRatio(str)`：`stage`/`rig` 应用比例 + 当前菜单打勾。
  - **注意联动**：现 `setCameraView(on)` 依赖 `RATIOS[this.ratioIndex]`、`cycleRatio` 会强制 `setCameraView(true)`。改造时解耦：比例选择只控制取景框；是否进入「机位视角」由 viewtabs / Outliner 决定。需同步调整 `setCameraView` 内对 `RATIOS[ratioIndex]` 的引用与 `captureShot` 里「确保有取景框」的判断（改判 `app.ratio !== 'auto'`）。
- 默认值：`main.js` 现以 `rig.setRatio('free')` 启动，对应新默认 `'auto'`，一致。

### 3.f 截屏

复用 `captureShot()`。唯一新增：`beforeRender` 钩子里**同时隐藏相机辅助物**（见 §4），`afterRender` 恢复——避免把视锥线/相机体拍进成片。

### 3.g 第七按钮

需求明确「不用做」。保留现有「发送到画布」占位按钮（或按视觉需要替换为截图里的占位图标），逻辑不动。

### 3.h 全屏

复用 `_toggleFullscreen()`（已是进入/退出切换）。补：监听 `fullscreenchange` 给按钮加 `.on` 态，体验更明确。

---

## 4. 功能二：导演视角下的摄像机显示

目标：通过「添加机位」加入的摄像机，在**导演视角**里以可视化的相机体 + 视锥 + 名牌呈现其位置与朝向（对齐截图 2），并可被选择/移动/旋转/删除。

### 4.1 新增实体 `CameraEntity`（`src/entities/Camera.js`）

继承 `Entity`，`type:'camera'`。`root` 结构：

```
root (Object3D, userData.entityId)
 ├─ cam   : THREE.PerspectiveCamera     // 真实相机（作为 root 子节点，继承位姿）
 ├─ body  : Mesh                        // 橙色相机体（小立方/相机造型），可被 raycast 选中
 └─ (frustum 由 CameraHelper 表达，见下)
```

要点：

- **真实相机** `this.cam = new THREE.PerspectiveCamera(fov, aspect, near, far)` 作为 `root` 子节点。这样 gizmo 移动/旋转 `root` 时，`cam` 世界矩阵随动，无需手写同步。
- **视锥可视化**：用 `THREE.CameraHelper(this.cam)`。`CameraHelper` 读取 `cam.matrixWorld`，需**加到 `scene`（非 world 组、非 root）**，每帧 `helper.update()`。把材质改为半透明蓝/青线，匹配截图。
  - 备选：自绘视锥线段（`LineSegments`）作为 `root` 子节点，免去每帧 update 与 scene 生命周期管理，但 FOV 变化要手动重建。**推荐 CameraHelper**（精确、与真实相机一致）。
- **相机体** `body`：一个小的橙色 `Mesh`（`BoxGeometry` 或简单相机造型组合），`castShadow=false`。**只有 body 参与 raycast 选择**（因 `Selection` 只对 `entity.root` 做递归 raycast，而 helper 在 scene 下不在 root 内，自然不被选中）。
- **缩放**：相机不应被几何缩放。建议在选中相机时把 gizmo 限制为 `translate/rotate`（在 `App.select` 或 `setTransformMode` 里对 `type==='camera'` 跳过 `scale`），或允许但不产生视觉副作用。
- `dispose()`：移除并 `helper.dispose()`、`body.geometry/material.dispose()`。

### 4.2 相机预设（`src/core/cameraPresets.js`，新增）

预设是「给定**目标主体**（当前选中角色，否则场景中心）+ **导演相机**，算出机位的位姿与 fov」的纯函数表：

```js
// 每项：{ key, label, group, fov, build(ctx) -> { position:Vec3, target:Vec3 } }
// ctx = { subjectBox, subjectCenter, subjectHeight, directorCamera, sceneCenter }
export const CAMERA_PRESETS = [ ... 15 项 ... ];
```

15 项语义建议：

- **当前视角**：克隆 `directorCamera` 的 position 与 OrbitControls.target（直接复制导演视角，最易实现，建议作为默认/第一项）。
- **正面中景 / 正面特写 / 正面全景**：主体 +Z 方向不同距离 + 取景高度（特写抬到头胸、全景拉远含全身脚下）。
- **侧面跟拍 / 侧面近景**：主体 ±X 方向，跟拍略带后方偏移。
- **背面中景**：主体 -Z。
- **俯拍全景 / 45°俯拍 / 鸟瞰**：高 Y、俯角（鸟瞰近正上方）。
- **低角度仰拍 / 低角度广角**：低 Y、仰角（广角配大 fov，如 65–75°）。
- **过肩镜头 / 过肩镜头（右）**：在主体侧后方，target 指向「对方」——单主体时退化为主体后肩位。
- **荷兰角**：在正/侧面基础上给 `cam.rotation.z` 一个倾角（Dutch tilt），需要在应用预设后对 `root`（或 cam）叠加 roll。

距离/高度用 `subjectHeight`（角色 1.7）与包围盒尺度归一，保证不同主体下构图稳定（可复用 `CameraRig.focus` 里基于骨骼包围盒测真实尺寸的思路）。

### 4.3 App 接线

新增/调整方法：

- `App.addCamera(presetKey)`：
  1. 取主体（`this.selected?.type==='character' ? selected : 场景中心`）；
  2. 调用预设算 `{position, target, fov}`；
  3. `new CameraEntity('机位'+(++this._camCount), { fov, aspect: 视口宽高比 })`，设 `root.position`、用 `lookAt(target)` 定朝向、叠加 Dutch roll（如有）；
  4. `stage.add(c.root)`；`stage.scene.add(c.helper)`；`this._makeLabel(c)`；`entities.push(c)`；`select(c.id)`；`outliner.refresh()`。
- **名牌泛化**：`_makeLabel` 已通用（任意 ent）；把 `_updateLabels` 的过滤 `if (ent.type !== 'character')` 改为「`character` 或 `camera`」，相机锚点取 `body` 世界坐标上方一点（相机名牌字号比角色小，见样式）。
- **每帧更新**：`App.tick` 里对相机实体 `ent.helper.update()`（或在 Stage 统一遍历）。
- **机位视角隐藏自身**：进入「机位视角」或截图时，隐藏所有相机 helper + body（你不会想在成片/取景里看到相机）。提供 `App.setCameraGizmoVisible(v)`：遍历相机实体切 `body.visible / helper.visible`。
  - 在 `setCameraView(on)` 里：`on` 时隐藏相机可视化；`off`（导演视角）时显示。
  - 在 `captureShot` 的 `beforeRender/afterRender` 里：临时隐藏/恢复。
- **删除/显隐**：`remove(id)` 现有逻辑会移除 `root` 与 `labelEl`，但 helper 在 scene 下——需在 `remove` 中对相机额外 `stage.scene.remove(ent.helper)` 并 `ent.dispose()`（已调用 `dispose()`，把 helper 移除放进 `CameraEntity.dispose` 即可，无需改 `remove` 主流程，仅需 `dispose` 能拿到 scene 引用 → 构造时存 `this._scene`）。

### 4.4 Outliner 调整

- **移除硬编码「机位1」节点**，改为按 `entities[]` 渲染相机实体（`ICON.camera` 已具备）。
- 相机节点点击 = 选中（走通用 `app.select`，显示 gizmo + Inspector）。
- 提供「设为当前机位 / 看向该机位」入口（双击节点或 ops 里加一个按钮）→ `app.setActiveCamera(id)`（见 §4.5）。

### 4.5 与「机位视角」的关系（建议范围 + 可选扩展）

- **本功能必须项（功能二原文）**：导演视角里**看见**相机位置。上面 §4.1–4.4 已覆盖。
- **可选扩展（建议二期）**：真正「透过机位渲染」。当前「机位视角」只切取景框、不切相机。若要透过所选机位出画面：
  - `App.activeCameraId` + `App.setActiveCamera(id)`；
  - 渲染时若处于机位视角且有 active camera，用 `ent.cam` 替代 `stage.camera` 渲染（`Stage.render` 接受可选相机参数，或 `Stage.setRenderCamera(cam)`）；
  - `onResize` 同步 active camera 的 `aspect`；OrbitControls 仅在导演视角生效。
  - 截图 `capture` 用当前渲染相机即可。
  - 这是较大改动（触及渲染主循环），且**超出功能二字面要求**，故标记为开放项（见 §8 待确认）。首版可先只做可视化，「机位视角」维持现有取景框行为。

### 4.6 Inspector（相机属性，轻量）

选中相机时右侧面板复用 `_attr` 结构，但去掉颜色/姿势，新增：

- 名称、位置、旋转（复用 `tripleRow`）；
- **FOV** 滑条（`sliderRow` 20–90°）→ 改 `cam.fov` + `cam.updateProjectionMatrix()` + `helper.update()`；
- 「设为当前机位」按钮（若做 §4.5 扩展）。

实现上给 `Inspector.show` 加 `type==='camera'` 分支，或在 `_attr` 里按 `ent.type` 条件渲染字段。改动局部可控。

---

## 5. 文件改动清单

| 文件 | 类型 | 改动 |
|------|------|------|
| `src/ui/dockMenu.js` | 新增 | 可复用 Dock popover/菜单 helper |
| `src/util/assetLibrary.js` | 新增 | mock「画布历史资产」服务（全景图历史记录） |
| `src/core/Panorama.js` *(或并入 Stage)* | 新增/可选 | 全景等距柱状背景 / 全景球 |
| `src/entities/Camera.js` | 新增 | `CameraEntity`（cam + body + CameraHelper + dispose） |
| `src/core/cameraPresets.js` | 新增 | 15 个机位预设（纯函数表） |
| `src/ui/Dock.js` | 改 | 八按钮重构：变换菜单、全景图菜单、添加机位菜单、比例菜单；接 dockMenu helper |
| `src/app/App.js` | 改 | `addCamera / setPanoramaFromFile / setPanoramaFromAsset / setRatio / setActiveCamera(可选) / setCameraGizmoVisible`；`_updateLabels` 纳入相机；`tick` 更新 helper；`captureShot` 隐藏相机可视化；`remove/select` 相机适配；以 `this.ratio` 取代 `ratioIndex` |
| `src/core/Stage.js` | 改 | `setPanorama/clearPanorama`；（可选）`setRenderCamera`；相机 helper 加入 scene 的承载 |
| `src/core/CameraRig.js` | 改 | 扩展比例候选集（21:9/4:3/3:4 + Auto）；（可选）机位视角下让位 active camera |
| `src/ui/Outliner.js` | 改 | 去掉硬编码「机位1」，渲染相机实体 + 看向该机位入口 |
| `src/ui/Inspector.js` | 改 | 相机属性分支（FOV、去色/去姿势） |
| `src/ui/ScenePanel.js` | 改 | 激活「全景球」滑条；「已连接全景图」占位换为缩略图/移除 |
| `src/styles/style.css` | 改 | 新菜单（变换/比例栅格/全景资产九宫格/机位预设列表）、相机名牌（小号）样式 |
| `index.html` | 可能不动 | Dock 在 JS 内构建，无需改结构 |
| `selftest.mjs` | 改 | 补：addCamera 生成实体+helper、导演视角可见/截图隐藏、比例菜单 7 项、全景设定、变换菜单三模式 |

---

## 6. 关键接口签名（建议）

```js
// App.js
addCamera(presetKey): CameraEntity
setRatio(str)                       // 'auto'|'21:9'|'16:9'|'4:3'|'1:1'|'3:4'|'9:16'
setPanoramaFromFile(file)
setPanoramaFromAsset(asset)
setCameraGizmoVisible(v)            // 截图/机位视角时隐藏相机体+视锥
setActiveCamera(id)                 // 可选（二期，透视渲染）

// Stage.js
setPanorama(texture)                // scene.background = equirect texture（关/弱化 fog）
clearPanorama()                     // 恢复纯色天空
// setRenderCamera(cam)             // 可选（二期）

// Camera.js
class CameraEntity extends Entity {
  constructor(name, { fov, aspect, scene })   // scene 供 helper 增删
  cam; body; helper;
  update()        // helper.update()
  setFov(deg)
  dispose()       // 从 scene 移除 helper + 释放
}

// cameraPresets.js
CAMERA_PRESETS: Array<{ key, label, group, fov, build(ctx)->{position,target,roll?} }>

// assetLibrary.js
listCanvasAssets(): Promise<Array<{id,type,url,thumb,title,createdAt}>>
```

---

## 7. 边界与注意事项

- **CameraHelper 生命周期**：它在 `scene` 下而非 `world`/`root`，必须随实体一起增删、每帧 `update()`、`dispose()`，否则残留线框或内存泄漏。
- **选择不误选视锥**：因 helper 不在 `entity.root` 子树内，`Selection` 的 `intersectObjects(roots, true)` 不会命中视锥，符合预期；务必保持 helper 不挂到 root。
- **场景整体变换**：相机实体经 `stage.add` 进入 `world` 组，会随「场景缩放/平移/旋转」整体变换；helper 因读 `cam.matrixWorld` 仍正确。需确认这是期望行为（一般是）。
- **截图洁净**：`capture.beforeRender` 必须同时关掉 gizmo、选中环、名牌、**相机体 + 视锥**；`afterRender` 精确恢复（注意只恢复截图前可见的项）。
- **resize**：相机实体的 `cam.aspect` 若用于二期透视渲染，需在 `Stage.onResize` 同步；首版仅可视化可不处理。
- **比例联动回归**：替换 `ratioIndex/cycleRatio` 时，回归检查 `setCameraView`、`captureShot`、`main.js` 初始化、`selftest` 第 7 项（直接调 `rig.setRatio` 的用例不受影响，但 App 层断言要更新）。
- **全景与天空色互斥**：设全景后 `setSkyColor` 应不可见或自动清全景；UI 上给出清晰的「移除全景」路径。
- **性能**：单视口下相机数量有限，CameraHelper 开销可忽略；大量机位时可考虑共享几何/懒更新。

---

## 8. 待确认（开放问题）

1. **「机位视角」是否需要真正透过所选机位出画面**（POV 渲染），还是本期只要在导演视角看到机位位置即可？后者改动小、贴合功能二字面；前者更完整但触及渲染主循环（§4.5），建议二期。**默认按「只可视化」实现，POV 作为二期。**
2. **全景图历史记录的资产形态**：图片为主，视频资产首版是否仅取封面/置灰？画布 SDK 的真实接口形态（用于定 `assetLibrary` 签名）。
3. **荷兰角 / 过肩** 等预设的具体构图参数（角度、距离）是否有美术基线，还是先给一套工程默认值后续微调。
4. 相机是否允许缩放变换（建议禁用，仅 translate/rotate）。

---

## 9. 验收与自测（selftest 增补）

- 变换菜单：依次选 移动/旋转/缩放 → `gizmo.control.mode` 正确且 helper 可见。
- 添加机位：`app.addCamera('front_mid')` → `entities` 多一个 `type==='camera'`，`helper` 在 scene、导演视角下 `body.visible===true`。
- 机位视角/截图隐藏：进入机位视角或截图期间相机 `body.visible===false`、helper 不可见，结束恢复。
- 比例菜单：对 `21:9 / 4:3 / 3:4` 截图，导出尺寸比值匹配（容差同现有 0.06）。
- 全景图：`setPanoramaFromFile`/`setPanoramaFromAsset` 后 `scene.background` 为贴图；`clearPanorama` 后恢复颜色。
- 回归：原 9 项自测全绿（重点是比例改造与名牌泛化不破坏角色名牌）。

---

## 10. 建议实施顺序（分期）

**一期（本次范围）**
1. `dockMenu.js` 抽象 + Dock 八按钮骨架（含变换菜单、比例菜单）——纯 UI，可独立验收。
2. `CameraEntity` + `cameraPresets` + `App.addCamera` + Outliner/名牌/截图隐藏 → 落地功能一·d 与功能二。
3. 全景图（`assetLibrary` + `Stage.setPanorama` + 菜单 + ScenePanel 激活）→ 功能一·c。
4. 截屏/全屏微调 + selftest 增补 + 回归。

**二期（可选，待确认）**
5. 机位视角 POV 渲染（`activeCameraId` + `Stage.setRenderCamera` + resize 同步）。
6. 真实「画布」资产接入替换 `assetLibrary`、全景球旋转/半径精修、相机属性面板细化。
