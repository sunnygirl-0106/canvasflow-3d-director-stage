import * as THREE from 'three';

const SVG_NS = 'http://www.w3.org/2000/svg';
const AXES = [
  [1, 0, 0, '#ff5a5a', 'X'],
  [0, 1, 0, '#5ad86a', 'Y'],
  [0, 0, 1, '#5a8bff', 'Z'],
];

function svgEl(tag, attrs) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

// 右上角 SVG 坐标指示器 + 「重置视角」。元素只建一次，每帧仅改坐标属性。
export class NavGizmo {
  constructor(svgEl_, camera, onReset) {
    this.camera = camera;
    this.C = 37; // 中心
    this.R = 25; // 轴长
    this._d = new THREE.Vector3();
    svgEl_.parentElement.addEventListener('click', onReset);

    const { C } = this;
    svgEl_.replaceChildren(svgEl('circle', { cx: C, cy: C, r: 3, fill: '#3a3a40' }));
    this.axes = AXES.map(([x, y, z, color, label]) => {
      const line = svgEl('line', { x1: C, y1: C, x2: C, y2: C, stroke: color, 'stroke-width': 1.8, opacity: 0.85 });
      const dot = svgEl('circle', { cx: C, cy: C, r: 4.5, fill: color });
      const text = svgEl('text', { x: C, y: C, 'font-size': 6.5, fill: '#0a0a0c', 'text-anchor': 'middle', 'font-weight': 700 });
      text.textContent = label;
      svgEl_.append(line, dot, text);
      return { dir: new THREE.Vector3(x, y, z), line, dot, text };
    });
  }

  update() {
    const { C, R } = this;
    for (const a of this.axes) {
      this._d.copy(a.dir).transformDirection(this.camera.matrixWorldInverse);
      const x = C + this._d.x * R;
      const y = C - this._d.y * R;
      a.line.setAttribute('x2', x); a.line.setAttribute('y2', y);
      a.dot.setAttribute('cx', x); a.dot.setAttribute('cy', y);
      a.text.setAttribute('x', x); a.text.setAttribute('y', y + 2.6);
    }
  }
}
