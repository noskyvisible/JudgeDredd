import * as THREE from 'three';
import { makeCanvas, canvasTex, mulberry32, normalFromHeight } from './util.js';

// ---------------------------------------------------------------------------
// Procedural canvas textures shared by the Lawmaster and the traffic cars.
// Everything is cached: call freely.
// ---------------------------------------------------------------------------
const C = {};
const once = (k, f) => C[k] || (C[k] = f());
const FONT = (w, px) => `${w} ${px}px Impact, "Arial Black", "Helvetica Neue", sans-serif`;

// --- tyre tread: chevron blocks + centre rib + sipes (height -> normal). u wraps around the tyre ---
export const treadTex = () => once('tread', () => {
  const W = 256, H = 128, [c, x] = makeCanvas(W, H), rng = mulberry32(11);
  x.fillStyle = 'rgb(200,200,200)'; x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgb(40,40,40)';
  for (let k = 0; k < 8; k++) {       // 8 pitches across the tile
    const u = k * 32;
    for (const s of [-1, 1]) {        // chevron grooves both halves
      x.beginPath();
      const y0 = 64 + s * 10, y1 = 64 + s * 62;
      x.moveTo(u + 4, y0); x.lineTo(u + 12, y0); x.lineTo(u + 26, y1); x.lineTo(u + 18, y1); x.closePath(); x.fill();
    }
    x.fillRect(u + 14, 56, 18, 3);  // cross sipe in the rib
  }
  x.fillRect(0, 50, W, 3); x.fillRect(0, 75, W, 3);   // rib edges
  for (let i = 0; i < 2500; i++) { const v = 150 + rng() * 100; x.fillStyle = `rgba(${v},${v},${v},0.08)`; x.fillRect(rng() * W, rng() * H, 2, 2); }
  // shoulders: plain, with a fine moulding line
  x.fillStyle = 'rgb(170,170,170)'; x.fillRect(0, 0, W, 6); x.fillRect(0, H - 6, W, 6);
  return canvasTex(normalFromHeight(c, 3.2), { repeat: true, srgb: false });
});

// --- tyre sidewall: raised lettering on an annulus. u = angle (0..1), v = radius (0 inner .. 1 outer) ---
export function sidewallTex(main = 'LAWMASTER', sub = 'MEGA-CITY TYRE CO. • 240/45 ZR17 • JUSTICE DEPT ISSUE') {
  return once('side_' + main + sub, () => {
    const W = 2048, H = 96;
    const [h, hx] = makeCanvas(W, H), [c, cx] = makeCanvas(W, H);
    hx.fillStyle = '#808080'; hx.fillRect(0, 0, W, H);
    cx.fillStyle = '#121214'; cx.fillRect(0, 0, W, H);
    // concentric moulding rings
    for (const [y, t] of [[10, 3], [H - 14, 2], [H - 6, 2]]) { hx.fillStyle = '#b0b0b0'; hx.fillRect(0, y, W, t); cx.fillStyle = '#1a1a1d'; cx.fillRect(0, y, W, t); }
    const draw = (ctx, col, sub2) => {
      ctx.fillStyle = col; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      for (let k = 0; k < 2; k++) {
        const u0 = k * W / 2;
        ctx.font = FONT('900', 34); ctx.save(); ctx.translate(u0 + W * 0.15, H * 0.5); ctx.scale(1.25, 1); ctx.fillText(main, 0, 0); ctx.restore();
        ctx.font = FONT('700', 17); ctx.fillText(sub2, u0 + W * 0.34 + 40, H * 0.52);
      }
    };
    draw(hx, '#ffffff', sub); draw(cx, '#3c3c42', sub);
    const n = canvasTex(normalFromHeight(h, 2.0), { srgb: false });
    const col = canvasTex(c);
    return { map: col, normal: n };
  });
}

// --- brake disc: drilled, slotted rotor with alpha holes; planar UVs (RingGeometry) ---
export const discTex = () => once('disc', () => {
  const S = 256, [c, x] = makeCanvas(S, S), cc = S / 2;
  x.clearRect(0, 0, S, S);
  const R = S / 2 - 2, Ri = R * 0.62;
  const g = x.createRadialGradient(cc, cc, Ri, cc, cc, R); g.addColorStop(0, '#8a8d94'); g.addColorStop(0.5, '#c8ccd2'); g.addColorStop(1, '#9a9ea6');
  x.fillStyle = g; x.beginPath(); x.arc(cc, cc, R, 0, Math.PI * 2); x.arc(cc, cc, Ri, 0, Math.PI * 2, true); x.fill();
  x.strokeStyle = 'rgba(255,255,255,0.12)'; x.lineWidth = 1; for (let r = Ri + 2; r < R; r += 2.5) { x.beginPath(); x.arc(cc, cc, r, 0, Math.PI * 2); x.stroke(); }
  // drilled holes (transparent)
  x.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 36; k++) for (const rr of [0.7, 0.8, 0.9]) {
    const a = (k / 36) * Math.PI * 2 + rr * 1.3; x.beginPath(); x.arc(cc + Math.cos(a) * R * rr, cc + Math.sin(a) * R * rr, 3.1, 0, Math.PI * 2); x.fill();
  }
  x.globalCompositeOperation = 'source-over';
  // swept slots
  x.strokeStyle = 'rgba(40,40,46,0.9)'; x.lineWidth = 2;
  for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; x.beginPath(); x.arc(cc, cc, R * 0.76, a, a + 0.25); x.stroke(); }
  // carrier (centre spider, gold anodised) with bobbins
  x.fillStyle = '#b8892a'; x.beginPath(); x.arc(cc, cc, Ri + 1, 0, Math.PI * 2); x.arc(cc, cc, Ri * 0.45, 0, Math.PI * 2, true); x.fill();
  x.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + 0.26; x.beginPath(); x.ellipse(cc + Math.cos(a) * Ri * 0.72, cc + Math.sin(a) * Ri * 0.72, Ri * 0.17, Ri * 0.11, a, 0, Math.PI * 2); x.fill(); }
  x.globalCompositeOperation = 'source-over';
  x.fillStyle = '#e8e2d0'; for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; x.beginPath(); x.arc(cc + Math.cos(a) * Ri * 1.0, cc + Math.sin(a) * Ri * 1.0, 3.2, 0, Math.PI * 2); x.fill(); }
  const t = canvasTex(c); return t;
});

// --- tuck-and-roll leather: pleats along u (across the seat), stitch lines; normal + albedo detail ---
export const leatherTex = () => once('leather', () => {
  const W = 256, H = 256, rng = mulberry32(7), [h, hx] = makeCanvas(W, H), [c, cx] = makeCanvas(W, H);
  const pleats = 8;
  for (let y = 0; y < H; y++) {
    const t = ((y / H) * pleats) % 1, bulge = Math.sin(t * Math.PI);    // round pillows
    const v = Math.round(60 + 170 * Math.pow(bulge, 0.6)); hx.fillStyle = `rgb(${v},${v},${v})`; hx.fillRect(0, y, W, 1);
    const k = 0.8 + 0.2 * Math.pow(bulge, 0.5); cx.fillStyle = `rgb(${Math.round(255 * k)},${Math.round(255 * k)},${Math.round(255 * k)})`; cx.fillRect(0, y, W, 1);
  }
  // stitches along each seam
  hx.fillStyle = 'rgba(0,0,0,0.9)'; cx.fillStyle = 'rgba(210,170,120,0.85)';
  for (let p = 0; p <= pleats; p++) { const y = (p / pleats) * H; for (let xx = 0; xx < W; xx += 6) { hx.fillRect(xx, y - 4, 3, 1); hx.fillRect(xx, y + 3, 3, 1); cx.fillRect(xx, y - 4, 3, 1); cx.fillRect(xx, y + 3, 3, 1); } }
  // grain
  for (let i = 0; i < 6000; i++) { const v = rng() < 0.5 ? 0 : 255; hx.fillStyle = `rgba(${v},${v},${v},0.06)`; hx.fillRect(rng() * W, rng() * H, 2, 2); }
  return { normal: canvasTex(normalFromHeight(h, 2.2), { repeat: true, srgb: false }), map: canvasTex(c, { repeat: true }) };
});

// --- metallic flake: fine sparkle normals for clearcoat paint ---
export const flakeTex = () => once('flake', () => {
  const S = 256, rng = mulberry32(99), [c, x] = makeCanvas(S, S); const img = x.createImageData(S, S), d = img.data;
  for (let i = 0; i < S * S; i++) {
    const a = rng() * Math.PI * 2, r = Math.pow(rng(), 3) * 0.55;
    d[i * 4] = 128 + Math.cos(a) * r * 127; d[i * 4 + 1] = 128 + Math.sin(a) * r * 127; d[i * 4 + 2] = 255; d[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0); return canvasTex(c, { repeat: true, srgb: false });
});

// --- brushed metal: streaky roughness map (u = brush direction) ---
export const brushedTex = () => once('brushed', () => {
  const W = 256, H = 256, rng = mulberry32(3), [c, x] = makeCanvas(W, H);
  x.fillStyle = 'rgb(120,120,120)'; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) { const v = 80 + rng() * 120, y = rng() * H; x.fillStyle = `rgba(${v},${v},${v},0.35)`; x.fillRect(rng() * W - 60, y, 40 + rng() * 200, 1); }
  return canvasTex(c, { repeat: true, srgb: false });
});

// --- a word as chrome letters on transparent (decals) ---
export function wordTex(text, { w = 1024, h = 160, fill = 'chrome', outline = '#050505', font = '900', italic = true, track = 0.06 } = {}) {
  return once(`word_${text}_${w}_${h}_${fill}_${italic}`, () => {
    const [c, x] = makeCanvas(w, h); x.clearRect(0, 0, w, h);
    const px = Math.floor(h * 0.78); x.font = FONT(font, px); x.textBaseline = 'middle';
    const chars = [...text]; const widths = chars.map((ch) => x.measureText(ch).width); const total = widths.reduce((a, b) => a + b, 0) + track * px * (chars.length - 1);
    const sx = Math.min(1, (w * 0.94) / total);
    x.save(); x.translate(w / 2, h / 2); if (italic) x.transform(1, 0, -0.22, 1, 0, 0); x.scale(sx, 1);
    let g;
    if (fill === 'chrome') { g = x.createLinearGradient(0, -px / 2, 0, px / 2); g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#c6ccd6'); g.addColorStop(0.5, '#5a606c'); g.addColorStop(0.62, '#e9edf2'); g.addColorStop(1, '#8a909a'); }
    else if (fill === 'gold') { g = x.createLinearGradient(0, -px / 2, 0, px / 2); g.addColorStop(0, '#fff2b0'); g.addColorStop(0.45, '#e8b84a'); g.addColorStop(0.52, '#7a5212'); g.addColorStop(0.65, '#f4cf6a'); g.addColorStop(1, '#a8761a'); }
    else g = fill;
    let xx = -total / 2;
    for (let i = 0; i < chars.length; i++) {
      x.lineWidth = px * 0.12; x.strokeStyle = outline; x.lineJoin = 'round'; x.strokeText(chars[i], xx, 0);
      x.fillStyle = g; x.fillText(chars[i], xx, 0); xx += widths[i] + track * px;
    }
    x.restore();
    return canvasTex(c);
  });
}

// --- license plate (reflective) ---
export function plateTex(text, { bg = '#e8e4d6', fg = '#111', band = '#1a3a8a', bandText = 'MEGA-CITY ONE' } = {}) {
  return once('plate_' + text + bg, () => {
    const [c, x] = makeCanvas(256, 112);
    x.fillStyle = bg; x.fillRect(0, 0, 256, 112);
    x.fillStyle = band; x.fillRect(0, 0, 256, 24);
    x.fillStyle = '#f0f0f0'; x.font = FONT('700', 17); x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(bandText, 128, 13);
    x.strokeStyle = '#222'; x.lineWidth = 5; x.strokeRect(3, 3, 250, 106);
    x.fillStyle = fg; x.font = FONT('900', 60); x.fillText(text, 128, 70);
    for (const [px, py] of [[16, 96], [240, 96]]) { x.fillStyle = '#777'; x.beginPath(); x.arc(px, py, 4, 0, 7); x.fill(); }
    return canvasTex(c);
  });
}

// --- feather grooves for the gold eagle (shape coordinates: x -1..1, y -0.2..1.05) ---
export const eagleNormal = () => once('eagleN', () => {
  const S = 256, [c, x] = makeCanvas(S, S);
  x.fillStyle = '#808080'; x.fillRect(0, 0, S, S);
  const P = (sx, sy) => [((sx + 1) / 2) * S, (1 - (sy + 0.25) / 1.35) * S];
  x.strokeStyle = '#2a2a2a'; x.lineWidth = 3;
  for (const side of [-1, 1]) {
    for (let k = 0; k < 7; k++) {   // primary feathers radiating from the shoulder
      const a = 0.25 + k * 0.11; const [x0, y0] = P(side * 0.12, 0.62); const [x1, y1] = P(side * (0.12 + Math.cos(a) * 0.9), 0.62 + Math.sin(a) * 0.38 - 0.15);
      x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
    }
    for (let k = 0; k < 4; k++) { const [x0, y0] = P(side * 0.1, 0.42 - k * 0.07); const [x1, y1] = P(side * (0.45 - k * 0.05), 0.5 - k * 0.09); x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke(); }
  }
  x.lineWidth = 2; for (let k = 0; k < 5; k++) { const [x0, y0] = P(-0.08, 0.2 - k * 0.07); const [x1, y1] = P(0.08, 0.2 - k * 0.07); x.beginPath(); x.moveTo(x0, y0); x.quadraticCurveTo((x0 + x1) / 2, y0 + 6, x1, y1); x.stroke(); }
  return canvasTex(normalFromHeight(c, 2.4), { srgb: false });
});

// --- instrument display (emissive) ---
export const dashTex = () => once('dash', () => {
  const W = 256, H = 128, [c, x] = makeCanvas(W, H);
  x.fillStyle = '#02060a'; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#123'; x.lineWidth = 1; for (let i = 0; i < W; i += 8) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, H); x.stroke(); }
  x.lineCap = 'round';
  x.strokeStyle = '#0a3a4a'; x.lineWidth = 10; x.beginPath(); x.arc(78, 78, 50, Math.PI * 0.8, Math.PI * 2.2); x.stroke();
  x.strokeStyle = '#38e0ff'; x.lineWidth = 10; x.beginPath(); x.arc(78, 78, 50, Math.PI * 0.8, Math.PI * 1.7); x.stroke();
  x.fillStyle = '#c8f6ff'; x.font = FONT('900', 34); x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('128', 78, 80);
  x.font = FONT('700', 12); x.fillStyle = '#5fc8e8'; x.fillText('KM/H', 78, 104);
  x.fillStyle = '#ffb030'; x.fillRect(150, 28, 90, 8); x.fillStyle = '#ff3040'; x.fillRect(150, 44, 54, 8);
  x.fillStyle = '#38e0ff'; x.font = FONT('700', 13); x.textAlign = 'left'; x.fillText('MC-1 GRID', 150, 70); x.fillText('SECTOR 9', 150, 88);
  x.strokeStyle = '#38e0ff'; x.lineWidth = 2; x.strokeRect(150, 98, 90, 18); x.fillStyle = '#ff3040'; x.beginPath(); x.arc(196, 107, 4, 0, 7); x.fill();
  return canvasTex(c);
});

// --- radial blur disc for spinning wheels (alpha in rings) ---
export const blurTex = () => once('blur', () => {
  const S = 256, [c, x] = makeCanvas(S, S), cc = S / 2; x.clearRect(0, 0, S, S);
  for (let r = 0; r < cc; r++) {
    const t = r / cc; let a = 0;
    if (t > 0.12 && t < 0.98) a = 0.55 + 0.25 * Math.sin(t * 40) * (t < 0.9 ? 1 : 0.2);
    if (t > 0.9) a *= 0.6;
    const v = t > 0.9 ? 30 : 120 + 60 * Math.sin(t * 23);
    x.strokeStyle = `rgba(${v},${v},${v + 6},${a})`; x.lineWidth = 1.5; x.beginPath(); x.arc(cc, cc, r, 0, Math.PI * 2); x.stroke();
  }
  return canvasTex(c);
});

// --- soft glow sprite ---
export const glowTex = () => once('glow', () => {
  const S = 128, [c, x] = makeCanvas(S, S), g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,0.55)'); g.addColorStop(0.45, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S); return canvasTex(c);
});
// --- soft contact shadow (dark centre, feathered rectangle-ish falloff) ---
export const shadowTex = () => once('shadow', () => {
  const S = 128, [c, x] = makeCanvas(S, S); const img = x.createImageData(S, S), d = img.data;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const u = Math.abs(i / (S - 1) * 2 - 1), v = Math.abs(j / (S - 1) * 2 - 1);
    const r = Math.pow(Math.pow(u, 4) + Math.pow(v, 4), 0.25);   // squircle
    const a = Math.max(0, 1 - Math.pow(Math.max(0, r - 0.35) / 0.65, 1.4));
    const k = (j * S + i) * 4; d[k] = d[k + 1] = d[k + 2] = 0; d[k + 3] = Math.round(255 * a * a);
  }
  x.putImageData(img, 0, 0); return canvasTex(c);
});

// --- anamorphic streak sprite (horizontal flare) ---
export const streakTex = () => once('streak', () => {
  const W = 256, H = 32, [c, x] = makeCanvas(W, H);
  const g = x.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2); g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.3, 'rgba(255,255,255,0.25)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.save(); x.scale(1, H / W * 0.6); x.translate(0, (W - H) / 2); x.restore();
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const v = x.createLinearGradient(0, 0, 0, H); v.addColorStop(0, 'rgba(0,0,0,1)'); v.addColorStop(0.5, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,1)');
  x.globalCompositeOperation = 'destination-out'; x.fillStyle = v; x.fillRect(0, 0, W, H);
  return canvasTex(c);
});

// --- exhaust heat tint: chrome -> straw -> violet -> blue along u ---
export const heatTex = () => once('heat', () => {
  const W = 256, [c, x] = makeCanvas(W, 4), g = x.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, '#d9a24a'); g.addColorStop(0.12, '#8a4fa8'); g.addColorStop(0.25, '#3b5fb8'); g.addColorStop(0.42, '#c8ccd4'); g.addColorStop(1, '#e4e8ee');
  x.fillStyle = g; x.fillRect(0, 0, W, 4); return canvasTex(c);
});

// --- perforated heat shield / speaker grille: alpha holes ---
export const perfTex = () => once('perf', () => {
  const S = 64, [c, x] = makeCanvas(S, S); x.fillStyle = '#fff'; x.fillRect(0, 0, S, S);
  x.globalCompositeOperation = 'destination-out';
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { x.beginPath(); x.arc(i * 8 + 4 + (j % 2) * 4, j * 8 + 4, 2.4, 0, 7); x.fill(); }
  return canvasTex(c, { repeat: true });
});

// --- hexagonal mesh grille (alpha) ---
export const hexTex = () => once('hex', () => {
  const S = 64, [c, x] = makeCanvas(S, S); x.fillStyle = '#fff'; x.fillRect(0, 0, S, S);
  x.globalCompositeOperation = 'destination-out';
  const r = 6.5; for (let j = -1; j < 7; j++) for (let i = -1; i < 7; i++) {
    const cx = i * r * 1.75 + (j % 2) * r * 0.875, cy = j * r * 1.52; x.beginPath();
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + Math.PI / 6; x.lineTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8); } x.fill();
  }
  return canvasTex(c, { repeat: true });
});

// --- headlamp reflector: concentric facets (map for chrome bowl) ---
export const reflectorTex = () => once('refl', () => {
  const S = 128, [c, x] = makeCanvas(S, S), cc = S / 2;
  for (let r = cc; r > 0; r -= 1) { const k = 0.6 + 0.4 * Math.abs(Math.sin(r * 0.5)); const v = Math.round(255 * k); x.fillStyle = `rgb(${v},${v},${v})`; x.beginPath(); x.arc(cc, cc, r, 0, 7); x.fill(); }
  return canvasTex(c);
});

// --- generic noise grime (roughness variation) ---
export const grimeTex = () => once('grime', () => {
  const S = 128, rng = mulberry32(17), [c, x] = makeCanvas(S, S); x.fillStyle = 'rgb(150,150,150)'; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 1800; i++) { const v = 90 + rng() * 140; x.fillStyle = `rgba(${v},${v},${v},0.25)`; const s = 1 + rng() * 5; x.fillRect(rng() * S, rng() * S, s, s); }
  return canvasTex(c, { repeat: true, srgb: false });
});

export { THREE };
