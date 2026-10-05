// Still-frame rig for visual work: renders single frames of the game at fixed vantage points (headless Chromium, software GL is fine).
//   node tools/shots.mjs <outDir> [--shots a,b,c] [--size 960x540] [--quality 0|1|2] [--hud] [--url http://localhost:8000/]
// Needs a static server on --url (python3 -m http.server 8000) and playwright (global or local).
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }

const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'shots';
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const [W, H] = opt('size', '960x540').split('x').map(Number);
const quality = +opt('quality', '2');
const url = opt('url', 'http://localhost:8000/');
const wantHud = args.includes('--hud');
const only = opt('shots', '').split(',').filter(Boolean);
fs.mkdirSync(out, { recursive: true });

// Each shot: where the player stands (x,z,yaw), what the camera does ('player' = the game camera with yaw/pitch/dist, or 'free' = explicit position + target),
// optional setup run inside the page, and how many sim frames to settle first.
export const SHOTS = {
  hall:        { at: [0, 62, Math.PI], cam: { yaw: Math.PI, pitch: 0.16, dist: 7 }, settle: 120 },
  hall_wide:   { at: [0, 120, Math.PI], free: { pos: [30, 14, 150], look: [0, 40, 0], fov: 58 }, settle: 60 },
  street_neon: { at: [452, -498, 0], cam: { yaw: 0.0, pitch: 0.12, dist: 6.5 }, settle: 120 },
  neon_low:    { at: [452, -498, 0], free: { pos: [447, 1.1, -488], look: [455, 5, -560], fov: 66 }, settle: 60 },
  puddles:     { at: [-348, 52, 0], free: { pos: [-350, 0.9, 40], look: [-352, 2.5, 120], fov: 60 }, settle: 60 },
  aerial:      { at: [-150, 50, 0], free: { pos: [-260, 190, 260], look: [-120, 30, -40], fov: 62 }, settle: 60 },
  rooftop:     { at: [150, 50, 0], free: { pos: [112, 105, 44], look: [190, 20, 52], fov: 70 }, settle: 60 },
  closeup:     { at: [-250, 50, 0], free: { pos: [-247.8, 1.55, 53.2], look: [-250, 1.35, 50], fov: 38 }, settle: 90, setup: 'foe' },
  fight:       { at: [-250, 50, 0], cam: { yaw: 0.0, pitch: 0.2, dist: 6.2 }, settle: 150, setup: 'foe' },
  bike:        { at: [-300, 50, Math.PI / 2], cam: { yaw: Math.PI / 2, pitch: 0.18, dist: 7.5 }, settle: 150, setup: 'ride' },
  night_ride:  { at: [400, -450, 0], cam: { yaw: 0.0, pitch: 0.15, dist: 7.5 }, settle: 150, setup: 'ride' },
  // vehicle close-ups (Lawmaster parked with Dredd aboard on the neon street; boost run; traffic showroom along the kerb)
  bike_side:   { at: [450.2, -498, 0], free: { pos: [454.4, 1.25, -497.2], look: [452, 1.0, -497.8], fov: 46 }, settle: 90, setup: 'ride_stop' },
  bike_front:  { at: [450.2, -498, 0], free: { pos: [453.4, 1.3, -492.4], look: [452, 1.05, -497.6], fov: 46 }, settle: 90, setup: 'ride_stop' },
  bike_rear:   { at: [450.2, -498, 0], free: { pos: [451.0, 1.95, -504.4], look: [452, 1.0, -498], fov: 55 }, settle: 90, setup: 'ride_stop' },
  bike_boost:  { at: [-300, 50, Math.PI / 2], cam: { yaw: Math.PI / 2, pitch: 0.1, dist: 6.5 }, settle: 150, setup: 'boost' },
  cars:        { at: [447, -548, 0], free: { pos: [449.6, 2.3, -547], look: [457.5, 0.9, -522], fov: 52 }, settle: 30, setup: 'cars' },
  cars_front:  { at: [447, -548, 0], free: { pos: [452.2, 1.7, -481], look: [457.6, 1.0, -503], fov: 55 }, settle: 30, setup: 'cars' },
  traffic:     { at: [470, -540, 0], free: { pos: [462, 1.6, -520], look: [448, 1.0, -495], fov: 60 }, settle: 75, setup: 'traffic' },
  ride_fast:   { at: [-300, 50, Math.PI / 2], cam: { yaw: Math.PI / 2, pitch: 0.16, dist: 7.5 }, settle: 150, setup: 'ride_w' },
  flyers:      { at: [468, -575, 0], free: { pos: [446, 1.7, -560], look: [450, 24, -470], fov: 64 }, settle: 120, setup: 'flyers' },
  boost_close: { at: [-300, 50, Math.PI / 2], free: { rel: true, pos: [-2.6, 1.3, -4.2], look: [0, 0.8, -1.2], fov: 58 }, settle: 100, setup: 'boost' },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.split('\n')[0]));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 200)); });
await page.addInitScript(() => { window.__noRender = true; });
await page.goto(url);
await page.waitForFunction(() => window.__test, null, { timeout: 180000 });
await page.evaluate(([q, hud]) => {
  const T = window.__test, G = window.__G;
  T.startGame(); T.setQuality(q);
  G.crimes.spawnT = 1e9; G.crimes.scenes.forEach((s) => (s.timeLeft = 1e9));
  T.player.hp = T.player.maxHp = 1e9;
  if (!hud) { const st = document.createElement('style'); st.textContent = '#hud,#title,#pause{display:none!important}'; document.head.appendChild(st); }
}, [quality, wantHud]);

const names = only.length ? only : Object.keys(SHOTS);
for (const name of names) {
  const sh = SHOTS[name]; if (!sh) { console.log('unknown shot', name); continue; }
  const t0 = Date.now();
  const r = await page.evaluate(async (sh) => {
    const T = window.__test, G = window.__G, P = T.player, THREE = T.THREE;
    // clean slate
    for (const e of G.enemies.all) e.remove(); G.enemies.all.length = 0;
    if (G.mode === 'bike') G.dismount(true);
    P.pos.set(sh.at[0], 0, sh.at[1]); P.yaw = sh.at[2]; P.vel.set(0, 0, 0);
    if (sh.cam) { P.camYaw = sh.cam.yaw; P.camPitch = sh.cam.pitch; P.camDist = sh.cam.dist; }
    if (sh.setup === 'foe') {
      for (const [dx, dz, t] of [[3.2, -2.6, 'thug'], [-3.4, -3.8, 'gunman'], [0.6, -6.5, 'brute']]) { const e = new T.Enemy(t, new THREE.Vector3(P.pos.x + dx, 0, P.pos.z + dz)); e.aggro = true; G.enemies.add(e); }
    }
    if (sh.setup === 'ride') { T.bike.place(P.pos.x + 1.8, P.pos.z, sh.at[2]); P.pos.set(T.bike.pos.x - 1.6, 0, T.bike.pos.z); G.mount(); T.bike.speed = 52; }
    if (sh.setup === 'ride_stop') { T.bike.place(P.pos.x + 1.8, P.pos.z, sh.at[2]); P.pos.set(T.bike.pos.x - 1.6, 0, T.bike.pos.z); G.mount(); T.bike.speed = 0; T.bike.sirenOn = true; for (const c of G.traffic.cars) if (Math.hypot(c.pos.x - P.pos.x, c.pos.z - P.pos.z) < 40) c.pos.x += 3000; }
    if (sh.setup === 'ride_w') { T.bike.place(P.pos.x + 1.8, P.pos.z, sh.at[2]); P.pos.set(T.bike.pos.x - 1.6, 0, T.bike.pos.z); G.mount(); }
    if (sh.setup === 'boost') { T.bike.place(P.pos.x + 1.8, P.pos.z, sh.at[2]); P.pos.set(T.bike.pos.x - 1.6, 0, T.bike.pos.z); G.mount(); T.bike.speed = 70; T.bike.boostE = 1; }
    if (sh.setup === 'flyers') {   // js/flyers.js is not wired into main.js; instantiate it here for the still
      if (!window.__flyers) { const F = await import('/js/flyers.js'); window.__flyers = F.createFlyers(G.scene, { count: 32 }); }
    }
    if (sh.setup === 'traffic') {   // a stream of traffic in both directions along the x=450 street
      const cs = G.traffic.cars.slice(0, 10);
      cs.forEach((c, i) => { const north = i % 2 === 0; c.dead = false; c.model.visible = true; c.yaw = north ? 0 : Math.PI; c.pos.set(450 + (north ? -5 : 5), 0, -520 - 10 + Math.floor(i / 2) * 15 + (north ? 0 : 8)); c.speed = c.maxSpeed = 9; c.vx = 0; c.vz = 0; c.extendPath(); });
    }
    if (sh.setup === 'cars') {
      const CM = await import('/js/carmodel.js');
      for (const c of G.traffic.cars) if (Math.hypot(c.pos.x - 455, c.pos.z - (P.pos.z + 20)) < 80) c.pos.x += 3000;
      (window.__showroom || []).forEach((m) => m.removeFromParent());
      let z = P.pos.z + 6; window.__showroom = CM.CAR_TYPES.map((k) => { const m = CM.makeCarModel(k, CM.carPaint(k)); z += m.userData.len / 2; m.position.set(458.2, 0, z); z += m.userData.len / 2 + 1.4; G.scene.add(m); return m; });
    }
    // settle: let lights hop, traffic spawn, the camera catch up
    for (let i = 0; i < sh.settle; i++) {
      if (sh.setup === 'ride') { T.bike.ctrl.throttle = 0.6; T.bike.ctrl.hold = false; }
      if (sh.setup === 'ride_w') T.input.setKey('KeyW', i < sh.settle - 1);
      if (window.__flyers) window.__flyers.update(1 / 60, P.pos);
      if (sh.setup === 'boost') { T.input.setKey('KeyW', i < sh.settle - 1); T.input.setKey('ShiftLeft', i < sh.settle - 1); T.bike.boostE = 1; }
      window.__step(1);
    }
    if (sh.free && sh.free.rel) {   // camera relative to the bike (x right, y up, z forward in bike space)
      const b = T.bike, f = new THREE.Vector3(Math.sin(b.yaw), 0, Math.cos(b.yaw)), r = new THREE.Vector3(-f.z, 0, f.x);
      const at = (v) => b.pos.clone().addScaledVector(r, v[0]).add(new THREE.Vector3(0, v[1], 0)).addScaledVector(f, v[2]);
      const c = T.camera; c.position.copy(at(sh.free.pos)); c.fov = sh.free.fov || 62; c.updateProjectionMatrix(); c.lookAt(at(sh.free.look)); c.updateMatrixWorld(true);
    } else if (sh.free) { const c = T.camera; c.position.set(...sh.free.pos); c.fov = sh.free.fov || 62; c.updateProjectionMatrix(); c.lookAt(...sh.free.look); c.updateMatrixWorld(true); }
    const info = window.__render();
    return { info, png: T.renderer.domElement.toDataURL('image/png') };
  }, sh);
  fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(r.png.split(',')[1], 'base64'));
  console.log(`${name}: ${((Date.now() - t0) / 1000).toFixed(1)}s  draw calls ${r.info.calls}  tris ${(r.info.tris / 1000).toFixed(0)}k`);
}
console.log(errs.length ? 'ERRORS:\n' + errs.slice(0, 8).join('\n') : 'no page errors');
await browser.close();
