# 任务说明 · 阶段 H · AI 生成：一句话生成场景、对话式修改、识图导入站位

> 读者：Claude Code 执行者。先读《交接文档_导演台重构.md》2（铁律）、4.4、6 节和 README「动画 API」「运镜词汇表」，再读本文。
> 分支：阶段 G 合入主线后从主线开 `feat/ai-ops`。
> 新增目录 `src/ai/`。不改 `src/anim/`、`src/doc/schema.js` 的文档形状；可以**读**它们导出的词汇表。

## 1. 背景

前面七个阶段把"场景即数据"做实了：一份 JSON 描述一切，所有操作都是对它的修改。阶段 H 让 AI 成为另一个操作者。竞品 liblib 的三个能力：一句话生成整场景（含编组、路径、半环绕运镜、天空）、对话式修改、识图导入站位。

关键设计判断：**不让模型直接写场景文档**。文档太底层（随机 id、相对组轴心的坐标、28 个关节角、生成器参数不进文档）。模型写的是一列**高层操作（ops）**——"加一个男性角色叫小王站在 (1,0,2) 面朝 −Z 做 wave"、"给机位1 应用 half_orbit 盯着小王"。这正是阶段 C–F 一直在积累的稳定词汇表。生成新场景 = 清空 + 一列 ops；修改 = 对当前场景的一列 ops；识图 = 只允许一小部分 ops。三种能力一套管道。

## 2. 要解决的问题

1. ops 的定义：够表达竞品能做的事，又小到模型不会写错。
2. 模型拿到什么上下文：词汇表（必须从代码自动生成，不手抄）、当前场景摘要、范例。
3. 校验回路：ops 自身校验 → 编译成文档操作 → 现有校验器；失败把错误喂回模型重试，上限 2 次；全部失败则场景不变。
4. 调用哪个模型：纯前端，密钥放本地；要能换接口；测试不能依赖网络。
5. 撤销：一次 AI 应用 = 一步撤销。

## 3. 目标架构

### 3.1 ops 词汇表（`src/ai/ops.js`，带手写校验器，错误带路径如 `ops[2].preset 未知运镜 "orbit"，可选 push_in/…`）

实体一律按**名字**引用（场景内名字唯一，已有计数器保证；AI 新建时给名字，重名自动加后缀并在回执里告知）。坐标是文档口径（米、角色 y=0 落地、旋转为度）。

```
{ op:'clear' }                                                   // 只在"生成新场景"模式允许，必须是第一条
{ op:'scene', sky?, ground?:{visible,height}, ratio?, panorama?:'none' }      // 全景一期不让 AI 选图，只能清除
{ op:'add_character', name, body, pos, yaw?, pose?:preset, color? }           // body ∈ BODY_TYPES；pose ∈ 姿势预设名（默认 stand）
{ op:'add_prop', name, kind, pos, yaw?, scale?, color? }                      // kind ∈ PROP_KINDS
{ op:'add_camera', name, pos, lookAt:[x,y,z] | name, fov? }
{ op:'add_group', name, members:[names] }                                     // 已存在的角色打组
{ op:'add_crowd', name, rows, cols, spacing?, pos, yaw?, body? }              // 群众
{ op:'remove', target }
{ op:'move', target, pos?, yaw?, scale? }                                     // 改手动值
{ op:'set_pose', target, preset }
{ op:'set_path', target, path, start?, duration?, speed?, orient? }
      path = { kind:'points', points } | { kind:'line', to:[x,y,z]|name } | { kind:'arc', center:[x,y,z]|name, sweep?, dir? } | { kind:'toward', target:name, stop? }
{ op:'clear_path', target }
{ op:'camera_move', target, preset, subject?:name|[x,y,z], amount?, dir?, sweep?, duration?, append?:bool }
{ op:'clear_moves', target }
{ op:'look_at', target(camera), subject, start?, end? }
{ op:'follow', target(camera), subject, offset?, start?, end? }
{ op:'keyframe', target, property, t, value, ease? }                          // 低频，留给精细修改
{ op:'timeline', duration?, fps?, mainCamera?:name }
```
- 词汇来源**只能是代码**：`BODY_TYPES`、`PROP_KINDS`、`POSE_PRESET_MAP` 的 key、`cameraMoves` 的预设名、`pathGen` 的 kind、ease / speed / orient 枚举。`src/ai/vocab.js` 从这些导出生成一份带中文解释的表，提示词和校验器都用它；手抄一个词都算错。
- 识图模式只允许：`clear / scene / add_character / add_prop / add_camera / move`，且 `pose` 固定 stand。

### 3.2 编译与应用（`src/ai/apply.js`）

`applyOps(app, ops, { mode })`：
1. `validateOps(ops, sceneSummary)`：结构、枚举、名字引用（引用的名字必须存在于当前场景或本批前面的 op 里）、数值范围（pos 各分量 |v| ≤ 50、duration ∈ (0, 120]）。任何一条错 → 整批拒绝，返回错误列表。
2. 在**临时副本**上执行：`doc = app.toDocument()` → 对 doc 逐条应用（新建实体用现有 `fromJSON` 路径、路径用 `pathGen`、运镜用 `cameraMoves` + `appendMove`、约束直接写入）→ `validate(doc)`（现有校验器）→ 失败返回错误。
3. 全部通过才 `app.loadDocument(doc)`；History 记一步；返回回执 `{ applied: n, renames: {...}, warnings: [...] }`。
   - 为了能在 doc 上执行而不碰场景对象，需要把 `addCharacter / addCrowd / groupCharacters / 运镜应用` 里"算数据"的部分抽成能作用于 doc 的纯函数；界面上原来的入口改为调用同一份函数（不许复制两份逻辑）。这是本阶段最大的重构，放在第 2 步单独 commit。
4. 场景摘要 `summarize(app)`：给模型看的当前场景文本（每实体一行：名字、类型、体型/种类、pos、yaw、姿势、路径摘要、运镜摘要、约束；时间轴时长/主机位），控制在 2k token 内。

### 3.3 模型调用（`src/ai/provider.js`）

- `OpenAICompatProvider({ baseURL, apiKey, model })`：`POST /chat/completions`，`response_format: { type:'json_object' }`，支持图片（识图）走 `image_url` 的 data URL。设置存 `localStorage`（只在本机，README 写清）。
- `MockProvider(fixtures)`：按请求里的关键字返回预录 JSON；selftest 用它，**验收不依赖网络**。
- 提示词（`src/ai/prompt.js`）：系统提示 = 角色说明 + ops 词汇表（自动生成）+ 坐标约定（米、Y 上、角色面朝 −Z 时 yaw=0、机位默认高 1.4 m 距主体 3 m）+ 3 个范例（一句话生成 / 修改 / 识图各一）+ 输出格式 `{ "ops": [...], "note": "一句话说明" }`；用户消息 = 模式 + 当前场景摘要 + 用户输入（+ 图片）。
- 重试回路（`src/ai/agent.js`）：`run(input)`：调用 → 解析 JSON（容错去掉 ```json 围栏）→ `applyOps` → 失败则把错误列表（原文）作为下一轮用户消息"请修正以下错误后重新输出完整 ops"再调用，最多 2 次重试；都失败 → toast 前 3 条错误，场景不变。
- 每轮对话记录（用户输入、模型 note、应用结果）保存在会话态，不进文档。

### 3.4 界面（`src/ui/AiPanel.js`，右侧抽屉，Dock 加「AI」按钮）

- 输入框 + 模式：「生成新场景」（会先确认"将清空当前场景"）/「修改当前场景」（默认；场景为空时自动切生成）/「识图导入」（附图按钮，图片 ≤ 2 MB 压到 1024 px）。
- 对话流：每轮显示用户输入、模型 note、"已应用 n 项"或错误；每轮应用是一步撤销，面板上给「撤销这一轮」按钮（= history.undo）。
- 「设置」：baseURL / apiKey / model，「测试连接」。未配置时输入框提示去设置。
- 生成中锁住输入，显示"第 k 次尝试"。

## 4. 分步执行（每步一个 commit）

1. `vocab.js` + `ops.js`（校验器）+ 单元测试：合法 ops 全过；20 种错误各定位到字段；词汇表与代码一致性测试（枚举集合相等）。
2. **重构**：把新建角色 / 群众 / 打组 / 路径生成 / 运镜应用的"数据部分"抽成作用于 doc 的纯函数；界面入口改调它们；所有回归不变（这一步**不加**任何 AI 功能）。
3. `apply.js` + `summarize`：控制台可 `__app.ai.applyOps([...])`；失败场景不变；一步撤销。
4. `provider.js`（OpenAI 兼容 + Mock）+ `prompt.js` + `agent.js` 重试回路。
5. `AiPanel`：三种模式、对话流、设置、撤销这一轮。
6. 验收 + 文档：selftest `ai` 子命令（Mock）；README「AI 生成」章节（怎么配置、示例提示词、ops 词汇表、隐私说明）；交接文档 3 阶段表、4.8 AI 已定设计、5 代码地图、6 下一步（阶段 I / 收尾）、已知问题；本文件移到 `docs/done/`。

## 5. 验收标准（selftest `ai` 子命令，全部用 MockProvider，截图到 `test-output/ai/`）

1. **一句话生成**：输入"两个人在广场对话，一个女的站着挥手，一个男的坐着，一个机位半环绕拍他们，5 秒"，Mock 返回预录 ops（clear / scene / 2 角色 / 机位 / camera_move half_orbit）：应用后实体 3 个、姿势正确、机位有路径 + lookAt、timeline.duration=5；截图 t=2.5 有两人入画。
2. **校验回路**：Mock 第 1 次返回 `preset:'orbit'`（未知）+ `pos` 缺一个分量，第 2 次返回正确：最终应用成功；第 2 次请求的消息里包含两条错误原文（含 `ops[i].字段`）；场景在失败那次没有变化。
3. **三次失败**：Mock 永远返回坏 ops：toast 出现、`toDocument()` 与之前逐字节相等、History 长度不变。
4. **修改模式**：在验收 1 的场景上输入"让男的站起来走到女的旁边，机位改成推"→ Mock 返回 `set_pose / set_path toward / clear_moves + camera_move push_in`：路径终点距女角色 0.8 m、运镜为 push_in、其它实体未动；⌘Z 一次回到修改前。
5. **名字**：Mock 返回两个同名 `add_character`：第二个自动改名并出现在回执 `renames` 里；`remove` 一个不存在的名字 → 定位错误。
6. **识图**：传一张合成图（3 个色块代表站位），Mock 返回 3 个 `add_character` + 1 个 `add_camera`；识图模式下返回的 `set_path` 被拒绝（错误信息说明该模式不允许）。
7. **词汇表一致**：`vocab.js` 导出的集合 ≡ 代码里的枚举（姿势预设、体型、道具、运镜、路径 kind、ease/speed/orient）；提示词文本里包含每一个词。
8. **重构无回归**：第 2 步后 e2e / doc / anim / tl / path / cam / export / collide 全过（在第 2 步的 commit 里单独报告）。
9. **真实模型冒烟**（手动，不进自动验收）：用产品侧提供的 key 跑验收 1 和 4 的提示词各一次，附截图和模型原始输出到 `test-output/ai/real_*.json`；报告里写清模型名、成功次数、重试次数。
10. 产品侧手动验收截图：AI 抽屉三种模式、一次失败重试的对话流、设置面板。

## 6. 约束

- 不引入新依赖（`fetch` 直接调接口）。密钥只存 localStorage，不写进文档、不进日志、不进 selftest 产物。
- 模型只能输出 ops；任何"直接写场景文档"的捷径都不允许。
- 词汇表必须从代码生成；校验器、提示词、README 三处用同一来源。
- 第 2 步重构不得改变任何现有行为；它单独 commit、单独跑全部回归。
- 不做：流式输出、多轮规划（agent 自己拆步骤）、让 AI 调整关节角数值（只能用姿势预设）、让 AI 选全景图、语音输入。
- 说明没覆盖的决策：停下来列选项问。预计会碰到的：识图模式下机位怎么从图片推断（建议：只推断方向 + 默认高度 1.4 m / 距离 3 m）；`yaw` 的 0 度朝向约定是否与现有 `rot.y=0` 一致（以代码为准，写进提示词）。
