// 提示词（阶段 H 第 4 步）：系统提示 = 角色说明 + 坐标约定 + ops 词汇（opsText，自动生成）+ 词汇表（vocabText，自动生成）
// + 3 个范例（生成 / 修改 / 识图）+ 输出格式；用户消息 = 模式 + 当前场景摘要 + 用户输入（+ 图片）。
// 范例本身也过 validateOps（tests/aiOps.test.mjs），改了词汇表范例跟不上会单测失败。
import { opsText, MODE_LABEL, IMAGE_OPS, LIMITS } from './ops.js';
import { vocabText, DEFAULT_POSE } from './vocab.js';
import { DEFAULT_TIMELINE } from '../doc/schema.js';

/** 范例：mode / 场景名字表（校验用）/ 场景摘要 / 用户输入 / 期望输出。 */
export const EXAMPLES = [
  {
    mode: 'generate',
    scene: [],
    summary: '实体：（空场景）',
    input: '黄昏的广场，一个女孩坐在长椅上，一个男孩站在她面前叉腰说话，镜头从正面慢慢半环绕到侧面，6 秒',
    output: {
      ops: [
        { op: 'clear' },
        { op: 'scene', sky: '#c98a5e', ground: { visible: true, height: 0 } },
        { op: 'add_prop', name: '长椅', kind: 'box', pos: [0, 0, 0], scale: [2, 0.55, 0.6] },
        { op: 'add_character', name: '小美', body: 'female', pos: [0, 0, 0.35], yaw: 0, pose: 'sit' },
        { op: 'add_character', name: '阿杰', body: 'male', pos: [0.2, 0, 1.6], yaw: 180, pose: 'akimbo' },
        { op: 'add_camera', name: '机位1', pos: [0, 1.4, 4], lookAt: '小美' },
        { op: 'camera_move', target: '机位1', preset: 'half_orbit', subject: '小美', sweep: 90, dir: 'ccw', duration: 6 },
        { op: 'timeline', duration: 6, mainCamera: '机位1' },
      ],
      note: '建了长椅、坐着的小美和面对她叉腰的阿杰，机位1 从正面绕 90° 到侧面，6 秒',
    },
  },
  {
    mode: 'modify',
    scene: [
      { name: '长椅', type: 'prop' }, { name: '小美', type: 'character' },
      { name: '阿杰', type: 'character' }, { name: '机位1', type: 'camera' },
    ],
    summary: [
      '时间轴：6 s · 30 fps · 主机位 机位1',
      '- 长椅 · 道具 box · pos (0, 0, 0) · yaw 0 · scale (2, 0.55, 0.6)',
      '- 小美 · 角色 female · pos (0, 0, 0.35) · yaw 0 · 姿势 sit',
      '- 阿杰 · 角色 male · pos (0.2, 0, 1.6) · yaw 180 · 姿势 akimbo',
      '- 机位1 · 机位 · pos (0, 1.4, 4) · 对准 (0, 0.81, 0.35) · fov 40 · 路径 … · 注视 小美 0–全程',
    ].join('\n'),
    input: '阿杰别叉腰了，从右边走过来再停到小美旁边；镜头改成慢慢推近',
    output: {
      ops: [
        { op: 'set_pose', target: '阿杰', preset: DEFAULT_POSE },
        { op: 'move', target: '阿杰', pos: [3, 0, 1.6], yaw: -90 },
        { op: 'set_path', target: '阿杰', path: { kind: 'toward', target: '小美', stop: 0.8 } },
        { op: 'clear_moves', target: '机位1' },
        { op: 'camera_move', target: '机位1', preset: 'push_in', subject: '小美', duration: 4 },
      ],
      note: '阿杰改为站立，从右侧走到小美旁 0.8 m 处；机位1 改为推近小美',
    },
  },
  {
    mode: 'image',
    scene: [],
    summary: '实体：（空场景）',
    input: '[图片] 照着图里的站位摆：三个人站成一排，左边一个人侧身对着中间的人',
    output: {
      ops: [
        { op: 'clear' },
        { op: 'add_character', name: '人物1', body: 'male', pos: [-1.5, 0, 0], yaw: 90 },
        { op: 'add_character', name: '人物2', body: 'female', pos: [0, 0, 0], yaw: 0 },
        { op: 'add_character', name: '人物3', body: 'male', pos: [1.5, 0, 0], yaw: 0 },
        { op: 'add_camera', name: '机位1', pos: [0, 1.4, 3], lookAt: '人物2' },
      ],
      note: '按图摆了 3 个人（左侧的人转向中间），机位在正前方 3 m、高 1.4 m',
    },
  },
];

/** 系统提示。 */
export function systemPrompt() {
  const ex = EXAMPLES.map((e, i) => [
    `### 范例 ${i + 1}：${MODE_LABEL[e.mode]}`,
    `当前场景：\n${e.summary}`,
    `用户：${e.input}`,
    `输出：${JSON.stringify(e.output)}`,
  ].join('\n')).join('\n\n');
  return `你是「3D 导演台」的场景编排助手。用户用中文描述场景和镜头，你输出一列高层操作（ops）来创建或修改场景，供后续 AI 视频生成做参考（要的是位置、姿势、机位、时序准确）。
只输出一个 JSON 对象：{"ops":[...], "note":"一句话说明你做了什么"}。不要输出其它任何文字。

## 坐标约定
- 单位米，Y 轴向上，地面 y = 0。角色 / 组 / 道具的 pos.y = 0 表示放在地面上（坐姿等由系统自动贴地）。
- yaw = 绕 Y 轴的朝向（度）：yaw = 0 时角色面朝 +Z，yaw = 90 面朝 +X，yaw = 180 面朝 −Z，yaw = −90 面朝 −X。
  两人面对面：A 在 (−0.8, 0, 0) yaw 90，B 在 (0.8, 0, 0) yaw −90。
- 机位用 lookAt 指定对准哪里（写实体名 = 对准它的注视点，角色是半身高处）。默认机位高 1.4 m、离主体约 3 m；
  要拍 yaw = 0 的角色正脸，机位放在它的 +Z 方向。
- 坐标各分量绝对值 ≤ ${LIMITS.pos}；时长 ≤ ${LIMITS.duration} 秒；默认时间轴 ${DEFAULT_TIMELINE.duration} 秒 ${DEFAULT_TIMELINE.fps} fps。

## 规则
- 实体一律按名字引用；新建时起简短的中文名（场景内唯一；重名会被自动加数字后缀）。
- 只能用下面列出的操作和词汇，不认识的词会被拒绝。
- 生成新场景：第一条 clear，再建实体、路径、运镜，最后 timeline 设时长与主机位。
- 修改当前场景：只输出需要改动的操作（补丁），不要重建场景；没提到的实体不要动。
- 识图导入：只允许 ${IMAGE_OPS.join(' / ')}；只写人数、站位、朝向和机位方向（机位高 1.4 m、离主体约 3 m），不写姿势。
- 角色沿路径移动时会自动切换走 / 跑步态，不需要把姿势设成行走。路径从实体当前位置出发。
- 有路径的实体不能再打位置关键帧；组成员不能单独移动或画路径（对组操作）。
- camera_move 会生成机位路径并注视主体；先推再环绕就写两条，第二条加 append: true。
- 输出被拒绝时会收到错误列表（带 ops[i].字段 定位），请按错误修正后重新输出完整的 ops。

## 操作（ops）
${opsText()}

## 词汇表
${vocabText()}

## 范例
${ex}`;
}

/**
 * 用户消息：模式 + 当前场景摘要 + 用户输入（+ 图片 data URL）。
 * @param {{mode:string, summary:string, input:string, image?:string|null}} o
 */
export function userMessage({ mode, summary, input, image = null }) {
  const text = `模式：${MODE_LABEL[mode]}\n当前场景：\n${summary}\n\n用户：${input}`;
  if (!image) return { role: 'user', content: text };
  return { role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: image } }] };
}

/** 校验失败后的追问：错误原文逐条列出。 */
export function retryMessage(errors) {
  return {
    role: 'user',
    content: `上面的输出没有通过校验，场景没有任何改动。请修正以下错误后重新输出完整 ops（整批，不只是出错的那几条）：\n${errors.map((e) => `- ${e}`).join('\n')}`,
  };
}
