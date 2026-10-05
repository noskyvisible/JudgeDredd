// Character studio: renders characters from several angles / poses under controlled studio lighting into one contact sheet.
// Use it to inspect models and to review animation frame by frame.
//
//   node tools/studio.mjs <out.png> [options]
//     --chars dredd,thug,gunman     characters to render (one row each).  Styles: dredd thug gunman brute junkie biker boss civ
//     --angles front,back,left,right,q34,q34b,top   camera angles (one column each)               [default front,q34,left,back]
//     --pose idle                   idle | walk:<m/s> | run | aim | clip:<name>:<0..1> | frames:<name>:<n>  (n frames across a clip, as columns)
//     --tile 300x420                size of every tile                                            [default 300x420]
//     --zoom 1.0                    camera distance multiplier (<1 closer);  --focus 0.55  height (0 feet .. 1 head) the camera looks at
//     --cycle walk:<m/s>:<n>        n frames across one walk/run cycle (columns), side view
//     --url http://localhost:8000/  game server (python3 -m http.server)
//   Examples:
//     node tools/studio.mjs hero.png --chars dredd --angles front,back,left,right,q34,top --zoom 0.8
//     node tools/studio.mjs lineup.png --chars dredd,thug,gunman,brute,junkie,boss,civ,biker --angles front,q34
//     node tools/studio.mjs strike.png --chars dredd --pose frames:slashR:8 --angles q34
//     node tools/studio.mjs walk.png --chars dredd,thug --cycle walk:1.6:8
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }

const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'studio.png';
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const chars = opt('chars', 'dredd').split(',');
const angles = opt('angles', 'front,q34,left,back').split(',');
const pose = opt('pose', 'idle');
const cycle = opt('cycle', '');
const [TW, TH] = opt('tile', '300x420').split('x').map(Number);
const zoom = +opt('zoom', '1'), focus = +opt('focus', '0.52');
const url = opt('url', 'http://localhost:8000/');
const seed = +opt('seed', '0');   // fixed seed for the generic perps/civilians (their looks are otherwise re-rolled every run)

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.split('\n')[0]));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 200)); });
await page.addInitScript(() => { window.__noRender = true; });
await page.goto(url);
await page.waitForFunction(() => window.__test, null, { timeout: 180000 });

const res = await page.evaluate(async ({ chars, angles, pose, cycle, TW, TH, zoom, focus, seed }) => {
  const T = window.__test, THREE = T.THREE, R = T.renderer;
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0x15121d);
  studio.environment = T.scene.environment; studio.environmentIntensity = 0.9;
  // lights ride on the camera so every angle is lit the same way: warm key (upper left), cool fill (right), two rims from behind the subject
  const rig = new THREE.Group(); studio.add(rig);
  const mk = (col, k, x, y, z) => { const l = new THREE.DirectionalLight(col, k); l.position.set(x, y, z); rig.add(l); return l; };
  mk(0xfff0dd, 3.0, -2.5, 3.5, 2.5); mk(0x8aa8ff, 1.0, 3.5, 1.0, 1.5); mk(0xff5fb8, 2.4, 2.5, 3.0, -9); mk(0x40e0ff, 1.8, -3.0, 2.0, -9);
  studio.add(new THREE.HemisphereLight(0x9a90c0, 0x302840, 0.9));
  const floor = new THREE.Mesh(new THREE.CircleGeometry(3, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1e1c2a, roughness: 0.95, metalness: 0 }));
  studio.add(floor);
  const grid = new THREE.GridHelper(6, 12, 0x3a3560, 0x24213a); grid.position.y = 0.002; studio.add(grid);

  const cam = new THREE.PerspectiveCamera(30, TW / TH, 0.1, 100); studio.add(cam); rig.removeFromParent(); cam.add(rig);
  const angDeg = { front: 0, q34: 35, q34b: -35, left: 90, right: -90, back: 180, top: 0 };
  const makeChar = (style) => {
    const ch = new T.Character(style, seed ? { seed } : {});
    if (style === 'dredd') { ch.gunMount.add(T.makeLawgiver()); ch.batonMount.add(T.makeBaton(0.85)); }
    else if (style === 'gunman') { ch.gunMount.rotation.x = Math.PI / 2; ch.gunMount.add(T.makePistol()); }
    else if (style === 'thug' || style === 'brute' || style === 'boss') { ch.toolR.add(T.makeBat(0x6a4a2a, 0.9)); }
    studio.add(ch.root);
    return ch;
  };
  const settle = (ch, n = 30, dt = 1 / 60) => { for (let i = 0; i < n; i++) ch.update(dt); };
  const applyPose = (ch, p, frac) => {
    ch.speed = 0; ch.stopClip?.(); ch.aim = 0;
    if (p === 'idle') settle(ch, 60);
    else if (p.startsWith('walk:')) { ch.speed = +p.split(':')[1]; settle(ch, 120); }
    else if (p === 'run') { ch.speed = 7; settle(ch, 120); }
    else if (p === 'aim') { ch.aim = 1; ch.aimPitch = 0.05; settle(ch, 60); }
    else if (p.startsWith('clip:')) {
      const [, name, t] = p.split(':'); settle(ch, 20);
      ch.play(name, { speed: 1 }); const dur = T.CLIPS[name].dur; const target = (+t) * dur; let el = 0;
      while (el < target - 1e-6) { const st = Math.min(1 / 120, target - el); ch.update(st); el += st; }
    }
  };
  const tiles = []; // {ch, style, pose, angle, label}
  const parts = pose.startsWith('frames:') ? pose.split(':') : null;
  const cyc = cycle ? cycle.split(':') : null;
  const cols = cyc ? +cyc[2] : parts ? +parts[2] : angles.length;
  const rows = chars.length;
  const sheet = document.createElement('canvas'); sheet.width = cols * TW; sheet.height = rows * TH;
  const sx = sheet.getContext('2d'); sx.fillStyle = '#0c0a12'; sx.fillRect(0, 0, sheet.width, sheet.height);
  R.setPixelRatio(1); R.setSize(TW, TH, false);
  const info = [];
  for (let r = 0; r < rows; r++) {
    const style = chars[r]; const ch = makeChar(style);
    const H = (T.STYLES[style]?.scale || 0.9) * 2.35;
    for (let c = 0; c < cols; c++) {
      let ang = 0, aName = 'front';
      if (cyc) { // side view, n frames across a walk/run cycle
        ch.root.position.set(0, 0, 0); ch.root.rotation.y = 0; ch.stopClip?.(); ch.aim = 0; ch.speed = +cyc[1];
        if (c === 0) { ch.phase = 0; settle(ch, 90); }
        // advance by (1/n) of a cycle: phase advances at speed*1.35 per second in the legacy walker, new walkers expose cyclePeriod
        const period = ch.cyclePeriod ? ch.cyclePeriod() : (Math.PI * 2 / (1.8 * (ch.speed * 1.35)));
        const step = period / cols; let el = 0; if (c > 0) while (el < step - 1e-6) { const st = Math.min(1 / 120, step - el); ch.update(st); el += st; }
        ang = 90; aName = 'side';
      } else if (parts) {
        const name = parts[1]; const n = cols; const dur = T.CLIPS[name].dur;
        if (c === 0) { settle(ch, 20); ch.play(name, { speed: 1 }); }
        else { const step = dur / (n - 1); let el = 0; while (el < step - 1e-6) { const st = Math.min(1 / 120, step - el); ch.update(st); el += st; } }
        ang = angDeg[angles[0]] ?? 35; aName = angles[0];
      } else { applyPose(ch, pose); aName = angles[c]; ang = angDeg[aName] ?? 0; }
      const a = ang * Math.PI / 180, d = H * 3.1 * zoom, top = aName === 'top';
      const tgt = new THREE.Vector3(0, H * focus, 0);
      if (top) cam.position.set(0, d * 0.95, d * 0.25); else cam.position.set(Math.sin(a) * d, H * 0.55 + 0.1, Math.cos(a) * d);
      cam.lookAt(tgt); cam.updateMatrixWorld();
      R.render(studio, cam);
      sx.drawImage(R.domElement, c * TW, r * TH, TW, TH);
      sx.fillStyle = 'rgba(255,255,255,0.55)'; sx.font = '12px monospace'; sx.fillText(`${style} · ${aName}${cyc ? ' ' + (c / cols).toFixed(2) : parts ? ' ' + (c / (cols - 1)).toFixed(2) : ''}`, c * TW + 8, r * TH + 16);
    }
    let tris = 0, meshes = 0; ch.root.traverse((o) => { if (o.isMesh) { meshes++; const g = o.geometry; tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3; } });
    info.push(`${style}: ${meshes} meshes, ${(tris / 1000).toFixed(1)}k tris`);
    studio.remove(ch.root);
  }
  return { png: sheet.toDataURL('image/png'), info };
}, { chars, angles, pose, cycle, TW, TH, zoom, focus, seed });
fs.writeFileSync(out, Buffer.from(res.png.split(',')[1], 'base64'));
console.log(res.info.join('\n'));
console.log(errs.length ? 'ERRORS:\n' + errs.slice(0, 6).join('\n') : 'wrote ' + out);
await browser.close();
