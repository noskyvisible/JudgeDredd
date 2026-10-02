import * as THREE from 'three';
import { G } from './state.js';
import { fx } from './fx.js';
import { audio } from './audio.js';
import { world, roadX, N } from './world.js';
import { weapons } from './weapons.js';
import { Enemy, TYPES } from './enemies.js';
import { PerpBike } from './bike.js';
import { rand, pick, chance, clamp, randInt, makeCanvas, canvasTex } from './util.js';

export const SENTENCES = [
  { label: 'FINE / WARNING', short: 'Fine' }, { label: '30 DAYS', short: '30 days' }, { label: '1 YEAR', short: '1 yr' }, { label: '2 YEARS', short: '2 yrs' },
  { label: '5 YEARS', short: '5 yrs' }, { label: '10 YEARS', short: '10 yrs' }, { label: '20 YEARS', short: '20 yrs' }, { label: 'LIFE', short: 'Life' },
];

export const CRIMES = {
  jaywalking: { name: 'Jaywalking', statute: 'Traffic Code §12.4', tier: 0 },
  littering: { name: 'Littering', statute: 'Sanitation Act §3.1', tier: 0 },
  smoking: { name: 'Illegal Smoking', statute: 'Public Health §77', tier: 1 },
  noise: { name: 'Disturbing the Peace', statute: 'Civil Order §9', tier: 1 },
  vandalism: { name: 'Vandalism & Graffiti', statute: 'Property Code §19', tier: 2 },
  hotdogging: { name: 'Hotdogging (Reckless Riding)', statute: 'Traffic Code §41', tier: 2 },
  assault: { name: 'Assault', statute: 'Persons Act §5', tier: 3 },
  mugging: { name: 'Mugging', statute: 'Persons Act §8', tier: 4 },
  armedrobbery: { name: 'Armed Robbery', statute: 'Theft Act §14', tier: 4 },
  slomo: { name: 'Slo-Mo Dealing', statute: 'Narcotics §31', tier: 4 },
  weapons: { name: 'Illegal Weapons Possession', statute: 'Arms Act §22', tier: 4 },
  arson: { name: 'Arson', statute: 'Property Code §44', tier: 5 },
  hostage: { name: 'Hostage-Taking', statute: 'Persons Act §17', tier: 5 },
  gangwar: { name: 'Gang Violence', statute: 'Public Order §60', tier: 5 },
  kidnap: { name: 'Kidnapping', statute: 'Persons Act §21', tier: 6 },
  terrorism: { name: 'Terrorism', statute: 'Sedition Act §1', tier: 7 },
};

// minRank gates when scenarios start appearing
export const SCENARIOS = {
  jaywalker: { title: 'Jaywalking', sev: 1, w: 3, minRank: 0, time: 200, desc: 'Citizen crossing against the signal.', perps: [{ t: 'meek', crimes: ['jaywalking'] }] },
  litter: { title: 'Littering', sev: 1, w: 2, minRank: 0, time: 200, desc: 'Citizen dumping rubbish on the sidewalk.', perps: [{ t: 'meek', crimes: ['littering'] }] },
  smoker: { title: 'Illegal Smoking', sev: 1, w: 2, minRank: 0, time: 200, desc: 'Citizen smoking in a restricted zone.', perps: [{ t: 'meek', crimes: ['smoking'] }, { t: 'meek', crimes: ['noise'] }] },
  vandals: { title: 'Vandalism', sev: 2, w: 3, minRank: 0, time: 180, desc: 'Gang of kids spraying graffiti on a Block wall.', perps: [{ t: 'meek', crimes: ['vandalism'] }, { t: 'meek', crimes: ['vandalism'] }, { t: 'meek', crimes: ['vandalism', 'noise'] }] },
  brawl: { title: 'Street Brawl', sev: 2, w: 4, minRank: 0, time: 180, desc: 'A mob is beating a citizen. Respond.', perps: [{ t: 'thug', crimes: ['assault'] }, { t: 'thug', crimes: ['assault'] }, { t: 'thug', crimes: ['assault'] }], victims: 1 },
  hotdog: { title: 'Hotdogger!', sev: 2, w: 3, minRank: 0, time: 240, desc: 'Reckless rider tearing through the sector. Run him down.', chase: true },
  mugging: { title: 'Mugging in progress', sev: 3, w: 4, minRank: 1, time: 160, desc: 'Armed muggers have cornered a citizen.', perps: [{ t: 'thug', crimes: ['mugging'] }, { t: 'gunman', crimes: ['mugging', 'weapons'] }], victims: 1 },
  robbery: { title: 'Armed Robbery', sev: 3, w: 4, minRank: 1, time: 160, desc: 'Gunmen are holding up a Slurp-O-Mat.', perps: [{ t: 'gunman', crimes: ['armedrobbery'] }, { t: 'gunman', crimes: ['armedrobbery'] }, { t: 'thug', crimes: ['armedrobbery'] }], victims: 2 },
  slomo: { title: 'Slo-Mo Dealers', sev: 3, w: 3, minRank: 1, time: 170, desc: 'Dealers are moving Slo-Mo on the street.', perps: [{ t: 'junkie', crimes: ['slomo'] }, { t: 'junkie', crimes: ['slomo'] }, { t: 'gunman', crimes: ['slomo', 'weapons'] }] },
  weapons: { title: 'Black-Market Arms Deal', sev: 4, w: 3, minRank: 2, time: 180, desc: 'Illegal weapons exchange. Heavily armed.', perps: [{ t: 'gunman', crimes: ['weapons'] }, { t: 'gunman', crimes: ['weapons'] }, { t: 'brute', crimes: ['weapons'] }] },
  arson: { title: 'Arson Attack', sev: 4, w: 3, minRank: 2, time: 170, desc: 'Fire-starters torching a Block entrance.', perps: [{ t: 'thug', crimes: ['arson'] }, { t: 'thug', crimes: ['arson'] }, { t: 'junkie', crimes: ['arson'] }], fires: 3 },
  hostage: { title: 'Hostage Situation', sev: 4, w: 3, minRank: 2, time: 150, desc: 'Gunmen have taken a citizen hostage.', perps: [{ t: 'gunman', crimes: ['hostage', 'weapons'] }, { t: 'gunman', crimes: ['hostage'] }], hostages: 1 },
  gangwar: { title: 'Gang War', sev: 5, w: 3, minRank: 3, time: 200, desc: 'Rival gangs are tearing the intersection apart.', perps: [{ t: 'thug', crimes: ['gangwar'] }, { t: 'thug', crimes: ['gangwar'] }, { t: 'gunman', crimes: ['gangwar', 'weapons'] }, { t: 'gunman', crimes: ['gangwar'] }, { t: 'brute', crimes: ['gangwar', 'assault'] }] },
  bomb: { title: 'Terrorist Bomb Threat', sev: 5, w: 3, minRank: 3, time: 220, desc: 'Armed fanatics have planted a bomb. Defuse it!', perps: [{ t: 'gunman', crimes: ['terrorism'] }, { t: 'gunman', crimes: ['terrorism'] }, { t: 'brute', crimes: ['terrorism'] }], bomb: true },
  boss: { title: 'Block Boss', sev: 5, w: 2, minRank: 4, time: 240, desc: 'A Block Boss and his crew have seized the street.', perps: [{ t: 'boss', crimes: ['gangwar', 'assault', 'weapons'] }, { t: 'thug', crimes: ['gangwar'] }, { t: 'thug', crimes: ['gangwar'] }, { t: 'gunman', crimes: ['gangwar'] }, { t: 'gunman', crimes: ['gangwar'] }] },
};

const SEV_COL = [0, 0x60c0ff, 0x70ff90, 0xffe040, 0xff9030, 0xff3030];
const beaconGeo = new THREE.CylinderGeometry(2.2, 2.2, 700, 16, 1, true).translate(0, 350, 0);
const beaconMat = (c) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  uniforms: { col: { value: new THREE.Color(c) }, time: { value: 0 }, near: { value: 1 } },
  vertexShader: 'varying float vY; varying vec3 vN; void main(){ vY = position.y; vN = normal; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
  fragmentShader: 'uniform vec3 col; uniform float time; uniform float near; varying float vY; void main(){ float a = (0.55 + 0.25*sin(vY*0.05 - time*3.0)) * (1.0 - vY/700.0*0.6) * near; gl_FragColor = vec4(col*1.6, a*0.5); }',
});

class CrimeScene {
  constructor(key, def, pos, id) {
    this.key = key; this.def = def; this.pos = pos.clone(); this.id = id; this.title = def.title; this.sev = def.sev;
    this.time = def.time; this.timeLeft = def.time; this.state = 'dispatched'; this.spawned = false;
    this.perps = []; this.victims = []; this.bomb = null; this.fires = []; this.bike = null; this.dead = 0; this.judgedN = 0;
    this.district = world.district(pos.x, pos.z); this.escapeT = 0; this.alerted = false; this.age = 0; this.bombStarted = false;
    this.color = SEV_COL[def.sev];
    // beacon
    this.beacon = new THREE.Mesh(beaconGeo, beaconMat(this.color)); this.beacon.position.set(pos.x, 0, pos.z); this.beacon.renderOrder = 6; G.scene.add(this.beacon);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(12.2, 12.9, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.6, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.ring.position.set(pos.x, 0.12, pos.z); G.scene.add(this.ring);
    this.light = null;
  }
  get dist() { return Math.hypot(G.player.pos.x - this.pos.x, G.player.pos.z - this.pos.z); }
  get remaining() { return this.perps.filter((e) => !e.removed && !e.judged && e.state !== 'dead').length; }

  spawn() {
    this.spawned = true;
    const def = this.def;
    const spot = (r0 = 3, r1 = 9) => { const a = rand(0, 6.28), r = rand(r0, r1); return new THREE.Vector3(this.pos.x + clamp(Math.cos(a) * r, -9, 9), 0, this.pos.z + clamp(Math.sin(a) * r, -9, 9)); };
    if (def.perps) def.perps.forEach((p) => {
      const e = new Enemy(p.t, spot(), { crimes: p.crimes, scene: this }); G.enemies.add(e); this.perps.push(e);
      if (p.t === 'meek') { e.hostile = false; }
    });
    if (def.victims) for (let i = 0; i < def.victims; i++) { const c = G.civs.spawnVictim(spot(2, 6)); this.victims.push(c); }
    if (def.hostages) { const h = G.civs.spawnVictim(spot(1, 3)); h.setHostage(); this.victims.push(h); if (this.perps[0]) { h.pos.copy(this.perps[0].pos).add(new THREE.Vector3(0.8, 0, 0.8)); this.perps[0].holding = h; } }
    if (def.fires) for (let i = 0; i < def.fires; i++) { const p = spot(4, 9); weapons.firePatches.push({ pos: new THREE.Vector3(p.x, 0, p.z), r: 3, t: 9999, tick: 0, owner: this }); }
    if (def.bomb) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.8), new THREE.MeshStandardMaterial({ color: 0x2a2a2e, metalness: 0.7, roughness: 0.4 }));
      body.position.y = 0.4; g.add(body);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false })); lamp.position.set(0, 0.95, 0); g.add(lamp);
      const bp = this.pos.clone(); g.position.copy(bp); G.scene.add(g);
      this.bomb = { mesh: g, lamp, pos: bp, timer: 80, progress: 0, active: true, scene: this };
    }
    if (def.chase) {
      const b = new PerpBike(G.scene, this); const p = spot(0, 3); b.place(p.x, p.z, Math.floor(rand(0, 4)) * Math.PI / 2);
      b.perpScene = this; b.provoked = false; this.bike = b; (G.perpBikes ||= []).push(b);
      b.onWreck = () => this.bikeWrecked(b);
    }
    // flashing hazard lights at scene
    this.flare = 0;
  }
  bikeWrecked(b) {
    const e = new Enemy('thug', b.pos.clone().add(new THREE.Vector3(1.5, 0, 0)), { crimes: ['hotdogging'], scene: this });
    e.ch.root.removeFromParent(); G.scene.add(e.ch.root);
    e.name = 'Speed Demon ' + e.name.split(' ')[1]; e.hostile = true; e.armed = false; e.aggressed = false; e.hp = 0; e.priors = 2;
    G.enemies.add(e); this.perps.push(e); e.subdue({ dir: new THREE.Vector3(1, 0, 0) });
    fx.text(b.pos.clone().setY(3), 'BIKE DOWN!', 'good'); G.hud?.banner('PERP DOWN', 'Judge the rider', 'good'); audio.ui('confirm');
    audio.explosion(0.5, b.pos);
  }
  alert() {
    if (this.alerted) return; this.alerted = true;
    for (const e of this.perps) if (e.hostile && e.active) e.aggro = true;
    if (this.bike) this.bike.provoked = true;
  }
  onPerpDown(e) { this.check(); }
  onPerpDead(e) { this.dead++; if (e.holding) { e.holding.state = 'panic'; e.holding.hostage = false; e.holding.panic(e.pos, 1); } this.check(); }
  perpJudged(e) { this.judgedN++; this.check(); }

  check() {
    if (this.state === 'resolved' || this.state === 'failed') return;
    if (this.def.chase && !this.perps.length) return;
    const open = this.perps.filter((e) => !e.removed && !e.judged && e.state !== 'dead');
    if (!open.length) this.complete();
  }
  complete() {
    this.state = 'resolved';
    const n = this.perps.length || 1;
    const deadFrac = this.dead / n;
    const bonus = Math.round(this.sev * 25 * (1 - 0.6 * deadFrac));
    const lvl = this.sev * 6;
    G.player.addCred(bonus, `CASE CLOSED — ${this.title.toUpperCase()}`);
    G.player.stats.crimes++;
    G.crimes.crimeLevel = Math.max(0, G.crimes.crimeLevel - lvl);
    G.hud?.banner('CASE CLOSED', this.title, 'good'); audio.ui('confirm');
    audio.voice('Court is adjourned.');
    this.cleanup(false);
    G.crimes.sceneEnded(this);
  }
  fail(reason) {
    this.state = 'failed';
    G.player.addCred(-10 * this.sev, 'CRIME UNRESOLVED');
    G.crimes.crimeLevel = Math.min(100, G.crimes.crimeLevel + this.sev * 8);
    G.hud?.banner('CRIME UNRESOLVED', reason || this.title, 'bad'); audio.ui('error');
    this.cleanup(true);
    G.crimes.sceneEnded(this);
  }
  cleanup(despawnEntities) {
    G.scene.remove(this.beacon); G.scene.remove(this.ring);
    for (let i = weapons.firePatches.length - 1; i >= 0; i--) if (weapons.firePatches[i].owner === this) weapons.firePatches.splice(i, 1);
    if (this.bomb) { G.scene.remove(this.bomb.mesh); this.bomb.active = false; }
    for (const v of this.victims) { v.victim = false; v.hostage = false; if (v.state === 'cower') { v.state = 'panic'; v.panic(this.pos, 1); } }
    if (despawnEntities) { for (const e of this.perps) if (!e.removed && !e.judged) { e.remove(); } }
    if (this.bike && !despawnEntities) { /* wreck stays */ }
    if (this.bike && despawnEntities) { G.scene.remove(this.bike.model); G.perpBikes = G.perpBikes.filter((b) => b !== this.bike); }
  }
  explodeBomb() {
    const b = this.bomb; b.active = false;
    fx.explosion(b.pos.clone().setY(1), 2.2); audio.explosion(2.5, b.pos); fx.shake(2);
    G.player.blastCheck(b.pos, 28, 70); G.civs.panic(b.pos, 80);
    for (const t of G.enemies.targets()) { const d = Math.hypot(t.pos.x - b.pos.x, t.pos.z - b.pos.z); if (d < 25) t.hurt(80, { type: 'explosive', dir: new THREE.Vector3(t.pos.x - b.pos.x, 0.5, t.pos.z - b.pos.z).normalize(), knock: 12 }); }
    G.scene.remove(b.mesh);
    this.bomb = null;
    this.fail('The bomb detonated');
  }

  update(dt) {
    this.age += dt;
    const d = this.dist;
    const pulse = 0.5 + 0.5 * Math.sin(G.time * 4);
    this.ring.material.opacity = 0.18 + pulse * 0.25; this.ring.scale.setScalar(1 + pulse * 0.06);
    this.beacon.material.uniforms.time.value = G.time;
    this.beacon.material.uniforms.near.value = d < 60 ? Math.max(0.15, d / 60) : 1;
    if (this.state === 'resolved' || this.state === 'failed') return;
    if (!this.spawned && d < 230) this.spawn();
    if (this.spawned && d > 520 && !this.perps.some((e) => e.state === 'surrender' || e.state === 'subdued') && !this.bike) { this.despawn(); }
    if (d > 80 || !this.spawned) this.timeLeft -= dt; else this.timeLeft -= dt * 0.25;
    if (this.timeLeft <= 0 && this.state !== 'resolved') { if (!this.bike || d > 100) return this.fail('Time expired'); }
    // hazard lights
    if (this.spawned && d < 120 && Math.random() < dt * 4) fx.glowPuff(new THREE.Vector3(this.pos.x + rand(-9, 9), 0.8, this.pos.z + rand(-9, 9)), chance(0.5) ? 0xff3030 : 0x3080ff, 2.2, 0.15);
    // fires
    if (this.def.fires && this.spawned) for (const f of weapons.firePatches) if (f.owner === this && d < 120) fx.fire(new THREE.Vector3(f.pos.x + rand(-1.5, 1.5), 0.3, f.pos.z + rand(-1.5, 1.5)), 1, 2.2);
    // bomb
    if (this.bomb) {
      const b = this.bomb;
      if (!this.bombStarted && d < 90) { this.bombStarted = true; G.hud?.banner('BOMB ARMED', 'Defuse before it detonates', 'bad'); audio.ui('error'); }
      if (this.bombStarted) {
        b.timer -= dt;
        const rate = b.timer < 15 ? 8 : 3; b.lamp.material.color.setRGB(Math.sin(G.time * rate * 2) > 0 ? 4 : 0.3, 0.1, 0.1);
        if (Math.floor(b.timer * 2) !== Math.floor((b.timer + dt) * 2)) audio.ui('tick');
        if (b.timer <= 0) this.explodeBomb();
      }
    }
    // pursuit bike
    if (this.bike && !this.bike.crashed) {
      const bd = Math.hypot(G.player.pos.x - this.bike.pos.x, G.player.pos.z - this.bike.pos.z);
      this.beacon.position.set(this.bike.pos.x, 0, this.bike.pos.z); this.ring.position.set(this.bike.pos.x, 0.12, this.bike.pos.z); this.pos.copy(this.bike.pos);
      if (bd > 450) { this.escapeT += dt; if (this.escapeT > 25) { this.fail('The hotdogger got away'); } } else this.escapeT = 0;
    }
    if (this.bike && this.bike.crashed) { this.pos.copy(this.bike.pos); this.beacon.position.set(this.pos.x, 0, this.pos.z); this.ring.position.set(this.pos.x, 0.12, this.pos.z); }
    // hostage handling: hostage stays with captor
    for (const e of this.perps) if (e.holding && !e.removed && e.state !== 'dead' && e.state !== 'surrender' && e.state !== 'subdued') { e.holding.pos.set(e.pos.x + Math.sin(e.yaw) * 0.9 + 0.4, 0, e.pos.z + Math.cos(e.yaw) * 0.9); }
    // victims that are no longer needed
    if (this.state === 'dispatched' && this.spawned && this.perps.some((e) => e.aggro)) this.state = 'active';
  }
  despawn() {
    this.spawned = false;
    for (const e of this.perps) e.remove(); this.perps = [];
    for (const v of this.victims) v.remove(); this.victims = [];
    if (this.bomb) { G.scene.remove(this.bomb.mesh); this.bomb = null; }
    for (let i = weapons.firePatches.length - 1; i >= 0; i--) if (weapons.firePatches[i].owner === this) weapons.firePatches.splice(i, 1);
  }
}

// ---------------------------------------------------------------------------
// Justice Department wagon with a tractor beam that hauls judged perps away
// ---------------------------------------------------------------------------
class Wagon {
  constructor(perp) {
    this.perp = perp; this.t = 0;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.8, 7.5), new THREE.MeshStandardMaterial({ color: 0x1b1d24, metalness: 0.8, roughness: 0.3 })); g.add(body);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.25, 0.35, 7.55), new THREE.MeshStandardMaterial({ color: 0xe8b52a, metalness: 0.9, roughness: 0.3 })); stripe.position.y = 0.2; g.add(stripe);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.1, 2.2), new THREE.MeshStandardMaterial({ color: 0x0a1626, metalness: 0.9, roughness: 0.1 })); cab.position.set(0, 1.2, 2.4); g.add(cab);
    this.red = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.5), new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false })); this.red.position.set(-0.8, 1.1, 0); g.add(this.red);
    this.blue = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.5), new THREE.MeshBasicMaterial({ color: 0x2060ff, toneMapped: false })); this.blue.position.set(0.8, 1.1, 0); g.add(this.blue);
    for (const [x, z] of [[-1.6, -2.8], [1.6, -2.8], [-1.6, 2.5], [1.6, 2.5]]) { const j = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.3, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x40b0ff).multiplyScalar(2.5), toneMapped: false })); j.position.set(x, -1.0, z); g.add(j); }
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 2.4, 1, 20, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.8, 2.2), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    this.beam = beam; g.add(beam);
    this.g = g;
    this.target = perp.pos.clone();
    g.position.set(this.target.x + rand(-60, 60), 70, this.target.z + rand(-60, 60));
    this.start = g.position.clone();
    this.hover = new THREE.Vector3(this.target.x, 9, this.target.z);
    G.scene.add(g);
    this.done = false;
    this.light = null;
  }
  update(dt) {
    this.t += dt; const t = this.t, g = this.g;
    const ph = Math.floor(t * 6) % 2; this.red.material.color.setRGB(ph ? 3 : 0.2, 0.1, 0.1); this.blue.material.color.setRGB(0.1, 0.2, ph ? 0.2 : 3);
    const yawTo = Math.atan2(this.target.x - g.position.x, this.target.z - g.position.z);
    if (t < 2.4) { // arrive
      const k = t / 2.4, e = 1 - Math.pow(1 - k, 3);
      g.position.lerpVectors(this.start, this.hover, e); g.rotation.y = yawTo; g.rotation.x = 0.1 * (1 - k);
      this.beam.visible = false;
    } else if (t < 5.0) { // beam up
      g.position.copy(this.hover); g.position.y += Math.sin(t * 2) * 0.2; this.beam.visible = true;
      const k = (t - 2.4) / 2.6; const h = g.position.y - 0.9; this.beam.scale.set(1, h, 1); this.beam.position.y = -h / 2 - 0.9;
      const p = this.perp; p.pos.y = k * k * 6.5; p.ch.root.position.y = p.pos.y; p.ch.root.rotation.y += dt * 3;
      if (!p.removed) { fx.glowPuff(new THREE.Vector3(p.pos.x, p.pos.y + 1, p.pos.z), 0x60c0ff, 2.5, 0.25); }
      if (Math.random() < 0.5) fx.add.emit(this.target.x + rand(-1.5, 1.5), 0.2, this.target.z + rand(-1.5, 1.5), 0, rand(5, 9), 0, 0.5, 1.0, 2.5, 0.8, 0.2, 0.7, 0, 0, 0);
    } else if (t < 7) { // depart
      this.beam.visible = false; if (!this.perp.removed) this.perp.remove();
      const k = (t - 5) / 2; g.position.y = this.hover.y + k * k * 90; g.position.z += dt * 10 * k; g.rotation.x = -0.15 * k;
    } else { G.scene.remove(g); this.done = true; }
  }
}

// ---------------------------------------------------------------------------
export class CrimeManager {
  constructor() {
    this.scenes = []; this.wagons = []; this.nextId = 1; this.spawnT = 4; this.crimeLevel = 12; this.tracked = null; this.total = 0; this.first = true;
  }
  get active() { return this.scenes.filter((s) => s.state === 'dispatched' || s.state === 'active'); }
  trackedScene() { return this.active.includes(this.tracked) ? this.tracked : (this.tracked = this.nearestScene()); }
  trackedPos() { return this.trackedScene()?.pos || null; }
  nearestScene() { let b = null, bd = 1e9; for (const s of this.active) { const d = s.dist; if (d < bd) { bd = d; b = s; } } return b; }
  cycleTrack() {
    const a = this.active; if (!a.length) return; const i = a.indexOf(this.tracked); this.tracked = a[(i + 1) % a.length]; audio.ui('select');
    G.hud?.feed(`TRACKING: ${this.tracked.title.toUpperCase()}`, 'good');
  }
  nearestBomb(pos, r) { for (const s of this.scenes) if (s.bomb && s.bomb.active && s.bombStarted !== undefined && Math.hypot(s.bomb.pos.x - pos.x, s.bomb.pos.z - pos.z) < r) return s.bomb; return null; }
  defuse(bomb) {
    bomb.active = false; const s = bomb.scene; G.scene.remove(bomb.mesh); s.bomb = null;
    G.player.addCred(60, 'BOMB DEFUSED'); G.hud?.banner('BOMB DEFUSED', 'Disaster averted', 'good'); audio.ui('confirm');
    fx.burst(bomb.pos.clone().setY(1), 20, 0x40ff90, 6, 0.3, 0.6);
    s.check();
  }
  gunshot(pos) { for (const s of this.scenes) if (s.spawned && s.state !== 'resolved' && Math.hypot(s.pos.x - pos.x, s.pos.z - pos.z) < 60) s.alert(); }
  civilianLost(c) { this.crimeLevel = Math.min(100, this.crimeLevel + 6); }
  sceneEnded(s) { if (this.tracked === s) this.tracked = null; setTimeout(() => { this.scenes = this.scenes.filter((x) => x !== s); }, 9000); }

  dispatch(forceKey) {
    const pl = G.player; const rank = pl.rank;
    let key = forceKey;
    if (!key) {
      const pool = Object.entries(SCENARIOS).filter(([k, s]) => s.minRank <= rank && !this.active.some((a) => a.key === k));
      if (this.first) { key = 'brawl'; this.first = false; }
      else { let tot = pool.reduce((a, [, s]) => a + s.w, 0), r = Math.random() * tot; for (const [k, s] of pool) { r -= s.w; if (r <= 0) { key = k; break; } } key = key || pool[0][0]; }
    }
    const def = SCENARIOS[key];
    const near = G.mode === 'bike' || this.total > 0 ? 260 : 150;
    const it = world.randomIntersection(pl.pos, near, 700);
    const s = new CrimeScene(key, def, it.pos, this.nextId++);
    this.scenes.push(s); this.total++;
    const msg = `${def.title.toUpperCase()} — ${s.district}`;
    G.hud?.banner('DISPATCH', msg, 'dispatch'); G.hud?.feed(`DISPATCH: ${def.desc}`, 'dispatch');
    audio.ui('dispatch'); audio.voice(`Dispatch. ${def.title}, ${s.district}. All units respond.`, { pitch: 1.2, rate: 1.0 });
    if (!this.tracked) this.tracked = s;
    return s;
  }

  haul(perp) { this.wagons.push(new Wagon(perp)); }

  onJudged(e, tier, dossier) {
    const diff = Math.abs(tier - dossier.correct);
    const base = 20 + 12 * dossier.maxTier;
    let verdict, cls;
    if (diff === 0) { verdict = 'PERFECT JUSTICE'; cls = 'good'; G.player.addCred(base, verdict); G.player.stats.perfect++; }
    else if (diff === 1) { verdict = 'FAIR VERDICT'; cls = 'ok'; G.player.addCred(Math.round(base * 0.5), verdict); G.player.stats.fair++; }
    else { verdict = 'MISCARRIAGE OF JUSTICE'; cls = 'bad'; G.player.addCred(-Math.round(base * 0.5), verdict); G.player.stats.bad++; }
    G.player.stats.arrests++;
    e.judged = true; e.marker.visible = false;
    fx.text(e.pos.clone().setY(e.pos.y + 2.6), SENTENCES[tier].short.toUpperCase(), cls === 'bad' ? 'bad' : 'good');
    this.haul(e);
    e.scene?.perpJudged(e);
    return { verdict, cls, diff };
  }

  update(dt) {
    const pl = G.player;
    this.spawnT -= dt;
    const maxActive = 3 + Math.floor(pl.rank / 2) + (this.crimeLevel > 70 ? 1 : 0);
    if (this.spawnT <= 0) {
      this.spawnT = rand(26, 44) * (this.crimeLevel > 70 ? 0.7 : 1);
      if (this.active.length < maxActive) this.dispatch();
    }
    if (this.active.length === 0 && this.spawnT > 8) this.spawnT = 8;
    for (const s of this.scenes) s.update(dt);
    for (const w of this.wagons) w.update(dt);
    this.wagons = this.wagons.filter((w) => !w.done);
    this.crimeLevel = clamp(this.crimeLevel + (this.active.length - 1.5) * dt * 0.05, 0, 100);
    // perp bikes
    if (G.perpBikes) for (const b of G.perpBikes) b.tick(dt);
  }
}

// ---------------------------------------------------------------------------
export function buildDossier(e) {
  const crimes = e.crimes.map((k) => ({ key: k, ...CRIMES[k] }));
  const maxTier = Math.max(...crimes.map((c) => c.tier));
  let base = maxTier + (crimes.length > 1 ? 1 : 0);
  const factors = [];
  if (crimes.length > 1) factors.push({ text: 'Multiple offences', v: 1, base: true });
  if (e.priors === 0) factors.push({ text: 'First offence', v: -1 });
  else if (e.priors >= 2) factors.push({ text: `Repeat offender (${e.priors} priors)`, v: 1 });
  if (e.aggressed) factors.push({ text: 'Resisted arrest', v: 1 });
  else if (!e.T.meek) factors.push({ text: 'Cooperated with arrest', v: -1 });
  if (e.armed && !e.crimes.includes('weapons') && !e.crimes.includes('armedrobbery')) factors.push({ text: 'Armed with a weapon', v: 1 });
  const sum = factors.filter((f) => !f.base).reduce((a, f) => a + f.v, 0);
  const correct = clamp(base + sum, 0, 7);
  return { crimes, maxTier, base: clamp(base, 0, 7), factors, correct, perp: e };
}
