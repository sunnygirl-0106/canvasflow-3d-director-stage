import { createEmptyDocument } from '../doc/schema.js';
import { addCharacter } from '../doc/edit.js';
import { Character } from '../entities/Character.js';
import { CameraEntity } from '../entities/Camera.js';
import { startupFraming } from '../core/framing.js';
import { worldBox } from '../util/measure.js';

/** 只用于新鲜启动；保留一男一女，按参考图校准观察距离、轻俯视角和机位朝向。 */
export async function defaultScene(directorCamera) {
  const doc = createEmptyDocument();
  const json = addCharacter(doc, { name: '男角色', body: 'male', pos: [-0.7, 0, 0] });
  const female = addCharacter(doc, { name: '女角色', body: 'female', pos: [0.7, 0, 0] });
  const subjects = [];
  let camera;
  try {
    // 分别量两个人物，避免用男性的包围盒代替女性的实际体型。
    for (const character of [json, female]) subjects.push(await Character.fromJSON(character));
    const box = worldBox(subjects[0].root, { useBones: true });
    box.union(worldBox(subjects[1].root, { useBones: true }));
    const { director, shot } = startupFraming(box, directorCamera);
    camera = new CameraEntity('机位1', { fov: shot.fov, aspect: directorCamera.aspect });
    camera.root.position.copy(shot.position);
    camera.aimAt(shot.target);
    doc.entities.push(camera.toJSON());
    doc.scene.activeCameraId = doc.timeline.mainCameraId = camera.id;
    doc.meta.editorView = { pos: director.position.toArray(), target: director.target.toArray() };
    return doc;
  } finally {
    subjects.forEach(subject => subject.dispose());
    camera?.dispose();
  }
}
