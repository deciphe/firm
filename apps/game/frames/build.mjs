import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('/opt/npm-tools/node_modules/esbuild');
const js = esbuild.buildSync({ entryPoints: [resolve(here, 'frame.ts')], bundle: true, format: 'iife', minify: true, write: false }).outputFiles[0].text;
const f = (p) => readFileSync(resolve(here, '../../../design/fonts', p)).toString('base64');
const body = readFileSync(resolve(here, 'frame.template.html'), 'utf8')
  .replace('/*INTER_400*/', () => f('inter/Inter-Regular.woff')).replace('/*INTER_500*/', () => f('inter/Inter-Medium.woff'))
  .replace('/*INTER_600*/', () => f('inter/Inter-SemiBold.woff')).replace('/*INTERD_600*/', () => f('inter/InterDisplay-SemiBold.woff'))
  .replace('/*INTERD_700*/', () => f('inter/InterDisplay-Bold.woff')).replace('/*PIXEL_BOLD*/', () => f('firm-pixel-bold.ttf'))
  .replace('/*BUNDLE*/', () => js.replace(/<\/script/gi, '<\\/script'));
writeFileSync(resolve(here, 'frame.html'), body);
writeFileSync(resolve(here, 'frame-dev.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}</style></head><body>${body}</body></html>`);
console.log('frame', (body.length / 1024).toFixed(0), 'KB');
