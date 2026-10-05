import * as THREE from 'three';
import { G } from './state.js';
import { fx } from './fx.js';
import { audio } from './audio.js';
import { world } from './world.js';
import { rand, clamp, segSphere, chance } from './util.js';

export const AMMO = [
  { id: 'std', name: 'STANDARD EXECUTE', short: 'STD', color: 0xffe070, css: '#ffe070', speed: 150, dmg: 14, rate: 0.12, auto: true, count: Infinity, desc: 'Rapid fire' },
  { id: 'ap', name: 'ARMOUR PIERCING', short: 'AP', color: 0x40c8ff, css: '#40c8ff', speed: 260, dmg: 48, rate: 0.42, pierce: true, count: 24, desc: 'Pierces armour & cover' },
  { id: 'ric', name: 'RICOCHET', short: 'RIC', color: 0xc070ff, css: '#c070ff', speed: 120, dmg: 20, rate: 0.26, bounces: 4, count: 36, desc: 'Bounces off walls' },
  { id: 'hiex', name: 'HI-EX', short: 'HEX', color: 0xff5030, css: '#ff5a38', speed: 78, dmg: 70, rate: 0.75, explosive: true, radius: 8, count: 12, desc: 'Explosive blast' },
  { id: 'inc', name: 'INCENDIARY', short: 'INC', color: 0xff9020, css: '#ff9a2a', speed: 95, dmg: 16, rate: 0.5, fire: true, count: 16, desc: 'Burning fire patch' },
  { id: 'seek', name: 'HEAT-SEEKER', short: 'SEEK', color: 0x40ff90, css: '#40ff90', speed: 58, dmg: 50, rate: 0.8, homing: true, count: 10, desc: 'Homing missile' },
];

const projectiles = [];
const firePatches = [];
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
// Projectiles are velocity-aligned billboards: a soft halo and a thin white-hot core, both additive.  The quad spans local z in [-1, 0]
// (head at the origin, tail behind it); the mesh scale gives width (x) and length (z).  Seen side-on it is a streak; seen end-on (the usual
// over-the-shoulder view of a round flying away) the projected length collapses into a round glow instead of vanishing, and a minimum angular
// size keeps tracers visible at range.  No boxes, so nothing ever reads as a glass cube up close.
const boltGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, -0.5);
const boltMats = {};
const bolt = (color, boost, tight, minAng) => {
  const key = color + '_' + boost + '_' + tight + '_' + minAng;
  return boltMats[key] || (boltMats[key] = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { col: { value: new THREE.Color(color).multiplyScalar(boost) }, tight: { value: tight }, minAng: { value: minAng } },
    vertexShader: `varying vec2 vUv; varying float vEnd; uniform float minAng;
      void main(){
        vec3 ax = (modelMatrix * vec4(0.0, 0.0, -1.0, 0.0)).xyz; float len = length(ax); ax /= max(len, 1e-4);
        float wid = length((modelMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        vec3 origin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 toCam = cameraPosition - origin; float dist = length(toCam); vec3 v = toCam / max(dist, 1e-4);
        wid = max(wid, dist * minAng);                                       // never thinner than a few pixels, however far
        vec3 axp = ax - v * dot(ax, v); float pl = length(axp);               // the axis projected onto the screen plane (0 = end-on, 1 = side-on)
        vec3 side = pl > 1e-3 ? normalize(cross(ax, v)) : normalize(cross(v, vec3(0.0, 1.0, 0.0)));
        vec3 lenDir = pl > 1e-3 ? axp / pl : normalize(cross(side, v));
        float effLen = max(len * pl, wid * 1.15);                             // end-on: a round spot, not a sliver
        vec3 wp = origin + lenDir * (-position.z) * effLen + side * position.x * wid;
        vUv = vec2(position.x + 0.5, -position.z); vEnd = 1.0 - pl;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: `varying vec2 vUv; varying float vEnd; uniform vec3 col; uniform float tight;
      void main(){
        float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
        float prof = pow(max(across, 0.0), tight);
        // seen along its length the glow should be round: fade the length profile by distance from the centre of the quad instead
        float alongStreak = (1.0 - smoothstep(0.0, 1.0, vUv.y)) * smoothstep(0.0, 0.06, vUv.y + 0.02);
        float r = length(vec2(vUv.x * 2.0 - 1.0, vUv.y * 2.0 - 1.0)); float alongRound = pow(max(1.0 - r, 0.0), tight);
        float a = mix(prof * (0.25 + 0.75 * alongStreak), alongRound, smoothstep(0.35, 0.95, vEnd));
        gl_FragColor = vec4(col * a, a);
      }`,
  }));
};

export const weapons = {
  projectiles, firePatches,

  fire(owner, from, dir, ammo, opts = {}) {
    const a = typeof ammo === 'number' ? AMMO[ammo] : ammo;
    const spread = opts.spread ?? (a.id === 'std' ? 0.012 : 0.004);
    const d = tmpA.copy(dir).normalize();
    d.x += rand(-spread, spread); d.y += rand(-spread, spread); d.z += rand(-spread, spread); d.normalize();
    const wid = a.explosive || a.homing ? 0.34 : a.id === 'ap' ? 0.2 : 0.14;
    const len = a.explosive ? 1.4 : a.homing ? 1.8 : a.id === 'ap' ? 6 : 4.2;
    const mesh = new THREE.Group();
    const core = new THREE.Mesh(boltGeo, bolt(0xffffff, 3.2, 3.0, 0.0022)); core.scale.set(wid * 0.9, wid, len * 0.8); mesh.add(core);                   // white-hot centre
    const halo = new THREE.Mesh(boltGeo, bolt(a.color, 4.5, 1.7, 0.0075)); halo.scale.set(wid * 4.2, wid * 4.2, len * 1.3); mesh.add(halo);               // coloured glow
    mesh.traverse((o) => { if (o.isMesh) { o.renderOrder = 12; o.frustumCulled = false; } });
    G.scene.add(mesh);
    const p = {
      a, owner, mesh, pos: from.clone(), vel: d.clone().multiplyScalar(opts.speed ?? a.speed), life: a.homing ? 6 : 2.2, bounces: a.bounces || 0,
      dmg: opts.dmg ?? a.dmg, hitSet: new Set(), target: null, ownerIsPlayer: owner === 'player', trailT: 0,
    };
    if (a.homing) p.vel.multiplyScalar(0.5), p.accel = 1; // launch then accelerate
    projectiles.push(p);
    return p;
  },

  update(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.life -= dt;
      if (p.life <= 0) { this.kill(i, false); continue; }
      const speed0 = p.vel.length();
      const steps = Math.max(1, Math.ceil(speed0 * dt / 2.0));
      const sub = dt / steps;
      let dead = false;
      for (let s = 0; s < steps && !dead; s++) {
        const from = tmpB.copy(p.pos);
        if (p.a.homing) this.steer(p, sub);
        p.pos.addScaledVector(p.vel, sub);
        dead = this.step(p, from, p.pos, i);
        if (p.a.homing && p.life < 5.6 && p.vel.length() < p.a.speed * 1.6) p.vel.multiplyScalar(1 + 1.2 * sub);
      }
      if (dead) { this.kill(i, true); continue; }
      // visuals
      p.mesh.position.copy(p.pos);
      tmpC.copy(p.pos).add(p.vel); p.mesh.lookAt(tmpC);
      p.trailT -= dt;
      if (p.trailT <= 0) {
        p.trailT = p.a.homing ? 0.012 : 0.02;
        if (p.a.homing || p.a.explosive) { fx.smokePuff(p.pos, 1, 0.9, 0.9, 0.25, 0.3); fx.glowPuff(p.pos, p.a.color, 0.5, 0.15); }
        else if (p.a.fire) fx.fire(p.pos, 1, 0.4);
        else fx.glowPuff(p.pos, p.a.color, 0.2, 0.1);
      }
    }
    // fire patches
    for (let i = firePatches.length - 1; i >= 0; i--) {
      const f = firePatches[i]; if (!f) continue; f.t -= dt;
      if (f.t <= 0) { firePatches.splice(i, 1); continue; }
      for (let k = 0; k < 2; k++) fx.fire(tmpA.set(f.pos.x + rand(-1, 1) * f.r, 0.1, f.pos.z + rand(-1, 1) * f.r), 1, 1.2);
      f.tick -= dt;
      if (f.tick <= 0) {
        f.tick = 0.2;
        if (Math.random() < 0.3) fx.flash(f.pos.clone().setY(1.2), 0xff7a20, 1.4, 0.25, 14);
        for (const e of G.enemies.hostiles()) {
          if (!f.owner && false) break;
          if (Math.hypot(e.pos.x - f.pos.x, e.pos.z - f.pos.z) < f.r + 0.4) e.hurt(6, { type: 'fire', dir: tmpB.set(0, 0, 0) });
        }
        if (G.player && !f.safePlayer && Math.hypot(G.player.pos.x - f.pos.x, G.player.pos.z - f.pos.z) < f.r) G.player.damage(2.5, null, 'fire');
      }
    }
  },

  steer(p, dt) {
    if (!p.target || p.target.dead || p.target.state === 'surrender') {
      let best = null, bd = 1e9; // acquire target near the line of flight
      const fwd = tmpC.copy(p.vel).normalize();
      for (const e of G.enemies.hostiles()) {
        const to = tmpA.set(e.pos.x - p.pos.x, 1.5 - p.pos.y, e.pos.z - p.pos.z); const d = to.length();
        if (d > 70) continue;
        const dot = to.normalize().dot(fwd); if (dot < 0.3) continue;
        const sc = d * (2 - dot); if (sc < bd) { bd = sc; best = e; }
      }
      p.target = best;
    }
    if (p.target) {
      const to = tmpA.set(p.target.pos.x - p.pos.x, 1.5 - p.pos.y, p.target.pos.z - p.pos.z).normalize();
      const sp = p.vel.length();
      const v = tmpC.copy(p.vel).normalize().lerp(to, clamp(dt * 6.5, 0, 1)).normalize();
      p.vel.copy(v).multiplyScalar(sp);
    }
  },

  // returns true when projectile should be removed
  step(p, from, to) {
    // static world
    const wh = world.rayBoxes(from, to);
    let wt = wh ? wh.t : 2;
    // dynamic entities
    let best = null, bt = 2;
    if (p.ownerIsPlayer) {
      for (const e of G.enemies.targets()) {
        if (p.hitSet.has(e)) continue;
        const h = e.hitTest(from, to);
        if (h && h.t < bt) { bt = h.t; best = { e, h }; }
      }
      if (G.traffic) { const h = G.traffic.hitTest(from, to); if (h && h.t < bt) { bt = h.t; best = { car: h.car, h }; } }
    } else if (G.player && !G.player.dead) {
      const pl = G.player;
      const t = segSphere(from.x, from.y, from.z, to.x, to.y, to.z, pl.pos.x, pl.pos.y + 1.4, pl.pos.z, 0.7);
      if (t !== null) { bt = t; best = { player: pl, h: { t } }; }
    }
    if (best && bt <= wt) {
      const hp = tmpB.lerpVectors(from, to, bt).clone();
      return this.onEntityHit(p, best, hp);
    }
    if (wh) {
      const hp = tmpB.lerpVectors(from, to, wt).clone();
      return this.onWorldHit(p, wh, hp);
    }
    return false;
  },

  onEntityHit(p, best, hp) {
    const a = p.a;
    if (best.player) {
      best.player.damage(p.dmg, p.vel.clone().normalize(), 'bullet');
      fx.impact(hp, 6, 0xff8040, p.vel.clone().normalize().negate()); return true;
    }
    if (best.car) { best.car.hit(p.dmg); fx.impact(hp, 10, 0xffc060, p.vel.clone().normalize().negate()); audio.ping(hp); if (a.explosive) { this.explode(hp, a.radius, p.dmg, p.owner); } return !a.pierce; }
    const e = best.e;
    p.hitSet.add(e);
    if (a.explosive) { this.explode(hp, a.radius, p.dmg, p.owner); return true; }
    const dir = p.vel.clone().normalize();
    let dmg = p.dmg * (best.h.head ? 2.0 : 1);
    e.hurt(dmg, { type: 'bullet', dir, crit: best.h.head, ammo: a.id, point: hp });
    fx.impact(hp, best.h.head ? 14 : 8, best.h.head ? 0xffffff : a.color, dir.clone().negate());
    if (best.h.head) { fx.text(hp, 'HEADSHOT', 'crit'); fx.ring(hp, 0xffffff, 1.6, 0.25, G.camera.position.clone().sub(hp).normalize()); }
    audio.hit(hp);
    if (G.hud) G.hud.hitMarker(best.h.head);
    if (a.fire) { this.firePatch(hp, 3.2, 4.5); return true; }
    if (a.pierce) { p.dmg *= 0.8; return false; }
    return true;
  },

  onWorldHit(p, wh, hp) {
    const a = p.a;
    const n = new THREE.Vector3(wh.nx, wh.ny, wh.nz);
    // ground-floor shopfronts stand ~0.4 m proud of the wall collider, so lift effects out in front of them
    const fp = hp.clone().addScaledVector(n, Math.abs(n.y) < 0.1 && hp.y > 0.25 && hp.y < 3.6 ? 0.46 : 0.03);
    if (a.explosive) {
      this.explode(hp.clone().addScaledVector(n, 0.3), a.radius, p.dmg, p.owner);
      if (n.y < 0.5) fx.decal(fp, n, 1, a.radius * 0.5);          // blast scorch on the wall
      return true;
    }
    if (a.fire) { this.firePatch(hp.clone().addScaledVector(n, 0.2), 3.2, 4.5); fx.impact(fp, 10, 0xff9020, n); fx.decal(fp, n, 1, 2.0); return true; }
    if (a.pierce && wh.ny === 0) {
      // thin cover (low props / thin edges) can be pierced
      const nearby = world.nearbyBoxes(hp.x, hp.z, []);
      let thin = false; for (const b of nearby) if (hp.x >= b.minX - 0.1 && hp.x <= b.maxX + 0.1 && hp.z >= b.minZ - 0.1 && hp.z <= b.maxZ + 0.1 && b.h < 4) thin = true;
      if (thin) { fx.impact(fp, 6, a.color, n); fx.decal(fp, n, 0, 0.3); p.pos.addScaledVector(p.vel.clone().normalize(), 2.2); p.dmg *= 0.7; return false; }
    }
    if (p.bounces > 0) {
      p.bounces--;
      const v = p.vel; const dot = v.x * n.x + v.y * n.y + v.z * n.z;
      v.x -= 2 * dot * n.x; v.y -= 2 * dot * n.y; v.z -= 2 * dot * n.z;
      p.pos.copy(hp).addScaledVector(n, 0.05);
      p.hitSet.clear();
      fx.spark(fp, 16, a.color, 18, 0.45, tmpA.copy(v).normalize(), 0.45); fx.flash(fp, a.color, 2, 0.06, 10); audio.ping(hp);
      fx.decal(fp, n, 0, 0.2);
      return false;
    }
    fx.impact(fp, a.id === 'ap' ? 18 : 8, a.color, n);
    fx.decal(fp, n, 0, a.id === 'ap' ? 0.36 : 0.28);
    fx.smokePuff(fp, 1, 0.8, 0.6, 0.3, 0.3);
    if (hp.distanceTo(G.camera.position) < 40 && Math.random() < 0.5) audio.ping(hp);
    return true;
  },

  kill(i, hit) {
    const p = projectiles[i]; G.scene.remove(p.mesh); projectiles.splice(i, 1);
    if (!hit && p.a.explosive) this.explode(p.pos, p.a.radius, p.dmg, p.owner);
  },

  explode(pos, radius, dmg, owner) {
    const e = pos.clone();
    fx.explosion(e, Math.min(1.4, radius / 7));
    audio.explosion(radius / 7, e);
    for (const t of G.enemies.targets()) {
      const d = Math.hypot(t.pos.x - e.x, t.pos.z - e.z, (t.pos.y + 1 - e.y) * 0.5);
      if (d > radius) continue;
      const k = 1 - d / radius;
      const dir = new THREE.Vector3(t.pos.x - e.x, 0.4, t.pos.z - e.z).normalize();
      t.hurt(dmg * (0.3 + 0.7 * k), { type: 'explosive', dir, point: e, knock: 14 * k + 4 });
    }
    if (G.traffic) G.traffic.blast(e, radius, dmg);
    G.player?.blastCheck(e, radius, owner !== 'player' ? dmg : dmg * 0.25);
    G.civs?.panic(e, radius * 3);
    firePatches.push({ pos: new THREE.Vector3(e.x, 0, e.z), r: radius * 0.18, t: 2.2, tick: 0, safePlayer: true });
    G.onExplosion?.(e, radius);
  },

  firePatch(pos, r, dur) {
    firePatches.push({ pos: new THREE.Vector3(pos.x, 0, pos.z), r, t: dur, tick: 0 });
    fx.decal(tmpA.set(pos.x, 0.02, pos.z), tmpB.set(0, 1, 0), 1, r * 1.7);
    G.civs?.panic(pos, 14);
    fx.flash(new THREE.Vector3(pos.x, 1.5, pos.z), 0xff8a30, 3, 0.4, 20);
  },
};
