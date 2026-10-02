import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { G } from './state.js';
import { installHeightFog } from './shaders.js';
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
import { Character, makeLawgiver, makeBaton } from './character.js';
import { Lawmaster, ridePose } from './bike.js';
import { hud, judgement } from './ui.js';
import { clamp, damp, rand } from './util.js';

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
scene.add(camera);

// ---------------------------------------------------------------- post
const rt = new THREE.WebGLRenderTarget(innerWidth * PR, innerHeight * PR, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(PR);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.2, 0.35, 1.2);
composer.addPass(bloom);
const post = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, aber: { value: 0.0008 }, vig: { value: 0.4 }, grain: { value: 0.022 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time, aber, vig, grain; varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5; float d = dot(c,c);
      vec2 off = c * aber * (1.0 + d*8.0);
      vec3 col = vec3(texture2D(tDiffuse, vUv+off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv-off).b);
      col *= 1.0 - d*vig*2.2;
      float n = fract(sin(dot(vUv*1000.0 + time, vec2(12.9898,78.233)))*43758.5453);
      col += (n-0.5)*grain;
      col = mix(col, col*vec3(0.94,1.0,1.1), 0.35);
      gl_FragColor = vec4(col,1.0);
    }`,
});
composer.addPass(post);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------- quality
const QUALITY = [
  { name: 'LOW', pr: 0.75, shadows: false, bloom: false },
  { name: 'MEDIUM', pr: 1.0, shadows: true, bloom: true },
  { name: 'HIGH', pr: PR, shadows: true, bloom: true },
];
G.quality = 2; if (navigator.webdriver) G.autoQ = true;
function setQuality(q, announce) {
  G.quality = q; const Q = QUALITY[q];
  renderer.setPixelRatio(Q.pr); composer.setPixelRatio(Q.pr); composer.setSize(innerWidth, innerHeight);
  world.sun.castShadow = Q.shadows; bloom.enabled = Q.bloom; fx.setScale(innerHeight * Q.pr);
  if (announce) hud.feed(`GRAPHICS: ${Q.name}`, 'good');
}

// ---------------------------------------------------------------- world & systems
fx.init(scene);
world.build(scene, renderer);
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
bike.place(world.spawnPos.x + 2.6, world.spawnPos.z + 3, 0);
G.bikeObj = bike;
G.civs.init();
G.traffic.init(34);
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
  bike.place(world.spawnPos.x + 2.6, world.spawnPos.z + 3, 0); setPaused(true);
};
window.addEventListener('keydown', (e) => { if (judgement.key(e)) { e.preventDefault(); } });
G.voiceOn = true;

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); fx.setScale(h * QUALITY[G.quality].pr);
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
  world.update(G.modal ? 0 : dt, player.pos);
  fx.update(dt, gdt);
  const b = G.mode === 'bike' ? bike : null;
  const aber = 0.0008 + (b ? clamp((Math.abs(b.speed) - 50) / 80, 0, 1) * 0.0022 + (b.boosting ? 0.002 : 0) : 0) + fx.shakeValue * 0.0012;
  post.uniforms.aber.value = aber; post.uniforms.time.value = G.time % 100;
  const engaged = G.enemies.engaged();
  audio.setIntensity(clamp(engaged * 0.22 + (b ? clamp(Math.abs(b.speed) / 100, 0, 0.4) : 0) + (player.combo > 3 ? 0.2 : 0), 0, 1));
  const bk = G.mode === 'bike' ? bike : (bike.called ? bike : null);
  audio.setEngine(!!bk, bk ? clamp(Math.abs(bk.speed) / 78, 0, 1.3) : 0, bk?.boosting);
  audio.update(dt);
  hud.update(dt);
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
  simulate(dt);
  renderer.info.reset();
  if (!window.__noRender) composer.render();
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
