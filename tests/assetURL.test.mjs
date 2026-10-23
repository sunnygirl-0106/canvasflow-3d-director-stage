import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAssetURL } from '../src/util/assetURL.js';
import { bodySpec } from '../src/config.js';
import { createEmptyDocument, validate } from '../src/doc/schema.js';
test('Node 纯配置仍可导入，开发逻辑 URL 和 dataURL 原样保留', () => {
  assert.equal(resolveAssetURL(bodySpec('male').url), './assets/figures/bodykun_male.glb');
  const data = 'data:image/png;base64,AA==';
  assert.equal(resolveAssetURL(data), data);
  assert.equal(resolveAssetURL('./assets/panoramas/pano-sunset.jpg'), './assets/panoramas/pano-sunset.jpg');
});
test('URL 版本化不放宽文档的同源路径边界', () => {
  const doc = createEmptyDocument();
  doc.assets.pano = { type: 'image', name: '旧全景', url: './assets/panoramas/pano-sunset.jpg' };
  assert.equal(validate(doc).ok, true);
  for (const url of ['https://example.com/pano.jpg', './assets/pano.jpg?v=2']) {
    doc.assets.pano.url = url;
    assert.equal(validate(doc).ok, false);
  }
});
