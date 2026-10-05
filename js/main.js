import * as THREE from 'three';
import { G } from './state.js';
import { installHeightFog } from './shaders.js';
import { reflection } from './reflect.js';
import { createPost } from './post.js';
import { eagleShape } from './world.js';
import { buildStreetProps, updateStreetProps, streetPropStreams } from './streetprops.js';
import { input } from './input.js';
import { fx } from './fx.js';
import { audio } from './audio.js';
import { world } from './world.js';
import { weapons } from './weapons.js';
import { EnemyManager, Enemy } from './enemies.js';
import { CivManager } from './civs.js';
import { Traffic } from './traffic.js';
import { Pickups } from './pickups.js';
import { CrimeManager } from './crimes.js';
import { Player } from './player.js';
import { Character, STYLES, CLIPS, makeLawgiver, makeBaton, makePistol, makeBat } from './character.js';
import { Lawmaster, ridePose } from './bike.js';
import { hud, judgement } from './ui.js';
import { clamp, damp, rand, mulberry32 } from './util.js';

installHeightFog();
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const PR = Math.min(devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(PR);
renderer.setSize(innerWidth, innerHeight);
renderer.info.autoReset = false;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 5000);
G.scene = scene; G.camera = camera; G.renderer = renderer;
scene.add(camera); camera.layers.enable(1);   // layer 1 = ground meshes (hidden from the mirror camera, see reflect.js)

// ---------------------------------------------------------------- post (js/post.js: bloom pyramid + streaks, filmic tone map, grade)
const P = createPost(renderer, scene, camera, innerWidth, innerHeight, PR);
const { composer, post } = P;

// ---------------------------------------------------------------- quality
const QUALITY = [
  { name: 'LOW', pr: 0.75, shadows: false, bloom: false, streaks: false, ao: 0, refl: 0 },
  { name: 'MEDIUM', pr: 1.0, shadows: true, bloom: true, streaks: false, ao: 6, refl: 0.4 },
  { name: 'HIGH', pr: PR, shadows: true, bloom: true, streaks: true, ao: 10, refl: 0.55 },
];
G.quality = 2; if (navigator.webdriver) G.autoQ = true;
function setQuality(q, announce) {
  G.quality = q; const Q = QUALITY[q];
  renderer.setPixelRatio(Q.pr); P.setSize(innerWidth, innerHeight, Q.pr); P.setQuality(Q);
  world.sun.castShadow = Q.shadows; fx.setScale(innerHeight * Q.pr);
  reflection.setEnabled(Q.refl > 0, Q.refl);
  if (announce) hud.feed(`GRAPHICS: ${Q.name}`, 'good');
}

// ---------------------------------------------------------------- world & systems
fx.init(scene);
// the city layout must be the same every time: world generation mixes seeded and Math.random-based helpers, so pin Math.random while it builds
{ const realRandom = Math.random; Math.random = mulberry32(19771977); try { world.build(scene, renderer); } finally { Math.random = realRandom; } }
reflection.hide.push(...(world.mirrorHide || []));
buildStreetProps(scene);
setQuality(G.quality);
fx.setScale(innerHeight * PR);

G.enemies = new EnemyManager();
G.civs = new CivManager();
G.traffic = new Traffic();
G.pickups = new Pickups();
G.crimes = new CrimeManager();
G.perpBikes = [];
const player = new Player(scene);
G.player = player;
player.pos.copy(world.spawnPos); player.yaw = Math.PI; player.camYaw = Math.PI;
const bike = new Lawmaster(scene);
bike.place(world.spawnPos.x + 5.5, world.spawnPos.z - 3.5, Math.PI / 2 + 0.35);
G.bikeObj = bike;
G.civs.init();
G.traffic.init(34);
renderer.compile(scene, camera);   // build every shader program up front so nothing hitches the first time it comes into view
hud.init();
input.init(canvas);
G.voiceOn = true;

// spawn some ammo crates in the Hall plaza
for (let i = 0; i < 5; i++) G.pickups.spawn({ x: world.hallPos.x - 16 + i * 8, z: world.hallPos.z + 22 }, 'ammo', i + 1);
G.pickups.spawn({ x: world.hallPos.x, z: world.hallPos.z + 18 }, 'health');
G.pickups.list.forEach((p) => (p.life = 1e9));

// ---------------------------------------------------------------- mounting
G.mount = () => {
  const b = G.bikeObj; if (G.mode === 'bike') return;
  G.mode = 'bike'; player.state = 'free'; player.ch.stopClip(); player.ch.roll = 0;
  player.ch.root.removeFromParent(); b.model.add(player.ch.root);
  player.ch.root.position.set(0, 0.5, -0.58); player.ch.root.rotation.set(0, 0, 0); player.ch.pivot.rotation.x = 0;
  ridePose(player.ch, b); b.auto = false; b.called = false; b.ctrl.hold = false; b.mounted = true; G.mounted = b;
  player.camYaw = b.yaw; player.camPitch = 0.2; player.vel.set(0, 0, 0);
  audio.ui('switch'); hud.feed('LAWMASTER ONLINE', 'good');
  if (!G.rodeHint) { G.rodeHint = true; hud.feed('G — autopilot to tracked crime · SHIFT boost · H siren', ''); }
};
G.dismount = (force) => {
  const b = G.bikeObj; if (G.mode !== 'bike') return;
  G.mode = 'foot'; G.mounted = null; b.mounted = false; player.ch.override = null; player.baton.visible = true; player.lawgiver.visible = true;
  player.ch.root.removeFromParent(); scene.add(player.ch.root); player.ch.root.rotation.set(0, 0, 0);
  const r = new THREE.Vector3(Math.cos(b.yaw), 0, -Math.sin(b.yaw));
  player.pos.copy(b.pos).addScaledVector(r, 2.2); player.yaw = b.yaw; player.vel.set(0, 0, 0);
  b.ctrl.throttle = 0; b.ctrl.brake = 0; b.ctrl.hold = true; b.ctrl.steer = 0; b.ctrl.boost = false; b.ctrl.drift = false; b.auto = false;
  world.collideCircle(player.pos, 0.6);
  audio.setSiren(b.sirenOn);
};
G.callBike = () => {
  const b = G.bikeObj; if (b.called) return;
  b.called = true; b.ctrl.hold = false; b.path.pts = []; hud.feed('LAWMASTER INBOUND', 'good'); audio.ui('beep');
};

// ---------------------------------------------------------------- game flow
const titleEl = document.getElementById('title'), startBtn = document.getElementById('startbtn');
function startGame() {
  audio.init(); G.started = true; G.paused = false; titleEl.classList.add('hidden'); hud.show(true);
  player.pos.copy(world.spawnPos); post.uniforms.uFade.value = 1; post.uniforms.uDof.value = 0; camera.fov = 62; camera.updateProjectionMatrix();
  input.lock();
  G.crimes.dispatch('brawl');
  const tips = [[2500, 'Follow the gold marker to the crime scene — TAB cycles crimes'], [6000, 'Walk to the Lawmaster and press E to mount it'],
    [10000, 'On the bike: G = autopilot · SHIFT = boost · SPACE = drift · H = siren'], [16000, 'LMB = daystick combo · F = counter red-flash attacks · RMB = aim Lawgiver'],
    [22000, 'Subdued perps? Walk up and press E to judge them']];
  for (const [t, s] of tips) setTimeout(() => { if (G.started && !G.dead) hud.feed(s, 'dispatch'); }, t);
  setTimeout(() => { hud.banner('JUDGE DREDD', 'The streets are waiting', 'dispatch'); audio.voice('I am the law.'); }, 400);
}
startBtn.disabled = false; startBtn.textContent = 'ENTER THE STREETS';
startBtn.onclick = startGame;
titleEl.onclick = (e) => { if (e.target === titleEl) startGame(); };

function setPaused(v) {
  if (G.dead) return;
  G.paused = v; hud.showPause(v);
  if (v) { input.unlock(); audio.suspend?.(); } else { input.lock(); audio.resume?.(); }
}
document.getElementById('pause').onclick = () => setPaused(false);
G.onUnlock = () => { if (G.started && !G.modal && !G.paused && !G.dead && !G.mapOpen) setPaused(true); };
G.onModalClosed = () => { input.lock(); setTimeout(() => { if (!input.locked && !G.paused && !G.dead) setPaused(true); }, 350); };
G.onPlayerDeath = () => { G.dead = true; hud.showDeath(true); audio.voice('Judge down.', { pitch: 0.3 }); input.unlock(); };
G.onRespawnReady = () => {
  G.dead = false; hud.showDeath(false); player.addCred(-Math.floor(player.cred * 0.1), 'MEDICAL LEAVE'); player.respawn();
  for (const e of G.enemies.all) { e.aggro = false; if (e.state === 'engage' || e.state === 'telegraph') e.setState('idle'); }
  bike.place(world.spawnPos.x + 5.5, world.spawnPos.z - 3.5, Math.PI / 2 + 0.35); setPaused(true);
};
window.addEventListener('keydown', (e) => { if (judgement.key(e)) { e.preventDefault(); } });
G.voiceOn = true;
{ // vector eagle crest (same silhouette as the Hall / pauldron) for the title
  const pts = eagleShape().getPoints(), xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), W = 140, H = 118;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(((p.x - x0) / (x1 - x0)) * W).toFixed(1)},${(H - ((p.y - y0) / (y1 - y0)) * H).toFixed(1)}`).join('') + 'Z';
  const el = document.querySelector('#title .eagle');
  if (el) el.innerHTML = `<svg viewBox="-4 -4 ${W + 8} ${H + 8}" width="132" height="112"><defs><linearGradient id="eg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0a8"/><stop offset=".5" stop-color="#e9b02e"/><stop offset="1" stop-color="#9a6410"/></linearGradient></defs><path d="${d}" fill="url(#eg)" stroke="#3a2406" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h); P.setSize(w, h, QUALITY[G.quality].pr); camera.aspect = w / h; camera.updateProjectionMatrix(); fx.setScale(h * QUALITY[G.quality].pr);
}
addEventListener('resize', resize);

// ---------------------------------------------------------------- loop
let last = performance.now(), acc = 0, frames = 0;
function simulate(dt) {
  G.time += dt;
  const live = G.started && !G.paused;
  if (!live) return;
  if (!G.modal) {
    if (input.pressed('Tab')) G.crimes.cycleTrack();
    if (input.pressed('KeyM')) hud.toggleMap();
    if (input.pressed('KeyP')) setPaused(true);
    if (input.pressed('KeyV')) { G.voiceOn = !G.voiceOn; hud.feed(`DREDD VOICE ${G.voiceOn ? 'ON' : 'OFF'}`); }
    if (input.pressed('KeyN')) hud.feed(`MUSIC ${audio.toggleMusic() ? 'ON' : 'OFF'}`);
    if (input.pressed('F3')) G.showFps = !G.showFps;
    if (input.pressed('KeyO')) setQuality((G.quality + 2) % 3, true);
  } else if (G.mapOpen && input.pressed('KeyM')) hud.toggleMap();
  const gdt = G.modal || G.mapOpen ? 0 : dt * G.timeScale;
  if (gdt > 0) {
    player.update(gdt);
    if (G.mode === 'foot') {
      const b = bike; const c = b.ctrl;
      if (b.called) {
        const arrived = b.autopilot(gdt, player.pos);
        const d = Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z);
        if (d < 14 || arrived) { b.called = false; c.throttle = 0; c.brake = 0; c.hold = true; c.steer = 0; hud.feed('LAWMASTER HERE — [E] MOUNT', 'good'); }
      } else { c.throttle = 0; c.brake = 0; c.hold = true; c.steer = 0; c.boost = false; c.drift = false; }
      b.update(gdt);
    }
    G.enemies.update(gdt); G.civs.update(gdt); G.traffic.update(gdt); G.pickups.update(gdt); G.crimes.update(gdt); weapons.update(gdt);
  }
  world.update(G.modal ? 0 : dt, player.pos); updateStreetProps(dt, player.pos);
  fx.update(dt, gdt);
  const b = G.mode === 'bike' ? bike : null;
  const sp01 = b ? clamp((Math.abs(b.speed) - 40) / 70, 0, 1) : 0;
  const U = post.uniforms;
  U.aber.value = 0.0006 + sp01 * 0.0016 + (b && b.boosting ? 0.0016 : 0) + fx.shakeValue * 0.001;
  U.speed.value = damp(U.speed.value, b ? sp01 * 0.85 + (b.boosting ? 0.3 : 0) : 0, 5, dt);
  U.time.value = G.time % 100; U.flash.value = world.lightning || 0;
  U.hurt.value = damp(U.hurt.value, player.hp < player.maxHp * 0.3 && player.alive ? 0.7 : 0, 3, dt);
  fx.updateShocks(U.shock.value, camera);
  const engaged = G.enemies.engaged();
  audio.setIntensity(clamp(engaged * 0.22 + (b ? clamp(Math.abs(b.speed) / 100, 0, 0.4) : 0) + (player.combo > 3 ? 0.2 : 0), 0, 1));
  const bk = G.mode === 'bike' ? bike : (bike.called ? bike : null);
  audio.setEngine(!!bk, bk ? clamp(Math.abs(bk.speed) / 78, 0, 1.3) : 0, bk?.boosting);
  audio.update(dt);
  hud.update(dt);
}
// One displayed frame: the mirrored ground-reflection pass first (it refreshes the shadow map), then the main pass, which reuses that shadow map.
function renderFrame() {
  renderer.info.reset();
  const mirrored = reflection.render(renderer, scene, camera);
  if (mirrored) renderer.shadowMap.autoUpdate = false;
  composer.render();
  renderer.shadowMap.autoUpdate = true;
}
// ---------------------------------------------------------------- cinematic title: the camera glides through the Hall plaza while the city lives behind the logo
const TITLE_SHOTS = [   // all on open road / plaza so the camera never meets a building
  { a: [-58, 3.5, 57], b: [58, 7, 57], la: [-12, 26, 0], lb: [12, 30, 0], fov: 58, d: 26 },     // glide across the Hall frontage
  { a: [-8, 2.0, 60], b: [7, 10, 50], la: [0, 17, 12], lb: [0, 40, 6], fov: 46, d: 18 },         // low push in toward the doors, craning up
  { a: [-57, 2.5, 44], b: [-57, 26, 44], la: [0, 24, 10], lb: [0, 44, 6], fov: 54, d: 22 },      // crane up the plaza edge to reveal the eagle
];
const titleState = { i: 0, t: 0 };
const _ta = new THREE.Vector3(), _tl = new THREE.Vector3();
const ease = (x) => x * x * (3 - 2 * x);
function updateTitle(dt) {
  const T = titleState, S = TITLE_SHOTS[T.i];
  T.t += dt;
  const k = Math.min(1, T.t / S.d), e = ease(k);
  _ta.set(...S.a).lerp(_tl.set(...S.b), e);
  camera.position.copy(_ta); camera.position.y += Math.sin(G.time * 0.5) * 0.12;
  _tl.set(...S.la).lerp(_ta.set(...S.lb), e); camera.lookAt(_tl);
  if (camera.fov !== S.fov) { camera.fov = S.fov; camera.updateProjectionMatrix(); }
  // dip to black between shots (and fade up at the very start)
  const fadeIn = Math.min(1, T.t / 1.2), fadeOut = Math.min(1, (S.d - T.t) / 1.0);
  post.uniforms.uFade.value = Math.max(0, Math.min(fadeIn, fadeOut));
  if (T.t >= S.d) { T.i = (T.i + 1) % TITLE_SHOTS.length; T.t = 0; }
  player.pos.set(camera.position.x, 0, camera.position.z);     // keeps lamp lights / culling centred on what the camera sees
  world.update(dt, camera.position); updateStreetProps(dt, camera.position); fx.update(dt, dt);
  post.uniforms.time.value = G.time % 100; post.uniforms.flash.value = world.lightning || 0;
  const Ut = post.uniforms; Ut.uDof.value = QUALITY[G.quality].ao ? 0.8 : 0; Ut.uFocus.value = camera.position.distanceTo(_tl) * 0.95;
}
// depth of field on the cinematic moments only: pause / map, the finisher camera, the judgement dialog
function updateDof(dt) {
  if (!G.started) return;
  const U = post.uniforms; let target = 0, focus = U.uFocus.value;
  if (G.paused || G.mapOpen) { target = 1; focus = camera.position.distanceTo(player.pos) + 0.5; }
  else if (G.finisherCam) { target = 0.55; focus = camera.position.distanceTo(player.pos) + 0.3; }
  else if (G.modal) { target = 0.9; focus = 4; }
  U.uDof.value = damp(U.uDof.value, QUALITY[G.quality].ao ? target : 0, 5, dt); U.uFocus.value = damp(U.uFocus.value, focus, 8, dt);
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
  if (!G.started && !window.__noRender) updateTitle(dt);
  simulate(dt); updateDof(dt);
  if (!window.__noRender) renderFrame();
  input.endFrame();
  frames++; acc += dt;
  if (acc > 1) {
    G.fps = frames / acc; frames = 0; acc = 0;
    // auto-detect: a few consecutive slow seconds => step quality down once
    if (G.started && !G.paused && !G.modal) { if (G.fps < 28 && G.quality > 0 && !G.autoQ) { G.slow = (G.slow || 0) + 1; if (G.slow >= 4) { G.autoQ = true; setQuality(G.quality - 1, true); hud.feed('Low frame rate detected — press O to change graphics', ''); } } else G.slow = 0; }
  }
}
document.getElementById('boot').style.display = 'none';
requestAnimationFrame(frame);

// debug / test hooks
window.__G = G; window.__test = { THREE, world, player, bike, hud, fx, weapons, startGame, setPaused, input, Enemy, Character, makeLawgiver, makeBaton };
window.__step = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) { simulate(dt); input.endFrame(); } };
// still-frame rig (tools/shots.mjs): render exactly one frame on demand, with the live loop's render skipped via window.__noRender
Object.assign(window.__test, { renderer, composer, camera, scene, post, bloom: P.bloom, QUALITY, setQuality, STYLES, CLIPS, makePistol, makeBat, updateTitle, titleState, TITLE_SHOTS, streetPropStreams });
window.__render = () => { renderFrame(); const i = renderer.info.render; return { calls: i.calls, tris: i.triangles }; };
