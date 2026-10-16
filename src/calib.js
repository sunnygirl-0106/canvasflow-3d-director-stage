// 骨骼档案校准页（开发用）：?profile=<id>
// 对 JOINT_SCHEMA 每个关节各出一格（该关节 +CALIB_DEG、其余 0 = 站立），另加 T型 / 站立 两格参考。
// 每格先画一层灰色站立残影，再画当前姿势，方向一眼可辨。渲染完成后置 window.__calibReady。
import * as THREE from 'three';
import { Character } from './entities/Character.js';
import { JOINT_SCHEMA } from './rig/jointSchema.js';
import { PROFILES } from './rig/profiles/index.js';

const CALIB_DEG = 30;
const CELL_W = 200, CELL_H = 260;
const GHOST = 0xb4b4b4, BODY = 0x34c759;

const $ = (id) => document.getElementById(id);

async function main() {
  const id = new URLSearchParams(location.search).get('profile') || 'xbot';
  const profile = PROFILES[id];
  if (!profile) throw new Error(`未知档案 "${id}"，可选：${Object.keys(PROFILES).join(' / ')}`);
  document.title = `校准 · ${profile.id}`;
  $('title').textContent = `骨骼档案校准 · ${profile.label}（${profile.id}）`;

  const ch = await Character.load(profile.id, { url: profile.file, profile, height: profile.heightM });
  const h = ch.height;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(1);
  renderer.setSize(CELL_W, CELL_H);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a80, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(2, 4, 3);
  scene.add(key);
  scene.add(ch.root);
  const grid = new THREE.GridHelper(2, 8, 0xcccccc, 0xe2e2e2);
  scene.add(grid);

  // 3/4 正面（角色面朝 +Z），前后 / 左右方向都看得出
  const cam = new THREE.PerspectiveCamera(30, CELL_W / CELL_H, 0.05, 100);
  const az = THREE.MathUtils.degToRad(35), dist = h * 3.1;
  cam.position.set(Math.sin(az) * dist, h * 0.62, Math.cos(az) * dist);
  cam.lookAt(0, h * 0.5, 0);

  const mats = ch._mats;
  const setLook = (ghost) => mats.forEach((m) => {
    m.color.setHex(ghost ? GHOST : BODY);
    m.transparent = ghost;
    m.opacity = ghost ? 0.35 : 1;
    m.depthWrite = !ghost;
  });

  const missing = new Set(ch.missingJoints);
  const cells = [
    { title: 'tpose', sub: 'T型（文件静止位）', ref: true, apply: () => ch.applyPosePreset('tpose') },
    { title: 'stand', sub: '站立（全 0）', ref: true, apply: () => ch.resetPose() },
    ...JOINT_SCHEMA.map((j) => ({
      title: j.key,
      sub: `${j.group}${j.side ? ' ' + j.side : ''} · ${j.label} +${CALIB_DEG}°`,
      missing: missing.has(j.key),
      apply: () => { ch.resetPose(); ch.values[j.key] = CALIB_DEG; ch.applyPose(); },
    })),
  ];

  for (const c of cells) {
    renderer.setClearColor(0xffffff, 1);
    renderer.clear();
    if (!c.ref) { // 站立残影
      ch.resetPose(); setLook(true); grid.visible = true;
      renderer.render(scene, cam);
      grid.visible = false;
    }
    c.apply(); setLook(false);
    renderer.render(scene, cam);
    grid.visible = true;

    const cv = document.createElement('canvas');
    cv.width = CELL_W; cv.height = CELL_H;
    cv.getContext('2d').drawImage(renderer.domElement, 0, 0);
    const cell = document.createElement('div');
    cell.className = 'cell' + (c.ref ? ' ref' : '') + (c.missing ? ' missing' : '');
    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.innerHTML = `<b></b><br><span></span>`;
    cap.querySelector('b').textContent = c.title;
    cap.querySelector('span').textContent = c.sub;
    cell.append(cv, cap);
    $('grid').appendChild(cell);
  }
  if (missing.size) console.warn(`[calib] ${profile.id} 缺少 ${missing.size} 个关节：`, [...missing].join(', '));
  renderer.dispose();
}

main()
  .catch((e) => { console.error(e); $('err').textContent = String(e?.message || e); })
  .finally(() => { window.__calibReady = true; });
