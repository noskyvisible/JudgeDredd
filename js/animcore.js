// ---------------------------------------------------------------------------
// Animation core: pose buffers, spline clip compiler/evaluator, small 3x3 rotation math,
// analytic two-bone IK and a bank of spring-dampers.  Everything here is allocation-free
// in the per-frame paths (the compile step runs once at module load).
//
// Rig conventions (see character.js): the character faces +Z, its left is +X, limbs hang
// along -Y, rotation.x < 0 swings a limb forward, knees flex with +x, elbows with -x.
// Shoulders and hip joints use Euler order YXZ, every other joint XYZ.
// ---------------------------------------------------------------------------

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Pose channels.  0..17 drive joints directly; fL/fR are IK ankle targets (rig space: x, lift, z),
// ftL/ftR the matching foot orientation (pitch, yaw, roll) — both only exist as IK inputs.
export const CHANNELS = ['root', 'pos', 'hips', 'torso', 'chest', 'head', 'shL', 'shR', 'elL', 'elR', 'wrL', 'wrR', 'hipL', 'hipR', 'knL', 'knR', 'anL', 'anR', 'fL', 'fR', 'ftL', 'ftR'];
export const NCH = CHANNELS.length;
export const NF = NCH * 3;
export const NJ = 18;
export const CI = {}; CHANNELS.forEach((c, i) => { CI[c] = i; });
export const isLinearCh = (ci) => ci === 1 || ci === 18 || ci === 19;   // pos, fL, fR are distances, not angles
const MIRROR = { shL: 'shR', shR: 'shL', elL: 'elR', elR: 'elL', wrL: 'wrR', wrR: 'wrL', hipL: 'hipR', hipR: 'hipL', knL: 'knR', knR: 'knL', anL: 'anR', anR: 'anL', fL: 'fR', fR: 'fL', ftL: 'ftR', ftR: 'ftL' };

export const wrapPi = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// A pose is one Float64Array with a named 3-float view per channel (pose.hips[0] = …),
// so legacy code that writes B.torso[0] etc. keeps working on top of a flat buffer.
export function makePose() {
  const buf = new Float64Array(NF);
  const p = { buf };
  for (let i = 0; i < NCH; i++) p[CHANNELS[i]] = buf.subarray(i * 3, i * 3 + 3);
  return p;
}

// ---------------------------------------------------------------------------
// Clips
//   def = { dur, hit, side, hold, frames: [[t, { channel: [x, y, z] … }, opt], …], …flags }
//   Rotations are authored in degrees, pos / fL / fR in rig units.  A channel named in any key is
//   owned by the clip for its whole length; keys that omit it get a value interpolated in time
//   from the keys that do name it.  Curves are Kochanek–Bartels (Catmull–Rom with per-key tension,
//   continuity and bias) on the true (non-uniform) key times; by default every component is
//   auto-clamped like an animator's "auto" tangent: a key that is a local extreme gets a flat
//   tangent (eases in and out), monotone runs keep their speed through the key with no overshoot.
//   opt: number = tension (1 = flat / ease, 0 = Catmull–Rom, <0 = snappier), or
//        { t, c, b, lin: segment after this key is linear, free: disable auto-clamping }.
// ---------------------------------------------------------------------------
export function mirrorDef(def) {
  const out = { ...def, frames: def.frames.map(([t, p, o]) => {
    const q = {};
    for (const k of Object.keys(p)) {
      const name = MIRROR[k] || k, v = p[k];
      const lin = k === 'pos' || k === 'fL' || k === 'fR';
      if (lin) q[name] = [-(v[0] || 0), v[1] || 0, v[2] || 0];
      else q[name] = [v[0] || 0, -(v[1] || 0), -(v[2] || 0)];
    }
    return o === undefined ? [t, q] : [t, q, o];
  }) };
  if (def.side) out.side = def.side;
  return out;
}

export function compileClip(name, def) {
  const fr = def.frames, n = fr.length;
  const times = new Float64Array(n);
  for (let i = 0; i < n; i++) times[i] = fr[i][0];
  const used = new Set();
  for (const f of fr) for (const k of Object.keys(f[1])) { if (CI[k] === undefined) throw new Error(`clip ${name}: unknown channel ${k}`); used.add(CI[k]); }
  const chans = Int32Array.from([...used].sort((a, b) => a - b));
  const nc = chans.length;
  const vals = new Float64Array(nc * n * 3), tin = new Float64Array(nc * n * 3), tout = new Float64Array(nc * n * 3);
  const T = new Float64Array(n), Cc = new Float64Array(n), Bb = new Float64Array(n), lin = new Uint8Array(n), free = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = fr[i][2];
    if (typeof o === 'number') T[i] = o;
    else if (o) { T[i] = o.t || 0; Cc[i] = o.c || 0; Bb[i] = o.b || 0; lin[i] = o.lin ? 1 : 0; free[i] = o.free ? 1 : 0; }
  }
  const has = new Uint8Array(n);
  for (let j = 0; j < nc; j++) {
    const ci = chans[j], cname = CHANNELS[ci], sc = isLinearCh(ci) ? 1 : DEG;
    has.fill(0);
    for (let i = 0; i < n; i++) {
      const v = fr[i][1][cname];
      if (v) { has[i] = 1; for (let c = 0; c < 3; c++) vals[(j * n + i) * 3 + c] = (v[c] || 0) * sc; }
    }
    // fill keys that do not name the channel
    for (let i = 0; i < n; i++) {
      if (has[i]) continue;
      let a = i - 1; while (a >= 0 && !has[a]) a--;
      let b = i + 1; while (b < n && !has[b]) b++;
      for (let c = 0; c < 3; c++) {
        let v;
        if (a < 0) v = vals[(j * n + b) * 3 + c];
        else if (b >= n) v = vals[(j * n + a) * 3 + c];
        else { const u = (times[i] - times[a]) / Math.max(1e-6, times[b] - times[a]); v = vals[(j * n + a) * 3 + c] * (1 - u) + vals[(j * n + b) * 3 + c] * u; }
        vals[(j * n + i) * 3 + c] = v;
      }
    }
    // tangents, as time derivatives (value per unit of normalised clip time)
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) {
      const idx = (j * n + i) * 3 + c;
      if (i === 0 || i === n - 1) { tin[idx] = 0; tout[idx] = 0; continue; }
      const p0 = vals[idx - 3], p1 = vals[idx], p2 = vals[idx + 3];
      const h0 = Math.max(1e-6, times[i] - times[i - 1]), h1 = Math.max(1e-6, times[i + 1] - times[i]);
      const s0 = (p1 - p0) / h0, s1 = (p2 - p1) / h1;
      const t = T[i], cc = Cc[i], b = Bb[i];
      // parabolic (Bessel) slope through the three keys, shaped by the KB factors
      const w0 = h1 / (h0 + h1), w1 = h0 / (h0 + h1);
      let dOut = (1 - t) * ((1 + cc) * (1 + b) * w0 * s0 + (1 - cc) * (1 - b) * w1 * s1);
      let dIn = (1 - t) * ((1 - cc) * (1 + b) * w0 * s0 + (1 + cc) * (1 - b) * w1 * s1);
      if (!free[i]) {
        if (s0 * s1 <= 0) { dOut = 0; dIn = 0; }   // local extreme: ease through it
        else {
          const lim = 3 * Math.min(Math.abs(s0), Math.abs(s1));   // Fritsch–Carlson: no overshoot inside a monotone run
          dOut = clamp(dOut, -lim, lim); dIn = clamp(dIn, -lim, lim);
        }
      }
      tin[idx] = dIn; tout[idx] = dOut;
    }
  }
  const mask = new Uint8Array(NCH); for (const ci of chans) mask[ci] = 1;
  const legFK = [mask[CI.hipL] || mask[CI.knL] || mask[CI.anL] ? 1 : 0, mask[CI.hipR] || mask[CI.knR] || mask[CI.anR] ? 1 : 0];
  const legIK = [mask[CI.fL] || mask[CI.ftL] ? 1 : 0, mask[CI.fR] || mask[CI.ftR] ? 1 : 0];
  return {
    ...def, name, frames: def.frames, n, times, chans, vals, tin, tout, lin, mask, legFK, legIK,
    dur: def.dur, hit: def.hit ?? 2, side: def.side || 'R', hold: !!def.hold,
  };
}

// Evaluate a compiled clip at normalised time k into out (Float64Array, NF).  Only the clip's channels are written.
export function evalClip(C, k, out) {
  const t = C.times, n = C.n, chans = C.chans, nc = chans.length, V = C.vals, TI = C.tin, TO = C.tout;
  if (n === 1) { for (let j = 0; j < nc; j++) { const o = chans[j] * 3, s = j * 3; out[o] = V[s]; out[o + 1] = V[s + 1]; out[o + 2] = V[s + 2]; } return; }
  let i = 0; while (i < n - 2 && k > t[i + 1]) i++;
  const h = t[i + 1] - t[i];
  let u = h > 1e-9 ? (k - t[i]) / h : 1; u = u < 0 ? 0 : u > 1 ? 1 : u;
  if (C.lin[i]) {
    for (let j = 0; j < nc; j++) {
      const o = chans[j] * 3, a = (j * n + i) * 3;
      for (let c = 0; c < 3; c++) out[o + c] = V[a + c] + (V[a + 3 + c] - V[a + c]) * u;
    }
    return;
  }
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = (u3 - 2 * u2 + u) * h, h01 = -2 * u3 + 3 * u2, h11 = (u3 - u2) * h;
  for (let j = 0; j < nc; j++) {
    const o = chans[j] * 3, a = (j * n + i) * 3;
    out[o] = h00 * V[a] + h10 * TO[a] + h01 * V[a + 3] + h11 * TI[a + 3];
    out[o + 1] = h00 * V[a + 1] + h10 * TO[a + 1] + h01 * V[a + 4] + h11 * TI[a + 4];
    out[o + 2] = h00 * V[a + 2] + h10 * TO[a + 2] + h01 * V[a + 5] + h11 * TI[a + 5];
  }
}

// ---------------------------------------------------------------------------
// 3x3 rotation matrices (Float64Array(9), row-major) matching three.js Euler conventions
// ---------------------------------------------------------------------------
export const m3 = () => new Float64Array(9);
export function m3EulerXYZ(m, x, y, z) {
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  m[0] = c * e; m[1] = -c * f; m[2] = d;
  m[3] = af + be * d; m[4] = ae - bf * d; m[5] = -b * c;
  m[6] = bf - ae * d; m[7] = be + af * d; m[8] = a * c;
  return m;
}
export function m3EulerYXZ(m, x, y, z) {
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ce = c * e, cf = c * f, de = d * e, df = d * f;
  m[0] = ce + df * b; m[1] = de * b - cf; m[2] = a * d;
  m[3] = a * f; m[4] = a * e; m[5] = -b;
  m[6] = cf * b - de; m[7] = df + ce * b; m[8] = a * c;
  return m;
}
export function m3Mul(o, a, b) {
  const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5], a6 = a[6], a7 = a[7], a8 = a[8];
  const b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5], b6 = b[6], b7 = b[7], b8 = b[8];
  o[0] = a0 * b0 + a1 * b3 + a2 * b6; o[1] = a0 * b1 + a1 * b4 + a2 * b7; o[2] = a0 * b2 + a1 * b5 + a2 * b8;
  o[3] = a3 * b0 + a4 * b3 + a5 * b6; o[4] = a3 * b1 + a4 * b4 + a5 * b7; o[5] = a3 * b2 + a4 * b5 + a5 * b8;
  o[6] = a6 * b0 + a7 * b3 + a8 * b6; o[7] = a6 * b1 + a7 * b4 + a8 * b7; o[8] = a6 * b2 + a7 * b5 + a8 * b8;
  return o;
}
// o = aᵀ b
export function m3TMul(o, a, b) {
  const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5], a6 = a[6], a7 = a[7], a8 = a[8];
  const b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5], b6 = b[6], b7 = b[7], b8 = b[8];
  o[0] = a0 * b0 + a3 * b3 + a6 * b6; o[1] = a0 * b1 + a3 * b4 + a6 * b7; o[2] = a0 * b2 + a3 * b5 + a6 * b8;
  o[3] = a1 * b0 + a4 * b3 + a7 * b6; o[4] = a1 * b1 + a4 * b4 + a7 * b7; o[5] = a1 * b2 + a4 * b5 + a7 * b8;
  o[6] = a2 * b0 + a5 * b3 + a8 * b6; o[7] = a2 * b1 + a5 * b4 + a8 * b7; o[8] = a2 * b2 + a5 * b5 + a8 * b8;
  return o;
}
export function m3RotX(m, x) { const c = Math.cos(x), s = Math.sin(x); m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 0; m[4] = c; m[5] = -s; m[6] = 0; m[7] = s; m[8] = c; return m; }
export function eulerYXZ(m, out, o) {
  const m23 = clamp(m[5], -1, 1);
  out[o] = Math.asin(-m23);
  if (Math.abs(m23) < 0.9999999) { out[o + 1] = Math.atan2(m[2], m[8]); out[o + 2] = Math.atan2(m[3], m[4]); }
  else { out[o + 1] = Math.atan2(-m[6], m[0]); out[o + 2] = 0; }
}
export function eulerXYZ(m, out, o) {
  const m13 = clamp(m[2], -1, 1);
  out[o + 1] = Math.asin(m13);
  if (Math.abs(m13) < 0.9999999) { out[o] = Math.atan2(-m[5], m[8]); out[o + 2] = Math.atan2(-m[1], m[0]); }
  else { out[o] = Math.atan2(m[7], m[4]); out[o + 2] = 0; }
}

// ---------------------------------------------------------------------------
// Analytic two-bone IK for a chain that hangs along -Y from its root joint (YXZ Euler joint,
// single-axis bend about local X).  (tx,ty,tz): root joint -> end target, (px,py,pz): pole, the
// side the middle joint should bulge towards; both in the chain's parent frame.
// bend = +1 for knees (shin swings back, knee bulges to +Z), -1 for elbows.
// Writes the root joint's Euler (x, y, z) into out[o..o+2]; returns the signed bend angle and
// leaves the reach ratio (|t| / (a+b)) in ikInfo.reach.
// ---------------------------------------------------------------------------
export const ikInfo = { reach: 0 };
const _R = new Float64Array(9);
export function solveTwoBone(a, b, tx, ty, tz, px, py, pz, bend, out, o) {
  let d = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (!(d > 1e-6)) { tx = 0; ty = -1e-3; tz = 0; d = 1e-3; }
  ikInfo.reach = d / (a + b);
  const ux = tx / d, uy = ty / d, uz = tz / d;
  const dc = clamp(d, Math.abs(a - b) + 1e-3, (a + b) * 0.9993);
  const cosK = clamp((a * a + b * b - dc * dc) / (2 * a * b), -1, 1);
  const kap = Math.PI - Math.acos(cosK);
  // local (unrotated) end direction and bulge direction
  const ey = -a - b * Math.cos(kap), ez = -bend * b * Math.sin(kap), el = Math.sqrt(ey * ey + ez * ez);
  const u0y = ey / el, u0z = ez / el;
  const n0y = bend * u0z, n0z = -bend * u0y;            // bend * (0, u0z, -u0y)
  // w0 = u0 x n0 (u0x = n0x = 0): only x is non-zero
  const w0x = u0y * n0z - u0z * n0y;
  // target frame
  let dp = px * ux + py * uy + pz * uz;
  let nx = px - dp * ux, ny = py - dp * uy, nz = pz - dp * uz;
  let nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (nl < 1e-5) { dp = bend * uz; nx = -dp * ux; ny = -dp * uy; nz = bend - dp * uz; nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; }
  nx /= nl; ny /= nl; nz /= nl;
  const wx = uy * nz - uz * ny, wy = uz * nx - ux * nz, wz = ux * ny - uy * nx;
  // R = [u n w] [u0 n0 w0]^T   (u0 = (0,u0y,u0z), n0 = (0,n0y,n0z), w0 = (w0x,0,0))
  _R[0] = wx * w0x; _R[1] = ux * u0y + nx * n0y; _R[2] = ux * u0z + nx * n0z;
  _R[3] = wy * w0x; _R[4] = uy * u0y + ny * n0y; _R[5] = uy * u0z + ny * n0z;
  _R[6] = wz * w0x; _R[7] = uz * u0y + nz * n0y; _R[8] = uz * u0z + nz * n0z;
  eulerYXZ(_R, out, o);
  return bend * kap;
}

// ---------------------------------------------------------------------------
// Spring bank: n independent damped oscillators, x'' = -w²x - 2ζw x' + f.  Semi-implicit Euler with
// fixed sub-steps so it is stable at any frame time.  Used additively for secondary motion.
// ---------------------------------------------------------------------------
export class SpringBank {
  constructor(n) {
    this.n = n; this.x = new Float64Array(n); this.v = new Float64Array(n); this.f = new Float64Array(n);
    this.w = new Float64Array(n).fill(12); this.z = new Float64Array(n).fill(0.5); this.lim = new Float64Array(n).fill(1);
  }
  set(i, w, z, lim) { this.w[i] = w; this.z[i] = z; this.lim[i] = lim; }
  reset() { this.x.fill(0); this.v.fill(0); this.f.fill(0); }
  step(dt) {
    const n = this.n, X = this.x, V = this.v, F = this.f, W = this.w, Z = this.z, L = this.lim;
    let steps = Math.ceil(dt / 0.0125); if (steps < 1) steps = 1; if (steps > 6) steps = 6;
    const h = dt / steps;
    for (let i = 0; i < n; i++) {
      let x = X[i], v = V[i]; const w = W[i], k = w * w, c = 2 * Z[i] * w, f = F[i], l = L[i];
      for (let s = 0; s < steps; s++) { v += (f - k * x - c * v) * h; x += v * h; }
      if (x > l) { x = l; if (v > 0) v *= -0.3; } else if (x < -l) { x = -l; if (v < 0) v *= -0.3; }
      if (!(x === x) || !(v === v)) { x = 0; v = 0; }
      X[i] = x; V[i] = v; F[i] = 0;
    }
  }
}

// cheap smooth value noise from a few incommensurate sines (deterministic per seed)
export function wobble(t, seed) {
  return Math.sin(t * 1.71 + seed * 12.9) * 0.5 + Math.sin(t * 2.93 + seed * 7.3) * 0.3 + Math.sin(t * 5.37 + seed * 3.1) * 0.2;
}
