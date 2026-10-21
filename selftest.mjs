// 端到端自测入口：headless Chrome 驱动真实 dev server。实现在 e2e/（harness 环境 / helpers 共用操作 / suites 各套件 / tools 开发工具）。
// 运行：npm run test:e2e
//   - 默认自动起一个 Vite dev server；也可用 TEST_URL=http://localhost:5173/ 指向已有服务
//   - Chrome 路径：CHROME_PATH 环境变量，缺省时依次找 macOS / Linux 常见安装位置
// 子命令：
//   node selftest.mjs poses [outDir] [bodyKey]
//     对单个角色逐个套用全部姿势预设并截图到 outDir/<preset>.png（默认 test-output/poses，
//     bodyKey 默认 xbot；不存在时取 BODY_TYPES 第一项）。用于重构前后逐像素对比。
//   node selftest.mjs [default]
//     默认套件：核心功能 + 已修复问题的回归。
//   node selftest.mjs posediff <dirA> <dirB> [maxRatio]
//     逐张像素对比两组截图（pixelmatch），差异像素占比 > maxRatio（默认 0.001）判失败，
//     差异图写到 dirB/_diff/。不起浏览器。
//   node selftest.mjs calib [profileId ...]
//     对校准页 calib.html?profile=<id> 整页截图到 test-output/calib_<id>.png（默认全部档案）。
//   node selftest.mjs collide [preset,...]
//     对三个档案逐个预设 + 步态（走 / 跑各 8 相位，可用 gait 指代）做穿模检测（src/dev/poseCollision.js），
//     列出穿模部位与最大深度；有穿模则退出码 1。
//   node selftest.mjs doc
//     场景文档验收：搭场景 → 截图 A → toDocument → 清空 → loadDocument → 截图 B → toDocument，
//     断言两份文档深度相等、两图像素差 < 0.5%；5 种坏文档被定位并拒绝；撤销/重做画面一致。产物在 test-output/doc/。
//   node selftest.mjs anim
//     动画内核验收（阶段 C）：纯函数 / 跳转一致 / 手动值保持 / 导出不污染 / 往返 / 撤销 / 步态 / 约束 / 坏文档。
//     产物在 test-output/anim/。
//   node selftest.mjs tl
//     时间轴面板验收（阶段 D）：puppeteer 真实点击 / 拖拽 —— 从零打键做动画、自动打键、菱形状态、拖键 + 撤销、
//     区间条、约束段、播放 / 停止、快捷键、性能、折叠。产物在 test-output/tl/。
//   node selftest.mjs path
//     角色路径验收（阶段 E）：puppeteer 真实点击 / 拖拽 —— 五种绘制、起点不跳、顶点拖动 / Esc / ⇧平移、插入 / 删除、
//     pos 轨道冲突、绘制态不转相机、可视化、播放、往返。产物在 test-output/path/。
//   node selftest.mjs cam
//     机位运镜验收（阶段 F）：Inspector 运镜段真实操作 —— 半环绕盯人 / 推拉 / 横移升降 / 摇、清除、追加 + 段列表 + 删末段 + ⌘Z、
//     机位画路径、主机位播放（视口 ≡ 主机位 snapshot）、含运镜文档往返。产物在 test-output/cam/。
//   node selftest.mjs export
//     导出视频验收（阶段 G）：精灵名牌进画面 / 位置一致、离屏帧 ≡ snapshot、两次导出逐帧 md5 相同且播放头 / 文档 / 撤销不变、
//     分辨率与比例、MP4 文件（ffprobe 或 mp4 盒子解析）、取消、不支持的浏览器、导出帧干净。产物在 test-output/export/。
//   node selftest.mjs ai
//     AI 生成验收（阶段 H，全部 MockProvider、不依赖网络）：一句话生成 / 校验回路（错误原文喂回）/ 三次失败场景不变 /
//     修改模式 + ⌘Z / 重名改名 / 识图（合成站位图）与越权拒绝 / 词汇表一致 / 设置只存本机。产物在 test-output/ai/。
//   node selftest.mjs all
//     依次跑默认套件与上面全部验收套件（各起一个子进程），任一失败退出码 1。
import { execFileSync } from 'node:child_process';

const [CMD = 'default', ...ARGS] = process.argv.slice(2);
const SUITES = ['default', 'doc', 'anim', 'tl', 'path', 'cam', 'export', 'ai', 'store'];

if (CMD === 'posediff') {
  const { poseDiff } = await import('./e2e/posediff.mjs');
  process.exit(poseDiff(ARGS[0], ARGS[1], parseFloat(ARGS[2] ?? '0.001')));
}

// all：逐个套件各起一个子进程（套件之间不共享页面状态），汇总退出码
if (CMD === 'all') {
  let bad = 0;
  for (const suite of SUITES) {
    console.log(`\n##### ${suite} #####`);
    try { execFileSync(process.execPath, [process.argv[1], suite], { stdio: 'inherit' }); }
    catch { bad++; console.log(`##### ${suite} 失败 #####`); }
  }
  console.log(`\n##### all：${bad ? bad + ' 个套件失败' : '全部通过'} #####`);
  process.exit(bad ? 1 : 0);
}

const TOOLS = ['calib', 'collide', 'poses'];
if (!SUITES.includes(CMD) && !TOOLS.includes(CMD)) {
  console.error(`未知子命令：${CMD}（可用：${[...SUITES, ...TOOLS, 'posediff', 'all'].join(' / ')}）`);
  process.exit(2);
}

const h = await import('./e2e/harness.mjs');
if (CMD === 'calib') await h.close(await (await import('./e2e/tools.mjs')).calib(ARGS));
if (CMD === 'collide') await h.close(await (await import('./e2e/tools.mjs')).collide(ARGS[0]));

await h.openApp();
if (CMD === 'poses') {
  await (await import('./e2e/tools.mjs')).shootPoses(ARGS[0] || 'test-output/poses', ARGS[1]);
  await h.close(h.errs.length ? 1 : 0);
}
await (await import(`./e2e/suites/${CMD}.mjs`)).run();
await h.finish();
