// 纯 JS，Node 测试/开发校准页也可导入。构建插件仅替换此表为 Rollup 管理的资源 URL。
const BUILT_URLS = Object.freeze({});

/** 只在加载/展示边界解析，文档中继续保存原逻辑路径；dataURL 和未知本地路径原样返回。 */
export function resolveAssetURL(logicalURL) {
  return BUILT_URLS[logicalURL] || logicalURL;
}
