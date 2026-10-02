import * as THREE from 'three';
import { makeCanvas, canvasTex, rand, pick, mulberry32, normalFromHeight } from './util.js';

// All textures are drawn procedurally onto canvases.

const WARM = ['#ffd58a', '#ffe9b8', '#ffc470', '#fff2d0'];
const COOL = ['#8fe3ff', '#bff3ff', '#6ad0ff'];
const HOT = ['#ff6fd0', '#ff9a4d', '#ff5577'];

function noiseFill(x, w, h, amt = 14, base = [20, 22, 30]) {
  const img = x.getImageData(0, 0, w, h); const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amt;
    d[i] = base[0] + n; d[i + 1] = base[1] + n; d[i + 2] = base[2] + n * 1.1; d[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
}

// ---------- building facades: albedo + emissive pair ----------
export function makeFacade(variant) {
  const W = 256, H = 256;
  const [a, ax] = makeCanvas(W, H);
  const [e, ex] = makeCanvas(W, H);
  noiseFill(ax, W, H, 16, [[30, 32, 42], [26, 30, 40], [38, 34, 44], [34, 30, 28]][variant]);
  ex.fillStyle = '#000'; ex.fillRect(0, 0, W, H);
  const lit = (r, litProb, pal) => {
    ex.fillStyle = Math.random() < litProb ? pick(pal) : '#000';
  };
  if (variant === 0) { // classic grid
    const cols = 4, rows = 4, cw = W / cols, rh = H / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = c * cw + 12, y = r * rh + 12, w = cw - 24, h = rh - 24;
      ax.fillStyle = '#0c1220'; ax.fillRect(x, y, w, h);
      ax.fillStyle = 'rgba(120,160,220,0.15)'; ax.fillRect(x, y, w, h * 0.4);
      lit(0, 0.42, Math.random() < 0.12 ? COOL : Math.random() < 0.1 ? HOT : WARM);
      if (ex.fillStyle !== '#000000') { ex.fillRect(x, y, w, h); }
    }
    ax.fillStyle = 'rgba(0,0,0,0.35)'; for (let c = 0; c < cols; c++) ax.fillRect(c * cw, 0, 3, H);
  } else if (variant === 1) { // ribbon glazing
    const rows = 8, rh = H / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rh + 6, h = rh - 12;
      ax.fillStyle = '#0a1424'; ax.fillRect(0, y, W, h);
      ax.fillStyle = 'rgba(100,170,230,0.2)'; ax.fillRect(0, y, W, h * 0.35);
      let x = 0;
      while (x < W) {
        const seg = 16 + Math.random() * 60;
        if (Math.random() < 0.55) { ex.fillStyle = pick(Math.random() < 0.6 ? COOL : WARM); ex.globalAlpha = 0.5 + Math.random() * 0.5; ex.fillRect(x, y, Math.min(seg, W - x), h); ex.globalAlpha = 1; }
        x += seg;
      }
    }
  } else if (variant === 2) { // dense small windows
    const cols = 10, rows = 10, cw = W / cols, rh = H / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = c * cw + 4, y = r * rh + 4, w = cw - 8, h = rh - 8;
      ax.fillStyle = '#0b0f1c'; ax.fillRect(x, y, w, h);
      if (Math.random() < 0.38) { ex.fillStyle = pick(Math.random() < 0.18 ? HOT : Math.random() < 0.25 ? COOL : WARM); ex.fillRect(x, y, w, h); }
    }
  } else { // industrial
    const cols = 4, rows = 3, cw = W / cols, rh = H / rows;
    ax.fillStyle = 'rgba(70,50,30,0.5)';
    for (let c = 0; c < 6; c++) ax.fillRect(c * 44 + 6, 0, 8, H); // pipes
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = c * cw + 14, y = r * rh + 22, w = cw - 28, h = rh - 44;
      ax.fillStyle = '#10141a'; ax.fillRect(x, y, w, h);
      if (Math.random() < 0.25) { ex.fillStyle = Math.random() < 0.3 ? '#ff8a30' : '#ffe0a0'; ex.fillRect(x, y, w, h); }
    }
    ex.fillStyle = '#ff7a20'; for (let c = 0; c < 4; c++) if (Math.random() < 0.6) ex.fillRect(c * 64 + 28, 4, 8, 8);
  }
  // keep a dark safe pixel region in the top-left (roofs sample here)
  ax.fillStyle = '#1a1c24'; ax.fillRect(0, 0, 10, 10); ex.fillStyle = '#000'; ex.fillRect(0, 0, 10, 10);
  return [canvasTex(a, { repeat: true }), canvasTex(e, { repeat: true })];
}

// ---------- road / sidewalk ----------
// 1024px tileable asphalt (22 m x 22 m): aggregate, cracks, patches, tracks, oil, manholes,
// worn markings.  Returns albedo + roughness (puddles) + normal maps.
export function makeRoad() {
  const W = 1024;
  const [c, x] = makeCanvas(W, W);
  const [r, rx] = makeCanvas(W, W);
  const [hc, hx] = makeCanvas(W, W);
  const rng = mulberry32(7);
  noiseFill(x, W, W, 14, [24, 25, 31]);
  hx.fillStyle = 'rgb(128,128,128)'; hx.fillRect(0, 0, W, W);
  // aggregate speckle
  for (let i = 0; i < 40000; i++) {
    const px = rng() * W, py = rng() * W, l = rng() < 0.5 ? 0 : 255;
    x.fillStyle = `rgba(${l},${l},${l},${0.04 + rng() * 0.08})`; x.fillRect(px, py, 1 + (rng() * 2 | 0), 1 + (rng() * 2 | 0));
    hx.fillStyle = `rgba(${l},${l},${l},0.07)`; hx.fillRect(px, py, 2, 2);
  }
  // patched repairs
  for (let i = 0; i < 7; i++) {
    const px = rng() * (W - 200), py = rng() * (W - 300), pw = 90 + rng() * 140, ph = 120 + rng() * 200, t = (rng() - 0.5) * 14;
    x.fillStyle = `rgba(${t > 0 ? 70 : 0},${t > 0 ? 70 : 0},${t > 0 ? 76 : 0},0.28)`; x.fillRect(px, py, pw, ph);
    x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 3; x.strokeRect(px, py, pw, ph);
    hx.fillStyle = 'rgba(150,150,150,0.5)'; hx.fillRect(px, py, pw, ph); hx.strokeStyle = 'rgb(70,70,70)'; hx.lineWidth = 3; hx.strokeRect(px, py, pw, ph);
  }
  // tire tracks
  for (const u of [0.27, 0.73, 0.4, 0.6]) {
    const g = x.createLinearGradient((u - 0.06) * W, 0, (u + 0.06) * W, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect((u - 0.06) * W, 0, 0.12 * W, W);
  }
  // oil drips
  for (let i = 0; i < 10; i++) {
    const px = (0.2 + rng() * 0.6) * W, py = rng() * W, pr = 8 + rng() * 22;
    const g = x.createRadialGradient(px, py, 0, px, py, pr); g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  }
  // cracks
  x.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    let px = rng() * W, py = rng() * W, a = rng() * 6.28;
    x.strokeStyle = 'rgba(0,0,0,0.6)'; x.lineWidth = 1.5; hx.strokeStyle = 'rgb(40,40,40)'; hx.lineWidth = 2;
    x.beginPath(); hx.beginPath(); x.moveTo(px, py); hx.moveTo(px, py);
    for (let k = 0; k < 14; k++) { a += (rng() - 0.5) * 1.1; px += Math.cos(a) * 16; py += Math.sin(a) * 16; x.lineTo(px, py); hx.lineTo(px, py); }
    x.stroke(); hx.stroke();
  }
  // roughness: polished tracks, wet puddles
  rx.fillStyle = 'rgb(255,140,0)'; rx.fillRect(0, 0, W, W);
  const gloss = (cx, cy, rw, rh, a0, a1) => {
    for (const [dx, dy] of [[0, 0], [-W, 0], [W, 0], [0, -W], [0, W]]) {
      rx.save(); rx.translate(cx + dx, cy + dy); rx.scale(1, rh / rw);
      const g = rx.createRadialGradient(0, 0, 0, 0, 0, rw); g.addColorStop(0, `rgba(0,0,0,${a0})`); g.addColorStop(0.7, `rgba(0,0,0,${a1})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      rx.fillStyle = g; rx.fillRect(-rw, -rw, rw * 2, rw * 2); rx.restore();
      x.save(); x.translate(cx + dx, cy + dy); x.scale(1, rh / rw);
      const g2 = x.createRadialGradient(0, 0, 0, 0, 0, rw); g2.addColorStop(0, 'rgba(0,0,0,0.38)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g2; x.fillRect(-rw, -rw, rw * 2, rw * 2); x.restore();
    }
  };
  for (const u of [0.27, 0.73]) for (let k = 0; k < 4; k++) gloss(u * W + (rng() - 0.5) * 20, (k + rng() * 0.5) * (W / 4), 55 + rng() * 25, 120 + rng() * 80, 0.55, 0.3);
  for (let i = 0; i < 18; i++) gloss(rng() * W, rng() * W, 28 + rng() * 60, 45 + rng() * 120, 0.97, 0.62);
  // manhole covers
  for (const [u, v] of [[0.63, 0.33], [0.31, 0.82]]) {
    const px = u * W, py = v * W;
    x.fillStyle = '#2a2b31'; x.beginPath(); x.arc(px, py, 26, 0, 7); x.fill();
    x.strokeStyle = '#4a4c55'; x.lineWidth = 3; x.beginPath(); x.arc(px, py, 26, 0, 7); x.stroke(); x.beginPath(); x.arc(px, py, 15, 0, 7); x.stroke();
    for (let k = 0; k < 8; k++) { x.beginPath(); x.moveTo(px - 22, py - 14 + k * 4); x.lineTo(px + 22, py - 14 + k * 4); x.lineWidth = 1; x.stroke(); }
    hx.fillStyle = 'rgb(105,105,105)'; hx.beginPath(); hx.arc(px, py, 28, 0, 7); hx.fill(); hx.fillStyle = 'rgb(150,150,150)'; hx.beginPath(); hx.arc(px, py, 24, 0, 7); hx.fill();
    rx.fillStyle = 'rgb(255,95,0)'; rx.beginPath(); rx.arc(px, py, 26, 0, 7); rx.fill();
  }
  // gutter drains near the kerb edges
  for (const [u, v] of [[0.025, 0.2], [0.975, 0.62], [0.025, 0.9]]) {
    const px = u * W - 18, py = v * W - 28; x.fillStyle = '#17181c'; x.fillRect(px, py, 36, 56);
    for (let k = 4; k < 52; k += 8) { x.fillStyle = '#3a3c44'; x.fillRect(px + 2, py + k, 32, 3); }
    hx.fillStyle = 'rgb(70,70,70)'; hx.fillRect(px, py, 36, 56);
  }
  // markings: centre double yellow, dashed white lane lines, solid edge lines — worn
  x.fillStyle = '#cfa62a'; x.fillRect(W * 0.5 - 18, 0, 8, W); x.fillRect(W * 0.5 + 10, 0, 8, W);
  x.fillStyle = 'rgba(228,228,234,0.88)';
  for (const u of [0.25, 0.75]) for (let y = 0; y < W; y += 256) x.fillRect(u * W - 6, y + 32, 12, 128);
  x.fillRect(W * 0.045, 0, 12, W); x.fillRect(W * 0.955 - 12, 0, 12, W);
  for (const u of [0.5, 0.25, 0.75, 0.045, 0.955]) hx.fillStyle = 'rgb(138,138,138)';
  rx.fillStyle = 'rgb(255,215,0)';
  rx.fillRect(W * 0.5 - 18, 0, 8, W); rx.fillRect(W * 0.5 + 10, 0, 8, W);
  for (const u of [0.25, 0.75]) for (let y = 0; y < W; y += 256) rx.fillRect(u * W - 6, y + 32, 12, 128);
  rx.fillRect(W * 0.045, 0, 12, W); rx.fillRect(W * 0.955 - 12, 0, 12, W);
  // wear: erase marking bits with asphalt
  for (let i = 0; i < 500; i++) { x.fillStyle = `rgba(26,27,33,${0.25 + rng() * 0.4})`; x.fillRect(W * (rng() < 0.5 ? 0.5 + (rng() - 0.5) * 0.06 : rng() < 0.5 ? 0.25 : 0.75) + (rng() - 0.5) * 20, rng() * W, 3 + rng() * 9, 3 + rng() * 14); }
  return [canvasTex(c, { repeat: true }), canvasTex(r, { repeat: true, srgb: false }), canvasTex(normalFromHeight(hc, 2.2), { repeat: true, srgb: false })];
}

export function makeIntersection() {
  const W = 1024;
  const [c, x] = makeCanvas(W, W);
  const [r, rx] = makeCanvas(W, W);
  const [hc, hx] = makeCanvas(W, W);
  const rng = mulberry32(11);
  noiseFill(x, W, W, 14, [24, 25, 31]);
  hx.fillStyle = 'rgb(128,128,128)'; hx.fillRect(0, 0, W, W);
  for (let i = 0; i < 40000; i++) { const px = rng() * W, py = rng() * W, l = rng() < 0.5 ? 0 : 255; x.fillStyle = `rgba(${l},${l},${l},${0.04 + rng() * 0.08})`; x.fillRect(px, py, 2, 2); hx.fillStyle = `rgba(${l},${l},${l},0.18)`; hx.fillRect(px, py, 2, 2); }
  rx.fillStyle = 'rgb(255,120,0)'; rx.fillRect(0, 0, W, W);
  // swirl tyre marks and puddles
  for (let i = 0; i < 26; i++) {
    const px = rng() * W, py = rng() * W, pr = 30 + rng() * 80;
    const g = rx.createRadialGradient(px, py, 0, px, py, pr); g.addColorStop(0, 'rgba(0,0,0,0.97)'); g.addColorStop(0.65, 'rgba(0,0,0,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    rx.fillStyle = g; rx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    const g2 = x.createRadialGradient(px, py, 0, px, py, pr); g2.addColorStop(0, 'rgba(0,0,0,0.4)'); g2.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g2; x.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  }
  x.strokeStyle = 'rgba(0,0,0,0.28)'; x.lineWidth = 16; x.lineCap = 'round';
  for (let i = 0; i < 10; i++) { x.beginPath(); const cx0 = rng() * W, cy0 = rng() * W, rr = 120 + rng() * 280; x.arc(cx0, cy0, rr, rng() * 6, rng() * 6 + 1.2); x.stroke(); }
  // crosswalks (zebra) and stop lines
  const band = 140;
  x.fillStyle = 'rgba(232,232,238,0.86)'; rx.fillStyle = 'rgb(255,200,0)'; hx.fillStyle = 'rgb(138,138,138)';
  for (let i = 0; i < 12; i++) {
    const p = 80 + i * 72;
    for (const f of [(ctx) => ctx.fillRect(p, 16, 38, band - 28), (ctx) => ctx.fillRect(p, W - band + 12, 38, band - 28), (ctx) => ctx.fillRect(16, p, band - 28, 38), (ctx) => ctx.fillRect(W - band + 12, p, band - 28, 38)]) { f(x); f(rx); f(hx); }
  }
  for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(26,27,33,${0.25 + rng() * 0.4})`; x.fillRect(rng() * W, (rng() < 0.5 ? 16 + rng() * 100 : W - 120 + rng() * 100), 3 + rng() * 12, 3 + rng() * 10); }
  return [canvasTex(c, { repeat: true }), canvasTex(r, { repeat: true, srgb: false }), canvasTex(normalFromHeight(hc, 2.2), { repeat: true, srgb: false })];
}

// paving slabs (2 m) with seams, tonal variation, grime and a rubber-kerb edge feel
export function makeSidewalk() {
  const W = 512;
  const [c, x] = makeCanvas(W, W); const [hc, hx] = makeCanvas(W, W); const [r, rx] = makeCanvas(W, W);
  const rng = mulberry32(21);
  hx.fillStyle = 'rgb(150,150,150)'; hx.fillRect(0, 0, W, W);
  rx.fillStyle = 'rgb(255,150,0)'; rx.fillRect(0, 0, W, W);
  const slab = W / 4;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const t = 44 + (rng() - 0.5) * 16;
    x.fillStyle = `rgb(${t},${t},${t + 8})`; x.fillRect(i * slab, j * slab, slab, slab);
    for (let k = 0; k < 500; k++) { x.fillStyle = `rgba(${rng() < 0.5 ? 0 : 255},${rng() < 0.5 ? 0 : 255},${rng() < 0.5 ? 0 : 255},0.05)`; x.fillRect(i * slab + rng() * slab, j * slab + rng() * slab, 2, 2); }
    const g = rx.createRadialGradient(i * slab + rng() * slab, j * slab + rng() * slab, 0, i * slab + slab / 2, j * slab + slab / 2, slab * 0.6); g.addColorStop(0, `rgba(0,0,0,${0.3 + rng() * 0.5})`); g.addColorStop(1, 'rgba(0,0,0,0)'); rx.fillStyle = g; rx.fillRect(i * slab, j * slab, slab, slab);
  }
  x.strokeStyle = 'rgba(0,0,0,0.65)'; x.lineWidth = 4; hx.strokeStyle = 'rgb(50,50,50)'; hx.lineWidth = 5;
  for (let i = 0; i <= 4; i++) for (const ctx of [x, hx]) { ctx.beginPath(); ctx.moveTo(i * slab, 0); ctx.lineTo(i * slab, W); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * slab); ctx.lineTo(W, i * slab); ctx.stroke(); }
  for (let i = 0; i < 8; i++) { x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 1.5; let px = rng() * W, py = rng() * W, a = rng() * 6.28; x.beginPath(); x.moveTo(px, py); for (let k = 0; k < 8; k++) { a += (rng() - 0.5); px += Math.cos(a) * 14; py += Math.sin(a) * 14; x.lineTo(px, py); } x.stroke(); }
  return [canvasTex(c, { repeat: true }), canvasTex(r, { repeat: true, srgb: false }), canvasTex(normalFromHeight(hc, 2.0), { repeat: true, srgb: false })];
}

export function makeGrass() {
  const [c, x] = makeCanvas(128, 128);
  noiseFill(x, 128, 128, 30, [18, 38, 28]);
  return canvasTex(c, { repeat: true });
}

// ---------- neon sign atlas ----------
const SIGNS = [
  ['JUSTICE', '#ffd24a', 0], ['SLURP COLA', '#ff3ea5', 1], ['GRUD BURGERS', '#ff8a2a', 1], ['OZ HOTEL', '#40e0ff', 1],
  ['HOTDOG CITY', '#ff4a3a', 1], ['ROBO-DOC', '#7dffb0', 1], ['MEGA NOODLES', '#ff5ad6', 1], ['CITI-DEF', '#ffd24a', 0],
  ['LUCKY 7', '#ff3a5a', 1], ['SEKTOR 9', '#6aa8ff', 0], ['BLOCK PARTY', '#c06aff', 1], ['BYTE BAR', '#40ffd0', 1],
  ['FRESH PIZZA', '#ffb030', 1], ['UNDERCITY', '#ff4040', 0], ['KRAZY KATS', '#ff7ad0', 1], ['JUDGE-O-MAT', '#ffd24a', 0],
  ['AUTO-DOC', '#40ff90', 1], ['PAWN 24HR', '#ffa030', 1], ['SYNTH CAFE', '#50c8ff', 1], ['I AM THE LAW', '#ff2a2a', 0],
  ['HOVER-LOAN', '#ffe040', 1], ['FAT-FREE', '#b0ff40', 1], ['STUBBS', '#ff9ad0', 1], ['MEGA-LOTTO', '#ffd24a', 1],
];
export const SIGN_COLS = 4, SIGN_ROWS = 6, SIGN_COUNT = SIGNS.length;
export function makeSignAtlas() {
  const CW = 512, CH = 256;
  const [c, x] = makeCanvas(CW * SIGN_COLS, CH * SIGN_ROWS);
  x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
  SIGNS.forEach(([text, col, boxed], i) => {
    const cx = (i % SIGN_COLS) * CW, cy = Math.floor(i / SIGN_COLS) * CH;
    x.save(); x.translate(cx, cy);
    x.shadowColor = col; x.shadowBlur = 18;
    x.strokeStyle = col; x.fillStyle = col; x.lineWidth = 8;
    if (boxed) { x.strokeRect(22, 22, CW - 44, CH - 44); x.lineWidth = 3; x.strokeRect(36, 36, CW - 72, CH - 72); }
    else { x.globalAlpha = 0.18; x.fillRect(16, 16, CW - 32, CH - 32); x.globalAlpha = 1; }
    let fs = 96; x.font = `900 ${fs}px Impact, 'Arial Black', sans-serif`;
    while (x.measureText(text).width > CW - 90 && fs > 20) { fs -= 4; x.font = `900 ${fs}px Impact, 'Arial Black', sans-serif`; }
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = boxed ? col : '#fff'; x.shadowBlur = 24; x.fillText(text, CW / 2, CH / 2 + 4);
    x.shadowBlur = 0; x.fillStyle = col; x.globalAlpha = 0.5; x.fillText(text, CW / 2, CH / 2 + 4);
    x.restore();
  });
  return canvasTex(c);
}

// ---------- soft radial sprite ----------
export function makeGlowTex() {
  const [c, x] = makeCanvas(128, 128);
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.5)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return canvasTex(c);
}

// ---------- shopfront interior (grey-scale, tinted per shop by vertex colour) ----------
export function makeShopTex() {
  const [c, x] = makeCanvas(512, 256);
  const rng = mulberry32(77);
  x.fillStyle = '#1a1a1c'; x.fillRect(0, 0, 512, 256);
  // lit ceiling band + back wall glow
  const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.18, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0.12)');
  x.fillStyle = g; x.fillRect(8, 8, 496, 240);
  // shelves with products
  for (let row = 0; row < 3; row++) {
    const y = 52 + row * 58;
    x.fillStyle = 'rgba(0,0,0,0.65)'; x.fillRect(8, y + 40, 496, 6);
    for (let px = 14; px < 500;) {
      const w = 12 + rng() * 26, h = 14 + rng() * 34, l = 90 + rng() * 165;
      x.fillStyle = `rgb(${l | 0},${l | 0},${l | 0})`; x.fillRect(px, y + 40 - h, w, h); px += w + 4 + rng() * 10;
    }
  }
  // counter + silhouettes
  x.fillStyle = 'rgba(0,0,0,0.8)'; x.fillRect(8, 206, 496, 42);
  for (let i = 0; i < 3; i++) { if (rng() < 0.7) { const px = 40 + rng() * 420; x.fillStyle = 'rgba(0,0,0,0.85)'; x.beginPath(); x.arc(px, 160, 13, 0, 7); x.fill(); x.fillRect(px - 16, 172, 32, 70); } }
  // mullions
  x.fillStyle = '#0b0b0d'; for (const px of [0, 128, 256, 384, 508]) x.fillRect(px, 0, 5, 256); x.fillRect(0, 0, 512, 6); x.fillRect(0, 250, 512, 6);
  return canvasTex(c);
}
