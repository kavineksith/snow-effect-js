// Zero-dependency build: wraps the ESM source into a UMD bundle (snow-effect.js).
// Run:  node build.mjs
// Input:  snow-effect.mjs   (ESM source, ends with `export { ... }`)
// Output: snow-effect.js    (UMD bundle, usable as <script>, CommonJS and AMD)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(root, 'snow-effect.mjs'), 'utf8');

const exportLine = /^export \{[^}]*\};?\s*$/m;
if (!exportLine.test(src)) {
  throw new Error('Expected a trailing `export { ... }` line in snow-effect.mjs');
}
const body = src.replace(exportLine, '').trimEnd();

const umd = `(function (root, factory) {
  'use strict';
  var lib = factory();
  if (typeof define === 'function' && define.amd) {
    define([], function () { return lib; });
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = lib;
    module.exports.default = lib;
    module.exports.SnowEffect = lib;
  }
  if (typeof window !== 'undefined') {
    window.SnowEffect = lib;
  } else if (root) {
    root.SnowEffect = root.SnowEffect || lib;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

${body}

  return SnowEffect;
}));
`;

writeFileSync(join(root, 'snow-effect.js'), umd);
console.log('Built snow-effect.js (' + Buffer.byteLength(umd) + ' bytes, unminified)');
