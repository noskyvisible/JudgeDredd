import * as THREE from 'three';
import { eagleShape } from './world.js';
import {
  Surf, loftGeo, loftBetween, plateGeo, plateAY, bandGeo, sweepGeo, rimGeo, mergeGeos, frame, xf, deform, extrudeGeo, rivetGeo,
  rrect, ellipse, roundPoly, smoothPoly, mono, sstep, gauss, lin, clamp, wrapA, TAU, V, mirrorX,
} from './charhero_geo.js';

// ===========================================================================
// Hero sub-assemblies (each returns a list of [geometry, material] in the owning joint's space):
//   helmet + face (head), gloved fist (hand), ribbed pauldron (left), eagle pauldron (right), boot foot (ankle)
// ===========================================================================

export const HEAD_Y = 0.025;   // the whole head sits a little higher than the joint so the chin clears the collar

// ---------------------------------------------------------------- helmet
export function helmetSurf() {
  const flare = (a, y) => 0.052 * sstep(0.05, -0.13, y) * Math.pow(Math.max(0, -Math.cos(a)), 1.3);
  const brow = (a, y) => 0.012 * gauss(y, 0.229, 0.016) * (1 - sstep(1.0, 1.45, Math.abs(wrapA(a))));
  const cheek = (a, y) => -0.008 * gauss(Math.abs(wrapA(a)), 0.75, 0.35) * sstep(0.1, -0.05, y);   // taper toward the jaw
  return new Surf([
    { y: -0.135, rx: 0.2, rz: 0.212, cz: -0.04 },
    { y: -0.06, rx: 0.226, rz: 0.235, cz: -0.028 },
    { y: 0.02, rx: 0.245, rz: 0.252, cz: -0.017 },
    { y: 0.1, rx: 0.255, rz: 0.262, cz: -0.011 },
    { y: 0.18, rx: 0.257, rz: 0.266, cz: -0.012 },
    { y: 0.25, rx: 0.246, rz: 0.258, cz: -0.018 },
    { y: 0.31, rx: 0.217, rz: 0.236, cz: -0.026 },
    { y: 0.355, rx: 0.168, rz: 0.192, cz: -0.034 },
    { y: 0.385, rx: 0.105, rz: 0.128, cz: -0.04 },
    { y: 0.4, rx: 0.045, rz: 0.058, cz: -0.044 },
    { y: 0.405, rx: 0.0, rz: 0.0, cz: -0.045 },
  ], { e: 2.1, mod: (a, y) => flare(a, y) + brow(a, y) + cheek(a, y) });
}

export function buildHelmet(M) {
  const out = [], P = (g, m) => { out.push([g, m]); return g; };
  const S = helmetSurf(), H = 0.012;
  // crown: everything above the visor, sweeping down over the temples to the nape
  const yl = mono([0, 0.28, 0.6, 1.15, 1.42, 1.72, 2.2, 2.7, Math.PI], [0.196, 0.209, 0.215, 0.213, 0.193, 0.153, 0.093, 0.054, 0.044]);
  const ylow = (a) => yl(Math.abs(wrapA(a)));
  P(loftBetween(S, ylow, () => 0.405, { na: 66, ns: 18, h: H, sDist: (s) => s - 0.55 * Math.sin(TAU * s) / TAU }), M.helmet);
  const rim = []; for (let i = 0; i < 66; i++) { const a = (i / 66) * TAU; rim.push([a, ylow(a) + 0.002]); }
  P(rimGeo(S, rim, 0.0078, H - 0.001, { closed: true, seg: 6 }), M.helmet);
  // visor glass (recessed under the brow lip and the cheek guards)
  P(loftGeo(S, { ys: lin(0.094, 0.226, 8), a0: -1.44, a1: 1.44, na: 44, h: -0.003, uvFn: (a, y) => [a * 0.3 + 0.5, (y - 0.094) / 0.132] }), M.visor);
  // cheek guards
  const cg = [[0.355, 0.104], [0.85, 0.103], [1.27, 0.104], [1.35, 0.13], [1.39, 0.205], [1.62, 0.19], [1.88, 0.155], [2.08, 0.122], [2.14, 0.03], [1.98, -0.08], [1.6, -0.112], [1.1, -0.106], [0.7, -0.086], [0.52, -0.036], [0.43, 0.025], [0.375, 0.074]];
  for (const sx of [1, -1]) P(plateAY(S, cg.map(([a, y]) => [a * sx, y]), { smooth: true, n: 54, t: 0.016, h0: -0.004, bevel: 0.007, nB: 2, nI: 4, crown: 0.004 }), M.helmet);
  // neck guard (flares out over the collar)
  const ng = [[1.9, 0.112], [2.35, 0.09], [Math.PI, 0.066], [TAU - 2.35, 0.09], [TAU - 1.9, 0.112], [TAU - 1.84, 0.0], [TAU - 2.05, -0.098], [Math.PI + 0.6, -0.13], [Math.PI, -0.135], [Math.PI - 0.6, -0.13], [2.05, -0.098], [1.84, 0.0]];
  P(plateAY(S, ng, { smooth: true, n: 54, t: 0.015, h0: -0.009, bevel: 0.007, crown: 0.005, nI: 3 }), M.helmet);
  // nose bar (the stem of the T)
  P(plateAY(S, [[-0.072, 0.232], [0.072, 0.232], [0.062, 0.15], [0.05, 0.1], [0.028, 0.076], [0, 0.07], [-0.028, 0.076], [-0.05, 0.1], [-0.062, 0.15]], { smooth: true, n: 40, t: 0.016, h0: -0.005, bevel: 0.006, crown: 0.003, nI: 3 }), M.helmet);
  // ear / comms housings
  for (const sx of [1, -1]) {
    const c = [sx * 1.68, 0.045];
    P(plateGeo(S, ellipse(0.052, 0.058, 28), { center: c, t: 0.014, h0: 0.008, bevel: 0.006, crown: 0.004, n: 28, nI: 3 }), M.helmet);
    P(plateGeo(S, ellipse(0.034, 0.038, 20), { center: c, t: 0.007, h0: 0.022, bevel: 0.003, n: 20, nI: 2, nB: 2 }), M.metal);
    const p = S.at(c[0], c[1], 0.029), n = S.nrm(c[0], c[1]);
    P(xf(rivetGeo(0.011, 0.7, 10), frame(p, n)), M.gold);
    // tiny status LED below the housing
    P(plateGeo(S, ellipse(0.005, 0.005, 10), { center: [sx * 1.6, -0.03], t: 0.003, h0: 0.011, n: 10, nI: 1, nB: 1 }), M.visor);
    // respirator vents on the cheek guard, by the mouth
    for (const y of [-0.05, -0.026, -0.002]) P(plateGeo(S, rrect(0.052, 0.0085, 0.0035, 2), { center: [sx * 0.82, y], t: 0.004, h0: 0.0115, bevel: 0.0018, n: 14, nI: 1, nB: 1 }), M.metal);
  }
  // crest: raised ridge from the brow over the top to the nape
  {
    const cp = [];
    for (const y of lin(0.29, 0.398, 7)) cp.push(S.at(0, y, H));
    cp.push(S.at(0, 0.405, H));
    for (const y of lin(0.398, 0.07, 14)) cp.push(S.at(Math.PI, y, H));
    const pts = new THREE.CatmullRomCurve3(cp, false, 'centripetal').getSpacedPoints(40);
    const prof = roundPoly([[-0.019, -0.006], [0.019, -0.006], [0.011, 0.019], [-0.011, 0.019]], [0.002, 0.002, 0.006, 0.006], 2);
    P(sweepGeo(pts, prof, { up: V(-1, 0, 0), scale: (t) => [1, Math.max(0.02, Math.min(1, t / 0.07, (1 - t) / 0.16))] }), M.helmet);
  }
  // gold eagle on the brow
  {
    const R = 0.27;
    const shp = eagleShape().getPoints().map((p) => [p.x * 0.074, (p.y - 0.4) * 0.074]);
    let g = extrudeGeo(shp, 0.011, { bevel: 0.0028, seg: 2 });
    g = deform(g, (v) => { v.z -= (v.x * v.x) / (2 * R); }, { smooth: false });
    const y = 0.272, p = S.at(0, y, H + 0.009), n = S.nrm(0, y), tg = S.pos(0, y + 0.01).sub(S.pos(0, y - 0.01)).normalize();
    P(xf(g, frame(p, tg, n)), M.gold);
  }
  // red tail-light strip at the back of the crown
  P(plateGeo(S, rrect(0.1, 0.014, 0.005, 2), { center: [Math.PI, 0.16], t: 0.004, h0: H + 0.002, bevel: 0.0015, n: 24, nI: 2, nB: 1 }), M.visor);
  // interior liner: what you see when looking into the face opening or up under the rim
  P(loftGeo(S, { ys: lin(-0.135, 0.22, 12), a0: 0.22, a1: TAU - 0.22, na: 40, h: -0.017, flip: true }), M.under);
  for (const [g] of out) g.translate(0, HEAD_Y, 0);
  return out;
}

// ---------------------------------------------------------------- the famous chin
export function buildFace(M) {
  const faceMod = (a, y) => {
    const A = Math.abs(a); let m = 0;
    m += 0.034 * gauss(a, 0, 0.13) * gauss(y, 0.072, 0.03) + 0.014 * gauss(a, 0, 0.1) * gauss(y, 0.112, 0.03);    // nose + bridge
    m += 0.009 * gauss(A, 0.17, 0.07) * gauss(y, 0.05, 0.014);                                                     // nostril wings
    m -= 0.007 * gauss(a, 0, 0.12) * gauss(y, 0.037, 0.0065);                                                      // under the nose
    m -= 0.003 * gauss(a, 0, 0.035) * gauss(y, 0.022, 0.012);                                                      // philtrum
    const ym = -0.007 - 0.03 * Math.pow(Math.min(1, A / 0.44), 2), mw = 1 - sstep(0.36, 0.47, A);                  // downturned mouth
    m -= 0.0105 * gauss(y, ym, 0.0034) * mw;
    m += 0.005 * gauss(y, ym + 0.009, 0.0055) * mw + 0.0065 * gauss(y, ym - 0.011, 0.007) * mw;                    // lips
    m -= 0.0045 * gauss(y, -0.058, 0.01) * (1 - sstep(0.3, 0.5, A));                                               // under the lip
    m += 0.021 * gauss(y, -0.092, 0.024) * (1 - sstep(0.38, 0.66, A));                                             // chin pad
    m += 0.007 * gauss(A, 0.64, 0.12) * gauss(y, -0.088, 0.02);                                                    // jaw angle
    m -= 0.0035 * gauss(a, 0, 0.035) * gauss(y, -0.092, 0.018);                                                    // cleft
    const t = clamp((0.056 - y) / 0.1, 0, 1), af = 0.25 + 0.25 * t, s = Math.sin(Math.PI * t);                       // nasolabial folds
    m += -0.0065 * gauss(A, af, 0.032) * s + 0.0055 * gauss(A, af + 0.085, 0.06) * s;
    m += 0.009 * gauss(A, 0.95, 0.25) * gauss(y, -0.01, 0.05);                                                     // masseters
    return m;
  };
  const S = new Surf([
    { y: -0.142, rx: 0.07, rz: 0.11, cz: 0.05 },
    { y: -0.128, rx: 0.108, rz: 0.15, cz: 0.04 },
    { y: -0.105, rx: 0.136, rz: 0.17, cz: 0.04, e: 3.3 },
    { y: -0.07, rx: 0.155, rz: 0.177, cz: 0.03, e: 3.3 },
    { y: -0.03, rx: 0.176, rz: 0.18, cz: 0.022, e: 3.0 },
    { y: 0.02, rx: 0.19, rz: 0.182, cz: 0.02, e: 3.0 },
    { y: 0.07, rx: 0.2, rz: 0.18, cz: 0.018, e: 3.0 },
    { y: 0.13, rx: 0.205, rz: 0.17, cz: 0.012 },
  ], { e: 2.8, mod: faceMod });
  const ys = [...lin(-0.142, -0.072, 8), ...lin(-0.066, 0.03, 26), ...lin(0.038, 0.13, 9)];
  const g = loftGeo(S, { ys, a0: -1.5, a1: 1.5, na: 32, uvScale: 2.5 });
  g.translate(0, HEAD_Y, 0);
  return [[g, M.skin]];
}

// ---------------------------------------------------------------- gloved fist (left hand: lateral = +X). Grip axis along Z through (0, -0.1)
export function fistGeos(M) {
  const out = [], P = (g, m) => { out.push([g, m]); return g; };
  const C = [0.0, -0.1];
  const hand = new Surf([
    { y: -0.098, rx: 0.026, rz: 0.049, cx: 0.036 },
    { y: -0.085, rx: 0.034, rz: 0.054, cx: 0.03 },
    { y: -0.05, rx: 0.041, rz: 0.055, cx: 0.016 },
    { y: -0.015, rx: 0.04, rz: 0.051, cx: 0.008 },
    { y: 0.025, rx: 0.036, rz: 0.046, cx: 0.004 },
  ], { e: 2.7 });
  P(loftGeo(hand, { ys: lin(-0.098, 0.025, 9), na: 28, cap0: 0.012 }), M.green);
  const R = 0.049, d2r = Math.PI / 180;
  const fingers = [[0.036, 0.0215, 0.021, 1.0], [0.0118, 0.0228, 0.022, 1.0], [-0.012, 0.0218, 0.021, 0.97], [-0.0345, 0.0188, 0.0185, 0.86]];
  const seg = [[16, -62], [-66, -128], [-132, -184]];
  for (const [z, w, th, ls] of fingers) {
    for (let s = 0; s < 3; s++) {
      let [t0, t1] = seg[s]; if (s > 0) { t0 = seg[0][1] + (t0 - seg[0][1]) * ls; t1 = seg[0][1] + (t1 - seg[0][1]) * ls; }
      const pts = lin(t0, t1, 5).map((t) => V(C[0] + Math.cos(t * d2r) * R, C[1] + Math.sin(t * d2r) * R, z));
      const tip = s === 2;
      P(sweepGeo(pts, rrect(w, th, Math.min(w, th) * 0.46, 2), { up: V(0, 0, 1), scale: (u) => (tip && u > 0.6 ? Math.sqrt(Math.max(0.05, 1 - ((u - 0.6) / 0.4) ** 2)) * 0.15 + 0.85 * (1 - ((u - 0.6) / 0.4) ** 3) : 1) }), M.green);
      if (s === 0) { // knuckle plate on the proximal phalanx
        const ang = -18 * d2r, rr = R + th * 0.5 + 0.002, p = V(C[0] + Math.cos(ang) * rr, C[1] + Math.sin(ang) * rr, z);
        P(xf(smoothBox(0.03, 0.007, w * 0.86), frame(p, V(Math.cos(ang), Math.sin(ang), 0), V(0, 0, 1))), M.greenDark);
      }
    }
  }
  // knuckle guard across the MCP joints + studs
  {
    const ang = 16 * d2r, rr = R + 0.016, pts = lin(-0.05, 0.05, 8).map((z) => V(C[0] + Math.cos(ang) * rr, C[1] + Math.sin(ang) * rr, z));
    P(sweepGeo(pts, rrect(0.026, 0.016, 0.0075, 3), { up: V(Math.cos(ang), Math.sin(ang), 0) }), M.greenDark);
    for (const z of [-0.034, -0.012, 0.012, 0.036]) P(xf(rivetGeo(0.0065, 0.7, 8), frame(V(C[0] + Math.cos(ang) * (rr + 0.008), C[1] + Math.sin(ang) * (rr + 0.008), z), V(Math.cos(ang), Math.sin(ang), 0))), M.gold);
  }
  // back-of-hand armour plate
  P(xf(smoothBox(0.074, 0.012, 0.072), frame(V(0.058, -0.045, 0.002), V(1, 0.12, 0), V(0, 0, 1))), M.greenDark);
  // thumb: wraps from the thenar round the front of the grip over the index / middle fingers
  {
    const z = 0.026, segs = [[112, 172, 0.071, 0.034, 0.03], [176, 222, 0.07, 0.025, 0.023], [226, 266, 0.068, 0.022, 0.02]];
    segs.forEach(([t0, t1, rr, w, th], i) => {
      const pts = lin(t0, t1, 5).map((t) => V(C[0] + Math.cos(t * d2r) * rr, C[1] + Math.sin(t * d2r) * rr, z + (i === 0 ? (1 - (t - t0) / (t1 - t0)) * 0.012 : 0)));
      P(sweepGeo(pts, rrect(w, th, Math.min(w, th) * 0.46, 2), { up: V(0, 0, 1), scale: (u) => (i === 2 && u > 0.6 ? 0.85 * (1 - ((u - 0.6) / 0.4) ** 3) + 0.15 : 1) }), M.green);
    });
  }
  return out;
}
// rounded slab (x = w, y = t thickness, z = h) as a smooth-shaded RoundedBox
export function smoothBox(w, t, h, r) {
  const g = new THREE.BoxGeometry(w, t, h, 3, 2, 3);
  const rad = r ?? Math.min(w, t, h) * 0.45;
  return deform(g, (v) => {
    // push vertices toward a rounded box (superellipse-ish) shape
    const ax = w / 2, ay = t / 2, az = h / 2;
    const cx = clamp(v.x, -ax + rad, ax - rad), cy = clamp(v.y, -ay + rad * 0.5, ay - rad * 0.5), cz = clamp(v.z, -az + rad, az - rad);
    const dx = v.x - cx, dy = v.y - cy, dz = v.z - cz, l = Math.hypot(dx, dy, dz);
    if (l > 1e-9) { const k = Math.min(rad, l) / l; v.set(cx + dx * k, cy + dy * k, cz + dz * k); }
  });
}

// ---------------------------------------------------------------- pauldrons
// Both are authored for the LEFT shoulder (outward = +X) and mirrored for the right.
// Pad frame: origin near the shoulder joint, +Y up, +Z forward.  a = PI/2 faces outward.
function padSurf(k = 1) {
  return new Surf([
    { y: -0.205 * k, rx: 0.196 * k, rz: 0.228 * k, cx: 0.034 * k },
    { y: -0.125 * k, rx: 0.21 * k, rz: 0.244 * k, cx: 0.026 * k },
    { y: -0.035 * k, rx: 0.212 * k, rz: 0.246 * k, cx: 0.012 * k },
    { y: 0.045 * k, rx: 0.194 * k, rz: 0.229 * k, cx: 0.0 },
    { y: 0.105 * k, rx: 0.152 * k, rz: 0.184 * k, cx: -0.01 * k },
    { y: 0.145 * k, rx: 0.096 * k, rz: 0.118 * k, cx: -0.014 * k },
    { y: 0.163 * k, rx: 0.046 * k, rz: 0.056 * k, cx: -0.016 * k },
    { y: 0.17 * k, rx: 0.0, rz: 0.0, cx: -0.016 * k },
  ], { e: 2.0 });
}
const padMatrix = () => new THREE.Matrix4().compose(V(0.05, 0.125, -0.008), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.4)), V(1.1, 1.08, 1.1));
const finishPad = (out, sx) => { const m = padMatrix(); for (const [g] of out) { g.applyMatrix4(m); if (sx < 0) mirrorX(g); } return out; };
// a fat roll that wraps the outer side and tapers away toward the neck (lens-shaped band)
function roll(S, yc, hh, span, h0, t, bulge, na = 34) {
  const oa = Math.PI / 2, env = (a) => Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs((a - oa) / span), 2.6)));
  return bandGeo(S, (a) => yc - hh * env(a), (a) => yc + hh * env(a), { a0: oa - span, a1: oa + span, na, t, bulge, bulgeSeg: 3, r: t * 0.7, h0, tscale: (a) => 0.2 + 0.8 * env(a), nc: 2 });
}

// big ribbed shell: a segmented dome - smooth crown over three fat rolls on a dark-gold body, tucked in at the bottom
export function ribbedPauldron(M, sx) {
  const out = [], P = (g, m) => { out.push([g, m]); return g; };
  const S = new Surf([
    { y: -0.215, rx: 0.152, rz: 0.182, cx: 0.03 },
    { y: -0.15, rx: 0.196, rz: 0.228, cx: 0.03 },
    { y: -0.06, rx: 0.216, rz: 0.248, cx: 0.018 },
    { y: 0.03, rx: 0.206, rz: 0.238, cx: 0.004 },
    { y: 0.1, rx: 0.166, rz: 0.193, cx: -0.008 },
    { y: 0.145, rx: 0.106, rz: 0.126, cx: -0.014 },
    { y: 0.166, rx: 0.05, rz: 0.06, cx: -0.016 },
    { y: 0.173, rx: 0.0, rz: 0.0, cx: -0.016 },
  ], { e: 2.0 });
  P(loftBetween(S, () => 0.026, () => 0.173, { na: 48, ns: 9, h: 0.022 }), M.gold);
  P(loftGeo(S, { ys: lin(-0.222, 0.04, 8), a0: Math.PI / 2 - 2.75, a1: Math.PI / 2 + 2.75, na: 36, h: 0.012 }), M.goldDark);
  P(rimGeo(S, lin(0, TAU, 49).slice(0, 48).map((a) => [a, 0.03]), 0.012, 0.024, { closed: true, seg: 7 }), M.goldDark);
  const R = [[-0.022, 0.052, 2.62, 0.016], [-0.106, 0.05, 2.5, 0.014], [-0.182, 0.042, 2.3, 0.01]];
  for (const [yc, hh, sp, h0] of R) P(roll(S, yc, hh, sp, h0, 0.016, 0.028), M.gold);
  for (const [yc, , , h0] of R) for (const e of [-1, 1]) { const a = Math.PI / 2 + e * 1.55; P(xf(rivetGeo(0.0095, 0.6, 7), frame(S.at(a, yc, h0 + 0.036), S.nrm(a, yc))), M.metal); }
  P(loftGeo(S, { ys: lin(-0.23, 0.04, 6), a0: Math.PI / 2 - 2.8, a1: Math.PI / 2 + 2.8, na: 36, h: 0.004, flip: true }), M.goldDark);   // inside of the shell
  return finishPad(out, sx);
}

// eagle pauldron: dark-gold dome; the eagle stands on top glaring outward, both wings draped over the pad (front + back)
export function eaglePauldron(M, sx) {
  const out = [], P = (g, m) => { out.push([g, m]); return g; };
  const S = padSurf(0.97);
  P(loftBetween(S, () => -0.13, () => 0.165, { na: 48, ns: 11, h: 0.014 }), M.goldDark);
  P(roll(S, -0.168, 0.046, 2.45, 0.008, 0.015, 0.02), M.gold);
  P(loftGeo(S, { ys: lin(-0.23, 0.0, 5), a0: Math.PI / 2 - 2.6, a1: Math.PI / 2 + 2.6, na: 36, h: 0.004, flip: true }), M.goldDark);   // inside of the shell
  // ---- folded wings: overlapping rows of long feathers hanging down the outer half of the pad, front and back.
  // Each feather is swept flat (lens profile with a raised rachis, pointed tip) and mapped through the pad
  // surface's own (angle, height, lift) parameters so it lies on the dome.
  {
    const oa = Math.PI / 2, prof = [[0.5, 0], [0.25, 0.42], [0, 0.5], [-0.25, 0.42], [-0.5, 0], [-0.25, -0.28], [0.25, -0.28]];
    const widthAt = (t) => (t < 0.35 ? 0.62 + 0.38 * Math.sin((t / 0.35) * Math.PI / 2) : Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.35) / 0.65, 2.2))));
    // rows (top to bottom drawn last-to-first so upper rows overlap lower ones):
    // [y root, count, a-span from the outer meridian (rad), length, width, thickness, lift, tilt, tip flare, material]
    const rows = [
      [0.025, 11, 2.25, 0.27, 0.052, 0.011, 0.016, 0.34, 0.05, M.gold],
      [0.09, 10, 2.0, 0.18, 0.05, 0.01, 0.031, 0.27, 0.018, M.goldDark],
      [0.14, 8, 1.75, 0.12, 0.046, 0.009, 0.045, 0.2, 0.012, M.gold],
    ];
    for (const [yr, n, span, L, wd, tk, lift, tilt, flare, mat] of rows) {
      const parts = [];
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1), off = (t - 0.5) * 2 * span, a0 = oa + off, th = Math.sign(off) * tilt * Math.pow(Math.abs(off) / span, 0.8);
        const [Ra] = S.metric(a0, yr), len = L * (1 - 0.16 * Math.abs(off) / span);
        const path = lin(0, len, 5).map((y) => V(0.004 * Math.sin((y / len) * Math.PI), y, 0));
        const g = sweepGeo(path, prof.map(([x, y]) => [x * wd, y * tk]), { up: V(-1, 0, 0), scale: (u) => [Math.max(0.04, widthAt(u)), 0.55 + 0.45 * Math.max(0.04, widthAt(u))] });
        const c = Math.cos(th), s = Math.sin(th), hh = lift + (i % 2) * 0.0035;
        parts.push(deform(g, (v) => {
          const X = v.x * c - v.y * s, Y = v.x * s + v.y * c, k = Y / len;
          v.copy(S.at(a0 - X / Ra, yr - Y, hh + v.z + 0.004 + flare * k * k * k));   // x -> -a keeps the winding outward; tips flare off the dome
        }, { smooth: false }));
      }
      P(mergeGeos(parts), mat);
    }
  }
  // ---- body: breast + shoulders of the bird on the crown, head in profile glaring outward
  {
    const body = new Surf([
      { y: -0.06, rx: 0.0, rz: 0.0 },
      { y: -0.05, rx: 0.05, rz: 0.06 },
      { y: 0.0, rx: 0.072, rz: 0.085 },
      { y: 0.05, rx: 0.06, rz: 0.07 },
      { y: 0.085, rx: 0.042, rz: 0.048 },
      { y: 0.105, rx: 0.0, rz: 0.0 },
    ], { e: 2.0 });
    const bg = loftGeo(body, { ys: lin(-0.06, 0.105, 10), na: 20 });
    bg.rotateZ(-0.5); bg.translate(0.05, 0.135, 0.0); P(bg, M.gold);
    const head = new Surf([
      { y: -0.052, rx: 0.0, rz: 0.0, cz: 0.006 },
      { y: -0.044, rx: 0.036, rz: 0.038, cz: 0.006 },
      { y: -0.018, rx: 0.05, rz: 0.054, cz: 0.01 },
      { y: 0.014, rx: 0.048, rz: 0.05, cz: 0.012 },
      { y: 0.04, rx: 0.036, rz: 0.044, cz: 0.008 },
      { y: 0.06, rx: 0.026, rz: 0.038, cz: 0.002 },
      { y: 0.082, rx: 0.019, rz: 0.03, cz: -0.008 },
      { y: 0.1, rx: 0.012, rz: 0.021, cz: -0.022 },
      { y: 0.111, rx: 0.006, rz: 0.012, cz: -0.036 },
      { y: 0.116, rx: 0.0, rz: 0.0, cz: -0.044 },
    ], { e: 2.0, mod: (a, y) => 0.013 * gauss(Math.abs(wrapA(a)), 0.72, 0.28) * gauss(y, 0.032, 0.018) - 0.005 * gauss(Math.abs(wrapA(a)), Math.PI / 2, 0.12) * gauss(y, 0.075, 0.025) });
    // local +Y (beak) -> outward +X, local +Z (crown) -> up
    const place = (g) => { g.scale(1.22, 1.22, 1.22); g.rotateX(-Math.PI / 2); g.rotateY(Math.PI); g.rotateY(Math.PI / 2 - 0.25); g.translate(0.112, 0.238, 0.015); return g; };
    P(place(loftGeo(head, { ys: lin(-0.052, 0.116, 16), na: 18 })), M.gold);
    P(place(mergeGeos([-1, 1].map((e) => new THREE.SphereGeometry(0.0105, 8, 6).translate(e * 0.043, 0.026, 0.02)))), M.metal);
    // feathered ruff joining head and body
    P(sweepGeo(new THREE.CatmullRomCurve3([V(0.045, 0.145, 0.0), V(0.075, 0.2, 0.006), V(0.1, 0.228, 0.012)]).getSpacedPoints(6), ellipse(0.06, 0.066, 14), { up: V(0, 0, 1), scale: (t) => 1 - 0.25 * t }), M.gold);
  }
  return finishPad(out, sx);
}

// ---------------------------------------------------------------- boot foot (ankle space; sole bottom at y = -0.06)
export function bootFootGeos(M, sx) {
  const out = [], P = (g, m) => { out.push([g, m]); return g; };
  // surface authored along +Y = forward; rotateX(+90deg) maps local y -> +z, local z -> -y (so cz < 0 lifts the section)
  const S = new Surf([
    { y: -0.108, rx: 0.0, rz: 0.0, cz: -0.036 },
    { y: -0.1, rx: 0.05, rz: 0.046, cz: -0.036 },
    { y: -0.084, rx: 0.068, rz: 0.06, cz: -0.032 },
    { y: -0.04, rx: 0.077, rz: 0.064, cz: -0.034 },
    { y: 0.03, rx: 0.083, rz: 0.052, cz: -0.022 },
    { y: 0.1, rx: 0.088, rz: 0.041, cz: -0.011 },
    { y: 0.17, rx: 0.089, rz: 0.034, cz: -0.005 },
    { y: 0.226, rx: 0.08, rz: 0.031, cz: -0.003 },
    { y: 0.258, rx: 0.055, rz: 0.027, cz: -0.002 },
    { y: 0.27, rx: 0.0, rz: 0.0, cz: -0.002 },
  ], { e: 2.9 });
  const g = loftGeo(S, { ys: lin(-0.108, 0.268, 18), na: 30 });
  g.rotateX(Math.PI / 2); P(g, M.green);
  // toe cap + heel counter (darker reinforcement plates)
  const toe = plateAY(S, [[Math.PI - 1.75, 0.14], [Math.PI + 1.75, 0.14], [Math.PI + 1.75, 0.262], [Math.PI - 1.75, 0.262]], { round: 0.02, t: 0.004, h0: 0.0, bevel: 0.002, n: 32, nI: 2, nB: 2 });
  toe.rotateX(Math.PI / 2); P(toe, M.greenDark);
  const heel = plateAY(S, [[Math.PI - 1.87, -0.1], [Math.PI + 1.87, -0.1], [Math.PI + 1.8, -0.045], [Math.PI - 1.8, -0.045]], { round: 0.015, t: 0.004, h0: 0.0, bevel: 0.002, n: 28, nI: 2, nB: 2 });
  heel.rotateX(Math.PI / 2); P(heel, M.greenDark);
  // sole: midsole + outsole + lugs (rubber)
  const outline = (k) => smoothPoly([[0, -0.116], [0.06, -0.106], [0.074, -0.06], [0.078, 0.0], [0.09, 0.08], [0.096, 0.16], [0.088, 0.23], [0.06, 0.272], [0, 0.284], [-0.06, 0.272], [-0.088, 0.23], [-0.096, 0.16], [-0.09, 0.08], [-0.078, 0.0], [-0.074, -0.06], [-0.06, -0.106]].map(([x, z]) => [x * k, z * k - (k - 1) * 0.08]), 40);   // shape y = +z (rotateX(+90deg) maps it to +z)
  const slab = (k, depth, y, bev) => { const e = extrudeGeo(outline(k), depth, { bevel: bev, seg: 1 }); e.rotateX(Math.PI / 2); e.translate(0, y, 0); return e; };
  P(slab(1.025, 0.006, -0.026, 0.002), M.greenDark);                       // stitched welt
  P(slab(1.0, 0.012, -0.036, 0.004), M.rubber);                            // midsole
  P(slab(0.985, 0.01, -0.051, 0.003), M.rubber);                           // outsole
  P(xf(smoothBox(0.134, 0.014, 0.074, 0.006), new THREE.Matrix4().makeTranslation(0, -0.051, -0.07)), M.rubber);   // heel block
  const lugs = [];
  for (const [x, z] of [[-0.04, -0.085], [0.04, -0.085], [-0.045, -0.04], [0.045, -0.04], [0, -0.062], [-0.055, 0.1], [0.0, 0.1], [0.055, 0.1], [-0.058, 0.16], [0.0, 0.16], [0.058, 0.16], [-0.04, 0.22], [0.04, 0.22], [0.0, 0.255]]) {
    const b = new THREE.BoxGeometry(0.034, 0.008, 0.026); b.rotateY(0.35 * Math.sign(x || 1)); b.translate(x, -0.0565, z); lugs.push(b);
  }
  P(mergeGeos(lugs), M.rubber);
  // heel counter strap + buckle on the instep strap
  const strap = bandGeo(S, 0.0, 0.03, { t: 0.006, na: 30, a0: Math.PI - 1.75, a1: Math.PI + 1.75 }); strap.rotateX(Math.PI / 2); P(strap, M.greenDark);
  const bk = plateGeo(S, rrect(0.03, 0.028, 0.005, 2), { center: [Math.PI - sx * 0.95, 0.015], t: 0.006, h0: 0.006, bevel: 0.002, n: 24, nI: 2 }); bk.rotateX(Math.PI / 2); P(bk, M.gold);
  return out;
}
