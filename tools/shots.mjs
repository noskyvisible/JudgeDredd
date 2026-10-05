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
const pageShot = args.includes('--page');      // capture the whole page (HUD / DOM overlays included) instead of just the canvas
const only = opt('shots', '').split(',').filter(Boolean);
const evalJs = opt('eval', '');          // JS run in the page (T = game test hooks, G = game state) after the setup, before each render: e.g. --eval "T.post.uniforms.uAO.value=0"
const suffix = opt('suffix', '');
fs.mkdirSync(out, { recursive: true });

// Each shot: where the player stands (x,z,yaw), what the camera does ('player' = the game camera with yaw/pitch/dist, or 'free' = explicit position + target),
// optional setup run inside the page, and how many sim frames to settle first.
export const SHOTS = {
  hall:        { at: [0, 62, Math.PI], cam: { yaw: Math.PI, pitch: 0.16, dist: 7 }, settle: 120 },
  hall_wide:   { at: [0, 120, Math.PI], vantage: { target: [0, 24, 0], dist: 95, elev: 0.2, fov: 58 }, settle: 40 },
  street_neon: { at: [452, -498, 0], cam: { yaw: 0.0, pitch: 0.12, dist: 6.5 }, settle: 120 },
  neon_low:    { at: [452, -498, 0], free: { pos: [447, 1.1, -488], look: [455, 5, -560], fov: 66 }, settle: 60 },
  puddles:     { at: [-348, 52, 0], free: { pos: [-350, 0.9, 40], look: [-352, 2.5, 120], fov: 60 }, settle: 60 },
  aerial:      { at: [-150, 50, 0], vantage: { target: [-120, 25, 0], dist: 230, elev: 0.6, fov: 62 }, settle: 40 },
  facade:      { at: [-345, 90, 0], free: { pos: [-343, 3.2, 95], look: [-372, 17, 82], fov: 56 }, settle: 40 },
  window_close:{ at: [-345, 90, 0], facadeOf: [-350, 90], dist: 9, lookY: 11, fov: 50, settle: 30 },
  window_mid:  { at: [-345, 90, 0], facadeOf: [-350, 90], dist: 22, lookY: 16, fov: 55, settle: 30 },
  facade_far:  { at: [-345, 90, 0], free: { pos: [-343, 6, 140], look: [-372, 24, 70], fov: 60 }, settle: 40 },
  rooftop:     { at: [150, 50, 0], roofOf: { near: [150, 50], range: 140, look: [150, 2, 50], fov: 70 }, settle: 40 },
  title0:      { title: [0, 12] }, title1: { title: [1, 8] }, title2: { title: [2, 13] },
  boom_a:      { at: [-250, 50, 0], free: { pos: [-243, 2.4, 42], look: [-248.5, 2.5, 39], fov: 60 }, settle: 20, setup: 'boom', boomSteps: 6 },
  boom_b:      { at: [-250, 50, 0], free: { pos: [-243, 2.4, 42], look: [-248.5, 2.5, 39], fov: 60 }, settle: 20, setup: 'boom', boomSteps: 18 },
  boom_c:      { at: [-250, 50, 0], free: { pos: [-243, 2.4, 42], look: [-248.5, 2.5, 39], fov: 60 }, settle: 20, setup: 'boom', boomSteps: 40 },
  boom:        { at: [-250, 50, 0], cam: { yaw: 0.0, pitch: 0.18, dist: 7 }, settle: 30, setup: 'boom' },
  plaza:       { at: [0, 100, Math.PI], free: { pos: [4, 24, 66], look: [0, 0, 30], fov: 55 }, settle: 30 },
  banners:     { at: [0, 100, Math.PI], free: { pos: [-6, 5, 54], look: [6, 40, 4], fov: 62 }, settle: 30 },
  props:       { at: [0, 0, 0], propKind: 'vending', settle: 30 },
  props2:      { at: [0, 0, 0], propKind: 'hydrant', settle: 30 },
  props3:      { at: [0, 0, 0], propKind: 'bench', settle: 30 },
  rail:        { at: [250, 262, 0], free: { pos: [118, 4.5, 262], look: [210, 17, 250], fov: 62 }, settle: 30, setup: 'rail' },
  rail_view:   { at: [250, 280, 0], free: { pos: [214, 3.2, 281], look: [250, 16.5, 252], fov: 60 }, settle: 30, setup: 'rail' },
  judge:       { at: [-250, 50, 0], cam: { yaw: 0.0, pitch: 0.2, dist: 6.2 }, settle: 40, setup: 'judge' },
  sky_moon:    { at: [0, 100, Math.PI], free: { pos: [10, 3, 56], look: [-40, 70, -60], fov: 70 }, settle: 20 },
  air_war: { at: [-452, -480, 0], cam: { yaw: 0.0, pitch: 0.14, dist: 6.5 }, settle: 50 },
  air_fin: { at: [52, -480, 0], cam: { yaw: 0.0, pitch: 0.14, dist: 6.5 }, settle: 50 },
  air_neonrow: { at: [452, -480, 0], cam: { yaw: 0.0, pitch: 0.14, dist: 6.5 }, settle: 50 },
  air_alley: { at: [-452, 20, 0], cam: { yaw: 0.0, pitch: 0.14, dist: 6.5 }, settle: 50 },
  air_park: { at: [452, 20, 0], cam: { yaw: 0.0, pitch: 0.14, dist: 6.5 }, settle: 50 },
  air_ind: { at: [-452, 480, 0], cam: { yaw: 0.0, pitch: 0.14, dist: 6.5 }, settle: 50 },
  air_market: { at: [52, 480, 0], cam: { yaw: 0.0, pitch: 0.14, dist: 6.5 }, settle: 50 },
  air_docks: { at: [452, 480, 0], cam: { yaw: 0.0, pitch: 0.14, dist: 6.5 }, settle: 50 },
  volley:      { at: [-250, 50, 0], cam: { yaw: 0.0, pitch: 0.1, dist: 4.6 }, settle: 40, setup: 'volley', flight: 6 },
  volley2:     { at: [-250, 50, 0], cam: { yaw: 0.0, pitch: 0.1, dist: 4.6 }, settle: 40, setup: 'volley', flight: 14 },
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
  bike_park:   { at: [450.2, -498, 0], free: { pos: [455.6, 1.5, -495.4], look: [451.6, 0.85, -498.2], fov: 46 }, settle: 90, setup: 'park' },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.split('\n')[0]));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, +process.env.SHOT_ERRLEN || 200)); });
await page.addInitScript((tm) => { window.__noRender = true; window.__titleMode = tm; }, (opt('shots', '')).startsWith('title'));
await page.goto(url);
await page.waitForFunction(() => window.__test, null, { timeout: 180000 });
await page.evaluate(([q, hud]) => {
  const T = window.__test, G = window.__G;
  if (!window.__titleMode) T.startGame();
  T.setQuality(q);
  G.crimes.spawnT = 1e9; G.crimes.scenes.forEach((s) => (s.timeLeft = 1e9));
  T.player.hp = T.player.maxHp = 1e9;
  if (!hud) { const st = document.createElement('style'); st.textContent = '#hud,#title,#pause{display:none!important}'; document.head.appendChild(st); }
}, [quality, wantHud]);

const names = only.length ? only : Object.keys(SHOTS);
for (const name of names) {
  const sh = SHOTS[name]; if (!sh) { console.log('unknown shot', name); continue; }
  const t0 = Date.now();
  const r = await page.evaluate(async ([sh, evalJs]) => {
    const T = window.__test, G = window.__G, P = T.player, THREE = T.THREE;
    // clean slate
    if (!sh.title) {
    for (const e of G.enemies.all) e.remove(); G.enemies.all.length = 0;
    if (G.mode === 'bike') G.dismount(true);
    P.pos.set(sh.at[0], 0, sh.at[1]); P.yaw = sh.at[2]; P.vel.set(0, 0, 0);
    }
    if (sh.cam) { P.camYaw = sh.cam.yaw; P.camPitch = sh.cam.pitch; P.camDist = sh.cam.dist; }
    if (sh.setup === 'foe') {
      for (const [dx, dz, t] of [[3.2, -2.6, 'thug'], [-3.4, -3.8, 'gunman'], [0.6, -6.5, 'brute']]) { const e = new T.Enemy(t, new THREE.Vector3(P.pos.x + dx, 0, P.pos.z + dz)); e.aggro = true; G.enemies.add(e); }
    }
    if (sh.setup === 'ride') { T.bike.place(P.pos.x + 1.8, P.pos.z, sh.at[2]); P.pos.set(T.bike.pos.x - 1.6, 0, T.bike.pos.z); G.mount(); T.bike.speed = 52; }
    if (sh.setup === 'ride_stop') { T.bike.place(P.pos.x + 1.8, P.pos.z, sh.at[2]); P.pos.set(T.bike.pos.x - 1.6, 0, T.bike.pos.z); G.mount(); T.bike.speed = 0; T.bike.sirenOn = true; for (const c of G.traffic.cars) if (Math.hypot(c.pos.x - P.pos.x, c.pos.z - P.pos.z) < 40) c.pos.x += 3000; }
    if (sh.setup === 'ride_w') { T.bike.place(P.pos.x + 1.8, P.pos.z, sh.at[2]); P.pos.set(T.bike.pos.x - 1.6, 0, T.bike.pos.z); G.mount(); }
    if (sh.setup === 'park') { T.bike.place(P.pos.x + 1.8, P.pos.z, sh.at[2]); T.bike.speed = 0; T.bike.sirenOn = false; T.bike.called = false; T.bike.ctrl.hold = true; P.pos.set(T.bike.pos.x - 1.3, 0, T.bike.pos.z + 2.4); P.yaw = 2.6; for (const c of G.traffic.cars) if (Math.hypot(c.pos.x - P.pos.x, c.pos.z - P.pos.z) < 40) c.pos.x += 3000; }
    if (sh.setup === 'boost') { T.bike.place(P.pos.x + 1.8, P.pos.z, sh.at[2]); P.pos.set(T.bike.pos.x - 1.6, 0, T.bike.pos.z); G.mount(); T.bike.speed = 70; T.bike.boostE = 1; }
    if (sh.setup === 'flyers') {   // js/flyers.js is not wired into main.js; instantiate it here for the still
      if (!window.__flyers) { const F = await import('/js/flyers.js'); window.__flyers = F.createFlyers(G.scene, { count: 32 }); }
    }
    if (sh.setup === 'traffic') {   // a stream of traffic in both directions along the x=450 street
      const pol = G.traffic.cars.find((c) => c.kind === 'police'); const cs = G.traffic.cars.filter((c) => c !== pol).slice(0, 9); if (pol) { pol.lightsOn = true; cs.splice(2, 0, pol); }
      cs.forEach((c, i) => { const north = i % 2 === 0; c.dead = false; c.model.visible = true; c.yaw = north ? 0 : Math.PI; c.pos.set(450 + (north ? -5 : 5), 0, -520 - 10 + Math.floor(i / 2) * 15 + (north ? 0 : 8)); c.speed = c.maxSpeed = 9; c.vx = 0; c.vz = 0; c.extendPath(); });
    }
    if (sh.setup === 'cars') {
      const CM = await import('/js/carmodel.js');
      for (const c of G.traffic.cars) if (Math.hypot(c.pos.x - 455, c.pos.z - (P.pos.z + 20)) < 80) c.pos.x += 3000;
      (window.__showroom || []).forEach((m) => m.removeFromParent());
      let z = P.pos.z + 6; window.__showroom = CM.CAR_TYPES.map((k) => { const m = CM.makeCarModel(k, CM.carPaint(k)); z += m.userData.len / 2; m.position.set(458.2, 0, z); z += m.userData.len / 2 + 1.4; G.scene.add(m); return m; });
    }
    // settle: let lights hop, traffic spawn, the camera catch up
    T.world.updateAir(P.pos, 1);   // snap the district atmosphere (fog / sky / grade) to where we stand instead of drifting there
    for (let i = 0; i < sh.settle; i++) {
      if (sh.setup === 'ride') { T.bike.ctrl.throttle = 0.6; T.bike.ctrl.hold = false; }
      if (sh.setup === 'ride_w') T.input.setKey('KeyW', i < sh.settle - 1);
      if (window.__flyers) window.__flyers.update(1 / 60, P.pos);
      if (sh.setup === 'boost') { T.input.setKey('KeyW', i < sh.settle - 1); T.input.setKey('ShiftLeft', i < sh.settle - 1); T.bike.boostE = 1; }
      window.__step(1);
    }
    if (sh.setup === 'boom') { // a Hi-Ex style explosion ahead of Dredd plus a muzzle flash and some sparks, rendered mid-burst
      const f = T.fx, at = new THREE.Vector3(P.pos.x + 1.5, 0, P.pos.z - 11);
      f.explosion(at.clone().setY(1.2), 2.4); f.shake(0); T.weapons.firePatches.push({ pos: at.clone().add(new THREE.Vector3(4, 0, 2)), r: 3, t: 9, tick: 0, owner: null });
      f.spark(at.clone().setY(1.5), 60, 0xffc060, 18, 0.9); f.muzzle(new THREE.Vector3(P.pos.x - 0.6, 1.5, P.pos.z - 0.8), new THREE.Vector3(0.15, 0, -1), 0xffd070);
      for (let i = 0; i < (sh.boomSteps || 16); i++) window.__step(1);
    }
    if (sh.propKind) { // frame the first street-furniture instance of a kind near the origin, from the street side
      const st = T.streetPropStreams.find((x) => x.list.length && x.list[0].K && Object.keys(x.mesh.geometry.attributes).length && (x.front ? sh.propKind === 'vending' || sh.propKind === 'kiosk' : true));
      const list = (T.streetPropStreams.find((x) => x.kind === sh.propKind) || st).list;
      const s = list.slice().sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
      const nx = Math.sin(s.ry), nz = Math.cos(s.ry), c = T.camera;
      P.pos.set(s.x + nx * 6, 0, s.z + nz * 6); for (let i = 0; i < 10; i++) window.__step(1);
      c.position.set(s.x + nx * 3.6 + nz * 1.2, 1.5, s.z + nz * 3.6 - nx * 1.2); c.fov = 55; c.updateProjectionMatrix(); c.lookAt(s.x, 0.8, s.z); c.updateMatrixWorld(true);
    }
    if (sh.setup === 'rail') { const tr = T.monorail.trains[0]; tr.s = 250 + 40; T.monorail.update(0); }   // park the east-west train in view
    if (sh.setup === 'judge') {   // a subdued perp and the judgement dialog over the (blurred) street
      const e = new T.Enemy('gunman', new THREE.Vector3(P.pos.x + 1.5, 0, P.pos.z + 2.5), { crimes: ['armedrobbery', 'weapons'] }); G.enemies.add(e); e.aggressed = true; e.subdue({ dir: new THREE.Vector3(0, 0, 1) });
      for (let i = 0; i < 20; i++) window.__step(1);
      G.judgement.open(e); G.judgement.select(4);
      T.post.uniforms.uDof.value = 0.9; T.post.uniforms.uFocus.value = 4;
    }
    if (sh.setup === 'volley') {   // one of every round type fired side by side down the street, caught mid-flight from just behind
      const A = [0, 1, 2, 4, 5], base = new THREE.Vector3(P.pos.x, 1.45, P.pos.z + 1.0);
      for (let i = 0; i < A.length; i++) {
        const from = base.clone().add(new THREE.Vector3((i - 2) * 0.9, 0, 0));
        T.weapons.fire('player', from, new THREE.Vector3(0, 0.001, 1), A[i], { spread: 0 });
        T.fx.muzzle(from, new THREE.Vector3(0, 0, 1), 0xffd070);
      }
      for (let k = 0; k < (sh.flight || 9); k++) window.__step(1);
      const c = T.camera; c.position.set(P.pos.x + 3.4, 1.35, P.pos.z - 2.2); c.fov = 54; c.updateProjectionMatrix(); c.lookAt(P.pos.x - 1.2, 1.4, P.pos.z + 18); c.updateMatrixWorld(true);
    }
    if (sh.title) { // the cinematic title camera at a chosen shot / time (the game is not started, so the title overlay shows)
      T.titleState.i = sh.title[0]; T.titleState.t = sh.title[1]; for (let i = 0; i < 90; i++) T.updateTitle(1 / 60);
      document.getElementById('title').classList.remove('hidden');
      const info = window.__render(); return { info, cam: [0, 0, 0], png: T.renderer.domElement.toDataURL('image/png') };
    }
    const clear = (p, tgt) => { // camera not inside a building and an unobstructed sight line to the target
      for (const b of T.world.boxes) if (p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ && p.y < b.h + 0.5) return false;
      return !T.world.rayBoxes(p, p.clone().lerp(tgt, 0.82));   // the target itself may be inside a building (the Hall): only the approach must be clear
    };
    if (sh.vantage) { // orbit the target until the sight line is clear; prefer the first azimuth that works, starting from the south
      const v = sh.vantage, tgt = new THREE.Vector3(...v.target); let best = null;
      for (let k = 0; k < 36 && !best; k++) {
        const az = Math.PI / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 18);
        const p = new THREE.Vector3(tgt.x + Math.cos(az) * v.dist * Math.cos(v.elev), tgt.y + Math.sin(v.elev) * v.dist, tgt.z + Math.sin(az) * v.dist * Math.cos(v.elev));
        if (clear(p, tgt)) best = p;
      }
      const c = T.camera; c.position.copy(best || tgt.clone().add(new THREE.Vector3(0, v.dist, v.dist * 0.2))); c.fov = v.fov || 60; c.updateProjectionMatrix(); c.lookAt(tgt); c.updateMatrixWorld(true);
      P.pos.set(c.position.x, 0, c.position.z);
    }
    if (sh.roofOf) { // stand on top of the tallest roof near a point and look down at the street
      const r = sh.roofOf; let top = null;
      for (const b of T.world.boxes) { if (Math.hypot((b.minX + b.maxX) / 2 - r.near[0], (b.minZ + b.maxZ) / 2 - r.near[1]) < r.range && b.h > 60 && b.h < 140 && (!top || b.h > top.h)) top = b; }
      if (top) {
        const c = T.camera; c.position.set(top.maxX + 2.5, top.h + 3.5, (top.minZ + top.maxZ) / 2); c.fov = r.fov || 70; c.updateProjectionMatrix();   // hovering just off the roof edge, clear of setback tiers
        c.lookAt(top.maxX + 40, Math.max(2, top.h * 0.15), (top.minZ + top.maxZ) / 2 + 14); c.updateMatrixWorld(true);
        P.pos.set(top.maxX + 12, 0, (top.minZ + top.maxZ) / 2);
      }
    }
    if (sh.facadeOf) { // frame the nearest tall building face: camera `dist` m out from it, a little off-axis, looking up at it
      const [fx, fz] = sh.facadeOf; let best = null, bd = 1e9;
      for (const b of T.world.boxes) {
        if (b.h < 35) continue; const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
        for (const [x, z, nx, nz] of [[b.minX, cz, -1, 0], [b.maxX, cz, 1, 0], [cx, b.minZ, 0, -1], [cx, b.maxZ, 0, 1]]) { const d = Math.hypot(x - fx, z - fz); if (d < bd) { bd = d; best = { x, z, nx, nz }; } }
      }
      const d = sh.dist || 9, px = -best.nz, pz = best.nx;      // perpendicular, for the off-axis offset
      const c = T.camera; c.position.set(best.x + best.nx * d + px * 3, 3.2, best.z + best.nz * d + pz * 3); c.fov = sh.fov || 55; c.updateProjectionMatrix();
      c.lookAt(best.x, sh.lookY || 12, best.z); c.updateMatrixWorld(true);
    }
    if (sh.free && sh.free.rel) {   // camera relative to the bike (x right, y up, z forward in bike space)
      const b = T.bike, f = new THREE.Vector3(Math.sin(b.yaw), 0, Math.cos(b.yaw)), r = new THREE.Vector3(-f.z, 0, f.x);
      const at = (v) => b.pos.clone().addScaledVector(r, v[0]).add(new THREE.Vector3(0, v[1], 0)).addScaledVector(f, v[2]);
      const c = T.camera; c.position.copy(at(sh.free.pos)); c.fov = sh.free.fov || 62; c.updateProjectionMatrix(); c.lookAt(at(sh.free.look)); c.updateMatrixWorld(true);
    } else if (sh.free) { const c = T.camera; c.position.set(...sh.free.pos); c.fov = sh.free.fov || 62; c.updateProjectionMatrix(); c.lookAt(...sh.free.look); c.updateMatrixWorld(true); }
    if (evalJs) new Function('T', 'G', evalJs)(T, G);
    const info = window.__render();
    const cp = T.camera.position;
    return { info, cam: [cp.x, cp.y, cp.z].map((v) => +v.toFixed(1)), png: T.renderer.domElement.toDataURL('image/png') };
  }, [sh, evalJs]);
  if (pageShot) await page.screenshot({ path: path.join(out, name + suffix + '.png'), timeout: 120000 });
  else fs.writeFileSync(path.join(out, name + suffix + '.png'), Buffer.from(r.png.split(',')[1], 'base64'));
  console.log(`${name}: ${((Date.now() - t0) / 1000).toFixed(1)}s  draw calls ${r.info.calls}  tris ${(r.info.tris / 1000).toFixed(0)}k  cam ${r.cam.join(',')}`);
}
console.log(errs.length ? 'ERRORS:\n' + errs.slice(0, +process.env.SHOT_ERRN || 8).join('\n') : 'no page errors');
await browser.close();
