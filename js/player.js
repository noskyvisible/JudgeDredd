import * as THREE from 'three';
import { G } from './state.js';
import { input } from './input.js';
import { fx, Ribbon } from './fx.js';
import { audio } from './audio.js';
import { world } from './world.js';
import { weapons, AMMO } from './weapons.js';
import { Character, makeLawgiver, makeBaton } from './character.js';
import { ridePose } from './bike.js';
import { clamp, lerp, damp, dampAngle, angDiff, rand, deg, chance, TAU, smooth } from './util.js';

export const RANKS = [
  { name: 'ROOKIE JUDGE', cred: 0 }, { name: 'STREET JUDGE', cred: 250 }, { name: 'SENIOR STREET JUDGE', cred: 700 },
  { name: 'JUDGE MARSHAL', cred: 1500 }, { name: 'CHIEF JUDGE CANDIDATE', cred: 3000 }, { name: 'LIVING LEGEND', cred: 6000 },
];
const COMBO_SEQ = ['slashR', 'slashL', 'kick', 'thrust', 'gunbutt', 'overhead'];
const ATK = {
  slashR: { dmg: 16, reach: 3.1, heavy: false, speed: 1.35, ribbon: true }, slashL: { dmg: 16, reach: 3.1, heavy: false, speed: 1.35, ribbon: true },
  thrust: { dmg: 18, reach: 3.4, heavy: false, speed: 1.4, ribbon: true }, kick: { dmg: 15, reach: 2.8, heavy: false, speed: 1.3, knock: 6 },
  gunbutt: { dmg: 15, reach: 2.6, heavy: false, speed: 1.35 }, overhead: { dmg: 28, reach: 3.3, heavy: true, speed: 1.15, ribbon: true, knock: 9 },
  spin: { dmg: 18, reach: 3.6, heavy: true, speed: 1.1, ribbon: true, aoe: true, knock: 8 },
  finisher: { dmg: 80, reach: 5.5, heavy: true, speed: 0.95, ribbon: true, aoe: true, knock: 16, finisher: true },
  counter: { dmg: 45, reach: 3.5, heavy: true, speed: 1.1, ribbon: true, knock: 10 },
};
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3();

export class Player {
  constructor(scene) {
    this.scene = scene;
    this.ch = new Character('dredd'); scene.add(this.ch.root);
    this.lawgiver = makeLawgiver(); this.ch.gunMount.add(this.lawgiver);
    this.baton = makeBaton(0.85); this.ch.batonMount.add(this.baton);
    this.ribbon = new Ribbon(scene, 16, 0xfff0a0);
    this.pos = new THREE.Vector3(); this.yaw = 0; this.vel = new THREE.Vector3();
    this.maxHp = 100; this.hp = 100; this.maxArmor = 50; this.armor = 50;
    this.state = 'free'; this.stateT = 0; this.alive = true; this.rolling = false; this.iframes = 0;
    this.camYaw = Math.PI; this.camPitch = 0.28; this.camDist = 5.5; this.camFov = 62; this.lastMouse = 0;
    this.aiming = false; this.fireCool = 0; this.ammoIdx = 0;
    this.ammo = AMMO.map((a, i) => (a.count === Infinity ? Infinity : Math.round(a.count * 0.5)));
    this.combo = 0; this.comboT = 0; this.score = 0; this.bestCombo = 0;
    this.atkTarget = null; this.atkClip = null; this.queued = false; this.comboIdx = 0; this.lunge = 0;
    this.dodgeDir = new THREE.Vector3(); this.counterCool = 0; this.noDamageT = 0;
    this.cred = 0; this.rank = 0; this.stats = { arrests: 0, kills: 0, perfect: 0, fair: 0, bad: 0, counters: 0, finishers: 0, crimes: 0 };
    this.prompt = ''; this.interactTarget = null; this.defuse = 0;
    this.aimPoint = new THREE.Vector3(); this.recoil = 0; this.shakePitch = 0;
    this.speedNow = 0; this.perfectT = 0;
    this.deadT = 0; this.finishTarget = null;
    this.stepT = 0;
    this.camPos = new THREE.Vector3(); this.camInit = false;
    this.dmgBonus = 1;
    this.heatPulse = 0;
    this.fill = new THREE.PointLight(0xb8c4ff, 14, 20, 2); scene.add(this.fill);
  }
  get dead() { return !this.alive; }
  centre(out = _v) { return out.set(this.pos.x, this.pos.y + (G.mode === 'bike' ? 1.5 : 1.05), this.pos.z); }
  get muzzlePos() { const m = this.lawgiver.userData.muzzle; return m.getWorldPosition(new THREE.Vector3()); }

  respawn() {
    this.alive = true; this.hp = this.maxHp * 0.7; this.armor = this.maxArmor * 0.5; this.state = 'free';
    this.pos.copy(world.spawnPos); this.vel.set(0, 0, 0); this.ch.stopClip(); this.ch.roll = 0; this.ch.root.visible = true;
    if (G.mode === 'bike') G.dismount(true);
    this.yaw = 0; this.camYaw = Math.PI; this.iframes = 2;
    this.ch.root.position.copy(this.pos);
    this.ch.root.rotation.set(0, 0, 0); this.ch.rigRoot.rotation.set(0, 0, 0);
  }

  // ---------------------------------------------------------------- damage
  damage(amount, dir, type = 'bullet', src = null) {
    if (!this.alive || G.cinematic) return;
    if (this.state === 'counter' || this.state === 'finisher') return;
    if (this.iframes > 0) {
      if (src && src.T && (type === 'melee') && this.rolling && !this.perfectT) {
        this.perfectT = 1; fx.slowmo(0.3, 0.5); fx.text(this.centre().clone().setY(this.pos.y + 2.3), 'PERFECT DODGE', 'good'); audio.ui('select'); this.stats.perfect += 0; this.addCombo(1);
      }
      return;
    }
    let a = amount;
    if (G.mode === 'bike' && type !== 'crash') a *= 0.7;
    if (this.armor > 0) { const ab = Math.min(this.armor, a * 0.6); this.armor -= ab; a -= ab; }
    this.hp -= a; this.noDamageT = 0;
    this.combo = type === 'fire' ? this.combo : 0; this.comboT = 0;
    G.hud?.damageFlash(Math.min(1, amount / 30));
    if (type !== 'fire') { audio.hurt(); fx.shake(Math.min(1, amount / 25)); }
    if (dir && G.mode === 'foot') { this.vel.x += dir.x * 5; this.vel.z += dir.z * 5; }
    if (type === 'melee' || type === 'bullet') {
      if (this.state === 'attack' || this.state === 'free') { this.state = 'hurt'; this.stateT = 0; this.ch.play('hurt', { speed: 1.3 }); this.queued = false; this.finishAttackVisual(); }
    }
    if (this.hp <= 0) this.die();
  }
  heal(n) { const room = this.maxHp - this.hp; this.hp = Math.min(this.maxHp, this.hp + n); if (n > room) this.armor = Math.min(this.maxArmor, this.armor + (n - room)); }
  blastCheck(pos, radius, dmg) {
    const d = Math.hypot(this.pos.x - pos.x, this.pos.z - pos.z);
    if (d < radius) { const k = 1 - d / radius; this.damage(dmg * k, _w.set(this.pos.x - pos.x, 0, this.pos.z - pos.z).normalize().clone(), 'explosion'); }
  }
  die() {
    this.alive = false; this.hp = 0; this.deadT = 0;
    this.ch.play('die', { speed: 1.2 });
    if (G.mode === 'bike') G.dismount(true);
    G.onPlayerDeath?.();
  }

  // ---------------------------------------------------------------- scoring
  addCred(n, label) {
    const before = this.rank;
    this.cred = Math.max(0, this.cred + n);
    let r = 0; for (let i = 0; i < RANKS.length; i++) if (this.cred >= RANKS[i].cred) r = i;
    if (r > this.rank) {
      this.rank = r; this.maxHp += 15; this.hp = this.maxHp; this.armor = this.maxArmor; this.dmgBonus += 0.1;
      G.hud?.banner('RANK UP', RANKS[r].name, 'rank'); audio.ui('rank'); audio.voice('Rank up.');
    }
    if (label) G.hud?.feed(`${n > 0 ? '+' : ''}${n} CRED  ${label}`, n >= 0 ? 'good' : 'bad');
  }
  addCombo(n) {
    this.combo += n; this.comboT = 3.5; this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.score += Math.round(10 * n * (1 + Math.floor(this.combo / 4) * 0.5));
    G.hud?.comboPop();
  }
  excessiveForce(e) { this.addCred(-30, 'EXCESSIVE FORCE'); G.hud?.banner('EXCESSIVE FORCE', 'The perp was not resisting', 'bad'); audio.ui('error'); }
  civilianHit() { }
  civilianDeath(c) { this.addCred(-60, 'CIVILIAN CASUALTY'); G.hud?.banner('CIVILIAN CASUALTY', 'Protect the innocent', 'bad'); audio.ui('error'); G.crimes?.civilianLost(c); }
  onKill(e) { this.stats.kills++; if (e.hostile && e.aggro) this.addCred(4, 'PERP DOWN'); }
  onCarDestroyed() { this.addCred(-8, 'PROPERTY DAMAGE'); }

  // ---------------------------------------------------------------- melee
  inputDir() {
    const a = input.axis(); if (!a.x && !a.y) return null;
    const cy = this.camYaw; _f.set(Math.sin(cy), 0, Math.cos(cy)); _r.set(-Math.cos(cy), 0, Math.sin(cy));
    return new THREE.Vector3().addScaledVector(_f, a.y).addScaledVector(_r, a.x).normalize();
  }
  findTarget(dir) {
    const fwd = dir || _w.set(Math.sin(this.camYaw), 0, Math.cos(this.camYaw)).clone();
    let best = null, bs = 1e9;
    for (const e of G.enemies.all) {
      if (!e.hostile || e.removed || !(e.state !== 'dead' && e.state !== 'surrender' && e.state !== 'subdued')) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > 12) continue;
      const ang = Math.abs(angDiff(Math.atan2(fwd.x, fwd.z), Math.atan2(dx, dz)));
      if (d > 3 && ang > 1.1) continue;
      const sc = d * (1 + ang * 1.8) + (e.state === 'down' ? 4 : 0);
      if (sc < bs) { bs = sc; best = e; }
    }
    return best;
  }
  startAttack(forced) {
    const dir = this.inputDir();
    const t = this.findTarget(dir);
    this.atkTarget = t;
    let name;
    if (forced) name = forced;
    else if (this.combo >= 8 && t && this.finisherReady) { name = 'finisher'; this.finisherReady = false; }
    else { name = COMBO_SEQ[this.comboIdx % COMBO_SEQ.length]; this.comboIdx++; if (t && t.state === 'down') name = 'overhead'; if (Math.random() < 0.12) name = 'spin'; }
    const A = ATK[name]; this.atkClip = name; this.atk = A;
    this.state = name === 'finisher' ? 'finisher' : 'attack'; this.stateT = 0; this.queued = false; this.hitDone = false;
    this.ch.play(name, { speed: A.speed });
    // face target / input
    if (t) this.faceTo = Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z); else if (dir) this.faceTo = Math.atan2(dir.x, dir.z); else this.faceTo = this.yaw;
    this.yaw = this.faceTo;
    this.lunge = t ? Math.max(0, Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z) - 1.5) : 0.7;
    this.lungeSpeed = clamp(this.lunge * 7 + 6, 7, 30);
    if (name === 'finisher') { G.cinematic = 0.9; fx.slowmo(0.35, 0.8); this.iframes = 1.2; G.finisherCam = 1; this.stats.finishers++; audio.voice('Judgement time.', { pitch: 0.05 }); }
    audio.whoosh(this.pos);
    this.baton.userData.tipMat.color.setRGB(3.5, 3, 1.2);
  }
  doHit(ev) {
    const name = this.atkClip, A = ATK[name]; if (!A) return;
    const fwd = _f.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    let hits = 0;
    const list = G.enemies.all.filter((e) => e.hostile && !e.removed && e.state !== 'dead' && e.state !== 'subdued' && e.state !== 'surrender');
    for (const e of list) {
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      const isTarget = e === this.atkTarget;
      if (!A.aoe && !isTarget && !(d < A.reach * 0.9 && Math.abs(angDiff(this.yaw, Math.atan2(dx, dz))) < 0.9)) continue;
      if (d > A.reach + (isTarget ? 0.8 : 0)) continue;
      if (A.aoe && !isTarget && Math.abs(angDiff(this.yaw, Math.atan2(dx, dz))) > 2.2 && !A.finisher) continue;
      const dir = new THREE.Vector3(dx, 0, dz).normalize();
      const mult = (1 + Math.min(this.combo, 24) * 0.03) * this.dmgBonus;
      e.hurt(A.dmg * mult, { type: A.finisher || name === 'counter' ? 'melee' : 'melee', dir, knock: A.knock, finisher: A.finisher, crit: false, ...(name === 'counter' ? { type: 'melee', knock: 12 } : {}) });
      if (name === 'counter' || A.finisher) { if (e.state !== 'subdued' && e.state !== 'surrender' && !e.removed) e.knockdown({ dir, type: 'counter' }); }
      hits++;
      const p = e.centre().clone(); p.addScaledVector(dir, -0.4);
      fx.impact(p, 14, 0xffe890); fx.spark(p, 8, 0x80d0ff, 12, 0.35);
      fx.ring(p, 0xfff0a0, A.heavy ? 3.2 : 2, 0.22, G.camera.position.clone().sub(p).normalize());
      audio.baton(A.heavy, p);
      G.hud?.hitMarker(false);
      this.addCombo(A.finisher ? 3 : 1);
      if (this.combo >= 8 && !this.finisherReady && this.combo % 8 === 0) { this.finisherReady = true; G.hud?.banner('JUDGEMENT READY', 'Attack to unleash the finisher', 'good'); audio.ui('rank'); }
    }
    if (hits) { fx.hitstop(A.heavy ? 0.1 : 0.05); fx.shake(A.heavy ? 0.7 : 0.25); if (A.finisher) { fx.ring(new THREE.Vector3(this.pos.x, 0.3, this.pos.z), 0xffd24a, 16, 0.6); fx.shake(1.4); fx.explosionLite?.(this.pos); } }
    else { this.combo = this.combo; audio.whoosh(this.pos); }
    // tiny forward flash
    this.hitDone = true;
  }
  finishAttackVisual() { this.baton.userData.tipMat.color.setRGB(2, 1.9, 1.0); }

  // ---------------------------------------------------------------- update
  update(dt) {
    const ch = this.ch;
    if (!this.alive) { this.deadT += dt; ch.speed = 0; ch.update(dt); this.syncVisual(); this.updateCamera(dt); if (this.deadT > 3.2) G.onRespawnReady?.(); return; }
    this.stateT += dt; this.fireCool -= dt; this.counterCool -= dt; this.iframes -= dt; this.noDamageT += dt; this.perfectT = Math.max(0, this.perfectT - dt);
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) { this.combo = 0; this.finisherReady = false; } }
    if (this.noDamageT > 6 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 4 * dt);
    if (this.noDamageT > 10 && this.armor < this.maxArmor) this.armor = Math.min(this.maxArmor, this.armor + 3 * dt);
    this.heatPulse = Math.max(0, this.heatPulse - dt);

    // camera input
    const [mx, my] = input.takeMouse();
    if (mx || my) this.lastMouse = G.time;
    this.camYaw -= mx * 0.0022; this.camPitch = clamp(this.camPitch + my * 0.0022, -0.55, 1.15);
    // ammo select
    for (let i = 0; i < 6; i++) if (input.pressed('Digit' + (i + 1))) this.selectAmmo(i);
    const w = input.takeWheel(); if (w) this.selectAmmo((this.ammoIdx + (w > 0 ? 1 : 5)) % 6);

    this.aiming = input.mouse(2) && this.state !== 'dodge' && this.state !== 'finisher' && this.state !== 'counter';
    if (G.mode === 'bike') this.updateBike(dt); else this.updateFoot(dt);

    // aiming visuals
    ch.aim = damp(ch.aim, this.aiming ? 1 : 0, 14, dt);
    this.computeAimPoint();
    ch.aimPitch = this.aimPitchValue || 0;
    // baton electricity glow
    const gl = 1.8 + Math.sin(G.time * 30) * 0.4 + (this.state === 'attack' ? 1.5 : 0);
    this.baton.userData.tipMat.color.setRGB(gl, gl * 0.95, gl * 0.45);
    // lawgiver display colour
    const disp = this.lawgiver.userData.disp; if (disp) disp.material.color.set(AMMO[this.ammoIdx].color).multiplyScalar(1.5);

    const ev = ch.update(dt);
    this.syncVisual();
    for (const e of ev) {
      if (e === 'hit' && (this.state === 'attack' || this.state === 'finisher' || this.state === 'counter')) this.doHit();
      if (e === 'step' && this.speedNow > 1) { audio.step(this.pos, 1.2); if (chance(0.5)) audio.splash(this.pos); }
      if (e === 'done' && (this.state === 'attack' || this.state === 'finisher' || this.state === 'counter')) this.endAttack();
    }
    this.updateRibbon();
    this.updateCamera(dt);
  }

  syncVisual() {
    if (G.mode !== 'bike') {
      this.ch.root.position.copy(this.pos); this.ch.root.rotation.y = this.yaw;
    }
  }

  selectAmmo(i) { if (i === this.ammoIdx) return; this.ammoIdx = i; audio.ui('switch'); G.hud?.flashAmmo(i); fx.text(this.centre().clone().setY(this.pos.y + 2.4), AMMO[i].name, 'ammo'); }
  endAttack() {
    this.finishAttackVisual();
    if (this.queued) { this.startAttack(); return; }
    this.state = 'free'; this.stateT = 0; G.cinematic = 0; G.finisherCam = 0;
  }

  updateFoot(dt) {
    const ch = this.ch;
    const dir = this.inputDir();
    const sprint = input.down('ShiftLeft') || input.down('ShiftRight');
    // ---- state machine
    switch (this.state) {
      case 'free': {
        let speed = this.aiming ? 3.8 : sprint ? 11 : 6.3;
        if (dir) { this.vel.x = damp(this.vel.x, dir.x * speed, 12, dt); this.vel.z = damp(this.vel.z, dir.z * speed, 12, dt); }
        else { this.vel.x = damp(this.vel.x, 0, 14, dt); this.vel.z = damp(this.vel.z, 0, 14, dt); }
        const target = this.aiming ? this.camYaw : dir ? Math.atan2(dir.x, dir.z) : this.yaw;
        this.yaw = dampAngle(this.yaw, target, this.aiming ? 18 : 14, dt);
        // actions
        if (input.pressed('Space')) { this.startDodge(dir); break; }
        if (input.pressed('KeyF')) { this.tryCounter(); }
        if (this.aiming) { if (input.mouse(0)) this.tryFire(AMMO[this.ammoIdx].auto ? true : input.mousePressed(0)); }
        else if (input.mousePressed(0)) { this.startAttack(); break; }
        if (input.pressed('KeyQ')) this.snapShot();
        this.handleInteract(dt);
        break;
      }
      case 'attack': case 'finisher': {
        // lunge towards target
        const t = this.atkTarget && !this.atkTarget.removed ? this.atkTarget : null;
        if (t) {
          const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z, d = Math.hypot(dx, dz);
          this.faceTo = Math.atan2(dx, dz); this.yaw = dampAngle(this.yaw, this.faceTo, 20, dt);
          if (d > 1.5 && this.stateT < 0.35) { const s = this.lungeSpeed; this.vel.x = dx / d * s; this.vel.z = dz / d * s; } else { this.vel.x *= Math.exp(-14 * dt); this.vel.z *= Math.exp(-14 * dt); }
        } else { if (this.stateT < 0.25) { this.vel.x = Math.sin(this.yaw) * 5; this.vel.z = Math.cos(this.yaw) * 5; } else { this.vel.x *= Math.exp(-12 * dt); this.vel.z *= Math.exp(-12 * dt); } }
        if (input.mousePressed(0) && this.state === 'attack') this.queued = true;
        if (this.state === 'attack' && input.pressed('Space')) { this.queued = false; this.startDodge(dir); }
        if (input.pressed('KeyF') && this.state === 'attack') this.tryCounter();
        if (input.pressed('KeyQ') && this.state === 'attack') { this.state = 'free'; this.snapShot(); }
        // allow early re-attack after hit frame
        if (this.state === 'attack' && this.queued && this.hitDone && ch.clipProgress() > 0.78) { this.startAttack(); }
        break;
      }
      case 'dodge': {
        const k = this.stateT / 0.5;
        const s = 15 * (1 - k * 0.6);
        this.vel.x = this.dodgeDir.x * s; this.vel.z = this.dodgeDir.z * s;
        this.ch.roll = k * TAU * (this.dodgeBack ? -1 : 1);
        this.rolling = true; ch.pivot.position.y = 0.9 - Math.sin(k * Math.PI) * 0.0;
        if (this.stateT > 0.38) this.iframes = Math.min(this.iframes, 0);
        if (k >= 1) { this.state = 'free'; this.ch.roll = 0; this.rolling = false; this.ch.stopClip(); }
        break;
      }
      case 'counter': {
        this.vel.multiplyScalar(Math.exp(-10 * dt));
        break;
      }
      case 'hurt': {
        this.vel.multiplyScalar(Math.exp(-8 * dt));
        if (this.stateT > 0.3) { this.state = 'free'; }
        break;
      }
    }
    // integrate & collide
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    world.collideCircle(this.pos, 0.5);
    this.speedNow = Math.hypot(this.vel.x, this.vel.z);
    ch.speed = (this.state === 'free' || this.state === 'hurt') ? this.speedNow : 0;
    if (this.aiming && this.state === 'free') ch.speed = this.speedNow;
    // strafe animation when aiming: legs use speed only
    this.rolling = this.state === 'dodge';
    if (!this.rolling) ch.roll = 0;
    // dust / footfall rain splashes
    if (this.speedNow > 7 && chance(0.2)) fx.add.emit(this.pos.x, 0.05, this.pos.z, rand(-1, 1), rand(0.5, 1.5), rand(-1, 1), 0.5, 0.65, 0.9, 0.35, 0.18, 0.3, 4, 0, 0);
  }

  startDodge(dir) {
    const d = dir || _w.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).clone();
    this.dodgeBack = !dir;
    this.dodgeDir.copy(d);
    this.state = 'dodge'; this.stateT = 0; this.iframes = 0.4; this.queued = false; this.perfectT = 0;
    this.yaw = Math.atan2(d.x, d.z) + (this.dodgeBack ? Math.PI : 0);
    this.ch.play('dodge', { speed: 1 });
    audio.whoosh(this.pos);
    fx.burst(this.pos.clone().setY(0.3), 6, 0x7090c0, 4, 0.2, 0.3);
  }

  tryCounter() {
    if (this.counterCool > 0) return;
    this.counterCool = 0.45;
    const threats = G.enemies.threatening();
    let best = null, bd = 9;
    for (const e of threats) { const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z); if (d < bd) { bd = d; best = e; } }
    if (!best) { fx.text(this.centre().clone().setY(this.pos.y + 2.2), 'NO THREAT', ''); return; }
    // execute
    this.state = 'counter'; this.stateT = 0; this.atkClip = 'counter'; this.atk = ATK.counter; this.atkTarget = best; this.hitDone = false;
    const dx = best.pos.x - this.pos.x, dz = best.pos.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
    this.yaw = Math.atan2(dx, dz);
    if (d > 1.7) { this.pos.x += dx / d * (d - 1.7); this.pos.z += dz / d * (d - 1.7); }
    this.iframes = 0.9;
    best.setState('stagger'); best.ch.play('hurt', { speed: 0.6 });
    best.threat = false; best.cool = 1.5;
    this.ch.play('counter', { speed: 1.2 });
    fx.slowmo(0.35, 0.45); fx.text(best.pos.clone().setY(best.pos.y + 2.6), 'COUNTER!', 'crit'); audio.counter(best.pos);
    fx.ring(best.centre().clone(), 0x60d0ff, 4, 0.3, G.camera.position.clone().sub(best.pos).normalize());
    this.stats.counters++; this.addCombo(2);
    this.finishAttackVisual();
  }

  updateRibbon() {
    const atk = (this.state === 'attack' || this.state === 'finisher' || this.state === 'counter') && this.atk?.ribbon && this.ch.clip && this.ch.clip.side === 'L';
    if (atk) {
      this.ch.root.updateMatrixWorld(true);
      const inner = this.baton.userData.inner;
      const tip = inner.localToWorld(this.baton.userData.tipLocal.clone());
      const base = inner.localToWorld(this.baton.userData.baseLocal.clone());
      this.ribbon.push(tip, base);
      this.ribbon.mat.uniforms.color.value.setHex(this.atk.finisher ? 0xffd24a : 0xfff0a0);
      if (Math.random() < 0.5) fx.add.emit(tip.x, tip.y, tip.z, rand(-2, 2), rand(-1, 2), rand(-2, 2), 2.5, 2.2, 0.8, 1, 0.12, 0.25, 6, 1, 0);
    } else this.ribbon.decay();
  }

  // ---------------------------------------------------------------- gun
  computeAimPoint() {
    const cam = G.camera;
    const dir = _w.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const from = cam.position.clone();
    const to = from.clone().addScaledVector(dir, 180);
    const wh = world.rayBoxes(from, to);
    let t = wh ? wh.t : 1;
    // enemies / cars along the ray
    for (const e of G.enemies.targets()) { const h = e.hitTest(from, to); if (h && h.t < t) t = h.t; }
    this.aimPoint.lerpVectors(from, to, t);
    // pitch of the gun relative to horizontal facing
    const mz = this.muzzleRef || this.centre().clone().setY(this.pos.y + 1.5);
    const d = _v.copy(this.aimPoint).sub(mz); const h = Math.hypot(d.x, d.z) || 1;
    this.aimPitchValue = clamp(Math.atan2(d.y, h), -0.8, 0.9);
    this.aimDist = d.length();
  }
  aimDirFrom(muzzle) {
    const d = this.aimPoint.clone().sub(muzzle);
    if (d.length() < 4 || d.dot(_w.set(0, 0, -1).applyQuaternion(G.camera.quaternion)) < 0) d.copy(_w.set(0, 0, -1).applyQuaternion(G.camera.quaternion));
    d.normalize();
    // gentle aim assist
    let best = null, bd = 0.045;
    for (const e of G.enemies.hostiles()) {
      const c = e.centre().clone(); const to = c.sub(muzzle); const dist = to.length(); if (dist > 60 || dist < 2) continue;
      const ang = Math.acos(clamp(to.normalize().dot(d), -1, 1));
      if (ang < bd) { bd = ang; best = to.clone(); }
    }
    if (best) d.lerp(best, 0.55).normalize();
    return d;
  }
  tryFire(wantAuto) {
    if (this.fireCool > 0 || !this.alive) return;
    let a = AMMO[this.ammoIdx];
    if (this.ammo[this.ammoIdx] <= 0) { audio.ui('error'); this.fireCool = 0.3; fx.text(this.centre().clone().setY(this.pos.y + 2.4), 'OUT OF AMMO', 'bad'); this.selectAmmo(0); return; }
    this.ch.root.updateMatrixWorld(true);
    const muzzle = this.muzzlePos;
    const dir = this.aimDirFrom(muzzle);
    this.shoot(muzzle, dir, a);
  }
  shoot(muzzle, dir, a) {
    weapons.fire('player', muzzle, dir, a);
    if (this.ammo[this.ammoIdx] !== Infinity) this.ammo[this.ammoIdx]--;
    this.fireCool = a.rate; this.recoil = 1;
    fx.muzzle(muzzle, dir, a.color); audio.shot(this.ammoIdx, muzzle);
    fx.shake(a.explosive ? 0.45 : a.id === 'ap' ? 0.3 : 0.1);
    this.camPitch -= a.explosive ? 0.03 : 0.006;
    this.ch.play('shoot', { speed: 1.6 }); this.ch.clipT = 0;
    G.civs?.panic(muzzle, 25);
    G.crimes?.gunshot(this.pos);
    if (G.mode === 'foot') { this.vel.x -= dir.x * (a.explosive ? 3 : 0.6); this.vel.z -= dir.z * (a.explosive ? 3 : 0.6); }
  }
  snapShot() {
    if (this.fireCool > 0) return;
    const t = G.enemies.nearest(this.pos, 45, (e) => e.isHostile && e.state !== 'down');
    if (!t) { fx.text(this.centre().clone().setY(this.pos.y + 2.3), 'NO TARGET', ''); return; }
    if (this.ammo[this.ammoIdx] <= 0) { this.selectAmmo(0); return; }
    this.yaw = Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
    this.ch.root.rotation.y = this.yaw; this.ch.root.updateMatrixWorld(true);
    const muzzle = this.muzzlePos; const to = t.centre().clone(); to.y += 0.3;
    this.shoot(muzzle, to.sub(muzzle).normalize(), AMMO[this.ammoIdx]);
    this.snapT = 0.3;
  }

  // ---------------------------------------------------------------- interact / bike
  handleInteract(dt) {
    this.prompt = ''; this.interactTarget = null;
    // judge
    let best = null, bd = 3.8;
    for (const e of G.enemies.all) { if (!e.judgeable) continue; const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z); if (d < bd) { bd = d; best = e; } }
    if (best) { this.prompt = `[E]  JUDGE ${best.name.toUpperCase()}`; this.interactTarget = best; if (input.pressed('KeyE')) { G.judgement.open(best); return; } }
    // bomb
    const bomb = G.crimes?.nearestBomb(this.pos, 3.5);
    if (bomb) {
      this.prompt = `[HOLD E]  DEFUSE  ${Math.ceil(bomb.timer)}s`;
      if (input.down('KeyE')) { this.defuse += dt; bomb.progress = this.defuse / 2.5; if (this.defuse >= 2.5) { this.defuse = 0; G.crimes.defuse(bomb); } } else { this.defuse = 0; bomb.progress = 0; }
      return;
    }
    // bike
    const b = G.bikeObj;
    if (b && Math.hypot(b.pos.x - this.pos.x, b.pos.z - this.pos.z) < 4.5) { if (!best) this.prompt = '[E]  MOUNT LAWMASTER'; if (input.pressed('KeyE') && !best) G.mount(); }
    else if (input.pressed('KeyB')) G.callBike();
  }

  updateBike(dt) {
    const b = G.bikeObj; const ch = this.ch;
    this.prompt = ''; this.interactTarget = null;
    const a = input.axis();
    const c = b.ctrl;
    if (b.auto) {
      const arrived = b.autopilot(dt, G.crimes?.trackedPos() || this.pos);
      if (a.x || a.y || input.down('Space')) b.auto = false; else if (arrived) { b.auto = false; G.hud?.feed('ARRIVED AT DESTINATION', 'good'); }
      this.prompt = b.auto ? '[WASD]  TAKE CONTROL' : '';
    }
    if (!b.auto) {
      c.throttle = a.y > 0 ? 1 : 0; c.brake = a.y < 0 ? 1 : 0; c.steer = a.x;
      c.boost = input.down('ShiftLeft') || input.down('ShiftRight'); c.drift = input.down('Space');
    }
    if (input.pressed('KeyG')) { b.auto = !b.auto; if (b.auto) { b.path.pts = []; G.hud?.feed('AUTOPILOT ENGAGED', 'good'); } audio.ui('beep'); }
    if (input.pressed('KeyH')) { b.sirenOn = !b.sirenOn; audio.setSiren(b.sirenOn); audio.ui('switch'); }
    b.update(dt);
    this.pos.copy(b.pos); this.yaw = b.yaw; this.speedNow = Math.abs(b.speed);
    ch.speed = 0;
    // gun while riding
    if (this.aiming) { if (input.mouse(0)) this.tryFire(true); }
    ch.shR.rotation.order = 'YXZ';
    b.aimYaw = this.aiming ? clamp(angDiff(b.yaw, this.camYaw), -1.3, 1.3) : 0;
    if (input.pressed('KeyE') && Math.abs(b.speed) < 8) { G.dismount(); }
    else if (input.pressed('KeyE')) this.prompt = 'SLOW DOWN TO DISMOUNT';
    if (Math.abs(b.speed) < 8 && !b.auto) this.prompt = '[E]  DISMOUNT';
    if (input.pressed('KeyQ')) this.snapShot();
    this.vel.set(b.vx, 0, b.vz);
    G.audioBike = { speed: Math.abs(b.speed) / 78, boost: b.boosting };
  }

  // ---------------------------------------------------------------- camera
  updateCamera(dt) {
    const cam = G.camera;
    if (G.freeCam) { this.fill.position.copy(cam.position).y += 1; return; } const bike = G.mode === 'bike' ? G.bikeObj : null;
    let aim = this.aiming ? 1 : 0;
    this.aimK = damp(this.aimK ?? 0, aim, 10, dt);
    if (bike) {
      // follow behind the bike unless mouse used recently
      const idle = G.time - this.lastMouse > 1.2;
      if (idle && !this.aiming) { this.camYaw = dampAngle(this.camYaw, bike.yaw, 2.6 + Math.abs(bike.speed) * 0.02, dt); this.camPitch = damp(this.camPitch, 0.2, 2, dt); }
    }
    const yaw = this.camYaw, pitch = this.camPitch;
    const dirX = Math.sin(yaw) * Math.cos(pitch), dirY = -Math.sin(pitch), dirZ = Math.cos(yaw) * Math.cos(pitch);
    // camera looks along (dirX,dirY,dirZ); sits behind the target
    // NOTE: camYaw is the direction the camera LOOKS. Movement forward = (sin yaw, cos yaw).
    const spd = bike ? Math.abs(bike.speed) : this.speedNow;
    let dist = bike ? lerp(8.5, 7.0, this.aimK) + spd * 0.018 : lerp(6.0, 4.3, this.aimK);
    if (bike && bike.boosting) dist += 1.5;
    if (G.finisherCam) { dist = 3.4; }
    this.camDist = damp(this.camDist, dist, 6, dt);
    const shoulder = bike ? lerp(0, 0.9, this.aimK) : lerp(0.45, 1.05, this.aimK);
    const height = bike ? 1.9 : lerp(1.8, 1.65, this.aimK);
    _v.set(this.pos.x, this.pos.y + height, this.pos.z);
    // look target slightly ahead
    _r.set(-Math.cos(yaw), 0, Math.sin(yaw));
    _v.addScaledVector(_r, shoulder);
    const desired = _w.copy(_v).addScaledVector(_f.set(dirX, dirY, dirZ), -this.camDist);
    // collision: walk from target to desired and stop before geometry
    const steps = 8; let ok = this.camDist;
    for (let i = 1; i <= steps; i++) {
      const p = _f.copy(_v).lerp(desired, i / steps);
      if (p.y < 0.4) { ok = this.camDist * (i - 1) / steps; break; }
      const bs = world.nearbyBoxes(p.x, p.z, this._cb || (this._cb = []));
      let hit = false; for (const b of bs) if (p.y < b.h && p.x > b.minX - 0.3 && p.x < b.maxX + 0.3 && p.z > b.minZ - 0.3 && p.z < b.maxZ + 0.3) { hit = true; break; }
      if (hit) { ok = this.camDist * (i - 1) / steps; break; }
    }
    const finalDist = Math.max(0.8, Math.min(this.camDist, ok));
    desired.copy(_v).addScaledVector(_f.set(dirX, dirY, dirZ), -finalDist);
    if (!this.camInit) { this.camPos.copy(desired); this.camInit = true; }
    this.camPos.lerp(desired, 1 - Math.exp(-(bike ? 14 : 22) * dt));
    cam.position.copy(this.camPos);
    // shake
    const sh = fx.shakeValue;
    if (sh > 0.001) { cam.position.x += rand(-1, 1) * sh * 0.18; cam.position.y += rand(-1, 1) * sh * 0.18; cam.position.z += rand(-1, 1) * sh * 0.18; }
    const look = _v.clone().addScaledVector(_f.set(dirX, dirY, dirZ), 8);
    cam.lookAt(look);
    if (sh > 0.001) cam.rotateZ(rand(-1, 1) * sh * 0.01);
    // FOV
    let fov = bike ? 64 + clamp(spd / 78, 0, 1.3) * 16 + (bike.boosting ? 10 : 0) : lerp(62, 52, this.aimK) + clamp(this.speedNow / 11, 0, 1) * 4;
    if (G.finisherCam) fov = 48;
    this.camFov = damp(this.camFov, fov, 6, dt); cam.fov = this.camFov; cam.updateProjectionMatrix();
    this.muzzleRef = this.pos.clone().setY(this.pos.y + 1.5);
    this.fill.position.copy(cam.position).lerp(_v.set(this.pos.x, this.pos.y + 1.6, this.pos.z), 0.55).y += 1.2;
  }
}
