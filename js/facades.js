import * as THREE from 'three';
import { makeCanvas, mulberry32, normalFromHeight } from './util.js';

// ---------------------------------------------------------------------------
// Procedural building facades.  Each variant is a tileable 512px sheet made of
// four aligned layers:  albedo, emissive (lit windows), "ORM" (G = roughness,
// B = metalness) and a normal map derived from a height layer.
// ---------------------------------------------------------------------------
const FS = 512;

const WARM = [[255, 214, 150], [255, 232, 188], [255, 196, 120], [255, 244, 214]];
const COOL = [[150, 205, 255], [190, 232, 255], [120, 190, 255]];
const PINK = [[255, 110, 190], [255, 150, 90], [255, 90, 120]];
const GREEN = [[140, 255, 190]];

function layers() {
  const [A, a] = makeCanvas(FS, FS), [E, e] = makeCanvas(FS, FS), [H, h] = makeCanvas(FS, FS), [R, r] = makeCanvas(FS, FS);
  e.fillStyle = '#000'; e.fillRect(0, 0, FS, FS);
  return { A, a, E, e, H, h, R, r };
}
const rgb = (c, k = 1) => `rgb(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0})`;

// paint one rectangle into every layer
function rect(L, x, y, w, h, o) {
  if (o.albedo) { L.a.fillStyle = o.albedo; L.a.fillRect(x, y, w, h); }
  if (o.emis !== undefined) { L.e.fillStyle = o.emis; L.e.fillRect(x, y, w, h); }
  if (o.height !== undefined) { const v = o.height | 0; L.h.fillStyle = `rgb(${v},${v},${v})`; L.h.fillRect(x, y, w, h); }
  if (o.rough !== undefined || o.metal !== undefined) { L.r.fillStyle = `rgb(255,${((o.rough ?? 0.85) * 255) | 0},${((o.metal ?? 0) * 255) | 0})`; L.r.fillRect(x, y, w, h); }
}

// concrete / metal base with speckle, blotches and rain streaks
function wallBase(L, rng, base, { rough = 0.86, metal = 0.02, streaks = 40, grime = 0.5 } = {}) {
  rect(L, 0, 0, FS, FS, { albedo: `rgb(${base[0]},${base[1]},${base[2]})`, height: 128, rough, metal });
  // large mottled blotches
  for (let i = 0; i < 70; i++) {
    const x = rng() * FS, y = rng() * FS, r = 20 + rng() * 70, d = (rng() - 0.5) * 26;
    for (const [ox, oy] of [[0, 0], [-FS, 0], [FS, 0], [0, -FS], [0, FS]]) {
      const g = L.a.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, `rgba(${d > 0 ? 255 : 0},${d > 0 ? 255 : 0},${d > 0 ? 255 : 0},${Math.abs(d) / 255 * 3.2})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      L.a.fillStyle = g; L.a.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
  // fine speckle
  for (let i = 0; i < 6000; i++) {
    const x = rng() * FS, y = rng() * FS, l = rng() < 0.5 ? 0 : 255;
    L.a.fillStyle = `rgba(${l},${l},${l},${0.03 + rng() * 0.06})`; L.a.fillRect(x, y, 1 + (rng() * 2 | 0), 1 + (rng() * 2 | 0));
    L.h.fillStyle = `rgba(${l},${l},${l},0.12)`; L.h.fillRect(x, y, 1, 1);
  }
  // vertical rain streaks
  for (let i = 0; i < streaks; i++) {
    const x = rng() * FS, y = rng() * FS, len = 60 + rng() * 220, w = 1 + rng() * 4;
    const g = L.a.createLinearGradient(0, y, 0, y + len); g.addColorStop(0, `rgba(0,0,0,${0.18 * grime})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    L.a.fillStyle = g; L.a.fillRect(x, y, w, len);
    if (y + len > FS) { L.a.fillStyle = g; L.a.fillRect(x, y - FS, w, len); }
  }
}

function drawWindow(L, x, y, w, h, o, rng) {
  const frame = o.frame || '#5d646f';
  const m = o.margin ?? Math.max(3, Math.round(w * 0.1));
  // soft ambient-occlusion halo
  L.a.save(); L.a.shadowColor = 'rgba(0,0,0,0.55)'; L.a.shadowBlur = 8; L.a.fillStyle = frame; L.a.fillRect(x, y, w, h); L.a.restore();
  rect(L, x, y, w, h, { albedo: frame, emis: '#000', height: 150, rough: 0.4, metal: 0.85 });
  const gx = x + m, gy = y + m, gw = w - 2 * m, gh = h - 2 * m;
  const g = L.a.createLinearGradient(0, gy, 0, gy + gh); g.addColorStop(0, o.glassTop || '#26395a'); g.addColorStop(0.5, o.glassMid || '#101b30'); g.addColorStop(1, o.glassBot || '#080d18');
  L.a.fillStyle = g; L.a.fillRect(gx, gy, gw, gh);
  rect(L, gx, gy, gw, gh, { emis: '#000', height: 56, rough: o.glassRough ?? 0.07, metal: o.glassMetal ?? 0.55 });
  // diagonal reflection streak on the glass
  L.a.save(); L.a.beginPath(); L.a.rect(gx, gy, gw, gh); L.a.clip();
  L.a.fillStyle = 'rgba(160,190,255,0.12)'; L.a.beginPath(); L.a.moveTo(gx + gw * 0.15, gy); L.a.lineTo(gx + gw * 0.45, gy); L.a.lineTo(gx + gw * 0.1, gy + gh); L.a.lineTo(gx - gw * 0.2, gy + gh); L.a.fill();
  L.a.restore();
  if (o.lit) {
    const c = o.litCol;
    const eg = L.e.createLinearGradient(0, gy, 0, gy + gh); eg.addColorStop(0, rgb(c, 1.0)); eg.addColorStop(1, rgb(c, 0.55 + rng() * 0.2));
    L.e.fillStyle = eg; L.e.fillRect(gx, gy, gw, gh);
    // blinds: dark slats over the upper part
    if (rng() < 0.45) {
      const frac = 0.25 + rng() * 0.55;
      L.e.fillStyle = 'rgba(0,0,0,0.6)';
      for (let yy = gy; yy < gy + gh * frac; yy += 4) L.e.fillRect(gx, yy, gw, 2);
    }
    // curtains / furniture silhouettes
    if (rng() < 0.35) { L.e.fillStyle = 'rgba(0,0,0,0.5)'; const cw = gw * (0.2 + rng() * 0.25); if (rng() < 0.5) L.e.fillRect(gx, gy, cw, gh); else L.e.fillRect(gx + gw - cw, gy, cw, gh); }
    if (rng() < 0.25) { L.e.fillStyle = 'rgba(0,0,0,0.55)'; L.e.fillRect(gx + gw * 0.3, gy + gh * 0.55, gw * 0.4, gh * 0.45); }
  }
  // mullion & transom
  rect(L, gx + gw / 2 - 1, gy, 2, gh, { albedo: frame, emis: '#000', height: 150, rough: 0.4, metal: 0.85 });
  if (o.transom !== false) rect(L, gx, gy + gh * 0.36, gw, 2, { albedo: frame, emis: '#000', height: 150, rough: 0.4, metal: 0.85 });
  // sill + lintel
  rect(L, x - 3, y + h, w + 6, 4, { albedo: '#7d828c', emis: '#000', height: 190, rough: 0.6, metal: 0.2 });
  L.a.fillStyle = 'rgba(0,0,0,0.35)'; L.a.fillRect(x - 2, y - 3, w + 4, 3);
  // drip stain below
  const sg = L.a.createLinearGradient(0, y + h + 4, 0, y + h + 60); sg.addColorStop(0, 'rgba(0,0,0,0.28)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
  L.a.fillStyle = sg; L.a.fillRect(x + w * 0.1, y + h + 4, w * 0.8, 56);
}

function acUnit(L, x, y, w, h) {
  rect(L, x, y, w, h, { albedo: '#8b9099', emis: '#000', height: 200, rough: 0.5, metal: 0.5 });
  for (let i = 3; i < h - 2; i += 4) rect(L, x + 2, y + i, w - 4, 2, { albedo: '#3a3d44', height: 150 });
  rect(L, x + w - 6, y + 3, 3, 3, { albedo: '#ff7a30', emis: '#ff5a10', height: 205 });
}

function pickLit(rng, mix) {
  const t = rng();
  if (t < mix[0]) return WARM[(rng() * WARM.length) | 0];
  if (t < mix[0] + mix[1]) return COOL[(rng() * COOL.length) | 0];
  if (t < mix[0] + mix[1] + mix[2]) return PINK[(rng() * PINK.length) | 0];
  return GREEN[0];
}

function tex(c, srgb) {
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true; return t;
}

// ---------------------------------------------------------------------------
const VARIANTS = [
  // 0: concrete apartment blocks — AC units, balconies, drips
  (L, rng) => {
    wallBase(L, rng, [66, 66, 74], { streaks: 55, grime: 1 });
    const cols = 6, rows = 4, cw = FS / cols, rh = FS / rows;
    for (let r = 0; r < rows; r++) {
      rect(L, 0, r * rh, FS, 7, { albedo: '#7a7c86', emis: '#000', height: 175, rough: 0.82 });
      rect(L, 0, r * rh + 7, FS, 3, { albedo: '#22232a', height: 90 });
    }
    for (let c = 0; c < cols; c++) rect(L, Math.round(c * cw) - 1, 0, 2, FS, { albedo: '#2c2d34', height: 100 });
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = Math.round(c * cw + (cw - 52) / 2), y = r * rh + 24, lit = rng() < 0.44;
      drawWindow(L, x, y, 52, 70, { lit, litCol: pickLit(rng, [0.7, 0.18, 0.1, 0.02]) }, rng);
      const t = rng();
      if (t < 0.2) { // balcony
        rect(L, x - 8, y + 70 + 6, 68, 8, { albedo: '#757982', height: 205, rough: 0.7 });
        for (let b = 0; b < 68; b += 7) rect(L, x - 8 + b, y + 70 - 18, 2, 24, { albedo: '#16171b', height: 215, metal: 0.8, rough: 0.4 });
        rect(L, x - 8, y + 70 - 18, 68, 2, { albedo: '#16171b', height: 215, metal: 0.8, rough: 0.4 });
      } else if (t < 0.38) acUnit(L, x + 12 + (rng() * 20 | 0), y + 70 + 12, 32, 22);
      else if (t < 0.45) { rect(L, x + 20, y - 18, 3, 14, { albedo: '#222', height: 220 }); rect(L, x + 14, y - 20, 18, 2, { albedo: '#222', height: 220 }); } // antenna
    }
  },
  // 1: office curtain wall — continuous glass, mullions, lit floors with ceiling lights
  (L, rng) => {
    wallBase(L, rng, [44, 48, 58], { rough: 0.5, metal: 0.6, streaks: 20, grime: 0.5 });
    const cols = 8, rows = 4, cw = FS / cols, rh = FS / rows;
    for (let r = 0; r < rows; r++) {
      const y0 = r * rh;
      const litFloor = rng() < 0.45, col = pickLit(rng, [0.45, 0.5, 0.04, 0.01]);
      // spandrel panel
      rect(L, 0, y0 + rh - 34, FS, 34, { albedo: '#242831', emis: '#000', height: 150, rough: 0.4, metal: 0.75 });
      rect(L, 0, y0 + rh - 36, FS, 2, { albedo: '#8c93a0', height: 200, metal: 0.9, rough: 0.3 });
      for (let c = 0; c < cols; c++) {
        const x = Math.round(c * cw), w = Math.round((c + 1) * cw) - x, gy = y0 + 6, gh = rh - 42;
        const g = L.a.createLinearGradient(0, gy, 0, gy + gh); g.addColorStop(0, '#2d4468'); g.addColorStop(0.55, '#111c32'); g.addColorStop(1, '#070b16');
        L.a.fillStyle = g; L.a.fillRect(x + 2, gy, w - 4, gh);
        rect(L, x + 2, gy, w - 4, gh, { emis: '#000', height: 70, rough: 0.05, metal: 0.65 });
        const lit = litFloor ? rng() < 0.85 : rng() < 0.06;
        if (lit) {
          // ceiling strip lights + warm floor wash
          const eg = L.e.createLinearGradient(0, gy, 0, gy + gh); eg.addColorStop(0, rgb(col, 0.35)); eg.addColorStop(1, rgb(col, 0.8));
          L.e.fillStyle = eg; L.e.fillRect(x + 2, gy, w - 4, gh);
          L.e.fillStyle = rgb(col, 1.25); L.e.fillRect(x + 6, gy + 6, w - 12, 3); L.e.fillRect(x + 6, gy + gh * 0.45, w - 12, 3);
          if (rng() < 0.4) { L.e.fillStyle = 'rgba(0,0,0,0.55)'; L.e.fillRect(x + w * 0.2, gy + gh * 0.6, w * 0.35, gh * 0.4); }
        }
        L.a.fillStyle = 'rgba(170,200,255,0.1)'; L.a.beginPath(); L.a.moveTo(x + w * 0.25, gy); L.a.lineTo(x + w * 0.6, gy); L.a.lineTo(x + w * 0.3, gy + gh); L.a.lineTo(x - w * 0.05, gy + gh); L.a.fill();
        rect(L, x, y0, 3, rh, { albedo: '#8e96a4', emis: '#000', height: 190, rough: 0.35, metal: 0.9 });
      }
    }
  },
  // 2: dense megablock cells — structural columns, small neon-lit windows
  (L, rng) => {
    wallBase(L, rng, [58, 56, 66], { streaks: 50, grime: 1 });
    const cols = 10, rows = 6, cw = FS / cols, rh = FS / rows;
    for (let c = 0; c < cols; c += 3) rect(L, Math.round(c * cw) - 6, 0, 12, FS, { albedo: '#6d6d78', emis: '#000', height: 175, rough: 0.8 });
    for (let r = 0; r < rows; r++) rect(L, 0, r * rh, FS, 5, { albedo: '#2a2a32', height: 95 });
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (c % 3 === 0) continue;
      const x = Math.round(c * cw + (cw - 30) / 2), y = Math.round(r * rh + 14), lit = rng() < 0.4;
      drawWindow(L, x, y, 30, 52, { lit, litCol: pickLit(rng, [0.4, 0.2, 0.34, 0.06]), margin: 3, transom: false }, rng);
      if (rng() < 0.12) acUnit(L, x + 4, y + 58, 22, 16);
    }
  },
  // 3: industrial — brick, factory glazing, pipes, vents, hazard stripes
  (L, rng) => {
    wallBase(L, rng, [82, 52, 44], { rough: 0.9, streaks: 70, grime: 1.6 });
    // bricks
    for (let y = 0; y < FS; y += 10) for (let x = -((y / 10) % 2) * 11; x < FS; x += 22) {
      const t = (rng() - 0.5) * 36;
      L.a.fillStyle = `rgb(${96 + t | 0},${54 + t * 0.5 | 0},${44 + t * 0.4 | 0})`; L.a.fillRect(x + 1, y + 1, 20, 8);
      L.h.fillStyle = 'rgb(150,150,150)'; L.h.fillRect(x + 1, y + 1, 20, 8);
    }
    // factory windows
    for (const [x, y] of [[40, 40], [250, 40], [40, 300], [250, 300]]) {
      const w = 170, h = 110; rect(L, x, y, w, h, { albedo: '#2d2f35', height: 160, rough: 0.5, metal: 0.8 });
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
        const px = x + 6 + i * (w - 12) / 4, py = y + 6 + j * (h - 12) / 3, pw = (w - 12) / 4 - 4, ph = (h - 12) / 3 - 4, lit = rng() < 0.2;
        L.a.fillStyle = '#0c1220'; L.a.fillRect(px, py, pw, ph); rect(L, px, py, pw, ph, { emis: lit ? rgb([255, 150, 70], 0.9) : '#000', height: 60, rough: 0.1, metal: 0.5 });
      }
    }
    // pipes
    for (const x of [8, 226, 480]) {
      const g = L.a.createLinearGradient(x, 0, x + 14, 0); g.addColorStop(0, '#2a2a2e'); g.addColorStop(0.45, '#8a8a92'); g.addColorStop(1, '#222226');
      L.a.fillStyle = g; L.a.fillRect(x, 0, 14, FS); rect(L, x, 0, 14, FS, { height: 200, rough: 0.35, metal: 0.9 });
      for (let y = 30; y < FS; y += 90) rect(L, x - 3, y, 20, 6, { albedo: '#18181b', height: 225, metal: 0.8 });
    }
    // hazard stripe band
    for (let x = -20; x < FS + 20; x += 24) { L.a.fillStyle = '#d6a01a'; L.a.beginPath(); L.a.moveTo(x, 470); L.a.lineTo(x + 12, 470); L.a.lineTo(x - 2, 492); L.a.lineTo(x - 14, 492); L.a.fill(); }
    rect(L, 0, 470, FS, 22, { height: 140, rough: 0.6 });
    // vent fans
    for (const [x, y] of [[170, 200], [400, 190]]) {
      L.a.fillStyle = '#18181b'; L.a.beginPath(); L.a.arc(x, y, 26, 0, 7); L.a.fill();
      rect(L, x - 26, y - 26, 52, 52, { height: 140, rough: 0.5, metal: 0.8 });
      L.a.strokeStyle = '#555a62'; L.a.lineWidth = 3; for (let a = 0; a < 6; a++) { L.a.beginPath(); L.a.moveTo(x, y); L.a.lineTo(x + Math.cos(a * 1.05) * 24, y + Math.sin(a * 1.05) * 24); L.a.stroke(); }
    }
    for (let i = 0; i < 5; i++) { const x = rng() * 480, y = rng() * 480; rect(L, x, y, 8, 8, { emis: '#ff6a20', albedo: '#ff6a20', height: 210 }); }
  },
];

export function makeFacadeSet(variant) {
  const rng = mulberry32(900 + variant * 77);
  const L = layers();
  VARIANTS[variant](L, rng);
  // keep the top-left safe corner plain wall (roofs & undersides sample it)
  const sample = L.a.getImageData(300, 300, 1, 1).data;
  rect(L, 0, 0, 12, 12, { albedo: `rgb(${sample[0] * 0.55 | 0},${sample[1] * 0.55 | 0},${sample[2] * 0.55 | 0})`, emis: '#000', height: 128, rough: 0.9, metal: 0 });
  const normal = normalFromHeight(L.H, variant === 3 ? 3.2 : 2.6);
  return { map: tex(L.A, true), emissiveMap: tex(L.E, true), ormMap: tex(L.R, false), normalMap: tex(normal, false) };
}
