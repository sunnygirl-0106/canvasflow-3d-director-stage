// 缓动函数：u ∈ [0,1] → [0,1]。名字是 AI 词汇表（文档 keys[].ease / paths[].speed），定了就不改。
export const EASE = {
  linear: (u) => u,
  smooth: (u) => u * u * (3 - 2 * u), // smoothstep：两端导数为 0
  step: () => 0,                      // 保持本键的值直到下一键
};

/** smooth 的导数（路径速度用）。 */
export const smoothDeriv = (u) => 6 * u * (1 - u);

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
