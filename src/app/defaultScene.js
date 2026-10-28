// @ts-check
import { createEmptyDocument } from '../doc/schema.js';
import { addCharacter, charName } from '../doc/edit.js';
import { CameraEntity } from '../entities/Camera.js';
import { startupFraming } from '../core/framing.js';

/** 只用于新鲜启动；保留一男一女，按参考图校准观察距离、轻俯视角和机位朝向。 */
export async function defaultScene(directorCamera) {
  const doc = createEmptyDocument();
  addCharacter(doc, { name: charName(0), body: 'male', pos: [-0.7, 0, 0] });
  addCharacter(doc, { name: charName(1), body: 'female', pos: [0.7, 0, 0] });
  const { director, shot } = startupFraming();
  let camera;
  try {
    camera = new CameraEntity('机位1', { fov: shot.fov, aspect: directorCamera.aspect });
    camera.root.position.copy(shot.position);
    camera.aimAt(shot.target);
    doc.entities.push(camera.toJSON());
    doc.scene.activeCameraId = doc.timeline.mainCameraId = camera.id;
    doc.meta.editorView = { pos: director.position.toArray(), target: director.target.toArray(), fov: director.fov };
    return doc;
  } finally {
    camera?.dispose();
  }
}
