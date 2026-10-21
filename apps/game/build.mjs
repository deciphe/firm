// Bundles the game into one self-contained HTML page (the artifact) plus a local dev page for screenshots.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const result = await esbuild.build({
  entryPoints: [resolve(here, 'src/main.ts')],
  bundle: true, format: 'iife', target: 'es2020', minify: !process.env.FIRM_DEBUG, write: false,
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

// --desktop: a fully offline page for the Windows app (Phaser and Manrope inlined, no network).
if (process.argv.includes('--desktop')) {
  const phaser = readFileSync(resolve(here, 'vendor/phaser-3.90.0.min.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
  let fonts = '';
  try {
    const dir = dirname(require.resolve('@fontsource/manrope/package.json'));
    for (const w of [500, 600, 700, 800]) {
      const b64 = readFileSync(resolve(dir, `files/manrope-latin-${w}-normal.woff2`)).toString('base64');
      fonts += `@font-face{font-family:Manrope;font-style:normal;font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
    }
  } catch { console.warn('Manrope not installed; desktop page falls back to system fonts'); }
  const offline = template
    .replace(/<link[^>]+fonts\.(googleapis|gstatic)[^>]*>\n?/g, '')
    .replace('<style>', `<style>${fonts}`)
    .replace('<script src="/*__PHASER__*/"></script>', () => `<script>${phaser}</script>`)
    .replace('/*__BUNDLE__*/', () => js);
  const out = resolve(here, '../desktop/web');
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${offline}</body></html>`);
  console.log(`built desktop/web/index.html (${(offline.length / 1024).toFixed(0)} KB, fonts ${fonts ? 'inlined' : 'system'})`);
}
