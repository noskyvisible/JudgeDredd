// Bundles the whole game (three.js + all modules + CSS) into one self-contained JudgeDredd.html
//   npm i --no-save esbuild && node tools/build-single.mjs
import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || path.join(root, 'JudgeDredd.html');

const res = await build({
  entryPoints: [path.join(root, 'js/main.js')], bundle: true, minify: true, format: 'iife', write: false, legalComments: 'none',
  alias: { three: path.join(root, 'vendor/three/three.module.js'), 'three/addons': path.join(root, 'vendor/three/addons') },
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '');
html = html.replace('<link rel="stylesheet" href="style.css">', () => `<style>${fs.readFileSync(path.join(root, 'style.css'), 'utf8')}</style>`);
html = html.replace('<script type="module" src="js/main.js"></script>', () => `<script>${js}</script>`);
if (html.includes('src="js/main.js"') || html.includes('importmap')) throw new Error('inlining failed');
fs.writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
