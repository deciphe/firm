// Bundles the game into one self-contained HTML page (the artifact) plus a local dev page for screenshots.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let esbuild;
try { esbuild = require('esbuild'); } catch { esbuild = require('/opt/npm-tools/node_modules/esbuild'); }

const result = await esbuild.build({
  entryPoints: [resolve(here, 'src/main.ts')],
  bundle: true, format: 'iife', target: 'es2020', minify: true, write: false,
  alias: { '@firm/sim': resolve(here, '../../packages/sim/src/index.ts') },
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const template = readFileSync(resolve(here, 'index.template.html'), 'utf8');
const font = (f) => readFileSync(resolve(here, '../../design/fonts', f)).toString('base64');
const body = template
  .replace('/*__FONT_REG__*/', () => font('firm-pixel.ttf'))
  .replace('/*__FONT_BOLD__*/', () => font('firm-pixel-bold.ttf'))
  .replace('/*__BUNDLE__*/', () => js);
mkdirSync(resolve(here, 'dist'), { recursive: true });
writeFileSync(resolve(here, 'dist/firm.html'), body);
writeFileSync(resolve(here, 'dist/dev.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0}[hidden]{display:none!important}</style></head><body>${body}</body></html>`);
console.log(`built dist/firm.html (${(body.length / 1024).toFixed(1)} KB)`);
