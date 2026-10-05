import {
  TAU, sstep, gauss, piece, computeNormals, xform, mat, move, concat, uvRect, uvSet, aoMul, loft, sweepRings, tube, strap, ellipsoid,
  rbox, cylinder, torus, HEAD, headPiece, headPoint, headOut, headShell, headU, headV, thOfY, uvFromHead, nosePiece, earPiece, KitBuilder, flipWinding, fixOutward,
} from './chargeneric_geo.js';

// ===========================================================================
// Body + garment construction for one LOOK (cached per look by chargeneric.js).
// Coordinates: rig space at rest (hips joint y=1.0, faces +Z, left = +X).  Every piece is tagged with a
// bone, a material slot ('skin' | 'under' | 'armor' | 'glow') and a uv rect from the slot's atlas.
// Surface ownership: where two bones' pieces overlap (spine, elbows, knees) the non-owner is shrunk a few
// percent so the owner is always on top at rest and bending only reveals a slightly smaller ring.
// ===========================================================================
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
// piecewise smooth interpolation over a table [[x, ...vals]]
function table(T, x) {
  if (x <= T[0][0]) return T[0].slice(1);
  for (let i = 0; i < T.length - 1; i++) {
    const a = T[i], b = T[i + 1];
    if (x <= b[0]) { let t = (x - a[0]) / (b[0] - a[0]); t = t * t * (3 - 2 * t); return a.slice(1).map((v, k) => v + (b[k + 1] - v) * t); }
  }
  return T[T.length - 1].slice(1);
}

export function bonePositions(W, HW) {
  return {
    hips: [0, 1, 0], torso: [0, 1.1, 0], chest: [0, 1.4, 0], neck: [0, 1.9, 0], head: [0, 1.95, 0],
    shL: [W, 1.76, 0], shR: [-W, 1.76, 0], elL: [W, 1.38, 0], elR: [-W, 1.38, 0], wrL: [W, 1.0, 0], wrR: [-W, 1.0, 0], handL: [W, 1.0, 0], handR: [-W, 1.0, 0],
    hipL: [HW, 0.92, 0], hipR: [-HW, 0.92, 0], knL: [HW, 0.46, 0], knR: [-HW, 0.46, 0], anL: [HW, 0.06, 0], anR: [-HW, 0.06, 0],
  };
}

// ---------------------------------------------------------------------------
// Torso profile: y -> [rx, rz, cz, e]   (bulk applied by the caller)
// ---------------------------------------------------------------------------
const TORSO = [
  [0.79, 0.100, 0.050, -0.012, 2.0],
  [0.84, 0.190, 0.090, -0.014, 2.4],
  [0.89, 0.244, 0.136, -0.012, 2.5],
  [0.95, 0.254, 0.152, -0.010, 2.5],
  [1.02, 0.236, 0.147, -0.006, 2.4],
  [1.10, 0.213, 0.139, 0.000, 2.3],
  [1.20, 0.211, 0.138, 0.004, 2.3],
  [1.30, 0.226, 0.146, 0.007, 2.35],
  [1.40, 0.250, 0.158, 0.008, 2.45],
  [1.50, 0.270, 0.168, 0.006, 2.5],
  [1.60, 0.280, 0.172, 0.003, 2.55],
  [1.68, 0.285, 0.166, -0.002, 2.6],
  [1.74, 0.300, 0.150, -0.008, 2.6],
  [1.80, 0.270, 0.130, -0.014, 2.5],
  [1.855, 0.180, 0.106, -0.016, 2.4],
  [1.90, 0.100, 0.086, -0.014, 2.1],
  [1.93, 0.082, 0.076, -0.012, 2.0],
];
export function torsoAt(B, y, off = 0, hang = false) {
  if (hang && y < 0.96) { // hanging garments (coats, skirts) drape straight down from the hips instead of following the crotch
    const T = torsoAt(B, 0.96, off), fl = 1 + 0.05 * (0.96 - y) / 0.1;
    return { rx: T.rx * fl, rz: T.rz * (1 + 0.03 * (0.96 - y) / 0.1), cz: T.cz, e: T.e };
  }
  let [rx, rz, cz, e] = table(TORSO, y);
  const b = B.b, f = B.fem || 0;
  // female: narrower ribcage/waist, wider hips
  const hipK = 1 + f * 0.1 * gauss((y - 0.95) / 0.1) - f * 0.14 * gauss((y - 1.18) / 0.1) - f * 0.1 * sstep(1.4, 1.75, y);
  rx *= b * hipK * (B.wx ?? 1); rz *= b * (B.wz ?? 1);
  // waist / belly
  const bellyM = gauss((y - 1.2) / 0.13);
  rz *= 1 + (B.belly || 0) * bellyM; rx *= 1 + (B.belly || 0) * 0.45 * bellyM;
  // gaunt (junkie): pinched waist & sunken chest
  if (B.gaunt) { rx *= 1 - B.gaunt * 0.12 * gauss((y - 1.25) / 0.2); rz *= 1 - B.gaunt * 0.1 * gauss((y - 1.35) / 0.25); }
  // chest / shoulders scale
  const up = sstep(1.35, 1.6, y);
  rx *= 1 + ((B.chest ?? 1) - 1) * up; rz *= (1 + ((B.chest ?? 1) - 1) * 0.8 * up) * (1 + 0.06 * up * (1 - sstep(1.72, 1.85, y)));
  // shoulder yoke reaches out towards the deltoids
  // the shoulder line overhangs the arm socket: arms emerge from under a rounded yoke (no ball-joint look)
  const yoke = gauss((y - 1.772) / 0.055);
  rx = lerp(rx, Math.max(rx, B.W + 0.028 * (B.armK ?? 1)), yoke * 0.92);
  // hunch: upper chest leans forward, upper back rounds
  const hz = (B.hunch || 0) * sstep(1.35, 1.85, y) * 0.06;
  return { rx: rx + off, rz: rz + off, cz: cz + hz, e };
}
// angular shaping (pecs, bust, belly, butt, shoulder blades)
function torsoBulge(B, y, damp = 1) {
  const f = B.fem || 0, pec = damp * (1 - f) * 0.05 * (B.pec ?? 1) * gauss((y - 1.6) / 0.06), bust = Math.max(damp, 0.75) * f * (B.bust ?? 0.16) * gauss((y - 1.55) / 0.065);
  const butt = damp * 0.06 * gauss((y - 0.95) / 0.06) * (1 + f * 0.6), blade = damp * 0.035 * gauss((y - 1.6) / 0.08);
  return (t) => {
    let k = 1;
    const tt = Math.atan2(Math.sin(t), Math.cos(t));
    if (pec) k += pec * (gauss((tt - 0.5) / 0.38) + gauss((tt + 0.5) / 0.38));
    if (bust) k += bust * (gauss((tt - 0.42) / 0.3) + gauss((tt + 0.42) / 0.3));
    const back = Math.PI - Math.abs(tt);
    k += butt * (gauss((back - 0.55) / 0.4)) + blade * gauss((back - 0.6) / 0.35) - 0.025 * gauss(back / 0.12) * sstep(1.2, 1.5, y);
    return k;
  };
}
// thick garments hide anatomy: fade the bulges with the layer offset
const bulgeDamp = (off) => 1 - clamp((off || 0) / 0.03, 0, 1) * 0.75;
const dampBulge = (f) => f; // (damping now happens inside torsoBulge so the bust survives thick garments)
// the three torso bones and their surface ownership ranges
const SPINE = [
  { bone: 'hips', lo: -1, hi: 1.065, ext: [-1, 1.13] },
  { bone: 'torso', lo: 1.065, hi: 1.42, ext: [1.0, 1.48] },
  { bone: 'chest', lo: 1.42, hi: 9, ext: [1.36, 9] },
];
const SHRINK = 0.955;
function ownK(y, lo, hi) { // 1 inside [lo,hi], shrinking outside (lower boundary: grows into it; upper: shrinks after it)
  let k = 1;
  if (y < lo) k = lerp(SHRINK, 1, sstep(lo - 0.015, lo, y));
  if (y > hi) k = lerp(1, SHRINK, sstep(hi, hi + 0.015, y));
  return k;
}
// One torso layer across the spine bones.  L: { slot, rect, off, y0, y1, gap(y) half-angle of a front opening,
//   seg, hemBot, hemTop, group, vRange:[ya, yb] for texture v, back (only the back part), aoK }
export function torsoLayer(K, B, L) {
  const seg = L.seg ?? 24, ya = L.vRange?.[0] ?? L.y0, yb = L.vRange?.[1] ?? L.y1;
  for (const S of SPINE) {
    const lo = Math.max(L.y0, S.ext[0]), hi = Math.min(L.y1, S.ext[1]);
    if (hi - lo < 0.01) continue;
    const ys = []; const n = Math.max(2, Math.ceil((hi - lo) / 0.045));
    for (let i = 0; i <= n; i++) ys.push(lo + (hi - lo) * i / n);
    for (const yy of [S.lo, S.hi, S.lo - 0.015, S.hi + 0.015]) if (yy > lo + 0.004 && yy < hi - 0.004) ys.push(yy);
    ys.sort((a, b) => a - b);
    const rings = [];
    const mk = (y, extra = 0, kOwn = 1, dy = 0) => {
      const T = torsoAt(B, y, L.off + extra, L.hang), bul = torsoBulge(B, L.hang ? Math.max(y, 0.96) : y, bulgeDamp(L.off)), gap = L.gap ? L.gap(y) : 0;
      const k = kOwn * (L.scale ? L.scale(y) : 1);
      return { c: [0, y + dy, T.cz], rx: T.rx * k, rz: T.rz * k, e: T.e, f: bul, a0: gap, a1: TAU - gap, v: clamp((y - ya) / (yb - ya), 0, 1), yy: y };
    };
    // hem at the bottom (turned edge) if this bone holds the layer bottom
    if (L.hemBot && Math.abs(lo - L.y0) < 1e-6) { rings.push({ ...mk(lo + 0.03, -0.012, ownK(lo, S.lo, S.hi), 0), hem: true }); rings.push({ ...mk(lo, -0.008, ownK(lo, S.lo, S.hi), 0), hem: true }); }
    for (const y of ys) rings.push(mk(y, 0, ownK(y, S.lo, S.hi)));
    if (L.hemTop && Math.abs(hi - L.y1) < 1e-6) { rings.push({ ...mk(hi, -0.008, ownK(hi, S.lo, S.hi)), hem: true }); rings.push({ ...mk(hi - 0.03, -0.014, ownK(hi, S.lo, S.hi)), hem: true }); }
    const P = loftVar(rings, { seg, inside: false, u0: L.u0, u1: L.u1 });
    // analytic normals from the continuous (un-shrunk) surface: no lighting crease where spine pieces meet
    const surf = (y, t) => {
      const T = torsoAt(B, y, L.off, L.hang), bul = torsoBulge(B, L.hang ? Math.max(y, 0.96) : y, bulgeDamp(L.off)), k = L.scale ? L.scale(y) : 1, e = T.e, sn = Math.sin(t), cs = Math.cos(t);
      return [Math.sign(sn) * Math.pow(Math.abs(sn), 2 / e) * T.rx * k * bul(t), y, T.cz + Math.sign(cs) * Math.pow(Math.abs(cs), 2 / e) * T.rz * k * bul(t)];
    };
    const cols = seg + 1;
    rings.forEach((R, i) => {
      if (R.hem || (i > 0 && rings[i - 1].hem && i === 1)) return;
      for (let j = 0; j < cols; j++) {
        const t = R.a0 + (R.a1 - R.a0) * j / seg, y = R.yy, et = 1e-3, ey = 2e-3;
        const a = surf(y, t + et), b = surf(y, t - et), c = surf(y + ey, t), d = surf(y - ey, t);
        const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], w = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
        let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        const l = Math.hypot(n[0], n[1], n[2]); if (l < 1e-12) continue;
        const k = (i * cols + j) * 3; P.n[k] = n[0] / l; P.n[k + 1] = n[1] / l; P.n[k + 2] = n[2] / l;
      }
    });
    if (L.ao) aoMul(P, L.ao);
    K.add(S.bone, L.slot, P, { rect: L.rect, group: L.group ?? 'torso', aoK: L.aoK ?? 1 });
  }
}
// loft whose rings may each carry their own angular range (a0..a1, absolute angles); u = absolute angle / TAU
export function loftVar(rings, o = {}) {
  const seg = o.seg ?? 16, P = piece(), cols = seg + 1;
  for (const R of rings) {
    const a0 = R.a0 ?? 0, a1 = R.a1 ?? TAU;
    for (let j = 0; j < cols; j++) {
      const t = a0 + (a1 - a0) * j / seg;
      const s = Math.sin(t), c = Math.cos(t), e = R.e ?? 2;
      let lx = e === 2 ? s : Math.sign(s) * Math.pow(Math.abs(s), 2 / e), lz = e === 2 ? c : Math.sign(c) * Math.pow(Math.abs(c), 2 / e);
      const k = R.f ? R.f(t) : 1; lx *= R.rx * k; lz *= R.rz * k;
      P.p.push(R.c[0] + lx, R.c[1], R.c[2] + lz);
      const uu = o.uAbs === false ? j / seg : (t / TAU);
      P.uv.push((o.u0 ?? 0) + uu * ((o.u1 ?? 1) - (o.u0 ?? 0)), R.v ?? 0); P.a.push(R.ao ?? 1);
    }
  }
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
    P.ix.push(a, b, d, a, d, c);
  }
  // outward check at the middle (by ring centre); the hem rings fold back so use the majority
  computeNormals(P, true);
  let s = 0;
  for (let i = 0; i < rings.length; i++) for (let j = 0; j < cols; j++) { const k = i * cols + j, c = rings[i].c; s += (P.p[k * 3] - c[0]) * P.n[k * 3] + (P.p[k * 3 + 2] - c[2]) * P.n[k * 3 + 2]; }
  if ((s < 0) !== !!o.inside) { flipWinding(P); for (let i = 0; i < P.n.length; i++) P.n[i] = -P.n[i]; }
  return P;
}

// ---------------------------------------------------------------------------
// Limbs.  Profiles return [rx (lateral), rz (front-back), cx, cz] at distance d below the joint.
// ---------------------------------------------------------------------------
const UPPER = [[-0.06, 0.078, 0.082, 0, 0], [0.02, 0.092, 0.095, 0.004, 0], [0.11, 0.094, 0.095, 0.004, 0.003], [0.21, 0.086, 0.091, 0.002, 0.005], [0.31, 0.073, 0.078, 0, 0.002], [0.38, 0.065, 0.069, 0, 0], [0.43, 0.06, 0.063, 0, 0]];
const FORE = [[-0.05, 0.062, 0.065, 0, -0.002], [0.03, 0.068, 0.071, 0, 0], [0.1, 0.071, 0.069, 0, 0.002], [0.21, 0.059, 0.056, 0, 0.002], [0.31, 0.046, 0.043, 0, 0], [0.37, 0.039, 0.048, 0, 0], [0.4, 0.037, 0.046, 0, 0]];
const THIGH = [[-0.13, 0.096, 0.108, 0, 0], [-0.04, 0.11, 0.122, -0.004, 0], [0.06, 0.118, 0.126, -0.006, 0.006], [0.18, 0.117, 0.121, -0.004, 0.008], [0.30, 0.102, 0.106, 0, 0.008], [0.40, 0.088, 0.091, 0, 0.007], [0.46, 0.080, 0.085, 0, 0.008], [0.5, 0.077, 0.082, 0, 0.008]];
const SHIN = [[-0.05, 0.076, 0.082, 0, 0.004], [0.04, 0.074, 0.084, 0, -0.004], [0.12, 0.073, 0.087, 0, -0.012], [0.24, 0.061, 0.069, 0, -0.006], [0.33, 0.051, 0.055, 0, -0.002], [0.4, 0.047, 0.051, 0, 0]];
export const PROFILES = { upper: UPPER, fore: FORE, thigh: THIGH, shin: SHIN };
// limb loft: joint J (rig), profile, range [d0,d1], thickness k, ownership [own0, own1] in d (shrink outside)
export function limb(K, o) {
  const { bone, slot, rect, J, prof, d0, d1 } = o, sx = o.side ?? 1, k = o.k ?? 1, off = o.off ?? 0;
  const n = Math.max(3, Math.ceil((d1 - d0) / (o.step ?? 0.055)));
  const ds = []; for (let i = 0; i <= n; i++) ds.push(d0 + (d1 - d0) * i / n);
  const rings = [];
  const mk = (d, extra = 0) => {
    const [rx, rz, cx, cz] = table(prof, d);
    let kk = k; if (o.own) { if (d < o.own[0]) kk *= lerp(SHRINK, 1, sstep(o.own[0] - 0.015, o.own[0], d)); if (d > o.own[1]) kk *= lerp(1, SHRINK, sstep(o.own[1], o.own[1] + 0.015, d)); }
    const sc = o.scale ? o.scale(d) : 1;
    return { c: [J[0] + cx * sx * k, J[1] - d, J[2] + cz * k], rx: rx * kk * sc + off + extra, rz: rz * kk * sc + off + extra, e: o.e ?? 2, v: o.v ? o.v(d) : 0, f: o.f };
  };
  // rings go from the bottom (d1) up to the top (d0) so v increases upward
  if (o.hemBot) { rings.push(mk(d1 - 0.025, -0.01)); rings.push(mk(d1, -0.006)); }
  for (let i = ds.length - 1; i >= 0; i--) rings.push(mk(ds[i]));
  if (o.hemTop) { rings.push(mk(d0, -0.006)); rings.push(mk(d0 + 0.025, -0.01)); }
  if (o.roll) { // rolled cuff at the bottom: a fat torus-like bulge
    const rb = mk(d1); rings.splice(0, 0, { ...rb, c: [rb.c[0], rb.c[1] + 0.025, rb.c[2]], rx: rb.rx - 0.004, rz: rb.rz - 0.004 }, { ...rb, c: [rb.c[0], rb.c[1] - 0.004, rb.c[2]], rx: rb.rx + o.roll * 0.6, rz: rb.rz + o.roll * 0.6 }, { ...rb, c: [rb.c[0], rb.c[1] + 0.012, rb.c[2]], rx: rb.rx + o.roll, rz: rb.rz + o.roll });
    rings.splice(3, 0, { ...rb, c: [rb.c[0], rb.c[1] + 0.03, rb.c[2]], rx: rb.rx + o.roll * 0.7, rz: rb.rz + o.roll * 0.7 });
  }
  const P = loft(rings, { seg: o.seg ?? 12, a0: o.a0 ?? 0, a1: o.a1 ?? TAU, capTop: o.capTop, capBot: o.capBot });
  if (o.ao) aoMul(P, o.ao);
  K.add(bone, slot, P, { rect, flipU: o.flipU ?? sx < 0, group: o.group, aoK: o.aoK ?? 1 });
  return P;
}

// ---------------------------------------------------------------------------
// HANDS (hand-bone origin at the wrist, hanging along -Y; palm faces the body)
// ---------------------------------------------------------------------------
export function handPieces(side, o = {}) {
  const s = o.size ?? 1, palm = -side; // palm normal direction along x
  const parts = [];
  // palm / back of the hand
  const rings = [];
  const prof = [[0.012, 0.024, 0.036], [-0.01, 0.021, 0.043], [-0.04, 0.019, 0.047], [-0.065, 0.018, 0.048], [-0.078, 0.016, 0.045]];
  for (const [y, rx, rz] of prof) rings.push({ c: [palm * 0.002 * s, y * s, 0], rx: rx * s, rz: rz * s, e: 2.6 });
  parts.push(loft(rings, { seg: 10, capBot: true, capBotBulge: 0.008 * s }));
  // fingers: index (+z) .. pinky (-z)
  const fist = o.grip !== 'relaxed';
  const zs = [0.032, 0.011, -0.01, -0.029], lens = [1.0, 1.08, 1.0, 0.82], rads = [0.0108, 0.0112, 0.0104, 0.0092];
  zs.forEach((z, i) => {
    const L = lens[i] * s, r = rads[i] * s, pts = [];
    const kn = [-side * 0.006 * s, -0.072 * s, z * s];
    if (fist) {
      // down from the knuckle, curl towards the palm and back up around the weapon grip at y=-0.1
      const c = [palm * 0.004 * s, -0.104 * s, z * s], R = 0.026 * s * (0.9 + 0.1 * lens[i]);
      pts.push(kn);
      for (let k = 0; k <= 5; k++) { const a = Math.PI * (0.05 + k * 0.17); pts.push([c[0] - palm * Math.cos(a) * R * 0.95 * (k === 0 ? 1.15 : 1), c[1] - Math.sin(a) * R * 1.05 + (k === 0 ? 0.012 * s : 0), c[2] + (k * 0.0015 - 0.002) * Math.sign(z) * s]); }
      pts.splice(1, 1); // keep knuckle -> arc
    } else {
      for (let k = 0; k <= 4; k++) { const a = k * 0.28 * L; pts.push([kn[0] + palm * Math.sin(a) * 0.02 * s * k, kn[1] - 0.019 * L * k * Math.cos(a * 0.6), kn[2]]); }
    }
    parts.push(tube(pts, (t) => r * (1 - 0.22 * t), { seg: 6, cap: true }));
  });
  // thumb
  const th = fist
    ? [[palm * 0.014 * s, -0.018 * s, 0.03 * s], [palm * 0.022 * s, -0.045 * s, 0.047 * s], [palm * 0.02 * s, -0.072 * s, 0.05 * s], [palm * 0.008 * s, -0.09 * s, 0.045 * s]]
    : [[palm * 0.014 * s, -0.018 * s, 0.03 * s], [palm * 0.024 * s, -0.045 * s, 0.045 * s], [palm * 0.026 * s, -0.07 * s, 0.05 * s], [palm * 0.022 * s, -0.09 * s, 0.05 * s]];
  parts.push(tube(th, (t) => (0.0135 - 0.003 * t) * s, { seg: 6, cap: true }));
  return parts;
}

// ---------------------------------------------------------------------------
// FOOTWEAR (ankle-bone origin; the ground is at y = -0.06)
// kind: combat | work | sneaker | dress | biker | heel | bare
// ---------------------------------------------------------------------------
export function bootPieces(kind, rects, o = {}) {
  const s = o.size ?? 1, out = [];
  const top = { combat: 0.17, biker: 0.24, work: 0.1, sneaker: 0.012, dress: -0.012, heel: -0.02, flat: -0.02 }[kind] ?? 0.1;
  const soleT = { combat: 0.026, biker: 0.02, work: 0.026, sneaker: 0.024, dress: 0.012, heel: 0.01, flat: 0.01 }[kind] ?? 0.02;
  const G = -0.0595, soleTop = G + soleT;
  const wide = kind === 'combat' || kind === 'work' || kind === 'biker' ? 1.06 : kind === 'heel' || kind === 'flat' ? 0.86 : 1;
  const len = (kind === 'heel' || kind === 'flat' ? 0.95 : kind === 'combat' || kind === 'biker' || kind === 'work' ? 1.12 : 1.06) * s;
  // shaft
  if (top > -0.005) {
    const ys = [top, top - 0.03, (top + 0.0) / 2, 0.02, -0.005, -0.02].filter((y, i, a) => i === 0 || (y < a[i - 1] - 0.008));
    const rings = ys.map((y) => {
      const k = sstep(0.03, -0.02, y);
      return { c: [0, y, 0.004 + 0.016 * k], rx: (0.058 + 0.004 * (kind === 'biker' ? 1 : 0)) * wide * s, rz: (0.064 + 0.018 * k) * wide * s, e: 2.2, v: 0.55 + 0.45 * clamp((y + 0.02) / (top + 0.02 + 1e-6), 0, 1) };
    }).reverse();
    if (kind !== 'sneaker') { // padded collar / turned top
      const R = rings[rings.length - 1]; rings.push({ ...R, c: [R.c[0], R.c[1] + 0.006, R.c[2]], rx: R.rx - 0.004, rz: R.rz - 0.004 }, { ...R, c: [R.c[0], R.c[1] - 0.012, R.c[2]], rx: R.rx - 0.01, rz: R.rz - 0.01 });
    }
    out.push({ P: loft(rings, { seg: 14, a0: -Math.PI, a1: Math.PI }), rect: rects.shaft });
  }
  // foot (loft along +z, rings in the xy plane; t=0 is the top)
  const Z = [[-0.078, 0.036, 0.022, 0.6], [-0.06, 0.044, 0.03, 0.8], [-0.02, 0.048, 0.03, 1], [0.04, 0.051, 0.012, 1], [0.1, 0.056, -0.008, 1], [0.15, 0.055, -0.016, 1], [0.19, 0.049, -0.022, 0.95], [0.215, 0.036, -0.028, 0.85], [0.228, 0.018, -0.034, 0.6]];
  const toeUp = kind === 'combat' || kind === 'work' ? 0.006 : 0;
  const frings = Z.map(([z, rx, topY, kk], i) => {
    const t = topY * (kind === 'dress' || kind === 'heel' || kind === 'flat' ? 0.8 : 1) + (kind === 'heel' ? 0.012 * (1 - i / 8) : 0);
    const yb = soleTop - 0.002, yt = Math.max(t + (i >= 6 ? toeUp : 0), yb + 0.012);
    return { c: [0, (yt + yb) / 2, z * len], rx: rx * wide * s, rz: (yt - yb) / 2, ux: [1, 0, 0], uz: [0, 1, 0], e: 2.5, v: 0.15 + 0.4 * (i / (Z.length - 1)), f: (tt) => (Math.cos(tt) < 0 ? 1 + 0.06 * kk : 1) };
  });
  // flatten the bottom onto the sole
  const foot = loft(frings, { seg: 14, a0: -Math.PI, a1: Math.PI, capTop: true, capBot: true, capTopBulge: 0.012, capBotBulge: 0.01 });
  for (let i = 1; i < foot.p.length; i += 3) if (foot.p[i] < soleTop - 0.001) foot.p[i] = soleTop - 0.001;
  computeNormals(foot, true);
  out.push({ P: foot, rect: rects.foot });
  // sole: outline loft (vertical), wider at the toe
  const outline = (rx, rz, cz) => ({ rx, rz, c: [0, 0, cz], f: (t) => 1 + 0.09 * Math.cos(t) - 0.05 * Math.cos(2 * t) });
  const ol = outline(0.058 * wide * s, 0.16 * len, 0.074 * len);
  const srings = [
    { ...ol, c: [0, G, ol.c[2]], rx: ol.rx - 0.004, rz: ol.rz - 0.004, v: 0 },
    { ...ol, c: [0, G + 0.004, ol.c[2]], v: 0.04 },
    { ...ol, c: [0, soleTop, ol.c[2]], v: 0.11 },
    { ...ol, c: [0, soleTop + 0.003, ol.c[2]], rx: ol.rx - 0.006, rz: ol.rz - 0.006, v: 0.14 },
  ];
  const sole = loft(srings, { seg: 22, capBot: true, capTop: true, capBotBulge: 0.0005, capTopBulge: 0.0 });
  for (let i = 1; i < sole.p.length; i += 3) sole.p[i] = Math.max(sole.p[i], G);
  out.push({ P: sole, rect: rects.sole });
  if (kind === 'heel') { // stiletto heel block
    const hb = cylinder(0.012 * s, 0.016 * s, 0.05, 6); move(hb, 0, G + 0.025, -0.055 * len); out.push({ P: hb, rect: rects.sole });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Assemble a full look.  spec fields are documented in chargeneric_looks.js
// A = { skin, under, armor } atlases (for uv rects)
// ---------------------------------------------------------------------------
export function buildLook(spec, A) {
  const B = { ...spec.body };
  B.b = B.b ?? 1; B.armK = B.armK ?? B.b; B.legK = B.legK ?? B.b; B.neckK = B.neckK ?? (B.fem ? 0.88 : 0.9 + 0.22 * B.b);
  const W = B.W ?? (0.36 * B.b + 0.02 - (B.fem ? 0.03 : 0));
  const HW = B.HW ?? (0.15 + 0.05 * B.b * (B.fem ? 1.06 : 1));
  B.W = W; B.HW = HW;
  const BP = bonePositions(W, HW);
  const K = new KitBuilder(BP);
  const SK = A.skin, UN = A.under, AR = A.armor;
  const ak = B.armK, lk = B.legK;
  // occluders (proximity AO)
  K.occluder([0, 0.9, -0.01], [0, 1.66, 0], 0.2 * B.b, 'torso');
  K.occluder([0, 1.82, -0.01], [0, 2.0, 0], 0.06 * (B.neckK ?? 1), 'neck');
  K.occluder([0, 2.08, 0.0], [0, 2.16, 0.0], 0.125, 'head');
  for (const s of [1, -1]) {
    const g = s > 0 ? 'armL' : 'armR', lg = s > 0 ? 'legL' : 'legR';
    K.occluder([s * W, 1.74, 0], [s * W, 1.42, 0], 0.075 * ak, g);
    K.occluder([s * W, 1.36, 0], [s * W, 1.04, 0], 0.056 * ak, g + 'f');
    K.occluder([s * HW, 0.88, 0], [s * HW, 0.52, 0], 0.105 * lk, lg);
    K.occluder([s * HW, 0.42, -0.01], [s * HW, 0.12, -0.01], 0.065 * lk, lg + 's');
  }
  const ctx = { spec, B, W, HW, BP, K, SK, UN, AR, ak, lk };

  buildTorso(ctx);
  buildArms(ctx);
  buildLegs(ctx);
  buildHeadAndNeck(ctx);
  buildHands(ctx);
  buildFeet(ctx);
  for (const a of spec.acc || []) ACC[a.kind]?.(ctx, a);
  const parts = K.build();
  return { parts, W, HW, B };
}

// ----------------------------------------------------------------------------- torso
function buildTorso(c) {
  const { spec, B, K, UN, AR } = c, top = spec.top || {}, shirt = spec.shirt || {}, legs = spec.legs || {};
  const pelvisTop = 1.13; // trousers waistband height (belt)
  // trousers pelvis (always): from crotch to waist; under a long coat it is still built (cheap, shows when legs move)
  const pr = UN.uv(legs.pelvis || 'pelvisJeans');
  torsoLayer(K, B, { slot: 'under', rect: pr, off: 0.004, y0: 0.79, y1: pelvisTop + 0.02, seg: 22, vRange: [0.79, pelvisTop + 0.02], group: 'torso', hemTop: false });
  // inner shirt (visible in a front opening, or the whole torso when there is no outer top)
  const outer = top.kind && top.kind !== 'none';
  const gapFn = top.gap ? (y) => top.gap * sstep(top.gapY0 ?? 1.3, top.gapY1 ?? 1.85, y) : null;
  const shirtRect = shirt.swatch ? UN.uv(shirt.swatch) : UN.uv('shirtPlain');
  const shirtSlot = shirt.slot || 'under';
  const shirtTop = shirt.neck ?? 1.9;
  if (!outer) {
    torsoLayer(K, B, { slot: shirtSlot, rect: shirt.rect || shirtRect, off: 0.006, y0: 1.06, y1: shirtTop, seg: 24, vRange: [1.06, 1.92], hemBot: true, scale: shirt.scale });
  } else if (gapFn || top.short) {
    // only the front wedge of the shirt is needed (plus the midriff under cropped tops)
    const yS = top.short ? 1.06 : (top.gapY0 ?? 1.3) - 0.02;
    const L = { slot: shirtSlot, rect: shirt.rect || shirtRect, off: 0.002, y0: yS, y1: shirtTop, seg: 24, vRange: [1.06, 1.92], hemBot: !!top.short };
    if (!top.short) { const g = top.gap + 0.3; L.gap = null; L.scale = null; L.y0 = (top.gapY0 ?? 1.3) - 0.04; L.front = g; }
    if (L.front) { // partial loft around the front only
      frontWedge(K, B, L);
    } else torsoLayer(K, B, L);
  }
  // outer top
  if (outer) {
    const y0 = top.y0 ?? ({ crop: 1.25, waist: 1.08, hip: 0.98, thigh: 0.86, coat: 0.86 }[top.len || 'hip']);
    const rect = AR.uv(top.swatch);
    if (top.straps) {
      torsoLayer(K, B, { slot: shirtSlot, rect: shirt.rect || shirtRect, off: 0.006, y0: 1.06, y1: shirtTop, seg: 24, vRange: [1.06, 1.92], hemBot: true });
      torsoLayer(K, B, { slot: top.slot || 'armor', rect, off: top.off ?? 0.04, y0, y1: 1.68, seg: top.seg ?? 24, vRange: [top.vY0 ?? 0.86, 1.92], hemBot: true, hemTop: true, aoK: 1 });
      for (const [cen, w0, w1] of [[0, 0.95, 0.42], [Math.PI, 1.0, 0.46]]) {
        const rings = [];
        for (let i = 0; i <= 5; i++) {
          const y = 1.62 + i * 0.05, T = torsoAt(B, y, (top.off ?? 0.04) * lerp(1, 0.5, i / 5)), w = lerp(w0, w1, sstep(1.62, 1.82, y));
          rings.push({ c: [0, y, T.cz], rx: T.rx, rz: T.rz, e: T.e, f: torsoBulge(B, y, bulgeDamp(0.03)), a0: cen - w, a1: cen + w, v: clamp((y - 0.86) / 1.06, 0, 1) });
        }
        const P = loftVar(rings, { seg: 12 });
        for (let i = 0; i < P.uv.length; i += 2) if (P.uv[i] < 0) P.uv[i] += 1;
        K.add('chest', top.slot || 'armor', P, { rect, group: 'torso' });
      }
    } else if (top.tank) {
      // body of the tank up to the armpits, then front & back panels narrowing into straps over bare shoulders
      torsoLayer(K, B, { slot: top.slot || 'armor', rect, off: top.off ?? 0.008, y0, y1: 1.7, seg: top.seg ?? 26, vRange: [top.vY0 ?? 0.86, 1.92], hemBot: true, aoK: 1 });
      torsoLayer(K, B, { slot: 'skin', rect: c.SK.uv(spec.armSkin || 'armPlain'), off: 0.0, y0: 1.6, y1: 1.905, seg: 24, vRange: [1.0, 2.2] });
      for (const [cen, w0, w1] of [[0, 1.05, 0.3], [Math.PI, 1.15, 0.38]]) {
        const rings = [];
        for (let i = 0; i <= 5; i++) {
          const y = 1.66 + i * 0.045, T = torsoAt(B, y, (top.off ?? 0.008) + 0.002), w = lerp(w0, w1, sstep(1.66, 1.86, y));
          rings.push({ c: [0, y, T.cz], rx: T.rx, rz: T.rz, e: T.e, f: torsoBulge(B, y), a0: cen - w, a1: cen + w, v: clamp((y - 0.86) / 1.06, 0, 1) });
        }
        const P = loftVar(rings, { seg: 12 });
        for (let i = 0; i < P.uv.length; i += 2) if (P.uv[i] < 0) P.uv[i] += 1;
        K.add('chest', top.slot || 'armor', P, { rect, group: 'torso' });
      }
    } else {
      torsoLayer(K, B, { slot: top.slot || 'armor', rect, off: top.off ?? 0.024, y0, y1: top.y1 ?? 1.905, gap: gapFn, seg: top.seg ?? 26, vRange: [top.vY0 ?? 0.86, 1.92], hemBot: true, scale: top.scale, aoK: 1, hang: true });
    }
  }
  // collar
  if (top.collar) COLLAR[top.collar]?.(c, top);
  else if (!outer && shirt.collar) COLLAR[shirt.collar]?.(c, shirt);
}
// front wedge of the undershirt inside an opening (partial loft)
function frontWedge(K, B, L) {
  for (const S of SPINE) {
    const lo = Math.max(L.y0, S.ext[0]), hi = Math.min(L.y1, S.ext[1]);
    if (hi - lo < 0.01) continue;
    const n = Math.max(2, Math.ceil((hi - lo) / 0.05)), rings = [];
    for (let i = 0; i <= n; i++) {
      const y = lo + (hi - lo) * i / n, T = torsoAt(B, y, L.off), k = ownK(y, S.lo, S.hi);
      rings.push({ c: [0, y, T.cz], rx: T.rx * k, rz: T.rz * k, e: T.e, f: torsoBulge(B, y), a0: -L.front, a1: L.front, v: clamp((y - L.vRange[0]) / (L.vRange[1] - L.vRange[0]), 0, 1) });
    }
    const P = loftVar(rings, { seg: 10 });
    // u: absolute angle / TAU gives negative values on the right side; wrap into 0..1
    for (let i = 0; i < P.uv.length; i += 2) if (P.uv[i] < 0) P.uv[i] += 1;
    K.add(S.bone, L.slot, P, { rect: L.rect, group: 'torso' });
  }
}

const COLLAR = {
  // ribbed band around the neck base (bomber / track jacket)
  band(c, top) {
    const { B, K, AR } = c, rect = AR.uv(top.collarSwatch || top.swatch + 'Collar'), y = 1.86, rings = [], hz = 0.06 * (B.hunch || 0);
    for (const [dy, dr] of [[-0.03, -0.004], [0, 0.012], [0.035, 0.014], [0.05, 0.004], [0.045, -0.006], [0.02, -0.01]]) {
      const T = torsoAt(B, y + dy * 0.5, 0); rings.push({ c: [0, y + dy, T.cz - 0.004 + hz * 0.3], rx: 0.105 * (B.neckK ?? 1) + 0.018 + dr, rz: 0.098 * (B.neckK ?? 1) + 0.014 + dr, e: 2.1 });
    }
    const gap = top.collarGap ?? top.gap ?? 0;
    const P = loft(rings, { seg: 20, a0: gap * 0.9, a1: TAU - gap * 0.9 });
    K.add('chest', top.slot || 'armor', P, { rect, group: 'torso' });
  },
  // shirt / jacket lapel collar: two flaps folded down over the shoulders
  shirt(c, top) {
    const { B, K, AR, UN } = c, atlas = top.collarAtlas === 'under' ? UN : AR, rect = atlas.uv(top.collarSwatch || 'collarShirt');
    const rings = [];
    const nk = 0.1 * (B.neckK ?? 1);
    const hz = 0.06 * (B.hunch || 0);
    for (const [y, r] of [[1.85, nk - 0.004], [1.9, nk + 0.002], [1.95, nk + 0.008], [1.935, nk + 0.03], [1.885, nk + 0.05], [1.86, nk + 0.056]]) rings.push({ c: [0, y, -0.016 + hz], rx: r, rz: r * 1.02, e: 2.1 });
    const gap = (top.collarGap ?? 0.35);
    const P = loft(rings, { seg: 22, a0: gap, a1: TAU - gap });
    K.add('chest', top.collarAtlas === 'under' ? 'under' : (top.slot || 'armor'), P, { rect, group: 'torso' });
  },
  // hood lying down behind the neck
  hood(c, top) {
    const { B, K, AR } = c, rect = AR.uv(top.hoodSwatch || top.swatch + 'Hood');
    const rings = [];
    const nk = 0.1 * (B.neckK ?? 1);
    const hz = 0.06 * (B.hunch || 0);
    for (const [y, rx, rz, cz] of [[1.74, nk + 0.1, nk + 0.07, -0.03], [1.8, nk + 0.11, nk + 0.08, -0.035], [1.86, nk + 0.09, nk + 0.07, -0.04], [1.9, nk + 0.06, nk + 0.055, -0.04], [1.915, nk + 0.03, nk + 0.03, -0.04]]) rings.push({ c: [0, y, cz + hz * sstep(1.7, 1.9, y)], rx, rz, e: 2.4, f: (t) => 1 + 0.1 * Math.max(0, -Math.cos(t)) });
    const g = 1.15;
    const P = loft(rings, { seg: 18, a0: g, a1: TAU - g, capTop: false });
    K.add('chest', top.slot || 'armor', P, { rect, group: 'torso', aoK: 0.6 });
    // drawstrings
    for (const s of [1, -1]) {
      const pts = [[s * 0.06, 1.86, 0.11 * B.b + 0.02], [s * 0.062, 1.76, 0.135 * B.b + 0.03], [s * 0.058, 1.68, 0.15 * B.b + 0.03]];
      K.add('chest', 'under', tube(pts, 0.006, { seg: 4 }), { rect: c.UN.uv('metal'), group: 'torso', aoK: 0 });
    }
  },
  fur(c, top) {
    const { B, K, AR } = c, rect = AR.uv(top.collarSwatch || 'fur');
    const nk = 0.11 * (B.neckK ?? 1) * 1.1;
    const rings = [];
    for (const [y, r, cz] of [[1.72, 0.24, 0.0], [1.79, 0.3, -0.02], [1.88, 0.29, -0.04], [1.96, 0.22, -0.055], [2.0, 0.15, -0.055], [1.95, 0.11, -0.045]]) rings.push({ c: [0, y, cz], rx: (r + nk * 0.3) * B.b * 0.78, rz: (r * 0.78 + nk * 0.2) * B.b * 0.78, e: 2.3, f: (t) => 1 + 0.08 * Math.sin(t * 9) + 0.05 * Math.sin(t * 23 + 1) });
    const P = loft(rings, { seg: 30, a0: 0.42, a1: TAU - 0.42 });
    // fluffy jitter
    for (let i = 0; i < P.p.length; i += 3) { const n = Math.sin(P.p[i] * 90 + P.p[i + 1] * 60) * Math.sin(P.p[i + 2] * 80) * 0.008; P.p[i] += P.n[i] * n; P.p[i + 1] += P.n[i + 1] * n; P.p[i + 2] += P.n[i + 2] * n; }
    computeNormals(P, true);
    K.add('chest', top.slot || 'armor', P, { rect, group: 'torso', aoK: 0.5 });
  },
  turtle(c, top) {
    const { B, K, UN } = c, rect = UN.uv(top.collarSwatch || 'collarKnit');
    const nk = 0.075 * (B.neckK ?? 1), rings = [];
    for (const [y, r] of [[1.84, nk + 0.03], [1.9, nk + 0.016], [1.98, nk + 0.012], [2.02, nk + 0.012], [2.015, nk + 0.002]]) rings.push({ c: [0, y, -0.012], rx: r, rz: r * 1.05 });
    K.add('neck', 'under', loft(rings, { seg: 16 }), { rect, group: 'torso' });
  },
};

// ----------------------------------------------------------------------------- arms
function buildArms(c) {
  const { spec, B, K, BP, SK, AR, UN, ak } = c, top = spec.top || {}, shirt = spec.shirt || {};
  const sleeve = top.kind && top.kind !== 'none' ? top.sleeves ?? 'long' : shirt.sleeves ?? 'short';
  const sleeveAtlas = top.kind && top.kind !== 'none' && top.sleeves !== 'none' ? AR : UN;
  const sleeveSlot = top.kind && top.kind !== 'none' && top.sleeves !== 'none' ? (top.slot || 'armor') : (shirt.slot || 'under');
  const sleeveRect = top.kind && top.kind !== 'none' ? (top.sleeveSwatch ? AR.uv(top.sleeveSwatch) : null) : (shirt.sleeveSwatch ? UN.uv(shirt.sleeveSwatch) : UN.uv('sleeveTee'));
  // when the outer top is sleeveless but the shirt has sleeves, use the shirt sleeves
  const shirtSleeves = (top.sleeves === 'none' && shirt.sleeves && shirt.sleeves !== 'none') ? shirt.sleeves : null;
  const armSkin = SK.uv(spec.armSkin || 'armPlain');
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R', g = 'arm' + L;
    const J = BP['sh' + L], E = BP['el' + L];
    // ranges: v runs 0 (wrist) .. 1 (shoulder top) over the whole arm length (0.80)
    const vU = (d) => clamp(1 - (d + 0.05) / 0.85, 0, 1), vF = (d) => clamp(1 - (d + 0.38 + 0.05) / 0.85, 0, 1);
    let sl = sleeve, rect = sleeveRect, slot = sleeveSlot;
    if (shirtSleeves) { sl = shirtSleeves; rect = shirt.sleeveSwatch ? UN.uv(shirt.sleeveSwatch) : UN.uv('sleeveTee'); slot = shirt.slot || 'under'; }
    const off = slot === 'armor' ? (top.sleeveOff ?? 0.016) : 0.006;
    const sleeveEnd = { long: 0.4, rolled: 0.17, short: 0.2, cap: 0.08, none: -1 }[sl] ?? 0.4; // long/rolled are forearm distances; short/cap upper-arm distances
    // deltoid cap
    const dOff = sl !== 'none' ? off : 0;
    const delt = ellipsoid(0.092 * ak + dOff, 0.08 * ak + dOff, 0.096 * ak + dOff, 12, 9);
    move(delt, J[0] + s * 0.012 * ak, J[1] - 0.058, J[2]); // sits under the shoulder overhang
    const deltRect = sl === 'none' ? armSkin : rect;
    uvSet(delt, 0.5, 0.97); // top of the sleeve swatch
    K.add('sh' + L, sl === 'none' ? 'skin' : slot, delt, { rect: deltRect, group: g, aoK: 0.7 });
    // upper arm
    if (sl === 'none') {
      limb(K, { bone: 'sh' + L, slot: 'skin', rect: armSkin, J, prof: UPPER, d0: 0.0, d1: 0.43, k: ak, side: s, own: [-1, 0.39], v: vU, group: g, capTop: true });
    } else if (sl === 'short' || sl === 'cap') {
      limb(K, { bone: 'sh' + L, slot, rect, J, prof: UPPER, d0: 0.0, d1: sleeveEnd, k: ak, side: s, off, v: vU, group: g, hemBot: true, capTop: true });
      limb(K, { bone: 'sh' + L, slot: 'skin', rect: armSkin, J, prof: UPPER, d0: sleeveEnd - 0.04, d1: 0.43, k: ak * 0.985, side: s, own: [sleeveEnd, 0.39], v: vU, group: g });
    } else {
      limb(K, { bone: 'sh' + L, slot, rect, J, prof: UPPER, d0: 0.0, d1: 0.43, k: ak, side: s, off, own: [-1, 0.39], v: vU, group: g, capTop: true });
    }
    // elbow filler (in the forearm bone, centred on the joint)
    const elR = 0.058 * ak + (sl === 'long' || sl === 'rolled' ? off : 0);
    const elb = ellipsoid(elR, elR * 1.05, elR * 1.05, 10, 8); move(elb, E[0], E[1], E[2]); uvSet(elb, 0.5, 0.5);
    K.add('el' + L, sl === 'long' || sl === 'rolled' ? slot : 'skin', elb, { rect: sl === 'long' || sl === 'rolled' ? rect : armSkin, group: g + 'f', aoK: 0.6 });
    // forearm
    const gaunt = (spec.acc || []).some((x) => x.kind === 'gauntlets');
    if (sl === 'long' && gaunt) {
      limb(K, { bone: 'el' + L, slot, rect, J: E, prof: FORE, d0: -0.05, d1: 0.14, k: ak, side: s, off, own: [0.0, 9], v: vF, group: g + 'f' });
    } else if (sl === 'long') {
      limb(K, { bone: 'el' + L, slot, rect, J: E, prof: FORE, d0: -0.05, d1: 0.36, k: ak, side: s, off, own: [0.0, 9], v: vF, group: g + 'f', hemBot: true, scale: (d) => 1 + 0.18 * sstep(0.22, 0.34, d) * (top.cuffFlare ?? 0.6) });
      limb(K, { bone: 'el' + L, slot: 'skin', rect: armSkin, J: E, prof: FORE, d0: 0.3, d1: 0.4, k: ak * 0.97, side: s, v: vF, group: g + 'f', aoK: 0.4 });
    } else if (sl === 'rolled') {
      limb(K, { bone: 'el' + L, slot, rect, J: E, prof: FORE, d0: -0.05, d1: sleeveEnd, k: ak, side: s, off, own: [0.0, 9], v: vF, group: g + 'f', roll: 0.014 });
      limb(K, { bone: 'el' + L, slot: 'skin', rect: armSkin, J: E, prof: FORE, d0: sleeveEnd - 0.03, d1: 0.4, k: ak * 0.985, side: s, own: [sleeveEnd, 9], v: vF, group: g + 'f' });
    } else {
      limb(K, { bone: 'el' + L, slot: 'skin', rect: armSkin, J: E, prof: FORE, d0: -0.05, d1: 0.4, k: ak, side: s, own: [0.0, 9], v: vF, group: g + 'f' });
    }
  }
}

// ----------------------------------------------------------------------------- legs
function buildLegs(c) {
  const { spec, B, K, BP, UN, SK, lk } = c, legs = spec.legs || {};
  const rect = UN.uv(legs.swatch || 'legJeans');
  const bare = legs.bare; // shorts / skirt: lower legs bare (skin) below `bare` distance on the shin (or thigh)
  const legSkin = SK.uv(spec.legSkin || 'armPlain');
  const cuffOver = legs.cuff === 'over'; // trousers over the boot shaft (flared) vs tucked in
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R', g = 'leg' + L, J = BP['hip' + L], Kj = BP['kn' + L];
    const vT = (d) => clamp(1 - (d + 0.13) / 1.0, 0, 1), vS = (d) => clamp(1 - (d + 0.46 + 0.13) / 1.0, 0, 1);
    const off = legs.off ?? 0.006, k = lk * (legs.k ?? 1);
    // hip ball (fills the pelvis/thigh junction through the range of motion)
    const hb = ellipsoid(0.104 * k + off, 0.11 * k, 0.116 * k + off, 12, 8); move(hb, J[0] - s * 0.006, J[1] + 0.01, J[2]); uvSet(hb, 0.5, 0.97);
    K.add('hip' + L, 'under', hb, { rect, group: g, aoK: 0.5 });
    const thighEnd = bare && bare.on === 'thigh' ? bare.d : 0.5;
    limb(K, { bone: 'hip' + L, slot: 'under', rect, J, prof: THIGH, d0: -0.13, d1: thighEnd, k, side: s, off, own: [-0.1, 0.455], v: vT, group: g, seg: 14, hemBot: !!(bare && bare.on === 'thigh'), f: legs.thighF });
    if (bare && bare.on === 'thigh') limb(K, { bone: 'hip' + L, slot: 'skin', rect: legSkin, J, prof: THIGH, d0: thighEnd - 0.04, d1: 0.5, k: k * 0.97, side: s, own: [thighEnd, 0.455], v: vT, group: g, seg: 12 });
    // knee filler
    const kr = 0.078 * k + (bare ? 0 : off);
    const kb = ellipsoid(kr, kr, kr * 1.06, 10, 8); move(kb, Kj[0], Kj[1], Kj[2] + 0.004); uvSet(kb, 0.5, 0.55);
    K.add('kn' + L, bare ? 'skin' : 'under', kb, { rect: bare ? legSkin : rect, group: g + 's', aoK: 0.6 });
    // shin
    const shinBot = legs.cuff === 'over' ? 0.39 : 0.36;
    if (bare) {
      limb(K, { bone: 'kn' + L, slot: 'skin', rect: legSkin, J: Kj, prof: SHIN, d0: -0.05, d1: 0.4, k: k * 0.97, side: s, own: [0.0, 9], v: vS, group: g + 's', seg: 12 });
    } else {
      limb(K, { bone: 'kn' + L, slot: 'under', rect, J: Kj, prof: SHIN, d0: -0.05, d1: shinBot, k, side: s, off, own: [0.0, 9], v: vS, group: g + 's', seg: 14, hemBot: cuffOver, scale: cuffOver ? (d) => 1 + 0.32 * sstep(0.18, 0.38, d) : (d) => 1 + 0.08 * sstep(0.25, 0.36, d) });
    }
    // skirt panels ride on the thighs (front/back halves) so they never get pierced by the legs
    if (legs.skirt) {
      const sk = legs.skirt, srect = UN.uv(sk.swatch || 'skirtPlain');
      for (const [a0, a1] of [[-Math.PI * 0.62, Math.PI * 0.62], [Math.PI * 0.38, Math.PI * 1.62]]) {
        const rings = [];
        for (const d of [-0.1, 0.0, 0.1, 0.2, sk.len ?? 0.28]) {
          const [rx, rz] = table(THIGH, Math.max(0, d)); const fl = 1 + (sk.flare ?? 0.35) * sstep(-0.05, sk.len ?? 0.28, d);
          // centred towards the midline and wide on the inner side so the two halves read as one skirt
          rings.push({ c: [J[0] - s * 0.055, J[1] - d, J[2]], rx: (rx * k + 0.07) * fl, rz: (rz * k + 0.035) * fl, v: 1 - (d + 0.1) / ((sk.len ?? 0.28) + 0.1), f: (t) => 1 + 0.12 * Math.max(0, -Math.sin(t) * s) });
        }
        const P = loft(rings.reverse(), { seg: 10, a0, a1 });
        K.add('hip' + L, 'under', P, { rect: srect, flipU: s < 0, group: g, aoK: 0.5 });
      }
    }
  }
  // skirt waist (on the hips bone, covers the top of the thigh panels)
  if (legs.skirt) {
    const srect = UN.uv(legs.skirt.swatch || 'skirtPlain');
    torsoLayer(K, B, { slot: 'under', rect: srect, off: 0.035, y0: 0.84, y1: 1.12, seg: 22, vRange: [0.6, 1.12], group: 'torso', hemBot: true, hang: true, scale: (y) => 1 + 0.14 * sstep(1.05, 0.84, y) });
  }
}

// ----------------------------------------------------------------------------- head & neck
function buildHeadAndNeck(c) {
  const { spec, B, K, BP, SK, AR, UN } = c;
  const H = { ...HEAD, ...(spec.head || {}), nose: { ...HEAD.nose, ...(spec.head?.nose || {}) } };
  c.H = H;
  const hp = BP.head, face = SK.uv(spec.face || 'faceA');
  const toRig = (P) => move(P, hp[0], hp[1], hp[2]);
  const hidden = spec.hat && HAT[spec.hat.kind]?.hidesFace;
  // neck (uv: bottom band of the face cell)
  const nk = B.neckK ?? 1;
  const nrings = [[1.8, 0.1, 0.09, -0.02], [1.865, 0.078, 0.078, -0.016], [1.925, 0.068, 0.072, -0.01], [1.99, 0.066, 0.07, -0.008], [2.04, 0.064, 0.066, -0.012], [2.09, 0.054, 0.054, -0.016]]
    .map(([y, rx, rz, cz]) => ({ c: [0, y, cz], rx: rx * nk, rz: rz * nk, v: clamp((y - 1.79) / 0.3, 0, 1) * 0.075, f: B.fem ? null : (t) => 1 + 0.12 * gauss((y - 1.98) / 0.03) * gauss(Math.atan2(Math.sin(t), Math.cos(t)) / 0.35) }));
  const neckP = loft(nrings, { seg: 16, a0: -Math.PI, a1: Math.PI });
  K.add('neck', 'skin', neckP, { rect: face, group: 'neck', aoK: 1 });
  if (!hidden) {
    const cov = spec.hat && HAT[spec.hat.kind]?.covers, mcov = spec.mask && MASK[spec.mask.kind]?.covers;
    const covered = cov || mcov ? (th, ph) => (cov && cov(th, ph, spec.hat)) || (mcov && mcov(th, ph)) : null;
    const head = headPiece(H, { covered }); toRig(head); K.add('head', 'skin', head, { rect: face, group: 'head', aoK: 0.8 });
    if (!(spec.mask && MASK[spec.mask.kind]?.hidesNose)) { const nose = nosePiece(H); toRig(nose); K.add('head', 'skin', nose, { rect: face, group: 'head', aoK: 0 }); }
    const mk = spec.mask && MASK[spec.mask.kind];
    const earsHidden = (spec.hat && HAT[spec.hat.kind]?.hidesEars) || (spec.hair && ['long', 'afro', 'dreads'].includes(spec.hair.kind)) || mk?.hidesEars;
    if (!earsHidden) for (const s of [1, -1]) { const e = earPiece(H, s); toRig(e); K.add('head', 'skin', e, { rect: face, group: 'head', aoK: 0 }); }
    // eye patches: hi-res painted eyes on a skin-tight patch
    const er = SK.uv(spec.eyes || 'eyeA');
    for (const s of [1, -1]) {
      const P = headShell(H, { cols: 8, rows: 6, ph0: s * H.eyePh - 0.24, ph1: s * H.eyePh + 0.24, th0: thOfY(H.eyeY + 0.1), thMax: () => thOfY(H.eyeY - 0.11), off: (th, ph, k) => 0.0005 + 0.0014 * Math.sin(Math.PI * k) * Math.sin(Math.PI * (ph - (s * H.eyePh - 0.24)) / 0.48), kPow: 1, uv: (th, ph, k, u) => [u, 1 - k], analytic: true });
      toRig(P);
      K.add('head', 'skin', P, { rect: er, flipU: s < 0, group: 'head', aoK: 0 });
    }
  }
  // hair / hat / mask / eyewear
  if (spec.hair && HAIR[spec.hair.kind]) HAIR[spec.hair.kind](c, spec.hair, toRig);
  if (spec.beard && BEARD[spec.beard.kind]) BEARD[spec.beard.kind](c, spec.beard, toRig);
  if (spec.hat && HAT[spec.hat.kind]) HAT[spec.hat.kind](c, spec.hat, toRig);
  if (spec.mask && MASK[spec.mask.kind]) MASK[spec.mask.kind](c, spec.mask, toRig);
  if (spec.eyewear && EYEWEAR[spec.eyewear.kind]) EYEWEAR[spec.eyewear.kind](c, spec.eyewear, toRig);
  if (spec.glowEyes) {
    for (const s of [1, -1]) {
      const p = headOut(H, thOfY(H.eyeY - 0.005), s * (H.eyePh + 0.01), 0.002);
      const g = ellipsoid(0.0115, 0.0105, 0.005, 7, 5); move(g, p[0], p[1], p[2] + 0.0025); toRig(g); uvSet(g, 0.5, 0.5);
      K.add('head', 'glow', g, { rect: SK.uv('hand'), group: 'head', aoK: 0 });
    }
  }
}
// hairline: front/side/back limits as theta per phi
const hairline = (front = 0.95, side = 1.45, back = 2.05) => (ph) => {
  const a = Math.abs(ph) / Math.PI; // 0 front .. 1 back
  return a < 0.5 ? front + (side - front) * sstep(0.05, 0.5, a) : side + (back - side) * sstep(0.5, 0.95, a);
};
const HAIR = {
  // close crop / buzz: thin shell, mostly a silhouette bump (paint carries the look)
  buzz(c, h, toRig) {
    const { H, K, SK, spec } = c, face = SK.uv(spec.face);
    if (spec.hat && spec.hat.kind !== 'bandana') return; // the cap / beanie covers the silhouette; paint carries the rest
    const P = headShell(H, { cols: 22, rows: 5, thMax: hairline(h.front ?? 0.98, h.side ?? 1.5, h.back ?? 2.1), off: (th, ph, k) => (h.t ?? 0.006) * sstep(1, 0.75, k), kPow: 0.8 });
    toRig(P); K.add('head', 'skin', P, { rect: face, group: 'head', aoK: 0.3 });
  },
  // full cap of hair with volume (slick back / side part / short crop)
  cap(c, h, toRig) {
    const { H, K, SK, spec } = c, face = SK.uv(spec.face);
    const vol = h.vol ?? 0.022;
    const P = headShell(H, {
      cols: 30, rows: 9, thMax: hairline(h.front ?? 0.92, h.side ?? 1.42, h.back ?? 2.12), kPow: 0.85,
      off: (th, ph, k) => {
        const top = 1 + (h.top ?? 0.4) * Math.cos(th) * 0.8 + (h.quiff ?? 0) * gauss((th - 0.55) / 0.25) * gauss(ph / 0.6) + (h.back2 ?? 0) * gauss((th - 1.6) / 0.4) * Math.max(0, -Math.cos(ph));
        return vol * top * sstep(1, 0.72, k) + 0.002;
      },
      warp: h.slick ? (p, th, ph) => { p[2] -= 0.006 * Math.max(0, Math.cos(th)); } : null,
    });
    toRig(P); K.add('head', 'skin', P, { rect: face, group: 'head', aoK: 0.5 });
  },
  // mohawk: shaved sides (paint) + a spiky fin along the midline
  mohawk(c, h, toRig) {
    const { H, K, SK } = c, rect = SK.uv('hairSpiky');
    const n = 16, pts = [], rings = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, th = 0.35 + t * 2.0; // forehead -> nape along the midline
      const ph = th < Math.PI / 2 ? 0 : Math.PI; const thh = th < Math.PI / 2 ? Math.PI / 2 - th + 0.02 : th - Math.PI / 2;
      void ph; void thh;
      const sth = 0.55 + t * 1.75; // theta along front->top->back via signed angle
      const ang = -0.95 + t * 2.75; // angle in the sagittal plane from the front-top (0 = straight up)
      const dz = Math.sin(-ang), dy = Math.cos(ang);
      void sth;
      // point on the scalp in the sagittal plane
      let lo = 0, hi = 0.4; for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; const p = [0, H.cy + dy * m, H.cz + dz * m]; const th2 = Math.acos(clamp(dy, -1, 1)); const sp = headPoint(H, th2, dz >= 0 ? 0 : Math.PI); const rr = Math.hypot(sp[1] - H.cy, sp[2] - H.cz); if (m < rr) lo = m; else hi = m; void p; }
      const R = lo;
      const height = (h.height ?? 0.09) * Math.sin(Math.PI * clamp(t * 1.05, 0, 1)) * (0.75 + 0.25 * Math.abs(Math.sin(i * 1.7)));
      pts.push({ base: [0, H.cy + dy * (R - 0.004), H.cz + dz * (R - 0.004)], dir: [0, dy, dz], height });
    }
    // fin as a loft of thin diamond rings along the base path; spikes via height modulation
    for (let i = 0; i <= n; i++) {
      const p = pts[i], spike = 1 + (h.spikes ?? 0.75) * (i % 2 ? -0.42 : 0.42);
      const hh = Math.max(0.006, p.height * spike);
      rings.push({ c: [0, p.base[1] + p.dir[1] * hh * 0.5, p.base[2] + p.dir[2] * hh * 0.5], rx: (h.w ?? 0.034) * (1 - 0.35 * (hh / 0.12)), rz: hh * 0.5, ux: [1, 0, 0], uz: p.dir, e: 1.5, v: i / n });
    }
    const P = loft(rings, { seg: 8, capTop: true, capBot: true });
    toRig(P); K.add('head', 'skin', P, { rect, group: 'head', aoK: 0.4 });
  },
  // spiky wild hair (junkie): cap + many cone spikes
  spiky(c, h, toRig) {
    HAIR.cap(c, { ...h, vol: h.vol ?? 0.018, top: 0.3 }, toRig);
    const { H, K, SK } = c, rect = SK.uv('hairSpiky'), rng = mulberry(h.seed ?? 7);
    const parts = [];
    const n = h.count ?? 18;
    for (let i = 0; i < n; i++) {
      const th = 0.25 + rng() * 1.35, ph = (rng() * 2 - 1) * Math.PI * (th < 0.9 ? 1 : 0.85);
      if (th > hairline(0.95, 1.4, 2.0)(ph) - 0.1) continue;
      const base = headOut(H, th, ph, 0.012), dir = norm3([base[0], base[1] - H.cy + 0.03, base[2] - H.cz - 0.01]);
      const L = (h.len ?? 0.07) * (0.6 + 0.6 * rng()), r = 0.014 + 0.008 * rng();
      const tip = [base[0] + dir[0] * L + (rng() - 0.5) * 0.02, base[1] + dir[1] * L, base[2] + dir[2] * L + (rng() - 0.5) * 0.02];
      parts.push(tube([base, [lerp(base[0], tip[0], 0.5), lerp(base[1], tip[1], 0.5), lerp(base[2], tip[2], 0.5)], tip], (t) => r * (1 - t * 0.92), { seg: 5, cap: true }));
    }
    const P = concat(...parts); toRig(P); K.add('head', 'skin', P, { rect, group: 'head', aoK: 0.4 });
  },
  afro(c, h, toRig) {
    const { H, K, SK } = c, rect = SK.uv('hairCurly');
    const P = headShell(H, { cols: 28, rows: 10, thMax: hairline(0.98, 1.45, 2.15), kPow: 0.75, off: (th, ph, k) => (h.vol ?? 0.06) * (0.75 + 0.35 * Math.cos(th * 0.7)) * sstep(1, 0.62, k) + 0.003 + 0.006 * Math.sin(th * 17) * Math.sin(ph * 13) * sstep(1, 0.6, k), uv: (th, ph, k, u) => [u * 3 % 1, k] });
    toRig(P); K.add('head', 'skin', P, { rect, group: 'head', aoK: 0.4 });
  },
  // long hair: cap + a curtain falling behind the shoulders (rides on the head bone)
  long(c, h, toRig) {
    const { H, K, SK, spec } = c, face = SK.uv(spec.face), rect = SK.uv('hairStraight');
    const len = h.len ?? 0.22, front = h.front ?? 0.86, req = Math.max(H.rx, H.rz);
    // face opening -> hairline; behind the ears the shell keeps going down (k parametrises scalp -> hair ends)
    const thM = (ph) => { const a = Math.abs(ph); const hl = hairline(front, 1.38, 2.1)(ph); return a < 1.15 ? hl : hl + (2.95 - hl) * sstep(1.15, 2.05, a); };
    const below = (th) => Math.max(0, th - 1.62);
    const warp = (p, th, ph, k) => {
      const b = below(th); if (b <= 0) return;
      const t = b / (2.95 - 1.62); // 0 at the widest point .. 1 at the ends
      const ang = Math.atan2(p[0], p[2] - H.cz), r = Math.hypot(p[0], p[2] - H.cz);
      const R = Math.max(r, (req + 0.02) * (Math.abs(Math.sin(ang)) * H.rx / req + Math.abs(Math.cos(ang)) * H.rz / req) * (1 + 0.1 * t));
      p[0] = Math.sin(ang) * R; p[2] = H.cz + Math.cos(ang) * R - 0.02 * t;
      p[1] = H.cy - 0.02 - t * len + 0.012 * Math.sin(ang * 7);
    };
    const off = (th, ph, k) => { const hang = sstep(1.5, 1.85, thM(ph)); return (h.vol ?? 0.022) * (1 + 0.35 * Math.cos(th)) * lerp(sstep(1, 0.85, k), 1, hang) + 0.002; };
    const P = headShell(H, { cols: 32, rows: 14, thMax: thM, kPow: 0.9, off, warp, uv: (th, ph, k, u) => [u * 2 % 1, 1 - k] });
    toRig(P); K.add('head', 'skin', P, { rect, group: 'head', aoK: 0.4 });
    // inside of the hanging part (seen from below / the sides)
    const Q = headShell(H, { cols: 32, rows: 6, th0: 1.7, thMax: (ph) => Math.max(1.71, thM(ph)), kPow: 1, off: (th, ph, k) => off(th, ph, k) - 0.008, warp, uv: (th, ph, k, u) => [u * 2 % 1, 1 - k] });
    flipWinding(Q); for (let i = 0; i < Q.n.length; i++) Q.n[i] = -Q.n[i]; aoMul(Q, () => 0.4); toRig(Q);
    K.add('head', 'skin', Q, { rect, group: 'head', aoK: 0 });
    void face;
  },
  pony(c, h, toRig) {
    HAIR.cap(c, { ...h, vol: 0.014, top: 0.2, slick: true }, toRig);
    const { H, K, SK } = c, rect = SK.uv('hairStraight');
    const b = headOut(H, 1.75, Math.PI, 0.01);
    const pts = [b, [0, b[1] - 0.04, b[2] - 0.04], [0, b[1] - 0.12, b[2] - 0.05], [0, b[1] - 0.2, b[2] - 0.035]];
    const P = tube(pts, (t) => 0.026 * (1 - t * 0.6) * (1 + 0.3 * Math.sin(t * Math.PI)), { seg: 7 });
    toRig(P); K.add('head', 'skin', P, { rect, group: 'head', aoK: 0.3 });
  },
  bun(c, h, toRig) {
    HAIR.cap(c, { ...h, vol: 0.014, top: 0.25, slick: true }, toRig);
    const { H, K, SK } = c, rect = SK.uv('hairCurly');
    const b = headOut(H, 0.75, Math.PI, 0.03);
    const P = ellipsoid(0.045, 0.04, 0.042, 10, 7); move(P, b[0], b[1], b[2]); toRig(P); K.add('head', 'skin', P, { rect, group: 'head', aoK: 0.3 });
  },
  dreads(c, h, toRig) {
    HAIR.cap(c, { ...h, vol: 0.02 }, toRig);
    const { H, K, SK } = c, rect = SK.uv('hairDreads'), rng = mulberry(h.seed ?? 3), parts = [];
    for (let i = 0; i < 14; i++) {
      const ph = Math.PI * (0.45 + 1.1 * (i / 13)), th = 1.3 + rng() * 0.5, b = headOut(H, th, ph * (i % 2 ? 1 : -1) * 0 + ph, 0.012);
      const L = 0.12 + rng() * 0.1, dx = b[0] * 0.3, dz = (b[2] - H.cz) * 0.25;
      parts.push(tube([b, [b[0] + dx * 0.5, b[1] - L * 0.5, b[2] + dz * 0.5], [b[0] + dx, b[1] - L, b[2] + dz]], 0.011, { seg: 5 }));
    }
    const P = concat(...parts); toRig(P); K.add('head', 'skin', P, { rect, group: 'head', aoK: 0.3 });
  },
  bald() {},
};
const BEARD = {
  full(c, b, toRig) {
    const { H, K, SK, spec } = c, face = SK.uv(spec.face);
    // beard line: high at the sideburns, dipping over the cheeks; the shell shares the head's normals so its
    // tucked edge melts into the skin (the painted stubble/beard on the face texture carries the colour)
    const line = (ph) => { const a = Math.abs(ph); return -0.36 + 0.3 * sstep(0.55, 1.45, a); };
    const P = headShell(H, { cols: 22, rows: 8, ph0: -1.75, ph1: 1.75, th0: thOfY(0.02), thMax: () => thOfY(-0.98), kPow: 1, analytic: true,
      off: (th, ph, k) => { const Y = Math.cos(th); const edge = sstep(0, 0.25, Math.abs(ph) < 1.6 ? 1 - Math.abs(ph) / 1.75 : 0) * sstep(line(ph), line(ph) - 0.14, Y); const mouth = 1 - 0.9 * gauss((Y + 0.47) / 0.07) * gauss(ph / 0.42); return (b.t ?? 0.012) * edge * mouth * (1 + 0.5 * sstep(-0.6, -0.95, Y)); } });
    toRig(P); K.add('head', 'skin', P, { rect: face, group: 'head', aoK: 0.4 });
  },
};
const mulberry = (seed) => { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// headgear.  Each returns pieces on the head bone; `hidesFace` skips the face mesh entirely.
const HAT = {
  beanie: Object.assign((c, h, toRig) => {
    const { H, K, AR, UN } = c, atlas = h.atlas === 'under' ? UN : AR, rect = atlas.uv(h.swatch || 'beanie'), slot = h.atlas === 'under' ? 'under' : 'armor';
    const thM = hairline(1.0, 1.5, 1.95);
    const P = headShell(H, { cols: 26, rows: 8, thMax: (ph) => thM(ph) + 0.05, kPow: 0.9, off: (th, ph, k) => 0.016 + 0.022 * Math.cos(th) * (h.slouch ?? 0.6) + 0.006 * sstep(0.82, 0.92, k), uv: (th, ph, k, u) => [u, 1 - k] });
    // fold: last rows bulge
    toRig(P); K.add('head', slot, P, { rect, group: 'head', aoK: 0.4 });
    const F = headShell(H, { cols: 26, rows: 3, th0: 0, thMax: (ph) => thM(ph) + 0.05, kPow: 1, off: () => 0.036, uv: (th, ph, k, u) => [u, 0.12 * (1 - k)] });
    // keep only a band: re-sample a ring band near the bottom
    const band = headShell(H, { cols: 26, rows: 3, th0: 0, thMax: (ph) => thM(ph) + 0.05, kPow: 1, off: (th, ph, k) => 0.02 + 0.016 * Math.sin(Math.PI * k), warp: (p, th, ph, k) => { void k; }, uv: (th, ph, k, u) => [u, 0.15 * k] });
    void F; void band;
    const rings = [];
    for (const [dt, o] of [[-0.16, 0.02], [-0.11, 0.029], [-0.02, 0.029], [0.025, 0.016]]) rings.push({ dt, o });
    const B2 = piece(); void B2;
    const R = [];
    for (let i = 0; i < rings.length; i++) {
      const row = []; R.push(row);
      for (let j = 0; j <= 26; j++) { const ph = -Math.PI + TAU * j / 26; const th = thM(ph) + 0.05 + rings[i].dt; row.push(headOut(H, th, ph, rings[i].o)); }
    }
    const Q = gridPiece(R, (i, j) => [j / 26, 0.18 * (i / (R.length - 1))]);
    toRig(Q); K.add('head', slot, Q, { rect, group: 'head', aoK: 0.3 });
  }, { hidesEars: false, covers: (th, ph) => th < hairline(1.0, 1.5, 1.95)(ph) - 0.1 }),
  cap: Object.assign((c, h, toRig) => {
    const { H, K, AR, UN } = c, atlas = h.atlas === 'under' ? UN : AR, rect = atlas.uv(h.swatch || 'cap'), slot = h.atlas === 'under' ? 'under' : 'armor';
    const rev = h.backwards ? Math.PI : 0;
    const thM = (ph) => 1.18 + 0.12 * Math.abs(Math.sin(ph)) + 0.28 * sstep(0.55, 1, Math.abs(ph) / Math.PI);
    const P = headShell(H, { cols: 28, rows: 7, thMax: thM, kPow: 0.9, off: (th, ph, k) => 0.012 + 0.008 * Math.cos(th) + 0.004 * sstep(0.85, 1, k), uv: (th, ph, k, u) => [u, 0.35 + 0.65 * (1 - k)] });
    if (rev) for (let i = 0; i < P.p.length; i += 3) { P.p[i] = -P.p[i]; P.p[i + 2] = 2 * H.cz - P.p[i + 2]; P.n[i] = -P.n[i]; P.n[i + 2] = -P.n[i + 2]; }
    toRig(P); K.add('head', slot, P, { rect, group: 'head', aoK: 0.3 });
    // brim: curved bill with real thickness (top, underside, rounded edge)
    const nb = 12, nl = 4, th0 = thM(0) - 0.03, L0 = h.brim ?? 0.095;
    const top = [], bot = [];
    for (let i = 0; i <= nb; i++) {
      const ps = -0.98 + 1.96 * i / nb, rowT = [], rowB = [];
      const a = headOut(H, th0 + 0.06 * Math.abs(ps), ps, 0.017), L = L0 * (0.06 + 0.94 * Math.pow(Math.max(0, Math.cos(ps * 1.45)), 0.6));
      for (let j = 0; j <= nl; j++) {
        const t = j / nl, d = L * t;
        const x = a[0] + Math.sin(ps) * d * 0.55, z = a[2] + Math.cos(ps) * d * 0.98, y = a[1] - d * 0.2 - 0.03 * Math.pow(Math.abs(ps), 2) * t - 0.006 * t * t;
        rowT.push([x, y, z]); rowB.push([x, y - 0.0075 * (1 - 0.4 * t), z]);
      }
      top.push(rowT); bot.push(rowB);
    }
    const mk = (G, flip, vOff) => { const Q = gridPiece(G, (i, j) => [i / nb * 0.5 + (flip ? 0.5 : 0), vOff + 0.3 * (j / nl)]); if (flip) { flipWinding(Q); for (let k = 0; k < Q.n.length; k++) Q.n[k] = -Q.n[k]; aoMul(Q, () => 0.55); } return Q; };
    const T = mk(top, false, 0), Bo = mk(bot, true, 0);
    // fix orientation: the top must face up
    let up = 0; for (let k = 1; k < T.n.length; k += 3) up += T.n[k]; if (up < 0) { flipWinding(T); for (let k = 0; k < T.n.length; k++) T.n[k] = -T.n[k]; flipWinding(Bo); for (let k = 0; k < Bo.n.length; k++) Bo.n[k] = -Bo.n[k]; }
    const edge = piece();
    for (let i = 0; i <= nb; i++) { const a = top[i][nl], b = bot[i][nl]; edge.p.push(...a, ...b); edge.uv.push(0.25, 0.3, 0.25, 0.3); edge.a.push(0.9, 0.7); }
    for (let i = 0; i < nb; i++) { const a = i * 2, b = a + 1, c2 = a + 2, d = a + 3; edge.ix.push(a, b, d, a, d, c2); }
    computeNormals(edge, false); fixOutward(edge, [0, H.cy, H.cz]);
    const brimP = concat(T, Bo, edge);
    if (rev) for (let i = 0; i < brimP.p.length; i += 3) { brimP.p[i] = -brimP.p[i]; brimP.p[i + 2] = 2 * H.cz - brimP.p[i + 2]; brimP.n[i] = -brimP.n[i]; brimP.n[i + 2] = -brimP.n[i + 2]; }
    toRig(brimP);
    K.add('head', slot, brimP, { rect, group: 'head', aoK: 0 });
  }, { hidesEars: false, covers: (th, ph, h) => { const p2 = h.backwards ? (ph > 0 ? Math.PI - ph : -Math.PI - ph) : ph; return th < 1.18 + 0.12 * Math.abs(Math.sin(p2)) + 0.28 * sstep(0.55, 1, Math.abs(p2) / Math.PI) - 0.12; } }),
  hood: Object.assign((c, h, toRig) => {
    const { H, K, AR } = c, rect = AR.uv(h.swatch);
    const P = headShell(H, { cols: 26, rows: 10, ph0: 0.62, ph1: TAU - 0.62, th0: 0, thMax: (ph) => 2.35, kPow: 1,
      off: (th, ph, k) => 0.045 + 0.02 * Math.cos(th) + 0.03 * sstep(1.6, 2.3, th),
      warp: (p, th, ph, k) => { if (th > 1.7) { const t = sstep(1.7, 2.35, th); p[1] -= t * 0.05; p[2] -= t * 0.03 * Math.max(0, -Math.cos(ph)); } p[2] += 0.012 * Math.max(0, Math.cos(th)); },
      uv: (th, ph, k, u) => [u, 1 - k] });
    toRig(P); K.add('head', 'armor', P, { rect, group: 'head', aoK: 0.5 });
    // inner lining around the face opening
    const Q = headShell(H, { cols: 26, rows: 3, ph0: 0.62, ph1: TAU - 0.62, th0: 0, thMax: () => 2.35, off: (th) => 0.03 + 0.02 * Math.cos(th), uv: (th, ph, k, u) => [u, 0.02] });
    flipWinding(Q); for (let i = 0; i < Q.n.length; i++) Q.n[i] = -Q.n[i]; aoMul(Q, () => 0.35); toRig(Q); K.add('head', 'armor', Q, { rect, group: 'head', aoK: 0 });
  }, { hidesEars: true, covers: (th, ph) => Math.abs(ph) > 0.95 || th < 0.75 }),
  bandana: Object.assign((c, h, toRig) => {
    const { H, K, AR } = c, rect = AR.uv(h.swatch || 'bandana');
    const P = headShell(H, { cols: 28, rows: 7, thMax: (ph) => 1.22 + 0.25 * sstep(0.4, 1, Math.abs(ph) / Math.PI), kPow: 0.9, off: () => 0.009, uv: (th, ph, k, u) => [u, 1 - k] });
    toRig(P); K.add('head', 'armor', P, { rect, group: 'head', aoK: 0.3 });
    // knot + tails at the back
    const kb = headOut(H, 1.5, Math.PI, 0.012);
    const knot = ellipsoid(0.02, 0.017, 0.016, 7, 5); move(knot, kb[0], kb[1], kb[2]);
    const t1 = tube([kb, [kb[0] + 0.02, kb[1] - 0.05, kb[2] - 0.03], [kb[0] + 0.03, kb[1] - 0.1, kb[2] - 0.04]], [0.016, 0.004], { seg: 4 });
    const t2 = tube([kb, [kb[0] - 0.015, kb[1] - 0.045, kb[2] - 0.035], [kb[0] - 0.02, kb[1] - 0.085, kb[2] - 0.05]], [0.014, 0.004], { seg: 4 });
    const Q = concat(knot, t1, t2); uvSet(Q, 0.3, 0.5); toRig(Q); K.add('head', 'armor', Q, { rect, group: 'head', aoK: 0 });
  }, { hidesEars: false }),
  // full-face motorbike helmet with a visor (face not built)
  helmetFull: Object.assign((c, h, toRig) => {
    const { H, K, AR } = c, rect = AR.uv(h.swatch || 'helmet');
    const P = headShell(H, { cols: 30, rows: 14, th0: 0, thMax: () => 2.62, kPow: 1,
      off: (th, ph) => 0.04 + 0.012 * Math.cos(th) + 0.012 * Math.max(0, Math.cos(ph)) * sstep(1.6, 2.3, th),
      warp: (p, th, ph) => { if (th > 2.1) { p[1] = Math.max(p[1], H.cy - H.ry - 0.035); } p[2] += 0.012 * Math.max(0, Math.cos(ph)) * sstep(1.5, 2.4, th); },
      uv: (th, ph, k, u) => [u, 1 - k] });
    toRig(P); K.add('head', 'armor', P, { rect, group: 'head', aoK: 0.4 });
    // visor: a curved glossy band across the eyes (atlas region 'helmetVisor' is painted glossy)
    const vr = AR.uv(h.visor || 'visor');
    const V = headShell(H, { cols: 14, rows: 3, ph0: -1.2, ph1: 1.2, th0: thOfY(0.3), thMax: () => thOfY(-0.22), off: (th, ph) => 0.048 + 0.012 * Math.cos(th) + 0.003, uv: (th, ph, k, u) => [u, 1 - k] });
    toRig(V); K.add('head', 'armor', V, { rect: vr, group: 'head', aoK: 0 });
    // underside ring (neck opening)
    const rings = [];
    for (const [dy, r] of [[0, 0.0], [-0.012, -0.01], [0.02, -0.03]]) rings.push({ c: [0, H.cy - H.ry - 0.03 + dy, H.cz + 0.01], rx: H.rx + 0.03 + r, rz: H.rz + 0.04 + r });
    const U = loft(rings, { seg: 20, inside: true }); aoMul(U, () => 0.4); uvSet(U, 0.05, 0.05); toRig(U); K.add('head', 'armor', U, { rect, group: 'head', aoK: 0 });
  }, { hidesFace: true }),
  // riot helmet: dome + clear-ish face shield (dark) + neck guard; face visible behind the shield
  helmetRiot: Object.assign((c, h, toRig) => {
    const { H, K, AR } = c, rect = AR.uv(h.swatch || 'helmetRiot');
    const P = headShell(H, { cols: 30, rows: 10, th0: 0, thMax: (ph) => 1.62 + 0.75 * sstep(0.45, 0.9, Math.abs(ph) / Math.PI), kPow: 1,
      off: (th, ph) => 0.038 + 0.01 * Math.cos(th), uv: (th, ph, k, u) => [u, 1 - k] });
    toRig(P); K.add('head', 'armor', P, { rect, group: 'head', aoK: 0.4 });
    // brow ridge band
    const rings = []; void rings;
    const band = headShell(H, { cols: 30, rows: 2, th0: 1.35, thMax: (ph) => 1.62 + 0.75 * sstep(0.45, 0.9, Math.abs(ph) / Math.PI), off: () => 0.05, uv: (th, ph, k, u) => [u, 0.1 + 0.1 * k] });
    toRig(band); K.add('head', 'armor', band, { rect, group: 'head', aoK: 0.2 });
    // face shield (visor): from the brow down past the chin, glossy dark
    const vr = AR.uv(h.visor || 'visor');
    const V = headShell(H, { cols: 16, rows: 6, ph0: -1.45, ph1: 1.45, th0: 1.32, thMax: () => 2.7, off: (th, ph) => 0.055 + 0.02 * sstep(1.6, 2.6, th) + 0.01 * Math.cos(ph), uv: (th, ph, k, u) => [u, 1 - k] });
    toRig(V); K.add('head', 'armor', V, { rect: vr, group: 'head', aoK: 0 });
    const Vi = headShell(H, { cols: 16, rows: 6, ph0: -1.45, ph1: 1.45, th0: 1.32, thMax: () => 2.7, off: (th, ph) => 0.05 + 0.02 * sstep(1.6, 2.6, th) + 0.01 * Math.cos(ph), uv: (th, ph, k, u) => [u, 1 - k] });
    flipWinding(Vi); for (let i = 0; i < Vi.n.length; i++) Vi.n[i] = -Vi.n[i]; toRig(Vi); K.add('head', 'armor', Vi, { rect: vr, group: 'head', aoK: 0 });
  }, { hidesEars: true, covers: (th, ph) => th < 1.62 + 0.75 * sstep(0.45, 0.9, Math.abs(ph) / Math.PI) - 0.1 }),
  fedora: Object.assign((c, h, toRig) => {
    const { H, K, AR } = c, rect = AR.uv(h.swatch || 'fedora');
    const top = H.cy + H.ry + 0.03, base = H.cy + H.ry * 0.42;
    const rings = [];
    for (const [y, rk, v] of [[base - 0.004, 1.06, 0.3], [base + 0.03, 1.03, 0.45], [top - 0.03, 0.98, 0.8], [top, 0.86, 0.92], [top + 0.006, 0.4, 1]]) rings.push({ c: [0, y, H.cz - 0.005], rx: (H.rx + 0.018) * rk, rz: (H.rz + 0.018) * rk, v, f: (t) => 1 - 0.06 * gauss(Math.atan2(Math.sin(t), Math.cos(t)) / 0.3) * (y > top - 0.01 ? 1 : 0) });
    const crown = loft(rings, { seg: 22, capTop: true, capTopBulge: -0.004 });
    toRig(crown); K.add('head', 'armor', crown, { rect, group: 'head', aoK: 0.3 });
    const br = [];
    for (const [rk, dy, v] of [[1.0, 0, 0.0], [1.55, -0.008, 0.18], [1.62, -0.014, 0.2], [1.5, -0.016, 0.22], [1.0, -0.006, 0.28]]) br.push({ c: [0, base + dy, H.cz - 0.005], rx: (H.rx + 0.02) * rk, rz: (H.rz + 0.02) * rk * 1.04, v, f: (t) => 1 + 0.05 * Math.cos(t) });
    const brim = loft(br, { seg: 26 }); toRig(brim); K.add('head', 'armor', brim, { rect, group: 'head', aoK: 0.5 });
  }, { hidesEars: false }),
};
function fixBrim(P) { computeNormals(P, false); }
function gridPiece(R, uvFn) {
  const P = piece(), rows = R.length, cols = R[0].length;
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { P.p.push(...R[i][j]); const uv = uvFn(i, j); P.uv.push(uv[0], uv[1]); P.a.push(1); }
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols - 1; j++) { const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1; P.ix.push(a, b, d, a, d, c); }
  computeNormals(P, true);
  return P;
}
const MASK = {
  // respirator / half mask over mouth & nose
  respirator(c, m, toRig) {
    const { H, K, AR } = c, rect = AR.uv(m.swatch || 'respirator');
    const P = headShell(H, { cols: 16, rows: 7, ph0: -1.5, ph1: 1.5, th0: thOfY(-0.08), thMax: () => thOfY(-0.95), kPow: 1,
      off: (th, ph) => { const Y = Math.cos(th); return 0.016 + 0.03 * gauss(ph / 0.5) * gauss((Y + 0.4) / 0.35) + 0.012 * gauss(ph / 0.9); }, uv: (th, ph, k, u) => [u, 1 - k] });
    toRig(P); K.add('head', 'armor', P, { rect, group: 'head', aoK: 0.3 });
    // filter canisters
    for (const s of [1, -1]) {
      const p = headOut(H, thOfY(-0.55), s * 0.62, 0.04);
      const cy = cylinder(0.026, 0.026, 0.03, 10); xform(cy, mat(p[0] + s * 0.012, p[1], p[2] + 0.004, Math.PI / 2, 0, 0, 1, 1, 1)); xform(cy, mat(0, 0, 0));
      // orient: face forward-outward
      const cy2 = cylinder(0.025, 0.027, 0.032, 10); xform(cy2, mat(0, 0, 0, Math.PI / 2, 0, 0)); xform(cy2, mat(p[0] + s * 0.01, p[1] - 0.004, p[2] + 0.004, 0, s * 0.75, 0));
      uvSet(cy2, 0.8, 0.5); toRig(cy2); K.add('head', 'armor', cy2, { rect: AR.uv('pouch'), group: 'head', aoK: 0 });
      void cy;
    }
    // straps around the head
    const strapP = headShell(H, { cols: 22, rows: 1, ph0: 1.3, ph1: TAU - 1.3, th0: thOfY(0.02), thMax: () => thOfY(-0.06), off: () => 0.006, uv: (th, ph, k, u) => [u, k] });
    toRig(strapP); K.add('head', 'armor', strapP, { rect: AR.uv('strap'), group: 'head', aoK: 0 });
  },
  // bandana over the lower face
  bandanaFace(c, m, toRig) {
    const { H, K, AR } = c, rect = AR.uv(m.swatch || 'bandana');
    const P = headShell(H, { cols: 22, rows: 7, ph0: -2.2, ph1: 2.2, th0: thOfY(-0.17), thMax: (ph) => thOfY(-0.98) + 0.3 * gauss(ph / 0.6), kPow: 1,
      off: (th, ph) => 0.012 + 0.016 * gauss(ph / 0.45) * sstep(-0.2, -0.5, Math.cos(th)), uv: (th, ph, k, u) => [u, 1 - k] });
    toRig(P); K.add('head', 'armor', P, { rect, group: 'head', aoK: 0.3 });
  },
  balaclava(c, m, toRig) {
    const { H, K, AR } = c, rect = AR.uv(m.swatch || 'balaclava');
    // full head sock with an eye slot
    const P = headShell(H, { cols: 30, rows: 16, th0: 0, thMax: () => 2.75, kPow: 1,
      off: (th, ph) => { const Y = Math.cos(th); const hole = gauss((Y - H.eyeY) / 0.07) * gauss(ph / 0.62); return 0.006 + 0.008 * sstep(-0.3, -0.9, Y) - 0.0058 * sstep(0.35, 0.75, hole); },
      uv: (th, ph, k, u) => [u, 1 - k] });
    // remove eye-slot triangles (where the shell dips onto the skin)
    const cols = 31; const keep = [];
    for (let t = 0; t < P.ix.length; t += 3) {
      let inHole = 0;
      for (let q = 0; q < 3; q++) { const vi = P.ix[t + q]; const i = Math.floor(vi / cols), j = vi % cols; const th = 2.75 * i / 16, ph = -Math.PI + TAU * j / 30; const Y = Math.cos(th); if (gauss((Y - H.eyeY) / 0.07) * gauss(ph / 0.62) > 0.45) inHole++; }
      if (inHole < 2) keep.push(P.ix[t], P.ix[t + 1], P.ix[t + 2]);
    }
    P.ix = keep;
    toRig(P); K.add('head', 'armor', P, { rect, group: 'head', aoK: 0.4 });
    // neck gaiter so no skin shows between mask and collar
    const nk = c.B.neckK ?? 1, rings = [];
    for (const [y, r] of [[1.82, 0.104], [1.88, 0.084], [1.95, 0.076], [2.02, 0.074], [2.08, 0.07]]) rings.push({ c: [0, y, -0.008], rx: r * nk, rz: r * nk * 1.04, v: (y - 1.82) / 0.26 * 0.3 });
    K.add('neck', 'armor', loft(rings, { seg: 16 }), { rect, group: 'neck', aoK: 0.5 });
  },
};
const EYEWEAR = {
  goggles(c, e, toRig) {
    const { H, K, AR } = c, fr = AR.uv(e.swatch || 'goggles'), lens = AR.uv(e.lens || 'visor');
    for (const s of [1, -1]) {
      const p = headOut(H, thOfY(H.eyeY + 0.01), s * (H.eyePh + 0.03), 0.012);
      const ring = cylinder(0.03, 0.032, 0.024, 12, { open: true }); xform(ring, mat(0, 0, 0, Math.PI / 2, 0, 0)); xform(ring, mat(p[0], p[1], p[2] + 0.006, 0, s * 0.42, 0));
      uvSet(ring, 0.5, 0.5); toRig(ring); K.add('head', 'armor', ring, { rect: fr, group: 'head', aoK: 0 });
      const ln = cylinder(0.027, 0.027, 0.004, 12); xform(ln, mat(0, 0, 0, Math.PI / 2, 0, 0)); xform(ln, mat(p[0] + s * 0.004, p[1], p[2] + 0.014, 0, s * 0.42, 0));
      uvSet(ln, 0.5, 0.5); toRig(ln); K.add('head', e.glow ? 'glow' : 'armor', ln, { rect: lens, group: 'head', aoK: 0 });
    }
    // bridge + strap
    const b = headOut(H, thOfY(H.eyeY + 0.02), 0, 0.012);
    const br = rbox(0.03, 0.012, 0.014, 0.004); move(br, b[0], b[1], b[2] + 0.004); uvSet(br, 0.5, 0.5); toRig(br); K.add('head', 'armor', br, { rect: fr, group: 'head', aoK: 0 });
    const st = headShell(H, { cols: 24, rows: 1, ph0: s0(0.9), ph1: TAU - 0.9, th0: thOfY(H.eyeY + 0.07), thMax: () => thOfY(H.eyeY - 0.02), off: () => (e.overHat ? 0.03 : 0.007), uv: (th, ph, k, u) => [u, k] });
    toRig(st); K.add('head', 'armor', st, { rect: AR.uv('strap'), group: 'head', aoK: 0 });
  },
  shades(c, e, toRig) {
    const { H, K, AR } = c, lens = AR.uv(e.lens || 'visor');
    const V = headShell(H, { cols: 14, rows: 2, ph0: -0.95, ph1: 0.95, th0: thOfY(H.eyeY + 0.07), thMax: () => thOfY(H.eyeY - 0.075), off: (th, ph) => 0.011 + 0.006 * gauss(ph / 0.2), uv: (th, ph, k, u) => [u, 1 - k] });
    toRig(V); K.add('head', e.glow ? 'glow' : 'armor', V, { rect: lens, group: 'head', aoK: 0 });
    for (const s of [1, -1]) { // arms
      const a = headOut(H, thOfY(H.eyeY + 0.03), s * 0.95, 0.01), b2 = headOut(H, thOfY(H.eyeY + 0.0), s * 1.65, 0.006);
      const t = tube([a, b2], 0.0035, { seg: 4 }); uvSet(t, 0.5, 0.5); toRig(t); K.add('head', 'armor', t, { rect: AR.uv('strap'), group: 'head', aoK: 0 });
    }
  },
  glasses(c, e, toRig) {
    const { H, K, UN } = c, fr = UN.uv('metal');
    for (const s of [1, -1]) {
      const p = headOut(H, thOfY(H.eyeY), s * (H.eyePh + 0.02), 0.016);
      const ring = torus(0.022, 0.0028, 4, 12); xform(ring, mat(p[0], p[1], p[2], 0, s * 0.3, 0, 1.15, 0.85, 1)); uvSet(ring, 0.5, 0.5); toRig(ring); K.add('head', 'under', ring, { rect: fr, group: 'head', aoK: 0 });
      const a = headOut(H, thOfY(H.eyeY + 0.01), s * 0.78, 0.012), b2 = headOut(H, thOfY(H.eyeY), s * 1.62, 0.004);
      const t = tube([a, b2], 0.0025, { seg: 4 }); uvSet(t, 0.5, 0.5); toRig(t); K.add('head', 'under', t, { rect: fr, group: 'head', aoK: 0 });
    }
  },
};
const s0 = (v) => v;

// ----------------------------------------------------------------------------- hands & feet
function buildHands(c) {
  const { spec, K, SK, UN, ak } = c, hands = spec.hands || {};
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R', bp = c.BP['hand' + L];
    const parts = handPieces(s, { size: 1.12 * (hands.size ?? 1) * Math.pow(ak, 0.6), grip: s > 0 ? (hands.leftGrip || 'relaxed') : 'fist' });
    const glove = hands.glove, rect = glove ? UN.uv(glove) : SK.uv('hand');
    parts.forEach((P, i) => {
      move(P, bp[0], bp[1], bp[2]);
      // uv: spread pieces over the swatch (palm left half, fingers right half)
      const u0 = i === 0 ? 0 : 0.5 + (i - 1) * 0.1, u1 = i === 0 ? 0.5 : u0 + 0.1;
      for (let k = 0; k < P.uv.length; k += 2) P.uv[k] = u0 + P.uv[k] * (u1 - u0);
      const fingerless = hands.fingerless && i > 0;
      K.add('hand' + L, glove && !fingerless ? 'under' : 'skin', P, { rect: fingerless ? SK.uv('hand') : rect, group: 'hand' + L, aoK: 0.4 });
    });
    if (glove && hands.cuff) {
      const cuff = loft([{ c: [bp[0], bp[1] + 0.03, bp[2]], rx: 0.04 * ak, rz: 0.05 * ak }, { c: [bp[0], bp[1] - 0.02, bp[2]], rx: 0.045 * ak, rz: 0.056 * ak }], { seg: 10 });
      K.add('hand' + L, 'under', cuff, { rect: UN.uv(glove), group: 'hand' + L });
    }
  }
}
function buildFeet(c) {
  const { spec, K, UN, lk } = c, feet = spec.feet || { kind: 'combat' };
  const sw = feet.swatch || 'bootCombat';
  const rects = { shaft: UN.sub(sw, 0, 0.55, 1, 1), foot: UN.sub(sw, 0, 0.15, 1, 0.55), sole: UN.sub(sw, 0, 0, 1, 0.15) };
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R', bp = c.BP['an' + L];
    for (const { P, rect } of bootPieces(feet.kind, rects, { size: 1.12 * (feet.size ?? 1) * Math.pow(lk, 0.35) })) {
      move(P, bp[0], bp[1], bp[2]);
      K.add('an' + L, 'under', P, { rect: { ...rect }.length ? rect : rect, flipU: s < 0, group: 'foot' + L, aoK: 0.5 });
    }
  }
}

// ----------------------------------------------------------------------------- accessories
const ACC = {
  belt(c, a) {
    const { B, K, UN } = c, rect = UN.uv(a.swatch || 'belt');
    const y = a.y ?? 1.075, rings = [];
    for (const [dy, o] of [[-0.028, 0.004], [-0.026, 0.016], [0.026, 0.016], [0.028, 0.004]]) { const T = torsoAt(B, y + dy, 0.006 + o); rings.push({ c: [0, y + dy, T.cz], rx: T.rx, rz: T.rz, e: T.e, f: torsoBulge(B, y + dy), v: (dy + 0.028) / 0.056 }); }
    K.add('hips', 'under', loftVar(rings, { seg: 26 }), { rect, group: 'torso', aoK: 0.4 });
    const T = torsoAt(B, y, 0.024), bk = rbox(0.075, 0.05, 0.016, 0.005);
    move(bk, 0, y, T.cz + T.rz * torsoBulge(B, y)(0) + 0.004); uvRect(bk, UN.uv('buckle'));
    K.add('hips', 'under', bk, { group: 'torso', aoK: 0 });
  },
  kneepads(c, a) {
    const { K, AR, BP, lk } = c, rect = AR.uv(a.swatch || 'kneepad');
    for (const s of [1, -1]) {
      const kp = BP[s > 0 ? 'knL' : 'knR'], bone = s > 0 ? 'knL' : 'knR', g = s > 0 ? 'legLs' : 'legRs';
      K.add(bone, 'armor', shellCap(0.074 * lk, 0.09 * lk, 0.05 * lk, [kp[0], kp[1] - 0.005, kp[2] + 0.055 * lk], 0.012, { front: true }), { rect, group: g, aoK: 0 });
      const st = loft([{ c: [kp[0], kp[1] + 0.05, kp[2] + 0.004], rx: 0.086 * lk, rz: 0.092 * lk }, { c: [kp[0], kp[1] + 0.028, kp[2] + 0.004], rx: 0.088 * lk, rz: 0.094 * lk }], { seg: 12 });
      K.add(bone, 'armor', st, { rect: AR.uv('strap'), group: g, aoK: 0 });
      const st2 = loft([{ c: [kp[0], kp[1] - 0.05, kp[2] - 0.002], rx: 0.08 * lk, rz: 0.088 * lk }, { c: [kp[0], kp[1] - 0.072, kp[2] - 0.002], rx: 0.078 * lk, rz: 0.086 * lk }], { seg: 12 });
      K.add(bone, 'armor', st2, { rect: AR.uv('strap'), group: g, aoK: 0 });
    }
  },
  // magazine / utility pouches on a plate carrier
  pouches(c, a) {
    const { B, K, AR } = c, rect = AR.uv(a.swatch || 'pouch');
    const y = 1.27, T = torsoAt(B, y, 0.04);
    for (const [i, ang] of [[0, -0.42], [1, 0], [2, 0.42]]) {
      const P = rbox(0.075, 0.12, 0.05, 0.014, 1);
      const x = Math.sin(ang) * T.rx * 1.02, z = T.cz + Math.cos(ang) * T.rz * 1.02 + 0.026;
      xform(P, mat(x, y, z, 0, ang, 0)); void i;
      K.add('torso', 'armor', P, { rect, group: 'torso', aoK: 0.6 });
    }
    // side pouches + radio
    for (const s of [1, -1]) {
      const yy = 1.25, T2 = torsoAt(B, yy, 0.04), P = rbox(0.05, 0.1, 0.09, 0.014, 1);
      xform(P, mat(s * (T2.rx + 0.02), yy, T2.cz - 0.03, 0, 0, 0));
      K.add('torso', 'armor', P, { rect, group: 'torso', aoK: 0.6 });
    }
    const ra = rbox(0.045, 0.1, 0.035, 0.01, 1); const T3 = torsoAt(B, 1.62, 0.045);
    xform(ra, mat(0.13 * B.b, 1.64, T3.cz + T3.rz * 1.06 + 0.012, -0.1, 0, 0)); K.add('chest', 'armor', ra, { rect, group: 'torso', aoK: 0.6 });
    const ant = tube([[0.15 * B.b, 1.69, T3.cz + T3.rz * 1.06 + 0.01], [0.16 * B.b, 1.8, T3.cz + T3.rz * 1.0]], 0.004, { seg: 4 }); uvSet(ant, 0.5, 0.5);
    K.add('chest', 'armor', ant, { rect: AR.uv('strap'), group: 'torso', aoK: 0 });
  },
  holster(c, a) {
    const { K, AR, BP, lk } = c, rect = AR.uv(a.swatch || 'holster');
    const J = BP.hipR;
    const P = rbox(0.06, 0.2, 0.12, 0.02, 1); xform(P, mat(J[0] - 0.135 * lk, J[1] - 0.24, J[2] + 0.015, 0, 0, -0.06));
    K.add('hipR', 'armor', P, { rect, group: 'legR', aoK: 0.4 });
    // pistol grip sticking out
    const gp = rbox(0.035, 0.09, 0.05, 0.01, 1); xform(gp, mat(J[0] - 0.14 * lk, J[1] - 0.1, J[2] + 0.035, 0.3, 0, -0.05)); uvSet(gp, 0.5, 0.5);
    K.add('hipR', 'armor', gp, { rect: AR.uv('metalA'), group: 'legR', aoK: 0 });
    for (const dy of [-0.18, -0.3]) {
      const [rx, rz] = table(THIGH, -dy);
      const st = loft([{ c: [J[0], J[1] + dy + 0.012, J[2]], rx: rx * lk + 0.012, rz: rz * lk + 0.012 }, { c: [J[0], J[1] + dy - 0.012, J[2]], rx: rx * lk + 0.012, rz: rz * lk + 0.012 }], { seg: 12 });
      K.add('hipR', 'armor', st, { rect: AR.uv('strap'), group: 'legR', aoK: 0 });
    }
  },
  // diagonal shell bandolier from the left shoulder to the right hip
  bandolier(c, a) {
    const { B, K, AR } = c, rect = AR.uv(a.swatch || 'strap');
    for (const back of [false, true]) {
      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10, y = 1.8 - t * 0.68, ang = (back ? Math.PI - 0.75 : 0.75) + (back ? 1 : -1) * t * 1.5;
        const T = torsoAt(B, y, 0.03 + (y > 1.7 ? 0.01 : 0)), k = torsoBulge(B, y)(ang);
        pts.push([Math.sin(ang) * T.rx * k * 1.02, y, T.cz + Math.cos(ang) * T.rz * k * 1.02]);
      }
      const nrm = (i, p) => [p[0], 0.15, p[2] - 0.0];
      const up = pts.filter((p) => p[1] >= 1.38), lo = pts.filter((p) => p[1] <= 1.44);
      if (up.length > 1) K.add('chest', 'armor', strap(up, 0.055, 0.012, nrm), { rect, group: 'torso', aoK: 0.3 });
      if (lo.length > 1) K.add('torso', 'armor', strap(lo, 0.055, 0.012, nrm), { rect, group: 'torso', aoK: 0.3 });
      if (!back) for (let i = 1; i < 9; i++) { // shells
        const p = pts[i], q = pts[i + 1];
        const sh = cylinder(0.011, 0.011, 0.04, 6); const ang = Math.atan2(p[0], p[2] - torsoAt(B, p[1]).cz);
        xform(sh, mat(0, 0, 0, 0, 0, Math.atan2(q[1] - p[1], Math.hypot(q[0] - p[0], q[2] - p[2])) + Math.PI / 2));
        xform(sh, mat(p[0] * 1.06, p[1], p[2] + 0.012 * Math.cos(ang), 0, ang, 0));
        uvSet(sh, 0.5, 0.5);
        K.add(p[1] > 1.41 ? 'chest' : 'torso', 'armor', sh, { rect: AR.uv('metalA'), group: 'torso', aoK: 0 });
      }
    }
  },
  // brute: front + back plates and abdominal lames
  chestplate(c, a) {
    const { B, K, AR } = c, rect = AR.uv(a.swatch || 'plateChest');
    const plate = (bone, y0, y1, a0, a1, off, vr) => {
      const rings = [];
      const n = Math.max(2, Math.ceil((y1 - y0) / 0.05));
      for (let i = 0; i <= n; i++) {
        const y = y0 + (y1 - y0) * i / n, T = torsoAt(B, y, off);
        rings.push({ c: [0, y, T.cz], rx: T.rx, rz: T.rz * (1 + 0.06 * Math.sin(Math.PI * i / n)), e: T.e, f: torsoBulge(B, y), a0, a1, v: vr[0] + (vr[1] - vr[0]) * i / n });
      }
      // thickness: outer surface + rim (inner edge strip)
      const P = loftVar(rings, { seg: 12, uAbs: false });
      const I = loftVar(rings.filter((r, i) => i % 2 === 0 || i === rings.length - 1).map((r) => ({ ...r, rx: r.rx - 0.016, rz: r.rz - 0.016 })), { seg: 6, uAbs: false, inside: true }); aoMul(I, () => 0.4);
      K.add(bone, 'armor', P, { rect, group: 'torso', aoK: 0.4 });
      K.add(bone, 'armor', I, { rect, group: 'torso', aoK: 0 });
    };
    plate('chest', 1.44, 1.84, -1.15, 1.15, 0.05, [0.35, 1]);
    plate('chest', 1.46, 1.82, Math.PI - 1.0, Math.PI + 1.0, 0.045, [0.35, 1]);
    plate('torso', 1.3, 1.43, -0.95, 0.95, 0.055, [0.18, 0.33]);
    plate('torso', 1.17, 1.3, -0.85, 0.85, 0.05, [0.02, 0.17]);
  },
  pauldrons(c, a) {
    const { K, AR, BP, ak } = c, rect = AR.uv(a.boss ? 'plateBoss' : (a.swatch || 'plateArm'));
    const big = (a.big ? 1.12 : a.boss ? 1.0 : 1) * ak;
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R', J = BP['sh' + L], g = 'arm' + L;
      const C = [J[0] - s * 0.01 * big, J[1] - 0.005, J[2]];
      if (a.boss) {
        const P = lamePlate(C, s, 0.135 * big, 0.15 * big, -0.55, 1.25, 0.016, 0);
        K.add('sh' + L, 'armor', P, { rect, group: g, aoK: 0.25 });
      } else {
        // riot pads: a stack of chunky rounded plates stepping down the outside of the shoulder
        const plates = [[0.3, 0.075, 0.34, 0.035, 0.105, 0.42], [0.27, 0.065, 0.31, 0.1, 0.03, 0.78], [0.22, 0.055, 0.27, 0.13, -0.05, 1.1]];
        for (const [w, hgt, d, ox, oy, rz] of plates) {
          const k = big * 0.84;
          const P = rbox(w * k, hgt * k, d * k, 0.026 * big, 1);
          xform(P, mat(J[0] + s * ox * k, J[1] + oy * k, J[2], 0, 0, -s * rz));
          K.add('sh' + L, 'armor', P, { rect, group: g, aoK: 0.3 });
        }
      }
      if (a.boss) { // spikes
        for (let i = 0; i < 3; i++) {
          const ang = 0.15 + i * 0.32, R = 0.135 * big + 0.012, base = [C[0] + s * Math.sin(ang) * R, C[1] + Math.cos(ang) * R, C[2] + (i - 1) * 0.06 * big];
          const cone = cylinder(0.0, 0.022 * big, 0.08 * big, 6); xform(cone, mat(0, 0.04 * big, 0)); xform(cone, mat(base[0], base[1], base[2], 0, 0, -s * ang));
          uvSet(cone, 0.5, 0.5); K.add('sh' + L, 'armor', cone, { rect: AR.uv('chainGold'), group: g, aoK: 0 });
        }
      }
    }
  },
  gauntlets(c, a) {
    const { K, AR, BP, ak } = c, rect = AR.uv(a.swatch || 'plateArm');
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R', E = BP['el' + L];
      limb(K, { bone: 'el' + L, slot: 'armor', rect, J: E, prof: FORE, d0: 0.06, d1: 0.37, k: ak, side: s, off: 0.026, v: (d) => 1 - (d - 0.06) / 0.31, group: 'arm' + L + 'f', hemTop: true, hemBot: true, scale: (d) => 1 + 0.25 * sstep(0.25, 0.37, d), seg: 12, e: 2.6 });
      // elbow cop
      K.add('el' + L, 'armor', shellCap(0.07 * ak, 0.07 * ak, 0.06 * ak, [E[0] + s * 0.005, E[1] - 0.005, E[2] - 0.045 * ak], 0.012, { back: true }), { rect, group: 'arm' + L + 'f', aoK: 0.3 });
    }
  },
  greaves(c, a) {
    const { K, AR, BP, lk } = c, rect = AR.uv(a.swatch || 'plateLeg');
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R', Kj = BP['kn' + L];
      limb(K, { bone: 'kn' + L, slot: 'armor', rect, J: Kj, prof: SHIN, d0: 0.05, d1: 0.33, k: lk, side: s, off: 0.03, a0: -1.25, a1: 1.25, v: (d) => 1 - (d - 0.05) / 0.28, group: 'leg' + L + 's', seg: 10, e: 2.2 });
      K.add('kn' + L, 'armor', shellCap(0.085 * lk, 0.09 * lk, 0.055 * lk, [Kj[0], Kj[1] + 0.005, Kj[2] + 0.06 * lk], 0.014, { front: true }), { rect, group: 'leg' + L + 's', aoK: 0.3 });
    }
  },
  // riot shield plate strapped to the left forearm
  shieldArm(c, a) {
    const { K, AR, BP, ak } = c, rect = AR.uv(a.swatch || 'plateChest'), E = BP.elL;
    const rings = [];
    for (let i = 0; i <= 4; i++) { const d = 0.0 + i * 0.1; rings.push({ c: [E[0] - 0.02, E[1] - d, E[2]], rx: 0.15 * ak, rz: 0.17 * ak, a0: Math.PI * 0.18, a1: Math.PI * 0.82, v: 1 - i / 4 }); }
    const P = loftVar(rings, { seg: 10, uAbs: false });
    const I = loftVar(rings.map((r) => ({ ...r, rx: r.rx - 0.012, rz: r.rz - 0.012 })), { seg: 10, uAbs: false, inside: true }); aoMul(I, () => 0.45);
    K.add('elL', 'armor', P, { rect, group: 'armLf', aoK: 0.2 }); K.add('elL', 'armor', I, { rect, group: 'armLf', aoK: 0 });
  },
  // long coat skirt: front/back panels riding the thighs
  coatTails(c, a) {
    const { K, AR, BP, lk, B } = c, rect = AR.uv(a.swatch || 'coatTail');
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R', J = BP['hip' + L];
      const len = a.len ?? 0.66;
      const frontIn = a.open ? 0.16 : 0.34; // closed coats overlap at the centre line, open ones (boss) show a split
      for (const [a0, a1, fr] of [[-Math.PI * frontIn, Math.PI * 0.62, true], [Math.PI * 0.4, Math.PI * 1.45, false]]) {
        const rings = [];
        const ds = [-0.12, -0.02, 0.12, 0.28, 0.44, len].filter((d, i, arr) => i === 0 || d > arr[i - 1]);
        for (const d of ds) {
          // starts inside the coat body (thigh-tight) and flares into flat, wide curtains towards the hem
          const [rx, rz] = table(THIGH, Math.max(0, Math.min(d, 0.46))), t = sstep(-0.12, len, d), fl = 0.075 * t * B.b;
          rings.push({ c: [J[0] - s * (0.012 + 0.03 * t), J[1] - d, J[2] + (fr ? 0.004 : -0.01)], rx: rx * lk + 0.012 + fl + 0.03 * t, rz: rz * lk + 0.012 + fl * 0.5, v: 1 - (d + 0.12) / (len + 0.12), e: 2.4 });
        }
        const sa0 = s > 0 ? a0 : -a1, sa1 = s > 0 ? a1 : -a0;
        const P = loftVar(rings.reverse(), { seg: 8, uAbs: false });
        void sa0; void sa1;
        // mirror the angular range for the right leg so the front opening stays at the centre line
        if (s < 0) for (let i = 0; i < P.p.length; i += 3) { P.p[i] = 2 * J[0] - P.p[i]; P.n[i] = -P.n[i]; }
        if (s < 0) flipWinding(P);
        const I = { p: P.p.slice(), n: P.n.map((v) => -v), uv: P.uv.slice(), a: P.a.map(() => 0.35), ix: P.ix.slice() };
        // pull the inner face in slightly
        for (let i = 0; i < I.p.length; i += 3) { I.p[i] -= P.n[i] * 0.006; I.p[i + 1] -= P.n[i + 1] * 0.006; I.p[i + 2] -= P.n[i + 2] * 0.006; }
        flipWinding(I);
        K.add('hip' + L, 'armor', P, { rect, group: 'leg' + L, aoK: 0.5 });
        K.add('hip' + L, 'armor', I, { rect, group: 'leg' + L, aoK: 0 });
      }
    }
  },
  chain(c, a) {
    const { B, K, AR } = c, rect = AR.uv('chainGold');
    const parts = [];
    for (const [drop, rr, n] of [[0.24, 0.019, 12], [0.16, 0.014, 10]]) {
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n, ang = -1.25 + 2.5 * t, y = 1.86 - drop * Math.sin(Math.PI * t) - 0.04;
        const T = torsoAt(B, y, 0.032), k = torsoBulge(B, y)(ang);
        pts.push([Math.sin(ang) * T.rx * k * 0.92, y, T.cz + Math.cos(ang) * T.rz * k * 1.03 + 0.008]);
      }
      for (let i = 0; i < n; i++) {
        const p = pts[i], q = pts[i + 1];
        const L = torus(rr, rr * 0.38, 3, 6); const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
        xform(L, mat(0, 0, 0, i % 2 ? Math.PI / 2 : 0, 0, 0, 1.5, 1, 1));
        xform(L, mat((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2, 0, Math.atan2(dz, dx) * -1, Math.atan2(dy, Math.hypot(dx, dz))));
        parts.push(L);
      }
      if (drop > 0.2) { const m = pts[Math.floor(n / 2)]; const md = cylinder(0.045, 0.045, 0.012, 12); xform(md, mat(m[0], m[1] - 0.045, m[2] + 0.006, Math.PI / 2, 0, 0)); parts.push(md); }
    }
    const P = concat(...parts); uvSet(P, 0.5, 0.5);
    K.add('chest', 'armor', P, { rect, group: 'torso', aoK: 0 });
  },
  rings(c) {
    const { K, AR, BP } = c, rect = AR.uv('chainGold'), bp = BP.handR;
    for (let i = 0; i < 3; i++) { const R = torus(0.014, 0.0045, 4, 8); xform(R, mat(bp[0] + 0.012, bp[1] - 0.085, bp[2] + 0.028 - i * 0.021, 0, Math.PI / 2, 0)); uvSet(R, 0.5, 0.5); K.add('handR', 'armor', R, { rect, group: 'handR', aoK: 0 }); }
  },
  cigar(c) {
    const { H, K, AR, BP, SK } = c, hp = BP.head;
    const m = headOut(H, thOfY(-0.47), 0.32, 0.004);
    const P = cylinder(0.009, 0.0095, 0.11, 8); xform(P, mat(0, 0, 0, Math.PI / 2 - 0.25, 0, 0)); xform(P, mat(m[0] + 0.02, m[1] - 0.012, m[2] + 0.05, 0, 0.55, 0));
    move(P, hp[0], hp[1], hp[2]); uvSet(P, 0.5, 0.2);
    K.add('head', 'armor', P, { rect: AR.uv('strap'), group: 'head', aoK: 0 });
    const tip = cylinder(0.0098, 0.0098, 0.012, 8); xform(tip, mat(0, 0, 0, Math.PI / 2 - 0.25, 0, 0)); xform(tip, mat(m[0] + 0.02 + Math.sin(0.55) * 0.058, m[1] - 0.012 - 0.014, m[2] + 0.05 + Math.cos(0.55) * 0.054, 0, 0.55, 0));
    move(tip, hp[0], hp[1], hp[2]); uvSet(tip, 0.5, 0.5);
    K.add('head', 'glow', tip, { rect: SK.uv('hand'), group: 'head', aoK: 0 });
  },
  scarf(c, a) {
    const { B, K, AR } = c, rect = AR.uv(a.swatch || 'scarf');
    const nk = 0.075 * (B.neckK ?? 1), rings = [];
    for (const [y, r, cz] of [[1.84, nk + 0.07, -0.01], [1.88, nk + 0.06, -0.012], [1.93, nk + 0.04, -0.012], [1.97, nk + 0.03, -0.014], [1.95, nk + 0.012, -0.014]]) rings.push({ c: [0, y, cz], rx: r, rz: r * 1.05, f: (t) => 1 + 0.06 * Math.sin(t * 5) });
    K.add('chest', 'armor', loft(rings, { seg: 18 }), { rect, group: 'torso', aoK: 0.3 });
    const T = torsoAt(B, 1.6, 0.03);
    const tail = strap([[0.05, 1.86, nk + 0.06], [0.07, 1.75, T.cz + T.rz + 0.01], [0.08, 1.6, T.cz + T.rz + 0.012], [0.085, 1.5, T.cz + T.rz * 0.98 + 0.01]], 0.07, 0.014, () => [0, 0.1, 1]);
    K.add('chest', 'armor', tail, { rect, group: 'torso', aoK: 0.2 });
  },
  // boxer-style tape wraps around the forearm and across the knuckles (bare-forearm brawlers)
  wraps(c, a) {
    const { K, UN, BP, ak } = c, rect = UN.uv('tape');
    for (const s2 of [1, -1]) {
      const L = s2 > 0 ? 'L' : 'R', E = BP['el' + L], hp = BP['hand' + L];
      for (const [d0, d1, o] of [[0.24, 0.3, 0.004], [0.3, 0.37, 0.005], [0.355, 0.4, 0.006]]) {
        limb(K, { bone: 'el' + L, slot: 'under', rect, J: E, prof: FORE, d0, d1, k: ak, side: s2, off: o, v: (d) => (d - d0) / (d1 - d0), group: 'arm' + L + 'f', seg: 10, step: 0.03, aoK: 0 });
      }
      // knuckle band
      const sz = 1.12 * Math.pow(ak, 0.6);
      const band = loft([{ c: [hp[0], hp[1] - 0.045 * sz, hp[2]], rx: 0.026 * sz, rz: 0.054 * sz, e: 2.6 }, { c: [hp[0], hp[1] - 0.075 * sz, hp[2]], rx: 0.024 * sz, rz: 0.053 * sz, e: 2.6 }], { seg: 10 });
      K.add('hand' + L, 'under', band, { rect, group: 'hand' + L, aoK: 0 });
    }
  },
  // Slo-Mo veins: thin emissive tubes running under the skin of the forearms (and upper arms / neck)
  veins(c, a) {
    const { K, BP, SK, ak, spec } = c, rect = SK.uv('hand'), rng = mulberry(a.seed ?? 11);
    const top = spec.top || {}, shirt = spec.shirt || {};
    const sl = top.kind && top.kind !== 'none' ? (top.sleeves ?? 'long') : (shirt.sleeves ?? 'short');
    const foreFrom = sl === 'rolled' ? 0.2 : sl === 'long' ? 9 : 0.0;
    const upperOK = sl === 'none';
    for (const sd of [1, -1]) {
      const L = sd > 0 ? 'L' : 'R';
      const run = (bone, J, prof, d0, d1, t0) => {
        if (d1 - d0 < 0.06) return;
        const pts = [], n = 7;
        let t = t0;
        for (let i = 0; i <= n; i++) {
          const d = d0 + (d1 - d0) * i / n; t += (rng() - 0.5) * 0.35;
          const [rx, rz, cx, cz] = table(prof, d);
          const R = 1.0;
          pts.push([J[0] + cx * sd * ak + Math.sin(t) * (rx * ak * R + 0.0015) * sd, J[1] - d, J[2] + cz * ak + Math.cos(t) * (rz * ak * R + 0.0015)]);
        }
        K.add(bone, 'glow', tube(pts, (q) => 0.0048 * (1 - 0.4 * q), { seg: 4, cap: true }), { rect, group: 'arm' + L + 'f', aoK: 0 });
        // a short branch off the middle
        const m = pts[3], q2 = pts[5], br = [m, [lerp(m[0], q2[0], 0.5) + (rng() - 0.5) * 0.02, lerp(m[1], q2[1], 0.6), lerp(m[2], q2[2], 0.5) + (rng() - 0.5) * 0.02]];
        K.add(bone, 'glow', tube(br, 0.003, { seg: 3, cap: true }), { rect, group: 'arm' + L + 'f', aoK: 0 });
      };
      const E = BP['el' + L], J = BP['sh' + L];
      for (const t0 of [-2.1, -1.4, -0.7, 0.3]) run('el' + L, E, FORE, Math.max(0.03, foreFrom), 0.37, t0 + (rng() - 0.5) * 0.3);
      if (upperOK) for (const t0 of [-1.6, -0.4, 0.5]) run('sh' + L, J, UPPER, 0.1, 0.4, t0);
    }
    if (a.neck !== false) for (const sd of [1, -1]) {
      const pts = []; for (let i = 0; i <= 5; i++) { const y = 1.86 + i * 0.035, ang = sd * (1.25 + 0.15 * Math.sin(i * 1.7)); pts.push([Math.sin(ang) * 0.07 * (spec.body?.neckK ?? 1), y, -0.012 + Math.cos(ang) * 0.072 * (spec.body?.neckK ?? 1)]); }
      K.add('neck', 'glow', tube(pts, 0.0038, { seg: 4 }), { rect, group: 'neck', aoK: 0 });
    }
  },
  bag(c, a) {
    const { B, K, AR, HW } = c, rect = AR.uv(a.swatch || 'bagLeather');
    const P = rbox(0.07, 0.2, 0.26, 0.03, 1); xform(P, mat(0.27 * B.b + 0.04, 0.95, 0.02, 0, 0, 0.06));
    K.add('hips', 'armor', P, { rect, group: 'torso', aoK: 0.5 });
    // strap from the right shoulder across the chest to the bag
    for (const back of [false, true]) {
      const pts = [];
      for (let i = 0; i <= 8; i++) { const t = i / 8, y = 1.8 - t * 0.66, ang = back ? Math.PI + 0.7 - t * 1.25 : -0.7 + t * 1.6; const T = torsoAt(B, y, 0.03), k = torsoBulge(B, y)(ang); pts.push([Math.sin(ang) * T.rx * k * 1.02, y, T.cz + Math.cos(ang) * T.rz * k * 1.02]); }
      const up = pts.filter((p) => p[1] >= 1.38), lo = pts.filter((p) => p[1] <= 1.44);
      const nrm = (i, p) => [p[0], 0.1, p[2]];
      if (up.length > 1) K.add('chest', 'armor', strap(up, 0.03, 0.006, nrm), { rect: AR.uv('strap'), group: 'torso', aoK: 0.2 });
      if (lo.length > 1) K.add('torso', 'armor', strap(lo, 0.03, 0.006, nrm), { rect: AR.uv('strap'), group: 'torso', aoK: 0.2 });
    }
    void HW;
  },
};
// curved armour lame: a roof tile around a front-back axis through C, arching from angle a0 (towards the neck,
// measured from +Y) to a1 (down the outer side), with thickness and closed edges
function lamePlate(C, s, R, D, a0, a1, th, k = 0) {
  const zs = [-1, -0.6, 0, 0.6, 1];
  const mkRings = (rr) => zs.map((z, i) => { const end = 1 - 0.12 * Math.pow(Math.abs(z), 3); return { c: [C[0], C[1], C[2] + z * D], rx: rr * end, rz: rr * end * (1 + 0.06 * k), ux: [s, 0, 0], uz: [0, 1, 0], e: 2.4, v: i / (zs.length - 1) }; });
  const out = loft(mkRings(R), { seg: 8, a0, a1 });
  const inn = loft(mkRings(R - th), { seg: 8, a0, a1, inside: true }); aoMul(inn, () => 0.35);
  // edge strips along a0 / a1 and the two ends
  const E = piece();
  const ring = (rr, z, t) => { const end = 1 - 0.12 * Math.pow(Math.abs(z), 3); return [C[0] + s * Math.sin(t) * rr * end * (Math.abs(Math.sin(t)) > 0 ? 1 : 1), C[1] + Math.cos(t) * rr * end * (1 + 0.06 * k), C[2] + z * D]; };
  const addStrip = (pts) => { const o = E.p.length / 3; for (const [p, q] of pts) { E.p.push(...p, ...q); E.uv.push(0.5, 0.02, 0.5, 0.02); E.a.push(0.8, 0.5); } for (let i = 0; i < pts.length - 1; i++) { const a = o + i * 2, b = a + 1, c2 = a + 2, d = a + 3; E.ix.push(a, b, d, a, d, c2); } };
  for (const t of [a0, a1]) addStrip(zs.map((z) => [ring(R, z, t), ring(R - th, z, t)]));
  for (const z of [-1, 1]) { const ts = []; for (let j = 0; j <= 8; j++) ts.push(a0 + (a1 - a0) * j / 8); addStrip(ts.map((t) => [ring(R, z, t), ring(R - th, z, t)])); }
  computeNormals(E, false);
  // orient strips outward from the plate centre
  let sgn = 0; const cen = ring(R - th / 2, 0, (a0 + a1) / 2);
  for (let i = 0; i < E.p.length; i += 3) sgn += (E.p[i] - cen[0]) * E.n[i] + (E.p[i + 1] - cen[1]) * E.n[i + 1] + (E.p[i + 2] - cen[2]) * E.n[i + 2];
  if (sgn < 0) { flipWinding(E); for (let i = 0; i < E.n.length; i++) E.n[i] = -E.n[i]; }
  return concat(out, inn, E);
}
// half-shell cap (pauldrons, knee/elbow cops): outer + inner surface with a rim
function shellCap(rx, ry, rz, c, th, o = {}) {
  const thetaLength = o.front || o.back ? Math.PI : Math.PI * 0.55;
  const opt = o.front ? { phiStart: 0, phiLength: Math.PI, thetaStart: 0, thetaLength: Math.PI } : o.back ? { phiStart: Math.PI, phiLength: Math.PI, thetaStart: 0, thetaLength: Math.PI } : { thetaLength };
  const out = ellipsoid(rx, ry, rz, 9, 6, opt);
  const inn = ellipsoid(rx - th, ry - th, rz - th, 6, 4, opt);
  flipWinding(inn); for (let i = 0; i < inn.n.length; i++) inn.n[i] = -inn.n[i]; aoMul(inn, () => 0.35);
  const P = concat(out, inn);
  if (o.front) xform(P, mat(0, 0, 0, 0, -Math.PI / 2, 0)); // the half faces +z
  if (o.back) xform(P, mat(0, 0, 0, 0, -Math.PI / 2, 0));
  if (o.tilt) xform(P, mat(0, 0, 0, 0, 0, -o.tilt));
  move(P, c[0], c[1], c[2]);
  return P;
}
MASK.respirator.hidesNose = true;
MASK.balaclava.hidesNose = true; MASK.balaclava.hidesEars = true;
MASK.balaclava.covers = (th, ph) => { const Y = Math.cos(th); return !(Math.abs(Y - 0.06) < 0.16 && Math.abs(ph) < 0.8); };
export { ACC, HAT, HAIR, MASK, EYEWEAR, COLLAR };
