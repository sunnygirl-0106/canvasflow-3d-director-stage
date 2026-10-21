// 时间轴面板布局常量（面板 / 标尺 / 轨道行共用）。
export const nameWidth = (width) => Math.max(340, Math.round(width * 0.184)); // 保留操作区最小宽度
export const GUTTER = 12;    // 0 秒距名列的留白（t=0 的键不被名列遮住）
