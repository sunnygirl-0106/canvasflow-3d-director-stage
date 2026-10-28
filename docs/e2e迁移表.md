# e2e 功能迁移表

来源：基线提交 `f7a75db` 中的六个历史轮次套件，原位置使用该提交的行号。94 条 `ok` 调用逐条迁移，循环及判断条件原样保留；没有合并或删除断言。

| 原位置 | 目标功能套件 / 场景 | 断言描述 |
| --- | --- | --- |
| round2.mjs:18 | editor-ui / checkResponsiveLayout | \`${width}×${height} 工具组居中且无重叠，视口顶部为0\` |
| round2.mjs:24 | editor-ui / checkResponsiveLayout | 1920 基准主要边界和工具胶囊位置误差≤2 CSS px |
| round2.mjs:29 | editor-ui / checkResponsiveLayout | 默认仅移动/截图/时间轴；AI单行空输入禁发送；无空位置子行 |
| round2.mjs:32 | editor-ui / checkResponsiveLayout | \`${selector} 菜单可见且锚点在屏幕内\` |
| round2.mjs:45 | ai / checkConversationInput | 草稿跨展开保留，中文组合态Enter不发送，输入不触发舞台快捷键 |
| round2.mjs:56 | ai / checkConversationInput | 生成中发送变取消且输入禁用 |
| round2.mjs:59 | ai / checkConversationInput | 取消生成不改场景 |
| round2.mjs:62 | ai / checkConversationInput | 失败保留草稿并提供重试 |
| round2.mjs:77 | director / checkPreviewLayout | \`${name} 播放前后所有布局边界完全一致、同时间同机位投影不变\` |
| round2.mjs:78 | director / checkPreviewLayout | \`${name} 全视口无框/遮罩/留边，地面网格不变\` |
| round2.mjs:80 | director / checkPreviewLayout | \`${name} 播放名牌位置和字号变化≤2px\` |
| round2.mjs:84 | director / checkPreviewLayout | \`${name} 暂停后resize仍铺满视口\` |
| round2.mjs:87 | director / checkPreviewLayout | \`${name} 退出恢复显式编辑取景框\` |
| round3.mjs:29 | editor-ui / checkInspectorTabs | \`${type} ${label} tab visible\` |
| round3.mjs:51 | ai / checkConversationHistory | 生成成功进入继续对话、成功卡片隐藏、导演视角 |
| round3.mjs:65 | ai / checkConversationHistory | \`${width}x${height} 双人 ${t}s 头脚与两侧不裁切\` |
| round3.mjs:76 | ai / checkConversationHistory | 退出继续对话保留草稿 |
| round3.mjs:99 | ai / checkConversationHistory | 继续对话默认修改，修改不改变导演视角 |
| round3.mjs:101 | ai / checkConversationHistory | 历史恢复失败不提前标记已撤销 |
| round3.mjs:112 | ai / checkConversationHistory | 历史当前轮撤销可达并恢复姿势 |
| round4.mjs:13 | tl / checkPathMenuState | 新鲜双人无路径、不自动播放、无控制点、时间轴零高度 |
| round4.mjs:18 | tl / checkPathMenuState | 三主行默认折叠，开合不改文档 |
| round4.mjs:20 | tl / checkPathMenuState | 菜单打开不启动工具、不改变选择 |
| round4.mjs:22 | tl / checkPathMenuState | 菜单取消文档逐字相同 |
| round4.mjs:26 | tl / checkPathMenuState | 播放中打开/取消菜单不暂停，导演页签保持且继续临时出画 |
| round4.mjs:33 | cam / checkFrustumProjection | 视锥延伸主体、同步FOV/aspect、不改变真实far或重建几何 |
| round4.mjs:35 | cam / checkFrustumProjection | 播放画面隐藏视锥 |
| round4.mjs:37 | cam / checkFrustumProjection | 暂停恢复导演视角及主机位视锥 |
| round4.mjs:45 | editor-ui / checkPresetAndImportNavigation | 托盘Space不启动播放 |
| round4.mjs:47 | editor-ui / checkPresetAndImportNavigation | 预制卡片只改变预览选择，保留草稿和场景且不请求模型 |
| round4.mjs:53 | editor-ui / checkPresetAndImportNavigation | 选中预制后显示明确的创建按钮与替换场景提示 |
| round4.mjs:58 | editor-ui / checkPresetAndImportNavigation | 取消预制保留当前文档和草稿 |
| round4.mjs:66 | editor-ui / checkPresetAndImportNavigation | 识图取消不污染草稿、模式、附件或场景 |
| round4.mjs:71 | editor-ui / checkPresetAndImportNavigation | 识图入口实际压缩附图、保持草稿、不自动请求 |
| round4.mjs:73 | editor-ui / checkPresetAndImportNavigation | 六项导航 |
| round4.mjs:81 | path / checkDrawingModes | \`${label}锁定点击行对象\` |
| round4.mjs:85 | path / checkDrawingModes | \`${label}完成\` |
| round4.mjs:93 | path / checkDrawingModes | \`${label}一步撤销、重做、保存往返\` |
| round4.mjs:96 | path / checkDrawingModes | 路径导入导出保留 |
| round5.mjs:25 | defaultview / checkFramingAcrossRatios | 默认角色A/B；主机位固定参数 |
| round5.mjs:49 | defaultview / checkFramingAcrossRatios | \`${width}×${height} ${ratio} 统一构图、人物完整、时间轴开合不跳位\` |
| round5.mjs:57 | editor-ui / checkAssetNavigation | 真实角色列表7项 |
| round5.mjs:64 | editor-ui / checkAssetNavigation | 添加C/D，保存恢复保留自定义名且继续递增 |
| round5.mjs:66 | editor-ui / checkAssetNavigation | 15机位卡片 |
| round5.mjs:68 | editor-ui / checkAssetNavigation | 机位卡片实际创建 |
| round5.mjs:70 | editor-ui / checkAssetNavigation | 全景仅真实上传与历史入口 |
| round5.mjs:72 | editor-ui / checkAssetNavigation | 画幅7项及自适应文案 |
| round5.mjs:75 | editor-ui / checkAssetNavigation | 画幅使用真实文档数据，撤销同步边框 |
| round5.mjs:77 | editor-ui / checkAssetNavigation | Esc回场景并返回导航焦点 |
| round5.mjs:84 | tl / checkKeyControls | 无动画也有位置/旋转/缩放三行，不创建空轨道 |
| round5.mjs:86 | tl / checkKeyControls | 空心创建首键并实心，一次撤销 |
| round5.mjs:88 | tl / checkKeyControls | 实心删除原始时刻的键 |
| round5.mjs:96 | tl / checkKeyControls | 同帧导入键选最近者，删除保留精确相邻时间 |
| round5.mjs:107 | motion / checkMotionFields | 运动轨迹页恰好六字段、Y朝向锁定 |
| round5.mjs:116 | motion / checkMotionFields | 路径插点保持高度/停顿/时长、不建pos轨道，选中并实心，一次撤销 |
| round5.mjs:118 | motion / checkMotionFields | 一步撤销恢复原路径 |
| round5.mjs:122 | motion / checkMotionFields | 位置字段平移整条轨迹和基准，形状/时序保留 |
| round5.mjs:127 | motion / checkMotionFields | 关闭沿路径朝向保持可见姿态 |
| round5.mjs:129 | motion / checkMotionFields | 统一缩放即时同步XYZ且不改变路径长度 |
| round5.mjs:131 | motion / checkMotionFields | 时长夹取剩余场景范围，不重置start或延长场景 |
| round5.mjs:134 | motion / checkMotionFields | 六字段编辑后保存恢复一致 |
| round5.mjs:143 | motion / checkMotionFields | 播放tick不重建时间轴DOM |
| round5.mjs:145 | editor-ui / checkFullscreenNavigation | 正常功能图标统一亮白 |
| round5.mjs:149 | editor-ui / checkFullscreenNavigation | 全屏内侧栏和弹层可见 |
| revision5.mjs:20 | director / checkIndependentDirectorView | 首帧到ready后均无可见/可拾取变换手柄 |
| revision5.mjs:22 | director / checkIndependentDirectorView | 默认导演视角显示机身、标签、视锥和导航 |
| revision5.mjs:39 | director / checkIndependentDirectorView | \`${width}×${height} ${ratio} 导演与机位独立、切换/时间轴不跳动且辅助元素恢复\` |
| revision5.mjs:55 | director / checkIndependentDirectorView | 机位位置/朝向/FOV修改不覆盖独立导演视角 |
| revision5.mjs:63 | director / checkIndependentDirectorView | 真实环绕不写机位；后续机位编辑不覆盖观察视角 |
| revision5.mjs:65 | director / checkIndependentDirectorView | reset恢复导演home，保留机位编辑 |
| revision5.mjs:73 | director / checkIndependentDirectorView | 独立导演视角完整保存恢复；旧字段缺失40；机位不改写；home带FOV |
| revision5.mjs:76 | director / checkIndependentDirectorView | 恢复/截图结束/播放停止/resize不重新激活首屏手柄 |
| revision5.mjs:81 | director / checkIndependentDirectorView | 明确选择后真实拖动并一步撤销 |
| revision5.mjs:83 | director / checkIndependentDirectorView | 取消选择同步禁用隐藏手柄 |
| revision5.mjs:99 | path / checkDrawingDuration | \`${length}m / ${total}s场景：0～10秒、终点正确、一步撤销总长\` |
| revision5.mjs:114 | path / checkDrawingDuration | \`${type} ${mode}真实重绘为10秒\` |
| revision5.mjs:126 | path / checkDrawingDuration | 群众/道具10秒；旧5.1秒插点/移动/载入保持；显式6秒保持 |
| revision5.mjs:134 | path / checkDrawingDuration | 1m短路径离线导出与逐帧跳转一致，第10秒抵达终点 |
| polish.mjs:47 | tl / checkTimelineResize | \`${result.mode}：时间轴增高/缩小/折叠，画布像素、投影、机位和文档均不变\` |
| polish.mjs:52 | tl / checkTimelineResize | 无轨迹仅保留弱文字提示，不生成整行持续色条 |
| polish.mjs:60 | tl / checkTimelineResize | 上沿悬浮显示握柄与上下拖动光标 |
| polish.mjs:64 | tl / checkTimelineResize | 真实向上拖动增高 100px，结束后释放拖动态 |
| polish.mjs:68 | tl / checkTimelineResize | 向下拖动保留最小可用高度 |
| polish.mjs:72 | tl / checkTimelineResize | 向上拖动有上限，舞台仍保留可用空间 |
| polish.mjs:78 | tl / checkTimelineResize | 键盘可调高度，Home / End 不会跳动播放头 |
| polish.mjs:81 | tl / checkTimelineResize | 双击还原默认高度 |
| polish.mjs:85 | tl / checkTimelineResize | 折叠后恢复自定高度，所有尺寸操作不改场景或撤销栈 |
| polish.mjs:90 | tl / checkTimelineResize | 刷新后再次展开记住时间轴高度 |
| polish.mjs:92 | editor-ui / checkPresetCapsuleLayout | 预制入口只占一个图标位，侧栏不再有独立入口 |
| polish.mjs:95 | editor-ui / checkPresetCapsuleLayout | 预制入口悬浮显示提示，按钮和空输入框不扩高或挤换行 |
| polish.mjs:104 | editor-ui / checkPresetCapsuleLayout | 入口打开 8 个场景并更新展开状态 |
| polish.mjs:108 | editor-ui / checkPresetCapsuleLayout | 选择预制只更新预览，不触发生成、不改草稿或场景 |
| polish.mjs:118 | editor-ui / checkPresetCapsuleLayout | \`${width}×${height} 工具坞及胶囊完整显示\` |
| polish.mjs:130 | editor-ui / checkPresetCapsuleLayout | 高像素密度下仍保持单行，不发生截图中的胶囊撑高 |

## 单测迁移

| 原文件 | 目标文件 | 测试 |
| --- | --- | --- |
| round4.test.mjs | pathGen.test.mjs | rectangle uses exact edges, closure, unequal lengths and correct insertion indices |
| round4.test.mjs | pathGen.test.mjs | polyline validates and survives JSON; legacy curves unchanged; redraw clears interpolation |
| round4.test.mjs | pathGen.test.mjs | circle is full 360 degrees and closes without duplicate endpoint |
| round4.test.mjs | cameraConstraints.test.mjs | frustum tracks true projection, world transform and finite depth without touching far |
| round4.test.mjs | pathPicking.test.mjs | rectangle drawing plane preserves camera height under translated, rotated and scaled world |
| round4.test.mjs | presets.test.mjs | fallback fixture contains two separate 10-second paths starting at the actors |
| round5.test.mjs | timelinePanel.test.mjs | UI frame hit preserves imported precision, nearest match and deterministic ties |
| round5.test.mjs | timelinePanel.test.mjs | key command pauses at captured time, rejects driven properties without empty tracks |
| round5.test.mjs | timeline.test.mjs | translation moves path and base in the same local document space, preserves times and stops |
| round5.test.mjs | timeline.test.mjs | orientation handoff uses existing rotation track and keeps current quaternion |
| round5.test.mjs | pathPicking.test.mjs | insert sampled height, shift stop indices, preserve timing; prevent seam/duplicate/zero-length insertion |
| round5.test.mjs | pathPicking.test.mjs | 时间轴可对视口尚未显示的路径插点，保留原路径时间和高度 |
| round5.test.mjs | pathTiming.test.mjs | 20% faster defaults only affect new character paths; saved timing and camera pace remain unchanged |

## 覆盖核对

- e2e：543 → 543 条 `ok` 调用，表达式逐条匹配。
- 单测：883 → 883 条 `assert` 调用，表达式逐条匹配；测试用例仍为 257 个。
- REQUIRED：原有 334 条调用全部保留，重组后覆盖 417 条；路径套件加入 REQUIRED，承接原 revision5 的必跑行为。
- CI 使用统一的 REQUIRED / SUITES 登记表，无硬编码的历史套件名，无需修改工作流。
- 无引用的一次性工具已删除：`scripts/round3-compare.mjs`、`e2e/tools/round5-review.mjs`、`e2e/tools/round5-walk.mjs`。
