// 单一冒烟套件，每次最多五分钟；子进程退出码原样传播。
import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['selftest.mjs'], { stdio: 'inherit', env: process.env });
const timer = setTimeout(() => child.kill('SIGTERM'), 300000);
process.on('SIGTERM', () => child.kill('SIGTERM'));
child.on('error', error => { console.error(error); clearTimeout(timer); process.exitCode = 1; });
child.on('exit', code => { clearTimeout(timer); process.exitCode = code ?? 1; });
