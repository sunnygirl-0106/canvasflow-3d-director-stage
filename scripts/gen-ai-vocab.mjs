// 把 AI 词汇表（ops + 词汇，由代码生成）写进 开发参考「AI 生成」章节的标记块里：npm run docs:ai
// 校验器 / 提示词 / 开发参考 三处同一来源；tests/aiApply.test.mjs 断言 开发参考 里的块与生成结果一致。
import fs from 'node:fs';
import { aiVocabMarkdown, README_MARKERS } from '../src/ai/prompt.js';

const file = new URL('../docs/开发参考.md', import.meta.url);
const text = fs.readFileSync(file, 'utf8');
const [start, end] = README_MARKERS;
const i = text.indexOf(start), j = text.indexOf(end);
if (i < 0 || j < i) throw new Error(`开发参考 里找不到标记 ${start} … ${end}`);
fs.writeFileSync(file, text.slice(0, i + start.length) + '\n' + aiVocabMarkdown() + '\n' + text.slice(j));
console.log('开发参考 AI 词汇表已更新');
