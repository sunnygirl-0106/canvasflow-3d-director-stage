import { JOINT_SCHEMA } from './jointSchema.js';

/**
 * 姿势数据：{ values: { 语义关节key: 角度(度) } }，0 = 自然站立。与模型无关，不做插值。
 */
export class Pose {
  constructor(values = {}) {
    this.values = values;
  }

  /** 按 schema 建一个全 0（站立）姿势。 */
  static create(schema = JOINT_SCHEMA) {
    const values = {};
    for (const j of schema) values[j.key] = 0;
    return new Pose(values);
  }

  clone() { return new Pose({ ...this.values }); }

  /** 只序列化非 0 关节。 */
  toJSON() {
    const values = {};
    for (const [k, v] of Object.entries(this.values)) if (v) values[k] = v;
    return { values };
  }

  /** 从 JSON 恢复；传 schema 时补齐缺省关节并丢弃未知键。 */
  static fromJSON(json, schema = JOINT_SCHEMA) {
    const pose = Pose.create(schema);
    for (const [k, v] of Object.entries(json?.values || {})) {
      if (k in pose.values && Number.isFinite(v)) pose.values[k] = v;
    }
    return pose;
  }

  isZero(eps = 1e-6) {
    return Object.values(this.values).every((v) => Math.abs(v || 0) < eps);
  }
}
