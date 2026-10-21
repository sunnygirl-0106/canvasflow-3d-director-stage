import * as THREE from 'three';

export const OVERVIEW_DIRECTION = new THREE.Vector3(0.4532, 0.4226, 0.7849).normalize();

/** Fit all eight bounds corners in camera space, with an explicit usable screen fraction. */
export function fitBounds(box, { fov, aspect, direction = OVERVIEW_DIRECTION, occupancy = 0.72, horizontalOccupancy = occupancy }) {
  const target = box.getCenter(new THREE.Vector3());
  const back = direction.clone().normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), back).normalize();
  const up = new THREE.Vector3().crossVectors(back, right);
  const tanY = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * occupancy;
  const tanX = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * horizontalOccupancy * aspect;
  let distance = 0;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const v = new THREE.Vector3(x, y, z).sub(target);
    distance = Math.max(distance, v.dot(back) + Math.abs(v.dot(right)) / tanX, v.dot(back) + Math.abs(v.dot(up)) / tanY);
  }
  return { target, position: target.clone().addScaledVector(back, Math.max(1.5, distance)) };
}
