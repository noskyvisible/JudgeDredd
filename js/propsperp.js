import * as THREE from 'three';
import { Atlas, perpMaterial } from './chargeneric_tex.js';
import { loft, tube, rbox, cylinder, torus, ellipsoid, xform, mat, move, concat, uvRect, uvSet, computeNormals, KitBuilder, piece, flipWinding } from './chargeneric_geo.js';

// ===========================================================================
// Perp weapons: detailed procedural pistols / SMG / revolver / sawn-off and melee (bat, spiked bat,
// pipe, crowbar, machete, cleaver, wrench, sledgehammer).  Geometry + materials are cached per
// variant and shared by every instance (enemies.js disposes geometry on removal -> dispose is a no-op).
//
//   makePistol(color)  -> group, userData.muzzle (Object3D at the barrel end); +Z = barrel, grip down -Y,
//                         the grip sits on the origin (inside the fist of Character.gunMount)
//   makeBat(color,len) -> group, handle along +Z through the origin (inside the fist of Character.toolR)
//   makeMelee(kind), makeGun(kind) for explicit variants.
// ===========================================================================
const S = (name, w, h, paint, opts) => ({ name, w, h, paint, opts });
let ATL = null;
function atlas() {
  if (ATL) return ATL;
  const metal = (P, o) => { P.fill(o.slot || 'A', o.shade ?? 186, { rough: o.rough ?? 0.35, metal: o.metal ?? 1 }); P.grain('metal', 1.2); if (o.wear) P.grime((u, v, n) => n * 0.8, { dark: -0.6, light: 60, rough: -0.15 }); };
  ATL = new Atlas('props', [
    S('wood', 128, 64, (P) => { P.fill('A', 186, { rough: 0.72, metal: 0 }); for (let y = 0; y < P.h; y += 1) P.line([[0, y + Math.sin(y * 0.7) * 2], [P.w, y + Math.sin(y * 0.7 + 3) * 2]], { mul: 0.86 + 0.12 * Math.sin(y * 1.9) * Math.sin(y * 0.37), lw: 1, h: 128 + 30 * Math.sin(y * 1.9), hA: 0.6 }); for (let i = 0; i < 4; i++) P.ellipse(P.rng() * P.w, P.rng() * P.h, 6, 2.5, { mul: 0.65, blur: 1.5 }); P.grime((u, v, n) => n * n, { dark: 0.3 }); }),
    S('tape', 64, 64, (P) => { P.fill('B', 120, { rough: 0.95, metal: 0 }); for (let y = -64; y < 128; y += 7) P.line([[0, y], [P.w, y + 28]], { mul: 0.55, lw: 1.6, h: 70 }); P.grain('cotton', 1); }),
    S('steel', 64, 64, (P) => metal(P, { slot: 'C', shade: 200, rough: 0.38, metal: 0.7 })),
    S('dark', 64, 64, (P) => { metal(P, { slot: 'A', shade: 196, rough: 0.45, metal: 0.6 }); for (let y = 4; y < 60; y += 6) P.rect(0, y, 64, 1.5, { mul: 0.7, h: 80 }); P.grime((u, v, n) => n * 0.6, { dark: 0.25 }); }),
    S('polymer', 64, 64, (P) => { P.fill('B', 186, { rough: 0.7, metal: 0 }); for (let x = 0; x < P.w; x += 4) for (let y = 0; y < P.h; y += 4) P.rect(x, y, 2, 2, { mul: 0.8, h: 90, hA: 0.8 }); }),
    S('rust', 64, 64, (P) => { P.fill('C', 150, { rough: 0.8, metal: 0.4 }); P.grain('plate', 1.5); P.grime((u, v, n) => n * 1.4, { dark: 0.2, rough: 0.2 }); for (let i = 0; i < 40; i++) P.ellipse(P.rng() * P.w, P.rng() * P.h, 2 + P.rng() * 6, 2 + P.rng() * 5, { slot: 'D', shade: 140 + P.rng() * 40, alpha: 0.6, rough: 0.95, metal: 0.1, blur: 1 }); }),
    S('blade', 128, 32, (P) => { P.fill('C', 205, { rough: 0.32, metal: 0.7 }); P.rect(0, P.h * 0.72, P.w, P.h * 0.28, { add: 70, rough: 0.2 }); P.grain('metal', 1); for (let i = 0; i < 8; i++) P.ellipse(P.rng() * P.w, P.rng() * P.h * 0.7, 3 + P.rng() * 5, 2 + P.rng() * 3, { slot: 'D', shade: 140, alpha: 0.3, rough: 0.8, metal: 0.2, blur: 1 }); }),
    S('leatherGrip', 64, 64, (P) => { P.fill('B', 150, { rough: 0.6, metal: 0 }); for (let y = -64; y < 128; y += 9) P.line([[0, y], [P.w, y + 30]], { mul: 0.55, lw: 2.2, h: 60 }); P.grain('leather', 1); }),
    S('glowStrip', 32, 32, (P) => P.fill('D', 230, { rough: 0.2, metal: 0 })),
  ], { width: 256 });
  return ATL;
}
const MATS = new Map();
function material(key, cols) {
  let m = MATS.get(key);
  if (!m) { m = perpMaterial(atlas(), { a: cols[0], b: cols[1], c: cols[2], d: cols[3], rimK: 0.15 }); MATS.set(key, m); }
  return m;
}
const GEOS = new Map();
function cachedGeo(key, build) {
  let g = GEOS.get(key);
  if (!g) {
    const K = new KitBuilder({ w: [0, 0, 0] });
    build((P, swatch) => K.add('w', 'm', P, { rect: atlas().uv(swatch), aoK: 0 }));
    g = K.build()[0].geo; GEOS.set(key, g);
  }
  return g;
}
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ------------------------------------------------------------------------------------------------ guns
const GUNS = {
  // semi-auto pistol: slide with serrations, frame, raked grip, trigger guard, sights
  auto(add) {
    const slide = rbox(0.034, 0.042, 0.2, 0.006, 1); move(slide, 0, 0.074, 0.06); add(slide, 'dark');
    const port = rbox(0.002, 0.016, 0.04, 0.001, 0); move(port, 0.0175, 0.08, 0.06); add(port, 'steel');
    const frame = rbox(0.03, 0.026, 0.17, 0.005, 1); move(frame, 0, 0.044, 0.05); add(frame, 'polymer');
    const grip = rbox(0.031, 0.11, 0.048, 0.008, 1); xform(grip, mat(0, -0.008, -0.012, 0.28, 0, 0)); add(grip, 'polymer');
    const mag = rbox(0.033, 0.014, 0.05, 0.003, 0); xform(mag, mat(0, -0.064, -0.028, 0.28, 0, 0)); add(mag, 'dark');
    const tg = torus(0.022, 0.0035, 4, 10, Math.PI); xform(tg, mat(0, 0.03, 0.04, 0, Math.PI / 2, Math.PI)); add(tg, 'polymer');
    const tr = rbox(0.006, 0.02, 0.006, 0.002, 0); xform(tr, mat(0, 0.022, 0.032, -0.3, 0, 0)); add(tr, 'steel');
    const bar = cylinder(0.0075, 0.0075, 0.02, 8); xform(bar, mat(0, 0.074, 0.165, Math.PI / 2, 0, 0)); add(bar, 'steel');
    for (const z of [-0.03, 0.15]) { const s = rbox(0.008, 0.008, 0.008, 0.002, 0); move(s, 0, 0.099, z); add(s, 'steel'); }
    return { muzzle: [0, 0.074, 0.18] };
  },
  revolver(add) {
    const bar = cylinder(0.011, 0.011, 0.17, 10); xform(bar, mat(0, 0.072, 0.12, Math.PI / 2, 0, 0)); add(bar, 'steel');
    const rib = rbox(0.01, 0.012, 0.17, 0.003, 0); move(rib, 0, 0.086, 0.12); add(rib, 'steel');
    const cyl = cylinder(0.024, 0.024, 0.045, 12); xform(cyl, mat(0, 0.062, 0.015, Math.PI / 2, 0, 0)); add(cyl, 'steel');
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2, f = cylinder(0.004, 0.004, 0.046, 5); xform(f, mat(Math.cos(a) * 0.024, 0.062 + Math.sin(a) * 0.024, 0.015, Math.PI / 2, 0, 0)); add(f, 'dark'); }
    const frame = rbox(0.026, 0.05, 0.08, 0.006, 1); move(frame, 0, 0.055, 0.0); add(frame, 'dark');
    const grip = rbox(0.03, 0.1, 0.042, 0.012, 1); xform(grip, mat(0, -0.005, -0.03, 0.42, 0, 0)); add(grip, 'wood');
    const ham = rbox(0.008, 0.02, 0.016, 0.003, 0); xform(ham, mat(0, 0.088, -0.035, -0.5, 0, 0)); add(ham, 'steel');
    const tg = torus(0.02, 0.0035, 4, 10, Math.PI); xform(tg, mat(0, 0.032, 0.02, 0, Math.PI / 2, Math.PI)); add(tg, 'dark');
    return { muzzle: [0, 0.072, 0.21] };
  },
  smg(add) {
    const body = rbox(0.036, 0.05, 0.22, 0.006, 1); move(body, 0, 0.07, 0.05); add(body, 'dark');
    const shroud = cylinder(0.014, 0.014, 0.09, 8); xform(shroud, mat(0, 0.07, 0.2, Math.PI / 2, 0, 0)); add(shroud, 'steel');
    for (let i = 0; i < 5; i++) { const h = cylinder(0.015, 0.015, 0.006, 8); xform(h, mat(0, 0.07, 0.17 + i * 0.016, Math.PI / 2, 0, 0)); add(h, 'dark'); }
    const grip = rbox(0.03, 0.09, 0.04, 0.008, 1); xform(grip, mat(0, 0.0, -0.01, 0.2, 0, 0)); add(grip, 'polymer');
    const mag = rbox(0.022, 0.16, 0.03, 0.004, 1); xform(mag, mat(0, -0.02, 0.09, -0.08, 0, 0)); add(mag, 'dark');
    const stock = rbox(0.012, 0.012, 0.14, 0.003, 0); move(stock, 0, 0.085, -0.12); add(stock, 'steel');
    const stock2 = rbox(0.012, 0.05, 0.012, 0.003, 0); move(stock2, 0, 0.065, -0.19); add(stock2, 'steel');
    const tg = torus(0.02, 0.0035, 4, 10, Math.PI); xform(tg, mat(0, 0.034, 0.035, 0, Math.PI / 2, Math.PI)); add(tg, 'polymer');
    const sight = rbox(0.01, 0.016, 0.03, 0.003, 0); move(sight, 0, 0.1, 0.0); add(sight, 'steel');
    const lamp = cylinder(0.008, 0.008, 0.03, 8); xform(lamp, mat(0.02, 0.06, 0.16, Math.PI / 2, 0, 0)); add(lamp, 'glowStrip');
    return { muzzle: [0, 0.07, 0.25] };
  },
  sawnoff(add) {
    for (const x of [-0.013, 0.013]) { const b = cylinder(0.013, 0.013, 0.2, 10); xform(b, mat(x, 0.075, 0.12, Math.PI / 2, 0, 0)); add(b, 'steel'); }
    const rec = rbox(0.04, 0.045, 0.08, 0.008, 1); move(rec, 0, 0.07, -0.0); add(rec, 'dark');
    const fore = rbox(0.034, 0.025, 0.1, 0.008, 1); move(fore, 0, 0.05, 0.08); add(fore, 'wood');
    const grip = rbox(0.032, 0.1, 0.045, 0.012, 1); xform(grip, mat(0, 0.0, -0.035, 0.5, 0, 0)); add(grip, 'wood');
    const tg = torus(0.022, 0.0035, 4, 10, Math.PI); xform(tg, mat(0, 0.035, 0.0, 0, Math.PI / 2, Math.PI)); add(tg, 'dark');
    return { muzzle: [0, 0.075, 0.23] };
  },
};
const GUN_COLS = { auto: [0x1c1d22, 0x2a2b30, 0x8a8c92, 0x7a5a3a], revolver: [0x3a3a40, 0x5a3a20, 0xb8bac0, 0x6a4a2a], smg: [0x18191c, 0x26272b, 0x7a7c82, 0xff5a20], sawnoff: [0x2a2a2c, 0x5a3418, 0x8a8c90, 0x3a2a1a] };
export function makeGun(kind = 'auto', color) {
  const meta = {};
  const geo = cachedGeo('gun:' + kind, (add) => Object.assign(meta, GUNS[kind](add)));
  GUN_META[kind] = GUN_META[kind] || meta.muzzle;
  const cols = GUN_COLS[kind].slice(); if (color != null && kind === 'auto' && color !== 0x333333) cols[0] = color;
  const m = new THREE.Mesh(geo, material('gun:' + kind + ':' + cols[0], cols)); m.castShadow = true;
  const g = new THREE.Group(); g.add(m);
  const mz = new THREE.Object3D(); mz.position.fromArray(GUN_META[kind]); g.add(mz);
  g.userData.muzzle = mz; g.userData.kind = kind;
  return g;
}
const GUN_META = {};
export function makePistol(color) { return makeGun(pick(['auto', 'auto', 'auto', 'revolver', 'smg', 'smg', 'sawnoff']), color); }

// ------------------------------------------------------------------------------------------------ melee
// all along +Z, grip at the origin: handle z -0.12 .. ~0.1, business end towards +z
function lathe(prof, seg = 10) { // prof: [[z, r], ...] -> loft along z
  return loft(prof.map(([z, r], i) => ({ c: [0, 0, z], rx: r, rz: r, ux: [1, 0, 0], uz: [0, 1, 0], v: i / (prof.length - 1) })), { seg, capTop: true, capBot: true, capTopBulge: prof[prof.length - 1][1] * 0.4, capBotBulge: 0.004 });
}
const MELEE = {
  bat(add, L) {
    const prof = [[-0.13, 0.026], [-0.122, 0.03], [-0.112, 0.016], [-0.05, 0.016], [0.1, 0.017], [0.26, 0.024], [0.42, 0.034], [0.6 * L / 0.9, 0.04], [0.74 * L / 0.9, 0.038]];
    const P = lathe(prof, 12); add(P, 'wood');
    const tape = lathe([[-0.11, 0.0172], [-0.105, 0.0178], [0.1, 0.0185], [0.105, 0.018]], 10); add(tape, 'tape');
  },
  alubat(add, L) {
    const prof = [[-0.13, 0.026], [-0.12, 0.028], [-0.11, 0.016], [0.1, 0.016], [0.3, 0.026], [0.46, 0.035], [0.72 * L / 0.9, 0.037], [0.74 * L / 0.9, 0.03]];
    add(lathe(prof, 12), 'steel');
    add(lathe([[-0.11, 0.0172], [0.08, 0.0175]], 10), 'leatherGrip');
  },
  spiked(add, L) {
    MELEE.bat(add, L);
    for (let i = 0; i < 9; i++) { const z = 0.36 + i * 0.045, a = i * 2.2; const n = cylinder(0.0016, 0.0022, 0.05, 4); xform(n, mat(0, 0, 0, 0, 0, Math.PI / 2)); xform(n, mat(Math.cos(a) * 0.045, Math.sin(a) * 0.045, z, 0, 0, a)); add(n, 'steel'); }
    const w = torus(0.04, 0.0025, 4, 12); xform(w, mat(0, 0, 0.5, 0, 0, 0)); add(w, 'steel');
  },
  pipe(add, L) {
    add(lathe([[-0.13, 0.019], [0.62 * L / 0.9, 0.019]], 10), 'rust');
    const j = cylinder(0.027, 0.027, 0.06, 10); xform(j, mat(0, 0, 0.62 * L / 0.9, Math.PI / 2, 0, 0)); add(j, 'rust');
    const el = torus(0.035, 0.02, 8, 8, Math.PI / 2); xform(el, mat(0, -0.035, 0.65 * L / 0.9, 0, -Math.PI / 2, 0)); add(el, 'rust');
    add(lathe([[-0.11, 0.021], [0.06, 0.021]], 10), 'tape');
  },
  crowbar(add, L) {
    const pts = []; const len = 0.7 * L / 0.9;
    for (let i = 0; i <= 6; i++) pts.push([0, 0, -0.12 + (len + 0.12) * i / 6]);
    pts.push([0, 0.03, len + 0.04], [0, 0.07, len + 0.045], [0, 0.09, len + 0.02]);
    add(tube(pts, (t) => (t > 0.85 ? 0.012 * (1.2 - t) * 4 : 0.0125), { seg: 6, e: 1.2 }), 'rust');
    const claw = rbox(0.03, 0.006, 0.04, 0.002, 0); xform(claw, mat(0, -0.004, -0.14, -0.25, 0, 0)); add(claw, 'rust');
  },
  machete(add, L) {
    add(lathe([[-0.12, 0.018], [-0.11, 0.02], [0.05, 0.017], [0.06, 0.022]], 8), 'leatherGrip');
    const guard = rbox(0.01, 0.07, 0.012, 0.003, 0); move(guard, 0, 0.0, 0.065); add(guard, 'steel');
    const bl = piece(); const n = 8, len = 0.52 * L / 0.9;
    for (let i = 0; i <= n; i++) {
      const t = i / n, z = 0.07 + len * t, wTop = 0.006, wide = 0.026 + 0.022 * Math.sin(Math.PI * Math.min(1, t * 1.1)) + (t > 0.8 ? -0.03 * (t - 0.8) / 0.2 : 0);
      for (const [x, y, u] of [[0, wide * 0.9 + 0.008, 0], [0.003, wide * 0.2, 0.3], [0.0008, -wide, 1], [-0.003, wide * 0.2, 0.3]]) { bl.p.push(x, y, z); bl.uv.push(t, 1 - u); bl.a.push(1); }
      void wTop;
    }
    for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) { const a = i * 4 + k, b = i * 4 + (k + 1) % 4, c = a + 4, d = b + 4; bl.ix.push(a, b, d, a, d, c); }
    computeNormals(bl, false); add(bl, 'blade');
  },
  cleaver(add, L) {
    add(lathe([[-0.12, 0.016], [0.06, 0.018]], 8), 'wood');
    const bl = rbox(0.005, 0.11, 0.2, 0.002, 1); move(bl, 0, -0.03, 0.17 * L / 0.9); add(bl, 'blade');
    const hole = cylinder(0.012, 0.012, 0.007, 8); xform(hole, mat(0, 0.0, 0.24, 0, 0, Math.PI / 2)); add(hole, 'dark');
  },
  wrench(add, L) {
    add(lathe([[-0.13, 0.02], [0.52 * L / 0.9, 0.022]], 8), 'dark');
    const hd = rbox(0.04, 0.09, 0.08, 0.008, 1); move(hd, 0, 0.02, 0.56 * L / 0.9); add(hd, 'steel');
    const jaw = rbox(0.036, 0.02, 0.05, 0.004, 0); move(jaw, 0, 0.072, 0.58 * L / 0.9); add(jaw, 'steel');
    add(lathe([[-0.11, 0.022], [0.05, 0.022]], 8), 'tape');
  },
  sledge(add, L) {
    add(lathe([[-0.14, 0.02], [-0.13, 0.024], [0.55 * L / 0.9, 0.019]], 8), 'wood');
    const hd = rbox(0.085, 0.085, 0.085, 0.012, 1); xform(hd, mat(0, 0, 0.6 * L / 0.9, 0, 0, 0, 1, 2.0, 1)); add(hd, 'dark');
    for (const y of [-0.085, 0.085]) { const f = cylinder(0.05, 0.05, 0.012, 10); xform(f, mat(0, y, 0.6 * L / 0.9, 0, 0, 0)); add(f, 'steel'); }
    add(lathe([[-0.12, 0.022], [0.08, 0.022]], 8), 'leatherGrip');
  },
};
const MELEE_COLS = {
  bat: [0x8a6038, 0x1a1a1a, 0x9a9aa0, 0x5a3a20], alubat: [0x3a3a40, 0x2a1a14, 0xb0b4bc, 0x3a3a3a], spiked: [0x7a5432, 0x2a1a1a, 0xa8a8ae, 0x4a3018],
  pipe: [0x3a3a3c, 0x2a2a2c, 0x7a7068, 0x7a4a24], crowbar: [0x3a3a3c, 0x2a2a2c, 0x6a3a2a, 0x8a3a18], machete: [0x3a3a3c, 0x3a2414, 0xb8bcc4, 0x6a4a30],
  cleaver: [0x2a2a2c, 0x3a2a1a, 0xc0c4cc, 0x5a4a3a], wrench: [0x2a3a5a, 0x1a1a1a, 0x9a9ca4, 0x5a5a5a], sledge: [0x2a2a2e, 0x3a2414, 0x8a8c92, 0x6a4a2a],
};
export function makeMelee(kind = 'bat', len = 0.9, color) {
  const geo = cachedGeo('melee:' + kind + ':' + len.toFixed(2), (add) => MELEE[kind](add, len));
  const cols = MELEE_COLS[kind].slice(); if (color != null && (kind === 'bat' || kind === 'spiked')) cols[0] = color;
  const m = new THREE.Mesh(geo, material('melee:' + kind + ':' + cols[0], cols)); m.castShadow = true;
  const g = new THREE.Group(); g.add(m); g.userData.kind = kind;
  return g;
}
// legacy signature used by enemies.js: the boss's dark "bat" becomes a sledgehammer, everyone else
// draws a random street weapon
export function makeBat(color = 0x6a4a2a, len = 0.9) {
  if (color === 0x2a2a2a) return makeMelee(pick(['sledge', 'sledge', 'wrench']), len);
  const kind = pick(['bat', 'bat', 'spiked', 'alubat', 'pipe', 'crowbar', 'machete', 'cleaver', 'wrench']);
  return makeMelee(kind, len, kind === 'bat' || kind === 'spiked' ? undefined : undefined);
}
void uvRect; void uvSet; void ellipsoid; void concat; void flipWinding;
