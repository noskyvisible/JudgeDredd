// Builds the single-file game and turns it into an artifact page body (no <!doctype>/<html>/<head>/<body> wrappers, which the
// artifact host supplies itself; dark colour-scheme declared) so it can be published as a private page.
//   npm i --no-save esbuild && node tools/make-artifact.mjs <out.html>
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || path.join(root, 'JudgeDredd.artifact.html');
const tmp = path.join(os.tmpdir(), 'JudgeDredd.single.html');
execFileSync('node', [path.join(root, 'tools/build-single.mjs'), tmp], { stdio: 'inherit' });
let s = fs.readFileSync(tmp, 'utf8');
// every wrapper tag occurs exactly once in the file, so plain replaces cannot hit a string inside the JS bundle
const strip = ['<!doctype html>\n', '<html lang="en">\n', '<head>\n', '<meta charset="utf-8">\n', '<meta name="viewport" content="width=device-width, initial-scale=1">\n', '<link rel="icon" href="data:,">\n', '</head>\n', '<body>\n', '</body>\n', '</html>\n', '</html>'];
for (const t of strip) { if (s.split(t).length > 2) throw new Error('wrapper tag occurs more than once: ' + JSON.stringify(t)); s = s.replace(t, ''); }
for (const t of ['<!doctype', '<html', '<head', '</head>', '<body', '</body>', '</html>']) if (s.includes(t)) throw new Error('wrapper tag left behind: ' + t);
if (!s.startsWith('<title>')) throw new Error('page must start with <title>');
s = s.replace('<style>:root {', '<style>:root { color-scheme: dark; }\n:root {');
fs.writeFileSync(out, s);
console.log(`wrote ${out} (${(s.length / 1024).toFixed(0)} KB)`);
