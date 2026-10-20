import * as THREE from 'three';
import { Entity, hexColor } from './Entity.js';
import { PROP_PALETTE } from '../config.js';

// 道具：几何体（方块/圆柱/球/人体素模）。沿用 MVP demo 思路。
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

const _centers = new Map(); // kind → 几何包围盒中心（root 局部坐标）

/**
 * 道具几何在 root 局部坐标下的包围盒中心（与 Constraint.aimPoint 量的是同一个盒子）。
 * AI 在文档上推算注视点时用（实体还没有场景对象）。
 */
export function propLocalCenter(kind) {
  let c = _centers.get(kind);
  if (!c) {
    const root = new THREE.Group();
    root.add(kind === 'mannequin' ? buildMannequin(null) : buildPrimitive(kind, null));
    root.updateMatrixWorld(true);
    c = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
    root.traverse((o) => o.geometry?.dispose());
    _centers.set(kind, c);
  }
  return c.clone();
}

export class Prop extends Entity {
  /**
   * @param {'box'|'cylinder'|'sphere'|'mannequin'} kind
   * @param {string} name
   * @param {string} [id]
   */
  constructor(kind, name, id) {
    const color = PROP_PALETTE[_colorIdx++ % PROP_PALETTE.length];
    const mat = stdMat(color);
    const root = new THREE.Group();
    const mesh = kind === 'mannequin' ? buildMannequin(mat) : buildPrimitive(kind, mat);
    root.add(mesh);
    super('prop', name, root, id);
    this.kind = kind;
    this.color = color;
    this.material = mat;
    this.mesh = mesh;
  }

  toJSON({ base = null } = {}) {
    return {
      type: 'prop', id: this.id, name: this.name, kind: this.kind,
      color: hexColor(this.color), visible: this.root.visible, transform: this.transformJSON(base || this.root),
    };
  }

  static async fromJSON(json) {
    const p = new Prop(json.kind, json.name, json.id);
    p.applyTransform(json.transform);
    p.setColor(json.color);
    p.setVisible(json.visible);
    return p;
  }

  canApply(json) { return json.type === 'prop' && json.kind === this.kind; }

  applyJSON(json) {
    this.name = json.name;
    this.applyTransform(json.transform);
    this.setColor(json.color);
    this.setVisible(json.visible);
  }

  setColor(hex) {
    const c = new THREE.Color(hex);
    this.root.traverse((n) => { if (n.isMesh) n.material.color.copy(c); });
    this.color = c.getHex();
  }
}
