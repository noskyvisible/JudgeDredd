import * as THREE from 'three';
import { makeCanvas, canvasTex, rand, pick, mulberry32 } from './util.js';

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
export function makeRoad() {
  const W = 512, H = 512;
  const [c, x] = makeCanvas(W, H);
  const [r, rx] = makeCanvas(W, H);
  noiseFill(x, W, H, 12, [20, 21, 27]);
  // tire tracks
  for (const u of [0.27, 0.73, 0.38, 0.62]) {
    const g = x.createLinearGradient((u - 0.06) * W, 0, (u + 0.06) * W, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.28)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect((u - 0.06) * W, 0, 0.12 * W, H);
  }
  rx.fillStyle = 'rgb(115,115,115)'; rx.fillRect(0, 0, W, H);
  for (const u of [0.27, 0.73]) {
    const g = rx.createLinearGradient((u - 0.06) * W, 0, (u + 0.06) * W, 0);
    g.addColorStop(0, 'rgba(40,40,40,0)'); g.addColorStop(0.5, 'rgba(40,40,40,0.8)'); g.addColorStop(1, 'rgba(40,40,40,0)');
    rx.fillStyle = g; rx.fillRect((u - 0.06) * W, 0, 0.12 * W, H);
  }
  // puddles
  const rng = mulberry32(7);
  for (let i = 0; i < 16; i++) {
    const px = rng() * W, py = rng() * H, pr = 20 + rng() * 50;
    for (const [dx, dy] of [[0, 0], [-W, 0], [W, 0], [0, -H], [0, H]]) {
      const g = rx.createRadialGradient(px + dx, py + dy, 0, px + dx, py + dy, pr);
      g.addColorStop(0, 'rgba(0,0,0,0.95)'); g.addColorStop(0.7, 'rgba(0,0,0,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      rx.fillStyle = g; rx.fillRect(px + dx - pr, py + dy - pr, pr * 2, pr * 2);
      const g2 = x.createRadialGradient(px + dx, py + dy, 0, px + dx, py + dy, pr);
      g2.addColorStop(0, 'rgba(0,0,0,0.5)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g2; x.fillRect(px + dx - pr, py + dy - pr, pr * 2, pr * 2);
    }
  }
  // markings
  x.fillStyle = '#cfa62a';
  x.fillRect(W * 0.5 - 9, 0, 4, H); x.fillRect(W * 0.5 + 5, 0, 4, H);
  x.fillStyle = 'rgba(225,225,230,0.85)';
  for (const u of [0.25, 0.75]) for (let y = 0; y < H; y += 128) x.fillRect(u * W - 3, y + 16, 6, 64);
  x.fillRect(W * 0.045, 0, 6, H); x.fillRect(W * 0.955 - 6, 0, 6, H);
  // markings are less glossy
  rx.fillStyle = 'rgba(200,200,200,0.9)';
  rx.fillRect(W * 0.5 - 9, 0, 4, H); rx.fillRect(W * 0.5 + 5, 0, 4, H);
  for (const u of [0.25, 0.75]) for (let y = 0; y < H; y += 128) rx.fillRect(u * W - 3, y + 16, 6, 64);
  rx.fillRect(W * 0.045, 0, 6, H); rx.fillRect(W * 0.955 - 6, 0, 6, H);
  return [canvasTex(c, { repeat: true }), canvasTex(r, { repeat: true, srgb: false })];
}

export function makeIntersection() {
  const W = 512, H = 512;
  const [c, x] = makeCanvas(W, H);
  const [r, rx] = makeCanvas(W, H);
  noiseFill(x, W, H, 12, [20, 21, 27]);
  rx.fillStyle = 'rgb(105,105,105)'; rx.fillRect(0, 0, W, H);
  const rng = mulberry32(11);
  for (let i = 0; i < 8; i++) {
    const px = rng() * W, py = rng() * H, pr = 25 + rng() * 55;
    const g = rx.createRadialGradient(px, py, 0, px, py, pr);
    g.addColorStop(0, 'rgba(0,0,0,0.95)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    rx.fillStyle = g; rx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  }
  x.fillStyle = 'rgba(230,230,235,0.8)';
  rx.fillStyle = 'rgba(210,210,210,0.9)';
  const band = 70;
  for (let i = 0; i < 12; i++) {
    const p = 40 + i * 36;
    for (const f of [(ctx) => ctx.fillRect(p, 8, 20, band - 12), (ctx) => ctx.fillRect(p, H - band + 4, 20, band - 12),
      (ctx) => ctx.fillRect(8, p, band - 12, 20), (ctx) => ctx.fillRect(W - band + 4, p, band - 12, 20)]) { f(x); f(rx); }
  }
  return [canvasTex(c, { repeat: true }), canvasTex(r, { repeat: true, srgb: false })];
}

export function makeSidewalk() {
  const W = 256;
  const [c, x] = makeCanvas(W, W);
  noiseFill(x, W, W, 14, [46, 46, 54]);
  x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 3;
  for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, W); x.stroke(); x.beginPath(); x.moveTo(0, i * 64); x.lineTo(W, i * 64); x.stroke(); }
  return canvasTex(c, { repeat: true });
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
