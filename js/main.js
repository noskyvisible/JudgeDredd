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
import { Character, STYLES, CLIPS, makeLawgiver, makeBaton, makePistol, makeBat } from './character.js';
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
// scrub NaN / Inf / absurd HDR values before bloom: a single bad pixel would otherwise get blurred across the whole screen (black frame)
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0); gl_FragColor = vec4(clamp(c.rgb, 0.0, 48.0), 1.0); }',
}));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.2, 0.35, 1.2);
composer.addPass(bloom);
const post = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null }, time: { value: 0 }, res: { value: new THREE.Vector2(innerWidth, innerHeight) },
    aber: { value: 0.0006 }, vig: { value: 0.42 }, grain: { value: 0.02 }, speed: { value: 0 }, sharpen: { value: 0.35 },
    sat: { value: 1.08 }, contrast: { value: 1.06 }, flash: { value: 0 }, hurt: { value: 0 },
    shock: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 res; uniform float time, aber, vig, grain, speed, sharpen, sat, contrast, flash, hurt; uniform vec4 shock[4]; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 uv = vUv; float aspect = res.x / res.y;
      // expanding shockwave rings bend the image
      for (int i = 0; i < 4; i++) {
        vec4 s = shock[i];
        if (s.w > 0.001) {
          vec2 d = uv - s.xy; d.x *= aspect; float r = length(d);
          float ring = exp(-pow((r - s.z) / 0.045, 2.0));
          vec2 dir = d / (r + 1e-4); dir.x /= aspect;
          uv -= dir * ring * s.w * 0.05;
        }
      }
      vec2 c = uv - 0.5; float d2 = dot(c, c);
      vec3 col;
      if (speed > 0.01) { // radial speed blur
        vec3 acc = vec3(0.0);
        for (int i = 0; i < 8; i++) { float t = float(i) / 7.0; acc += texture2D(tDiffuse, 0.5 + c * (1.0 - speed * 0.07 * t)).rgb; }
        col = acc / 8.0;
      } else col = texture2D(tDiffuse, uv).rgb;
      vec2 off = c * aber * (1.0 + d2 * 8.0);
      col.r = texture2D(tDiffuse, uv + off).r * (speed > 0.01 ? 1.0 : 1.0) * 0.5 + col.r * 0.5;
      col.b = texture2D(tDiffuse, uv - off).b * 0.5 + col.b * 0.5;
      // unsharp mask
      vec2 px = 1.0 / res;
      vec3 bl = (texture2D(tDiffuse, uv + vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, uv - vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, uv + vec2(0.0, px.y)).rgb + texture2D(tDiffuse, uv - vec2(0.0, px.y)).rgb) * 0.25;
      col += (col - bl) * sharpen;
      // grade: teal-violet shadows, warm highlights, mild S-curve
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, sat);
      col = (col - 0.5) * contrast + 0.5;
      col += vec3(-0.012, 0.004, 0.03) * (1.0 - smoothstep(0.0, 0.5, l)) + vec3(0.03, 0.012, -0.015) * smoothstep(0.45, 1.0, l);
      col += vec3(0.55, 0.6, 0.9) * flash * 0.12;
      col *= 1.0 - d2 * vig * 2.0;
      col = mix(col, col * vec3(1.15, 0.55, 0.55), hurt * smoothstep(0.1, 0.45, d2));
      col += (hash(vUv * res + time) - 0.5) * grain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
});
composer.addPass(new OutputPass());
composer.addPass(post);

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

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h); composer.setSize(w, h); post.uniforms.res.value.set(w * QUALITY[G.quality].pr, h * QUALITY[G.quality].pr); camera.aspect = w / h; camera.updateProjectionMatrix(); fx.setScale(h * QUALITY[G.quality].pr);
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
// still-frame rig (tools/shots.mjs): render exactly one frame on demand, with the live loop's render skipped via window.__noRender
Object.assign(window.__test, { renderer, composer, camera, scene, post, bloom, QUALITY, setQuality, STYLES, CLIPS, makePistol, makeBat });
window.__render = () => { renderer.info.reset(); composer.render(); const i = renderer.info.render; return { calls: i.calls, tris: i.triangles }; };
