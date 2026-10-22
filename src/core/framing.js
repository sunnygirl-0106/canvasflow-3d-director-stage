import * as THREE from 'three';

// 导演视角约水平偏转 30°、向下 25°。只用于编辑视角，不写入拍摄机位。
export const OVERVIEW_DIRECTION = new THREE.Vector3(0.4532, 0.4226, 0.7849).normalize();
export const FRAMING = Object.freeze({
  subjectPadding: 0.12,
  nearbyPropDistance: 1.5,
  singleOverviewOccupancy: 0.38,
  groupOverviewOccupancy: 0.55,
  horizontalOccupancy: 0.72,
  focusOccupancy: 0.75,
  minimumDistance: 1.5,
});

/**
 * 首屏按参考图的屏幕比例标定：人物高约 21%，脚底约 2/3 画高。
 * 观察点保持在人物正前方、向下俯视 5°；默认拍摄机位与首屏共用位置、目标和视场角。
 * 与显式「对准主体」的紧凑取景分开，避免改变编辑中的缩放行为。
 */
export function startupFraming(box, { fov, aspect }) {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const height = size.y;
  const tangent = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  // 横屏按人物高度标定；窄屏也给两侧留出空间。
  const distance = Math.max(height * Math.cos(THREE.MathUtils.degToRad(5)) ** 2 / (2 * tangent * 0.21), size.x / (2 * tangent * aspect * 0.72)) + size.z / 2;
  const pitch = THREE.MathUtils.degToRad(5);
  const target = new THREE.Vector3(center.x, box.min.y + height * 0.785, center.z);
  const position = new THREE.Vector3(center.x, target.y + distance * Math.tan(pitch), center.z + distance);
  return {
    director: { position, target },
    shot: {
      position: position.clone(),
      target: target.clone(),
      fov,
    },
  };
}

/**
 * 用包围盒八角点求取景距离。occupancy 是可用半画幅比例，保留屏幕安全边距。
 * 只做几何计算，不修改相机、目标方向或传入包围盒。
 */
export function fitBounds(box, {
  fov, aspect, direction = OVERVIEW_DIRECTION,
  occupancy = FRAMING.horizontalOccupancy, horizontalOccupancy = occupancy,
}) {
  if (box.isEmpty() || ![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)) {
    throw new RangeError('取景需要有限且非空的主体包围盒');
  }
  if (!Number.isFinite(fov) || fov <= 0 || fov >= 180 || !Number.isFinite(aspect) || aspect <= 0) {
    throw new RangeError('取景需要有效的视场角与视口宽高比');
  }
  if (![occupancy, horizontalOccupancy].every(v => Number.isFinite(v) && v > 0 && v <= 1)) {
    throw new RangeError('取景可用画幅比例必须在 (0, 1] 内');
  }

  const target = box.getCenter(new THREE.Vector3());
  const back = direction.clone();
  if (!back.toArray().every(Number.isFinite) || back.lengthSq() < 1e-12) back.copy(OVERVIEW_DIRECTION);
  back.normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), back);
  // 正上/正下方观察时，视线与世界 up 平行；使用稳定的水平轴避免零基向量。
  if (right.lengthSq() < 1e-12) right.set(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(back, right);
  const tangent = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const tanY = tangent * occupancy;
  const tanX = tangent * horizontalOccupancy * aspect;
  const corner = new THREE.Vector3();
  let distance = FRAMING.minimumDistance;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        corner.set(x, y, z).sub(target);
        const depth = corner.dot(back);
        distance = Math.max(distance, depth + Math.abs(corner.dot(right)) / tanX, depth + Math.abs(corner.dot(up)) / tanY);
      }
    }
  }
  return { target, position: target.clone().addScaledVector(back, distance) };
}
