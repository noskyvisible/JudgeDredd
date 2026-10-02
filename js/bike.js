import * as THREE from 'three';
import { G } from './state.js';
import { fx } from './fx.js';
import { audio } from './audio.js';
import { world } from './world.js';
import { makeEagle } from './world.js';
import { Character } from './character.js';
import { clamp, lerp, damp, angDiff, dampAngle, rand, deg, chance } from './util.js';

const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.8, ...o });
const E = (c, k = 3) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false });

// ---------------------------------------------------------------------------
// Lawmaster model
// ---------------------------------------------------------------------------
export function makeBikeModel(pal = {}) {
  const body = pal.body ?? 0x14161c, accent = pal.accent ?? 0xe8b52a, glow = pal.glow ?? 0x40b0ff;
  const g = new THREE.Group();
  const shell = M(body, { roughness: 0.22, metalness: 0.85 });
  const dark = M(0x0b0c10, { roughness: 0.5, metalness: 0.7 });
  const gold = M(accent, { roughness: 0.3, metalness: 0.95 });
  const tyre = M(0x0a0a0c, { roughness: 0.9, metalness: 0.1 });
  const add = (mesh, x, y, z, parent = g) => { mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh; };

  // wheels
  const wheel = (z) => {
    const w = new THREE.Group(); w.position.set(0, 0.5, z);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.32, 20), tyre); t.rotation.z = Math.PI / 2; t.castShadow = true; w.add(t);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.34, 16), M(0x22252e)); rim.rotation.z = Math.PI / 2; w.add(rim);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.025, 6, 24), E(glow, 2.5)); ring.rotation.y = Math.PI / 2; ring.position.x = 0.17; w.add(ring);
    const ring2 = ring.clone(); ring2.position.x = -0.17; w.add(ring2);
    for (let i = 0; i < 4; i++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.6, 0.06), dark); sp.rotation.x = (i * Math.PI) / 4; w.add(sp); }
    return w;
  };
  const wr = wheel(-1.2); g.add(wr);
  // front assembly pivots on Y
  const front = new THREE.Group(); front.position.set(0, 1.2, 0.75); g.add(front);
  const wf = wheel(0); wf.position.set(0, -0.7, 0.5); front.add(wf);
  for (const x of [-0.2, 0.2]) { const fk = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.85, 6), M(0xaaaaaa, { metalness: 1, roughness: 0.2 })); fk.position.set(x, -0.35, 0.5); fk.rotation.x = -0.1; front.add(fk); }
  add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.06), dark), 0, 0.12, 0.1, front);
  for (const x of [-0.5, 0.5]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 6), dark), x, 0.12, 0.1, front).rotation.x = Math.PI / 2;
  // front nose fairing
  const nose = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.9, 6, 12), shell); nose.rotation.x = Math.PI / 2; nose.scale.set(1.15, 1, 0.78);
  add(nose, 0, -0.15, 0.6, front);
  for (const x of [-0.22, 0.22]) add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.06), E(0xfff4d0, 4)), x, -0.07, 1.12, front);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.05), E(accent, 1.8)), 0, -0.3, 1.1, front);
  // windscreen
  const ws = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.5), new THREE.MeshStandardMaterial({ color: 0x4a8ac0, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.5, side: THREE.DoubleSide, emissive: 0x103050, emissiveIntensity: 0.5 }));
  ws.position.set(0, 0.28, 0.5); ws.rotation.x = -1.0; front.add(ws);
  // siren bar
  const sirenL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.12), E(0xff2020, 0.3)); add(sirenL, -0.18, 0.04, 0.55, front);
  const sirenR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.12), E(0x2060ff, 0.3)); add(sirenR, 0.18, 0.04, 0.55, front);
  // main body
  const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.3, 6, 14), shell); tank.rotation.x = Math.PI / 2; tank.scale.set(1.05, 1, 0.72);
  add(tank, 0, 0.95, -0.15);
  const cowl = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.9, 6, 12), shell); cowl.rotation.x = Math.PI / 2; cowl.scale.set(1, 1, 0.8);
  add(cowl, 0, 1.0, -1.0);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.12, 0.9), M(0x1a1410, { roughness: 0.8, metalness: 0.1 })), 0, 1.3, -0.5); // seat
  add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 1.1), dark), 0, 0.55, -0.3); // engine
  for (const x of [-0.36, 0.36]) add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.7), E(glow, 3)), x, 0.55, -0.3);
  // side pods
  for (const x of [-0.52, 0.52]) {
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 1.5, 4, 10), shell); pod.rotation.x = Math.PI / 2; pod.scale.set(0.8, 1, 1);
    add(pod, x, 0.82, -0.25);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 1.6), E(accent, 1.8)), x * 1.17, 0.85, -0.25);
    const eg = makeEagle(gold, 0.6, 0.04); eg.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2; eg.position.set(x * 1.25, 1.12, 0.1); g.add(eg);
  }
  // exhausts & tail
  for (const x of [-0.22, 0.22]) {
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.5, 10), M(0x555a66, { metalness: 1, roughness: 0.25 })); ex.rotation.x = Math.PI / 2;
    add(ex, x, 0.78, -1.85);
    const tip = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 12), E(0xff7a30, 2)); tip.position.set(x, 0.78, -2.12); g.add(tip);
  }
  add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.07, 0.05), E(0xff2010, 3.5)), 0, 1.02, -1.62);
  // pegs / feet rests
  for (const x of [-0.42, 0.42]) add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.3), dark), x, 0.62, 0.15);
  // headlight beam
  const spot = new THREE.SpotLight(0xfff0d8, 0, 80, 0.5, 0.7, 1.2);
  spot.position.set(0, 1.2, 1.6); spot.target.position.set(0, 0.5, 14); front.add(spot); front.add(spot.target);
  const siren = new THREE.PointLight(0xff2020, 0, 22, 2); siren.position.set(0, 1.9, 0.9); g.add(siren);
  g.userData = { wr, wf, front, spot, siren, sirenL, sirenR, exhaust: [new THREE.Vector3(-0.22, 0.78, -2.2), new THREE.Vector3(0.22, 0.78, -2.2)] };
  return g;
}

// rider pose (applied through Character.override)
export function ridePose(ch, bike) {
  ch.override = (B) => {
    const steer = bike.steer || 0, ac = bike.accelLean || 0;
    B.pos[1] = -0.44; B.pos[2] = 0.0;
    B.torso[0] = 0.5 + ac * 0.15; B.torso[1] = steer * 0.25; B.torso[2] = -steer * 0.1;
    B.head[0] = -0.35; B.head[1] = -steer * 0.2;
    B.hipL[0] = -1.15; B.hipR[0] = -1.15; B.hipL[2] = 0.28; B.hipR[2] = -0.28;
    B.knL[0] = 1.5; B.knR[0] = 1.5;
    B.shL[0] = -1.15; B.shR[0] = -1.15 + (ch.aim > 0.1 ? -0.0 : 0); B.shL[1] = -0.05; B.shR[1] = 0.05;
    B.elL[0] = -0.45; B.elR[0] = -0.45;
    B.shL[2] = 0.2; B.shR[2] = -0.2;
  };
}

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
    this.ctrl = { throttle: 0, steer: 0, brake: 0, boost: false, drift: false };
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
    this.wheelRot += this.speed * (dt || 0) / 0.5;
    u.wr.children[0].rotation.x = u.wr.children[1].rotation.x = this.wheelRot;
    for (let i = 3; i < u.wr.children.length; i++) u.wr.children[i].rotation.x = this.wheelRot + (i - 3) * Math.PI / 4;
    for (let i = 3; i < u.wf.children.length; i++) u.wf.children[i].rotation.x = this.wheelRot + (i - 3) * Math.PI / 4;
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
    this.rider.root.position.set(0, 0.28, -0.55);
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
