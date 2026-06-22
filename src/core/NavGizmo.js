import * as THREE from 'three';

// 右上角 SVG 坐标指示器 + 「重置视角」（沿用 MVP 思路）。
export class NavGizmo {
  constructor(svgEl, camera, onReset) {
    this.svg = svgEl;
    this.camera = camera;
    this.C = 37; // 中心
    this.R = 25; // 轴长
    this.axes = [
      [1, 0, 0, '#ff5a5a', 'X'],
      [0, 1, 0, '#5ad86a', 'Y'],
      [0, 0, 1, '#5a8bff', 'Z'],
    ];
    svgEl.parentElement.addEventListener('click', onReset);
    this._d = new THREE.Vector3();
  }

  update() {
    const { C, R } = this;
    let s = `<circle cx="${C}" cy="${C}" r="3" fill="#3a3a40"/>`;
    for (const a of this.axes) {
      this._d.set(a[0], a[1], a[2]).transformDirection(this.camera.matrixWorldInverse);
      const x = C + this._d.x * R;
      const y = C - this._d.y * R;
      s += `<line x1="${C}" y1="${C}" x2="${x}" y2="${y}" stroke="${a[3]}" stroke-width="1.8" opacity="0.85"/>`;
      s += `<circle cx="${x}" cy="${y}" r="4.5" fill="${a[3]}"/>`;
      s += `<text x="${x}" y="${y + 2.6}" font-size="6.5" fill="#0a0a0c" text-anchor="middle" font-weight="700">${a[4]}</text>`;
    }
    this.svg.innerHTML = s;
  }
}
