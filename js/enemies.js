import * as THREE from 'three';
import { G } from './state.js';
import { fx } from './fx.js';
import { audio } from './audio.js';
import { world } from './world.js';
import { weapons } from './weapons.js';
import { Character, makePistol, makeBat } from './character.js';
import { rand, pick, chance, clamp, lerp, angDiff, dampAngle, damp, segSphere, makeCanvas, canvasTex, randInt } from './util.js';

const FIRST = ['Zed', 'Mick', 'Dolly', 'Rico', 'Vince', 'Lola', 'Hoss', 'Tank', 'Skeet', 'Nico', 'Brick', 'Fang', 'Gus', 'Mona', 'Ratty', 'Dex', 'Kira', 'Moe', 'Slim', 'Otto'];
const LAST = ['Hobart', 'Grudd', 'Kowalski', 'Mancini', 'Orlov', 'Tanaka', 'Bishop', 'Cutler', 'Vega', 'Nakamura', 'Pike', 'Stubbs', 'Malone', 'Okafor', 'Duvall', 'Reyes', 'Chen', 'Fry'];
export const randName = () => `${pick(FIRST)} ${pick(LAST)}`;
export const randId = () => `MC1-${randInt(100000, 999999)}`;

export const TYPES = {
  thug: { style: 'thug', hp: 70, speed: 4.8, melee: true, dmg: 11, tele: 0.55, cool: [1.4, 2.6], weapon: 'bat', label: 'THUG' },
  gunman: { style: 'gunman', hp: 55, speed: 4.3, ranged: true, dmg: 8, tele: 0.55, cool: [1.6, 3.0], weapon: 'pistol', label: 'GUNMAN' },
  brute: { style: 'brute', hp: 190, speed: 3.3, melee: true, dmg: 24, tele: 0.9, cool: [2.4, 3.8], weapon: 'bat', armor: true, superarmor: true, label: 'BRUTE', scaleWeapon: 1.5 },
  junkie: { style: 'junkie', hp: 50, speed: 7.2, melee: true, dmg: 7, tele: 0.3, cool: [0.7, 1.5], weapon: null, label: 'SLO-MO JUNKIE' },
  boss: { style: 'boss', hp: 480, speed: 3.8, melee: true, dmg: 28, tele: 0.8, cool: [1.4, 2.4], weapon: 'bat', armor: true, superarmor: true, boss: true, slam: true, label: 'BLOCK BOSS', scaleWeapon: 2 },
  meek: { style: 'civ', hp: 30, speed: 5.5, meek: true, dmg: 0, label: 'OFFENDER' },
};
const EN_AMMO = { id: 'enemy', color: 0xff8030, speed: 46, dmg: 8, bounces: 0 };

const alertTex = (() => {
  const [c, x] = makeCanvas(64, 64);
  x.fillStyle = 'rgba(255,20,20,0.9)'; x.beginPath(); x.arc(32, 32, 28, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#fff'; x.font = '900 46px Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('!', 32, 36);
  return canvasTex(c);
})();
const judgeTex = (() => {
  const [c, x] = makeCanvas(96, 96);
  x.fillStyle = 'rgba(0,0,0,0.55)'; x.beginPath(); x.arc(48, 48, 44, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#ffd24a'; x.lineWidth = 5; x.beginPath(); x.arc(48, 48, 42, 0, Math.PI * 2); x.stroke();
  x.fillStyle = '#ffd24a'; x.font = '900 30px Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('E', 48, 52);
  x.font = '900 11px Arial'; x.fillText('JUDGE', 48, 24);
  return canvasTex(c);
})();

const _v = new THREE.Vector3(), _toP = new THREE.Vector3();

export class Enemy {
  constructor(typeName, pos, crimeData = {}) {
    const T = TYPES[typeName];
    this.T = T; this.type = typeName;
    this.ch = new Character(T.style, T.style === 'civ' ? { armor: pick([0x6a3a3a, 0x3a6a4a, 0x4a4a7a, 0x7a6a3a]), hair: pick([0x222222, 0x6a4a2a, 0xaa8a4a, 0x888888]) } : {});
    this.pos = pos.clone(); this.yaw = rand(0, Math.PI * 2); this.vel = new THREE.Vector3();
    this.maxHp = T.hp; this.hp = T.hp;
    this.state = 'idle'; this.stateT = 0; this.cool = rand(0.5, 2); this.threat = false;
    this.scale = this.ch.style.scale;
    this.hostile = !T.meek;
    this.aggro = false; this.aggressed = false; this.dead = false; this.judged = false; this.removed = false;
    this.name = randName(); this.id = randId(); this.priors = chance(0.35) ? 0 : randInt(1, 3);
    this.crimes = crimeData.crimes || []; this.armed = !!T.weapon && T.weapon !== null;
    this.scene = crimeData.scene || null; this.tokenKind = null; this.flash = 0; this.burn = 0;
    this.strafeDir = chance(0.5) ? 1 : -1; this.strafeT = rand(1, 3);
    this.fleeFrom = null; this.surrenderedEarly = false; this.hitCount = 0; this.fadeT = 0;
    // weapon
    if (T.weapon === 'pistol') { this.weapon = makePistol(); this.ch.gunMount.rotation.x = Math.PI / 2; this.ch.gunMount.add(this.weapon); this.muzzle = this.weapon.userData.muzzle; }
    else if (T.weapon === 'bat') { this.weapon = makeBat(T.boss ? 0x2a2a2a : 0x6a4a2a, 0.9); this.weapon.scale.setScalar(T.scaleWeapon || 1); this.ch.toolR.add(this.weapon); }
    // alert sprite
    this.alert = new THREE.Sprite(new THREE.SpriteMaterial({ map: alertTex, depthTest: false, transparent: true, toneMapped: false }));
    this.alert.scale.setScalar(0.8); this.alert.position.y = 2.6 * this.scale; this.alert.visible = false; this.alert.renderOrder = 20;
    this.ch.root.add(this.alert);
    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: judgeTex, depthTest: false, transparent: true, toneMapped: false }));
    this.marker.scale.setScalar(0.95); this.marker.position.y = 2.4 * this.scale; this.marker.visible = false; this.marker.renderOrder = 20;
    this.ch.root.add(this.marker);
    G.scene.add(this.ch.root);
    this.sync();
    this.ch.root.traverse((o) => { if (o.isMesh) o.userData.enemy = this; });
  }

  get judgeable() { return (this.state === 'surrender' || this.state === 'subdued') && !this.judged && !this.removed; }
  get active() { return this.state !== 'dead' && this.state !== 'surrender' && this.state !== 'subdued' && !this.removed; }
  get isHostile() { return this.hostile && this.active && this.aggro; }

  sync() {
    this.ch.root.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.ch.root.rotation.y = this.yaw;
  }

  hitTest(a, b) {
    if (this.removed) return null;
    const s = this.scale, p = this.pos;
    if (this.state === 'dead' || this.state === 'subdued' || this.state === 'down') {
      const t = segSphere(a.x, a.y, a.z, b.x, b.y, b.z, p.x, p.y + 0.35, p.z, 0.8 * s);
      return t === null ? null : { t, head: false };
    }
    const th = segSphere(a.x, a.y, a.z, b.x, b.y, b.z, p.x, p.y + 1.72 * s, p.z, 0.27 * s);
    const kneel = this.state === 'surrender' ? 0.6 : 1;
    const tb = segSphere(a.x, a.y, a.z, b.x, b.y, b.z, p.x, p.y + 1.0 * s * kneel, p.z, 0.58 * s);
    if (th !== null && (tb === null || th <= tb + 0.02)) return { t: th, head: this.state !== 'surrender' ? true : true };
    if (tb !== null) return { t: tb, head: false };
    return null;
  }

  centre(out = _v) { return out.set(this.pos.x, this.pos.y + 1.0 * this.scale, this.pos.z); }

  setState(s, t = 0) {
    if (this.state === 'telegraph' || this.state === 'attack') this.releaseToken();
    this.state = s; this.stateT = t; this.threat = false; this.alert.visible = false;
    this.setFlash(0);
  }
  setFlash(v) {
    this.flash = v;
    const m = this.ch.mats;
    m.armor.emissive.setRGB(v, v * 0.05, v * 0.05); m.armor.emissiveIntensity = 1;
    m.under.emissive.setRGB(v * 0.8, 0, 0); m.skin.emissive.setRGB(v * 0.6, 0, 0);
  }
  releaseToken() { if (this.tokenKind) { G.enemies.release(this); } }

  // ------- damage -------
  hurt(amount, info = {}) {
    if (this.removed || this.state === 'dead') return;
    const type = info.type || 'bullet';
    const pl = G.player;
    // excessive force
    if (this.state === 'surrender' || this.state === 'subdued' || (this.T.meek && this.state !== 'flee')) {
      if (type !== 'melee' && !this.judged) { pl?.excessiveForce(this); }
    }
    if (type !== 'melee' && this.state !== 'surrender' && this.state !== 'subdued') this.provoke();
    let dmg = amount;
    if (this.T.armor && type === 'bullet' && info.ammo !== 'ap') dmg *= 0.3;
    if (this.state === 'surrender' && type === 'melee') return;
    if (type === 'melee' && this.state === 'subdued') return;
    this.hp -= dmg; this.hitCount++;
    if (info.knock) { this.vel.addScaledVector(info.dir || _v.set(0, 0, 0), info.knock); }
    if (type === 'fire') { this.burn = 2; return this.afterDamage(type, info); }
    if (G.hud && type !== 'fire') G.hud.damageNumber?.(this, dmg);
    fx.text(this.centre().clone().setY(this.pos.y + 2.2 * this.scale), String(Math.round(dmg)), info.crit ? 'crit' : '');
    this.afterDamage(type, info);
    if (type !== 'fire' && this.state !== 'dead') this.setFlash(0.0);
  }

  afterDamage(type, info) {
    const lethal = type !== 'melee';
    if (this.hp <= 0) {
      if (lethal) return this.die(info);
      return this.subdue(info);
    }
    // surrender at low health
    if (!this.T.boss && this.hostile && this.hp / this.maxHp < 0.3 && !this.surrenderedEarly && this.state !== 'surrender') {
      this.surrenderedEarly = true;
      if (chance(0.65)) return this.surrender();
    }
    if (this.state === 'surrender' || this.state === 'subdued') return;
    // hit reaction
    const sa = this.T.superarmor && !(info.knock > 8) && info.type !== 'counter';
    if (info.type === 'counter' || info.knock > 8 || info.finisher) { this.knockdown(info); return; }
    if (!sa || chance(0.25)) {
      if (this.state !== 'stagger') { this.setState('stagger', 0); }
      this.stateT = 0; this.ch.play('hurt', { speed: 1.3 });
      if (info.dir && info.type === 'melee') this.vel.addScaledVector(info.dir, 4.5);
    }
    if (this.T.meek) { this.surrender(); }
  }

  provoke() { this.aggro = true; this.scene?.alert(); }

  knockdown(info = {}) {
    this.setState('down', 0);
    this.ch.play('subdued', { speed: 2.2 });
    if (info.dir) this.vel.addScaledVector(info.dir, info.type === 'counter' ? 9 : 6);
    this.downT = 1.4;
  }

  surrender() {
    this.setState('surrender');
    this.ch.play('surrender');
    if (this.weapon) this.weapon.visible = false;
    this.marker.visible = true; this.vel.set(0, 0, 0);
    this.scene?.onPerpDown(this);
    fx.text(this.pos.clone().setY(this.pos.y + 2.4), 'SURRENDER', 'good');
    audio.ui('select');
  }
  subdue(info) {
    this.setState('subdued');
    this.ch.play('subdued', { speed: 1.4 });
    if (this.weapon) this.weapon.visible = false;
    this.marker.visible = true;
    if (info.dir) this.vel.addScaledVector(info.dir, 4);
    this.scene?.onPerpDown(this);
    fx.text(this.pos.clone().setY(this.pos.y + 2.4), 'SUBDUED', 'good');
  }
  die(info = {}) {
    this.releaseToken();
    this.setState('dead'); this.dead = true; this.hp = 0; this.fadeT = 0;
    this.ch.play('die', { speed: 1.5 });
    if (info.dir) this.vel.addScaledVector(info.dir, 7);
    if (this.weapon) this.weapon.visible = false;
    this.marker.visible = false;
    this.scene?.onPerpDead(this);
    G.player?.onKill(this);
    G.pickups?.dropFrom(this);
  }

  // ------- AI -------
  update(dt) {
    if (this.removed) return;
    const pl = G.player; const ch = this.ch;
    this.stateT += dt;
    this.cool -= dt;
    this.walking = 0;
    if (this.burn > 0) { this.burn -= dt; fx.fire(this.pos.clone().setY(this.pos.y + 0.8), 1, 0.5); if (this.state !== 'stagger') this.hp -= 0; }
    // velocity (knockback) integration
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt; this.vel.multiplyScalar(Math.exp(-7 * dt));
    let moveSpeed = 0;
    const toP = _toP.set(pl.pos.x - this.pos.x, 0, pl.pos.z - this.pos.z); const dist = toP.length(); if (dist > 0.001) toP.divideScalar(dist);
    const T = this.T;
    switch (this.state) {
      case 'idle': {
        if (!this.hostile) { this.faceYaw(Math.atan2(toP.x, toP.z), 2, dt); if (dist < 40 && pl.alive) this.setState('flee'); break; }
        const aggroR = T.ranged ? 55 : 32;
        if ((dist < aggroR && pl.alive) || this.aggro) { this.aggro = true; this.scene?.alert(); this.setState('engage'); }
        else this.faceYaw(this.yaw + Math.sin(G.time * 0.5 + this.hitCount) * 0.01, 2, dt);
        break;
      }
      case 'flee': {
        // meek offenders run from the player until caught
        const away = Math.atan2(-toP.x, -toP.z) + Math.sin(this.stateT * 1.3) * 0.5;
        this.faceYaw(away, 6, dt);
        moveSpeed = T.speed;
        if (dist < 4.5 || this.stateT > 14) { this.surrender(); }
        break;
      }
      case 'engage': {
        if (!pl.alive) { this.faceYaw(this.yaw, 1, dt); break; }
        const want = Math.atan2(toP.x, toP.z);
        this.faceYaw(want, 8, dt);
        if (T.melee) {
          const ring = 2.1 + (this.id.charCodeAt(5) % 3) * 0.5;
          if (dist > ring + 0.3) { moveSpeed = T.speed * (dist > 12 ? 1.1 : 1); this.moveDir(toP, moveSpeed, dt); moveSpeed = 0; this.walking = T.speed; }
          else {
            // circle while waiting for a token
            this.strafeT -= dt; if (this.strafeT < 0) { this.strafeDir *= -1; this.strafeT = rand(1.2, 3); }
            _v.set(-toP.z * this.strafeDir, 0, toP.x * this.strafeDir); this.moveDir(_v, T.speed * 0.35, dt); this.walking = T.speed * 0.35;
          }
          if (this.cool <= 0 && dist < 3.1 && G.enemies.request(this, 'melee')) this.beginTelegraph();
        } else if (T.ranged) {
          const los = !world.rayBoxes(this.centre().clone(), pl.centre());
          this.strafeT -= dt; if (this.strafeT < 0) { this.strafeDir *= -1; this.strafeT = rand(1, 2.5); }
          if (dist < 8) { _v.copy(toP).multiplyScalar(-1); this.moveDir(_v, T.speed, dt); this.walking = T.speed; }
          else if (dist > 17 || !los) { this.moveDir(toP, T.speed, dt); this.walking = T.speed; }
          else { _v.set(-toP.z * this.strafeDir, 0, toP.x * this.strafeDir); this.moveDir(_v, T.speed * 0.6, dt); this.walking = T.speed * 0.6; }
          if (this.cool <= 0 && los && dist < 30 && G.enemies.request(this, 'ranged')) this.beginTelegraph();
        }
        break;
      }
      case 'telegraph': {
        this.walking = 0;
        this.faceYaw(Math.atan2(toP.x, toP.z), 10, dt);
        this.threat = true;
        const k = this.stateT / T.tele;
        this.setFlash(0.5 + 0.5 * Math.sin(this.stateT * 40));
        this.alert.visible = true; this.alert.scale.setScalar(0.7 + Math.sin(this.stateT * 30) * 0.08 + (T.boss ? 0.4 : 0));
        if (T.ranged) { this.drawLaser(); }
        if (T.melee && dist > 3.8) { this.moveDir(toP, T.speed * 0.8, dt); } // keep closing in
        if (k >= 1) this.beginAttack();
        break;
      }
      case 'attack': {
        this.walking = 0;
        this.threat = this.stateT < 0.2;
        if (this.stateT > (T.ranged ? 0.4 : 0.55)) { this.setState('recover'); this.cool = rand(T.cool[0], T.cool[1]); }
        break;
      }
      case 'recover': {
        this.walking = 0; this.faceYaw(Math.atan2(toP.x, toP.z), 4, dt);
        if (this.stateT > (T.boss ? 0.5 : 0.7)) this.setState('engage');
        break;
      }
      case 'stagger': { this.walking = 0; if (this.stateT > 0.38) this.setState('engage'); break; }
      case 'down': {
        this.walking = 0; this.downT -= dt;
        if (this.downT <= 0 && this.state === 'down') { this.ch.play('getup', { speed: 1.3 }); this.setState('getup'); }
        break;
      }
      case 'getup': { if (this.stateT > 0.55) this.setState('engage'); break; }
      case 'surrender': case 'subdued': {
        this.walking = 0;
        this.marker.position.y = (this.state === 'surrender' ? 1.8 : 1.1) * this.scale + 0.7 + Math.sin(G.time * 3) * 0.08;
        this.marker.material.opacity = 0.7 + 0.3 * Math.sin(G.time * 5);
        break;
      }
      case 'dead': {
        this.walking = 0; this.fadeT += dt;
        if (this.fadeT > 6) { this.ch.root.position.y -= dt * 0.4; if (this.fadeT > 9) this.remove(); }
        break;
      }
    }
    if (this.state === 'engage' || this.state === 'flee') {
      if (moveSpeed > 0) { _v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); this.moveDir(_v, moveSpeed, dt); this.walking = moveSpeed; }
    }
    // separation from other enemies and the player
    for (const o of G.enemies.all) {
      if (o === this || o.removed) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z; const d2 = dx * dx + dz * dz;
      const rr = 0.9 * (this.scale + o.scale) * 0.6;
      if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2), push = (rr - d) * 0.5; this.pos.x += dx / d * push; this.pos.z += dz / d * push; }
    }
    if (this.state !== 'dead') {
      const dxp = this.pos.x - pl.pos.x, dzp = this.pos.z - pl.pos.z, dp2 = dxp * dxp + dzp * dzp;
      if (dp2 < 1.0 && dp2 > 1e-6 && !pl.rolling) { const d = Math.sqrt(dp2), push = (1.0 - d) * 0.5; this.pos.x += dxp / d * push; this.pos.z += dzp / d * push; }
    }
    world.collideCircle(this.pos, 0.45 * this.scale);
    // animate
    ch.speed = (this.state === 'engage' || this.state === 'flee') ? (this.walking || 0) : 0;
    if (this.state === 'telegraph' && T.ranged) { ch.aim = damp(ch.aim, 1, 10, dt); ch.aimPitch = 0.05; } else ch.aim = damp(ch.aim, 0, 8, dt);
    const ev = ch.update(dt);
    for (const e of ev) {
      if (e === 'hit' && this.state === 'attack') this.onAttackHit();
      if (e === 'step' && dist < 25) audio.step(this.pos, 0.8 * this.scale);
    }
    this.sync();
    if (this.state === 'dead' && this.fadeT < 0.01) this.ch.root.position.y = 0;
  }

  walkingSpeed() { return this.walking || 0; }
  faceYaw(target, k, dt) { this.yaw = dampAngle(this.yaw, target, k, dt); }
  moveDir(dir, speed, dt) { this.pos.x += dir.x * speed * dt; this.pos.z += dir.z * speed * dt; }

  beginTelegraph() {
    this.setState('telegraph');
    this.ch.play(this.T.ranged ? 'shoot' : (this.T.weapon === 'bat' ? 'telegraph' : 'telegraph'), { speed: 0.9 });
    this.ch.clipT = 0;
    audio.ui('tick');
    G.hud?.warn?.();
  }
  beginAttack() {
    this.setState('attack');
    this.aggressed = true;
    if (this.T.ranged) {
      this.ch.play('shoot', { speed: 1.5 });
      this.fire();
    } else {
      this.ch.play(this.T.weapon === 'bat' ? 'swing' : 'punch', { speed: this.T.boss ? 0.9 : 1.15 });
      audio.whoosh(this.pos);
    }
    this.threat = true; this.alert.visible = false; this.setFlash(0);
  }
  fire() {
    const pl = G.player;
    const from = this.muzzle ? this.muzzle.getWorldPosition(new THREE.Vector3()) : this.centre().clone();
    const target = pl.centre().clone(); target.x += rand(-0.8, 0.8); target.y += rand(-0.3, 0.3); target.z += rand(-0.8, 0.8);
    const dir = target.sub(from).normalize();
    weapons.fire('enemy', from, dir, { ...EN_AMMO, dmg: this.T.dmg }, { spread: 0.015 });
    fx.muzzle(from, dir, 0xff9040);
    audio.enemyShot(from);
    this.releaseToken();
  }
  drawLaser() {
    const pl = G.player; const from = this.muzzle ? this.muzzle.getWorldPosition(_v) : this.centre();
    const to = pl.centre();
    const n = 12; for (let i = 0; i < n; i += 3) {
      const t = i / n; fx.add.emit(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, from.z + (to.z - from.z) * t, 0, 0, 0, 3, 0.1, 0.1, 0.5, 0.12, 0.05, 0, 0, 0);
    }
  }
  onAttackHit() {
    const pl = G.player;
    if (this.T.ranged) return;
    const d = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
    const reach = (this.T.boss ? 4.5 : this.T.melee && this.type === 'brute' ? 3.0 : 2.5);
    if (this.T.slam) { fx.ring(new THREE.Vector3(this.pos.x, 0.2, this.pos.z), 0xff6030, 9, 0.45); fx.shake(0.7); audio.explosion(0.5, this.pos); }
    const ang = Math.abs(angDiff(this.yaw, Math.atan2(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z)));
    if (d < reach && (ang < 1.1 || this.T.slam)) {
      const dir = new THREE.Vector3(pl.pos.x - this.pos.x, 0, pl.pos.z - this.pos.z).normalize();
      pl.damage(this.T.dmg, dir, 'melee', this);
      fx.impact(pl.centre(), 8, 0xff6040);
    }
  }
  remove() {
    if (this.removed) return; this.removed = true; this.releaseToken();
    G.scene.remove(this.ch.root); this.ch.root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
  }
}

// ---------------------------------------------------------------------------
export class EnemyManager {
  constructor() { this.all = []; this.tokens = { melee: new Set(), ranged: new Set() }; this.maxTok = { melee: 2, ranged: 2 }; }
  add(e) { this.all.push(e); return e; }
  request(e, kind) {
    const set = this.tokens[kind];
    if (set.size >= this.maxTok[kind]) return false;
    // prefer enemies closest to player: only grant if nobody closer is waiting? keep simple
    set.add(e); e.tokenKind = kind; return true;
  }
  release(e) { if (e.tokenKind) { this.tokens[e.tokenKind].delete(e); e.tokenKind = null; } }
  hostiles() { return this.all.filter((e) => e.isHostile); }
  engaged() { return this.all.filter((e) => e.hostile && e.aggro && e.active).length; }
  targets() { const t = this.all.filter((e) => !e.removed && !(e.state === 'dead' && e.fadeT > 4)); if (G.civs) for (const c of G.civs.list) if (!c.removed && c.state !== 'dead') t.push(c); return t; }
  update(dt) {
    for (const e of this.all) e.update(dt);
    this.all = this.all.filter((e) => !e.removed);
  }
  threatening() { return this.all.filter((e) => e.threat && (e.state === 'telegraph' || e.state === 'attack') && e.active && e.T.melee); }
  nearest(pos, maxD = 99, filter = (e) => e.isHostile) {
    let best = null, bd = maxD;
    for (const e of this.all) { if (!filter(e)) continue; const d = Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z); if (d < bd) { bd = d; best = e; } }
    return best;
  }
}
