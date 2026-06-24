import * as THREE from 'three';

// 机位预设（§4.2）：给定主体（选中角色，否则场景中心）与导演相机，
// 算出机位的位姿与 fov 的纯函数表。约定主体正面朝 +Z。
//
// ctx = { subjectCenter:Vector3, subjectHeight:number, directorCamera, directorTarget:Vector3, sceneCenter:Vector3 }
// build(ctx) -> { position:Vector3, target:Vector3, roll?:number(弧度) }

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const DEG = Math.PI / 180;

export const CAMERA_PRESETS = [
  // ---- 视角 ----
  {
    key: 'current', label: '当前视角', group: '视角', fov: null,
    // 从导演眼睛沿视线反方向后移一小段：相机体退到眼睛身后、近平面之外，
    // 截屏自动建机位时不会「怼脸」出现，只比实时画面略宽一点点。
    build: (c) => {
      const pos = c.directorCamera.position.clone();
      const tgt = c.directorTarget.clone();
      const dir = pos.clone().sub(tgt);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
      pos.add(dir.normalize().multiplyScalar(0.5));
      return { position: pos, target: tgt, fov: c.directorCamera.fov };
    },
  },

  // ---- 正面 ----
  {
    key: 'front_mid', label: '正面中景', group: '正面', fov: 40,
    build: (c) => ({ position: c.subjectCenter.clone().add(V(0, c.subjectHeight * 0.05, c.subjectHeight * 2.2)), target: c.subjectCenter.clone() }),
  },
  {
    key: 'front_closeup', label: '正面特写', group: '正面', fov: 34,
    build: (c) => ({
      position: c.subjectCenter.clone().add(V(0, c.subjectHeight * 0.18, c.subjectHeight * 1.05)),
      target: c.subjectCenter.clone().add(V(0, c.subjectHeight * 0.18, 0)),
    }),
  },
  {
    key: 'front_full', label: '正面全景', group: '正面', fov: 46,
    build: (c) => ({
      position: c.subjectCenter.clone().add(V(0, c.subjectHeight * 0.02, c.subjectHeight * 3.4)),
      target: c.subjectCenter.clone().add(V(0, -c.subjectHeight * 0.18, 0)),
    }),
  },

  // ---- 侧 / 背 ----
  {
    key: 'side_track', label: '侧面跟拍', group: '侧/背', fov: 42,
    build: (c) => ({ position: c.subjectCenter.clone().add(V(c.subjectHeight * 1.8, c.subjectHeight * 0.06, c.subjectHeight * 0.9)), target: c.subjectCenter.clone() }),
  },
  {
    key: 'side_close', label: '侧面近景', group: '侧/背', fov: 38,
    build: (c) => ({
      position: c.subjectCenter.clone().add(V(c.subjectHeight * 1.15, c.subjectHeight * 0.12, 0)),
      target: c.subjectCenter.clone().add(V(0, c.subjectHeight * 0.12, 0)),
    }),
  },
  {
    key: 'back_mid', label: '背面中景', group: '侧/背', fov: 40,
    build: (c) => ({ position: c.subjectCenter.clone().add(V(0, c.subjectHeight * 0.05, -c.subjectHeight * 2.2)), target: c.subjectCenter.clone() }),
  },

  // ---- 俯仰 ----
  {
    key: 'high_full', label: '俯拍全景', group: '俯仰', fov: 48,
    build: (c) => ({ position: c.subjectCenter.clone().add(V(0, c.subjectHeight * 2.6, c.subjectHeight * 2.2)), target: c.subjectCenter.clone() }),
  },
  {
    key: 'high_45', label: '45°俯拍', group: '俯仰', fov: 44,
    build: (c) => ({ position: c.subjectCenter.clone().add(V(0, c.subjectHeight * 1.8, c.subjectHeight * 1.8)), target: c.subjectCenter.clone() }),
  },
  {
    key: 'low_up', label: '低角度仰拍', group: '俯仰', fov: 50,
    build: (c) => ({
      position: c.subjectCenter.clone().add(V(0, -c.subjectHeight * 0.28, c.subjectHeight * 1.6)),
      target: c.subjectCenter.clone().add(V(0, c.subjectHeight * 0.4, 0)),
    }),
  },
  {
    key: 'low_wide', label: '低角度广角', group: '俯仰', fov: 72,
    build: (c) => ({
      position: c.subjectCenter.clone().add(V(0, -c.subjectHeight * 0.22, c.subjectHeight * 1.25)),
      target: c.subjectCenter.clone().add(V(0, c.subjectHeight * 0.38, 0)),
    }),
  },

  // ---- 特殊 ----
  {
    key: 'ots_left', label: '过肩镜头', group: '特殊', fov: 40,
    build: (c) => ({
      position: c.subjectCenter.clone().add(V(-c.subjectHeight * 0.6, c.subjectHeight * 0.95, -c.subjectHeight * 1.05)),
      target: c.subjectCenter.clone().add(V(0, c.subjectHeight * 0.55, c.subjectHeight * 1.6)),
    }),
  },
  {
    key: 'ots_right', label: '过肩镜头（右）', group: '特殊', fov: 40,
    build: (c) => ({
      position: c.subjectCenter.clone().add(V(c.subjectHeight * 0.6, c.subjectHeight * 0.95, -c.subjectHeight * 1.05)),
      target: c.subjectCenter.clone().add(V(0, c.subjectHeight * 0.55, c.subjectHeight * 1.6)),
    }),
  },
  {
    key: 'birdseye', label: '鸟瞰', group: '特殊', fov: 55,
    build: (c) => ({
      position: c.subjectCenter.clone().add(V(0, c.subjectHeight * 4.5, c.subjectHeight * 0.001)),
      target: c.subjectCenter.clone(),
    }),
  },
  {
    key: 'dutch', label: '荷兰角', group: '特殊', fov: 42,
    build: (c) => ({
      position: c.subjectCenter.clone().add(V(c.subjectHeight * 0.6, c.subjectHeight * 0.15, c.subjectHeight * 1.9)),
      target: c.subjectCenter.clone().add(V(0, c.subjectHeight * 0.1, 0)),
      roll: 13 * DEG,
    }),
  },
];

// 按 group 归组，供 Dock 菜单分组渲染。
export function groupedPresets() {
  const groups = [];
  const byKey = new Map();
  for (const p of CAMERA_PRESETS) {
    let g = byKey.get(p.group);
    if (!g) { g = { name: p.group, items: [] }; byKey.set(p.group, g); groups.push(g); }
    g.items.push(p);
  }
  return groups;
}
