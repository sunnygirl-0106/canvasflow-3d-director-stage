import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { Character } from '../src/entities/Character.js';
import { POSE_PRESETS } from '../src/entities/posePresets.js';
import { JOINT_KEYS } from '../src/rig/jointSchema.js';
import { PROFILES } from '../src/rig/profiles/index.js';

// 关节值测试使用真实 Character 和场景图；不加载 GLB，不依赖 WebGL。
for (const profile of Object.values(PROFILES)) {
  test(`${profile.id}：全部姿势覆盖旧值，T 型抵消站立偏移`, () => {
    const model = new Group();
    model.add(new Mesh(new BoxGeometry(1, 2, 1), new MeshBasicMaterial()));
    const character = new Character('姿势测试', model, { url: '', profile });
    try {
      for (const preset of POSE_PRESETS) {
        for (const key of JOINT_KEYS) character.values[key] = 17;
        character.applyPosePreset(preset.key);
        const expected = preset.special === 'tpose'
          ? Object.fromEntries(Object.entries(profile.neutralOffset).map(([key, value]) => [key, -value]))
          : preset.values;
        assert.deepEqual(character.values, Object.fromEntries(JOINT_KEYS.map(key => [key, expected[key] ?? 0])), preset.key);
        assert.equal(character.currentPreset, preset.key);
        assert.ok(Object.keys(expected).every(key => JOINT_KEYS.includes(key)), preset.key);
      }
      character.resetPose();
      assert.ok(Object.values(character.values).every(value => value === 0));
      assert.equal(character.currentPreset, null);
    } finally {
      character.dispose();
      model.children[0].geometry.dispose();
    }
  });
}

test('站立、叉腰、鞠躬、坐姿的左右关节镜像一致', () => {
  for (const key of ['stand', 'akimbo', 'bow', 'sit']) {
    const { values } = POSE_PRESETS.find(preset => preset.key === key);
    for (const joint of JOINT_KEYS.filter(key => key.startsWith('l'))) {
      assert.equal(values[joint] ?? 0, values['r' + joint.slice(1)] ?? 0, `${key}: ${joint}`);
    }
    for (const joint of ['bodyY', 'bodyZ', 'spineY', 'spineZ', 'headY', 'headZ']) assert.equal(values[joint] ?? 0, 0);
  }
});
