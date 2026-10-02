import * as THREE from 'three';
import { G } from './state.js';
import { fx } from './fx.js';
import { audio } from './audio.js';
import { world, BLOCK, blockC, N } from './world.js';
import { Character } from './character.js';
import { rand, pick, chance, clamp, dampAngle, segSphere, randInt, angDiff } from './util.js';

const HALF_RING = BLOCK / 2 - 2.2;
const RING = HALF_RING * 8;
function ringPos(cx, cz, p, out) {
  p = ((p % RING) + RING) % RING;
  const side = Math.floor(p / (HALF_RING * 2)), t = p - side * HALF_RING * 2 - HALF_RING;
  const h = HALF_RING;
  if (side === 0) out.set(cx + t, 0, cz - h); else if (side === 1) out.set(cx + h, 0, cz + t);
  else if (side === 2) out.set(cx - t, 0, cz + h); else out.set(cx - h, 0, cz - t);
  return out;
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

export class Civilian {
  constructor(opts = {}) {
    const pal = pick([0x6a3a3a, 0x3a6a4a, 0x4a4a7a, 0x7a6a3a, 0x5a3a6a, 0x3a5a6a, 0x8a5a2a]);
    this.ch = new Character('civ', { armor: pal, under: pick([0x2a2a3a, 0x3a2a2a, 0x2a3a2a]), hair: pick([0x222222, 0x6a4a2a, 0xaa8a4a, 0x888888, 0xcc4444]), skin: pick([0xc09070, 0x8a5a3a, 0xe0b090, 0x6a4a30]) });
    this.pos = new THREE.Vector3(); this.yaw = 0; this.state = 'walk'; this.stateT = 0; this.hp = 20; this.scale = this.ch.style.scale;
    this.removed = false; this.victim = !!opts.victim; this.dead = false; this.name = 'Citizen';
    this.cx = 0; this.cz = 0; this.p = 0; this.dir = 1; this.speed = rand(1.2, 1.9); this.panicDir = new THREE.Vector3();
    this.hostage = false;
    G.scene.add(this.ch.root);
    this.ch.root.visible = false;
    this.ch.root.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  }
  placeOnRing() {
    const pl = G.player.pos;
    for (let t = 0; t < 12; t++) {
      const i = THREE.MathUtils.clamp(Math.floor((pl.x + world.HALF) / world.S + rand(-1.4, 1.4)), 0, N - 1), j = THREE.MathUtils.clamp(Math.floor((pl.z + world.HALF) / world.S + rand(-1.4, 1.4)), 0, N - 1);
      this.cx = blockC(i); this.cz = blockC(j); this.p = rand(0, RING); this.dir = chance(0.5) ? 1 : -1;
      ringPos(this.cx, this.cz, this.p, this.pos);
      const d = Math.hypot(this.pos.x - pl.x, this.pos.z - pl.z);
      if (d > 35 && d < 100) break;
    }
    this.state = 'walk'; this.hp = 20; this.ch.root.visible = true; this.ch.stopClip(); this.dead = false; this.ch.root.rotation.set(0, 0, 0);
  }
  hitTest(a, b) {
    if (this.removed || !this.ch.root.visible) return null;
    const p = this.pos, s = this.scale;
    if (this.state === 'dead') return null;
    const th = segSphere(a.x, a.y, a.z, b.x, b.y, b.z, p.x, p.y + 1.7 * s, p.z, 0.26 * s);
    const tb = segSphere(a.x, a.y, a.z, b.x, b.y, b.z, p.x, p.y + 1.0 * s, p.z, 0.5 * s);
    if (th !== null) return { t: th, head: true }; if (tb !== null) return { t: tb, head: false };
    return null;
  }
  hurt(d, info = {}) {
    if (this.state === 'dead') return;
    this.hp -= d;
    fx.text(this.pos.clone().setY(2.3), 'CIVILIAN!', 'bad');
    G.player?.civilianHit(this);
    if (this.hp <= 0) { this.state = 'dead'; this.dead = true; this.ch.play('die', { speed: 1.5 }); this.hostage = false; this.onDeath?.(); G.player?.civilianDeath(this); }
    else this.panic(this.pos, 0);
  }
  panic(from, strength) {
    if (this.state === 'dead' || this.hostage) return;
    this.state = 'panic'; this.stateT = 0; this.ch.stopClip();
    this.panicDir.set(this.pos.x - from.x, 0, this.pos.z - from.z); if (this.panicDir.lengthSq() < 0.01) this.panicDir.set(rand(-1, 1), 0, rand(-1, 1)); this.panicDir.normalize();
  }
  cower() { if (this.state === 'dead') return; this.state = 'cower'; this.ch.play('surrender'); }
  setHostage() { this.hostage = true; this.state = 'cower'; this.ch.play('surrender'); }
  update(dt) {
    const ch = this.ch; ch.speed = 0;
    this.stateT += dt;
    const pl = G.player;
    if (this.state === 'walk') {
      this.p += this.dir * this.speed * dt; ringPos(this.cx, this.cz, this.p, _a);
      const yaw = Math.atan2(_a.x - this.pos.x, _a.z - this.pos.z);
      if (_a.distanceToSquared(this.pos) > 1e-6) this.yaw = dampAngle(this.yaw, yaw, 6, dt);
      this.pos.x = _a.x; this.pos.z = _a.z; ch.speed = this.speed;
    } else if (this.state === 'panic') {
      this.pos.addScaledVector(this.panicDir, 6.5 * dt); this.yaw = dampAngle(this.yaw, Math.atan2(this.panicDir.x, this.panicDir.z), 8, dt); ch.speed = 6.5;
      world.collideCircle(this.pos, 0.4);
      if (this.stateT > 7 && !this.victim) { this.state = 'cower'; this.ch.play('surrender'); this.stateT = 0; }
    } else if (this.state === 'cower') {
      if (!this.victim && !this.hostage && this.stateT > 6) { this.ch.stopClip(); this.ch.root.visible = false; this.state = 'gone'; }
    } else if (this.state === 'dead') {
      this.stateT > 8 && (this.ch.root.visible = false);
    }
    const ev = ch.update(dt);
    for (const e of ev) if (e === 'step' && pl && this.pos.distanceTo(pl.pos) < 20) audio.step(this.pos, 0.5);
    ch.root.position.copy(this.pos); ch.root.rotation.y = this.yaw;
  }
  remove() { this.removed = true; G.scene.remove(this.ch.root); }
}

export class CivManager {
  constructor() { this.list = []; this.spawned = false; }
  init() {
    for (let i = 0; i < 16; i++) { const c = new Civilian(); this.list.push(c); }
    this.spawned = false;
  }
  spawnVictim(pos, mode = 'cower') {
    const c = new Civilian({ victim: true }); c.pos.copy(pos); c.ch.root.visible = true; c.victim = true; c.state = 'cower';
    c.ch.play('surrender'); this.list.push(c); c.yaw = rand(0, 6.28); return c;
  }
  panic(pos, radius) {
    for (const c of this.list) if (!c.removed && c.ch.root.visible && Math.hypot(c.pos.x - pos.x, c.pos.z - pos.z) < radius) c.panic(pos, radius);
  }
  update(dt) {
    const pl = G.player; if (!pl) return;
    if (!this.spawned) { for (const c of this.list) if (!c.victim) c.placeOnRing(); this.spawned = true; }
    for (const c of this.list) {
      if (c.removed) continue;
      if (!c.victim) {
        const d = Math.hypot(c.pos.x - pl.pos.x, c.pos.z - pl.pos.z);
        if (c.state === 'gone' || d > 130 || (c.state === 'dead' && c.stateT > 10)) { c.placeOnRing(); }
      }
      if (c.ch.root.visible) c.update(dt);
      if (!c.victim && c.ch.root.visible) { const dd = Math.hypot(c.pos.x - pl.pos.x, c.pos.z - pl.pos.z); c.ch.root.children.forEach((k) => { k.visible = dd < 90; }); }
    }
    this.list = this.list.filter((c) => !c.removed);
  }
}
