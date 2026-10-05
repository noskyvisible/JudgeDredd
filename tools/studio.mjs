// Character studio: renders characters from several angles / poses under controlled studio lighting into one contact sheet.
// Use it to inspect models and to review animation frame by frame.
//
//   node tools/studio.mjs <out.png> [options]
//     --chars dredd,thug,gunman     characters to render (one row each).  Styles: dredd thug gunman brute junkie biker boss civ
//     --angles front,back,left,right,q34,q34b,top   camera angles (one column each)               [default front,q34,left,back]
//     --pose idle                   idle | walk:<m/s> | run | aim | hipfire | ready | clip:<name>:<0..1> | frames:<name>:<n>  (n frames across a clip, as columns)
//     --dir front|back|left|right   hit direction for directional clips (hurt / die / knockdown …): where the hit comes FROM
//     --stance ready|panic          character stance while posing
//     --tile 300x420                size of every tile                                            [default 300x420]
//     --zoom 1.0                    camera distance multiplier (<1 closer);  --focus 0.55  height (0 feet .. 1 head) the camera looks at
//     --cycle walk:<m/s>:<n>        n frames across one walk/run cycle (columns), side view, on a treadmill (run:<m/s>:<n> works too)
//     --seq <kind>:<m/s>:<n>:<sec>  n frames over <sec> seconds of a moving-root sequence, camera tracking from the side:
//                                   start (idle -> moving), stop (moving -> idle), turn (180 at speed), strafe, shove (knockback), pivot (turn on the spot),
//                                   dodge (the player's dodge roll)
//     --span <sec>                  for frames:<clip>:<n>: render this many seconds instead of the clip length (see the settle / hold)
//     --then <clip>:<sec>           for frames: play a second clip <sec> seconds in (e.g. knockdown then getup)
//     --url http://localhost:8000/  game server (python3 -m http.server)
//   Examples:
//     node tools/studio.mjs hero.png --chars dredd --angles front,back,left,right,q34,top --zoom 0.8
//     node tools/studio.mjs lineup.png --chars dredd,thug,gunman,brute,junkie,boss,civ,biker --angles front,q34
//     node tools/studio.mjs strike.png --chars dredd --pose frames:slashR:8 --angles q34
//     node tools/studio.mjs walk.png --chars dredd,thug --cycle walk:1.6:8
//     node tools/studio.mjs death.png --chars thug --pose frames:die:8 --dir front --angles left --span 1.2
//     node tools/studio.mjs stop.png --chars dredd --seq stop:6.3:10:1.2
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
const angleGiven = args.includes('--angles');
const pose = opt('pose', 'idle');
const cycle = opt('cycle', '');
const seq = opt('seq', '');
const dirName = opt('dir', '');
const stance = opt('stance', '');
const span = +opt('span', '0');
const then = opt('then', '');
const [TW, TH] = opt('tile', '300x420').split('x').map(Number);
const zoom = +opt('zoom', '1'), focus = +opt('focus', '0.52');
const url = opt('url', 'http://localhost:8000/');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.split('\n')[0]));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 200)); });
await page.addInitScript(() => { window.__noRender = true; });
await page.goto(url);
await page.waitForFunction(() => window.__test, null, { timeout: 180000 });

const res = await page.evaluate(async ({ chars, angles, angleGiven, pose, cycle, seq, dirName, stance, span, then, TW, TH, zoom, focus }) => {
  const T = window.__test, THREE = T.THREE, R = T.renderer;
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0x15121d);
  studio.environment = T.scene.environment; studio.environmentIntensity = 0.9;
  // lights ride on the camera so every angle is lit the same way: warm key (upper left), cool fill (right), two rims from behind the subject
  const rig = new THREE.Group(); studio.add(rig);
  const mk = (col, k, x, y, z) => { const l = new THREE.DirectionalLight(col, k); l.position.set(x, y, z); rig.add(l); return l; };
  mk(0xfff0dd, 3.0, -2.5, 3.5, 2.5); mk(0x8aa8ff, 1.0, 3.5, 1.0, 1.5); mk(0xff5fb8, 2.4, 2.5, 3.0, -9); mk(0x40e0ff, 1.8, -3.0, 2.0, -9);
  studio.add(new THREE.HemisphereLight(0x9a90c0, 0x302840, 0.9));
  const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1e1c2a, roughness: 0.95, metalness: 0 }));
  studio.add(floor);
  const grid = new THREE.GridHelper(120, 240, 0x3a3560, 0x24213a); grid.position.y = 0.002; studio.add(grid);

  const cam = new THREE.PerspectiveCamera(30, TW / TH, 0.1, 200); studio.add(cam); rig.removeFromParent(); cam.add(rig);
  const angDeg = { front: 0, q34: 35, q34b: -35, left: 90, right: -90, back: 180, top: 0 };
  // where the hit comes FROM -> push direction in character space
  const DIRS = { front: [0, 0, -1], back: [0, 0, 1], left: [-1, 0, 0], right: [1, 0, 0] };
  const dir = DIRS[dirName] ? new THREE.Vector3(...DIRS[dirName]) : null;
  const makeChar = (style) => {
    const ch = new T.Character(style);
    if (style === 'dredd') { ch.gunMount.add(T.makeLawgiver()); ch.batonMount.add(T.makeBaton(0.85)); }
    else if (style === 'gunman') { ch.gunMount.rotation.x = Math.PI / 2; ch.gunMount.add(T.makePistol()); }
    else if (style === 'thug' || style === 'brute' || style === 'boss') { ch.toolR.add(T.makeBat(0x6a4a2a, 0.9)); }
    if (stance) ch.stance = stance;
    studio.add(ch.root);
    return ch;
  };
  const step = (ch, secs, fn) => { let el = 0; while (el < secs - 1e-6) { const st = Math.min(1 / 120, secs - el); if (fn) fn(st, el); ch.update(st); el += st; } };
  const settle = (ch, n = 30, dt = 1 / 60) => { for (let i = 0; i < n; i++) ch.update(dt); };
  const applyPose = (ch, p) => {
    ch.speed = 0; ch.stopClip?.(); ch.aim = 0; ch.treadmill = true;
    if (p === 'idle') settle(ch, 60);
    else if (p === 'ready') { ch.stance = 'ready'; settle(ch, 120); }
    else if (p.startsWith('walk:')) { ch.speed = +p.split(':')[1]; settle(ch, 120); }
    else if (p === 'run') { ch.speed = 7; settle(ch, 120); }
    else if (p === 'aim' || p === 'hipfire') { ch.aim = 1; ch.hipFire = p === 'hipfire'; ch.aimPitch = 0.05; settle(ch, 90); }
    else if (p.startsWith('clip:')) {
      const [, name, t] = p.split(':'); settle(ch, 20);
      ch.play(name, { speed: 1, dir }); const dur = T.CLIPS[name].dur;
      step(ch, (+t) * dur);
    }
  };
  const parts = pose.startsWith('frames:') ? pose.split(':') : null;
  const cyc = cycle ? cycle.split(':') : null;
  const sq = seq ? seq.split(':') : null;
  const cols = sq ? +sq[2] : cyc ? +cyc[2] : parts ? +parts[2] : angles.length;
  const rows = chars.length;
  const sheet = document.createElement('canvas'); sheet.width = cols * TW; sheet.height = rows * TH;
  const sx = sheet.getContext('2d'); sx.fillStyle = '#0c0a12'; sx.fillRect(0, 0, sheet.width, sheet.height);
  R.setPixelRatio(1); R.setSize(TW, TH, false);
  const info = [];
  for (let r = 0; r < rows; r++) {
    const style = chars[r]; const ch = makeChar(style);
    const H = (T.STYLES[style]?.scale || 0.9) * 2.35;
    // moving-root sequences
    const S = { pos: new THREE.Vector3(), yaw: 0, vel: new THREE.Vector3(), t: 0 };
    const seqTick = (dt) => {
      const kind = sq[0], v = +sq[1], tot = +sq[3];
      const k = S.t / tot; let want = 0, yawTo = S.yaw, side = false;
      if (kind === 'start') want = k > 0.15 ? v : 0;
      else if (kind === 'stop') want = k < 0.25 ? v : 0;
      else if (kind === 'turn') { want = v; if (k > 0.2) yawTo = Math.PI; }
      else if (kind === 'pivot') { want = 0; if (k > 0.15) yawTo = Math.PI * 0.75; }
      else if (kind === 'strafe') { want = v; side = true; }
      else if (kind === 'shove') { want = 0; if (S.t < dt * 1.5 && S.t >= 0) { S.vel.set(0, 0, -7); ch.impulse([0, 0, -1], 1.2); ch.play('hurt', { speed: 1.3, dir: new THREE.Vector3(0, 0, -1) }); } }
      else if (kind === 'dodge') {   // mirrors Player.startDodge / the 'dodge' state
        if (S.dk === undefined && S.t >= 0.1) { S.dk = 0; ch.play('dodge', { speed: 1 }); }
        if (S.dk !== undefined && S.dk < 1) { S.dk = Math.min(1, S.dk + dt / 0.5); const sp = 15 * (1 - S.dk * 0.6); S.vel.set(Math.sin(S.yaw) * sp, 0, Math.cos(S.yaw) * sp); ch.roll = S.dk * Math.PI * 2; if (S.dk >= 1) { ch.roll = 0; ch.stopClip(); S.vel.set(0, 0, 0); } }
        ch.speed = 0; ch.update(dt); S.pos.addScaledVector(S.vel, dt); ch.root.position.copy(S.pos); S.t += dt; return;
      }
      S.yaw += Math.atan2(Math.sin(yawTo - S.yaw), Math.cos(yawTo - S.yaw)) * (1 - Math.exp(-10 * dt));
      const fx = side ? Math.cos(S.yaw) : Math.sin(S.yaw), fz = side ? -Math.sin(S.yaw) : Math.cos(S.yaw);
      if (kind !== 'shove') { S.vel.x += (fx * want - S.vel.x) * (1 - Math.exp(-12 * dt)); S.vel.z += (fz * want - S.vel.z) * (1 - Math.exp(-12 * dt)); }
      else S.vel.multiplyScalar(Math.exp(-7 * dt));
      ch.speed = kind === 'shove' ? 0 : Math.hypot(S.vel.x, S.vel.z);
      ch.update(dt);
      S.pos.addScaledVector(S.vel, dt); ch.root.position.copy(S.pos); ch.root.rotation.y = S.yaw; S.t += dt;
    };
    if (sq) {
      ch.treadmill = false; ch.root.position.set(0, 0, 0);
      if (sq[0] === 'stop' || sq[0] === 'turn' || sq[0] === 'strafe') {   // already moving when the sequence starts
        const v = +sq[1]; const side = sq[0] === 'strafe';
        S.vel.set(side ? v : 0, 0, side ? 0 : v); ch.speed = v;
        for (let i = 0; i < 120; i++) { ch.update(1 / 60); S.pos.addScaledVector(S.vel, 1 / 60); ch.root.position.copy(S.pos); }
      } else settle(ch, 60);
    }
    for (let c = 0; c < cols; c++) {
      let ang = 0, aName = 'front';
      let tgt = new THREE.Vector3(0, H * focus, 0);
      if (sq) {
        const tot = +sq[3], dtc = tot / cols;
        if (c > 0) { let el = 0; while (el < dtc - 1e-6) { const st = Math.min(1 / 120, dtc - el); seqTick(st); el += st; } }
        ang = angleGiven ? angDeg[angles[0]] ?? 90 : 90; aName = angleGiven ? angles[0] : 'side';
        tgt.set(ch.root.position.x, H * focus, ch.root.position.z);
      } else if (cyc) { // side view, n frames across a walk/run cycle
        ch.root.position.set(0, 0, 0); ch.root.rotation.y = 0; ch.stopClip?.(); ch.aim = 0; ch.speed = +cyc[1]; ch.treadmill = true;
        if (c === 0) { ch.phase = 0; settle(ch, 90); }
        const period = ch.cyclePeriod ? ch.cyclePeriod() : (Math.PI * 2 / (1.8 * (ch.speed * 1.35)));
        if (c > 0) step(ch, period / cols);
        ang = angleGiven ? angDeg[angles[0]] ?? 90 : 90; aName = angleGiven ? angles[0] : 'side';
      } else if (parts) {
        const name = parts[1]; const n = cols; const dur = span > 0 ? span : T.CLIPS[name].dur;
        if (c === 0) { ch.treadmill = true; settle(ch, 30); ch.play(name, { speed: 1, dir }); ch._st = 0; ch._thenDone = false; }
        else {
          const [tn, tt] = then ? then.split(':') : [null, 0];
          step(ch, dur / (n - 1), (st) => { ch._st += st; if (tn && !ch._thenDone && ch._st >= +tt) { ch._thenDone = true; ch.play(tn, { speed: 1, dir }); } });
        }
        ang = angDeg[angles[0]] ?? 35; aName = angles[0];
      } else { applyPose(ch, pose); aName = angles[c]; ang = angDeg[aName] ?? 0; }
      const a = ang * Math.PI / 180, d = H * 3.1 * zoom, top = aName === 'top';
      if (top) cam.position.set(tgt.x, d * 0.95, tgt.z + d * 0.25); else cam.position.set(tgt.x + Math.sin(a) * d, H * 0.55 + 0.1, tgt.z + Math.cos(a) * d);
      cam.lookAt(tgt); cam.updateMatrixWorld();
      R.render(studio, cam);
      sx.drawImage(R.domElement, c * TW, r * TH, TW, TH);
      sx.fillStyle = 'rgba(255,255,255,0.55)'; sx.font = '12px monospace';
      const lab = sq ? ' ' + (c * (+sq[3]) / cols).toFixed(2) + 's' : cyc ? ' ' + (c / cols).toFixed(2) : parts ? ' ' + (c / (cols - 1)).toFixed(2) : '';
      sx.fillText(`${style} · ${aName}${lab}`, c * TW + 8, r * TH + 16);
    }
    let tris = 0, meshes = 0; ch.root.traverse((o) => { if (o.isMesh) { meshes++; const g = o.geometry; tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3; } });
    info.push(`${style}: ${meshes} meshes, ${(tris / 1000).toFixed(1)}k tris`);
    studio.remove(ch.root);
  }
  return { png: sheet.toDataURL('image/png'), info };
}, { chars, angles, angleGiven, pose, cycle, seq, dirName, stance, span, then, TW, TH, zoom, focus });
fs.writeFileSync(out, Buffer.from(res.png.split(',')[1], 'base64'));
console.log(res.info.join('\n'));
console.log(errs.length ? 'ERRORS:\n' + errs.slice(0, 6).join('\n') : 'wrote ' + out);
await browser.close();
