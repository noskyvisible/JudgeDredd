import * as THREE from 'three';
import { G } from './state.js';
import { fx } from './fx.js';
import { audio } from './audio.js';
import { world } from './world.js';
import { makeEagle } from './world.js';
import { Character } from './character.js';
import { makeLawmasterModel, ridePoseIK } from './lawmaster.js';
import { clamp, lerp, damp, angDiff, dampAngle, rand, deg, chance } from './util.js';

const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.8, ...o });
const E = (c, k = 3) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false });

// ---------------------------------------------------------------------------
// Lawmaster model + rider pose live in lawmaster.js
// ---------------------------------------------------------------------------
export const makeBikeModel = makeLawmasterModel;
export function ridePose(ch, bike) { ridePoseIK(ch, bike); }

// ---------------------------------------------------------------------------
// Path follower along road-grid nodes
// ---------------------------------------------------------------------------
export class PathFollower {
  constructor() { this.pts = []; this.i = 0; this.lane = 5.2; }
  set(pts) { this.pts = pts; this.i = 0; }
  get done() { return this.i >= this.pts.length - 1; }
  target(pos, look = 16) {
    const p = this.pts;
    if (p.length < 2) return null;
    while (this.i < p.length - 1) {
      const a = p[this.i], b = p[this.i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len, px = -uz * this.lane, pz = ux * this.lane;
      const t = ((pos.x - (a.x + px)) * ux + (pos.z - (a.z + pz)) * uz);
      if (t > len - 14 && this.i < p.length - 2) { this.i++; continue; }
      if (t > len - 4) { this.i++; continue; }
      const tt = clamp(t + look, 0, len + 30);
      return { x: a.x + px + ux * tt, z: a.z + pz + uz * tt, ux, uz, endDist: len - t + (p.length - 2 - this.i) * 100 };
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Player bike (Lawmaster)
// ---------------------------------------------------------------------------
export class Lawmaster {
  constructor(scene, pal) {
    this.model = makeBikeModel(pal); scene.add(this.model);
    this.pos = new THREE.Vector3(); this.yaw = 0; this.vx = 0; this.vz = 0;
    this.speed = 0; this.steer = 0; this.lean = 0; this.boostE = 1; this.boosting = false; this.drifting = false;
    this.hp = 100; this.auto = false; this.path = new PathFollower(); this.sirenOn = false; this.sirenT = 0;
    this.accelLean = 0; this.slip = 0; this.rider = null; this.skidT = 0; this.called = false; this.wheelRot = 0;
    this.ctrl = { throttle: 0, steer: 0, brake: 0, boost: false, drift: false, hold: false };
    this.radius = 1.0; this.perp = false;
  }
  place(x, z, yaw) { this.pos.set(x, 0, z); this.yaw = yaw; this.vx = this.vz = 0; this.speed = 0; this.sync(); }
  get fwd() { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  update(dt) {
    const c = this.ctrl;
    const fx_ = Math.sin(this.yaw), fz_ = Math.cos(this.yaw), rx = fz_, rz = -fx_;
    let vf = this.vx * fx_ + this.vz * fz_, vl = this.vx * rx + this.vz * rz;
    const maxV = 78, maxB = 118;
    this.boosting = c.boost && this.boostE > 0.02 && c.throttle > 0;
    if (c.hold) { c.throttle = 0; c.brake = 0; c.boost = false; vf *= Math.exp(-3.5 * dt); this.boosting = false; }
    const accel = 36 + (this.boosting ? 62 : 0);
    if (c.throttle > 0) vf += accel * c.throttle * dt * (1 - Math.max(0, vf) / (this.boosting ? maxB : maxV) * 0.8);
    if (c.brake > 0) { if (vf > 0.5) vf -= 70 * c.brake * dt; else vf -= 22 * c.brake * dt; }
    vf = clamp(vf, -14, this.boosting ? maxB : maxV * 1.02);
    vf -= vf * 0.07 * dt + Math.sign(vf) * 1.2 * dt;
    if (!this.boosting) this.boostE = Math.min(1, this.boostE + dt * 0.12); else this.boostE = Math.max(0, this.boostE - dt * 0.28);
    // steering
    const target = c.steer;
    this.steer = damp(this.steer, target, 9, dt);
    const sp = Math.abs(vf);
    const turnRate = lerp(2.5, 0.8, clamp(sp / 75, 0, 1)) * (c.drift ? 1.55 : 1);
    this.yaw -= this.steer * turnRate * Math.sign(vf || 1) * clamp(sp / 4, 0, 1) * dt;
    this.drifting = c.drift && sp > 14;
    const grip = this.drifting ? 1.3 : 7.5;
    vl *= Math.exp(-grip * dt);
    if (this.drifting) vf *= Math.exp(-0.35 * dt);
    this.slip = vl;
    // rebuild velocity in new heading (keep lateral as slip)
    const nfx = Math.sin(this.yaw), nfz = Math.cos(this.yaw), nrx = nfz, nrz = -nfx;
    // momentum is not fully re-aimed: blend old direction with new heading
    const keep = this.drifting ? 0.35 : 0.0;
    let ovx = this.vx, ovz = this.vz;
    this.vx = nfx * vf + nrx * vl; this.vz = nfz * vf + nrz * vl;
    if (keep > 0) { this.vx = lerp(this.vx, ovx * Math.exp(-0.2 * dt), keep); this.vz = lerp(this.vz, ovz * Math.exp(-0.2 * dt), keep); }
    this.speed = vf;
    this.pos.x += this.vx * dt; this.pos.z += this.vz * dt;
    // collisions
    const hit = world.collideCircle(this.pos, this.radius);
    if (hit) {
      const vn = this.vx * hit.nx + this.vz * hit.nz;
      if (vn < 0) {
        const impact = -vn;
        this.vx -= (1 + 0.25) * vn * hit.nx; this.vz -= (1 + 0.25) * vn * hit.nz;
        this.vx *= 0.8; this.vz *= 0.8;
        if (impact > 5) this.crash(impact, hit);
      }
    }
    this.accelLean = damp(this.accelLean, c.throttle - c.brake, 5, dt);
    this.lean = damp(this.lean, -this.steer * clamp(sp / 40, 0, 1) * 0.7 - clamp(this.slip * 0.02, -0.3, 0.3), 8, dt);
    this.sync(dt);
    this.fx(dt);
  }

  crash(impact, hit) {
    const dmg = Math.max(0, (impact - 9) * 0.9);
    if (dmg > 0 && !this.perp) G.player?.damage(dmg * 0.4, null, 'crash');
    this.hp -= dmg;
    const p = this.pos.clone(); p.y = 0.8; p.x -= hit.nx * 0.8; p.z -= hit.nz * 0.8;
    fx.spark(p, 12 + Math.min(30, impact), 0xffc060, 10, 0.6);
    fx.shake(Math.min(1.2, impact / 30));
    audio.crash(p, Math.min(1.5, impact / 20));
    if (this.perp) this.onWallHit?.(impact);
  }

  sync(dt = 0) {
    const m = this.model, u = m.userData;
    m.position.copy(this.pos);
    m.rotation.set(0, this.yaw, 0);
    m.rotation.order = 'YXZ';
    m.rotation.z = this.lean;
    u.front.rotation.y = -this.steer * 0.45;
    this.wheelRot += this.speed * (dt || 0) / 0.55;
    u.rearSpin.rotation.x = this.wheelRot; u.frontSpin.rotation.x = this.wheelRot;
    m.position.y = Math.sin(G.time * 18) * 0.008 * clamp(Math.abs(this.speed) / 40, 0, 1) * 0 + 0;
  }

  fx(dt) {
    const u = this.model.userData;
    const ex = u.exhaust;
    // exhaust flames when boosting
    if (this.boosting) {
      for (const e of ex) {
        const w = e.clone().applyMatrix4(this.model.matrixWorld);
        const back = this.fwd.clone().multiplyScalar(-1);
        fx.add.emit(w.x, w.y, w.z, back.x * 14 + rand(-1, 1), rand(-0.5, 0.5), back.z * 14 + rand(-1, 1), 0.4, 0.9, 2.6, 1, rand(0.25, 0.45), rand(0.12, 0.25), 0, 2, -0.7);
        fx.add.emit(w.x, w.y, w.z, back.x * 8, rand(0, 1), back.z * 8, 2.4, 1.0, 0.25, 1, rand(0.2, 0.4), rand(0.1, 0.2), 0, 2, -0.7);
      }
      fx.flash(this.pos.clone().add(this.fwd.clone().multiplyScalar(-3)).setY(1), 0x4090ff, 0.8, 0.06, 14);
      if (G.mounted === this) {   // air streaks rushing past the camera
        const sx = -this.fwd.z, sz = this.fwd.x, sp = Math.max(20, Math.abs(this.speed));
        for (let k = 0; k < 2; k++) {
          const f = rand(2, 16), sd = rand(-5, 5);
          fx.sparks.emit(this.pos.x + this.fwd.x * f + sx * sd, rand(0.3, 3.2), this.pos.z + this.fwd.z * f + sz * sd, -this.fwd.x * sp * 0.55, 0, -this.fwd.z * sp * 0.55, 0.5, 0.85, 2.2, rand(0.12, 0.25), 0.07, 0, 0);
        }
      }
    } else if (this.speed > 5 && chance(0.3)) {
      const w = ex[chance(0.5) ? 0 : 1].clone().applyMatrix4(this.model.matrixWorld);
      fx.add.emit(w.x, w.y, w.z, -this.vx * 0.1, 0.2, -this.vz * 0.1, 0.4, 0.8, 1.6, 0.6, 0.3, 0.12, 0, 2, -0.5);
    }
    // drift smoke & sparks, wheel spray
    if (this.drifting) {
      const w = this.pos.clone().add(this.fwd.clone().multiplyScalar(-1.2)); w.y = 0.2;
      fx.smokePuff(w, 1, 1.3, 0.9, 0.28, 0.6);
      fx.spark(w, 3, 0xffa040, 6, 0.3);
      this.skidT -= dt; if (this.skidT <= 0) { this.skidT = 0.25; audio.skid(); }
    }
    if (Math.abs(this.speed) > 12 && chance(Math.abs(this.speed) / 150)) { // rain spray from rear wheel
      const w = this.pos.clone().add(this.fwd.clone().multiplyScalar(-1.3)); w.y = 0.15;
      fx.smoke.emit(w.x, w.y, w.z, rand(-1, 1) - this.vx * 0.05, rand(0.5, 1.5), rand(-1, 1) - this.vz * 0.05, 0.3, 0.32, 0.4, 0.3, 0.7, 0.6, 0, 1, 1.5);
    }
    // siren
    this.sirenT += dt;
    const on = this.sirenOn;
    const ph = Math.floor(this.sirenT * 6) % 2;
    u.sirenL.material.color.setRGB(on && ph === 0 ? 3 : 0.25, 0.15 * (on && ph === 0), 0.15 * (on && ph === 0));
    u.sirenR.material.color.setRGB(on && ph === 1 ? 0.3 : 0.05, on && ph === 1 ? 0.8 : 0.05, on && ph === 1 ? 3 : 0.3);
    u.siren.intensity = on ? 8 : 0; u.siren.color.set(ph === 0 ? 0xff2020 : 0x2060ff);
    u.spot.intensity = G.mounted === this || this.perp ? 60 : 12;
  }

  // autopilot control: fills ctrl from path following
  autopilot(dt, dest) {
    const c = this.ctrl;
    if (!this.path.pts.length || this.path.refresh) { this.path.set(world.route(this.pos, dest)); this.path.refresh = false; }
    const t = this.path.target(this.pos, clamp(Math.abs(this.speed) * 0.5, 10, 28));
    if (!t) { c.throttle = 0; c.brake = 1; c.steer = 0; c.boost = false; c.drift = false; return true; }
    const des = Math.atan2(t.x - this.pos.x, t.z - this.pos.z);
    const ad = angDiff(this.yaw, des);
    c.steer = clamp(-ad * 2.4, -1, 1);
    const targetSpeed = Math.abs(ad) > 0.7 ? 20 : Math.abs(ad) > 0.3 ? 38 : (t.endDist < 60 ? 28 : 56);
    const err = targetSpeed - this.speed;
    c.throttle = clamp(err / 8, 0, 1); c.brake = clamp(-err / 12, 0, 1);
    c.boost = false; c.drift = false;
    // avoid traffic
    const ahead = G.traffic?.nearestAhead(this.pos, this.fwd, 22);
    if (ahead) { c.throttle = 0; c.brake = clamp(1.2 - ahead / 22, 0.3, 1); }
    return t.endDist < 25;
  }
}

// ---------------------------------------------------------------------------
// Hostile biker
// ---------------------------------------------------------------------------
export class PerpBike extends Lawmaster {
  constructor(scene, crime) {
    super(scene, { body: 0x3a0e16, accent: 0xff3040, glow: 0xff4030 });
    this.perp = true; this.hp = 100; this.maxHp = 100; this.crime = crime; this.radius = 1.1;
    this.rider = new Character('biker'); this.model.add(this.rider.root); ridePose(this.rider, this);
    this.state = 'idle'; this.nextNode = null; this.fleeT = 0; this.dead = false; this.crashed = false;
    this.name = 'Speed Demon'; this.isBike = true;
    this.model.userData.spot.intensity = 18;
    this.pathNodes = []; this.wanderT = 0;
    this.sirenOn = false;
  }
  get alive() { return !this.crashed; }
  hitTest(a, b) {
    if (this.crashed) return null;
    const c = this.pos;
    const t = segSphereLocal(a, b, c.x, 1.0, c.z, 1.5);
    return t === null ? null : { t, head: false };
  }
  hurt(d, info = {}) {
    if (this.crashed) return;
    this.hp -= d * (info.type === 'melee' ? 0.2 : 1);
    G.hud?.hitMarker(false);
    if (info.type === 'explosive' || info.type === 'bullet') { fx.spark(this.pos.clone().setY(1), 5, 0xffa040, 6, 0.4); }
    this.fleeT = 0;
    if (this.hp <= 0) this.wreck();
  }
  wreck() {
    this.crashed = true; this.state = 'wreck';
    this.onWreck?.(this);
  }
  tick(dt) {
    const c = this.ctrl;
    const pl = G.player;
    if (this.crashed) {
      this.speed *= Math.exp(-1.5 * dt); this.vx *= Math.exp(-1.5 * dt); this.vz *= Math.exp(-1.5 * dt);
      c.throttle = 0; c.brake = 0; c.steer = 0.8; c.boost = false;
      this.model.rotation.order = 'YXZ';
      super.update(dt);
      this.model.rotation.z = lerp(this.model.rotation.z, 1.4, 0.1); this.model.position.y = lerp(this.model.position.y, 0.2, 0.2);
      this.rider.root.visible = false; fx.fire(this.pos.clone().setY(0.6), 1, 0.6); fx.smokePuff(this.pos.clone().setY(1), 1, 1.4, 1.4, 0.2, 2);
      return;
    }
    const dp = pl ? Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z) : 999;
    if (this.state === 'idle') { c.throttle = 0; c.brake = 1; if (dp < 90 || this.provoked) { this.state = 'flee'; this.rider.speed = 0; } }
    if (this.state === 'flee') {
      // follow road graph, choose next node away from player
      const done = this.path.pts.length ? this.path.done : true;
      if (done) {
        const [ni, nj] = world.nearestNode(this.pos.x, this.pos.z);
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        let best = null, bs = -1e9;
        for (let k = 0; k < 6; k++) {
          const d = dirs[Math.floor(Math.random() * 4)];
          const i2 = clamp(ni + d[0] * 2, 0, world.N), j2 = clamp(nj + d[1] * 2, 0, world.N);
          if (i2 === ni && j2 === nj) continue;
          const p = world.nodePos(i2, j2);
          const sc = Math.hypot(p.x - pl.pos.x, p.z - pl.pos.z) + Math.random() * 120;
          if (sc > bs) { bs = sc; best = p; }
        }
        this.path.set(world.route(this.pos, best || { x: 0, z: 0 }));
      }
      const t = this.path.target(this.pos, clamp(this.speed * 0.45, 9, 24));
      if (t) {
        const des = Math.atan2(t.x - this.pos.x, t.z - this.pos.z), ad = angDiff(this.yaw, des);
        c.steer = clamp(-ad * 2.6, -1, 1);
        const ts = Math.abs(ad) > 0.8 ? 18 : Math.abs(ad) > 0.35 ? 34 : 58;
        c.throttle = clamp((ts - this.speed) / 8, 0, 1); c.brake = clamp((this.speed - ts) / 14, 0, 1);
        c.drift = Math.abs(ad) > 0.9 && this.speed > 24;
      }
      const ahead = G.traffic?.nearestAhead(this.pos, this.fwd, 16);
      if (ahead) { c.throttle = 0; c.brake = 0.5; c.steer += 0.5; }
      this.fleeT += dt;
    }
    super.update(dt);
    // keep rider seated
    this.rider.update(dt);
  }
}

function segSphereLocal(a, b, cx, cy, cz, r) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, fx_ = a.x - cx, fy = a.y - cy, fz = a.z - cz;
  const A = dx * dx + dy * dy + dz * dz; if (A < 1e-9) return null;
  const B = 2 * (fx_ * dx + fy * dy + fz * dz), C = fx_ * fx_ + fy * fy + fz * fz - r * r;
  let D = B * B - 4 * A * C; if (D < 0) return null; D = Math.sqrt(D);
  let t = (-B - D) / (2 * A); if (t < 0) t = (-B + D) / (2 * A);
  return t >= 0 && t <= 1 ? t : (C < 0 ? 0 : null);
}
