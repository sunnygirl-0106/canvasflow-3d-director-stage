import fs from 'node:fs';
import { page, ok } from '../harness.mjs';
import { settle } from '../helpers.mjs';

export async function run() {
  fs.mkdirSync('test-output/tooltips', { recursive: true });
  await page.hover('#dock > button:last-of-type');await settle(400);
  ok('时间轴悬停显示名称和动画用途', await page.$eval('#uiTooltip', n=>!n.hidden&&n.textContent.includes('时间轴')&&n.textContent.includes('关键帧')));
  await page.screenshot({path:'test-output/tooltips/timeline.png'});
  await page.keyboard.press('Escape');
  ok('Esc关闭tooltip', await page.$eval('#uiTooltip', n=>n.hidden));
  await page.focus('#scenePresets');await settle(40);
  ok('键盘聚焦显示预制场景说明，并关联读屏描述',await page.evaluate(()=>!document.querySelector('#uiTooltip').hidden&&document.activeElement.getAttribute('aria-describedby')==='uiTooltip'&&document.querySelector('#uiTooltip').textContent.includes('8 个场景')));
  await page.click('#scenePresets');await settle(80);
  ok('预制场景常驻入口直接展开原有8个场景',await page.evaluate(()=>!!document.querySelector('.ai-preset-tray')&&document.querySelectorAll('.ai-preset').length===8&&document.querySelectorAll('#dock > button').length===3));
  await page.screenshot({path:'test-output/tooltips/presets.png'});
  await page.hover('#sideRail button:first-child');await settle(400);
  ok('左侧屏幕边缘提示不越界',await page.$eval('#uiTooltip',n=>{const r=n.getBoundingClientRect();return !n.hidden&&r.left>=8&&r.right<=innerWidth-8&&r.top>=0;}));
  const missing=await page.evaluate(()=>[...document.querySelectorAll('button')].filter(n=>n.getBoundingClientRect().width&&(!n.textContent.trim()||/^[×‹›◇◆?＋－]+$/.test(n.textContent.trim()))&&!n.title&&!n.dataset.tooltip).map(n=>n.className));
  ok('当前可见图标按钮全部有操作提示',missing.length===0,JSON.stringify(missing));
  await page.mouse.move(700,150);await settle(20);
  ok('移出控件关闭提示并恢复aria属性',await page.$eval('#uiTooltip',n=>n.hidden)&&await page.$eval('#sideRail button:first-child',n=>!n.hasAttribute('aria-describedby')));
}
