import * as THREE from 'three';
import { makeCanvas, canvasTex, mulberry32 } from './util.js';
import { shieldPath } from './charkit.js';
import { eagleShape } from './world.js';

// ===========================================================================
// Procedural texture set for the hero + his weapons.  All generated once into typed arrays and
// uploaded as canvases (no assets).  Tiling maps are authored for UVs in metres.
//   leatherN / leatherR   pebbled hide grain + creases (normal) and smudged wear (roughness, G channel)
//   goldR / goldN         polished gold: hairline scratches, dents, rubbed smudges
//   skin / skinN          stubbled, slightly ruddy skin + pores
//   visorE                emissive band gradient with a hot horizontal core and scan lines
//   gripN                 stippled polymer grip / knurling
//   brushedR              brushed gunmetal roughness
//   decal / decalMR       atlas: chest badge, eagle-shield buckle, Lawgiver markings + metal/rough masks
// ===========================================================================

let CACHE = null;

// ---------- noise helpers (all tileable) ----------
function valueNoise(W, H, cell, rng) {
  const gx = Math.max(1, Math.round(W / cell)), gy = Math.max(1, Math.round(H / cell));
  const g = new Float32Array(gx * gy); for (let i = 0; i < g.length; i++) g[i] = rng();
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = (y / H) * gy, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty), y1 = (y0 + 1) % gy;
    for (let x = 0; x < W; x++) {
      const fx = (x / W) * gx, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx), x1 = (x0 + 1) % gx;
      const a = g[y0 * gx + x0], b = g[y0 * gx + x1], c = g[y1 * gx + x0], d = g[y1 * gx + x1];
      out[y * W + x] = (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
    }
  }
  return out;
}
function fbm(W, H, cell, oct, rng, gain = 0.5) {
  const out = new Float32Array(W * H); let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) { const n = valueNoise(W, H, cell, rng); for (let i = 0; i < out.length; i++) out[i] += n[i] * amp; tot += amp; amp *= gain; cell = Math.max(2, cell / 2); }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
// Worley F2-F1 on a jittered grid: bright cell interiors, dark cracks -> pebbled leather
function worley(W, H, cell, rng, jit = 0.85) {
  const gx = Math.round(W / cell), gy = Math.round(H / cell), pts = new Float32Array(gx * gy * 2);
  for (let i = 0; i < gx * gy; i++) { pts[i * 2] = (0.5 + (rng() - 0.5) * jit); pts[i * 2 + 1] = (0.5 + (rng() - 0.5) * jit); }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const fx = (x / W) * gx, fy = (y / H) * gy, cx = Math.floor(fx), cy = Math.floor(fy);
    let f1 = 9, f2 = 9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const ix = (cx + i + gx) % gx, iy = (cy + j + gy) % gy, k = (iy * gx + ix) * 2;
      const px = cx + i + pts[k], py = cy + j + pts[k + 1], d = (px - fx) * (px - fx) + (py - fy) * (py - fy);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    out[y * W + x] = Math.sqrt(f2) - Math.sqrt(f1);
  }
  return out;
}
// splat an anti-aliased line (wraps) into a height/value field
function line(F, W, H, x0, y0, x1, y1, w, v, mode = 'add') {
  const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(2, Math.ceil(L * 1.5)), r = Math.ceil(w + 1);
  for (let s = 0; s <= n; s++) {
    const t = s / n, px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      const d = Math.hypot(i - (px % 1) + 0.5, j - (py % 1) + 0.5); if (d > w + 0.5) continue;
      const cov = Math.min(1, w + 0.5 - d);
      const k = mode === 'max' ? cov * v : cov * v * (L / n) / (w + 0.5) * 0.5;
      const xx = ((Math.floor(px) + i) % W + W) % W, yy = ((Math.floor(py) + j) % H + H) % H, idx = yy * W + xx;
      if (mode === 'max') F[idx] = Math.max(F[idx], k); else F[idx] += k;
    }
  }
}
function blob(F, W, H, cx, cy, rad, v) {
  const r = Math.ceil(rad * 2);
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
    const d2 = (i * i + j * j) / (rad * rad); if (d2 > 4) continue;
    const xx = ((Math.floor(cx) + i) % W + W) % W, yy = ((Math.floor(cy) + j) % H + H) % H;
    F[yy * W + xx] += v * Math.exp(-d2 * 1.5);
  }
}
function normalCanvas(Hf, W, H, strength) {
  const [c, x] = makeCanvas(W, H), img = x.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) for (let X = 0; X < W; X++) {
    const xm = (X - 1 + W) % W, xp = (X + 1) % W, ym = (y - 1 + H) % H, yp = (y + 1) % H;
    const dx = (Hf[y * W + xm] - Hf[y * W + xp]) * strength, dy = (Hf[yp * W + X] - Hf[ym * W + X]) * strength;
    const k = 127.5 / Math.sqrt(dx * dx + dy * dy + 1), i = (y * W + X) * 4;
    d[i] = dx * k + 127.5; d[i + 1] = dy * k + 127.5; d[i + 2] = k + 127.5; d[i + 3] = 255;
  }
  x.putImageData(img, 0, 0); return c;
}
function greyCanvas(F, W, H, lo = 0, hi = 1) {
  const [c, x] = makeCanvas(W, H), img = x.createImageData(W, H), d = img.data;
  for (let i = 0; i < W * H; i++) { const v = Math.max(0, Math.min(255, (lo + (hi - lo) * F[i]) * 255)); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  x.putImageData(img, 0, 0); return c;
}
const nrmTex = (c) => canvasTex(c, { repeat: true, srgb: false });

export function heroTextures() {
  if (CACHE) return CACHE;
  const rng = mulberry32(2099);
  const T = {};

  // ---------------- leather (tile ~ 0.22 m) ----------------
  {
    const W = 512, H = 512;
    const cells = worley(W, H, 7, rng);
    const big = fbm(W, H, 128, 3, rng), mid = fbm(W, H, 32, 3, rng);
    const hgt = new Float32Array(W * H), rough = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const pebble = Math.min(1, cells[i] * 2.2);
      hgt[i] = Math.sqrt(pebble) * 0.55 + mid[i] * 0.35;
      rough[i] = 0.62 + (big[i] - 0.5) * 0.5 + (1 - pebble) * 0.18;
    }
    // creases: wandering grooves
    for (let k = 0; k < 70; k++) {
      let x = rng() * W, y = rng() * H, a = rng() * TAU0; const len = 10 + rng() * 40, w = 0.6 + rng() * 1.1;
      for (let s = 0; s < len; s++) { const nx = x + Math.cos(a) * 3, ny = y + Math.sin(a) * 3; line(hgt, W, H, x, y, nx, ny, w, -0.55); line(rough, W, H, x, y, nx, ny, w, 0.25); x = nx; y = ny; a += (rng() - 0.5) * 0.5; }
    }
    // scuffs: rougher, flattened patches
    for (let k = 0; k < 26; k++) blob(rough, W, H, rng() * W, rng() * H, 6 + rng() * 22, 0.18 + rng() * 0.12);
    T.leatherN = nrmTex(normalCanvas(hgt, W, H, 3.2));
    T.leatherR = nrmTex(greyCanvas(rough, W, H, 0, 1));
  }
  // ---------------- polished gold (tile ~ 0.3 m) ----------------
  {
    const W = 512, H = 512;
    const smudge = fbm(W, H, 96, 4, rng), hgt = fbm(W, H, 64, 2, rng);
    const rough = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) { rough[i] = 0.3 + (smudge[i] - 0.5) * 0.22; hgt[i] *= 0.25; }
    for (let k = 0; k < 420; k++) {
      const x = rng() * W, y = rng() * H, a = (rng() < 0.6 ? 0.4 : 2.1) + (rng() - 0.5) * 0.9, l = 6 + rng() * 60;
      line(rough, W, H, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.35 + rng() * 0.4, 0.42 + rng() * 0.22, 'max');
      if (rng() < 0.3) line(hgt, W, H, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.4, -0.3);
    }
    for (let k = 0; k < 40; k++) blob(hgt, W, H, rng() * W, rng() * H, 2 + rng() * 5, -(0.2 + rng() * 0.3));
    T.goldR = nrmTex(greyCanvas(rough, W, H, 0, 1));
    T.goldN = nrmTex(normalCanvas(hgt, W, H, 2.0));
  }
  // ---------------- brushed gunmetal ----------------
  {
    const W = 256, H = 256, F = new Float32Array(W * H);
    for (let y = 0; y < H; y++) { let v = 0.45 + (rng() - 0.5) * 0.12; for (let x = 0; x < W; x++) { v += (rng() - 0.5) * 0.04; v = Math.max(0.3, Math.min(0.62, v)); F[y * W + x] = v; } }
    const n = fbm(W, H, 64, 3, rng); for (let i = 0; i < W * H; i++) F[i] += (n[i] - 0.5) * 0.2;
    T.brushedR = nrmTex(greyCanvas(F, W, H));
  }
  // ---------------- stippled grip ----------------
  {
    const W = 128, H = 128, F = new Float32Array(W * H);
    for (let k = 0; k < 900; k++) blob(F, W, H, rng() * W, rng() * H, 1.2 + rng() * 0.8, 0.6);
    T.gripN = nrmTex(normalCanvas(F, W, H, 2.5));
  }
  // ---------------- skin: stubble, pores, ruddiness ----------------
  {
    const W = 256, H = 256;
    const [c, x] = makeCanvas(W, H), img = x.createImageData(W, H), d = img.data;
    const tone = fbm(W, H, 64, 3, rng), pores = new Float32Array(W * H);
    for (let k = 0; k < 2600; k++) blob(pores, W, H, rng() * W, rng() * H, 0.7, -0.5);
    for (let i = 0; i < W * H; i++) {
      const st = rng() < 0.16 ? 0.55 + rng() * 0.3 : 0;   // stubble dots
      const t = tone[i] - 0.5;
      d[i * 4] = Math.max(0, 186 + t * 30 - st * 70); d[i * 4 + 1] = Math.max(0, 136 + t * 18 - st * 62); d[i * 4 + 2] = Math.max(0, 108 + t * 10 - st * 54); d[i * 4 + 3] = 255;
      pores[i] += st * -0.25;
    }
    x.putImageData(img, 0, 0); T.skin = canvasTex(c, { repeat: true });
    T.skinN = nrmTex(normalCanvas(pores, W, H, 2.0));
  }
  // ---------------- visor emissive gradient ----------------
  {
    const W = 64, H = 128, [c, x] = makeCanvas(W, H);
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2a0000'); g.addColorStop(0.3, '#8a0a04'); g.addColorStop(0.48, '#ff3a1a'); g.addColorStop(0.53, '#ff6a3a'); g.addColorStop(0.6, '#a01006'); g.addColorStop(1, '#220000');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(0,0,0,0.22)'; for (let y = 0; y < H; y += 3) x.fillRect(0, y, W, 1);
    T.visorE = canvasTex(c);
  }
  // ---------------- decal atlas (1024 x 512) ----------------
  T.decal = decalAtlas(rng);
  CACHE = T;
  return T;
}
const TAU0 = Math.PI * 2;

// atlas regions (u0, v0, u1, v1) in [0..1] with v up (three.js flipY convention)
export const ATLAS = {
  badge: [0, 0.375, 0.25, 1.0],         // 256 x 320 px at top-left
  buckle: [0.25, 0.5, 0.5, 1.0],        // 256 x 256
  gunL: [0.5, 0.875, 1.0, 1.0],         // 512 x 64 Lawgiver side markings
  gunNum: [0.5, 0.75, 0.75, 0.875],     // ammo counter digits
  helmetStripe: [0.75, 0.75, 1.0, 0.875],
  plain: [0.01, 0.01, 0.04, 0.04],      // solid gold swatch
};
function eaglePath(x, cx, cy, s, flip = 1) {
  const sh = eagleShape(), pts = sh.getPoints();
  x.beginPath(); pts.forEach((p, i) => { const X = cx + p.x * s, Y = cy - (p.y - 0.4) * s * flip; if (i) x.lineTo(X, Y); else x.moveTo(X, Y); }); x.closePath();
}
function decalAtlas(rng) {
  const W = 1024, H = 512;
  const [c, x] = makeCanvas(W, H), [m, mx] = makeCanvas(W, H);   // colour + (R unused, G roughness, B metalness)
  x.fillStyle = '#c8962a'; x.fillRect(0, 0, W, H);
  mx.fillStyle = 'rgb(0,90,255)'; mx.fillRect(0, 0, W, H);
  const gold = (ctx, x0, y0, x1, y1) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, '#fbe08a'); g.addColorStop(0.45, '#d9a52a'); g.addColorStop(1, '#94661a'); return g; };
  // --- chest badge: gold shield, eagle, DREDD on enamel ---
  {
    const ox = 0, oy = 0;
    x.save(); x.translate(ox, oy);
    x.fillStyle = '#2a1c05'; shieldPath(x, 4, 4, 248, 312); x.fill();
    x.fillStyle = gold(x, 0, 0, 256, 320); shieldPath(x, 12, 12, 232, 296); x.fill();
    x.strokeStyle = '#7a5410'; x.lineWidth = 5; shieldPath(x, 26, 26, 204, 266); x.stroke();
    x.fillStyle = '#16120c'; x.fillRect(40, 176, 176, 58);                  // enamel name plate
    x.fillStyle = gold(x, 0, 170, 0, 240); x.font = '900 50px Impact, "Arial Black", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('DREDD', 128, 207);
    x.fillStyle = '#3a2706'; eaglePath(x, 128, 112, 92); x.fill();
    x.fillStyle = gold(x, 40, 40, 200, 160); eaglePath(x, 128, 108, 88); x.fill();
    x.restore();
    mx.fillStyle = 'rgb(0,220,40)'; mx.fillRect(40, 176, 176, 58);   // enamel: rough-ish, non metal
    mx.fillStyle = 'rgb(0,80,255)'; x.font = '900 50px Impact, "Arial Black", sans-serif';
    mx.font = x.font; mx.textAlign = 'center'; mx.textBaseline = 'middle'; mx.fillText('DREDD', 128, 207);
  }
  // --- belt buckle: gold eagle on a dark shield ---
  {
    x.save(); x.translate(256, 0);
    x.fillStyle = gold(x, 0, 0, 256, 256); x.fillRect(0, 0, 256, 256);
    x.fillStyle = '#5a3d0c'; x.fillRect(10, 10, 236, 236);
    x.fillStyle = gold(x, 0, 0, 256, 256); x.fillRect(16, 16, 224, 224);
    x.fillStyle = '#141008'; shieldPath(x, 40, 30, 176, 200); x.fill();
    x.fillStyle = gold(x, 40, 40, 220, 200); eaglePath(x, 128, 120, 92); x.fill();
    x.strokeStyle = '#ffeaa0'; x.lineWidth = 2; shieldPath(x, 40, 30, 176, 200); x.stroke();
    x.restore();
    mx.save(); mx.translate(256, 0); mx.fillStyle = 'rgb(0,200,30)'; shieldPath(mx, 40, 30, 176, 200); mx.fill(); mx.fillStyle = 'rgb(0,80,255)'; eaglePath(mx, 128, 120, 92); mx.fill(); mx.restore();
  }
  // --- Lawgiver side markings ---
  {
    x.save(); x.translate(512, 0);
    x.fillStyle = '#16171c'; x.fillRect(0, 0, 512, 64);
    x.fillStyle = '#c8962a'; x.font = 'bold 26px "Arial Narrow", Arial, sans-serif'; x.textBaseline = 'middle'; x.fillText('LAWGIVER  MK II', 14, 22);
    x.fillStyle = '#8a8f9a'; x.font = '16px monospace'; x.fillText('JUSTICE DEPT  ·  MC-1  ·  DNA LOCK', 14, 48);
    x.fillStyle = '#c8211a'; x.fillRect(440, 10, 60, 44); x.fillStyle = '#16171c'; x.font = 'bold 22px monospace'; x.fillText('AP', 452, 33);
    x.restore();
    mx.fillStyle = 'rgb(0,150,120)'; mx.fillRect(512, 0, 512, 64);
  }
  // --- digits strip ---
  {
    x.save(); x.translate(512, 64);
    x.fillStyle = '#050607'; x.fillRect(0, 0, 256, 64);
    x.fillStyle = '#e0ffe8'; x.font = 'bold 40px monospace'; x.textBaseline = 'middle'; x.fillText('88', 12, 34); x.font = 'bold 20px monospace'; x.fillText('STD', 120, 34);
    x.restore();
    mx.fillStyle = 'rgb(0,60,0)'; mx.fillRect(512, 64, 256, 64);
  }
  // --- helmet rear stripe / hazard ---
  {
    x.save(); x.translate(768, 64);
    x.fillStyle = '#0a0a0c'; x.fillRect(0, 0, 256, 64);
    for (let i = -2; i < 12; i++) { x.fillStyle = i % 2 ? '#c8962a' : '#0a0a0c'; x.beginPath(); x.moveTo(i * 24, 0); x.lineTo(i * 24 + 24, 0); x.lineTo(i * 24, 64); x.lineTo(i * 24 - 24, 64); x.fill(); }
    x.restore();
  }
  // light grime over everything
  x.globalCompositeOperation = 'multiply';
  for (let k = 0; k < 160; k++) { x.fillStyle = `rgba(120,100,80,${0.04 + rng() * 0.05})`; x.beginPath(); x.arc(rng() * W, rng() * H, 4 + rng() * 26, 0, TAU0); x.fill(); }
  x.globalCompositeOperation = 'source-over';
  const map = canvasTex(c); map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  const mr = canvasTex(m, { srgb: false }); mr.wrapS = mr.wrapT = THREE.ClampToEdgeWrapping;
  return { map, mr };
}
// remap a geometry's 0..1 uvs into an atlas rect
export function atlasUV(geo, rect) {
  const uv = geo.attributes.uv; const [u0, v0, u1, v1] = rect;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  uv.needsUpdate = true; return geo;
}
