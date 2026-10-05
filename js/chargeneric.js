import * as THREE from 'three';
import { mulberry32 } from './util.js';
import { buildLook } from './chargeneric_body.js';
import { skinAtlas, underAtlas } from './chargeneric_paint.js';
import { atlasFor, lookSpec, lookCount, PALETTES, SKIN_TONES, HAIR } from './chargeneric_looks.js';
import { perpMaterial } from './chargeneric_tex.js';
import { makeGun } from './propsperp.js';

// ===========================================================================
// Generic perps / civilians (thug, gunman, brute, junkie, biker, boss, civ).
//
// A LOOK (outfit + body + face + headgear) is built once into per-bone indexed geometry and cached;
// atlases are painted once and shared.  Each new Character only gets:
//   * meshes that reference the cached geometry (one per bone x material slot, ~20-28 per character)
//   * three fresh MeshStandardMaterials (armor / under / skin) carrying its own colour slots
//     (they are also the flash targets of enemies.js setFlash), plus a shared glow material
//   * a seeded palette, skin tone, hair colour and a small height / bulk jitter
//
// Optional Character opts: seed (int), variant|look (look index), palette overrides:
//   armor / under / skin / hair (hex) — used by civs.js / enemies.js.
// ===========================================================================
const KITS = new Map();
const GLOW = new Map();
export const kitStats = { built: 0, ms: 0 };

function getKit(style, idx) {
  const key = style + ':' + idx;
  let k = KITS.get(key);
  if (!k) {
    const t0 = performance.now();
    const spec = lookSpec(style, idx);
    const A = { skin: skinAtlas(), under: underAtlas(), armor: atlasFor(style) };
    const r = buildLook(spec, A);
    let tris = 0; for (const p of r.parts) tris += p.tris;
    k = { ...r, spec, A, tris, ms: performance.now() - t0 };
    KITS.set(key, k); kitStats.built++; kitStats.ms += k.ms;
  }
  return k;
}
function glowMat(hex, A) {
  let m = GLOW.get(hex);
  if (!m) { m = perpMaterial(A, { a: 0x000000, b: 0x000000, c: 0x000000, d: 0x000000, emissive: hex, emissiveIntensity: 1.7, rimK: 0 }); GLOW.set(hex, m); }
  return m;
}
// back surface depth (chest-bone space, behind the sternum line) for slung gear; measured once per kit
function backZ(kit) {
  if (kit.backZ == null) {
    let z = -0.15;
    for (const p of kit.parts) {
      if (p.bone !== 'chest') continue;
      const a = p.geo.attributes.position;
      for (let i = 0; i < a.count; i++) { const x = a.getX(i), y = a.getY(i); if (Math.abs(x) < 0.16 && y > 0.04 && y < 0.3) z = Math.min(z, a.getZ(i)); }
    }
    kit.backZ = z;
  }
  return kit.backZ;
}
const SLING = new THREE.Matrix4(), _vx = new THREE.Vector3(), _vy = new THREE.Vector3(), _vz = new THREE.Vector3();
function slingGun(ch, kit, kind) {
  const g = makeGun(kind), k = kind === 'sawnoff' ? 1.65 : 1.45, tilt = 0.55, c = Math.cos(tilt), s = Math.sin(tilt);
  // barrel (+Z) up over the left shoulder, side flat against the back, grip pointing down-out
  g.quaternion.setFromRotationMatrix(SLING.makeBasis(_vx.set(0, 0, -1), _vy.set(-c, s, 0), _vz.set(s, c, 0)));
  g.scale.setScalar(k);
  const mid = 0.06 * k;
  g.position.set(-s * mid, 0.18 - c * mid, backZ(kit) - 0.03 * k);
  ch.chest.add(g);
}
const col = (h) => new THREE.Color(h);
const mulHex = (h, r, g, b) => { const c = col(h); return new THREE.Color(Math.min(1, c.r * r), Math.min(1, c.g * g), Math.min(1, c.b * b)).getHex(); };
const jitterHex = (h, rng, k = 0.08) => { const c = col(h), hsl = {}; c.getHSL(hsl); c.setHSL((hsl.h + (rng() - 0.5) * k * 0.3 + 1) % 1, Math.min(1, Math.max(0, hsl.s * (1 + (rng() - 0.5) * k))), Math.min(1, Math.max(0, hsl.l * (1 + (rng() - 0.5) * k * 2)))); return c.getHex(); };

const STYLE_TONES = { junkie: [0, 1, 1, 2, 3, 4], default: [0, 1, 1, 2, 2, 3, 3, 4, 5, 6] };
const GLOWS = { junkie: 0x7dff3a, gunman: 0xff3418, boss: 0xff7a20, default: 0xff8030 };
const LIPSTICK = [0x9a1a2a, 0xc0405a, 0x6a2a4a, 0xd06a5a, 0x2a1a22, 0xa05060];

export function buildGeneric(ch, styleName, st) {
  const seed = st.seed ?? ((Math.random() * 0x7fffffff) | 0);
  const rng = mulberry32(seed);
  const n = lookCount(styleName);
  const idx = st.variant ?? st.look ?? Math.floor(rng() * n);
  const kit = getKit(styleName, idx);
  const spec = kit.spec, A = kit.A;
  ch.look = { style: styleName, idx, seed };
  // joints that depend on the build
  ch.shL.position.set(kit.W, 0.36, 0); ch.shR.position.set(-kit.W, 0.36, 0);
  ch.hipL.position.set(kit.HW, -0.08, 0); ch.hipR.position.set(-kit.HW, -0.08, 0);
  // hunched builds carry the head forward (the chest geometry leans by the same amount)
  ch.neck.position.z = 0.06 * (kit.B.hunch || 0);
  if (spec.asym) ch.shR.position.y -= spec.asym;

  // ---- palette
  const pal = (PALETTES[styleName] || PALETTES.civ)(rng);
  if (spec.pal) for (const key of ['armor', 'under']) (spec.pal[key] || []).forEach((opts, i) => { if (opts && opts.length) pal[key][i] = opts[Math.floor(rng() * opts.length)]; });
  const arm = pal.armor.map((h) => jitterHex(h, rng)), und = pal.under.map((h) => jitterHex(h, rng, 0.06));
  if (st.armor != null) arm[0] = st.armor;
  if (st.under != null) und[0] = st.under;
  const tones = STYLE_TONES[styleName] || STYLE_TONES.default;
  let tone = st.skin ?? SKIN_TONES[tones[Math.floor(rng() * tones.length)]];
  tone = jitterHex(tone, rng, 0.05);
  if (styleName === 'junkie') tone = mulHex(tone, 0.86, 0.95, 0.8); // sallow, sickly
  let hair = st.hair ?? pal.hair;
  if (spec.old) hair = HAIR.gray[Math.floor(rng() * HAIR.gray.length)];
  hair = jitterHex(hair, rng, 0.06);
  const fem = spec.sex === 'f';
  let lips = mulHex(tone, 0.82, 0.6, 0.6);
  if (fem && rng() < 0.75) lips = LIPSTICK[Math.floor(rng() * LIPSTICK.length)];
  if (styleName === 'junkie') lips = jitterHex(0x5a8a3a, rng, 0.1);
  const eyeWhite = styleName === 'junkie' ? 0xd8cc9a : 0xe6e0d6;
  const rim = st.rim ?? 0x8a9ac8;

  // ---- materials (fresh per character: enemies.js flashes armor/under/skin emissive)
  // rain-soaked city: outer layers a touch glossier than their dry atlas values; stronger rim pops silhouettes at night
  const wet = st.wet ?? 0.84;
  const armor = perpMaterial(A.armor, { a: arm[0], b: arm[1], c: arm[2], d: arm[3], rim, rough: wet, rimK: 0.3 });
  const under = perpMaterial(A.under, { a: und[0], b: und[1], c: und[2], d: und[3], rim, rough: 0.5 + 0.5 * wet, rimK: 0.28 });
  const skin = perpMaterial(A.skin, { a: tone, b: hair, c: lips, d: eyeWhite, rim, rimK: 0.22, rough: 0.92 });
  const glow = glowMat(st.glow ?? GLOWS[styleName] ?? GLOWS.default, A.skin);
  const mats = { armor, under, skin, glow };
  for (const p of kit.parts) {
    const m = new THREE.Mesh(p.geo, mats[p.slot] || armor);
    m.castShadow = true; m.userData.slot = p.slot;
    ch[p.bone].add(m);
  }
  ch.mats = { armor, under, gold: armor, skin, boots: under, glow };
  // carried (non-firing) gun slung diagonally across the back
  if (spec.backGun) slingGun(ch, kit, spec.backGun);
  queueWarmup();

  // ---- per-instance proportions: height / bulk jitter, kids and elders
  let hk = 1 + (rng() - 0.5) * 0.08, bk = 1 + (rng() - 0.5) * 0.08;
  ch.head.scale.setScalar(spec.headK ?? (styleName === 'boss' ? 1.12 : styleName === 'brute' ? 1.04 : 1.08));
  if (spec.kid) { hk = 0.66 + rng() * 0.08; ch.head.scale.setScalar(1.3); ch.neck.scale.setScalar(0.92); }
  if (spec.old) hk *= 0.96;
  if (st.height) hk *= st.height;
  const S = st.scale * hk;
  st.scale = S;
  ch.pivot.position.y = 0.9 * S; ch.rigRoot.position.y = -0.9 * S;
  ch.rigRoot.scale.set(S * bk, S, S * bk);
}

// build every look of a style ahead of time (optional warm-up)
export function prewarmGeneric(styles = ['thug', 'gunman', 'brute', 'junkie', 'biker', 'boss', 'civ']) {
  for (const s of styles) for (let i = 0; i < lookCount(s); i++) getKit(s, i);
}
// Idle-time warm-up: after the first character is built, paint the remaining style atlases and build every look
// in small slices whenever the browser is idle, so the first spawn of a gang mid-game doesn't hitch.
let warmQueued = false;
function queueWarmup() {
  if (warmQueued || typeof window === 'undefined') return; warmQueued = true;
  const jobs = [];
  for (const s of ['thug', 'gunman', 'brute', 'junkie', 'boss', 'biker', 'civ']) {
    jobs.push(() => atlasFor(s).textures());
    for (let i = 0; i < lookCount(s); i++) jobs.push(() => getKit(s, i));
  }
  const ric = window.requestIdleCallback ? (f) => window.requestIdleCallback(f, { timeout: 4000 }) : (f) => setTimeout(() => f({ timeRemaining: () => 8 }), 60);
  const step = (dl) => {
    let n = 0;
    while (jobs.length && (n === 0 || dl.timeRemaining() > 12)) { try { jobs.shift()(); } catch (e) { console.warn('perp warm-up', e); } n++; }
    if (jobs.length) ric(step);
  };
  ric(step);
}
export function genericInfo() { const out = []; for (const [k, v] of KITS) out.push(`${k}: ${(v.tris / 1000).toFixed(1)}k tris, ${v.parts.length} meshes, ${v.ms.toFixed(1)} ms`); return out; }
