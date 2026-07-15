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

- **多角色素体** — 一键添加 标准 / 高大 / 矮小 / 宽厚 / 纤细 五种体型，自动归一化身高并落地；支持本地上传 `.glb`。
- **全身姿势** — 右侧「姿势」面板按关节分组的 FK 滑条实时驱动骨骼；内置行走、挥手、抱臂等姿势预设一键套用。
- **群众阵列** — 行×列网格批量生成群众，可整组平移/旋转，也可随时解组为独立角色。
- **几何道具** — 方块 / 圆柱 / 球体 / 人体素模，颜色与尺寸可调。
- **机位系统** — 相机作为一等实体，支持景别预设与对准主体；**机位视角（POV）** 下透过镜头实时取景，并可直接选中、平移、旋转画面里的角色与道具。
- **取景与截图** — 多比例取景框（21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 自由），所见即所得裁剪导出 PNG（不含辅助 gizmo），截图带历史管理。
- **全景背景** — 载入 2:1 等距柱状全景图作为环境，或自定义天空颜色。
- **场景编排** — 左侧清单支持搜索、显隐、改名、多选，以及打组 / 副本 / 批量删除等右键操作。

## 🚀 快速开始

```bash
npm install
npm run dev          # 打开终端给出的 http://localhost:5173

npm run build        # 生产构建 → dist/
npm run preview      # 本地预览构建产物
```

## ⌨️ 操作

| 操作 | 效果 |
| --- | --- |
| 空白处拖动 | 环绕视角 |
| 滚轮 | 缩放 |
| 拖动三色 gizmo | 按当前模式变换选中对象 |
| `V` / `R` / `S` | 切换 移动 / 旋转 / 缩放 |
| `Del` / `Backspace` | 删除选中对象 |
| 底部工具坞 `＋` | 添加角色 / 几何道具 / 本地上传 |

## 🗂️ 项目结构

```
src/
├─ main.js              入口：实例化并串联各模块
├─ app/
│  ├─ App.js            应用状态机：实体清单 / 选择 / 场景状态 / 增删选改
│  └─ ShotManager.js    截图数据与操作
├─ core/
│  ├─ Stage.js          场景 / 渲染器 / 光照 / 地面 / 渲染循环
│  ├─ CameraRig.js      OrbitControls + 聚焦 + 取景框 + 重置视角
│  ├─ Selection.js      Raycaster 拾取 + 地面选中环
│  ├─ TransformGizmo.js TransformControls 封装（模式切换 / 与环绕互斥）
│  ├─ NavGizmo.js       右上角坐标指示器
│  └─ cameraPresets.js  机位景别预设
├─ entities/            Character / Prop / Camera / Crowd / 关节表 / 姿势预设
├─ ui/                  Dock / Outliner / Inspector / ScenePanel / 姿势滑条 / 弹层
├─ util/                截图 / 度量 / 骨骼 / 素材库 / DOM helper
└─ styles/style.css
public/assets/          Xbot.glb（中性素体，所有体型由其程序化派生）
```

## 🛠️ 技术栈

- [three.js](https://threejs.org/) r160 — 渲染、`GLTFLoader`、`OrbitControls`、`TransformControls`
- [Vite](https://vitejs.dev/) 5 — 开发服务与构建
- 原生 ES Module + Vanilla JS，无前端框架依赖

## 📦 部署

推送到 `main` 分支后由 GitHub Actions 自动构建并发布到 GitHub Pages（见 `.github/workflows/deploy.yml`）。
