import { gzipSync } from 'node:zlib';

export function buildReportPlugin() {
  return {
    name: 'director-build-report',
    generateBundle(_, bundle) {
      const chunks = Object.values(bundle).filter((item) => item.type === 'chunk');
      const initial = new Set();
      const visit = (name) => {
        if (initial.has(name)) return;
        initial.add(name);
        for (const dep of bundle[name]?.imports || []) visit(dep);
      };
      for (const c of chunks.filter((c) => c.isEntry)) visit(c.fileName);
      const rows = chunks.map((c) => ({
        file: c.fileName, bytes: Buffer.byteLength(c.code), gzipBytes: gzipSync(c.code).length,
        initial: initial.has(c.fileName), imports: c.imports, dynamicImports: c.dynamicImports,
        threeModules: Object.keys(c.modules).filter((id) => id.includes('/node_modules/three/')).length,
        encoderModules: Object.keys(c.modules).filter((id) => /mp4-muxer|VideoExport|VideoEncoding/.test(id)).length,
      }));
      const threeRoots = new Set(chunks.flatMap((c) => Object.keys(c.modules)
        .filter((id) => id.includes('/node_modules/three/')).map((id) => id.split('/node_modules/three/')[0])));
      if (threeRoots.size !== 1) this.error(`预期一个 Three 安装实例，实际 ${threeRoots.size}`);
      if (rows.some((r) => r.initial && r.encoderModules)) this.error('视频编码模块进入了首屏静态依赖');
      const sum = (key) => rows.filter((r) => r.initial).reduce((n, r) => n + r[key], 0);
      const report = { units: 'bytes (kB = bytes / 1000)', chunks: rows,
        initial: { bytes: sum('bytes'), gzipBytes: sum('gzipBytes') }, threeInstances: threeRoots.size };
      this.emitFile({ type: 'asset', fileName: 'build-report.json', source: JSON.stringify(report, null, 2) });
    },
  };
}
