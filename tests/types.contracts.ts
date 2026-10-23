import type { SceneDocument, Op, RecoverySnapshot, ChatProvider } from '../src/types/contracts.js';
import { OpenAICompatProvider, MockProvider } from '../src/ai/provider.js';
import { exportSize, encoderConfig } from '../src/app/exportSpec.js';
import { xyz, clone } from '../src/util/math.js';
const ops: Op[] = [{ op: 'move', target: '甲', pos: xyz({ x: 1, y: 2, z: 3 }) }, { op: 'keyframe', target: '镜头', property: 'fov', t: 2, value: 50 }];
const copy: Op[] = clone(ops);
const live: ChatProvider = new OpenAICompatProvider({ baseURL: '', apiKey: '', model: '' });
const mock: ChatProvider = new MockProvider([{ match: '甲', reply: (_messages, n: number) => ({ ops: copy, n }) }]);
void live; void mock;
function contracts(doc: SceneDocument, snapshot: RecoverySnapshot) {
  const schema: 'director-stage/0.1' = doc.schema;
  const version: 1 = snapshot.storageVersion;
  return { schema, version, size: exportSize(doc.scene.ratio, 720), config: encoderConfig(1280, 720, 24) };
}
void contracts;
// @ts-expect-error fov 值只能是数，不能是向量。
const wrongKey: Op = { op: 'keyframe', target: '镜头', property: 'fov', t: 0, value: [0, 0, 0] };
// @ts-expect-error 不接受未登记的操作。
const wrongOp: Op = { op: 'teleport', target: '甲' };
// @ts-expect-error 三维坐标不可少一维。
const wrongPosition: Op = { op: 'move', target: '甲', pos: [1, 2] };
// @ts-expect-error 分辨率不能传字符串。
exportSize('16:9', '720');
void wrongKey; void wrongOp; void wrongPosition;
