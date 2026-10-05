import { Atlas, SHADE, fbm } from './chargeneric_tex.js';
import { headU, headPh, thOfY } from './chargeneric_geo.js';

// ===========================================================================
// Swatch painters for the perp / civilian atlases.  Colour slots (see chargeneric_tex.js):
//   skin atlas:  A skin tone, B hair colour, C lips / makeup / veins, D eye white & teeth
//   under atlas: A trousers / skirt, B shirt, C footwear + belt + gloves, D metal hardware & light soles
//   armor atlas: A garment main, B trim / lining / secondary panels, C logo / stripe accent, D metal & visor
// Shade 186 = the slot colour itself; lower is darker, up to 255 = 2x.
// ===========================================================================
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TAU = Math.PI * 2;
const sh = SHADE;

// ---------------------------------------------------------------------------------------------- face cell
// face-space helpers: feature (ph, Y) -> px in a 256 cell
const FX = (P, ph) => headU(ph) * P.w;
const FY = (P, Y) => (thOfY(Y) / Math.PI) * P.h;
const EYE = { ph: 0.33, Y: 0.06 };
function soft(P, x, y, rx, ry, k, o = {}) { // radial soft shade: k<1 darkens, k>1 lightens
  const R = 1.35; // gradient falls off past the nominal radius like the old blurred ellipse
  P.glow(x, y, rx * R, ry * R, k < 1 ? { mul: k, alpha: o.alpha ?? 1, rot: o.rot, core: 0.3 } : { add: (k - 1) * 120, alpha: o.alpha ?? 1, rot: o.rot, core: 0.3 });
}
function hairPoly(P, thFn, x0 = 0, x1 = 1, step = 0.02) {
  const pts = [[x0 * P.w, -4]];
  for (let u = x0; u <= x1 + 1e-6; u += step) pts.push([u * P.w, (thFn(headPh(clamp(u, 0, 1))) / Math.PI) * P.h]);
  pts.push([x1 * P.w, -4]);
  return pts;
}
export const hairlineFn = (front = 0.95, side = 1.45, back = 2.05) => (ph) => {
  const a = Math.abs(ph) / Math.PI;
  const s = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  return a < 0.5 ? front + (side - front) * s(0.05, 0.5, a) : side + (back - side) * s(0.5, 0.95, a);
};
export function paintFace(P, o) {
  const w = P.w, h = P.h;
  P.fill('A', o.base ?? 178, { rough: 0.55, h: 128 });
  P.grain('skin', 1);
  const eyeY = FY(P, EYE.Y), eyeXL = FX(P, EYE.ph), eyeXR = FX(P, -EYE.ph), cx = w / 2;
  const browY = FY(P, 0.205), noseY = FY(P, -0.2), mouthY = FY(P, -0.46), chinY = FY(P, -0.84);
  // ---- form shading (painted light/shadow so the face reads under flat night lighting)
  soft(P, cx, FY(P, 0.42), 26, 14, 1.12);                                  // forehead highlight
  soft(P, cx, FY(P, -0.05), 5, 16, 1.16);                                  // nose ridge
  for (const x of [eyeXL, eyeXR]) {
    soft(P, x, eyeY + 1, 9, 5, o.sunken ? 0.6 : 0.8);                     // sockets (hidden under the eye patch)
    soft(P, x + (x > cx ? 9 : -9), FY(P, -0.12), 12, 8, 1.1);              // cheekbones
    soft(P, x + (x > cx ? 6 : -6), FY(P, -0.34), 11, 10, o.gaunt ? 0.5 : 0.84); // under-cheek hollow
  }
  soft(P, cx, FY(P, -0.29), 10, 4, 0.82);                                  // under the nose
  soft(P, cx, FY(P, -0.6), 9, 4, 0.82);                                    // under the lower lip
  soft(P, cx, chinY - 2, 12, 6, 1.1);                                      // chin highlight
  P.rect(0, FY(P, -0.9), w, h, { mul: 0.86, blur: 6 });                    // under jaw
  for (const s of [1, -1]) { const ex = FX(P, s * 1.67), ey = FY(P, -0.02); soft(P, ex, ey, 8, 13, 0.9); soft(P, ex - s * 1.5, ey + 1, 3.5, 7, 0.7); P.ellipse(ex, ey, 7, 12, { slot: 'C', shade: 190, alpha: 0.18, blur: 3 }); } // ears
  // living skin: warmer nose tip / cheeks / chin (lip-colour tint at low alpha)
  P.ellipse(cx, FY(P, -0.18), 7, 6, { slot: 'C', shade: 186, alpha: 0.16, blur: 3 });
  for (const s of [1, -1]) P.ellipse(cx + s * 22, FY(P, -0.2), 12, 9, { slot: 'C', shade: 186, alpha: 0.1, blur: 5 });
  // nasolabial folds
  for (const s of [1, -1]) P.line([[cx + s * 7, FY(P, -0.22)], [cx + s * 13, FY(P, -0.36)], [cx + s * 15, FY(P, -0.48)]], { mul: o.old ? 0.6 : 0.8, lw: o.old ? 2.4 : 1.6, blur: 1.2, h: 100, hA: 0.5 });
  // nostrils
  for (const s of [1, -1]) P.ellipse(cx + s * 5, FY(P, -0.27), 2.4, 1.3, { mul: 0.5, blur: 0.6 });
  // ---- age / condition
  if (o.old) {
    for (let i = 0; i < 3; i++) P.line([[cx - 22, FY(P, 0.38 + i * 0.07)], [cx, FY(P, 0.4 + i * 0.07) - 1], [cx + 22, FY(P, 0.38 + i * 0.07)]], { mul: 0.78, lw: 1, h: 90, hA: 0.6 });
    for (const x of [eyeXL, eyeXR]) { const s = x > cx ? 1 : -1; for (let i = 0; i < 3; i++) P.line([[x + s * 13, eyeY - 3 + i * 3], [x + s * 18, eyeY - 5 + i * 4]], { mul: 0.75, lw: 0.8, h: 90 }); }
    for (let i = 0; i < 7; i++) P.ellipse(cx + (P.rng() - 0.5) * 60, FY(P, 0.3 + P.rng() * 0.4), 1.5 + P.rng() * 2, 1.2 + P.rng() * 1.5, { mul: 0.8, blur: 0.8 });
  }
  if (o.freckles) for (let i = 0; i < 70; i++) { const s = P.rng() < 0.5 ? -1 : 1; P.ellipse(cx + s * (4 + P.rng() * 26), FY(P, -0.05 - P.rng() * 0.22), 0.8, 0.8, { mul: 0.72 }); }
  if (o.blotch) for (let i = 0; i < 14; i++) P.ellipse(P.rng() * w, FY(P, 0.6 - P.rng() * 1.5), 3 + P.rng() * 5, 2 + P.rng() * 4, { mul: 0.82 + P.rng() * 0.1, blur: 2 });
  // ---- scalp / hair paint
  const hl = o.hairline;
  if (hl) {
    const fn = hairlineFn(hl.front ?? 0.95, hl.side ?? 1.45, hl.back ?? 2.05);
    const pts = hairPoly(P, fn);
    const g = hl.cover ?? 255; // partial cover -> stubble/buzz
    P.poly(pts, { slot: g >= 250 ? 'B' : null, mul: g >= 250 ? null : 0.9, shade: hl.shade ?? 170, h: 128, rough: 0.62 });
    if (g < 250) { // buzz: partial blend of hair over skin, speckled
      P.poly(pts, { slot: 'B', shade: 150, alpha: g / 255 });
      P.pixels({ m: (x, y, d, i) => { if (d[i + 1] > 30 && d[i + 1] < 250) { const n = Math.random(); d[i + 1] = clamp(d[i + 1] + (n - 0.5) * 120, 0, 255); d[i] = clamp(d[i] - n * 20, 0, 255); } } }, 'm');
    } else {
      // strands flowing back from the hairline
      for (let i = 0; i < 260; i++) {
        const u = P.rng(), ph = headPh(u), yl = fn(ph) / Math.PI * h, y0 = P.rng() * yl;
        P.line([[u * w, y0], [u * w + (P.rng() - 0.5) * 3, Math.min(yl, y0 + 6 + P.rng() * 18)]], { slot: 'B', shade: 120 + P.rng() * 110, lw: 0.8 + P.rng(), alpha: 0.5, h: 128 + (P.rng() - 0.5) * 120, hA: 0.6 });
      }
      // soft hairline edge
      const edge = []; for (let u = 0; u <= 1.0001; u += 0.01) edge.push([u * w, fn(headPh(clamp(u, 0, 1))) / Math.PI * h]);
      P.line(edge, { slot: 'B', shade: 140, lw: 3, alpha: 0.45, blur: 1.5 });
    }
    if (hl.part) { const x = FX(P, hl.part); P.line([[x, FY(P, 0.95)], [x, FY(P, 0.55)]], { mul: 0.55, lw: 1.2, h: 60 }); }
  }
  if (o.sides) { // shaved sides with a top strip (mohawk base / undercut)
    const pts = hairPoly(P, hairlineFn(1.05, 1.5, 2.05));
    P.poly(pts, { slot: 'B', shade: 140, alpha: 0.42 });
    P.pixels({ m: (x, y, d, i) => { if (d[i + 1] > 20 && d[i + 1] < 200) d[i + 1] = clamp(d[i + 1] + (Math.random() - 0.5) * 90, 0, 255); } }, 'm');
    if (o.strip) { const sw = o.strip; P.rect(cx - sw - 0.5 * w, 0, 0, 0, { mul: 1 }); for (const x0 of [0, w]) void x0; P.rect(0, 0, 10, FY(P, 0.0), { slot: 'B', shade: 160 }); P.rect(w - 10, 0, 10, FY(P, 0.0), { slot: 'B', shade: 160 }); P.rect(cx - sw, 0, sw * 2, FY(P, 0.62), { slot: 'B', shade: 165 }); }
  }
  if (o.baldShine) { soft(P, cx, FY(P, 0.88), 40, 14, 1.15); P.rect(0, 0, w, FY(P, 0.9), { rough: 0.38 }); }
  // ---- brows (slot B)
  const bw = o.browW ?? 1, bt = (o.browT ?? 1) * 1.3, ang = o.browAngle ?? 0.5; // angle: + = angry (inner end lower)
  for (const s of [1, -1]) {
    const x0 = FX(P, s * 0.1), x1 = FX(P, s * 0.33), x2 = FX(P, s * (0.56 * bw));
    const y0 = browY + 1 + ang * 3, y1 = browY - 2.2 - (o.browArch ?? 0.3) * 2, y2 = browY + 0.5 - ang * 1.2;
    const pts = [[x0, y0 - 2 * bt], [x1, y1 - 2.2 * bt], [x2, y2 - 1 * bt], [x2, y2 + 0.6 * bt], [x1, y1 + 1.8 * bt], [x0, y0 + 1.6 * bt]];
    P.poly(pts, { slot: 'B', shade: o.browShade ?? 86, h: 150, hA: 0.6, rough: 0.7 });
    for (let k = 0; k < 14; k++) { const t = P.rng(); const x = x0 + (x2 - x0) * t; P.line([[x, y0 + (y2 - y0) * t + 1.5], [x + s * 2.5, y0 + (y2 - y0) * t - 1.5]], { slot: 'B', shade: 90, lw: 0.6, alpha: 0.7 }); }
    if (o.browSlit && s === o.browSlit) P.line([[x1 + s * 2, y1 - 4], [x1 - s * 1, y1 + 4]], { slot: 'A', shade: 190, lw: 1.6 });
  }
  // ---- fallback eyes (covered by the eye patches, visible only at extreme angles)
  for (const x of [eyeXL, eyeXR]) P.ellipse(x, eyeY, 6, 2.2, { slot: 'D', shade: 120 });
  // ---- mouth (lips slot C)
  const mw = (o.mouthW ?? 1) * 17, ex = o.mouth || 'neutral';
  const upY = mouthY - 3.2 * (o.lipK ?? 1), loY = mouthY + 4.2 * (o.lipK ?? 1);
  const smile = ex === 'grin' ? -2.5 : ex === 'frown' ? 2.5 : ex === 'snarl' ? -1 : 0;
  P.poly([[cx - mw, mouthY + smile * 0.6], [cx - mw * 0.45, upY - 0.4], [cx - 2.5, upY + 0.6], [cx, upY - 0.5], [cx + 2.5, upY + 0.6], [cx + mw * 0.45, upY - 0.4], [cx + mw, mouthY + smile * 0.6], [cx + mw * 0.5, loY], [cx, loY + 0.8], [cx - mw * 0.5, loY]], { slot: 'C', shade: o.lipShade ?? 175, h: 160, hA: 0.7, rough: 0.38 });
  P.poly([[cx - mw, mouthY + smile * 0.6], [cx - mw * 0.45, upY - 0.4], [cx - 2.5, upY + 0.6], [cx, upY - 0.5], [cx + 2.5, upY + 0.6], [cx + mw * 0.45, upY - 0.4], [cx + mw, mouthY + smile * 0.6]], { mul: 0.78 });
  soft(P, cx, loY - 1.2, mw * 0.45, 1.6, 1.2);
  if (ex === 'grin' || ex === 'snarl') {
    const tY = mouthY, tw = ex === 'grin' ? mw * 0.8 : mw * 0.55, tx = ex === 'snarl' ? cx + 3 : cx;
    P.poly([[tx - tw, tY - 0.5], [tx + tw, tY - 0.5], [tx + tw * 0.8, tY + 2.4], [tx - tw * 0.8, tY + 2.4]], { slot: 'D', shade: 170, rough: 0.3 });
    for (let k = -3; k <= 3; k++) P.line([[tx + k * tw / 3.5, tY - 0.5], [tx + k * tw / 3.5, tY + 2.3]], { mul: 0.7, lw: 0.5 });
    if (o.goldTooth) P.rect(tx + tw * 0.35, tY - 0.5, 2.6, 2.6, { slot: 'C', shade: 230, rough: 0.2, metal: 1 });
  }
  P.line([[cx - mw, mouthY + smile * 0.6], [cx - mw * 0.5, mouthY + 0.4], [cx, mouthY + 0.8], [cx + mw * 0.5, mouthY + 0.4], [cx + mw, mouthY + smile * 0.6]], { slot: 'A', shade: 22, lw: 1.8, h: 50, hA: 0.8 });
  for (const s of [1, -1]) P.ellipse(cx + s * mw, mouthY + smile * 0.6, 1.6, 1.6, { mul: 0.6, blur: 0.8 });
  // ---- facial hair
  if (o.stubble) {
    const a = o.stubble;
    // jaw line + chin + upper lip (cheeks stay clean above the mouth corners)
    P.shape((c) => { c.moveTo(FX(P, -1.5), FY(P, -0.2)); c.quadraticCurveTo(FX(P, -1.15), FY(P, -0.62), FX(P, -0.55), FY(P, -0.95)); c.lineTo(FX(P, 0.55), FY(P, -0.95)); c.quadraticCurveTo(FX(P, 1.15), FY(P, -0.62), FX(P, 1.5), FY(P, -0.2)); c.lineTo(FX(P, 1.2), FY(P, -0.32)); c.quadraticCurveTo(FX(P, 0.75), FY(P, -0.42), FX(P, 0.42), FY(P, -0.36)); c.quadraticCurveTo(FX(P, 0.2), FY(P, -0.3), 0.5 * w, FY(P, -0.31)); c.quadraticCurveTo(FX(P, -0.2), FY(P, -0.3), FX(P, -0.42), FY(P, -0.36)); c.quadraticCurveTo(FX(P, -0.75), FY(P, -0.42), FX(P, -1.2), FY(P, -0.32)); c.closePath(); }, { slot: 'B', shade: 140, alpha: 0.5 * a, blur: 2.5 });
    P.rect(0, FY(P, -0.9), w, h, { slot: 'B', shade: 150, alpha: 0.25 * a, blur: 3 });
    P.pixels({ m: (x, y, d, i) => { if (d[i + 1] > 8 && d[i + 2] < 10 && d[i + 1] < 200) { d[i + 1] = clamp(d[i + 1] * (0.5 + Math.random()), 0, 255); } } }, 'm');
  }
  if (o.goatee) {
    P.shape((c) => { c.moveTo(cx - mw * 0.95, mouthY + 1); c.quadraticCurveTo(cx - mw * 0.9, loY + 8, cx - 8, chinY - 4); c.quadraticCurveTo(cx, chinY + 4, cx + 8, chinY - 4); c.quadraticCurveTo(cx + mw * 0.9, loY + 8, cx + mw * 0.95, mouthY + 1); c.lineTo(cx + mw * 0.6, loY + 1.5); c.quadraticCurveTo(cx, loY + 4.5, cx - mw * 0.6, loY + 1.5); c.closePath(); }, { slot: 'B', shade: 130, h: 150, hA: 0.5, rough: 0.7, blur: 0.8 });
    for (let k = 0; k < 40; k++) { const x = cx + (P.rng() - 0.5) * mw * 1.6, y = loY + 3 + P.rng() * (chinY - loY - 4); P.line([[x, y], [x + (P.rng() - 0.5) * 1.5, y + 3]], { slot: 'B', shade: 90 + P.rng() * 80, lw: 0.6, alpha: 0.8 }); }
  }
  if (o.mustache) P.shape((c) => { c.moveTo(cx - mw - 2, mouthY + 2 + (o.mustache === 'horseshoe' ? 14 : 0)); c.lineTo(cx - mw * 0.9, upY - 2); c.quadraticCurveTo(cx, upY - 7, cx + mw * 0.9, upY - 2); c.lineTo(cx + mw + 2, mouthY + 2 + (o.mustache === 'horseshoe' ? 14 : 0)); c.lineTo(cx + mw - 2, mouthY - 1); c.quadraticCurveTo(cx, upY - 2.5, cx - mw + 2, mouthY - 1); c.closePath(); }, { slot: 'B', shade: 135, h: 150, hA: 0.5, rough: 0.7 });
  if (o.beard) P.shape((c) => { c.moveTo(FX(P, -1.5), FY(P, -0.1)); c.quadraticCurveTo(FX(P, -1.1), FY(P, -0.7), cx, FY(P, -0.99)); c.quadraticCurveTo(FX(P, 1.1), FY(P, -0.7), FX(P, 1.5), FY(P, -0.1)); c.lineTo(FX(P, 0.9), FY(P, -0.3)); c.lineTo(cx + mw + 2, mouthY - 2); c.quadraticCurveTo(cx, upY - 6, cx - mw - 2, mouthY - 2); c.lineTo(FX(P, -0.9), FY(P, -0.3)); c.closePath(); }, { slot: 'B', shade: 140, h: 150, hA: 0.5, rough: 0.72 });
  // ---- marks
  for (const sc of o.scars || []) {
    const pts = sc.map(([ph, Y]) => [FX(P, ph), FY(P, Y)]);
    P.line(pts, { slot: 'A', shade: 215, lw: 2.2, h: 70, hA: 0.9 });
    P.line(pts, { slot: 'C', shade: 150, lw: 0.9, alpha: 0.6 });
    for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < 3; k++) { const t = (k + 0.5) / 3, x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t; P.line([[x - 1.5, y - 1.5], [x + 1.5, y + 1.5]], { slot: 'A', shade: 205, lw: 0.8 }); }
  }
  for (const t of o.tattoos || []) TATTOO[t.kind]?.(P, t);
  if (o.makeup) {
    const m = o.makeup;
    for (const x of [eyeXL, eyeXR]) P.ellipse(x, eyeY - 3, 10, 5, { slot: 'C', shade: 150, alpha: m.shadow ?? 0.35, blur: 2.5 });
    if (m.blush) for (const x of [eyeXL, eyeXR]) P.ellipse(x + (x > cx ? 5 : -5), FY(P, -0.18), 9, 6, { slot: 'C', shade: 200, alpha: m.blush, blur: 4 });
  }
  if (o.veins) {
    for (let i = 0; i < 9; i++) {
      const s = i % 2 ? 1 : -1, x0 = FX(P, s * (0.9 + P.rng() * 0.6)), y0 = FY(P, 0.3 - P.rng() * 0.5);
      const pts = [[x0, y0]]; for (let k = 0; k < 5; k++) pts.push([pts[k][0] + (P.rng() - 0.5) * 8, pts[k][1] + 3 + P.rng() * 4]);
      P.line(pts, { slot: 'C', shade: 170, lw: 1.1, alpha: 0.8, h: 160, hA: 0.5 });
    }
    for (const x of [eyeXL, eyeXR]) P.ellipse(x, eyeY + 6, 12, 5, { mul: 0.6, blur: 3 });
  }
  if (o.sores) for (let i = 0; i < 6; i++) { const x = cx + (P.rng() - 0.5) * 70, y = FY(P, 0.2 - P.rng() * 1.0); P.ellipse(x, y, 2.4, 2, { slot: 'C', shade: 120, h: 90 }); P.ellipse(x, y, 1, 1, { mul: 0.5 }); }
  // ---- neck band (v 0..0.075 of the cell = bottom rows)
  const ny0 = h * (1 - 0.075);
  P.rect(0, ny0, w, h - ny0, { slot: 'A', shade: o.base ?? 182 });
  P.rect(0, ny0 - 3, w, 6, { mul: 0.92, blur: 3 });
  if (o.neckTat) TATTOO[o.neckTat]?.(P, { neck: true });
  // ---- roughness accents: oily T-zone, lips
  P.rect(cx - 30, FY(P, 0.55), 60, FY(P, -0.25) - FY(P, 0.55), { rough: 0.46, oA: 0.6, blur: 6 });
}
const TATTOO = {
  tear(P) { const x = FX(P, -0.36), y = FY(P, -0.06); P.shape((c) => { c.moveTo(x, y - 3); c.quadraticCurveTo(x + 2.4, y + 1, x, y + 2.6); c.quadraticCurveTo(x - 2.4, y + 1, x, y - 3); }, { slot: 'A', shade: 55 }); },
  cheek13(P) { const x = FX(P, 0.78), y = FY(P, -0.2); P.atlas.mx; P.shape((c) => { c.rect(x - 4, y - 5, 1.6, 10); c.moveTo(x - 0.5, y - 5); c.lineTo(x + 4, y - 5); c.lineTo(x + 1, y); c.lineTo(x + 4, y + 2); c.lineTo(x + 2, y + 5); c.lineTo(x - 0.5, y + 5); c.lineTo(x + 2, y + 2); c.lineTo(x, y); c.lineTo(x + 2, y - 3); c.lineTo(x - 0.5, y - 3); c.closePath(); }, { slot: 'A', shade: 60 }); },
  tribal(P) {
    for (const s of [1, -1]) { const x = FX(P, s * 1.05), y = FY(P, 0.32); P.shape((c) => { c.moveTo(x, y - 10); c.quadraticCurveTo(x + s * 10, y, x + s * 4, y + 14); c.quadraticCurveTo(x + s * 5, y + 2, x - s * 2, y - 2); c.closePath(); }, { slot: 'A', shade: 60 }); }
  },
  barcode(P, t) { const x = t.neck ? P.w * 0.5 + 18 : FX(P, -1.1), y = t.neck ? P.h * 0.955 : FY(P, 0.15); for (let i = 0; i < 9; i++) P.rect(x + i * 1.6, y - 4, (i % 3 ? 0.7 : 1.2), 8, { slot: 'A', shade: 55 }); },
  web(P, t) { const x = t.neck ? P.w * 0.5 - 40 : FX(P, 1.3), y = t.neck ? P.h * 0.97 : FY(P, -0.5); for (let a = 0; a < 6; a++) P.line([[x, y], [x + Math.cos(a) * 14, y + Math.sin(a) * 8]], { slot: 'A', shade: 60, lw: 0.8 }); for (const r of [5, 9, 13]) P.ellipse(x, y, r, r * 0.6, { slot: 'A', shade: 60, lw: 0.7 }); },
  skull(P, t) { const x = t.neck ? P.w * 0.5 : FX(P, 1.25), y = t.neck ? P.h * 0.965 : FY(P, 0.05); P.ellipse(x, y - 1, 6, 5.5, { slot: 'A', shade: 60 }); P.rect(x - 3.5, y + 2, 7, 4, { slot: 'A', shade: 60 }); for (const s of [-1, 1]) P.ellipse(x + s * 2.4, y - 1, 1.6, 1.8, { slot: 'A', shade: 185 }); },
  slash(P) { const x = FX(P, -0.62), y = FY(P, 0.25); for (let i = 0; i < 3; i++) P.line([[x + i * 3, y], [x + i * 3 - 5, y + 14]], { slot: 'A', shade: 60, lw: 1.4 }); },
  stars(P) { for (let i = 0; i < 3; i++) { const x = FX(P, 0.55 + i * 0.12), y = FY(P, 0.02 - i * 0.07); star(P, x, y, 2.6, { slot: 'A', shade: 60 }); } },
};
function star(P, x, y, r, st) { P.shape((c) => { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; i ? c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : c.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.closePath(); }, st); }

// ---------------------------------------------------------------------------------------------- eye patch (96 x 64)
// u: 0 = nose side .. 1 = outer corner;  v: eyeY-0.1 .. eyeY+0.12  (eye centre ~ (48, 35))
export function paintEye(P, o) {
  const w = P.w, h = P.h, cx = w * 0.5, cy = h * 0.476;
  P.fill('A', o.base ?? 178, { rough: 0.55 });
  P.grain('skin', 1);
  // socket shading, fading to nothing at the patch border so it blends into the face texture
  P.ellipse(cx - 3, cy - 1, 34, 15, { mul: o.sunken ? 0.5 : 0.74, blur: 9 });
  P.ellipse(cx - 2, cy - 12, 30, 7, { mul: 0.8, blur: 5 });
  if (o.bags || o.sunken) { P.ellipse(cx + 2, cy + 11, 26, 6, { mul: o.sunken ? 0.55 : 0.75, blur: 4 }); P.line([[cx - 20, cy + 9], [cx + 6, cy + 14], [cx + 26, cy + 9]], { mul: 0.7, lw: 1.2, h: 90 }); }
  const ew = 31 * (o.w ?? 1), eh = 12.5 * (o.open ?? 1);
  const lidTilt = o.angry ? 3.5 : 0, droop = o.droop ? 2.5 : 0;
  // upper lid line from inner corner (left) to outer corner (right)
  const inner = [cx - ew, cy + 1.5], outer = [cx + ew, cy - 0.5 + (o.lift ?? 0) * -2 + droop];
  const upperCtl = [cx - 2, cy - eh * 1.25 + lidTilt * 0.6];
  const lowerCtl = [cx + 2, cy + eh * 0.85];
  const eyePath = (c) => { c.moveTo(...inner); c.quadraticCurveTo(upperCtl[0], upperCtl[1] + lidTilt * 0.8, ...outer); c.quadraticCurveTo(lowerCtl[0], lowerCtl[1], ...inner); c.closePath(); };
  // lid crease above
  P.shape((c) => { c.moveTo(inner[0] + 2, inner[1] - 4); c.quadraticCurveTo(cx, cy - eh * 2.1 + lidTilt, outer[0] + 1, outer[1] - 4); }, { mul: 0.72, lw: 1.4, blur: 0.8, h: 90, hA: 0.6 });
  if (o.liner) P.shape(eyePath, { slot: 'C', shade: 120, alpha: 0.5, blur: 4 });
  // eyeball bulge in the height map
  P.ellipse(cx, cy, ew * 0.9, eh * 1.2, { h: 175, hA: 0.8, blur: 5 });
  // sclera
  P.shape(eyePath, { slot: 'D', shade: o.bloodshot ? 190 : 205, rough: 0.12 });
  if (o.bloodshot) for (let i = 0; i < 8; i++) { const a = P.rng() < 0.5 ? -1 : 1; P.line([[cx + a * ew * 0.9, cy + (P.rng() - 0.5) * 4], [cx + a * ew * 0.45, cy + (P.rng() - 0.5) * 5]], { slot: 'C', shade: 150, lw: 0.6, alpha: 0.8 }); }
  // corner shading of the sclera
  P.save = null;
  P.ellipse(inner[0] + 3, cy, 7, 7, { mul: 0.75, blur: 3 }); P.ellipse(outer[0] - 3, cy, 7, 7, { mul: 0.8, blur: 3 });
  // iris + pupil (clipped to the eye opening by drawing inside a clip path)
  const ctxs = [P.atlas.mx, P.atlas.hx, P.atlas.ox];
  for (const c of ctxs) { c.save(); c.beginPath(); eyePath(c); c.clip(); }
  const ix = cx + (o.look ?? 0) * 6, iy = cy - 0.5, ir = 9.6 * (o.iris ?? 1);
  P.ellipse(ix, iy, ir, ir, { slot: 'D', shade: o.irisShade ?? 92, rough: 0.1 });
  P.ellipse(ix, iy, ir, ir, { mul: 0.6, lw: 1.4 });
  for (let a = 0; a < 18; a++) { const t = a / 18 * TAU; P.line([[ix + Math.cos(t) * ir * 0.35, iy + Math.sin(t) * ir * 0.35], [ix + Math.cos(t) * ir * 0.9, iy + Math.sin(t) * ir * 0.9]], { add: 14, lw: 0.6, alpha: 0.7 }); }
  P.ellipse(ix, iy, ir * (o.pupil ?? 0.42), ir * (o.pupil ?? 0.42), { slot: 'D', shade: 8 });
  P.ellipse(ix - ir * 0.35, iy - ir * 0.4, 2.2, 2.0, { slot: 'D', shade: 255 });
  P.ellipse(ix + ir * 0.4, iy + ir * 0.3, 0.9, 0.9, { slot: 'D', shade: 235 });
  // upper lid shadow on the eyeball
  P.shape((c) => { c.moveTo(...inner); c.quadraticCurveTo(upperCtl[0], upperCtl[1] + lidTilt * 0.8, ...outer); c.lineTo(outer[0], outer[1] + 4); c.quadraticCurveTo(upperCtl[0], upperCtl[1] + 6 + lidTilt, inner[0], inner[1] + 3); c.closePath(); }, { mul: 0.55, blur: 2 });
  for (const c of ctxs) c.restore();
  // lash line (upper, thick) + lower lid
  P.shape((c) => { c.moveTo(...inner); c.quadraticCurveTo(upperCtl[0], upperCtl[1] + lidTilt * 0.8, ...outer); }, { slot: 'A', shade: 28, lw: o.lashes ? 2.8 : 2.0, h: 80, hA: 0.6 });
  if (o.lashes) { for (let i = 0; i < 9; i++) { const t = 0.3 + i * 0.08, x = inner[0] + (outer[0] - inner[0]) * t, y = cy - eh * 0.95 * Math.sin(Math.PI * t) + 0.5; P.line([[x, y], [x + 2 + i * 0.3, y - 3]], { slot: 'A', shade: 25, lw: 0.9 }); } P.line([[outer[0] - 3, outer[1] - 0.5], [outer[0] + 5, outer[1] - 4]], { slot: 'A', shade: 25, lw: 1.8 }); }
  P.shape((c) => { c.moveTo(inner[0] + 3, inner[1] + 1); c.quadraticCurveTo(lowerCtl[0], lowerCtl[1] + 0.5, outer[0] - 1, outer[1] + 0.5); }, { slot: o.redRims ? 'C' : 'A', shade: o.redRims ? 150 : 115, lw: 1.1 });
  P.ellipse(inner[0] + 1.5, inner[1] + 0.5, 2.2, 1.6, { slot: 'C', shade: 170 });
}

// ---------------------------------------------------------------------------------------------- body skin, hands, hair
export function paintArmSkin(P, o) {
  const w = P.w, h = P.h;
  P.fill('A', o.base ?? 182, { rough: 0.55 }); P.grain('skin', 1);
  P.rect(0, 0, w, h * 0.06, { mul: 0.9, blur: 4 });
  P.ellipse(w * 0.5, h * 0.52, w * 0.18, h * 0.04, { mul: 0.85, blur: 3 }); // elbow
  if (o.hairy) P.pixels({ m: (x, y, d, i) => { if (Math.random() < 0.06) { d[i] = clamp(d[i] - 40, 0, 255); d[i + 1] = 200; } } }, 'm');
  if (o.sleeve) tattooSleeve(P, o.sleeve);
  if (o.tracks) {
    for (let i = 0; i < 4; i++) { const x = P.rng() * w; P.line([[x, h * 0.95], [x + (P.rng() - 0.5) * 20, h * 0.75], [x + (P.rng() - 0.5) * 30, h * 0.55], [x + (P.rng() - 0.5) * 20, h * 0.3]], { slot: 'C', shade: 165, lw: 1.6, alpha: 0.9, h: 160, hA: 0.6 }); }
    for (let i = 0; i < 26; i++) { const x = w * (0.65 + (P.rng() - 0.5) * 0.25), y = h * (0.45 + (P.rng() - 0.5) * 0.25); P.ellipse(x, y, 1.4, 1.4, { slot: 'A', shade: 70 }); if (i % 4 === 0) P.ellipse(x, y, 6, 5, { slot: 'C', shade: 110, alpha: 0.35, blur: 3 }); }
  }
}
function tattooSleeve(P, kind) {
  const w = P.w, h = P.h, ink = { slot: 'A', shade: 62 };
  if (kind === 'tribal') {
    for (let i = 0; i < 5; i++) { const y = h * (0.12 + i * 0.17); P.shape((c) => { c.moveTo(-4, y); for (let x = 0; x <= w + 4; x += 8) c.quadraticCurveTo(x + 4, y + ((x / 8) % 2 ? -12 : 12), x + 8, y); c.lineTo(w + 4, y + 7); for (let x = w; x >= -4; x -= 8) c.quadraticCurveTo(x - 4, y + 7 + ((x / 8) % 2 ? 7 : -7), x - 8, y + 7); c.closePath(); }, ink); }
  } else if (kind === 'skulls') {
    for (let i = 0; i < 7; i++) { const x = (i * 37) % w + 10, y = h * (0.18 + (i * 0.13) % 0.7); P.ellipse(x, y, 9, 8, ink); P.rect(x - 5, y + 4, 10, 6, ink); for (const s of [-1, 1]) P.ellipse(x + s * 3.5, y - 1, 2.4, 2.8, { slot: 'A', shade: 180 }); }
    for (let i = 0; i < 18; i++) P.line([[P.rng() * w, P.rng() * h], [P.rng() * w, P.rng() * h]], { slot: 'A', shade: 80, lw: 1, alpha: 0.5 });
  } else if (kind === 'text') {
    const c = P.atlas.mx; void c;
    for (let i = 0; i < 4; i++) { const y = h * (0.2 + i * 0.2); for (let k = 0; k < 6; k++) P.rect(10 + k * 14 + (i % 2) * 4, y, 9, 13, ink); }
  } else if (kind === 'flames') {
    for (let i = 0; i < 6; i++) { const x = i * w / 6; P.shape((c) => { c.moveTo(x, h * 0.98); c.quadraticCurveTo(x + 14, h * 0.75, x + 4, h * (0.5 + (i % 3) * 0.08)); c.quadraticCurveTo(x + 22, h * 0.72, x + w / 6, h * 0.98); c.closePath(); }, ink); }
  }
}
export function paintHand(P, o) {
  P.fill('A', o.base ?? 182, { rough: 0.55 }); P.grain('skin', 1);
  for (let i = 0; i < 4; i++) P.rect(P.w * (0.5 + i * 0.1) + 1, P.h * 0.45, P.w * 0.08, P.h * 0.08, { mul: 0.85, blur: 2 });
  P.rect(0, 0, P.w * 0.5, P.h, { mul: 0.95, blur: 3 });
}
export function paintHair(P, o) {
  P.fill('B', 160, { rough: 0.6 });
  if (o.kind === 'curly') {
    for (let i = 0; i < 260; i++) P.ellipse(P.rng() * P.w, P.rng() * P.h, 3 + P.rng() * 3, 3 + P.rng() * 3, { slot: 'B', shade: 110 + P.rng() * 100, lw: 1.1, h: 128 + (P.rng() - 0.5) * 140 });
  } else if (o.kind === 'dreads') {
    for (let x = 0; x < P.w; x += 4) for (let y = 0; y < P.h; y += 5) P.ellipse(x + 2, y + (x % 8 ? 2 : 0), 2.4, 2.6, { slot: 'B', shade: 130 + P.rng() * 60, h: 170, hA: 0.8 });
  } else {
    P.grain('hair', 1.1);
    for (let i = 0; i < 90; i++) { const x = P.rng() * P.w; P.line([[x, 0], [x + (P.rng() - 0.5) * 8, P.h]], { slot: 'B', shade: o.kind === 'spiky' ? 210 : 200, lw: 0.6, alpha: 0.5 }); }
  }
}

// ---------------------------------------------------------------------------------------------- garments
// torso garment swatch: u 0 = front centre, .25 left side, .5 back, .75 right side;  v = (y - 0.86) / 1.06
export const VY = (y) => (y - 0.86) / 1.06;
function fabric(P, slot, kind, o = {}) {
  const rough = { leather: 0.5, nylon: 0.58, satin: 0.5, denim: 0.85, cotton: 0.88, knit: 0.92, canvas: 0.85, wool: 0.9, rubber: 0.6, plate: 0.42, fur: 0.95, vinyl: 0.3 }[kind] ?? 0.8;
  P.fill(slot, o.shade ?? 186, { rough: o.rough ?? rough, metal: o.metal ?? 0 });
  P.grain(kind === 'satin' || kind === 'vinyl' ? 'nylon' : kind, o.grain ?? 1, { scale: o.scale ?? 1 });
}
function zip(P, x, y0, y1, o = {}) {
  P.rect(x - 3.5, y0, 7, y1 - y0, { slot: o.tapeSlot || 'A', shade: 70, h: 110 });
  for (let y = y0; y < y1; y += 2.4) P.rect(x - 2.2, y, 4.4, 1.3, { slot: 'D', shade: 200, metal: 1, rough: 0.3, h: 170 });
  if (o.pull) { P.rect(x - 2, y0 + (o.pullAt ?? 0.15) * (y1 - y0), 4, 9, { slot: 'D', shade: 210, metal: 1, rough: 0.25, h: 190 }); }
}
function pocket(P, x, y, w, h, o = {}) {
  if (o.welt) { P.rect(x, y, w, 3, { mul: 0.5, h: 50 }); P.seam([[x - 2, y - 2], [x + w + 2, y - 2]], { stitch: true }); P.seam([[x - 2, y + 5], [x + w + 2, y + 5]], { both: false }); return; }
  if (o.slant) { P.line([[x, y], [x + w, y + h]], { mul: 0.45, lw: 2.4, h: 40 }); P.seam([[x - 3, y - 1], [x + w - 3, y + h - 1]], { both: false }); return; }
  P.rect(x, y, w, h, { mul: o.dark ?? 0.94, h: 150, hA: 0.5 });
  P.seam([[x, y], [x, y + h], [x + w, y + h], [x + w, y]], { lw: 1.2 });
  if (o.flap) { P.rect(x - 1, y - 2, w + 2, h * 0.32, { mul: 0.9, h: 170, hA: 0.7 }); P.seam([[x - 1, y + h * 0.3], [x + w + 1, y + h * 0.3]], { both: false }); if (o.button) P.ellipse(x + w / 2, y + h * 0.18, 2, 2, { slot: 'D', shade: 190, metal: 1, rough: 0.3, h: 200 }); }
}
function logo(P, kind, x, y, s, st) {
  const S = (pts) => P.poly(pts.map(([a, b]) => [x + a * s, y + b * s]), st);
  switch (kind) {
    case 'skull': {
      P.ellipse(x, y - 0.1 * s, 0.42 * s, 0.38 * s, st); P.rect(x - 0.24 * s, y + 0.15 * s, 0.48 * s, 0.25 * s, st);
      const hole = { ...st, slot: undefined, mul: 0.25 };
      for (const k of [-1, 1]) P.ellipse(x + k * 0.16 * s, y - 0.08 * s, 0.1 * s, 0.12 * s, hole);
      S([[-0.03, 0.08], [0.03, 0.08], [0, 0.16]]);
      for (const k of [-1, 1]) P.line([[x - 0.55 * s, y + k * 0.5 * s], [x + 0.55 * s, y - k * 0.5 * s]], { ...st, lw: 0.12 * s });
      break;
    }
    case 'crown': S([[-0.5, 0.3], [-0.5, -0.2], [-0.25, 0.05], [0, -0.35], [0.25, 0.05], [0.5, -0.2], [0.5, 0.3]]); P.rect(x - 0.5 * s, y + 0.34 * s, s, 0.12 * s, st); break;
    case 'bolt': S([[0.1, -0.5], [-0.3, 0.05], [0.0, 0.05], [-0.15, 0.5], [0.3, -0.1], [0.0, -0.1]]); break;
    case 'rat': { P.ellipse(x, y, 0.4 * s, 0.22 * s, st); P.ellipse(x + 0.38 * s, y - 0.06 * s, 0.16 * s, 0.12 * s, st); P.ellipse(x + 0.3 * s, y - 0.22 * s, 0.08 * s, 0.08 * s, st); P.line([[x - 0.38 * s, y], [x - 0.6 * s, y + 0.25 * s], [x - 0.75 * s, y + 0.1 * s]], { ...st, lw: 0.05 * s }); break; }
    case 'eye': { P.ellipse(x, y, 0.5 * s, 0.24 * s, st); P.ellipse(x, y, 0.16 * s, 0.16 * s, { ...st, slot: undefined, mul: 0.2 }); break; }
    case 'ring': { P.ellipse(x, y, 0.5 * s, 0.5 * s, { ...st, lw: 0.12 * s }); S([[-0.06, -0.3], [0.06, -0.3], [0.06, 0.3], [-0.06, 0.3]]); break; }
    case 'flame': S([[-0.4, 0.5], [-0.45, 0.0], [-0.2, -0.2], [-0.25, -0.5], [0.05, -0.25], [0.15, -0.55], [0.3, -0.15], [0.45, 0.0], [0.4, 0.5]]); break;
    case 'star': star(P, x, y, 0.5 * s, st); break;
    case 'text': { // blocky gang name
      const n = 5; for (let i = 0; i < n; i++) P.rect(x - 0.9 * s + i * 0.38 * s, y - 0.18 * s, 0.28 * s, 0.36 * s, st); P.rect(x - 0.95 * s, y + 0.24 * s, 1.9 * s, 0.06 * s, st); break;
    }
    case 'diamond': S([[0, -0.5], [0.4, 0], [0, 0.5], [-0.4, 0]]); P.poly([[x, y - 0.3 * s], [x + 0.22 * s, y], [x, y + 0.3 * s], [x - 0.22 * s, y]], { ...st, slot: undefined, mul: 0.4 }); break;
    default: P.ellipse(x, y, 0.4 * s, 0.4 * s, st);
  }
}
// organic 3-tone camouflage blobs (slot B blobs, darker slot A blobs, small slot C/B specks)
function camo(P, o = {}) {
  const w = P.w, h = P.h, n = Math.round((w * h) / (o.density ?? 1400));
  const blob = (x, y, r, st) => { const pts = []; const k = 7 + Math.floor(P.rng() * 4); for (let i = 0; i < k; i++) { const a = i / k * Math.PI * 2, rr = r * (0.55 + P.rng() * 0.7); pts.push([x + Math.cos(a) * rr * 1.5, y + Math.sin(a) * rr]); } P.shape((c) => { c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i <= k; i++) { const p0 = pts[i % k], pm = pts[(i - 1) % k]; c.quadraticCurveTo(pm[0], pm[1], (pm[0] + p0[0]) / 2, (pm[1] + p0[1]) / 2); } c.closePath(); }, st); };
  // tonal: darker and lighter blobs of the base colour, softened blobs of the secondary colour
  for (let i = 0; i < n; i++) blob(P.rng() * w, P.rng() * h, (o.size ?? 10) * (0.6 + P.rng()), { slot: 'A', shade: 140 });
  for (let i = 0; i < n * 0.8; i++) blob(P.rng() * w, P.rng() * h, (o.size ?? 10) * 0.7 * (0.5 + P.rng()), { slot: o.slot1 || 'B', shade: 175, alpha: 0.55 });
  for (let i = 0; i < n * 0.6; i++) blob(P.rng() * w, P.rng() * h, (o.size ?? 10) * 0.45 * (0.5 + P.rng()), o.slot2 ? { slot: o.slot2, shade: 165, alpha: 0.5 } : { slot: 'A', shade: 212 });
}
// generic torso garment painter
export function paintTorso(P, o) {
  const w = P.w, h = P.h, U = (u) => u * w, V = (y) => (1 - VY(y)) * h;
  fabric(P, 'A', o.fabric || 'cotton', { shade: o.shade });
  if (o.camo) { camo(P, o.camo); P.grain(o.fabric || 'cotton', 0.6); }
  // trim panels (slot B): shoulders / yoke / side panels
  if (o.yoke) P.rect(-4, 0, w + 8, V(o.yoke), { slot: 'B', shade: 180 });
  for (const pn of o.panels || []) P.poly(pn.pts.map(([u, y]) => [U(u), V(y)]), { slot: pn.slot || 'B', shade: pn.shade ?? 180, h: 140, hA: 0.4 });
  if (o.stripes) for (const st of o.stripes) P.rect(U(st.u0), V(st.y1), U(st.u1 - st.u0), V(st.y0) - V(st.y1), { slot: st.slot || 'C', shade: st.shade ?? 186 });
  if (o.hazard) { const y0 = V(o.hazard[1]), y1 = V(o.hazard[0]); for (let x = -40; x < w + 40; x += 18) P.poly([[x, y1], [x + 9, y1], [x + 9 + (y1 - y0), y0], [x + (y1 - y0), y0]], { slot: 'C', shade: 186 }); P.rect(0, y0, w, y1 - y0, { mul: 1, h: 150, hA: 0.4 }); }
  // side seams, shoulder seams, back yoke
  for (const u of [0.25, 0.75]) P.seam([[U(u), V(1.75)], [U(u), h + 4]]);
  P.seam([[-2, V(1.79)], [w + 2, V(1.79)]], { stitch: false, lw: 1.2 });
  if (o.backYoke) P.seam([[U(0.32), V(1.62)], [U(0.5), V(1.66)], [U(0.68), V(1.62)]]);
  if (o.princess) for (const u of [0.1, 0.9, 0.4, 0.6]) P.seam([[U(u), V(1.7)], [U(u + (u < 0.5 ? 0.02 : -0.02) * (u > 0.2 && u < 0.8 ? -1 : 1)), h + 4]], { stitch: false, lw: 1 });
  // front closure
  const gu = (o.gapU ?? 0);
  if (o.zip) for (const x of [U(gu) + 3, U(1 - gu) - 3]) zip(P, x, V(o.zipTop ?? 1.88), h + 4, { pull: x < w / 2, pullAt: o.pullAt ?? 0.25 });
  if (o.buttons) { P.rect(-3, V(1.9), 9, h, { mul: 0.95, h: 145 }); P.rect(w - 6, V(1.9), 9, h, { mul: 0.95, h: 145 }); for (let y = V(1.82); y < h - 6; y += o.buttons) { P.ellipse(3, y, 2.6, 2.6, { slot: o.buttonSlot || 'D', shade: 170, metal: o.buttonSlot === 'B' ? 0 : 1, rough: 0.35, h: 200 }); } }
  if (o.snaps) for (let y = V(1.8); y < h - 8; y += 20) for (const x of [U(gu) + 4, U(1 - gu) - 4]) P.ellipse(x, y, 2.4, 2.4, { slot: 'D', shade: 200, metal: 1, rough: 0.3, h: 210 });
  // pockets
  for (const pk of o.pockets || []) for (const u of pk.mirror === false ? [pk.u] : [pk.u, 1 - pk.u - pk.w]) pocket(P, U(u), V(pk.y), U(pk.w), V(pk.y - pk.h) - V(pk.y), pk);
  // hem band / rib
  if (o.rib) { const y0 = h - (o.ribH ?? 14); P.rect(-4, y0, w + 8, h - y0 + 4, { slot: o.ribSlot || 'B', shade: 175, rough: 0.95, h: 128 }); for (let x = 0; x < w; x += 3) P.line([[x, y0], [x, h + 2]], { mul: 0.82, lw: 1, h: 100, hA: 0.7 }); P.seam([[-2, y0], [w + 2, y0]], { stitch: false }); }
  else P.seam([[-2, h - 7], [w + 2, h - 7]], { both: false });
  // logo on the back (and small chest logo)
  if (o.logo) {
    const L = o.logo; const st = { slot: L.slot || 'C', shade: L.shade ?? 186, h: 150, hA: 0.5, rough: 0.6 };
    if (L.back !== false) { if (L.ring) P.ellipse(U(0.5), V(L.y ?? 1.5), (L.size ?? 0.2) * h * 0.75, (L.size ?? 0.2) * h * 0.75, { ...st, lw: 4 }); logo(P, L.kind, U(0.5), V(L.y ?? 1.5), (L.size ?? 0.22) * h, st); if (L.rocker) { P.shape((c) => { c.arc(U(0.5), V(L.y ?? 1.5) + h * 0.05, h * 0.27, Math.PI * 1.15, Math.PI * 1.85); }, { ...st, lw: 7 }); } }
    if (L.chest) logo(P, L.kind, U(L.chestU ?? 0.12), V(1.62), h * 0.06, st);
  }
  if (o.graffiti) for (let i = 0; i < 6; i++) P.line([[U(0.35 + P.rng() * 0.3), V(1.2 + P.rng() * 0.4)], [U(0.35 + P.rng() * 0.3), V(1.2 + P.rng() * 0.4)]], { slot: 'C', shade: 200, lw: 2 + P.rng() * 3, alpha: 0.85 });
  if (o.studs) for (const [u, y] of o.studs) P.ellipse(U(u), V(y), 2.2, 2.2, { slot: 'D', shade: 210, metal: 1, rough: 0.25, h: 220 });
  if (o.webbing) { // MOLLE rows on a plate carrier
    for (let y = o.webbing[0]; y <= o.webbing[1]; y += 0.045) for (const [u0, u1] of [[0.02, 0.22], [0.28, 0.72], [0.78, 0.98]]) { P.rect(U(u0), V(y) - 2.5, U(u1 - u0), 5, { mul: 0.75, h: 160, hA: 0.8 }); for (let u = u0; u < u1; u += 0.03) P.rect(U(u), V(y) - 3, 1.2, 6, { mul: 0.55 }); }
  }
  if (o.tears) for (let i = 0; i < o.tears; i++) { const x = P.rng() * w, y = h * (0.3 + P.rng() * 0.65); P.ellipse(x, y, 3 + P.rng() * 6, 2 + P.rng() * 4, { mul: 0.25, h: 40, hA: 0.9 }, P.rng()); P.ellipse(x, y, 7, 5, { mul: 0.85, blur: 2 }); }
  if (o.frayHem) for (let x = 0; x < w; x += 4) P.line([[x, h - 2], [x + (P.rng() - 0.5) * 3, h - 8 - P.rng() * 6]], { mul: 0.7, lw: 1.2 });
  // wear: darker lower hem / armpits, lighter rubbed edges
  P.grime((u, v, n) => (1 - v) * 0.6 * n + 0.25 * Math.exp(-Math.pow((v - 0.78) / 0.05, 2)) * (Math.abs(u - 0.25) < 0.05 || Math.abs(u - 0.75) < 0.05 ? 1 : 0), { dark: o.grime ?? 0.32, rough: 0.08 });
  if (o.creases) for (let i = 0; i < o.creases; i++) { const x = P.rng() * w, y = V(1.1 + P.rng() * 0.5); P.line([[x, y], [x + (P.rng() - 0.5) * 30, y + (P.rng() - 0.5) * 12]], { mul: 0.86, lw: 1.5, blur: 1, h: 100, hA: 0.5 }); }
}
// sleeve swatch: u 0 front, .25 outer, .5 back, .75 inner; v 0 = cuff .. 1 = shoulder
export function paintSleeve(P, o) {
  const w = P.w, h = P.h;
  fabric(P, 'A', o.fabric || 'cotton', { shade: o.shade });
  if (o.camo) { camo(P, o.camo); P.grain(o.fabric || 'cotton', 0.6); }
  if (o.stripes) for (const s of o.stripes) P.rect(s.u0 * w, 0, (s.u1 - s.u0) * w, h, { slot: s.slot || 'C', shade: 186 });
  P.seam([[w * 0.75, -2], [w * 0.75, h + 2]]);
  P.seam([[w * 0.1, h * 0.48], [w * 0.4, h * 0.5]], { stitch: false, lw: 0.8 });
  if (o.patch) { const st = { slot: 'C', shade: 186, h: 150, hA: 0.5 }; P.rect(w * 0.13, h * 0.66, w * 0.24, h * 0.13, { slot: 'B', shade: 175 }); logo(P, o.patch, w * 0.25, h * 0.725, h * 0.08, st); P.seam([[w * 0.13, h * 0.66], [w * 0.37, h * 0.66], [w * 0.37, h * 0.79], [w * 0.13, h * 0.79], [w * 0.13, h * 0.66]], { stitch: false, lw: 0.8 }); }
  if (o.elbowPad) P.ellipse(w * 0.5, h * 0.52, w * 0.18, h * 0.07, { slot: 'B', shade: 175, h: 160, hA: 0.6 });
  if (o.rib) { const y0 = h - (o.ribH ?? 12); P.rect(-2, y0, w + 4, h, { slot: o.ribSlot || 'B', shade: 175, rough: 0.95 }); for (let x = 0; x < w; x += 3) P.line([[x, y0], [x, h + 2]], { mul: 0.82, lw: 1, h: 100, hA: 0.7 }); }
  else P.seam([[-2, h - 6], [w + 2, h - 6]], { both: false });
  if (o.cuffZip) zip(P, w * 0.25, h * 0.86, h + 2);
  if (o.armor) { P.rect(w * 0.1, h * 0.62, w * 0.3, h * 0.25, { slot: 'B', shade: 170, h: 175, hA: 0.8, rough: 0.4 }); for (let i = 0; i < 3; i++) P.seam([[w * 0.1, h * (0.66 + i * 0.07)], [w * 0.4, h * (0.66 + i * 0.07)]], { stitch: false, lw: 1 }); }
  if (o.tears) for (let i = 0; i < o.tears; i++) P.ellipse(P.rng() * w, h * (0.15 + P.rng() * 0.7), 2 + P.rng() * 4, 1.5 + P.rng() * 3, { mul: 0.3, h: 40 });
  P.grime((u, v, n) => (1 - v) * 0.5 * n + 0.3 * Math.exp(-Math.pow((v - 0.52) / 0.06, 2)), { dark: o.grime ?? 0.3 });
  for (let i = 0; i < 6; i++) { const y = h * (0.45 + P.rng() * 0.15); P.line([[w * (0.3 + P.rng() * 0.2), y], [w * (0.6 + P.rng() * 0.2), y + (P.rng() - 0.5) * 6]], { mul: 0.85, lw: 1.2, blur: 0.8, h: 100, hA: 0.5 }); }
}
export function paintCollar(P, o) {
  fabric(P, o.slot || 'B', o.fabric || 'knit', { shade: o.shade ?? 178 });
  if (o.rib !== false) for (let x = 0; x < P.w; x += 3) P.line([[x, 0], [x, P.h]], { mul: 0.82, lw: 1, h: 100, hA: 0.7 });
  if (o.tip) P.rect(0, P.h * 0.3, P.w, P.h * 0.15, { slot: 'C', shade: 186 });
}
export function paintHood(P, o) {
  fabric(P, 'A', o.fabric || 'cotton', { shade: o.shade });
  P.rect(0, P.h * 0.9, P.w, P.h * 0.1, { slot: 'B', shade: 160 }); // lining at the face opening (v ~ 0)
  P.seam([[P.w * 0.5, 0], [P.w * 0.5, P.h]]);
  P.grime((u, v, n) => 0.4 * n * (1 - v), { dark: 0.25 });
}
// ----- under atlas: trousers
export function paintPelvis(P, o) {
  const w = P.w, h = P.h, U = (u) => u * w, V = (v) => (1 - v) * h;
  fabric(P, 'A', o.fabric || 'denim', { shade: o.shade });
  if (o.camo) { camo(P, o.camo); P.grain(o.fabric || 'denim', 0.6); }
  // waistband
  P.rect(-4, 0, w + 8, h * 0.16, { mul: 0.93, h: 150, hA: 0.5 }); P.seam([[-2, h * 0.16], [w + 2, h * 0.16]]);
  if (o.loops) for (const u of [0.08, 0.25, 0.42, 0.58, 0.75, 0.92]) P.rect(U(u) - 2.5, 0, 5, h * 0.2, { mul: 0.85, h: 170 });
  if (o.fly) { P.shape((c) => { c.moveTo(U(0.035), h * 0.16); c.lineTo(U(0.035), h * 0.62); c.quadraticCurveTo(U(0.035), h * 0.78, -2, h * 0.8); }, { mul: 0.75, lw: 1.2, h: 80 }); P.line([[0, h * 0.16], [0, h]], { mul: 0.7, lw: 2.5, h: 70 }); P.line([[w, h * 0.16], [w, h]], { mul: 0.7, lw: 2.5, h: 70 }); }
  if (o.frontPockets) for (const s of [1, -1]) { const u0 = s > 0 ? 0.07 : 0.93, u1 = s > 0 ? 0.2 : 0.8; P.shape((c) => { c.moveTo(U(u0), h * 0.16); c.quadraticCurveTo(U(u0), h * 0.45, U(u1), h * 0.5); }, { mul: 0.5, lw: 2, h: 50 }); }
  if (o.backPockets) for (const u of [0.36, 0.56]) { pocket(P, U(u), V(0.7), U(0.08), h * 0.38, {}); }
  if (o.yoke) P.seam([[U(0.3), V(0.72)], [U(0.5), V(0.55)], [U(0.7), V(0.72)]]);
  if (o.stripe) for (const u of [0.25, 0.75]) P.rect(U(u) - 4, 0, 8, h, { slot: o.stripe, shade: 200 });
  P.seam([[U(0.5), V(0.55)], [U(0.5), h + 2]], { stitch: false });
  P.grime((u, v, n) => 0.5 * n * (1 - v), { dark: o.grime ?? 0.25 });
}
// leg swatch: u 0 front, .25 outer, .5 back, .75 inner; v 0 ankle .. 1 hip (knee ~ v .46)
export function paintLeg(P, o) {
  const w = P.w, h = P.h, U = (u) => u * w, V = (v) => (1 - v) * h;
  fabric(P, 'A', o.fabric || 'denim', { shade: o.shade });
  if (o.camo) { camo(P, o.camo); P.grain(o.fabric || 'denim', 0.6); }
  P.seam([[U(0.25), -2], [U(0.25), h + 2]]); P.seam([[U(0.75), -2], [U(0.75), h + 2]], { stitch: false });
  if (o.fade) { P.ellipse(U(0), V(0.75), U(0.14), h * 0.2, { add: 26, blur: 14 }); P.ellipse(U(1), V(0.75), U(0.14), h * 0.2, { add: 26, blur: 14 }); P.ellipse(U(0), V(0.46), U(0.12), h * 0.06, { add: 30, blur: 8 }); P.ellipse(U(1), V(0.46), U(0.12), h * 0.06, { add: 30, blur: 8 }); for (let i = 0; i < 5; i++) { const y = V(0.88 - i * 0.025); P.line([[U(0.02), y], [U(0.12), y - 2]], { add: 22, lw: 1.2, blur: 0.8 }); P.line([[U(0.98), y], [U(0.88), y - 2]], { add: 22, lw: 1.2, blur: 0.8 }); } }
  if (o.crease) { P.line([[U(0.0) + 1, 0], [U(0.0) + 1, h]], { add: 16, lw: 1.5 }); P.line([[w - 1, 0], [w - 1, h]], { add: 16, lw: 1.5 }); }
  if (o.cargo) { pocket(P, U(0.17), V(0.74), U(0.16), h * 0.14, { flap: true, button: true }); P.seam([[U(0.02), V(0.5)], [U(0.2), V(0.48)]], { stitch: false }); P.seam([[U(0.8), V(0.48)], [U(0.98), V(0.5)]], { stitch: false }); }
  if (o.stripe) for (const u of [0.22, 0.28]) P.rect(U(u) - 3, 0, 6, h, { slot: o.stripe, shade: 200 });
  if (o.kneePanel) { P.ellipse(U(0), V(0.46), U(0.16), h * 0.07, { slot: 'C', shade: 160, h: 170, hA: 0.6 }); P.ellipse(U(1), V(0.46), U(0.16), h * 0.07, { slot: 'C', shade: 160, h: 170, hA: 0.6 }); for (let i = 0; i < 3; i++) { P.seam([[-2, V(0.43 + i * 0.03)], [U(0.15), V(0.43 + i * 0.03)]], { stitch: false, lw: 0.8 }); P.seam([[U(0.85), V(0.43 + i * 0.03)], [w + 2, V(0.43 + i * 0.03)]], { stitch: false, lw: 0.8 }); } }
  if (o.rips) for (let i = 0; i < o.rips; i++) { const x = P.rng() < 0.5 ? U(0.04 + P.rng() * 0.12) : U(0.84 + P.rng() * 0.12), y = V(0.3 + P.rng() * 0.6); P.ellipse(x, y, 4 + P.rng() * 5, 2 + P.rng() * 2, { mul: 0.2, h: 30, hA: 0.9 }); for (let k = 0; k < 5; k++) P.line([[x - 6 + k * 3, y - 2], [x - 6 + k * 3, y + 2]], { add: 40, lw: 0.8 }); }
  if (o.stains) for (let i = 0; i < o.stains; i++) P.ellipse(P.rng() * w, P.rng() * h, 6 + P.rng() * 10, 4 + P.rng() * 8, { mul: 0.75, blur: 4, rough: 0.6 });
  // knee creases, hem
  for (let i = 0; i < 5; i++) { const y = V(0.44 + (P.rng() - 0.5) * 0.08); P.line([[U(0.3 + P.rng() * 0.1), y], [U(0.6 + P.rng() * 0.1), y + (P.rng() - 0.5) * 8]], { mul: 0.82, lw: 1.4, blur: 1, h: 100, hA: 0.5 }); }
  P.seam([[-2, h - 6], [w + 2, h - 6]], { both: false });
  P.grime((u, v, n) => (1 - v) * (1 - v) * 0.9 * n, { dark: o.grime ?? 0.35, rough: 0.12 });
}
export function paintShirt(P, o) {
  const w = P.w, h = P.h, U = (u) => u * w, V = (y) => (1 - (y - 1.06) / 0.86) * h;
  fabric(P, 'B', o.fabric || 'cotton', { shade: o.shade });
  if (o.stripes) for (let y = 0; y < h; y += o.stripes) P.rect(-2, y, w + 4, o.stripes * 0.45, { mul: 0.55 });
  if (o.plaid) { for (let x = 0; x < w; x += 12) { P.rect(x, 0, 4, h, { slot: 'C', shade: 150, alpha: 0.32 }); P.rect(x + 7, 0, 1, h, { slot: 'A', shade: 210, alpha: 0.5 }); } for (let y = 0; y < h; y += 12) { P.rect(0, y, w, 4, { slot: 'C', shade: 150, alpha: 0.32 }); P.rect(0, y + 7, w, 1, { slot: 'A', shade: 210, alpha: 0.5 }); } }
  if (o.neck === 'crew') { P.ellipse(U(0), V(1.9), U(0.09), h * 0.07, { mul: 0.8, lw: 4 }); P.ellipse(U(1), V(1.9), U(0.09), h * 0.07, { mul: 0.8, lw: 4 }); }
  if (o.buttons) { for (const x of [3, w - 3]) P.line([[x, V(1.88)], [x, h]], { mul: 0.82, lw: 2 }); for (let y = V(1.8); y < h; y += 16) for (const x of [4, w - 4]) P.ellipse(x, y, 1.25, 1.25, { slot: 'D', shade: 170, h: 180 }); }
  if (o.print) { for (const x of [0, w]) logo(P, o.print, x, V(1.55), h * 0.16, { slot: 'C', shade: 200, h: 140, hA: 0.3 }); }
  if (o.tank) { // arm holes darker (they read through the jacket gap only) and a scooped neck
    P.ellipse(U(0), V(1.92), U(0.13), h * 0.16, { slot: 'A', mul: 1, alpha: 0 });
  }
  if (o.stains) for (let i = 0; i < o.stains; i++) P.ellipse(P.rng() * w, V(1.15 + P.rng() * 0.5), 5 + P.rng() * 8, 4 + P.rng() * 6, { mul: 0.7, blur: 3 });
  P.seam([[U(0.25), 0], [U(0.25), h]], { stitch: false, lw: 1 }); P.seam([[U(0.75), 0], [U(0.75), h]], { stitch: false, lw: 1 });
  P.seam([[-2, h - 5], [w + 2, h - 5]], { both: false });
  P.grime((u, v, n) => 0.35 * n, { dark: o.grime ?? 0.2 });
}
export function paintTeeSleeve(P, o) { fabric(P, 'B', o.fabric || 'cotton', { shade: o.shade }); P.seam([[-2, P.h * 0.62], [P.w + 2, P.h * 0.62]], { both: false }); P.seam([[P.w * 0.75, 0], [P.w * 0.75, P.h]], { stitch: false }); }
// footwear swatch: shaft (v .55..1, u 0 back .5 front), foot (v .15..55, u 0 bottom .5 top, heel->toe), sole (v 0..15)
export function paintBoot(P, o) {
  const w = P.w, h = P.h, Vb = (v) => (1 - v) * h;
  fabric(P, 'C', o.fabric || 'leather', { shade: o.shade ?? 175 });
  const ys0 = Vb(1), ys1 = Vb(0.55), yf0 = Vb(0.55), yf1 = Vb(0.15);
  // laces down the front of the shaft and over the instep
  if (o.laces !== false) {
    const cx = w * 0.5;
    P.rect(cx - 9, ys0, 18, ys1 - ys0, { mul: 0.8, h: 110 });
    for (let y = ys0 + 4; y < ys1 - 2; y += 7) { P.line([[cx - 9, y], [cx + 9, y + 5]], { slot: o.laceSlot || 'C', shade: o.laceShade ?? 120, lw: 2.2, h: 200 }); P.line([[cx + 9, y], [cx - 9, y + 5]], { slot: o.laceSlot || 'C', shade: o.laceShade ?? 120, lw: 2.2, h: 200 }); for (const s of [-1, 1]) P.ellipse(cx + s * 10.5, y + 2, 1.6, 1.6, { slot: 'D', shade: 200, metal: 1, rough: 0.3 }); }
    // instep (top of the foot = u .5, from v .15 (heel) .. .55 (toe): laces on the rear half)
    const fx = w * 0.5; for (let y = Vb(0.55) + 4; y < Vb(0.36); y += 6) { P.line([[fx - 8, y], [fx + 8, y + 4]], { slot: o.laceSlot || 'C', shade: o.laceShade ?? 120, lw: 2, h: 200 }); P.line([[fx + 8, y], [fx - 8, y + 4]], { slot: o.laceSlot || 'C', shade: o.laceShade ?? 120, lw: 2, h: 200 }); }
  }
  if (o.panels) { P.rect(0, ys0, w * 0.18, ys1 - ys0, { mul: 0.85, h: 145 }); P.rect(w * 0.82, ys0, w * 0.18, ys1 - ys0, { mul: 0.85, h: 145 }); P.seam([[w * 0.18, ys0], [w * 0.18, ys1]], { lw: 1 }); P.seam([[w * 0.82, ys0], [w * 0.82, ys1]], { lw: 1 }); }
  if (o.buckles) for (let i = 0; i < 2; i++) { const y = ys0 + (ys1 - ys0) * (0.25 + i * 0.35); P.rect(0, y, w, 6, { mul: 0.7, h: 170 }); P.rect(w * 0.65, y - 2, 10, 10, { slot: 'D', shade: 205, metal: 1, rough: 0.3, h: 200 }); }
  if (o.swoosh) P.shape((c) => { c.moveTo(w * 0.1, Vb(0.3)); c.quadraticCurveTo(w * 0.3, Vb(0.18), w * 0.45, Vb(0.44)); c.quadraticCurveTo(w * 0.3, Vb(0.24), w * 0.12, Vb(0.33)); c.closePath(); }, { slot: o.swooshSlot || 'D', shade: 200 });
  // toe cap / heel counter on the foot region (v .15..55: heel at .15)
  P.rect(0, Vb(0.55), w, (Vb(0.47) - Vb(0.55)), { mul: o.toeCap ?? 0.9, h: 150, hA: 0.6 });
  P.seam([[0, Vb(0.47)], [w, Vb(0.47)]], { lw: 1 });
  P.rect(0, Vb(0.21), w, Vb(0.15) - Vb(0.21), { mul: 0.9, h: 150, hA: 0.6 });
  P.seam([[0, Vb(0.21)], [w, Vb(0.21)]], { lw: 1 });
  // welt / sole
  P.rect(-4, Vb(0.15), w + 8, h, { slot: o.soleSlot || 'C', shade: o.soleShade ?? 60, rough: 0.75, h: 128 });
  if (o.tread !== false) for (let x = 0; x < w; x += 6) P.rect(x, Vb(0.06), 3, h, { mul: 0.6, h: 70 });
  P.seam([[-2, Vb(0.14)], [w + 2, Vb(0.14)]], { lw: 0.9, stitch: true, both: false, stitchDark: 0.9 });
  P.grime((u, v, n) => (v < 0.6 ? 0.6 : 0.25) * n, { dark: o.grime ?? 0.3, rough: 0.15 });
  if (o.shine) P.pixels({ o: (x, y, d, i) => { d[i + 1] = Math.min(d[i + 1], 80); } }, 'o');
}
export function paintBelt(P, o) {
  fabric(P, 'C', o.fabric || 'leather', { shade: o.shade ?? 165 });
  P.seam([[0, 4], [P.w, 4]], { stitch: false, lw: 0.8 }); P.seam([[0, P.h - 4], [P.w, P.h - 4]], { stitch: false, lw: 0.8 });
  if (o.studs) for (let x = 6; x < P.w; x += 10) P.ellipse(x, P.h / 2, 2.4, 2.4, { slot: 'D', shade: 210, metal: 1, rough: 0.25, h: 220 });
  else for (let x = P.w * 0.55; x < P.w * 0.7; x += 8) P.ellipse(x, P.h / 2, 1.5, 1.5, { mul: 0.3 });
}
export function paintMetal(P, o) { P.fill(o.slot || 'D', o.shade ?? 200, { rough: o.rough ?? 0.3, metal: o.metal ?? 1 }); P.grain('metal', 1); if (o.frame) { P.rect(2, 2, P.w - 4, P.h - 4, { mul: 0.6, lw: 2 }); } }
export function paintGlove(P, o) {
  fabric(P, 'C', o.fabric || 'leather', { shade: o.shade ?? 160 });
  if (o.knuckles) for (let i = 0; i < 4; i++) P.rect(P.w * (0.5 + i * 0.1), P.h * 0.3, P.w * 0.08, P.h * 0.35, { slot: o.padSlot || 'C', shade: 120, h: 190, hA: 0.8, rough: 0.5 });
  P.seam([[P.w * 0.25, 0], [P.w * 0.25, P.h]], { lw: 1 });
}
export function paintStrap(P, o) { fabric(P, o.slot || 'C', o.fabric || 'nylon', { shade: o.shade ?? 150 }); P.seam([[0, 3], [P.w, 3]], { stitch: false, lw: 0.8 }); P.seam([[0, P.h - 3], [P.w, P.h - 3]], { stitch: false, lw: 0.8 }); P.seam([[3, 0], [3, P.h]], { stitch: false, lw: 0.8 }); P.seam([[P.w - 3, 0], [P.w - 3, P.h]], { stitch: false, lw: 0.8 }); }
export function paintSkirt(P, o) { fabric(P, 'A', o.fabric || 'cotton', { shade: o.shade }); if (o.plaid) { for (let x = 0; x < P.w; x += 16) P.rect(x, 0, 5, P.h, { slot: 'B', shade: 150, alpha: 0.5 }); for (let y = 0; y < P.h; y += 16) P.rect(0, y, P.w, 5, { slot: 'B', shade: 150, alpha: 0.5 }); } if (o.pleats) for (let x = 0; x < P.w; x += 10) P.line([[x, 0], [x, P.h]], { mul: 0.75, lw: 1.4, h: 80 }); P.seam([[0, P.h - 5], [P.w, P.h - 5]], { both: false }); }
// ----- armor atlas extras
export function paintCap(P, o) {
  const w = P.w, h = P.h;
  fabric(P, 'A', o.fabric || 'canvas', { shade: o.shade });
  // dome panels converge to the button (top = v 1)
  for (let i = 0; i < 6; i++) P.seam([[w * (i / 6), h * 0.65], [w * (i / 6), 0]], { lw: 1 });
  if (o.logo) logo(P, o.logo, w * 0.5, h * 0.28, h * 0.16, { slot: 'C', shade: 186, h: 160, hA: 0.5 });
  // brim region (v < .3): left half top surface, right half underside
  P.rect(0, h * 0.7, w * 0.5, h * 0.3, { slot: o.brimSlot || 'A', shade: 170, h: 128 });
  P.rect(w * 0.5, h * 0.7, w * 0.5, h * 0.3, { slot: 'B', shade: 140 });
  for (let k = 0; k < 4; k++) P.line([[0, h * (0.74 + k * 0.06)], [w * 0.5, h * (0.74 + k * 0.06)]], { mul: 0.8, lw: 0.8, h: 90 });
  P.grime((u, v, n) => 0.35 * n, { dark: 0.25 });
}
export function paintBeanie(P, o) { fabric(P, 'A', 'knit', { shade: o.shade }); P.rect(0, P.h * 0.8, P.w, P.h * 0.2, { mul: 0.9 }); if (o.stripe) P.rect(0, P.h * 0.5, P.w, P.h * 0.08, { slot: 'C', shade: 186 }); if (o.logo) logo(P, o.logo, P.w * 0.5, P.h * 0.88, P.h * 0.08, { slot: 'C', shade: 186 }); }
export function paintBandana(P, o) {
  fabric(P, 'A', 'cotton', { shade: o.shade });
  for (let y = 6; y < P.h; y += 18) for (let x = (y / 18 % 2) * 9; x < P.w; x += 18) { P.ellipse(x, y, 3.5, 3.5, { slot: 'B', shade: 190, lw: 1.2 }); P.ellipse(x, y, 1, 1, { slot: 'B', shade: 190 }); for (let a = 0; a < 4; a++) P.ellipse(x + Math.cos(a * 1.57) * 6, y + Math.sin(a * 1.57) * 6, 1.4, 2.6, { slot: 'B', shade: 190 }, a * 1.57); }
  P.rect(0, 0, P.w, 4, { slot: 'B', shade: 180 }); P.rect(0, P.h - 4, P.w, 4, { slot: 'B', shade: 180 });
}
export function paintVisor(P, o) {
  P.fill(o.slot || 'D', o.shade ?? 120, { rough: o.rough ?? 0.06, metal: o.metal ?? 0.5 });
  P.shape((c) => { c.moveTo(0, P.h * 0.15); c.lineTo(P.w, P.h * 0.05); c.lineTo(P.w, P.h * 0.3); c.lineTo(0, P.h * 0.42); c.closePath(); }, { add: 30, alpha: 0.6, blur: 4 });
  P.rect(0, 0, P.w, 4, { mul: 0.3, h: 60 }); P.rect(0, P.h - 4, P.w, 4, { mul: 0.3, h: 60 });
}
export function paintHelmet(P, o) {
  const w = P.w, h = P.h;
  P.fill('A', o.shade ?? 186, { rough: o.rough ?? 0.22, metal: o.metal ?? 0.2 }); P.grain('plate', 0.6);
  if (o.stripe) { P.rect(w * 0.47, 0, w * 0.06, h * 0.95, { slot: 'C', shade: 186 }); P.rect(w * 0.44, 0, w * 0.015, h * 0.95, { slot: 'B', shade: 186 }); P.rect(w * 0.545, 0, w * 0.015, h * 0.95, { slot: 'B', shade: 186 }); }
  if (o.flames) for (let i = 0; i < 7; i++) { const x = w * (0.08 + i * 0.13); P.shape((c) => { c.moveTo(x - 10, h); c.quadraticCurveTo(x - 6, h * 0.6, x + 4, h * (0.42 + (i % 3) * 0.06)); c.quadraticCurveTo(x + 2, h * 0.7, x + 12, h); c.closePath(); }, { slot: 'C', shade: 200 }); }
  if (o.number) { logo(P, 'star', w * 0.25, h * 0.55, h * 0.18, { slot: 'C', shade: 200 }); logo(P, 'star', w * 0.75, h * 0.55, h * 0.18, { slot: 'C', shade: 200 }); }
  if (o.hazard) { const y0 = h * 0.86, y1 = h; for (let x = -20; x < w + 20; x += 14) P.poly([[x, y1], [x + 7, y1], [x + 7 + (y1 - y0), y0], [x + (y1 - y0), y0]], { slot: 'C', shade: 186 }); }
  if (o.vents) for (let i = 0; i < 4; i++) P.rect(w * (0.4 + i * 0.06), h * 0.25, w * 0.03, h * 0.12, { mul: 0.3, h: 50 });
  P.rect(0, h * 0.94, w, h * 0.06, { slot: 'B', shade: 90, rough: 0.8 }); // rubber edge trim
  P.ellipse(w * 0.5, h * 0.3, w * 0.4, h * 0.12, { add: 28, blur: 10, alpha: 0.7 });
  P.grime((u, v, n) => 0.3 * n, { dark: o.grime ?? 0.18, rough: 0.15 });
  if (o.scratches) for (let i = 0; i < 30; i++) { const x = P.rng() * w, y = P.rng() * h; P.line([[x, y], [x + (P.rng() - 0.5) * 18, y + (P.rng() - 0.5) * 8]], { add: 40, lw: 0.6, alpha: 0.6, h: 100, hA: 0.4 }); }
}
// armour plate swatch (generic hard surface with panel lines, rivets, hazard edges, scuffs)
export function paintPlate(P, o) {
  const w = P.w, h = P.h;
  P.fill(o.slot || 'A', o.shade ?? 186, { rough: o.rough ?? 0.42, metal: o.metal ?? 0.35 }); P.grain('plate', 1);
  for (const [x0, y0, x1, y1] of o.lines || [[0.5, 0, 0.5, 1]]) P.line([[x0 * w, y0 * h], [x1 * w, y1 * h]], { mul: 0.45, lw: 1.6, h: 60, hA: 0.9 });
  if (o.hazard) { const y0 = h * (1 - o.hazard), y1 = h; for (let x = -30; x < w + 30; x += 16) P.poly([[x, y1], [x + 8, y1], [x + 8 + (y1 - y0), y0], [x + (y1 - y0), y0]], { slot: 'C', shade: 186, rough: 0.5 }); }
  if (o.rivets) for (let x = 6; x < w; x += o.rivets) for (const y of [5, h - 5]) P.ellipse(x, y, 1.8, 1.8, { slot: 'D', shade: 200, metal: 1, rough: 0.3, h: 220 });
  if (o.number) { P.rect(w * 0.38, h * 0.3, w * 0.24, h * 0.3, { slot: 'C', shade: 200, alpha: 0.9 }); }
  if (o.edge !== false) { P.rect(0, 0, w, 3, { add: 40 }); P.rect(0, h - 3, w, 3, { mul: 0.6 }); }
  for (let i = 0; i < (o.scuffs ?? 40); i++) { const x = P.rng() * w, y = P.rng() * h; P.line([[x, y], [x + (P.rng() - 0.5) * 16, y + (P.rng() - 0.5) * 10]], { add: 34, lw: 0.6 + P.rng(), alpha: 0.7, h: 110, hA: 0.4, rough: 0.6 }); }
  P.grime((u, v, n) => 0.45 * n * n, { dark: o.grime ?? 0.35, rough: 0.2 });
}
export function paintPouch(P, o) {
  fabric(P, o.slot || 'B', o.fabric || 'nylon', { shade: o.shade ?? 175 });
  P.rect(0, 0, P.w, P.h * 0.35, { mul: 0.9, h: 160, hA: 0.7 }); P.seam([[0, P.h * 0.35], [P.w, P.h * 0.35]], { both: false });
  P.rect(P.w * 0.4, P.h * 0.2, P.w * 0.2, P.h * 0.2, { slot: 'D', shade: 160, metal: 0.2, rough: 0.5 });
  P.seam([[2, 2], [P.w - 2, 2], [P.w - 2, P.h - 2], [2, P.h - 2], [2, 2]], { stitch: false, lw: 1 });
}
export function paintFur(P, o) { fabric(P, o.slot || 'B', 'fur', { shade: o.shade ?? 190 }); for (let i = 0; i < 400; i++) { const x = P.rng() * P.w, y = P.rng() * P.h; P.line([[x, y], [x + (P.rng() - 0.5) * 4, y + 4 + P.rng() * 6]], { slot: o.slot || 'B', shade: 150 + P.rng() * 100, lw: 1, alpha: 0.6, h: 150 + P.rng() * 100, hA: 0.6 }); } }

// ---------------------------------------------------------------------------------------------- atlases
const S = (name, w, h, paint, opts) => ({ name, w, h, paint, opts });
export const FACES = {
  // thugs
  faceThugA: { stubble: 0.9, scars: [[[0.55, 0.25], [0.68, -0.05], [0.72, -0.22]]], browAngle: 0.8, browT: 1.3, hairline: { front: 1.0, side: 1.5, back: 2.1, cover: 150 }, mouth: 'frown' },
  faceThugB: { stubble: 0.5, tattoos: [{ kind: 'tear' }, { kind: 'cheek13' }], sides: true, browAngle: 0.6, browSlit: 1, mouth: 'snarl', neckTat: 'web' },
  faceThugC: { goatee: true, mustache: true, hairline: { front: 0.93, side: 1.45, back: 2.12 }, browAngle: 0.4, tattoos: [{ kind: 'stars' }], mouth: 'neutral', neckTat: 'barcode' },
  faceThugD: { stubble: 0.7, hairline: { front: 0.98, side: 1.48, back: 2.1, cover: 120 }, browAngle: 0.9, browT: 1.2, scars: [[[-0.25, 0.32], [-0.38, 0.05]]], mouth: 'grin', goldTooth: true },
  // gunmen (faces mostly behind masks/goggles)
  faceGunA: { stubble: 1.0, hairline: { front: 1.0, side: 1.5, back: 2.1, cover: 110 }, browAngle: 1.0, browT: 1.2, mouth: 'neutral', tattoos: [{ kind: 'barcode' }] },
  faceGunB: { stubble: 0.3, hairline: { front: 0.95, side: 1.45, back: 2.1 }, browAngle: 0.7, scars: [[[0.2, -0.55], [0.45, -0.75]]], mouth: 'frown' },
  // brute / boss
  faceBrute: { stubble: 1.0, browAngle: 1.0, browT: 1.6, browW: 1.15, scars: [[[-0.6, 0.35], [-0.45, 0.0], [-0.2, -0.3]], [[0.5, -0.5], [0.7, -0.62]]], mouth: 'snarl', baldShine: true, tattoos: [{ kind: 'tribal' }] },
  faceBossA: { stubble: 0.8, browAngle: 0.7, browT: 1.4, scars: [[[0.18, 0.32], [0.33, 0.1], [0.42, -0.15]]], mouth: 'grin', goldTooth: true, baldShine: true, old: false },
  faceBossB: { mustache: 'horseshoe', hairline: { front: 0.85, side: 1.4, back: 2.15 }, browAngle: 0.6, browT: 1.3, mouth: 'neutral', old: true },
  // junkies
  faceJunkA: { sunken: true, gaunt: true, veins: true, blotch: true, sores: true, mouth: 'snarl', browAngle: -0.3, browT: 0.8, hairline: { front: 0.95, side: 1.5, back: 2.1 } },
  faceJunkB: { sunken: true, gaunt: true, veins: true, blotch: true, stubble: 0.6, mouth: 'grin', browAngle: -0.5, browT: 0.7, sides: true },
  // civilians
  faceCivM: { stubble: 0.25, hairline: { front: 0.9, side: 1.42, back: 2.12, part: 0.4 }, browAngle: 0, mouth: 'neutral' },
  faceCivM2: { beard: true, hairline: { front: 0.92, side: 1.42, back: 2.12 }, browAngle: 0.1, mouth: 'neutral' },
  faceCivF: { makeup: { shadow: 0.45, blush: 0.25 }, hairline: { front: 0.85, side: 1.38, back: 2.2 }, browT: 0.65, browArch: 0.8, browAngle: -0.3, mouth: 'neutral', lipShade: 185, lipK: 1.15, mouthW: 0.9 },
  faceCivF2: { freckles: true, hairline: { front: 0.88, side: 1.4, back: 2.2 }, browT: 0.7, browArch: 0.6, browAngle: -0.2, mouth: 'grin', lipK: 1.1, mouthW: 0.9, makeup: { shadow: 0.2, blush: 0.15 } },
  faceCivOld: { old: true, hairline: { front: 0.7, side: 1.5, back: 2.1, cover: 200 }, browAngle: -0.1, browT: 1.1, mouth: 'frown' },
};
export const EYES = {
  eyeA: { angry: true }, eyeB: { angry: true, open: 0.8, bags: true }, eyeC: {}, eyeJunk: { sunken: true, bloodshot: true, redRims: true, open: 1.15, iris: 0.8, pupil: 0.25 },
  eyeFem: { lashes: true, liner: true, iris: 1.05 }, eyeOld: { droop: true, bags: true, open: 0.85 }, eyeBoss: { angry: true, open: 0.7, bags: true },
};
let SKIN = null;
export function skinAtlas() {
  if (SKIN) return SKIN;
  const sw = [];
  for (const [k, o] of Object.entries(FACES)) sw.push(S(k, 256, 256, paintFace, o));
  for (const [k, o] of Object.entries(EYES)) sw.push(S(k, 96, 64, paintEye, o));
  sw.push(S('armPlain', 128, 256, paintArmSkin, {}), S('armTribal', 128, 256, paintArmSkin, { sleeve: 'tribal' }), S('armSkulls', 128, 256, paintArmSkin, { sleeve: 'skulls' }), S('armFlames', 128, 256, paintArmSkin, { sleeve: 'flames' }), S('armTracks', 128, 256, paintArmSkin, { tracks: true }), S('armHairy', 128, 256, paintArmSkin, { hairy: true }));
  sw.push(S('hand', 128, 64, paintHand, {}));
  sw.push(S('hairStraight', 128, 128, paintHair, { kind: 'straight' }), S('hairSpiky', 64, 128, paintHair, { kind: 'spiky' }), S('hairCurly', 128, 128, paintHair, { kind: 'curly' }), S('hairDreads', 64, 128, paintHair, { kind: 'dreads' }));
  SKIN = new Atlas('skin', sw, { width: 1024 });
  return SKIN;
}
let UNDER = null;
export function underAtlas() {
  if (UNDER) return UNDER;
  const sw = [
    S('pelvisJeans', 256, 80, paintPelvis, { fabric: 'denim', loops: true, fly: true, frontPockets: true, backPockets: true, yoke: true }),
    S('pelvisCargo', 256, 80, paintPelvis, { fabric: 'canvas', loops: true, fly: true, frontPockets: true, backPockets: true }),
    S('pelvisLeather', 256, 80, paintPelvis, { fabric: 'leather', loops: true, fly: true, frontPockets: true }),
    S('pelvisTrack', 256, 80, paintPelvis, { fabric: 'nylon', stripe: 'D' }),
    S('pelvisSlacks', 256, 80, paintPelvis, { fabric: 'wool', loops: true, fly: true, frontPockets: true }),
    S('pelvisArmor', 256, 80, paintPelvis, { fabric: 'canvas', loops: true, fly: true, grime: 0.4 }),
    S('legJeans', 128, 320, paintLeg, { fabric: 'denim', fade: true }),
    S('legCargo', 128, 320, paintLeg, { fabric: 'canvas', cargo: true }),
    S('legLeather', 128, 320, paintLeg, { fabric: 'leather', kneePanel: true, grime: 0.2 }),
    S('legTrack', 128, 320, paintLeg, { fabric: 'nylon', stripe: 'D', grime: 0.2 }),
    S('legSlacks', 128, 320, paintLeg, { fabric: 'wool', crease: true, grime: 0.15 }),
    S('legRipped', 128, 320, paintLeg, { fabric: 'denim', fade: true, rips: 7, stains: 6, grime: 0.55 }),
    S('legPadded', 128, 320, paintLeg, { fabric: 'canvas', cargo: true, kneePanel: true, grime: 0.45 }),
    S('legCamo', 128, 320, paintLeg, { fabric: 'canvas', cargo: true, camo: { slot1: 'B', slot2: 'C', size: 9 }, grime: 0.4 }),
    S('pelvisCamo', 256, 80, paintPelvis, { fabric: 'canvas', loops: true, fly: true, frontPockets: true, backPockets: true, camo: { slot1: 'B', slot2: 'C', size: 9 } }),
    S('shirtPlain', 256, 160, paintShirt, { neck: 'crew' }),
    S('shirtPrint', 256, 160, paintShirt, { neck: 'crew', print: 'skull' }),
    S('shirtStripe', 256, 160, paintShirt, { stripes: 10 }),
    S('shirtPlaid', 256, 160, paintShirt, { plaid: true, buttons: true, fabric: 'cotton' }),
    S('shirtDress', 256, 160, paintShirt, { buttons: true }),
    S('shirtTac', 256, 160, paintShirt, { fabric: 'canvas' }),
    S('shirtKnit', 256, 160, paintShirt, { fabric: 'knit' }),
    S('shirtDirty', 256, 160, paintShirt, { neck: 'crew', stains: 7, grime: 0.5 }),
    S('sleeveTee', 128, 128, paintTeeSleeve, {}),
    S('sleeveTac', 128, 200, paintSleeve, { fabric: 'canvas', patch: 'skull', elbowPad: true }),
    S('sleeveKnit', 128, 200, paintSleeve, { fabric: 'knit', rib: true, ribSlot: 'A' }),
    S('sleeveShirt', 128, 200, paintSleeve, { fabric: 'cotton' }),
    S('bootCombat', 256, 192, paintBoot, { panels: true, toeCap: 0.85 }),
    S('bootWork', 256, 192, paintBoot, { fabric: 'leather', toeCap: 0.8, laceShade: 175 }),
    S('bootSneaker', 256, 192, paintBoot, { fabric: 'canvas', soleSlot: 'D', soleShade: 205, swoosh: true, laceSlot: 'D', laceShade: 215, tread: false }),
    S('shoeDress', 256, 192, paintBoot, { fabric: 'leather', laces: false, shine: true, soleShade: 40, tread: false }),
    S('bootBiker', 256, 192, paintBoot, { fabric: 'leather', laces: false, buckles: true, shine: true }),
    S('belt', 256, 32, paintBelt, {}), S('beltStud', 256, 32, paintBelt, { studs: true }),
    S('buckle', 32, 32, paintMetal, { frame: true }), S('metal', 32, 32, paintMetal, {}),
    S('gloveLeather', 128, 64, paintGlove, {}), S('gloveTac', 128, 64, paintGlove, { fabric: 'nylon', knuckles: true }),
    S('skirtPlain', 128, 128, paintSkirt, {}), S('skirtPlaid', 128, 128, paintSkirt, { plaid: true, pleats: true }),
    S('collarKnit', 128, 32, paintCollar, { slot: 'B' }), S('collarShirt', 128, 32, paintCollar, { slot: 'B', fabric: 'cotton', rib: false }),
    S('strapU', 64, 64, paintStrap, {}),
    S('tape', 64, 64, (P) => { P.fill('D', 200, { rough: 0.9, metal: 0 }); P.grain('cotton', 1.2); for (let y = -64; y < 128; y += 9) P.line([[0, y], [P.w, y + 22]], { mul: 0.78, lw: 1.2, h: 90 }); P.grime((u, v, n) => n * n, { dark: 0.35 }); for (let i = 0; i < 3; i++) P.ellipse(P.rng() * P.w, P.rng() * P.h, 4, 3, { mul: 0.6, blur: 2 }); }, {}),
  ];
  UNDER = new Atlas('under', sw, { width: 1024 });
  return UNDER;
}
// per-style outer-garment atlases (registered by the look definitions)
const ARMOR = new Map();
export function armorAtlas(style, swatches) {
  if (ARMOR.has(style)) return ARMOR.get(style);
  const A = new Atlas('armor:' + style, swatches, { width: 1024 });
  ARMOR.set(style, A);
  return A;
}
export const PAINT = { paintTorso, paintSleeve, paintCollar, paintHood, paintCap, paintBeanie, paintBandana, paintVisor, paintHelmet, paintPlate, paintPouch, paintFur, paintStrap, paintMetal, paintGlove, paintShirt };
export { S as swatch, fbm };
