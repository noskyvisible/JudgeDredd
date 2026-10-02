import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
export const smooth = (t) => t * t * (3 - 2 * t);
export const saturate = (v) => clamp(v, 0, 1);
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;
export const deg = (d) => (d * Math.PI) / 180;

export function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export const lerpAngle = (a, b, t) => a + angDiff(a, b) * t;
export const dampAngle = (a, b, k, dt) => a + angDiff(a, b) * (1 - Math.exp(-k * dt));

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

export function canvasTex(c, { repeat = false, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// segment vs AABB (xz + y range). returns {t, nx, nz} or null
export function segAABB(ax, ay, az, bx, by, bz, box) {
  let tmin = 0, tmax = 1;
  const d = [bx - ax, by - ay, bz - az];
  const o = [ax, ay, az];
  const mn = [box.minX, 0, box.minZ];
  const mx = [box.maxX, box.h, box.maxZ];
  let nAxis = -1, nSign = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return null;
    } else {
      let t1 = (mn[i] - o[i]) / d[i], t2 = (mx[i] - o[i]) / d[i];
      let s = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
      if (t1 > tmin) { tmin = t1; nAxis = i; nSign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  if (nAxis < 0) return { t: 0, nx: 0, ny: 0, nz: 0, inside: true };
  return { t: tmin, nx: nAxis === 0 ? nSign : 0, ny: nAxis === 1 ? nSign : 0, nz: nAxis === 2 ? nSign : 0 };
}

export function segSphere(ax, ay, az, bx, by, bz, cx, cy, cz, r) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const fx = ax - cx, fy = ay - cy, fz = az - cz;
  const a = dx * dx + dy * dy + dz * dz;
  if (a < 1e-9) return null;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const c = fx * fx + fy * fy + fz * fz - r * r;
  let disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  disc = Math.sqrt(disc);
  let t = (-b - disc) / (2 * a);
  if (t < 0) t = (-b + disc) / (2 * a);
  if (t < 0 || t > 1) return c < 0 ? 0 : null;
  return t;
}

// Height canvas -> tangent-space normal map canvas (tileable, OpenGL +Y up)
export function normalFromHeight(Hc, strength = 2) {
  const W = Hc.width, Hh = Hc.height;
  const src = Hc.getContext('2d').getImageData(0, 0, W, Hh).data;
  const [N, nx] = makeCanvas(W, Hh); const out = nx.createImageData(W, Hh); const d = out.data;
  const H = new Float32Array(W * Hh); for (let i = 0; i < W * Hh; i++) H[i] = src[i * 4] / 255;
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const xm = (x - 1 + W) % W, xp = (x + 1) % W, ym = (y - 1 + Hh) % Hh, yp = (y + 1) % Hh;
    const dx = (H[y * W + xm] - H[y * W + xp]) * strength, dy = (H[yp * W + x] - H[ym * W + x]) * strength;
    const l = Math.hypot(dx, dy, 1); const i = (y * W + x) * 4;
    d[i] = (dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  nx.putImageData(out, 0, 0); return N;
}
