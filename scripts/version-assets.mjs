import fs from 'node:fs';
import path from 'node:path';

/** public 保留逻辑源文件；生产通过 Rollup emitFile 管理哈希，不复制第二份原名文件。 */
export function versionAssetsPlugin({ overrides = {} } = {}) {
  let root, references;
  return {
    name: 'director-version-assets', apply: 'build',
    configResolved(config) { root = config.root; },
    buildStart() {
      references = new Map();
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const file = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(file);
          else {
            const logical = './' + path.relative(path.join(root, 'public'), file).split(path.sep).join('/');
            const source = overrides[logical] ?? fs.readFileSync(file);
            const ref = this.emitFile({ type: 'asset', name: entry.name, source });
            references.set(logical, ref);
            this.addWatchFile(file);
          }
        }
      };
      walk(path.join(root, 'public/assets'));
    },
    transform(code, id) {
      if (!id.endsWith('/src/util/assetURL.js')) return;
      const fields = [...references].map(([logical, ref]) => `${JSON.stringify(logical)}:import.meta.ROLLUP_FILE_URL_${ref}`);
      return code.replace('const BUILT_URLS = Object.freeze({});', `const BUILT_URLS = Object.freeze({${fields.join(',')}});`);
    },
    generateBundle() {
      const manifest = Object.fromEntries([...references].map(([logical, ref]) => [logical, this.getFileName(ref)]));
      this.emitFile({ type: 'asset', fileName: 'asset-manifest.json', source: JSON.stringify(manifest, null, 2) });
    },
  };
}
