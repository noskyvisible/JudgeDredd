// ---------------------------------------------------------------------------
// Procedural locomotion.
//
// Each foot is a little state machine: PLANTED feet are locked to the ground (their position is
// integrated against the root's own motion, so they stay put in world space whatever the root
// does — walking, strafing, turning, being shoved), SWINGING feet travel along an arc to a landing
// target that keeps being re-predicted from the current velocity.  While the character locomotes,
// lift-off / touch-down are clocked by a gait phase (duty factor ~0.62 walking -> ~0.35 running,
// cadence from Froude-scaled human data, so stride length is simply speed / cadence and nothing
// slides).  When standing, feet only step when they end up too far from their stance spot
// (turning on the spot, after a lunge, after a shove: that gives shuffles and stumbles for free).
// Stance feet roll heel-strike -> flat -> heel-off -> toe-off about the real heel / ball points.
//
// The pelvis rides on top (bob, sway, list, yaw, forward tilt, lean into turns and acceleration),
// clamped so the stance legs can always reach their planted feet; the upper body counter-rotates,
// swings the arms with speed-dependent elbow flex and stabilises the head.
//
// Units: rig units (the rig is scaled by style.scale = S at the root) and the root frame
// (+Z forward, +X = character left).  Speeds come in as m/s.
// ---------------------------------------------------------------------------
import { DEG, TAU, sstep, wrapPi, wobble, m3EulerXYZ } from './animcore.js';
const _M = new Float64Array(9);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const frac = (x) => x - Math.floor(x);
const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// dimensionless stride frequency vs dimensionless speed (v / sqrt(g·leg)); fitted to human walking /
// running data and nudged up at speed because these rigs have short legs for their height
const FH_V = [0, 0.3, 0.5, 0.7, 1.0, 1.5, 2.2, 3.2, 4.5];
const FH_F = [0.215, 0.24, 0.29, 0.335, 0.4, 0.455, 0.53, 0.6, 0.64];
function interp(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x < xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[ys.length - 1];
}

// Gait personalities.  cad: cadence multiplier (lower = longer, heavier strides), width: stance width,
// bob/sway: pelvis motion, arm: arm swing, heavy: footfall weight (dip + secondary bounce), hunch: forward
// spine bias, swagger: shoulder roll, twitch: erratic noise (junkies), toe: toe-out angle (rad).
export const PERSONA = {
  default: { cad: 1, width: 1, lift: 1, bob: 1, sway: 1, arm: 1, heavy: 0.2, hunch: 0.02, swagger: 0, twitch: 0, toe: 0.12, armOut: 0, shift: 7 },
  dredd: { cad: 0.92, width: 1.12, lift: 1.05, bob: 1.1, sway: 0.75, arm: 0.6, heavy: 1, hunch: 0.05, swagger: 0.15, twitch: 0, toe: 0.17, armOut: 0.05, shift: 9 },
  thug: { cad: 0.98, width: 1.08, lift: 1, bob: 1.05, sway: 1.15, arm: 1.15, heavy: 0.35, hunch: 0.07, swagger: 1, twitch: 0, toe: 0.16, armOut: 0.04, shift: 6 },
  gunman: { cad: 1.02, width: 1, lift: 0.95, bob: 0.9, sway: 0.9, arm: 0.85, heavy: 0.2, hunch: 0.06, swagger: 0.2, twitch: 0, toe: 0.12, armOut: 0.02, shift: 7 },
  brute: { cad: 0.88, width: 1.3, lift: 0.9, bob: 1.15, sway: 1.25, arm: 0.95, heavy: 1, hunch: 0.09, swagger: 0.6, twitch: 0, toe: 0.2, armOut: 0.16, shift: 9 },
  boss: { cad: 0.86, width: 1.3, lift: 0.9, bob: 1.1, sway: 1.15, arm: 0.85, heavy: 1, hunch: 0.06, swagger: 0.5, twitch: 0, toe: 0.2, armOut: 0.18, shift: 10 },
  junkie: { cad: 1.12, width: 0.9, lift: 1.1, bob: 1.2, sway: 1.3, arm: 1.3, heavy: 0, hunch: 0.16, swagger: 0, twitch: 1, toe: 0.08, armOut: 0.02, shift: 4 },
  biker: { cad: 0.98, width: 1.08, lift: 1, bob: 1, sway: 1.05, arm: 1.05, heavy: 0.3, hunch: 0.05, swagger: 0.7, twitch: 0, toe: 0.15, armOut: 0.04, shift: 7 },
  civ: { cad: 1.02, width: 0.95, lift: 0.95, bob: 0.9, sway: 1, arm: 0.95, heavy: 0.1, hunch: 0.02, swagger: 0, twitch: 0, toe: 0.1, armOut: 0, shift: 7 },
};

// Standing stances: neutral foot spots (rig units, root frame) the idle stepper steers the feet to.
// w: half stance width, zl/zr: fore-aft of left/right foot, yl/yr: extra foot yaw, drop: pelvis drop, turn: pelvis yaw.
export const STANCE = {
  relaxed: { w: 0.15, zl: 0.03, zr: -0.03, yl: 0, yr: 0, drop: 0.012, turn: 0 },
  dredd: { w: 0.185, zl: 0.07, zr: -0.05, yl: -0.04, yr: -0.12, drop: 0.025, turn: -0.06 },
  ready: { w: 0.2, zl: 0.15, zr: -0.13, yl: -0.12, yr: -0.42, drop: 0.075, turn: -0.3 },
  aim: { w: 0.19, zl: 0.12, zr: -0.1, yl: -0.1, yr: -0.38, drop: 0.035, turn: -0.22 },
  wide: { w: 0.22, zl: 0.05, zr: -0.04, yl: 0, yr: -0.06, drop: 0.03, turn: 0 },
  cower: { w: 0.13, zl: 0, zr: 0, yl: 0.1, yr: -0.1, drop: 0.02, turn: 0 },
};

class Foot {
  constructor(side) {
    this.side = side;                 // +1 left, -1 right
    this.x = side * 0.15; this.z = 0; this.yaw = 0;   // flat-foot ankle spot + yaw (root frame)
    this.pitch = 0;                   // + toes down / heel up
    this.ax = this.x; this.ay = 0; this.az = 0;       // final ankle target (ay = lift above flat ankle height)
    this.planted = true; this.plantT = 1;
    this.timed = false; this.s = 0; this.rate = 3; this.phLift = 0; this.phl = 0;
    this.x0 = 0; this.y0 = 0; this.z0 = 0; this.yaw0 = 0; this.p0 = 0;
    this.tx = 0; this.tz = 0; this.tyaw = 0; this.h = 0.1; this.landP = 0;
    this.err = 0; this.cool = 0; this.over = false;
  }
}

export class Gait {
  constructor(geo, persona) {
    this.g = geo; this.P = persona;
    this.phase = 0; this.f = 1; this.T = 1; this.D = 0.62; this.runW = 0; this.sprintW = 0;
    this.spd = 0; this.mw = 0; this.cyc = false; this.init = false;
    this.vx = 0; this.vz = 0; this.ax = 0; this.az = 0; this.w = 0; this.wAcc = 0;
    this.gyaw = 0; this.lean = 0; this.accP = 0; this.accR = 0;
    this.feet = [new Foot(1), new Foot(-1)];
    this.t = Math.random() * 100; this.seed = Math.random() * 10;
    this.strike = 0;                  // heel-strike strength this frame (for secondary motion + step events)
    this.stance = STANCE.relaxed; this.stanceK = 0;
    this.hy = 1; this.reachK = 0;
  }

  reset(stance) {
    this.stance = stance || this.stance; this.gyaw = 0;
    for (const f of this.feet) {
      const n = this.neutral(f, 0, 0);
      f.x = n.x; f.z = n.z; f.yaw = n.yaw; f.pitch = 0; f.planted = true; f.plantT = 1; f.timed = false; f.s = 0;
      this.ankle(f);
    }
    this.phase = 0; this.vx = this.vz = this.ax = this.az = this.w = this.wAcc = 0; this.spd = 0; this.mw = 0; this.cyc = false; this.gyaw = 0;
    this.init = true;
  }

  // stride period (s) the gait uses at speed v (m/s) for a rig of scale S
  periodFor(v, S) {
    const L = this.g.legLen * S, vh = Math.max(0, v) / Math.sqrt(9.81 * L);
    return 1 / (interp(FH_V, FH_F, vh) * Math.sqrt(9.81 / L) * this.P.cad);
  }

  // neutral spot of a foot.  Moving: around the hip, rotated with the movement yaw; standing: the stance spot.
  neutral(f, mw, runW) {
    const st = this.stance, P = this.P, s = f.side;
    const wStand = st.w * P.width, wMove = lerp(0.135, 0.085, runW) * P.width;
    const w = lerp(wStand, wMove, mw);
    const z = lerp(s > 0 ? st.zl : st.zr, -0.11 * runW, mw);
    const yaw = lerp((s > 0 ? st.yl : st.yr) + s * P.toe, s * P.toe * (1 - runW * 0.5), mw) + this.gyaw;
    const cg = Math.cos(this.gyaw * mw), sg = Math.sin(this.gyaw * mw);
    _n.x = s * w * cg + z * sg; _n.z = -s * w * sg + z * cg; _n.yaw = yaw;
    return _n;
  }

  // ankle target from the flat-foot spot + pitch, pivoting about the heel (pitch < 0) or the ball (pitch > 0)
  ankle(f) {
    const g = this.g, h = g.footH, p = f.pitch;
    let ry, rz;
    if (p < 0) { const c = Math.cos(p), s = Math.sin(p), lh = g.heel; ry = -h + (h * c - lh * s); rz = -lh + (h * s + lh * c); }
    else { const c = Math.cos(p), s = Math.sin(p), lb = g.ball; ry = -h + (h * c + lb * s); rz = lb + (h * s - lb * c); }
    f.ax = f.x + rz * Math.sin(f.yaw); f.az = f.z + rz * Math.cos(f.yaw); f.ay = ry;
  }
  landAnkle(f, out) {   // ankle position at touch-down on the current target
    const g = this.g, h = g.footH, p = f.landP, c = Math.cos(p), s = Math.sin(p);
    let ry, rz;
    if (p < 0) { const lh = g.heel; ry = -h + (h * c - lh * s); rz = -lh + (h * s + lh * c); }
    else { const lb = g.ball; ry = -h + (h * c + lb * s); rz = lb + (h * s - lb * c); }
    out.x = f.tx + rz * Math.sin(f.tyaw); out.y = ry; out.z = f.tz + rz * Math.cos(f.tyaw);
  }

  lift(f, timed, rate) {
    f.planted = false; f.timed = timed; f.s = 0; f.rate = rate || 3;
    f.x0 = f.ax; f.y0 = f.ay; f.z0 = f.az; f.yaw0 = f.yaw; f.p0 = f.pitch;
  }
  land(f) {
    f.planted = true; f.plantT = 0; f.timed = false; f.s = 0;
    f.x = f.tx; f.z = f.tz; f.yaw = f.tyaw; f.pitch = f.landP; f.cool = 0.12;
  }

  // ------------------------------------------------------------------ per frame
  // inp: { vx, vz: planting velocity (m/s, root frame), w: yaw rate (rad/s), intended: ch.speed, tele, S }
  update(dt, inp, B, opts) {
    const g = this.g, P = this.P, S = inp.S, feet = this.feet;
    this.t += dt; this.strike = 0;
    if (inp.tele || !this.init) this.reset(opts.stance);
    // stance changes glide in through the idle stepper
    this.stance = opts.stance || STANCE.relaxed;

    // ---- motion estimates (root frame)
    const ovx = this.vx, ovz = this.vz, ow = this.w;
    const kv = 1 - Math.exp(-14 * dt), ka = 1 - Math.exp(-6 * dt);
    this.vx += (inp.vx - this.vx) * kv; this.vz += (inp.vz - this.vz) * kv;
    this.ax += (clamp((this.vx - ovx) / dt, -25, 25) - this.ax) * ka;
    this.az += (clamp((this.vz - ovz) / dt, -25, 25) - this.az) * ka;
    this.w += (clamp(inp.w, -12, 12) - this.w) * (1 - Math.exp(-12 * dt));
    this.wAcc += (clamp((this.w - ow) / dt, -60, 60) - this.wAcc) * ka;
    const gs = Math.hypot(this.vx, this.vz);
    const cyc = inp.intended > 0.25 && gs > 0.2 && !opts.noCycle;
    this.spd += ((cyc ? gs : 0) - this.spd) * (1 - Math.exp(-9 * dt));
    this.mw += ((cyc ? clamp(gs / 0.9, 0, 1) : 0) - this.mw) * (1 - Math.exp(-(cyc ? 7 : 5) * dt));
    const mw = this.mw;

    // ---- gait parameters (Froude scaled)
    const L = g.legLen * S, vh = this.spd / Math.sqrt(9.81 * L);
    const runW = this.runW = sstep(0.72, 1.45, vh), sprintW = this.sprintW = sstep(2.5, 3.6, vh);
    let f = interp(FH_V, FH_F, vh) * Math.sqrt(9.81 / L) * P.cad;

    // movement-facing yaw: pelvis + feet turn into strafes / backpedals (more at speed), the chest keeps facing forward
    const mdir = gs > 0.3 ? Math.atan2(this.vx, this.vz) : 0;
    let wantYaw = 0;
    if (cyc && gs > 0.5) {
      const kq = clamp((gs - 1.0) / 2.5, 0, 1);
      wantYaw = Math.abs(mdir) <= 1.75 ? clamp(mdir * lerp(0.45, 0.8, kq), -1.15, 1.15) : clamp(wrapPi(mdir - Math.PI) * 0.5, -0.6, 0.6);
    }
    this.gyaw += (wantYaw - this.gyaw) * (1 - Math.exp(-6 * dt));

    // duty factor: ~0.6 walking, ~0.38 jogging, ~0.3 running, ~0.24 sprinting -- and never a longer stance sweep than the
    // legs can cover (short legs take quicker contacts, as real runners do).  Sideways / backwards the comfortable sweep is
    // much shorter, so there the cadence goes up first.
    let D = lerp(0.6, 0.38, runW) - 0.08 * sstep(1.45, 2.2, vh) - 0.06 * sprintW;
    const vr = this.spd / S, rel = wrapPi(mdir - this.gyaw), sideK = Math.abs(Math.sin(rel));
    const sweep = lerp(1.15, 1.0, runW) * g.legLen / 0.935 * lerp(Math.cos(rel) < 0 ? 0.75 : 1, 0.45, sideK);
    if (vr * D / f > sweep) f = Math.min(f * 1.7, vr * D / sweep);
    if (vr * D / f > sweep) D = Math.max(0.17, sweep * f / vr);
    this.f = f; this.T = 1 / f; this.D = D;
    const T = this.T;

    // ---- start / stop of the cyclic gait
    if (cyc && !this.cyc) {
      // lead with the foot that trails along the movement direction
      const dx = this.vx / (gs || 1), dz = this.vz / (gs || 1);
      const dl = feet[0].x * dx + feet[0].z * dz, dr = feet[1].x * dx + feet[1].z * dz;
      const lead = !feet[0].planted ? 0 : !feet[1].planted ? 1 : dl < dr ? 0 : 1;
      this.phase = frac(D - (lead === 0 ? 0 : 0.5) + 0.001);
      for (const f of feet) f.phl = frac(this.phase + (f.side > 0 ? 0 : 0.5));
    }
    if (!cyc && this.cyc) {
      // finishing swings become timed steps that settle on the stance spots
      for (const f of feet) if (!f.planted && !f.timed) { const rem = Math.max(0.09, (1 - f.s) * (1 - f.phLift) * T); f.timed = true; f.rate = (1 - f.s) / rem; }
    }
    this.cyc = cyc;
    if (cyc) this.phase = frac(this.phase + this.f * dt);

    // ---- feet
    const vxr = this.vx / S, vzr = this.vz / S;                  // rig units / s
    const pvx = inp.vx / S, pvz = inp.vz / S;                    // planting velocity (unsmoothed)
    const rot = -clamp(inp.w, -12, 12) * dt, cr = Math.cos(rot), sr = Math.sin(rot);
    const fwd = gs > 0.3 ? clamp(this.vz / gs, 0, 1) : 0, bk = gs > 0.3 ? clamp(-this.vz / gs, 0, 1) : 0;
    // forwards: heel strike -> flat -> heel off -> toe off;  backwards: toe strike -> flat -> roll back onto the heel
    const ths = lerp(13, 5, runW) * DEG * fwd - 12 * DEG * bk, tto = lerp(24, 36, runW) * DEG * (0.35 + 0.65 * fwd) * (1 - bk) - 9 * DEG * bk;
    const r1 = lerp(0.14, 0.08, runW), r2 = lerp(0.55, 0.42, runW);
    const halfStance = D * T * 0.5;
    for (let i = 0; i < 2; i++) {
      const f = feet[i], o = feet[1 - i];
      const phl = frac(this.phase + (f.side > 0 ? 0 : 0.5));
      const wrapped = cyc && phl < f.phl - 0.5; f.phl = phl;
      f.cool -= dt;
      if (f.planted) {
        f.plantT += dt;
        // world lock: p' = R(-w dt)(p - v dt)
        const px = f.x - pvx * dt, pz = f.z - pvz * dt;
        f.x = px * cr + pz * sr; f.z = -px * sr + pz * cr; f.yaw += rot;
        // don't let a planted foot twist beyond what an ankle/hip allows: pivot it on the ball instead
        const ny = this.neutral(f, mw, runW).yaw, dy = wrapPi(f.yaw - ny);
        if (dy > 0.9) f.yaw = ny + 0.9; else if (dy < -0.9) f.yaw = ny - 0.9;
        if (cyc) {
          const st = phl < D ? phl / D : 1;
          let p;
          if (st < r1) p = -ths * (1 - smooth01(st / r1));
          else if (st < r2) p = 0;
          else p = tto * smooth01((st - r2) / (1 - r2));
          f.pitch += (p - f.pitch) * (1 - Math.exp(-40 * dt));
          if (phl >= D && phl < 0.985 && f.plantT > 0.06 && (o.planted || runW > 0.3 || (o.s > 0.75))) { this.lift(f, false); f.phLift = phl; }
          else if (f.over && f.plantT > 0.08 && (o.planted || runW > 0.3)) {
            // left out of reach (sudden acceleration, a shove, a fast strafe): lift it now; when walking, re-phase the gait around it
            if (o.planted) { this.phase = frac(D - (f.side > 0 ? 0 : 0.5) + 0.001); for (const q of feet) q.phl = frac(this.phase + (q.side > 0 ? 0 : 0.5)); }
            this.lift(f, false); f.phLift = Math.min(0.97, f.phl);
          }
        } else {
          f.pitch += (0 - f.pitch) * (1 - Math.exp(-10 * dt));
        }
      } else {
        // swing
        if (f.timed) { f.s = Math.min(1, f.s + f.rate * dt); }
        else if (wrapped) f.s = 1;
        else f.s = clamp((phl - f.phLift) / Math.max(0.02, 1 - f.phLift), 0, 1);
      }
      this.ankle(f);   // (overwritten below for swinging feet)
    }

    // landing targets + swing curves
    for (let i = 0; i < 2; i++) {
      const f = feet[i];
      if (f.planted) continue;
      const n = this.neutral(f, f.timed && !cyc ? 0 : mw, runW);
      let tx, tz, tyaw = n.yaw;
      if (f.timed && !cyc) {
        // settle / stumble step: aim a bit ahead of any slide so the foot catches the body
        const lead = Math.min(0.25, (1 - f.s) / Math.max(0.5, f.rate) + 0.08);
        tx = n.x + pvx * lead; tz = n.z + pvz * lead;
        f.landP = 0;
      } else {
        const rem = (1 - f.s) * (1 - f.phLift) * T;
        const ahead = halfStance;
        tx = n.x + vxr * ahead; tz = n.z + vzr * ahead;
        // anticipate the turn: by mid-stance the root will have rotated under the foot
        const ta = clamp(this.w * (rem + ahead) * 0.8, -0.6, 0.6), ct = Math.cos(ta), st = Math.sin(ta);
        const rx = tx * ct + tz * st, rz = -tx * st + tz * ct; tx = rx; tz = rz; tyaw += ta;
        f.landP = -ths;
      }
      // keep the target inside what the leg can reach from its hip
      const hx = f.side * g.hipX, dxh = tx - hx, maxR = 0.62 + 0.1 * runW, dd = Math.hypot(dxh, tz);
      if (dd > maxR) { tx = hx + dxh * maxR / dd; tz = tz * maxR / dd; }
      // don't cross the legs too far over the midline
      if (f.side > 0 ? tx < 0.04 : tx > -0.04) tx = f.side * 0.04;
      if (f.s < 0.02) { f.tx = tx; f.tz = tz; f.tyaw = tyaw; }
      else { const kt = 1 - Math.exp(-18 * dt); f.tx += (tx - f.tx) * kt; f.tz += (tz - f.tz) * kt; f.tyaw += wrapPi(tyaw - f.tyaw) * kt; }
      // curve
      const s = f.s;
      const dly = f.timed ? 0.05 : 0.14 * runW;
      const sh = smooth01((s - dly) / (1 - dly));
      this.landAnkle(f, _l);
      const H = f.timed ? f.h : (lerp(0.075, 0.3, runW) + 0.07 * sprintW) * P.lift * clamp(0.45 + this.spd / 2.2, 0, 1);
      const pk = f.timed ? 0.45 : lerp(0.4, 0.33, runW);
      const bump = Math.sin(Math.PI * Math.pow(s, Math.log(0.5) / Math.log(pk)));
      f.ax = f.x0 + (_l.x - f.x0) * sh; f.az = f.z0 + (_l.z - f.z0) * sh;
      f.ay = f.y0 + (_l.y - f.y0) * s + H * bump;
      f.yaw = f.yaw0 + wrapPi(f.tyaw - f.yaw0) * sh;
      const dangle = f.timed ? 0 : lerp(8, 22, runW) * DEG * Math.sin(Math.PI * smooth01(s * 1.3));
      f.pitch = f.p0 + (f.landP - f.p0) * sstep(0.15, 0.85, s) + dangle;
      if (s >= 1) {
        this.land(f); this.ankle(f);
        if (!f.timed) this.strike = Math.max(this.strike, clamp(this.spd / 6, 0.15, 1));
      }
    }

    // ---- standing: step feet back under the body when they drift off their stance spots
    if (!cyc) {
      let worst = -1, we = 0;
      for (let i = 0; i < 2; i++) {
        const f = feet[i]; if (!f.planted) { f.err = 0; continue; }
        const n = this.neutral(f, 0, 0);
        f.err = Math.hypot(f.x - n.x, f.z - n.z) + Math.abs(wrapPi(f.yaw - n.yaw)) * 0.22;
        const o = feet[1 - i];
        if (f.err > 0.075 && f.cool <= 0 && o.planted && o.plantT > 0.08 && f.err > we) { we = f.err; worst = i; }
      }
      if (worst >= 0 && !opts.freezeFeet) {
        const f = feet[worst], push = Math.hypot(inp.vx, inp.vz);
        const dur = clamp(0.25 + we * 0.25 - push * 0.03, 0.15, 0.36) * Math.sqrt(clamp(S, 0.6, 1.5) / 0.9);
        f.h = clamp(0.035 + we * 0.22, 0.035, 0.13);
        this.lift(f, true, 1 / dur);
      }
    }

    // ---- pelvis
    const st = this.stance, ph = this.phase, iw = 1 - mw;
    const sp01 = clamp(this.spd / 1.2, 0, 1);
    this.stanceK += ((opts.ready ? 1 : 0) - this.stanceK) * (1 - Math.exp(-4 * dt));
    let hy = 1.0 - lerp(st.drop, lerp(0.018, 0.034, runW) * (1 + 0.3 * P.heavy) + 0.012 * sprintW, mw);
    const c2 = Math.cos(TAU * 2 * (ph - D * 0.5));
    // walking vaults over the stance leg (high at mid-stance); running dips through the stance and flies ballistically between
    const u = frac(ph * 2), s2 = Math.min(0.95, 2 * D);
    const runBob = u < s2 ? -0.036 * Math.sin(Math.PI * u / s2) : 0.022 * Math.sin(Math.PI * (u - s2) / (1 - s2));
    hy += lerp(0.024 * c2, runBob, runW) * P.bob * mw * sp01;
    // heavy characters sink into each footfall
    if (P.heavy > 0) { const dip = u < 0.18 ? Math.sin(Math.PI * u / 0.18) : 0; hy -= dip * 0.018 * P.heavy * mw * (1 - runW); }
    const ws = wobble(this.t * 6.28 / P.shift, this.seed);           // slow idle weight shift (-1..1)
    const breath = Math.sin(this.t * 1.55 + this.seed);
    hy += iw * (0.0035 * breath - 0.01 * Math.abs(ws) * (1 - this.stanceK));
    let px = lerp(0.032, 0.009, runW) * P.sway * mw * Math.cos(TAU * (ph - D * 0.5)) + iw * ws * 0.032 * P.sway * (1 - 0.6 * this.stanceK);
    let pz = 0;
    let yaw = -lerp(5, 9, runW) * DEG * Math.cos(TAU * ph) * mw * sp01 + this.gyaw * 0.85 * mw + st.turn * iw;
    let roll = lerp(4.5, 2.5, runW) * DEG * Math.cos(TAU * (ph - D * 0.5)) * mw * sp01 + iw * ws * 3.5 * DEG * (1 - 0.6 * this.stanceK);
    // lean into turns (centripetal) and acceleration
    const lean = clamp(Math.atan2(this.spd * this.w, 9.81) * 0.85, -0.35, 0.35);
    this.lean += (lean - this.lean) * (1 - Math.exp(-8 * dt));
    this.accP += (clamp(this.az / 9.81, -0.45, 0.5) * mw - this.accP) * (1 - Math.exp(-7 * dt));
    this.accR += (clamp(this.ax / 9.81, -0.45, 0.45) * mw - this.accR) * (1 - Math.exp(-7 * dt));
    roll += -this.lean * 0.55 - this.accR * 0.25;
    let pitch = (lerp(2, 7, runW) * DEG + 4 * DEG * sprintW) * mw + this.accP * 0.22 + iw * 0.01;
    // reach clamp: the pelvis may not rise higher than the planted legs can reach
    const R = (g.thigh + g.shin) * 0.985;
    m3EulerXYZ(_M, pitch, yaw, roll);
    let hmax = 9;
    const want = hy;
    for (const f of feet) {
      f.over = false;
      if (!f.planted && f.s < 0.92) continue;
      const ox = f.side * g.hipX, oy = g.hipY;
      const hjx = px + _M[0] * ox + _M[1] * oy, hjyOff = _M[3] * ox + _M[4] * oy, hjz = pz + _M[6] * ox + _M[7] * oy;
      const dx = f.ax - hjx, dz = f.az - hjz, dxz2 = dx * dx + dz * dz;
      const ay = g.footH + f.ay;
      const m = dxz2 < R * R ? ay + Math.sqrt(R * R - dxz2) - hjyOff : ay - hjyOff;
      if (m < hmax) hmax = m;
      if (f.planted && m < want - 0.1) f.over = true;
    }
    const kk = 0.03;
    if (hy > hmax - kk) hy = hmax - kk * Math.exp(-(hy - (hmax - kk)) / kk);
    if (hy < want - 0.14) hy = want - 0.14;   // never squat into a split to keep a far foot planted (it steps instead)
    this.hy = hy;
    B.pos[0] = px; B.pos[1] = hy - 1.0; B.pos[2] = pz;
    B.hips[0] = pitch; B.hips[1] = yaw; B.hips[2] = roll;

    // ---- feet out
    B.fL[0] = feet[0].ax; B.fL[1] = feet[0].ay; B.fL[2] = feet[0].az;
    B.fR[0] = feet[1].ax; B.fR[1] = feet[1].ay; B.fR[2] = feet[1].az;
    B.ftL[0] = feet[0].pitch; B.ftL[1] = feet[0].yaw; B.ftL[2] = 0;
    B.ftR[0] = feet[1].pitch; B.ftR[1] = feet[1].yaw; B.ftR[2] = 0;

    // ---- upper body
    const swing = Math.cos(TAU * (ph - 0.05));                    // +1: left leg forward (left arm back)
    const amp = mw * clamp(this.spd / 1.6, 0.25, 1);
    const tw = this.t;
    // spine: lean with speed / acceleration, counter-rotate the shoulders against the pelvis, undo the strafe yaw
    const twitch = P.twitch ? (wobble(tw * 7, this.seed + 3) * 0.06 + wobble(tw * 13, this.seed + 5) * 0.03) : 0;
    B.torso[0] = (lerp(0.03, 0.16, runW) + 0.08 * sprintW) * mw + this.accP * 0.45 + P.hunch + iw * 0.012 * breath + twitch;
    B.torso[1] = -this.gyaw * 0.45 * mw - st.turn * iw * 0.45;
    B.torso[2] = -roll * 0.35 + this.lean * 0.15;
    const counter = lerp(6.5, 11, runW) * DEG * Math.cos(TAU * ph) * amp * (1 + P.swagger * 0.5);
    B.chest[0] = iw * 0.008 * breath;
    B.chest[1] = counter - this.gyaw * 0.4 * mw - st.turn * iw * 0.35 + P.swagger * 0.05 * swing * amp;
    B.chest[2] = -roll * 0.45 + P.swagger * 0.06 * swing * amp;
    // head: keep the gaze level and forward
    const yawNet = 0.6 * yaw + 0.5 * B.torso[1] + B.chest[1];
    B.head[1] = -yawNet * 0.9;
    B.head[0] = -(pitch + B.torso[0] + B.chest[0]) * 0.75 + 0.02 * runW * c2 * mw;
    B.head[2] = -(roll + B.torso[2] + B.chest[2]) * 0.7;

    // arms
    const A = lerp(17, 44, runW) * DEG * P.arm * amp, bias = -lerp(3, 12, runW) * DEG * mw;
    const sL = swing, sR = -swing;
    const ab = (lerp(4, 9, runW) * mw + 5 * iw) * DEG + P.armOut;
    B.shL[0] = bias + A * sL; B.shR[0] = bias + A * sR;
    B.shL[2] = ab; B.shR[2] = -ab;
    B.shL[1] = -lerp(0, 14, runW) * DEG * mw; B.shR[1] = lerp(0, 14, runW) * DEG * mw;
    const eb = (lerp(14, 92, runW) + 8 * sprintW) * DEG * (0.4 + 0.6 * mw) + iw * 10 * DEG;
    B.elL[0] = -(eb + Math.max(0, -sL) * A * 0.55); B.elR[0] = -(eb + Math.max(0, -sR) * A * 0.55);
    B.wrL[0] = -0.12 - 0.1 * runW * mw; B.wrR[0] = -0.12 - 0.1 * runW * mw;
    // idle breathing lifts the shoulders a touch
    B.shL[2] += iw * 0.012 * breath; B.shR[2] -= iw * 0.012 * breath;
    return this;
  }
}
const _n = { x: 0, z: 0, yaw: 0 };
const _l = { x: 0, y: 0, z: 0 };
