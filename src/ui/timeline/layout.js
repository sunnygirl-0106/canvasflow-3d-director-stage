// 时间轴面板布局常量（面板 / 标尺 / 轨道行共用）。
export const nameWidth = (width) => Math.min(420, Math.max(350, Math.round(width * 0.24)));
export const GUTTER = 12;    // 0 秒距名列的留白（t=0 的键不被名列遮住）
export const MAX_PPS = 1500; // 最大缩放（px / 秒）
