import * as THREE from 'three';
import { G } from './state.js';
import { fx } from './fx.js';
import { audio } from './audio.js';
import { world, roadX, N } from './world.js';
import { PathFollower } from './bike.js';
import { rand, pick, chance, clamp, angDiff, dampAngle, segSphere, randInt } from './util.js';
import { makeCarModel, CAR_KINDS } from './carmodel.js';

const COLS = [0x8a1a1a, 0x1a3a8a, 0xb0a020, 0x2a2a2e, 0xd0d0d8, 0x1a6a4a, 0x6a2a8a, 0xc06a1a];

class Car {
  constructor(i) {
    this.kind = pick(CAR_KINDS); this.truck = this.kind === 'truck';
    this.model = makeCarModel(this.kind, pick(COLS));
    G.scene.add(this.model);
    this.steer = 0; this.prevYaw = 0; this.prevSpeed = 0; this.braking = false; this.pitch = 0; this.roll = 0;
    this.path = new PathFollower(); this.path.lane = 5.0 + rand(-0.4, 0.4);
    this.pos = new THREE.Vector3(); this.yaw = 0; this.speed = 0; this.maxSpeed = rand(14, 24);
    this.hp = 120; this.dead = false; this.r = this.truck ? 2.6 : 2.1; this.respawnT = 0; this.vx = 0; this.vz = 0; this.stopT = 0;
    this.spawn();
  }
  spawn() {
    const [i, j] = [randInt(0, N), randInt(0, N)];
    const horiz = chance(0.5);
    const a = world.nodePos(i, j);
    const k = clamp(i + (horiz ? 1 : 0), 0, N), l = clamp(j + (horiz ? 0 : 1), 0, N);
    const b = world.nodePos(k, l);
    const t = rand(0.1, 0.9);
    this.pos.set(a.x + (b.x - a.x) * t, 0, a.z + (b.z - a.z) * t);
    this.yaw = Math.atan2(b.x - a.x, b.z - a.z);
    if (chance(0.5)) this.yaw += Math.PI;
    this.speed = this.maxSpeed; this.dead = false; this.hp = 120; this.model.visible = true; this.model.rotation.set(0, this.yaw, 0);
    const u = this.model.userData; if (u.lampMesh) u.lampMesh.visible = true; u.tail.color.setRGB(1.6, 0.06, 0.05); this.prevYaw = this.yaw;
    this.extendPath(true);
    // lane offset
    const fx_ = Math.sin(this.yaw), fz_ = Math.cos(this.yaw);
    this.pos.x += -fz_ * this.path.lane; this.pos.z += fx_ * this.path.lane;
  }
  extendPath(fresh = false) {
    const [ni, nj] = world.nearestNode(this.pos.x, this.pos.z);
    const fx_ = Math.sin(this.yaw), fz_ = Math.cos(this.yaw);
    // pick the node ahead of us along our heading
    let ci = ni, cj = nj;
    const ahead = { x: this.pos.x + fx_ * 40, z: this.pos.z + fz_ * 40 };
    const [ai, aj] = world.nearestNode(ahead.x, ahead.z);
    if (Math.abs(fx_) > Math.abs(fz_)) { ci = clamp(ni + Math.sign(fx_) * (Math.abs(world.nodePos(ni, nj).x - this.pos.x) < 8 ? 1 : 0), 0, N); if (ai !== ni) ci = ai; cj = nj; }
    else { cj = clamp(nj + Math.sign(fz_) * (Math.abs(world.nodePos(ni, nj).z - this.pos.z) < 8 ? 1 : 0), 0, N); if (aj !== nj) cj = aj; ci = ni; }
    const pts = [this.pos.clone()];
    let di = Math.sign(fx_) * (Math.abs(fx_) > Math.abs(fz_) ? 1 : 0), dj = Math.sign(fz_) * (Math.abs(fz_) >= Math.abs(fx_) ? 1 : 0);
    let i = ci, j = cj;
    pts.length = 0; pts.push({ x: this.pos.x - fx_ * 5 + fz_ * this.path.lane, z: this.pos.z - fz_ * 5 - fx_ * this.path.lane });
    for (let s = 0; s < 6; s++) {
      pts.push({ x: roadX(i), z: roadX(j) });
      const opts = [[di, dj], [dj, -di], [-dj, di]];
      let nd = chance(0.6) ? opts[0] : pick(opts);
      let ni2 = i + nd[0], nj2 = j + nd[1];
      if (ni2 < 0 || ni2 > N || nj2 < 0 || nj2 > N) { nd = opts[0]; ni2 = i + nd[0]; nj2 = j + nd[1]; if (ni2 < 0 || ni2 > N || nj2 < 0 || nj2 > N) { nd = opts[1]; ni2 = i + nd[0]; nj2 = j + nd[1]; if (ni2 < 0 || ni2 > N || nj2 < 0 || nj2 > N) { nd = opts[2]; ni2 = i + nd[0]; nj2 = j + nd[1]; } } }
      di = nd[0]; dj = nd[1]; i = clamp(ni2, 0, N); j = clamp(nj2, 0, N);
    }
    pts.push({ x: roadX(i), z: roadX(j) });
    this.path.set(pts);
  }
  hit(d) {
    if (this.dead) return;
    this.hp -= d;
    if (this.hp <= 0) this.explode();
  }
  explode() {
    this.dead = true; this.respawnT = 25; this.speed = 0;
    const p = this.pos.clone(); p.y = 1;
    fx.explosion(p, 0.9); audio.explosion(0.8, p);
    G.player?.blastCheck(p, 6, 20);
    G.civs?.panic(p, 40);
    G.player?.onCarDestroyed?.(this);
    const u = this.model.userData; u.paint.color.multiplyScalar(0.15); u.paint.clearcoat = 0; u.paint.roughness = 0.9; u.paint.metalness = 0.2;   // burnt-out shell
    if (u.lampMesh) u.lampMesh.visible = false; u.tail.color.setRGB(0.02, 0, 0);
    this.model.rotation.z = rand(-0.06, 0.06); this.model.userData.chassis.position.y = -0.04;
  }
  update(dt) {
    const pl = G.player;
    const dp = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
    if (this.dead) {
      this.respawnT -= dt; fx.fire(this.pos.clone().setY(0.8), 1, 1.0);
      if (this.respawnT < 0 && dp > 120) { const u = this.model.userData; u.paint.color.set(this.kind === 'taxi' ? 0xe2b21c : pick(COLS)); u.paint.clearcoat = 0.9; u.paint.roughness = 0.34; u.paint.metalness = 0.6; u.chassis.position.y = 0; this.model.rotation.z = 0; this.spawn(); }
      return;
    }
    if (dp > 360) { // far away cars keep position but teleport near the player's neighbourhood occasionally
      if (this.far === undefined) this.far = 0; this.far += dt; if (this.far > 6) { this.far = 0; this.respawnNear(pl.pos); }
    }
    // steering
    const t = this.path.target(this.pos, 14);
    if (!t || this.path.done) this.extendPath();
    else {
      const des = Math.atan2(t.x - this.pos.x, t.z - this.pos.z);
      this.steer += (clamp(angDiff(this.yaw, des) * 0.9, -0.45, 0.45) - this.steer) * Math.min(1, dt * 8);
      this.yaw = dampAngle(this.yaw, des, 3.5, dt);
    }
    let target = this.maxSpeed;
    // brake for things ahead
    const fx_ = Math.sin(this.yaw), fz_ = Math.cos(this.yaw);
    const pd = this.ahead(pl.pos, fx_, fz_, 14, 3.2);
    if (pd !== null) target = pd < 6 ? 0 : 3;
    for (const o of G.traffic.cars) { if (o === this) continue; const d = this.ahead(o.pos, fx_, fz_, 14, 3.2); if (d !== null && d < 14) target = Math.min(target, d < 6 ? 0 : 4); }
    if (G.bikeObj && G.mode === 'foot') { const d = this.ahead(G.bikeObj.pos, fx_, fz_, 12, 2); if (d !== null) target = 0; }
    this.speed += (target - this.speed) * Math.min(1, dt * (target < this.speed ? 2.5 : 0.8));
    this.vx += (fx_ * this.speed - this.vx) * Math.min(1, dt * 6); this.vz += (fz_ * this.speed - this.vz) * Math.min(1, dt * 6);
    this.pos.x += this.vx * dt; this.pos.z += this.vz * dt;
    this.model.position.copy(this.pos); this.model.rotation.y = this.yaw;
    // suspension: nose dips under braking, squats under throttle, body rolls into turns; wheels spin and steer
    const u = this.model.userData, acc = dt > 0 ? (this.speed - this.prevSpeed) / dt : 0, yr = dt > 0 ? angDiff(this.prevYaw, this.yaw) / dt : 0;
    this.pitch += (clamp(-acc * 0.006, -0.05, 0.05) - this.pitch) * Math.min(1, dt * 6); this.roll += (clamp(-yr * this.speed * 0.0035, -0.06, 0.06) - this.roll) * Math.min(1, dt * 6);
    u.chassis.rotation.x = this.pitch; u.chassis.rotation.z = this.roll;
    for (const w of u.wheels) w.rotation.x += this.speed * dt / u.wheelR;
    for (const f of u.front) f.rotation.y = this.steer;
    this.braking = target < this.speed - 0.6; const bk = this.braking ? 1 : 0;
    u.tail.color.setRGB(1.5 + bk * 3.2, 0.05 + bk * 0.3, 0.04 + bk * 0.2);
    this.prevYaw = this.yaw; this.prevSpeed = this.speed;
  }
  ahead(p, fx_, fz_, range, width) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z; const f = dx * fx_ + dz * fz_;
    if (f < 0 || f > range) return null; const l = Math.abs(-dx * fz_ + dz * fx_);
    return l < width ? f : null;
  }
  respawnNear(c) {
    for (let k = 0; k < 8; k++) {
      this.pos.set(c.x + rand(-250, 250), 0, c.z + rand(-250, 250));
      const [i, j] = world.nearestNode(this.pos.x, this.pos.z); const a = world.nodePos(i, j);
      if (chance(0.5)) this.pos.set(a.x + this.path.lane, 0, this.pos.z); else this.pos.set(this.pos.x, 0, a.z + this.path.lane);
      if (Math.hypot(this.pos.x - c.x, this.pos.z - c.z) > 140) break;
    }
    this.yaw = [0, Math.PI / 2, Math.PI, -Math.PI / 2][randInt(0, 3)];
    this.extendPath();
  }
}

// volumetric headlight beams: one additive cone per car, streaked by rain
const BEAM_L = 16;
function makeBeams(max) {
  const g = new THREE.ConeGeometry(2.7, BEAM_L, 14, 1, true); g.translate(0, -BEAM_L / 2, 0); g.rotateX(-Math.PI / 2);   // apex at the lamps, opening along +Z
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { time: { value: 0 } },
    vertexShader: `varying float vT; varying vec3 vW; varying vec3 vN; varying vec3 vV;
      void main(){ vec4 wp = instanceMatrix * vec4(position, 1.0); wp = modelMatrix * wp; vW = wp.xyz; vT = clamp(position.z / ${BEAM_L.toFixed(1)}, 0.0, 1.0);
        vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `varying float vT; varying vec3 vW; varying vec3 vN; varying vec3 vV; uniform float time;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        float fres = pow(abs(dot(normalize(vN), normalize(vV))), 1.3);
        float a = (1.0 - vT) * (1.0 - vT) * fres * 0.42;
        float col = hash(floor(vW.xz * 8.0)); float streak = smoothstep(0.84, 1.0, col) * (0.5 + 0.5 * sin((vW.y + time * 12.0 * (0.6 + col)) * 2.4));
        a *= 1.0 + streak * 3.0;
        gl_FragColor = vec4(1.0, 0.93, 0.78, a);
      }`,
  });
  const m = new THREE.InstancedMesh(g, mat, max); m.frustumCulled = false; m.renderOrder = 5; m.count = 0; return m;
}
const _bm = new THREE.Matrix4(), _bq = new THREE.Quaternion(), _bp = new THREE.Vector3(), _bs = new THREE.Vector3(1, 1, 1), _be = new THREE.Euler();

let weaponsRef = null;
export class Traffic {
  constructor() { this.cars = []; }
  init(n = 34) { for (let i = 0; i < n; i++) this.cars.push(new Car(i)); this.beams = makeBeams(n); G.scene.add(this.beams); }
  updateBeams(pl) {
    let k = 0; this.beams.material.uniforms.time.value = G.time;
    for (const c of this.cars) {
      if (c.dead || c.speed < 0.5) continue;
      if (Math.hypot(c.pos.x - pl.pos.x, c.pos.z - pl.pos.z) > 130) continue;
      const L = c.model.userData.len;
      _bp.set(c.pos.x + Math.sin(c.yaw) * (L / 2 + 0.1), 0.78, c.pos.z + Math.cos(c.yaw) * (L / 2 + 0.1));
      _bq.setFromEuler(_be.set(0.05, c.yaw, 0, 'YXZ')); _bm.compose(_bp, _bq, _bs); this.beams.setMatrixAt(k++, _bm);
    }
    this.beams.count = k; this.beams.instanceMatrix.needsUpdate = true;
  }
  hitTest(a, b) {
    let best = null;
    for (const c of this.cars) {
      const t = segSphere(a.x, a.y, a.z, b.x, b.y, b.z, c.pos.x, 1.0, c.pos.z, c.r);
      if (t !== null && (!best || t < best.t)) best = { t, car: c };
    }
    return best;
  }
  blast(pos, radius, dmg) { for (const c of this.cars) { const d = Math.hypot(c.pos.x - pos.x, c.pos.z - pos.z); if (d < radius) c.hit(dmg * (1 - d / radius) * 2); } }
  nearestAhead(pos, fwd, range) {
    let best = null;
    for (const c of this.cars) {
      const dx = c.pos.x - pos.x, dz = c.pos.z - pos.z; const f = dx * fwd.x + dz * fwd.z; if (f < 0 || f > range) continue;
      const l = Math.abs(-dx * fwd.z + dz * fwd.x); if (l < c.r + 1.5 && (best === null || f < best)) best = f;
    }
    return best;
  }
  update(dt) {
    const pl = G.player;
    for (const c of this.cars) c.update(dt);
    this.updateBeams(pl);
    // collisions with the active bike / pursuit bikes / player on foot
    const bikes = [];
    if (G.mode === 'bike' && G.bikeObj) bikes.push(G.bikeObj);
    if (G.perpBikes) for (const b of G.perpBikes) bikes.push(b);
    for (const b of bikes) for (const c of this.cars) {
      const dx = b.pos.x - c.pos.x, dz = b.pos.z - c.pos.z; const rr = c.r + b.radius; const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-4) {
        const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
        b.pos.x += nx * (rr - d); b.pos.z += nz * (rr - d);
        const rel = (b.vx - c.vx) * -nx + (b.vz - c.vz) * -nz;
        if (rel > 1) {
          b.vx += nx * rel * 1.2; b.vz += nz * rel * 1.2; c.vx -= nx * rel * 0.5; c.vz -= nz * rel * 0.5;
          if (rel > 6) { const p = b.pos.clone().setY(1); fx.spark(p, 16, 0xffc060, 10, 0.6); fx.shake(Math.min(1, rel / 25)); audio.crash(p, Math.min(1.4, rel / 18)); c.hit(rel * 3.2); if (b.perp) b.hurt(rel * 1.4, { type: 'crash' }); else { b.hp -= rel * 0.6; pl.damage(rel * 0.25, null, 'crash'); } G.civs?.panic(p, 20); }
        }
      }
    }
    if (G.mode === 'foot') for (const c of this.cars) {
      const dx = pl.pos.x - c.pos.x, dz = pl.pos.z - c.pos.z; const d = Math.hypot(dx, dz);
      if (d < c.r + 0.5 && d > 0.01) { pl.pos.x += dx / d * (c.r + 0.5 - d); pl.pos.z += dz / d * (c.r + 0.5 - d); const sp = Math.hypot(c.vx, c.vz); if (sp > 6 && !pl.rolling) pl.damage(sp * 0.8, new THREE.Vector3(dx / d, 0, dz / d), 'crash'); }
    }
  }
}
export function setWeapons(w) { weaponsRef = w; }
