# 3D 导演台 · 融合 Demo

把 `导演台MVP_demo.html`（场景 / 道具 / 取景 / 截图）与 `人偶姿势体验_Xbot.html`
（带骨骼 GLB 角色 / 全身 FK 摆姿 / 预设动画）融合成一个 **Vite + three（ES Module）** 工程。

## 启动

```bash
cd demo
npm install
npm run dev        # 打开终端给出的 http://localhost:5173
# 生产构建：
npm run build && npm run preview
```

## 能力

- **多角色 GLB**：加角色（Xbot / Soldier / Robot），自动归一化身高 + 落地。
- **几何道具**：方块 / 圆柱 / 球 / 人体素模，颜色与尺寸可调。
- **统一选择 / 摆站位**：点选高亮（地面环）+ 标准 `TransformControls`（移动 / 旋转 / 缩放）。
- **全身多轴姿势**：右侧「姿势」面板按 `jointConfig` 分组的滑条，FK 实时驱动骨骼。
- **预设动画**：模型内置动画一键播放，与手动摆姿互斥。
- **多比例取景 + 截图**：16:9 / 9:16 / 1:1 / 自由，按取景框裁剪导出 PNG（不含 gizmo）。
- **多角色独立**：每个角色各自持有 `bones / restQ / values / mixer`。

## 界面（对齐《3D导演台》设计稿）

- 顶栏：`3D导演台` / 居中 `导演视角·机位视角` 切换 / `? ×`。
- 左栏：`场景` + 搜索 + 清单（机位1 / 角色 / 道具，含图标、选中高亮、显隐·改名·删除）。
- 视口：右上角坐标指示器 + `重置视角`；白色角色名牌；机位视角下显示取景框。
- 底部悬浮工具坞：选择/移动 · **＋添加（角色素体 / 本地上传 / 几何模型子菜单）** · 旋转 · 机位视角 · 取景比例 · 截图 · 发送到画布 · 全屏。
- 右栏：**未选中 → 「3D场景」面板**（场景缩放/平移/旋转、全景背景·天空颜色、全景球[占位]、角色标签·网格吸附、地面 显隐/透明度/高度）；**选中 → 「角色 / 道具」面板**（属性：名称/位置/旋转/缩放/统一缩放/颜色；角色另有「姿势」页）。

## 操作

- 空白处拖动 = 环绕视角；滚轮 = 缩放。
- 选中对象后拖三色 gizmo = 按当前模式变换（拖 gizmo 时镜头不跟转）。
- 键盘：`V`/`R`/`S` 切移动/旋转/缩放，`Del` 删除选中。
- 底部工具坞「＋」加角色/几何模型，支持本地上传 `.glb`。

## 目录结构

```
src/
  main.js              入口：实例化各模块并串联
  app/App.js           应用状态机：entities[] / selectedId / 场景级状态 / 增删选改
  core/
    Stage.js           场景 / 渲染器 / 光照 / 地面 / world 组 / 渲染循环
    CameraRig.js       OrbitControls + 聚焦 + 取景比例 overlay + 重置视角
    Selection.js       Raycaster 选择 + 地面蓝环高亮
    TransformGizmo.js  TransformControls 封装（模式切换 / 与 Orbit 互斥 / 网格吸附 / 回调）
    NavGizmo.js        右上角 SVG 坐标指示器 + 重置视角
  entities/
    Entity.js          实体基类（baseScale）
    Character.js       角色：GLB 加载 / 素体着色 / 骨骼表 / restQ / 全身 FK / 预设动画 / 名牌
    Prop.js            道具：几何体 + 颜色
    jointConfig.js     全身多轴关节表（§6）
  ui/
    Dock.js            底部工具坞 + 添加菜单
    Outliner.js        左侧场景清单（机位 + 角色/道具）
    ScenePanel.js      右侧「3D场景」级属性（未选中时）
    Inspector.js       右侧「角色/道具」属性 + 姿势（选中时）
    PoseSliders.js     从 jointConfig 生成分组姿势滑条
    widgets.js         共享控件：滑条 / XYZ / 颜色 / 开关
  util/
    boneUtil.js        骨名归一化、骨骼表构建
    capture.js         按比例裁剪截图、隐藏辅助物
    dom.js             小型 DOM helper
  styles/style.css
public/assets/         Xbot.glb / Soldier.glb / Robot.glb
```

## 关于关节方向校准（§5.4）

`src/entities/jointConfig.js` 中各关节的 `axis` 与 `min/max` 取自技术规划 §6 的起始值
（与 Xbot 源 demo 同源、已基本可用）。各骨头本地轴方向不完全一致，若发现某关节方向
相反或耦合，按 §5.4 在浏览器里实测后翻转该项的 `min/max` 正负或更换 `axis` 即可，
无需改模型。左右成对动作通常镜像（正负相反）。

## 不在本版范围（§11）

截图「发送到画布」目前为占位（仅 `console.log`）；IK 拖拽、手指逐节、表情、姿势/场景
JSON 存取等为后续迭代。
