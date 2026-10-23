import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const base = process.env.BASE_REF;
if (!base || /^0+$/.test(base)) {
  console.log('未提供基线修订；姿势跨版本比较未运行（不计作通过）');
  process.exit(0);
}
// 拒绝选项注入；只接受 GitHub 事件中的完整提交 SHA。
if (!/^[a-f0-9]{40}$/i.test(base)) throw new Error('BASE_REF 必须是完整提交 SHA');
const changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' }).trim().split('\n');
const relevant = /^(public\/assets\/.*\.glb|src\/(rig\/|entities\/(Character|pose)|anim\/Locomotion|config\.js))/;
if (!changed.some((file) => relevant.test(file))) { console.log('无模型/姿势改动，跳过跨版本姿势比较'); process.exit(0); }
const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'director-pose-'));
const out = path.resolve('test-output/pose-regression');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(`${out}/revisions.json`, JSON.stringify({ base, head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), changed }, null, 2));
const run = (file, args, cwd = process.cwd()) => execFileSync(file, args, { cwd, stdio: 'inherit', timeout: 900000 });
try {
  run('git', ['worktree', 'add', '--detach', worktree, base]);
  run('npm', ['ci', '--no-audit', '--no-fund'], worktree);
  // 两个版本使用同一截图条件；只替换测试驱动，模型与业务代码仍来自各自提交。
  fs.copyFileSync('e2e/tools.mjs', path.join(worktree, 'e2e/tools.mjs'));
  for (const body of ['xbot', 'male', 'female', 'tall', 'small', 'broad', 'slim']) {
    run(process.execPath, ['selftest.mjs', 'poses', `${out}/base/${body}`, body], worktree);
    run(process.execPath, ['selftest.mjs', 'poses', `${out}/current/${body}`, body]);
    run(process.execPath, ['selftest.mjs', 'posediff', `${out}/base/${body}`, `${out}/current/${body}`]);
  }
} finally {
  run('git', ['worktree', 'remove', '--force', worktree]);
}
