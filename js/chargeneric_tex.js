import * as THREE from 'three';
import { makeCanvas, mulberry32, normalFromHeight } from './util.js';

// ===========================================================================
// Texture atlases + material factory for the procedural perps / civilians.
//
// Every atlas is three canvases painted once and shared by all instances:
//   mask   (full res)  R = shade (186 = neutral, 255 = 2x, 0 = black), G/B = colour-slot selector
//                      (0,0) slot A = material.color, (1,0) B, (0,1) C, (1,1) D
//   height (half res)  grey 128 = flat  -> converted to a tangent-space normal map
//   orm    (half res)  R = ambient occlusion, G = roughness, B = metalness
// A small shader patch resolves the slot colours from per-material uniforms, so a new spawn only
// needs fresh MeshStandardMaterials (cheap) with its own palette -- no canvas work per spawn.
// All perp/civ materials share one shader program (map + normalMap + ORM + vertex AO + rim).
// ===========================================================================
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const SL = { A: [0, 0], B: [255, 0], C: [0, 255], D: [255, 255] };
export const SHADE = (k) => Math.round(clamp(186 * Math.pow(k, 1 / 2.2), 0, 255)); // linear multiplier -> painted shade
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

// periodic value noise (period px, py in lattice cells)
function vnoise(x, y, px, py, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const h = (i, j) => { i = ((i % px) + px) % px; j = ((j % py) + py) % py; let n = Math.imul(i * 374761393 + j * 668265263 + seed * 2654435761, 1274126177); n ^= n >>> 13; n = Math.imul(n, 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
export function fbm(x, y, px, py, seed, oct = 3) { let s = 0, a = 0.5, f = 1, n = 0; for (let o = 0; o < oct; o++) { s += a * vnoise(x * f, y * f, px * f, py * f, seed + o * 17); n += a; a *= 0.5; f *= 2; } return s / n; }

// ---------------------------------------------------------------------------
// Painter: draws into one swatch rectangle on all three layers (local px coords, y down;
// U(u) / V(v) convert texture coords inside the swatch: v = 0 is the bottom edge).
// ---------------------------------------------------------------------------
export class Painter {
  constructor(atlas, r) {
    this.atlas = atlas; this.r = r; this.w = r.w; this.h = r.h; this.rng = mulberry32(hashStr(r.name) ^ 0x5bd1e995);
    this.seed = hashStr(r.name) & 0xffff;
  }
  U(u) { return u * this.w; }
  V(v) { return (1 - v) * this.h; }
  _begin(ctx, s) { ctx.save(); ctx.setTransform(s, 0, 0, s, s * this.r.x, s * this.r.y); const p = this.atlas.pad; ctx.beginPath(); ctx.rect(-p, -p, this.w + 2 * p, this.h + 2 * p); ctx.clip(); }
  begin() { const A = this.atlas; this._begin(A.mx, 1); this._begin(A.hx, A.hs); this._begin(A.ox, A.hs); this.base = { rough: 0.7, metal: 0 }; return this; }
  end() { const A = this.atlas; A.mx.restore(); A.hx.restore(); A.ox.restore(); }
  // fill the whole swatch (+ gutter)
  fill(slot, shade = 186, o = {}) {
    const p = this.atlas.pad; this.base = { rough: o.rough ?? 0.7, metal: o.metal ?? 0 };
    this.shape((c) => c.rect(-p, -p, this.w + 2 * p, this.h + 2 * p), { slot, shade, h: o.h ?? 128, rough: this.base.rough, metal: this.base.metal, ao: o.ao ?? 255 });
  }
  // generic shape on several layers.  st: slot/shade/alpha | mul | add ; h/hA ; rough/metal/ao/oA ; aoMul ; lw (stroke) ; blur
  shape(fn, st) {
    const A = this.atlas, stroke = st.lw != null;
    const layer = (ctx, style, comp, alpha, lwk = 1) => {
      ctx.globalCompositeOperation = comp; ctx.globalAlpha = alpha;
      if (st.blur) ctx.filter = `blur(${st.blur * lwk}px)`;
      ctx.beginPath(); fn(ctx);
      if (stroke) { ctx.lineWidth = st.lw; ctx.strokeStyle = style; ctx.lineCap = st.cap || 'round'; ctx.lineJoin = 'round'; if (st.dash) ctx.setLineDash(st.dash); ctx.stroke(); if (st.dash) ctx.setLineDash([]); }
      else { ctx.fillStyle = style; ctx.fill(st.rule || 'nonzero'); }
      if (st.blur) ctx.filter = 'none';
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    };
    if (st.slot) layer(A.mx, `rgb(${st.shade ?? 186},${SL[st.slot][0]},${SL[st.slot][1]})`, 'source-over', st.alpha ?? 1);
    else if (st.mul != null) layer(A.mx, `rgb(${Math.round(255 * clamp(st.mul, 0, 1))},255,255)`, 'multiply', st.alpha ?? 1);
    if (st.add) layer(A.mx, `rgb(${Math.round(st.add)},0,0)`, 'lighter', st.alpha ?? 1);
    if (st.h != null) { const h = Math.round(clamp(st.h, 0, 255)); layer(A.hx, `rgb(${h},${h},${h})`, 'source-over', st.hA ?? (st.alpha ?? 1)); }
    if (st.rough != null || st.metal != null || st.ao != null) {
      const ro = st.rough ?? this.base.rough, me = st.metal ?? this.base.metal;
      layer(A.ox, `rgb(${st.ao ?? 255},${Math.round(clamp(ro, 0, 1) * 255)},${Math.round(clamp(me, 0, 1) * 255)})`, 'source-over', st.oA ?? (st.alpha ?? 1));
    }
    if (st.aoMul != null) layer(A.ox, `rgb(${Math.round(255 * clamp(st.aoMul, 0, 1))},255,255)`, 'multiply', st.aoA ?? (st.alpha ?? 1));
  }
  // soft elliptical blob from radial gradients (far cheaper than canvas blur filters)
  glow(x, y, rx, ry, st) {
    const A = this.atlas, a = st.alpha ?? 1, core = st.core ?? 0.25;
    if (rx < 0.05 || ry < 0.05) return;
    const draw = (ctx, rgb, comp, al) => {
      ctx.save(); ctx.globalCompositeOperation = comp;
      ctx.translate(x, y); if (st.rot) ctx.rotate(st.rot); ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, `rgba(${rgb},${al})`); g.addColorStop(core, `rgba(${rgb},${al})`); g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    };
    if (st.slot) draw(A.mx, `${st.shade ?? 186},${SL[st.slot][0]},${SL[st.slot][1]}`, 'source-over', a);
    else if (st.mul != null) draw(A.mx, `${Math.round(255 * clamp(st.mul, 0, 1))},255,255`, 'multiply', a);
    if (st.add) draw(A.mx, `${Math.round(st.add)},0,0`, 'lighter', a);
    if (st.h != null) { const h = Math.round(clamp(st.h, 0, 255)); draw(A.hx, `${h},${h},${h}`, 'source-over', st.hA ?? a); }
    if (st.rough != null || st.metal != null) draw(A.ox, `${st.ao ?? 255},${Math.round(clamp(st.rough ?? this.base.rough, 0, 1) * 255)},${Math.round(clamp(st.metal ?? this.base.metal, 0, 1) * 255)}`, 'source-over', st.oA ?? a);
    if (st.aoMul != null) draw(A.ox, `${Math.round(255 * clamp(st.aoMul, 0, 1))},255,255`, 'multiply', st.aoA ?? a);
  }
  rect(x, y, w, h, st) {
    if (st.blur) { // feathered rectangle without a blur filter
      const b = st.blur, o = { ...st, blur: 0, alpha: (st.alpha ?? 1) * 0.4 };
      this.shape((c) => c.rect(x - b, y - b, w + 2 * b, h + 2 * b), o); this.shape((c) => c.rect(x, y, w, h), o); this.shape((c) => c.rect(x + b * 0.6, y + b * 0.6, Math.max(0, w - 1.2 * b), Math.max(0, h - 1.2 * b)), o);
      return;
    }
    this.shape((c) => c.rect(x, y, w, h), st);
  }
  ellipse(x, y, rx, ry, st, rot = 0) {
    if (st.blur && st.lw == null) { const b = st.blur * 1.2; this.glow(x, y, rx + b, ry + b, { ...st, rot, core: Math.min(rx, ry) / (Math.min(rx, ry) + b) }); return; }
    this.shape((c) => c.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, Math.PI * 2), st);
  }
  line(pts, st) {
    const path = (c) => { c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); };
    if (st.blur) { const a = st.alpha ?? 1; this.shape(path, { ...st, blur: 0, lw: st.lw + st.blur * 2, alpha: a * 0.35, hA: (st.hA ?? 1) * 0.35 }); this.shape(path, { ...st, blur: 0, alpha: a * 0.7, hA: (st.hA ?? 1) * 0.7 }); return; }
    this.shape(path, st);
  }
  poly(pts, st) { this.shape((c) => { c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); c.closePath(); }, st); }
  // seam: groove + darker line + optional stitch dashes either side
  seam(pts, o = {}) {
    const lw = o.lw ?? 1.6;
    this.line(pts, { mul: o.dark ?? 0.72, lw: lw * 1.6, h: 70, hA: 0.8, aoMul: 0.8 });
    this.line(pts, { add: 10, lw: lw * 0.6, alpha: 0.5 });
    if (o.stitch !== false) {
      const off = o.off ?? 3.2;
      for (const s of (o.both === false ? [1] : [-1, 1])) {
        const sp = offsetLine(pts, off * s);
        this.line(sp, { mul: o.stitchDark ?? 0.62, lw: 0.9, dash: [2.2, 2.2], h: 100, hA: 0.6 });
      }
    }
  }
  // per-pixel pass on the mask (shade), height and orm layers of this swatch
  pixels(fn, layers = 'mh') {
    const A = this.atlas, r = this.r, p = A.pad;
    const x0 = Math.max(0, r.x - p), y0 = Math.max(0, r.y - p), x1 = Math.min(A.W, r.x + r.w + p), y1 = Math.min(A.H, r.y + r.h + p);
    if (layers.includes('m')) {
      const id = A.mx.getImageData(x0, y0, x1 - x0, y1 - y0), d = id.data, W = x1 - x0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = ((y - y0) * W + (x - x0)) * 4; fn.m?.(x - r.x, y - r.y, d, i); }
      A.mx.putImageData(id, x0, y0);
    }
    const s = A.hs;
    for (const [L, ctx, f] of [['h', A.hx, fn.h], ['o', A.ox, fn.o]]) {
      if (!layers.includes(L) || !f) continue;
      const hx0 = Math.floor(x0 * s), hy0 = Math.floor(y0 * s), hx1 = Math.ceil(x1 * s), hy1 = Math.ceil(y1 * s), W = hx1 - hx0;
      const id = ctx.getImageData(hx0, hy0, W, hy1 - hy0), d = id.data;
      for (let y = hy0; y < hy1; y++) for (let x = hx0; x < hx1; x++) { const i = ((y - hy0) * W + (x - hx0)) * 4; f(x / s - r.x, y / s - r.y, d, i); }
      ctx.putImageData(id, hx0, hy0);
    }
  }
  // fabric micro-structure: shade jitter + height pattern.  kind: cotton denim knit leather nylon canvas fur skin wool rubber metal
  grain(kind, amt = 1, o = {}) {
    const w = this.w, h = this.h, seed = this.seed + (o.seed || 0), sc = o.scale ?? 1;
    const pat = PATTERNS[kind] || PATTERNS.cotton;
    this.pixels({
      m: (x, y, d, i) => { const v = pat.m(x / sc, y / sc, w / sc, h / sc, seed); d[i] = clamp(d[i] + v * amt * (o.m ?? 1), 0, 255); },
      h: (x, y, d, i) => { const v = pat.h(x / sc, y / sc, w / sc, h / sc, seed); const g = clamp(d[i] + v * amt * (o.h ?? 1), 0, 255); d[i] = d[i + 1] = d[i + 2] = g; },
    }, 'mh');
  }
  // large-scale wear / grime (shade darkening + roughness change) with a mask fn(u,v) -> 0..1
  grime(fn, o = {}) {
    const w = this.w, h = this.h, seed = this.seed + 99, p = this.atlas.pad;
    // one coarse grime field (quarter res), sampled by both passes
    const gw = Math.ceil((w + 2 * p) / 4) + 2, gh = Math.ceil((h + 2 * p) / 4) + 2, G = new Float32Array(gw * gh);
    const py = Math.max(1, Math.round(6 * h / w));
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const x = i * 4 - p, y = j * 4 - p, u = x / w, v = 1 - y / h;
      G[j * gw + i] = clamp(fn(u, v, fbm(u * 6, v * 6 * h / w, 6, py, seed, 2)), 0, 1);
    }
    const at = (x, y) => { const fx = clamp((x + p) / 4, 0, gw - 1.001), fy = clamp((y + p) / 4, 0, gh - 1.001), ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, k = iy * gw + ix; return G[k] * (1 - tx) * (1 - ty) + G[k + 1] * tx * (1 - ty) + G[k + gw] * (1 - tx) * ty + G[k + gw + 1] * tx * ty; };
    const dark = o.dark ?? 0.35, light = o.light ?? 0, rough = (o.rough ?? 0.1) * 255;
    this.pixels({
      m: (x, y, d, i) => { const k = at(x, y); d[i] = clamp(d[i] * (1 - dark * k) + light * k, 0, 255); },
      o: (x, y, d, i) => { const k = at(x, y); d[i + 1] = clamp(d[i + 1] + rough * k, 0, 255); },
    }, 'mo');
  }
}
export function offsetLine(pts, off) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    return [p[0] - dy * off, p[1] + dx * off];
  });
}
const hash2 = (x, y, s) => { let n = Math.imul(x * 374761393 + y * 668265263 + s * 1442695041, 1274126177); n ^= n >>> 13; n = Math.imul(n, 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
const PATTERNS = {
  cotton: { m: (x, y, w, h, s) => (hash2(x | 0, y | 0, s) - 0.5) * 10, h: (x, y, w, h, s) => (hash2(x | 0, y | 0, s + 1) - 0.5) * 18 + Math.sin(x * 2.2) * Math.sin(y * 2.2) * 6 },
  denim: { m: (x, y, w, h, s) => (hash2(x | 0, y | 0, s) - 0.5) * 14 + Math.sin((x + y) * 1.6) * 7 + (vnoise(x * 0.05, y * 0.4, Math.max(1, Math.round(w * 0.05)), Math.max(1, Math.round(h * 0.4)), s) - 0.5) * 26, h: (x, y) => Math.sin((x + y) * 1.6) * 22 },
  knit: { m: (x, y, w, h, s) => Math.sin(x * 1.3) * 9 + (hash2(x | 0, y | 0, s) - 0.5) * 8, h: (x, y) => Math.abs(Math.sin(x * 0.65)) * 50 - 25 + Math.sin(y * 1.7 + Math.sign(Math.sin(x * 0.65)) * 1.2) * 10 },
  leather: { m: (x, y, w, h, s) => (vnoise(x * 0.35, y * 0.35, Math.max(1, Math.round(w * 0.35)), Math.max(1, Math.round(h * 0.35)), s) - 0.5) * 16 + (hash2(x | 0, y | 0, s) - 0.5) * 6, h: (x, y, w, h, s) => { const v = vnoise(x * 0.7, y * 0.7, Math.max(1, Math.round(w * 0.7)), Math.max(1, Math.round(h * 0.7)), s); return (Math.abs(v - 0.5) < 0.05 ? -12 : 0) + (v - 0.5) * 12; } },
  nylon: { m: (x, y, w, h, s) => (hash2(x | 0, y | 0, s) - 0.5) * 7, h: (x, y, w, h, s) => (hash2(x | 0, y | 0, s) - 0.5) * 8 + Math.sin(x * 2.1) * 2 + Math.sin(y * 2.1) * 2 },
  canvas: { m: (x, y, w, h, s) => (hash2(x | 0, y | 0, s) - 0.5) * 12 + Math.sin(x * 2.6) * 2 + Math.sin(y * 2.6) * 2, h: (x, y, w, h, s) => Math.sin(x * 2.6) * 5 + Math.sin(y * 2.6) * 5 + (hash2(x | 0, y | 0, s + 7) - 0.5) * 10 },
  fur: { m: (x, y, w, h, s) => (vnoise(x * 0.6, y * 0.15, Math.max(1, Math.round(w * 0.6)), Math.max(1, Math.round(h * 0.15)), s) - 0.5) * 70, h: (x, y, w, h, s) => (vnoise(x * 0.8, y * 0.2, Math.max(1, Math.round(w * 0.8)), Math.max(1, Math.round(h * 0.2)), s + 3) - 0.5) * 120 },
  skin: { m: (x, y, w, h, s) => (vnoise(x * 0.12, y * 0.12, Math.max(1, Math.round(w * 0.12)), Math.max(1, Math.round(h * 0.12)), s) - 0.5) * 12 + (hash2(x | 0, y | 0, s) - 0.5) * 4, h: (x, y, w, h, s) => (hash2(x | 0, y | 0, s) - 0.5) * 10 },
  wool: { m: (x, y, w, h, s) => (vnoise(x * 0.3, y * 0.3, Math.max(1, Math.round(w * 0.3)), Math.max(1, Math.round(h * 0.3)), s) - 0.5) * 18 + (hash2(x | 0, y | 0, s) - 0.5) * 10, h: (x, y, w, h, s) => (hash2(x | 0, y | 0, s) - 0.5) * 30 },
  rubber: { m: (x, y, w, h, s) => (hash2(x | 0, y | 0, s) - 0.5) * 6, h: (x, y, w, h, s) => (hash2(x | 0, y | 0, s) - 0.5) * 8 },
  metal: { m: (x, y, w, h, s) => (vnoise(x * 0.08, y * 1.5, Math.max(1, Math.round(w * 0.08)), Math.max(1, Math.round(h * 1.5)), s) - 0.5) * 14, h: (x, y, w, h, s) => (hash2(x | 0, y | 0, s) - 0.5) * 4 },
  hair: { m: (x, y, w, h, s) => (vnoise(x * 0.9, y * 0.06, Math.max(1, Math.round(w * 0.9)), Math.max(1, Math.round(h * 0.06)), s) - 0.5) * 80, h: (x, y, w, h, s) => (vnoise(x * 0.9, y * 0.06, Math.max(1, Math.round(w * 0.9)), Math.max(1, Math.round(h * 0.06)), s + 5) - 0.5) * 140 },
  plate: { m: (x, y, w, h, s) => (vnoise(x * 0.04, y * 0.04, Math.max(1, Math.round(w * 0.04)), Math.max(1, Math.round(h * 0.04)), s) - 0.5) * 16 + (hash2(x | 0, y | 0, s) - 0.5) * 5, h: (x, y, w, h, s) => (hash2(x | 0, y | 0, s) - 0.5) * 5 },
};

// ---------------------------------------------------------------------------
// Atlas: shelf-packed swatches; painted lazily the first time its textures are requested.
// swatches: [{ name, w, h, paint(P, opts), opts }]
// ---------------------------------------------------------------------------
export class Atlas {
  constructor(name, swatches, o = {}) {
    this.name = name; this.pad = o.pad ?? 4; this.hs = o.hs ?? 0.5; this.W = o.width ?? 1024;
    this.sw = swatches; this.rects = new Map();
    // shelf pack (tallest first)
    const list = [...swatches].sort((a, b) => b.h - a.h || b.w - a.w);
    let x = 0, y = 0, shelfH = 0; const P = this.pad;
    for (const s of list) {
      const w = s.w + 2 * P, h = s.h + 2 * P;
      if (x + w > this.W) { x = 0; y += shelfH; shelfH = 0; }
      this.rects.set(s.name, { name: s.name, x: x + P, y: y + P, w: s.w, h: s.h, sw: s });
      x += w; shelfH = Math.max(shelfH, h);
    }
    this.H = Math.ceil((y + shelfH) / 32) * 32;
    this.tex = null;
  }
  // uv rect [u0,v0,u1,v1] of a swatch (flipY canvas textures: canvas top = v 1)
  uv(name, inset = 0.5) {
    const r = this.rects.get(name); if (!r) throw new Error(`atlas ${this.name}: no swatch ${name}`);
    return [(r.x + inset) / this.W, 1 - (r.y + r.h - inset) / this.H, (r.x + r.w - inset) / this.W, 1 - (r.y + inset) / this.H];
  }
  // sub-rect inside a swatch, in swatch-relative uv [0..1]
  sub(name, u0, v0, u1, v1) { const R = this.uv(name, 0); const du = R[2] - R[0], dv = R[3] - R[1]; return [R[0] + u0 * du, R[1] + v0 * dv, R[0] + u1 * du, R[1] + v1 * dv]; }
  textures() {
    if (this.tex) return this.tex;
    const t0 = performance.now();
    const [mc, mx] = makeCanvas(this.W, this.H); const hw = Math.ceil(this.W * this.hs), hh = Math.ceil(this.H * this.hs);
    const [hc, hx] = makeCanvas(hw, hh); const [oc, ox] = makeCanvas(hw, hh);
    this.mx = mx; this.hx = hx; this.ox = ox;
    mx.fillStyle = 'rgb(186,0,0)'; mx.fillRect(0, 0, this.W, this.H);
    hx.fillStyle = 'rgb(128,128,128)'; hx.fillRect(0, 0, hw, hh);
    ox.fillStyle = 'rgb(255,180,0)'; ox.fillRect(0, 0, hw, hh);
    this.prof = [];
    for (const r of this.rects.values()) {
      const t1 = performance.now();
      const P = new Painter(this, r).begin();
      try { r.sw.paint(P, r.sw.opts || {}); } finally { P.end(); }
      this.prof.push([r.name, performance.now() - t1]);
    }
    const t2 = performance.now();
    const tex = (c, srgb) => {
      const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; return t;
    };
    this.tex = { map: tex(mc, false), normal: tex(normalFromHeight(hc, this.nk ?? 1.3), false), orm: tex(oc, false) };
    this.prof.push(['normalmap', performance.now() - t2]);
    this.mx = this.hx = this.ox = null;
    this.ms = performance.now() - t0;
    return this.tex;
  }
}

// ---------------------------------------------------------------------------
// Material factory (one shared program for all of them)
// ---------------------------------------------------------------------------
const MAP_CHUNK = `#ifdef USE_MAP
  vec4 texS = texture2D( map, vMapUv );
  vec3 slotLo = mix( diffuse, uSlotB, texS.g );
  vec3 slotHi = mix( uSlotC, uSlotD, texS.g );
  diffuseColor.rgb = mix( slotLo, slotHi, texS.b ) * pow( texS.r * 1.371, 2.2 );
#endif`;
const RIM_CHUNK = `{
  float rim = pow( 1.0 - saturate( dot( normalize( normal ), normalize( vViewPosition ) ) ), uRimPow );
  outgoingLight += uRimColor * rim * uRimK;
}
`;
export function perpMaterial(atlas, o = {}) {
  const T = atlas.textures();
  const m = new THREE.MeshStandardMaterial({
    map: T.map, normalMap: T.normal, roughnessMap: T.orm, metalnessMap: T.orm, aoMap: T.orm, aoMapIntensity: o.aoK ?? 1,
    roughness: o.rough ?? 1, metalness: o.metal ?? 1, vertexColors: true, color: o.a ?? 0xffffff,
    emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissiveIntensity ?? 1, envMapIntensity: o.env ?? 1,
  });
  m.normalScale.set(o.normalK ?? 1, o.normalK ?? 1);
  const sB = new THREE.Color(o.b ?? 0xffffff), sC = new THREE.Color(o.c ?? 0xffffff), sD = new THREE.Color(o.d ?? 0xffffff);
  const rimC = new THREE.Color(o.rim ?? 0x8a9ac8);
  m.userData.slots = { b: sB, c: sC, d: sD };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSlotB = { value: sB }; sh.uniforms.uSlotC = { value: sC }; sh.uniforms.uSlotD = { value: sD };
    sh.uniforms.uRimColor = { value: rimC }; sh.uniforms.uRimPow = { value: o.rimPow ?? 3.2 }; sh.uniforms.uRimK = { value: o.rimK ?? 0.24 };
    sh.fragmentShader = 'uniform vec3 uSlotB; uniform vec3 uSlotC; uniform vec3 uSlotD; uniform vec3 uRimColor; uniform float uRimPow; uniform float uRimK;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', MAP_CHUNK)
      .replace('#include <opaque_fragment>', RIM_CHUNK + '#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'perp-slots-v1';
  return m;
}
export function setSlots(m, a, b, c, d) {
  if (a != null) m.color.set(a); const s = m.userData.slots;
  if (b != null) s.b.set(b); if (c != null) s.c.set(c); if (d != null) s.d.set(d);
}
