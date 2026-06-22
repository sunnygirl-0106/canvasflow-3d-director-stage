import * as THREE from 'three';
import { Entity } from './Entity.js';

// 道具：几何体（方块/圆柱/球/人体素模）。沿用 MVP demo 思路。
const PRIM_COLORS = [0x7ee787, 0xbc8cff, 0xffb066, 0x68d6c8, 0x4f8ef7, 0xf07b6b];
let _colorIdx = 0;

function stdMat(c) {
  return new THREE.MeshStandardMaterial({ color: c, roughness: 0.52, metalness: 0.04 });
}

// 人体素模：胶囊/圆柱+球拼一个占位人形（沿用 MVP makeHuman 思路，统一身高约 1.7）。
function buildMannequin(mat) {
  const g = new THREE.Group();
  const add = (geo, x, y, z, rz) => {
    const me = new THREE.Mesh(geo, mat);
    me.position.set(x, y, z);
    if (rz) me.rotation.z = rz;
    me.castShadow = true;
    g.add(me);
    return me;
  };
  const head = add(new THREE.SphereGeometry(0.135, 28, 28), 0, 1.64, 0);
  head.scale.set(0.92, 1.12, 1);
  add(new THREE.CylinderGeometry(0.052, 0.062, 0.1, 16), 0, 1.52, 0);        // neck
  add(new THREE.CylinderGeometry(0.2, 0.155, 0.4, 22), 0, 1.27, 0);         // chest
  add(new THREE.SphereGeometry(0.155, 22, 22), 0, 1.05, 0);                 // abdomen
  add(new THREE.SphereGeometry(0.175, 22, 22), 0, 0.87, 0);                 // pelvis
  add(new THREE.SphereGeometry(0.09, 16, 16), 0.23, 1.4, 0);
  add(new THREE.SphereGeometry(0.09, 16, 16), -0.23, 1.4, 0);               // shoulders
  [1, -1].forEach((s) => {
    add(new THREE.CapsuleGeometry(0.05, 0.3, 6, 12), s * 0.29, 1.22, 0, s * 0.13); // upper arm
    add(new THREE.CapsuleGeometry(0.044, 0.3, 6, 12), s * 0.355, 0.85, 0, s * 0.05); // forearm
    add(new THREE.SphereGeometry(0.052, 12, 12), s * 0.36, 0.66, 0);        // hand
    add(new THREE.SphereGeometry(0.105, 16, 16), s * 0.105, 0.8, 0);        // hip
    add(new THREE.CapsuleGeometry(0.07, 0.34, 6, 12), s * 0.115, 0.55, 0);  // thigh
    add(new THREE.CapsuleGeometry(0.055, 0.34, 6, 12), s * 0.115, 0.16, 0); // shin
    add(new THREE.BoxGeometry(0.1, 0.06, 0.24), s * 0.115, 0.0, 0.05);      // foot
  });
  return g;
}

function buildPrimitive(kind, mat) {
  let geo, y;
  if (kind === 'box') { geo = new THREE.BoxGeometry(0.8, 0.8, 0.8); y = 0.4; }
  else if (kind === 'cylinder') { geo = new THREE.CylinderGeometry(0.4, 0.4, 1.2, 40); y = 0.6; }
  else { geo = new THREE.SphereGeometry(0.5, 40, 40); y = 0.5; } // sphere
  const me = new THREE.Mesh(geo, mat);
  me.position.y = y;
  me.castShadow = true;
  return me;
}

export class Prop extends Entity {
  /** @param {'box'|'cylinder'|'sphere'|'mannequin'} kind */
  constructor(kind, name) {
    const color = PRIM_COLORS[_colorIdx++ % PRIM_COLORS.length];
    const mat = stdMat(color);
    const root = new THREE.Group();
    const mesh = kind === 'mannequin' ? buildMannequin(mat) : buildPrimitive(kind, mat);
    root.add(mesh);
    super('prop', name, root);
    this.kind = kind;
    this.color = color;
    this.material = mat;
    this.mesh = mesh;
  }

  setColor(hex) {
    const c = new THREE.Color(hex);
    this.root.traverse((n) => { if (n.isMesh) n.material.color.copy(c); });
    this.color = c.getHex();
  }
}
