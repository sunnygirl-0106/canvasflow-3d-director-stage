import { Channel } from './Channel.js';

const KIND = { pos: 'vec3', scale: 'vec3', rot: 'quat', fov: 'number' };

/**
 * 关键帧轨道：Channel + 目标实体 + 属性。apply(t, st) 把该时刻的值写进实体的求值状态 st（见 Timeline.evaluate）。
 * 值的口径与文档 transform 一致：角色 pos 相对站立基准、scale 相对素体自然尺寸，写入时按实体的 docOpts 换算成 root 值。
 */
export class Track {
  /** @param {object} json 文档 Track（只读） */
  constructor(json) {
    this.json = json;
    this.property = json.property;
    this.channel = new Channel(json.keys, KIND[json.property]);
  }

  apply(t, st) {
    const { posOffset, scaleDiv } = st.opts;
    switch (this.property) {
      case 'pos': {
        const v = this.channel.evaluate(t);
        st.position.set(v[0] + posOffset[0], v[1] + posOffset[1], v[2] + posOffset[2]);
        break;
      }
      case 'scale': {
        const v = this.channel.evaluate(t);
        st.scale.set(v[0] * scaleDiv[0], v[1] * scaleDiv[1], v[2] * scaleDiv[2]);
        break;
      }
      case 'rot':
        this.channel.evaluate(t, st.quaternion);
        st.rotTouched = true;
        break;
      case 'fov':
        st.fov = this.channel.evaluate(t);
        break;
    }
  }
}
