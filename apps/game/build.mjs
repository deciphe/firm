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
  define: { 'process.env.NODE_ENV': '"production"' },
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const template = readFileSync(resolve(here, 'index.template.html'), 'utf8');
const page = (phaserSrc) => template.replace('/*__PHASER__*/', phaserSrc).replace('/*__BUNDLE__*/', () => js);
const body = page('https://cdnjs.cloudflare.com/ajax/libs/phaser/3.90.0/phaser.min.js');
const devBody = page('../vendor/phaser-3.90.0.min.js');
mkdirSync(resolve(here, 'dist'), { recursive: true });
writeFileSync(resolve(here, 'dist/firm.html'), body);
writeFileSync(resolve(here, 'dist/dev.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${devBody}</body></html>`);
console.log(`built dist/firm.html (${(body.length / 1024).toFixed(1)} KB)`);
