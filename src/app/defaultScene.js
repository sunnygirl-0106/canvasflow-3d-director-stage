import * as THREE from 'three';
import { createEmptyDocument } from '../doc/schema.js';
import { addCharacter } from '../doc/edit.js';
import { Character } from '../entities/Character.js';
import { CameraEntity } from '../entities/Camera.js';
import { fitBounds, FRAMING } from '../core/framing.js';
import { worldBox } from '../util/measure.js';

/** 只用于新鲜启动；先离场测量，再通过文档加载原子发布。参数是建议基线，不是竞品数据。 */
export async function defaultScene(directorCamera) {
  const doc = createEmptyDocument();
  const json = addCharacter(doc, { name: '角色A', body: 'male', pos: [0, 0, 0] });
  const subject = await Character.fromJSON(json);
  let camera;
  try {
    const box = worldBox(subject.root, { useBones: true });
    const fov = 48;
    const shot = fitBounds(box.clone().expandByScalar(FRAMING.subjectPadding), { fov, aspect: directorCamera.aspect, direction: new THREE.Vector3(0, 0.16, 1), occupancy: 0.72 });
    shot.position.y = 1.55;
    camera = new CameraEntity('机位1', { fov });
    camera.root.position.copy(shot.position);
    camera.aimAt(shot.target);
    doc.entities.push(camera.toJSON());
    doc.scene.activeCameraId = doc.timeline.mainCameraId = camera.id;
    const overview = fitBounds(box.clone().expandByScalar(FRAMING.subjectPadding), { fov: directorCamera.fov, aspect: directorCamera.aspect, occupancy: FRAMING.singleOverviewOccupancy });
    doc.meta.editorView = { pos: overview.position.toArray(), target: overview.target.toArray() };
    return doc;
  } finally {
    subject.dispose();
    camera?.dispose();
  }
}
