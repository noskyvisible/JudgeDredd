// Vehicle studio: renders the Lawmaster (optionally ridden) and the traffic car types under controlled studio lighting
// (city env map for reflections, dark glossy floor) into one contact sheet.  Use it for model / material / rider-fit work.
//
//   node tools/vstudio.mjs <out.png> [options]
//     --subject bike | rider | perp | cars | car:<kind>[,<kind>...]     what to render                       [default rider]
//     --angles side,front,back,q34,q34b,rear6,top,sideR,low   camera angles (one column each)               [default q34,side,back,front]
//     --state idle | ride | boost | brake | steerL | steerR | park | aim   bike state before the frame      [default ride]
//     --tile 480x300            tile size                                                                   [default 420x280]
//     --zoom 1.0                camera distance multiplier;  --focus x,y,z  look-at point (bike space)
//     --post                    run the game's post chain (bloom + grade) instead of a plain render
//     --url http://localhost:8000/
//   Prints mesh / triangle / draw-call counts for each subject.
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }

const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'vstudio.png';
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const subject = opt('subject', 'rider');
const angles = opt('angles', 'q34,side,back,front').split(',');
const state = opt('state', 'ride');
const states = opt('states', '');
const [TW, TH] = opt('tile', '420x280').split('x').map(Number);
const zoom = +opt('zoom', '1');
const focus = opt('focus', '');
const post = args.includes('--post');
const url = opt('url', 'http://localhost:8000/');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: TW, height: TH } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.split('\n')[0]));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 300)); });
await page.addInitScript(() => { window.__noRender = true; });
await page.goto(url);
await page.waitForFunction(() => window.__test, null, { timeout: 180000 });

const res = await page.evaluate(async ({ subject, angles, state: state0, states, TW, TH, zoom, focus, post }) => {
  let state = state0;
  const T = window.__test, THREE = T.THREE, R = T.renderer, G = window.__G;
  const bikeMod = await import('/js/bike.js');
  const carMod = await import('/js/carmodel.js');
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0x0d0b14);
  studio.environment = T.scene.environment; studio.environmentIntensity = 0.8;
  studio.fog = null;
  const rig = new THREE.Group();
  const mk = (col, k, x, y, z) => { const l = new THREE.DirectionalLight(col, k); l.position.set(x, y, z); rig.add(l); return l; };
  mk(0xfff0dd, 2.6, -3.0, 4.0, 3.0); mk(0x8aa8ff, 0.9, 4.0, 1.5, 2.0); mk(0xff5fb8, 2.2, 3.0, 3.0, -8); mk(0x40e0ff, 1.6, -3.5, 2.0, -8);
  studio.add(new THREE.HemisphereLight(0x8a80b0, 0x201830, 0.7));
  const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x15131c, roughness: 0.35, metalness: 0.2 }));
  floor.receiveShadow = true; studio.add(floor);
  const grid = new THREE.GridHelper(20, 40, 0x2e2a48, 0x1c1a2c); grid.position.y = 0.002; studio.add(grid);
  const cam = new THREE.PerspectiveCamera(32, TW / TH, 0.05, 200); studio.add(cam); cam.add(rig);

  const subjects = [];   // {obj, label, center:Vector3, size:number, tick?:fn}
  const bikeState = (b) => {
    const c = b.ctrl; c.throttle = 0; c.brake = 0; c.steer = 0; c.boost = false; c.drift = false; c.hold = false; b.boosting = false; b.speed = 0; b.steer = 0;
    if (state === 'ride') { b.speed = 34; c.throttle = 0.6; }
    if (state === 'boost') { b.speed = 70; c.throttle = 1; c.boost = true; b.boosting = true; }
    if (state === 'brake') { b.speed = 30; c.brake = 1; }
    if (state === 'steerL') { b.speed = 14; c.throttle = 0.4; c.steer = -1; b.steer = -1; }
    if (state === 'steerR') { b.speed = 14; c.throttle = 0.4; c.steer = 1; b.steer = 1; }
    if (state === 'park') { c.hold = true; }
    if (state === 'siren') { b.speed = 20; c.throttle = 0.5; }
    b.accelLean = c.throttle - c.brake;
  };
  const tickBike = (b, ch, n = 90) => {
    for (let i = 0; i < n; i++) {
      bikeState(b); G.time += 1 / 60;
      b.sync(1 / 60);
      if (state === 'siren') { b.sirenOn = true; b.sirenT = 0.02; const M = b.model.userData.mats; M.sirenL.color.setRGB(3, 0.15, 0.15); M.sirenR.color.setRGB(0.05, 0.05, 0.3); b.sync(0); }
      if (ch) { if (state === 'aim') { ch.aim = 1; ch.aimPitch = 0.05; ch.aimYaw = 0.3; } ch.update(1 / 60); }
    }
    b.model.updateMatrixWorld(true);
  };
  if (subject === 'bike' || subject === 'rider' || subject === 'perp') {
    const b = subject === 'perp' ? new bikeMod.PerpBike(studio, { pos: new THREE.Vector3() }) : new bikeMod.Lawmaster(studio);
    b.place(0, 0, 0); b.mounted = true; G.mounted = subject === 'perp' ? null : b;
    let ch = null;
    if (subject === 'rider') { ch = new T.Character('dredd'); ch.gunMount.add(T.makeLawgiver()); b.model.add(ch.root); bikeMod.ridePose(ch, b); }
    if (subject === 'perp') ch = b.rider;
    const list = states ? states.split(',') : [state];
    for (const stt of list) subjects.push({ obj: b.model, label: subject + ' · ' + stt, center: new THREE.Vector3(0, 0.95, 0), size: 4.6, bike: b, ch, st: stt });
  } else if (subject === 'flyer') {
    const F = await import('/js/flyers.js'); const fl = F.createFlyers(studio, { count: 1 });
    const grp = new THREE.Group(); for (const m of fl.meshes) { m.removeFromParent(); m.setMatrixAt(0, new THREE.Matrix4()); m.instanceMatrix.needsUpdate = true; m.count = 1; grp.add(m); }
    grp.position.y = 0.6; studio.add(grp);
    subjects.push({ obj: grp, label: 'spinner', center: new THREE.Vector3(0, 1.0, 0), size: 5.2 });
  } else {
    const kinds = subject === 'cars' ? carMod.CAR_TYPES || ['sedan', 'coupe', 'taxi', 'truck'] : subject.split(':')[1].split(',');
    for (const k of kinds) {
      const m = carMod.makeCarModel(k, [0x8a1a1a, 0x1a3a8a, 0xb0a020, 0x2a2a2e, 0xd0d0d8, 0x1a6a4a][subjects.length % 6]);
      studio.add(m); m.visible = false;
      subjects.push({ obj: m, label: k, center: new THREE.Vector3(0, (m.userData.height || 1.5) * 0.45, 0), size: Math.max(4.8, m.userData.len || 4.6) });
    }
  }
  if (focus) { const f = focus.split(',').map(Number); for (const s of subjects) s.center.set(f[0], f[1], f[2]); }

  const ang = { side: [90, 8], sideR: [-90, 8], front: [0, 6], back: [180, 8], q34: [42, 14], q34b: [140, 14], rear6: [180, 11], top: [30, 60], low: [35, 2] };
  const cols = angles.length, rows = subjects.length;
  const sheet = document.createElement('canvas'); sheet.width = cols * TW; sheet.height = rows * TH;
  const sx = sheet.getContext('2d'); sx.fillStyle = '#000'; sx.fillRect(0, 0, sheet.width, sheet.height);
  R.setPixelRatio(1); R.setSize(TW, TH, false);
  if (post) { T.composer.setPixelRatio(1); T.composer.setSize(TW, TH); T.post.uniforms.res.value.set(TW, TH); T.composer.passes[0].scene = studio; T.composer.passes[0].camera = cam; }
  const info = [];
  for (let r = 0; r < rows; r++) {
    const s = subjects[r]; s.obj.visible = true;
    if (s.bike) { state = s.st; tickBike(s.bike, s.ch); }
    for (let c = 0; c < cols; c++) {
      const a = ang[angles[c]] || ang.q34; const az = a[0] * Math.PI / 180, el = a[1] * Math.PI / 180;
      let d = s.size * 1.55 * zoom; if (angles[c] === 'rear6') d = 6.0 * zoom;
      cam.position.set(s.center.x + Math.sin(az) * Math.cos(el) * d, s.center.y + Math.sin(el) * d, s.center.z + Math.cos(az) * Math.cos(el) * d);
      if (angles[c] === 'rear6') cam.position.y = 1.9;
      cam.fov = angles[c] === 'rear6' ? 62 : 32; cam.aspect = TW / TH; cam.updateProjectionMatrix();
      cam.lookAt(s.center); cam.updateMatrixWorld();
      R.info.reset();
      if (post) T.composer.render(); else R.render(studio, cam);
      sx.drawImage(R.domElement, c * TW, r * TH, TW, TH);
      sx.fillStyle = 'rgba(255,255,255,0.6)'; sx.font = '12px monospace'; sx.fillText(`${s.label} · ${angles[c]}`, c * TW + 8, r * TH + 16);
    }
    let tris = 0, meshes = 0, mats = new Set();
    s.obj.traverse((o) => { if (o.isMesh && o.visible) { meshes++; mats.add(o.material); const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
    info.push(`${s.label}: ${meshes} meshes, ${mats.size} materials, ${(tris / 1000).toFixed(1)}k tris`);
    s.obj.visible = false;
  }
  return { png: sheet.toDataURL('image/png'), info };
}, { subject, angles, state, states, TW, TH, zoom, focus, post });
fs.writeFileSync(out, Buffer.from(res.png.split(',')[1], 'base64'));
console.log(res.info.join('\n'));
console.log(errs.length ? 'ERRORS:\n' + errs.slice(0, 8).join('\n') : 'wrote ' + out);
await browser.close();
