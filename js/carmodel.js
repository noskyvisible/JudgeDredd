import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeCanvas, canvasTex, mulberry32 } from './util.js';
import { V3, lin, se, smoothstep, mix, surface, patch, capRing, ringAt, M4, xf, rod, pipe, lathe, warp, tint, patchGlass, cbox, Kit } from './vehicle_geo.js';
import * as TX from './vehicle_tex.js';

// ---------------------------------------------------------------------------
// Mega-City ground traffic.  Eight body types built from parametric surfaces:
//   sedan, coupe, taxi, hatch, police (Justice Dept patrol), van, box truck, city shuttle bus.
// The lower body is a loft whose section bottom rises over each wheel (true wheel arches);
// the greenhouse is a glass loft with opaque paint overlays for the roof and pillars, so the tinted
// windows show a faint interior.  Lights, plates, stripes and signage are conforming overlays.
// Geometry is built once per type and shared; every car gets its own paint + tail materials.
// Cars face +Z, y up, origin on the ground at the centre.  Per car: <= 12 meshes, <= ~4k triangles.
// ---------------------------------------------------------------------------

const rb = (w, h, d, r = 0.03) => cbox(w, h, d, r * 0.7);             // 44-tri chamfered box
const bx = (w, h, d) => new THREE.BoxGeometry(w, h, d);                  // 12-tri box (lamps, interior)
// 1-D Catmull-Rom through [x, y] knots (x descending or ascending), clamped
function spline(knots) {
  const k = knots.slice().sort((a, b) => a[0] - b[0]);
  return (x) => {
    if (x <= k[0][0]) return k[0][1]; if (x >= k[k.length - 1][0]) return k[k.length - 1][1];
    let i = 0; while (x > k[i + 1][0]) i++;
    const p0 = k[Math.max(0, i - 1)], p1 = k[i], p2 = k[i + 1], p3 = k[Math.min(k.length - 1, i + 2)];
    const t = (x - p1[0]) / (p2[0] - p1[0]);
    const m1 = (p2[1] - p0[1]) / (p2[0] - p0[0]) * (p2[0] - p1[0]), m2 = (p3[1] - p1[1]) / (p3[0] - p1[0]) * (p2[0] - p1[0]);
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
  };
}

// ---------------------------------------------------------------- shared materials / textures
let SH = null;
function shared() {
  if (SH) return SH;
  const atlas = buildAtlas();
  SH = {
    glass: patchGlass(new THREE.MeshPhysicalMaterial({ color: 0x0e1620, metalness: 0.0, roughness: 0.04, envMapIntensity: 2.4, depthWrite: false, side: THREE.FrontSide }), 0.42, 0.95, 2.4),
    trim: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.6, envMapIntensity: 1.3 }),
    lamp: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    wheel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.6, envMapIntensity: 1.2 }),
    decal: new THREE.MeshStandardMaterial({ map: atlas.map, emissiveMap: atlas.emis, emissive: new THREE.Color(2.2, 2.2, 2.2), transparent: true, alphaTest: 0.3, depthWrite: false, roughness: 0.35, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -2, envMapIntensity: 1.2 }),
    atlas,
  };
  SH.glass.userData.noShadow = true; SH.decal.userData.noShadow = true;
  return SH;
}
// ---------------------------------------------------------------- decal atlas (1024 x 1024): plates, taxi checks & sign, police livery, bus signage, truck brands
const CELLS = {};
function buildAtlas() {
  const S = 1024, [c, x] = makeCanvas(S, S), [e, ex] = makeCanvas(S, S), rng = mulberry32(42);
  x.clearRect(0, 0, S, S); ex.fillStyle = '#000'; ex.fillRect(0, 0, S, S);
  const F = (w, px) => `${w} ${px}px Impact, "Arial Black", sans-serif`;
  const cell = (name, x0, y0, w, h) => { CELLS[name] = [x0 / S, 1 - (y0 + h) / S, w / S, h / S]; };
  // 16 licence plates (128 x 56)
  for (let i = 0; i < 16; i++) {
    const px = (i % 8) * 128, py = Math.floor(i / 8) * 56;
    x.fillStyle = '#e4e0d2'; x.fillRect(px + 2, py + 2, 124, 52); x.fillStyle = ['#1a3a8a', '#7a1414', '#16603a'][i % 3]; x.fillRect(px + 2, py + 2, 124, 12);
    x.strokeStyle = '#222'; x.lineWidth = 3; x.strokeRect(px + 3, py + 3, 122, 50);
    x.fillStyle = '#fff'; x.font = F('700', 10); x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('MEGA-CITY ONE', px + 64, py + 8.5);
    const L = 'ABCDEFGHJKLMNPRSTUVWXYZ'; const tag = L[Math.floor(rng() * L.length)] + L[Math.floor(rng() * L.length)] + L[Math.floor(rng() * L.length)] + ' ' + String(Math.floor(rng() * 900 + 100));
    x.fillStyle = '#111'; x.font = F('900', 30); x.fillText(tag, px + 64, py + 36);
    cell('plate' + i, px, py, 128, 56);
  }
  // taxi checker band (512 x 48) at y 120
  { const y0 = 120; x.fillStyle = '#111'; x.fillRect(0, y0, 512, 48); x.fillStyle = '#f2efe6'; for (let i = 0; i < 32; i++) for (let j = 0; j < 3; j++) if ((i + j) % 2 === 0) x.fillRect(i * 16, y0 + j * 16, 16, 16); cell('checker', 0, y0, 512, 48); }
  // taxi roof sign (256 x 64) at (512,120): glowing text
  { const x0 = 512, y0 = 120; x.fillStyle = '#ffd23a'; x.fillRect(x0, y0, 256, 64); x.fillStyle = '#1a1206'; x.font = F('900', 46); x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('TAXI', x0 + 128, y0 + 34);
    ex.fillStyle = '#ffe080'; ex.fillRect(x0, y0, 256, 64); ex.fillStyle = '#3a2a00'; ex.font = F('900', 46); ex.textAlign = 'center'; ex.textBaseline = 'middle'; ex.fillText('TAXI', x0 + 128, y0 + 34); cell('taxisign', x0, y0, 256, 64); }
  // police door livery: white panel with gold JUSTICE DEPT + eagle (512 x 160) at y 200
  { const y0 = 200; const g = x.createLinearGradient(0, y0, 0, y0 + 160); g.addColorStop(0, '#f4f4f6'); g.addColorStop(1, '#cfd2d8'); x.fillStyle = g; x.fillRect(0, y0, 512, 160);
    x.fillStyle = '#c9971f'; x.fillRect(0, y0 + 6, 512, 10); x.fillRect(0, y0 + 144, 512, 10);
    x.fillStyle = '#101014'; x.font = F('900', 54); x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('JUSTICE DEPT', 256, y0 + 62);
    x.fillStyle = '#7a5a10'; x.font = F('700', 30); x.fillText('MC-1  PATROL  •  SECTOR 9', 256, y0 + 112); cell('police', 0, y0, 512, 160); }
  // bus route sign (512 x 64) at (512, 200): glowing amber dot-matrix
  { const x0 = 512, y0 = 200; x.fillStyle = '#120a02'; x.fillRect(x0, y0, 512, 64); ex.fillStyle = '#000'; ex.fillRect(x0, y0, 512, 64);
    ex.fillStyle = '#ffae2a'; ex.font = F('900', 40); ex.textAlign = 'center'; ex.textBaseline = 'middle'; ex.fillText('42  SECTOR 9 • HALL OF JUSTICE', x0 + 256, y0 + 33);
    x.fillStyle = '#ffae2a'; x.font = F('900', 40); x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('42  SECTOR 9 • HALL OF JUSTICE', x0 + 256, y0 + 33);
    for (let i = 0; i < 512; i += 4) { ex.fillStyle = 'rgba(0,0,0,0.5)'; ex.fillRect(x0 + i, y0, 1, 64); } cell('route', x0, y0, 512, 64); }
  // bus livery band (512 x 96) at (512, 280)
  { const x0 = 512, y0 = 280; x.fillStyle = '#1b3f9a'; x.fillRect(x0, y0, 512, 96); x.fillStyle = '#f0c020'; x.fillRect(x0, y0 + 60, 512, 14); x.fillStyle = '#e8e8ee'; x.font = F('900', 40); x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText('MC-1 TRANSIT', x0 + 18, y0 + 32); cell('busband', x0, y0, 512, 96); }
  // truck brands (3 x 340 x 200) at y 380
  const brands = [['SLURP', '#d0204a', '#ffe14a', 'The taste of Mega-City'], ['GRUD CORP', '#1f6a3a', '#f2f2e8', 'Logistics • Block 77'], ['OZ', '#2a2a8a', '#40e0ff', 'Synthi-Freight']];
  brands.forEach(([name, bg, fg, sub], i) => {
    const x0 = i * 341, y0 = 380; x.save(); x.beginPath(); x.rect(x0, y0, 340, 200); x.clip();
    x.fillStyle = '#ececec'; x.fillRect(x0, y0, 340, 200); x.fillStyle = bg; x.fillRect(x0, y0 + 30, 340, 120);
    x.fillStyle = fg; x.font = F('900', 70); x.textAlign = 'center'; x.textBaseline = 'middle';
    const tw = x.measureText(name).width, k = Math.min(1, 300 / tw); x.save(); x.translate(x0 + 170, y0 + 92); x.scale(k, 1); x.fillText(name, 0, 0); x.restore();
    x.fillStyle = '#333'; x.font = F('700', 20); x.fillText(sub, x0 + 170, y0 + 172); x.restore(); cell('brand' + i, x0 + 2, y0, 336, 200);
  });
  // grille mesh (128 x 64) at (0, 600): dark honeycomb
  { const x0 = 0, y0 = 600; x.fillStyle = '#0c0d10'; x.fillRect(x0, y0, 128, 64); x.strokeStyle = '#34363c'; x.lineWidth = 2; for (let j = 0; j < 8; j++) for (let i = 0; i < 16; i++) { x.beginPath(); x.arc(x0 + i * 8 + (j % 2) * 4 + 4, y0 + j * 8 + 4, 3, 0, 7); x.stroke(); } cell('grille', x0, y0, 128, 64); }
  // white body panel (64 x 64) at (128, 600)
  { x.fillStyle = '#eef0f3'; x.fillRect(128, 600, 64, 64); cell('white', 128, 600, 64, 64); }
  // eagle badge (gold on black) 128 x 128 at (192, 600)
  { const x0 = 192, y0 = 600; x.fillStyle = '#c99a24'; x.beginPath(); x.moveTo(x0 + 64, y0 + 20); for (const [px, py] of [[90, 38], [124, 30], [104, 64], [80, 66], [64, 100], [48, 66], [24, 64], [4, 30], [38, 38]]) x.lineTo(x0 + px, y0 + py); x.closePath(); x.fill(); cell('eagle', x0, y0, 128, 128); }
  const map = canvasTex(c), emis = canvasTex(e);
  return { map, emis };
}
function uvCell(g, name) {   // remap a unit-UV geometry into an atlas cell
  const [u0, v0, w, h] = CELLS[name]; const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * w, v0 + uv.getY(i) * h);
  return g;
}

// ---------------------------------------------------------------- type specs
// heights in metres; z positions along the car (+ front).  zA windshield base, zR0/zR1 roof front/back, zC rear glass base, zB B-pillar.
export const CAR_SPECS = {
  sedan: { L: 4.62, W: 1.88, R: 0.35, TW: 0.24, ax: [1.42, -1.42], base: 0.24, nose: 0.66, hood: 0.86, cowl: 0.94, belt: 0.97, deck: 0.98, tail: 0.88, roof: 1.42, zA: 0.92, zR0: 0.12, zR1: -0.82, zC: -1.42, zB: -0.25, cabIn: 0.08, cabTop: 0.78, rim: 'alloy', p: 6 },
  coupe: { L: 4.5, W: 1.96, R: 0.36, TW: 0.28, ax: [1.45, -1.36], base: 0.2, nose: 0.6, hood: 0.78, cowl: 0.86, belt: 0.88, deck: 0.9, tail: 0.86, roof: 1.25, zA: 0.78, zR0: -0.05, zR1: -0.6, zC: -1.62, zB: -0.18, cabIn: 0.1, cabTop: 0.74, rim: 'sport', p: 5, spoiler: true, twoDoor: true },
  taxi: { L: 4.62, W: 1.88, R: 0.35, TW: 0.24, ax: [1.42, -1.42], base: 0.24, nose: 0.68, hood: 0.88, cowl: 0.96, belt: 0.99, deck: 1.0, tail: 0.9, roof: 1.46, zA: 0.9, zR0: 0.1, zR1: -0.88, zC: -1.45, zB: -0.25, cabIn: 0.08, cabTop: 0.8, rim: 'cap', p: 7, sign: true, checker: true },
  hatch: { L: 4.05, W: 1.8, R: 0.33, TW: 0.22, ax: [1.3, -1.25], base: 0.22, nose: 0.66, hood: 0.84, cowl: 0.92, belt: 0.96, deck: 1.0, tail: 0.98, roof: 1.46, zA: 0.78, zR0: 0.02, zR1: -1.45, zC: -1.84, zB: -0.35, cabIn: 0.07, cabTop: 0.8, rim: 'alloy', p: 6, hatch: true },
  police: { L: 4.7, W: 1.9, R: 0.36, TW: 0.25, ax: [1.45, -1.45], base: 0.24, nose: 0.68, hood: 0.88, cowl: 0.95, belt: 0.98, deck: 0.99, tail: 0.9, roof: 1.43, zA: 0.92, zR0: 0.12, zR1: -0.84, zC: -1.44, zB: -0.25, cabIn: 0.08, cabTop: 0.78, rim: 'steel', p: 6, lightbar: true, pushbar: true },
  van: { L: 4.7, W: 1.95, R: 0.36, TW: 0.24, ax: [1.55, -1.45], base: 0.28, nose: 0.82, hood: 1.0, cowl: 1.08, belt: 1.12, deck: 1.12, tail: 1.08, roof: 2.08, zA: 1.38, zR0: 0.72, zR1: -2.2, zC: -2.3, zB: 0.35, cabIn: 0.05, cabTop: 0.92, rim: 'steel', p: 9, van: true },
  truck: { big: true, L: 6.8, W: 2.3, R: 0.46, TW: 0.32, ax: [2.65, -2.0], base: 0.42 },
  bus: { big: true, L: 6.8, W: 2.35, R: 0.44, TW: 0.3, ax: [2.25, -2.15], base: 0.32 },
};
export const CAR_TYPES = ['sedan', 'coupe', 'taxi', 'hatch', 'police', 'van', 'truck', 'bus'];
// spawn weights (traffic.js picks from this)
export const CAR_KINDS = ['sedan', 'sedan', 'sedan', 'coupe', 'coupe', 'taxi', 'taxi', 'hatch', 'hatch', 'van', 'police', 'truck', 'bus'];
export const isBig = (k) => !!CAR_SPECS[k]?.big;
const PAL = {
  sedan: [0x8a1a1a, 0x1a3a8a, 0x2a2a2e, 0xd0d0d8, 0x1a5a46, 0x5a2a7a, 0x7a6a58, 0x3a4652, 0x9a8a20],
  coupe: [0xc81e28, 0xe8a010, 0x1aa0c8, 0x101014, 0xe8e8ee, 0x8a20c0, 0x20c070],
  hatch: [0xd85a20, 0x40b0d0, 0xe8d040, 0xf0f0f2, 0x7ac040, 0xd04080, 0x5060d0],
  van: [0xe8e8ea, 0xd8d4c8, 0x3a4048, 0x8a2020, 0x204a8a, 0x2a5a3a],
  truck: [0xf2f2f2, 0x2a3a6a, 0x8a1a1a, 0x1a1a1e],
  bus: [0xd8dce4],
  taxi: [0xe8b414], police: [0x0a0a0d],
};
// paint colour for a type (with per-instance variation)
export function carPaint(kind, rnd = Math.random) {
  const p = PAL[kind] || PAL.sedan; const c = new THREE.Color(p[Math.floor(rnd() * p.length)]);
  if (kind !== 'taxi' && kind !== 'police' && kind !== 'bus') { const hsl = {}; c.getHSL(hsl); c.setHSL((hsl.h + (rnd() - 0.5) * 0.03 + 1) % 1, Math.min(1, hsl.s * (0.85 + rnd() * 0.3)), Math.min(0.92, hsl.l * (0.85 + rnd() * 0.3))); }
  return c.getHex();
}

// ---------------------------------------------------------------- wheel geometry (per size + rim style), vertex coloured
const WHEELS = new Map();
// one-sided wheel (rim detail on +X only); left-side wheels are mirrored with scale.x = -1
function wheelGeo(R, Wd, style) {
  const key = R + '_' + Wd + '_' + style; if (WHEELS.has(key)) return WHEELS.get(key);
  const parts = [], hw = Wd / 2, rIn = R * 0.66, SEG = 14;
  const rubber = [0.03, 0.03, 0.035];
  const rimC = { alloy: [0.66, 0.68, 0.72], sport: [0.75, 0.55, 0.18], cap: [0.5, 0.52, 0.56], steel: [0.07, 0.07, 0.08], truck: [0.6, 0.62, 0.66] }[style] || [0.6, 0.6, 0.62];
  const add = (g, col) => { const gg = g.index ? g.toNonIndexed() : g; for (const n of Object.keys(gg.attributes)) if (n !== 'position' && n !== 'normal') gg.deleteAttribute(n); tint(gg, col); parts.push(gg); };
  // tyre: rounded profile, bead to bead
  const prof = [[rIn, -hw * 0.82], [rIn + (R - rIn) * 0.5, -hw], [R, -hw * 0.6], [R, hw * 0.6], [rIn + (R - rIn) * 0.5, hw], [rIn, hw * 0.82]];
  add(lathe(prof, SEG, [1, 0]).rotateZ(-Math.PI / 2), rubber);
  // dished face, then spokes / hub cap / steel-wheel nuts
  add(lathe([[rIn, hw * 0.82], [rIn * 0.86, hw * 0.66], [0, hw * 0.6]], SEG, [0, 1]).rotateZ(-Math.PI / 2), style === 'steel' ? rimC : [rimC[0] * 0.3, rimC[1] * 0.3, rimC[2] * 0.33]);
  if (style === 'cap') add(lathe([[rIn * 0.95, hw * 0.84], [rIn * 0.7, hw * 0.92], [0, hw * 0.96]], SEG, [0, 1]).rotateZ(-Math.PI / 2), rimC);
  else if (style !== 'steel' && style !== 'truck') {
    const n = style === 'sport' ? 7 : 5;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, w = style === 'sport' ? 0.022 : 0.05;
      const g = new THREE.BoxGeometry(0.02, rIn * 0.78, w); g.translate(0, rIn * 0.5, 0); g.rotateX(a); g.translate(hw * 0.72, 0, 0); add(g, rimC);
    }
  } else { for (let k = 0; k < (style === 'truck' ? 6 : 5); k++) { const a = (k / (style === 'truck' ? 6 : 5)) * Math.PI * 2; const g = new THREE.CylinderGeometry(0.03, 0.03, 0.02, 4); g.rotateZ(Math.PI / 2); g.translate(hw * 0.62, Math.cos(a) * rIn * 0.6, Math.sin(a) * rIn * 0.6); add(g, [0.02, 0.02, 0.02]); } }
  { const g = new THREE.CylinderGeometry(rIn * 0.22, rIn * 0.24, 0.03, 8); g.rotateZ(Math.PI / 2); g.translate(hw * 0.74, 0, 0); add(g, style === 'steel' ? [0.55, 0.56, 0.6] : [0.85, 0.86, 0.9]); }
  const geo = mergeGeometries(parts, false); geo.computeBoundingSphere();
  geo.userData.tyre = parts[0];
  WHEELS.set(key, geo); return geo;
}

// twin rear wheels as one mesh (spins as a unit)
const DUALS = new Map();
function dualGeo(g, gap) {
  if (DUALS.has(g)) return DUALS.get(g);
  const inner = (g.userData.tyre || g).clone();
  const d = mergeGeometries([inner.translate(-gap / 2, 0, 0), g.clone().translate(gap / 2, 0, 0)], false); d.computeBoundingSphere();
  DUALS.set(g, d); return d;
}

// ---------------------------------------------------------------- body builder (cars and vans)
const C = { dark: [0.03, 0.032, 0.038], black: [0.012, 0.012, 0.015], chrome: [0.85, 0.87, 0.9], grey: [0.18, 0.19, 0.21], seat: [0.06, 0.055, 0.06], gold: [0.8, 0.6, 0.15] };
const LAMP = { head: [5.0, 4.7, 4.2], drl: [2.2, 2.9, 3.6], amber: [2.4, 1.0, 0.12], white: [3.0, 3.0, 3.0], sign: [1.7, 1.25, 0.3] };

function buildCarType(kind) {
  const S = CAR_SPECS[kind], SHm = shared();
  const kit = new Kit(), host = new THREE.Group();
  const M = { paint: new THREE.MeshStandardMaterial(), glass: SHm.glass, trim: SHm.trim, lamp: SHm.lamp, tail: new THREE.MeshBasicMaterial(), decal: SHm.decal };
  const L2 = S.L / 2, hwMax = S.W / 2;
  const tint3 = (g, col) => tint(g.index ? g.toNonIndexed() : g, col);
  // ---- plan / profile functions ----
  const zEnd = L2 * 0.985;
  const halfW = (z) => {
    const zn = Math.min(1, Math.abs(z) / L2), plan = Math.pow(Math.max(0, 1 - Math.pow(zn, S.p)), 1 / S.p);
    let bulge = 0; for (const a of S.ax) bulge += 0.035 * Math.exp(-Math.pow((z - a) / 0.55, 2));
    return hwMax * (0.93 + 0.07 * plan) * Math.min(1, plan * 3.2) + hwMax * bulge;
  };
  const top = spline(S.van
    ? [[L2, S.nose], [L2 - 0.35, S.hood], [S.zA, S.cowl], [0, S.belt], [-L2 + 0.2, S.tail + 0.02], [-L2, S.tail]]
    : [[L2, S.nose], [L2 - 0.3, S.hood - 0.03], [S.zA + 0.25, S.hood + 0.02], [S.zA, S.cowl], [S.zC, S.deck], [-L2 + 0.32, S.deck - 0.01], [-L2, S.tail]]);
  const archR = S.R + 0.075;
  const bot = (z) => {
    let b = S.base + 0.07 * smoothstep(L2 - 0.5, L2, z) + 0.06 * smoothstep(L2 - 0.45, L2, -z);
    for (const a of S.ax) { const d = Math.abs(z - a); if (d < archR) b = Math.max(b, S.R + Math.sqrt(archR * archR - d * d) - 0.02); }
    return b;
  };
  // section: v 0..1 = bottom centre -> -X side -> top -> +X side; side keeps its absolute shape so arches simply cut it
  const VB = 0.05, VS = 0.31;
  const bodyFn = (z, v, out) => {
    const mirror = v > 0.5, w = Math.max(0, Math.min(0.5, mirror ? 1 - v : v));
    const hw = halfW(z), yt = top(z), yb = bot(z), ySh = yt - Math.min(0.14, (yt - S.base) * 0.22);
    const sideX = (y) => { const f = (y - S.base) / Math.max(0.1, ySh - S.base); return hw * (1 - 0.1 * Math.pow(Math.max(0, 1 - f), 2) * 1.6 - 0.05 * f * f) ; };
    let x, y;
    if (w <= VB) { const s = w / VB; x = sideX(yb) * 0.94 * s; y = yb; }
    else if (w <= VS) { const s = (w - VB) / (VS - VB); y = mix(yb + 0.015, ySh, s); x = sideX(y); }
    else { const s = (w - VS) / (0.5 - VS), a = s * Math.PI / 2; const [cx, cy] = se(a, 3.2); x = sideX(ySh) * cx; y = ySh + (yt - ySh) * cy; }
    return out.set(mirror ? x : -x, y, z);
  };
  // ---- lower body ----
  const zs = lin(-zEnd, zEnd, 12, S.ax.flatMap((a) => [a - archR * 0.97, a - archR * 0.7, a - archR * 0.3, a + archR * 0.3, a + archR * 0.7, a + archR * 0.97]));
  const vs = lin(0, 1, 12, [VB, VS, 1 - VS, 1 - VB]);
  kit.add(surface(bodyFn, zs, vs), M.paint, host);
  kit.add(capRing(ringAt(bodyFn, zEnd, vs), V3(0, 0, 1)), M.paint, host);
  kit.add(capRing(ringAt(bodyFn, -zEnd, vs), V3(0, 0, -1)), M.paint, host);
  // wheel-arch liners (dark) so wheel wells read deep
  for (const a of S.ax) for (const s of [-1, 1]) {
    const liner = new THREE.CylinderGeometry(archR - 0.01, archR - 0.01, S.TW + 0.12, 14, 1, true, Math.PI / 2 - 1.25, 2.5).rotateZ(Math.PI / 2).rotateY(0);
    kit.add(tint(xf(liner, s * (hwMax - S.TW / 2 - 0.02), S.R - 0.02, a, 0, 0, 0).toNonIndexed(), C.black), M.trim, host);
  }
  // ---- greenhouse: glass loft + paint roof / pillars + interior ----
  const gTop = spline(S.van
    ? [[S.zA, S.belt], [S.zA - 0.18, S.belt + 0.35], [S.zR0, S.roof], [S.zR1, S.roof], [S.zC, S.roof - 0.02]]
    : [[S.zA, S.belt + 0.005], [mix(S.zA, S.zR0, 0.55), mix(S.belt, S.roof, 0.7)], [S.zR0, S.roof - 0.01], [mix(S.zR0, S.zR1, 0.5), S.roof], [S.zR1, S.roof - 0.015], [mix(S.zR1, S.zC, 0.5), mix(S.roof, S.deck, S.hatch ? 0.4 : 0.6)], [S.zC, S.deck + 0.005]]);
  const GC = 0.3;   // v of the roof corner
  const ghFn = (z, v, out) => {
    const mirror = v > 0.5, w = Math.max(0, Math.min(0.5, mirror ? 1 - v : v));
    const belt = Math.max(top(z), S.belt * 0.98) - 0.07, yT = Math.max(belt + 0.07, gTop(z));
    const hwB = halfW(z) - S.cabIn, hwT = hwB * S.cabTop;
    const hRoof = yT - belt;
    const yC = yT - Math.min(0.09, hRoof * 0.35);
    let x, y;
    if (w <= GC) { const s = w / GC; y = mix(belt, yC, s); x = mix(hwB, mix(hwB, hwT, (yC - belt) / Math.max(0.01, S.roof - S.belt)), Math.pow(s, 1.15)); }
    else { const s = (w - GC) / (0.5 - GC), a = s * Math.PI / 2; const xc = mix(hwB, hwT, (yC - belt) / Math.max(0.01, S.roof - S.belt)); const [cx, cy] = se(a, 2.6); x = xc * cx; y = yC + (yT - yC) * cy; }
    return out.set(mirror ? x : -x, y, z);
  };
  const gz = lin(S.zC, S.zA, 9, [S.zR0, S.zR1, S.zB - 0.05, S.zB + 0.05]), gv = lin(0, 1, 8, [GC, 1 - GC]);
  kit.add(surface(ghFn, gz, gv), M.glass, host);
  // paint overlays (outside the glass): roof, A / C pillars, B pillar; black DLO frame along the belt
  const off = { offset: 0.006 };
  kit.add(patch(ghFn, S.zR1 - 0.02, S.zR0 + 0.03, GC - 0.035, 1 - GC + 0.035, 6, 6, off), M.paint, host);
  for (const s of [-1, 1]) {
    const c0 = s < 0 ? GC - 0.035 : 1 - GC - 0.03, c1 = s < 0 ? GC + 0.03 : 1 - GC + 0.035;
    kit.add(patch(ghFn, S.zR0, S.zA, c0, c1, 8, 2, off), M.paint, host);                             // A pillar
    kit.add(patch(ghFn, S.zC, S.zR1, c0, c1, 8, 2, off), M.paint, host);                             // C pillar edge
    const sideLo = s < 0 ? 0.0 : 1 - GC, sideHi = s < 0 ? GC : 1.0;
    if (!S.twoDoor) kit.add(tint3(patch(ghFn, S.zB - 0.055, S.zB + 0.055, sideLo, sideHi, 1, 6, off), C.black), M.trim, host);   // B pillar (black)
    // C-pillar quarter: sedans / taxis / police close the rear quarter; vans close the whole cargo side
    const qz0 = S.van ? S.zC : S.zC, qz1 = S.van ? S.zB - 0.06 : (S.hatch ? S.zC + 0.25 : mix(S.zC, S.zR1, 0.75) + 0.12);
    kit.add(patch(ghFn, qz0, qz1, sideLo, sideHi, S.van ? 6 : 3, 4, off), M.paint, host);
    { const pts = []; for (let i = 0; i <= 12; i++) { const z = mix(S.zC + 0.02, S.zA - 0.02, i / 12); const p = ghFn(z, s < 0 ? 0.055 : 0.945, V3()); pts.push(p); } kit.add(tint3(pipe(pts, 0.014, 3, 12), C.chrome), M.trim, host); }   // belt molding
  }
  if (S.van) { kit.add(patch(ghFn, S.zC, S.zR1 + 0.02, GC - 0.03, 1 - GC + 0.03, 2, 6, off), M.paint, host); kit.add(capRing(ringAt(ghFn, S.zC + 0.004, lin(0, 1, 12, [GC, 1 - GC])), V3(0, 0, -1)), M.paint, host); }   // van rear wall
  // headliner (dark, inside the roof) + cabin tub, seats, headrests, dash, wheel
  kit.add(tint3(patch(ghFn, S.zR1, S.zR0, GC, 1 - GC, 4, 4, { offset: -0.012, flip: true }), C.dark), M.trim, host);
  {
    const yb = S.belt - 0.02, cabW = (halfW(0) - S.cabIn) * 1.9;
    const hrY = Math.min(S.roof - 0.2, yb + 0.5), sbTop = hrY - 0.09, sbBot = yb - 0.2;   // headrests stay under the roof line
    const rows = S.van ? [S.zA - 0.75] : S.twoDoor ? [S.zB - 0.2] : [S.zB - 0.12, S.zB - 0.85];
    rows.forEach((z, ri) => {
      for (const s of (ri === 0 ? [-1, 1] : [0])) {
        const w = ri === 0 ? 0.5 : cabW * 0.8, x = s * cabW * 0.24;
        const st = Math.min(sbTop, gTop(z - 0.1) - 0.2);
        kit.add(tint3(xf(bx(w, st - sbBot, 0.14), x, (st + sbBot) / 2, z - 0.1, -0.1, 0, 0), C.seat), M.trim, host);
        const hy = Math.min(hrY, gTop(z - 0.15) - 0.13);
        for (const hx of ri === 0 ? [x] : [x - w * 0.33, x, x + w * 0.33]) kit.add(tint3(xf(bx(0.2, 0.14, 0.1), hx, hy, z - 0.15), C.seat), M.trim, host);
      }
    });
    kit.add(tint3(xf(bx(cabW * 0.95, 0.1, 0.3), 0, yb + 0.03, S.zA - 0.22), C.dark), M.trim, host);                    // dashboard
    kit.add(tint3(xf(new THREE.TorusGeometry(0.16, 0.02, 3, 8), -cabW * 0.24, yb + 0.17, S.zA - 0.42, -0.5, 0, 0), C.black), M.trim, host);   // steering wheel
  }
  // ---- details on the lower body ----
  const sideV = (s, f) => (s < 0 ? mix(VB, VS, f) : 1 - mix(VB, VS, f));     // side band v at height fraction f
  for (const s of [-1, 1]) {
    // rocker / sill (black), shoulder chrome strip, door shut lines, handles, mirror
    kit.add(patch(bodyFn, -zEnd * 0.62, zEnd * 0.6, sideV(s, 0.0), sideV(s, 0.12), 10, 1, { offset: 0.004 }), M.trim, host);
    const doors = S.twoDoor ? [S.zA - 0.05, S.zB - 0.6] : S.van ? [S.zA - 0.05, S.zB, S.zB - 0.02 - 1.25] : [S.zA - 0.05, S.zB, S.zB - 0.95];
    for (const dz of doors) kit.add(tint3(patch(bodyFn, dz - 0.006, dz + 0.006, sideV(s, 0.12), sideV(s, 1.0), 1, 5, { offset: 0.002 }), C.black), M.trim, host);
    for (const hz of S.twoDoor ? [S.zB - 0.45] : [S.zB - 0.12, S.zB - 0.82]) { const p = bodyFn(hz, sideV(s, 0.82), V3()); kit.add(tint3(xf(bx(0.025, 0.025, 0.16), p.x + s * 0.008, p.y, p.z), C.chrome), M.trim, host); }
    const mp = bodyFn(S.zA - 0.12, sideV(s, 0.97), V3());
    kit.add(xf(rb(0.12, 0.08, 0.16, 0.035), mp.x + s * 0.09, mp.y + 0.08, mp.z), M.paint, host);
    kit.add(tint3(xf(rb(0.08, 0.025, 0.06, 0.01), mp.x + s * 0.03, mp.y + 0.03, mp.z + 0.02), C.black), M.trim, host);
  }
  // ---- nose: grille, lamps, bumper, plate ----
  const fz = zEnd + 0.004, yN = S.nose, yBm = S.base + 0.18;
  const nw = halfW(zEnd) * 0.92;
  {
    const gW = S.van ? nw * 1.2 : nw * 0.9, gH = S.van ? 0.2 : 0.13, gY = (yN + yBm) / 2 + (S.van ? 0.02 : -0.03);
    const gr = new THREE.PlaneGeometry(gW, gH); uvCell(gr, 'grille'); kit.add(xf(gr, 0, gY, fz + 0.002), M.decal, host);
    kit.add(tint3(xf(rb(gW + 0.04, gH + 0.04, 0.03, 0.015), 0, gY, fz - 0.01), kind === 'police' ? C.black : C.chrome), M.trim, host);
    for (const s of [-1, 1]) {   // headlamps: bright core + DRL eyebrow + amber corner
      const hx = s * (nw - 0.24), hy = yN - 0.07;
      kit.add(tint3(xf(rb(0.34, 0.085, 0.03, 0.02), hx, hy, fz), C.black), M.trim, host);
      kit.add(tint3(xf(bx(0.13, 0.06, 0.02), hx - s * 0.06, hy, fz + 0.012), LAMP.head), M.lamp, host);
      kit.add(tint3(xf(bx(0.3, 0.014, 0.02), hx + s * 0.01, hy + 0.034, fz + 0.012), LAMP.drl), M.lamp, host);
      kit.add(tint3(xf(bx(0.06, 0.05, 0.02), hx + s * 0.12, hy, fz + 0.01), LAMP.amber), M.lamp, host);
      kit.add(tint3(xf(bx(0.14, 0.05, 0.02), s * (nw - 0.22), yBm + 0.02, fz), C.dark), M.trim, host);   // fog intake
    }
    kit.add(tint3(xf(rb(nw * 2.02, 0.09, 0.07, 0.03), 0, yBm - 0.04, fz + 0.01), kind === 'police' ? C.black : C.grey), M.trim, host);   // bumper strip
    const pl = new THREE.PlaneGeometry(0.42, 0.13); M.platesFront = pl; kit.add(xf(pl, 0, yBm + 0.06, fz + 0.035), M.decal, host);
  }
  // ---- tail: lamps (tail material), third brake light, plate, bumper ----
  const rz = -zEnd - 0.004, yT = S.tail;
  {
    const tw = halfW(-zEnd) * 0.92;
    for (const s of [-1, 1]) {
      kit.add(xf(bx(0.36, 0.1, 0.03), s * (tw - 0.22), yT - 0.09, rz), M.tail, host);
      kit.add(tint3(xf(bx(0.08, 0.07, 0.02), s * (tw - 0.06), yT - 0.09, rz - 0.008), LAMP.amber), M.lamp, host);
    }
    if (!S.van) kit.add(xf(bx(tw * 2 - 0.7, 0.03, 0.025), 0, yT - 0.09, rz), M.tail, host);       // light bar between the lamps
    if (S.van) kit.add(xf(bx(0.32, 0.03, 0.03), 0, S.roof - 0.06, -L2 + 0.01), M.tail, host);   // third brake light (vans)   // third brake light
    kit.add(tint3(xf(rb(tw * 2.02, 0.1, 0.07, 0.03), 0, S.base + 0.12, rz - 0.01), C.grey), M.trim, host);
    const pl = new THREE.PlaneGeometry(0.42, 0.13); pl.rotateY(Math.PI); M.platesRear = pl; kit.add(xf(pl, 0, S.base + 0.3, rz - 0.035), M.decal, host);
    if (S.van) for (const s of [-1, 1]) kit.add(tint3(patch(bodyFn, -zEnd, -zEnd + 0.004, 0.495, 0.505, 1, 1), C.black), M.trim, host);
  }
  // ---- type extras ----
  if (S.spoiler) {
    for (const s of [-1, 1]) kit.add(tint3(xf(rb(0.05, 0.16, 0.12, 0.02), s * 0.6, S.deck + 0.07, -L2 + 0.32), C.black), M.trim, host);
    kit.add(xf(rb(S.W - 0.25, 0.04, 0.32, 0.015), 0, S.deck + 0.16, -L2 + 0.3, -0.08, 0, 0), M.paint, host);
    for (const s of [-1, 1]) kit.add(tint3(xf(rb(0.08, 0.06, 0.12, 0.02), s * 0.45, S.base + 0.1, -L2 + 0.06), C.chrome), M.trim, host);   // twin exhausts
  }
  if (S.sign) {   // taxi roof sign: glowing box with TAXI decal on both faces
    kit.add(tint3(xf(rb(0.62, 0.05, 0.3, 0.02), 0, S.roof + 0.03, -0.3), C.black), M.trim, host);
    kit.add(tint3(xf(bx(0.58, 0.18, 0.24), 0, S.roof + 0.14, -0.3), LAMP.sign), M.lamp, host);
    for (const s of [-1, 1]) { const g = new THREE.PlaneGeometry(0.5, 0.13); uvCell(g, 'taxisign'); if (s < 0) g.rotateY(Math.PI); kit.add(xf(g, 0, S.roof + 0.14, -0.3 + s * 0.123), M.decal, host); }
  }
  if (S.checker) for (const s of [-1, 1]) kit.add(uvCell(patch(bodyFn, s > 0 ? zEnd * 0.6 : -zEnd * 0.72, s > 0 ? -zEnd * 0.72 : zEnd * 0.6, sideV(s, 0.42), sideV(s, 0.56), 12, 2, { offset: 0.004, swapUV: true }), 'checker'), M.decal, host);
  if (kind === 'police') {
    for (const s of [-1, 1]) kit.add(uvCell(patch(bodyFn, s > 0 ? S.zA - 0.1 : S.zB - 0.9, s > 0 ? S.zB - 0.9 : S.zA - 0.1, sideV(s, 0.18), sideV(s, 0.92), 8, 2, { offset: 0.004, swapUV: true }), 'police'), M.decal, host);
    const eg = new THREE.PlaneGeometry(0.42, 0.42); eg.rotateX(-Math.PI / 2 + 0.12); uvCell(eg, 'eagle'); kit.add(xf(eg, 0, top(1.6) + 0.012, 1.6), M.decal, host);
    if (S.pushbar) {   // push bar
      for (const s of [-1, 1]) kit.add(tint3(rod(V3(s * 0.35, S.base + 0.05, L2 + 0.05), V3(s * 0.35, S.nose + 0.04, L2 + 0.1), 0.03, 4), C.black), M.trim, host);
      kit.add(tint3(xf(bx(0.9, 0.06, 0.05), 0, S.nose - 0.05, L2 + 0.1), C.black), M.trim, host);
      kit.add(tint3(xf(bx(0.9, 0.06, 0.05), 0, S.base + 0.22, L2 + 0.08), C.black), M.trim, host);
    }
    kit.add(tint3(xf(bx(1.25, 0.05, 0.3), 0, S.roof + 0.025, -0.25), C.black), M.trim, host);   // light bar base
  }
  if (S.van) {   // roof rack ribs + side marker
    for (let i = 0; i < 4; i++) kit.add(tint3(xf(bx(S.W * 0.85, 0.03, 0.05), 0, S.roof + 0.02, S.zR0 - 0.3 - i * 0.8), C.grey), M.trim, host);
  }
  // underglow strip (lamp, neon colour baked per instance would split geometry: use white-ish blue, tinted by the per-car pool)
  return finish(kind, S, kit, host, M, { top, bodyFn, halfW, gTop });
}

// ---------------------------------------------------------------- box truck (cab + cargo box) and city shuttle bus
function buildTruck() {
  const S = CAR_SPECS.truck, SHm = shared(), kit = new Kit(), host = new THREE.Group();
  const M = { paint: new THREE.MeshStandardMaterial(), glass: SHm.glass, trim: SHm.trim, lamp: SHm.lamp, tail: new THREE.MeshBasicMaterial(), decal: SHm.decal };
  const L2 = S.L / 2, tint3 = (g, col) => tint(g.index ? g.toNonIndexed() : g, col);
  // chassis rails, fuel tank, steps
  kit.add(tint3(xf(rb(1.1, 0.24, S.L - 0.4, 0.04), 0, 0.68, -0.1), C.dark), M.trim, host);
  for (const s of [-1, 1]) kit.add(tint3(xf(new THREE.CylinderGeometry(0.22, 0.22, 0.9, 8).rotateX(Math.PI / 2), s * 0.88, 0.62, 0.9), C.grey), M.trim, host);
  // cab-over cab: chamfered box with a slightly raked upper front, flat glazed windscreen, door windows
  const cz0 = 1.2, cz1 = L2, cy0 = 0.98, cy1 = 2.78, cW = S.W;
  const cab = cbox(cW, cy1 - cy0, cz1 - cz0, 0.16);
  warp(cab, (v) => { const ty = (v.y + (cy1 - cy0) / 2) / (cy1 - cy0); if (v.z > 0) v.z -= 0.22 * smoothstep(0.45, 1.0, ty); }, false);
  cab.computeVertexNormals();
  kit.add(xf(cab, 0, (cy0 + cy1) / 2, (cz0 + cz1) / 2), M.paint, host);
  // windscreen (raked plane over the upper front) + door glass
  { const ws = new THREE.PlaneGeometry(cW - 0.36, 0.85); ws.rotateX(-Math.atan2(0.22, 0.99)); kit.add(xf(ws, 0, 2.2, cz1 - 0.12 + 0.015), M.glass, host);
    kit.add(tint3(xf(bx(cW - 0.3, 0.06, 0.06), 0, 1.75, cz1 - 0.01), C.black), M.trim, host); }
  for (const s of [-1, 1]) { const dw = new THREE.PlaneGeometry(0.95, 0.72); dw.rotateY(s * Math.PI / 2); kit.add(xf(dw, s * (cW / 2 + 0.004), 2.15, cz1 - 0.75), M.glass, host); kit.add(tint3(xf(bx(0.02, 0.9, 0.035), s * (cW / 2 + 0.005), 1.85, cz1 - 1.28), C.black), M.trim, host); }
  for (const s of [-1, 1]) {   // front fenders (black quarter shells over the steer wheels) + cab step
    const fen = new THREE.CylinderGeometry(S.R + 0.1, S.R + 0.1, S.TW + 0.16, 8, 1, true, -0.15, Math.PI * 0.62); fen.rotateZ(Math.PI / 2); fen.rotateX(-Math.PI / 2 + 0.3);
    kit.add(tint3(xf(fen, s * (S.W / 2 - S.TW / 2 - 0.02), S.R, S.ax[0]), C.black), M.trim, host);
    kit.add(tint3(xf(bx(0.3, 0.06, 0.5), s * (S.W / 2 - 0.05), 0.62, 1.75), C.grey), M.trim, host);
  }
  kit.add(tint3(xf(bx(2.1, 0.2, cz1 - cz0), 0, 0.88, (cz0 + cz1) / 2), C.dark), M.trim, host);
  // interior silhouette
  kit.add(tint3(xf(bx(1.9, 0.5, 0.9), 0, 1.95, 2.3), C.seat), M.trim, host);
  // grille, lamps, bumper, plate
  const fz = L2 + 0.005;
  { const gr = new THREE.PlaneGeometry(1.3, 0.42); uvCell(gr, 'grille'); kit.add(xf(gr, 0, 1.38, fz), M.decal, host); kit.add(tint3(xf(rb(1.36, 0.48, 0.03, 0.02), 0, 1.38, fz - 0.012), C.chrome), M.trim, host); }
  for (const s of [-1, 1]) { kit.add(tint3(xf(bx(0.3, 0.16, 0.03), s * 0.85, 1.08, fz), LAMP.head), M.lamp, host); kit.add(tint3(xf(bx(0.1, 0.1, 0.03), s * 1.05, 1.08, fz), LAMP.amber), M.lamp, host); }
  kit.add(tint3(xf(rb(2.36, 0.3, 0.2, 0.05), 0, 0.82, fz), C.dark), M.trim, host);
  { const pl = new THREE.PlaneGeometry(0.46, 0.14); M.platesFront = pl; kit.add(xf(pl, 0, 0.84, fz + 0.105), M.decal, host); }
  for (const s of [-1, 1]) { kit.add(tint3(rod(V3(s * 1.16, 2.2, 2.9), V3(s * 1.36, 2.3, 2.9), 0.02, 6), C.black), M.trim, host); kit.add(tint3(xf(rb(0.08, 0.38, 0.2, 0.03), s * 1.38, 2.2, 2.9), C.black), M.trim, host); }
  for (let i = 0; i < 5; i++) kit.add(tint3(xf(bx(0.1, 0.05, 0.05), -0.5 + i * 0.25, cy1 + 0.02, cz1 - 0.35), LAMP.amber), M.lamp, host);   // cab roof markers
  // cargo box with ribs, brand panels, rear doors
  const bz0 = -L2 + 0.05, bz1 = 1.1, bH = 2.55, bW = S.W + 0.06;
  kit.add(xf(rb(bW, bH, bz1 - bz0, 0.08, 2), 0, 0.95 + bH / 2, (bz0 + bz1) / 2), M.paint, host);
  for (let i = 0; i <= 6; i++) for (const s of [-1, 1]) kit.add(tint3(xf(bx(0.04, bH - 0.06, 0.08), s * (bW / 2 + 0.012), 0.95 + bH / 2, bz0 + 0.1 + i * (bz1 - bz0 - 0.2) / 6), C.grey), M.trim, host);
  kit.add(tint3(xf(rb(bW + 0.03, 0.12, bz1 - bz0 + 0.03, 0.02), 0, 0.98, (bz0 + bz1) / 2), C.dark), M.trim, host);
  M.brandSides = [];
  for (const s of [-1, 1]) { const g = new THREE.PlaneGeometry(3.6, 1.9); if (s < 0) g.rotateY(-Math.PI / 2); else g.rotateY(Math.PI / 2); M.brandSides.push(g); kit.add(xf(g, s * (bW / 2 + 0.035), 2.25, (bz0 + bz1) / 2), M.decal, host); }
  kit.add(tint3(xf(rb(0.03, bH - 0.2, 0.02, 0.005), 0, 0.95 + bH / 2, bz0 - 0.012), C.dark), M.trim, host);
  for (const s of [-1, 1]) kit.add(tint3(xf(rb(0.04, 0.5, 0.04, 0.01), s * 0.3, 1.9, bz0 - 0.02), C.chrome), M.trim, host);
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) kit.add(tint3(xf(bx(0.05, 0.05, 0.16), s * (bW / 2 + 0.01), 3.42, bz0 + 0.4 + i * 1.2), LAMP.amber), M.lamp, host);
  for (const s of [-1, 1]) kit.add(xf(bx(0.3, 0.16, 0.04), s * 0.85, 1.12, bz0 - 0.02), M.tail, host);
  kit.add(xf(bx(1.2, 0.05, 0.03), 0, 3.45, bz0 - 0.015), M.tail, host);
  kit.add(tint3(xf(rb(2.2, 0.16, 0.12, 0.03), 0, 0.72, bz0 - 0.04), C.dark), M.trim, host);
  { const pl = new THREE.PlaneGeometry(0.46, 0.14); pl.rotateY(Math.PI); M.platesRear = pl; kit.add(xf(pl, 0, 0.9, bz0 - 0.03), M.decal, host); }
  return finish('truck', S, kit, host, M, {});
}
function buildBus() {
  const S = CAR_SPECS.bus, SHm = shared(), kit = new Kit(), host = new THREE.Group();
  const M = { paint: new THREE.MeshStandardMaterial(), glass: SHm.glass, trim: SHm.trim, lamp: SHm.lamp, tail: new THREE.MeshBasicMaterial(), decal: SHm.decal };
  const L2 = S.L / 2, tint3 = (g, col) => tint(g.index ? g.toNonIndexed() : g, col), hw0 = S.W / 2;
  // body: rounded box loft, raked rounded nose, slight tumblehome
  const busFn = (z, v, out) => {
    const zn = Math.abs(z) / L2, front = z > 0, mirror = v > 0.5, w = mirror ? 1 - v : v;
    const plan = Math.pow(Math.max(0, 1 - Math.pow(zn, front ? 4 : 7)), 1 / (front ? 4 : 7));
    const hw = hw0 * (0.82 + 0.18 * plan);
    let arch = 0; for (const a of S.ax) { const d = Math.abs(z - a); if (d < S.R + 0.08) arch = Math.max(arch, S.R + Math.sqrt((S.R + 0.08) ** 2 - d * d) - 0.02); }
    const yb = 0.34, yt = 3.05 - 0.18 * smoothstep(0.7, 1.0, zn);
    const [cx, cy] = se(-Math.PI / 2 - w * Math.PI * 2, 5.0);
    const ty = (cy + 1) / 2, x = cx * hw * (1 - 0.06 * ty * ty), y = Math.max(arch, mix(yb, yt, ty));
    return out.set(mirror ? -x : x, y, z);
  };
  const zs = lin(-L2 * 0.99, L2 * 0.99, 14, S.ax.flatMap((a) => [a - 0.5, a - 0.3, a - 0.1, a + 0.1, a + 0.3, a + 0.5])), vs = lin(0, 1, 22);
  kit.add(surface(busFn, zs, vs), M.paint, host);
  kit.add(capRing(ringAt(busFn, L2 * 0.99, vs), V3(0, 0, 1)), M.paint, host);
  kit.add(capRing(ringAt(busFn, -L2 * 0.99, vs), V3(0, 0, -1)), M.paint, host);
  // window band: glass overlay along the sides + big wrap windscreen, pillars every 1.1 m (paint over glass)
  const vSideLo = 0.236, vSideHi = 0.283;
  for (const s of [-1, 1]) {
    const a = s < 0 ? vSideLo : 1 - vSideHi, b = s < 0 ? vSideHi : 1 - vSideLo;
    kit.add(patch(busFn, -L2 * 0.9, L2 * 0.84, a, b, 10, 3, { offset: 0.008 }), M.glass, host);
    for (let i = 0; i < 6; i++) { const z = -L2 * 0.78 + i * 1.08; kit.add(patch(busFn, z - 0.06, z + 0.06, a - 0.005, b + 0.005, 1, 3, { offset: 0.012 }), M.paint, host); }
    kit.add(uvCell(patch(busFn, s > 0 ? L2 * 0.82 : -L2 * 0.92, s > 0 ? -L2 * 0.92 : L2 * 0.82, s < 0 ? 0.15 : 0.85, s < 0 ? 0.205 : 0.795, 12, 2, { offset: 0.006, swapUV: true }), 'busband'), M.decal, host);
  }
  kit.add(patch(busFn, L2 * 0.9, L2 * 0.99, 0.22, 0.78, 3, 14, { offset: 0.01 }), M.glass, host);   // wrap windscreen
  kit.add(patch(busFn, -L2 * 0.99, -L2 * 0.9, 0.3, 0.7, 2, 6, { offset: 0.01 }), M.glass, host);
  kit.add(tint3(xf(bx(2.1, 0.06, 6.0), 0, 1.0, 0), C.seat), M.trim, host);
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) kit.add(tint3(xf(bx(0.8, 0.5, 0.2), s * 0.55, 1.3, -2.2 + i * 1.0), C.seat), M.trim, host);
  // route sign (glowing), lamps, bumpers, plates
  { const g = new THREE.PlaneGeometry(1.6, 0.2); uvCell(g, 'route'); kit.add(xf(g, 0, 2.78, L2 * 0.99 + 0.012), M.decal, host); }
  const fz = L2 * 0.99 + 0.006;
  for (const s of [-1, 1]) { kit.add(tint3(xf(bx(0.36, 0.12, 0.03), s * 0.8, 0.82, fz), LAMP.head), M.lamp, host); kit.add(tint3(xf(bx(0.36, 0.02, 0.03), s * 0.8, 0.9, fz), LAMP.drl), M.lamp, host); kit.add(tint3(xf(bx(0.08, 0.1, 0.03), s * 1.05, 0.82, fz), LAMP.amber), M.lamp, host); }
  kit.add(tint3(xf(rb(2.3, 0.22, 0.12, 0.05), 0, 0.5, fz), C.dark), M.trim, host);
  { const pl = new THREE.PlaneGeometry(0.46, 0.14); M.platesFront = pl; kit.add(xf(pl, 0, 0.52, fz + 0.065), M.decal, host); }
  const rz = -L2 * 0.99 - 0.006;
  for (const s of [-1, 1]) kit.add(xf(bx(0.2, 0.36, 0.03), s * 0.95, 1.0, rz), M.tail, host);
  kit.add(xf(bx(0.9, 0.05, 0.03), 0, 2.85, rz), M.tail, host);
  kit.add(tint3(xf(rb(2.3, 0.22, 0.12, 0.05), 0, 0.5, rz), C.dark), M.trim, host);
  { const pl = new THREE.PlaneGeometry(0.46, 0.14); pl.rotateY(Math.PI); M.platesRear = pl; kit.add(xf(pl, 0, 0.75, rz - 0.01), M.decal, host); }
  for (const s of [-1, 1]) { kit.add(tint3(rod(V3(s * 1.1, 2.4, L2 * 0.9), V3(s * 1.32, 2.5, L2 * 0.88), 0.02, 6), C.black), M.trim, host); kit.add(tint3(xf(rb(0.06, 0.36, 0.2, 0.03), s * 1.34, 2.36, L2 * 0.88), C.black), M.trim, host); }
  kit.add(tint3(xf(rb(1.6, 0.18, 1.6, 0.05), 0, 3.1, -1.6), C.grey), M.trim, host);   // roof HVAC pod
  return finish('bus', S, kit, host, M, {});
}

// ---------------------------------------------------------------- per-type cache
const TYPES = new Map();
function finish(kind, S, kit, host, M, fns) {
  const geos = new Map();
  for (const { mat, geos: arr } of kit.bins.values()) { const key = Object.keys(M).find((k) => M[k] === mat); geos.set(key, (geos.get(key) || []).concat(arr)); }
  kit.bins.clear();
  const merged = {};
  for (const [k, arr] of geos) { merged[k] = mergeGeometries(arr, false); merged[k].computeBoundingSphere(); }
  // licence plate quads are cloned per car (their UVs pick a plate), so remember where they sit inside the decal geometry
  const T = { kind, S, geo: merged, platesFront: M.platesFront, platesRear: M.platesRear, brandSides: M.brandSides, fns, height: kind === 'bus' ? 3.1 : kind === 'truck' ? 3.5 : (S.roof || 1.5) };
  return T;
}
function typeData(kind) {
  if (!TYPES.has(kind)) TYPES.set(kind, kind === 'truck' ? buildTruck() : kind === 'bus' ? buildBus() : buildCarType(kind));
  return TYPES.get(kind);
}

let plateN = 0;
/**
 * @param kind  one of CAR_TYPES ('truck' is the box truck)
 * @param color paint colour (hex); taxis / police / buses keep their livery
 * @returns Group with userData { len, wid, kind, paint, tail, wheels, front, wheelR, chassis, lampMesh, tailMesh, neon, lightbar? }
 */
export function makeCarModel(kind, color, neon = null) {
  if (!CAR_SPECS[kind]) kind = 'sedan';
  const T = typeData(kind), S = T.S, SHm = shared();
  const root = new THREE.Group(), chassis = new THREE.Group(); root.add(chassis);
  const livery = kind === 'taxi' ? 0xe8b414 : kind === 'police' ? 0x0a0a0d : kind === 'bus' ? 0xd8dce4 : color;
  const metallic = kind === 'police' || kind === 'bus' || kind === 'truck' ? 0.3 : 0.45 + Math.random() * 0.4;
  const paint = new THREE.MeshPhysicalMaterial({ color: livery, roughness: 0.28 + Math.random() * 0.12, metalness: metallic, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.5 });
  const tail = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.06, 0.05), toneMapped: false });
  const mats = { paint, glass: SHm.glass, trim: SHm.trim, lamp: SHm.lamp, tail, decal: SHm.decal };
  let lampMesh = null, tailMesh = null;
  for (const [k, g] of Object.entries(T.geo)) {
    let geo = g;
    if (k === 'decal') {   // per-car copy so the plate quads can pick a plate (and trucks a brand)
      geo = g.clone(); const uv = geo.attributes.uv; const pid = plateN++ % 16, [u0, v0, w, h] = CELLS['plate' + pid], brand = 'brand' + Math.floor(Math.random() * 3);
      const pos = geo.attributes.position;
      // plates are the quads whose UVs are still the default 0..1 range; remap them into the chosen plate cell
      for (let i = 0; i < uv.count; i += 3) {
        let unit = true; for (let j = 0; j < 3; j++) { const x = uv.getX(i + j), y = uv.getY(i + j); if (!((x === 0 || x === 1) && (y === 0 || y === 1))) unit = false; }
        if (!unit) continue;
        const big = Math.abs(pos.getY(i) - pos.getY(i + 1)) > 0.5 || Math.abs(pos.getY(i) - pos.getY(i + 2)) > 0.5;
        const cellName = big ? brand : null;
        const [cu, cv, cw, chh] = cellName ? CELLS[cellName] : [u0, v0, w, h];
        for (let j = 0; j < 3; j++) uv.setXY(i + j, cu + uv.getX(i + j) * cw, cv + uv.getY(i + j) * chh);
      }
      uv.needsUpdate = true;
    }
    const mesh = new THREE.Mesh(geo, mats[k]);
    mesh.castShadow = k === 'paint' || k === 'trim';
    chassis.add(mesh);
    if (k === 'lamp') { lampMesh = mesh; mesh.userData.lamp = true; }
    if (k === 'tail') { tailMesh = mesh; mesh.userData.tail = true; }
  }
  // police light bar: two animated halves
  let lightbar = null;
  if (kind === 'police') {
    const red = new THREE.MeshBasicMaterial({ color: 0x401010, toneMapped: false }), blue = new THREE.MeshBasicMaterial({ color: 0x101040, toneMapped: false });
    const geo = rb(0.5, 0.11, 0.24, 0.04);
    const l = new THREE.Mesh(geo, red); l.position.set(0.3, S.roof + 0.11, -0.25); chassis.add(l);
    const r = new THREE.Mesh(geo, blue); r.position.set(-0.3, S.roof + 0.11, -0.25); chassis.add(r);
    lightbar = { red, blue, t: Math.random() * 3 };
  }
  // wheels
  const wheels = [], front = [];
  const style = S.rim || (kind === 'truck' || kind === 'bus' ? 'truck' : 'alloy');
  const wg = wheelGeo(S.R, S.TW, style);
  const wx = S.W / 2 - S.TW / 2 - 0.02;
  S.ax.forEach((az, i) => {
    const steer = i === 0, dual = kind === 'truck' && az < 0;
    for (const s of [-1, 1]) {
      const piv = new THREE.Group(); piv.position.set(s * (wx - (dual ? (S.TW + 0.04) / 2 : 0)), S.R, az);
      const w = new THREE.Mesh(dual ? dualGeo(wg, S.TW + 0.04) : wg, SHm.wheel); w.castShadow = true; if (s < 0) w.scale.x = -1; piv.add(w); root.add(piv);
      wheels.push(w); if (steer) front.push(piv);
    }
  });
  const nc = new THREE.Color(neon ?? 0x2060ff);
  root.userData = { len: S.L, wid: S.W, kind, big: !!S.big, height: T.height, paint, tail, wheels, front, wheelR: S.R, chassis, lampMesh, tailMesh, neon: nc, lightbar };
  return root;
}

// police light bar animation (call per frame with the car's model)
export function animateCar(model, dt, on = true) {
  const lb = model.userData.lightbar; if (!lb) return;
  lb.t += dt;
  const ph = lb.t * 7, a = Math.floor(ph) % 4, k = on ? 1 : 0;
  lb.red.color.setRGB(a < 2 && (a === 0 || ph % 1 < 0.5) ? 4 * k + 0.25 : 0.25, 0.02, 0.02);
  lb.blue.color.setRGB(0.02, 0.05, a >= 2 && (a === 2 || ph % 1 < 0.5) ? 4 * k + 0.25 : 0.25);
}
