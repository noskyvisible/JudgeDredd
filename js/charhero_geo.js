import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// ===========================================================================
// Hard-surface / anatomy toolkit for the hero model (charhero.js) and his weapons (props.js).
//
//   Surf      a smooth body surface described by keyframed super-ellipse cross-sections along the
//             local Y axis (+ an optional radial sculpt function).  Evaluated at (angle a, height y):
//             a = 0 faces +Z (front), a = +PI/2 faces +X (the character's left).
//   loftGeo   skins a Surf (or an offset of it) into a grid mesh, optional dome caps / open arcs
//   plateGeo  an armour plate conformed to a Surf: any 2D outline, real thickness, rounded bevel,
//             optional crown and a closed (two-sided) half-round rim
//   bandGeo   a strap / belt / rib wrapped around a Surf with a rounded profile
//   sweepGeo  a 2D profile swept along a 3D path with parallel-transport frames and taper
//   driven    helper joints that follow a fraction of another joint's rotation (pauldrons, couters,
//             knee cops) so armour stays attached through extreme poses without visible ball joints
// Everything returns indexed BufferGeometry with position / normal / uv (uv in metres -> tiling maps).
// ===========================================================================

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const gauss = (x, c, w) => Math.exp(-((x - c) * (x - c)) / (w * w));
export const wrapA = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
export const lin = (a, b, n) => { const o = []; for (let i = 0; i < n; i++) o.push(a + (b - a) * (n === 1 ? 0 : i / (n - 1))); return o; };
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// monotone cubic interpolation (Fritsch-Carlson): smooth, never overshoots the keys
export function mono(xs, ys) {
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] > x) hi = mid; else lo = mid; }
    const h = xs[hi] - xs[lo], t = (x - xs[lo]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h * m[lo] + (-2 * t3 + 3 * t2) * ys[hi] + (t3 - t2) * h * m[hi];
  };
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3();

export class Surf {
  // secs: [{ y, rx, rz, cx, cz, e }]   e = super-ellipse exponent (2 = ellipse, >2 boxier, <2 diamond)
  // opts.mod(a, y, x, z) -> radial offset in metres (sculpting: muscles, grooves, recesses)
  constructor(secs, opts = {}) {
    const s = [...secs].sort((p, q) => p.y - q.y), ys = s.map((k) => k.y);
    const F = (vals) => mono(ys, vals);
    this.frx = F(s.map((q) => q.rx)); this.frz = F(s.map((q) => (q.rz !== undefined ? q.rz : q.rx)));
    this.fcx = F(s.map((q) => q.cx || 0)); this.fcz = F(s.map((q) => q.cz || 0)); this.fe = F(s.map((q) => (q.e !== undefined ? q.e : opts.e || 2)));
    this.mod = opts.mod || null; this.y0 = ys[0]; this.y1 = ys[ys.length - 1];
    this.cache = new Map();
  }
  sec(y) {
    let c = this.cache.get(y);
    if (!c) { c = [this.fcx(y), this.fcz(y), Math.max(0, this.frx(y)), Math.max(0, this.frz(y)), 2 / this.fe(y)]; if (this.cache.size > 96) this.cache.clear(); this.cache.set(y, c); }
    return c;
  }
  pos(a, y, out = new THREE.Vector3()) {
    const c = this.sec(y), s = Math.sin(a), co = Math.cos(a), p = c[4];
    let x = c[2] * (s < 0 ? -1 : 1) * Math.pow(Math.abs(s), p), z = c[3] * (co < 0 ? -1 : 1) * Math.pow(Math.abs(co), p);
    if (this.mod) { const r = Math.hypot(x, z); if (r > 1e-9) { const k = 1 + this.mod(a, y, x, z) / r; x *= k; z *= k; } }
    return out.set(c[0] + x, y, c[1] + z);
  }
  nrm(a, y, out = new THREE.Vector3()) {
    const e = 1.5e-3;
    this.pos(a + e, y, _a); this.pos(a - e, y, _b); _a.sub(_b);
    this.pos(a, y + e, _c); this.pos(a, y - e, _d); _c.sub(_d);
    out.crossVectors(_a, _c);
    const l = out.length();
    if (l < 1e-12) { this.pos(a, y, _a); const c = this.sec(y); out.set(_a.x - c[0], 0, _a.z - c[1]); if (out.lengthSq() < 1e-12) out.set(0, 1, 0); return out.normalize(); }
    return out.divideScalar(l);
  }
  at(a, y, h = 0, out = new THREE.Vector3()) { this.pos(a, y, out); if (h) out.addScaledVector(this.nrm(a, y, _n), h); return out; }
  // local metric (metres per radian / per unit y) at (a, y)
  metric(a, y) {
    const e = 1e-3;
    this.pos(a + e, y, _a); this.pos(a - e, y, _b); const ra = _a.distanceTo(_b) / (2 * e);
    this.pos(a, y + e, _a); this.pos(a, y - e, _b); const ry = _a.distanceTo(_b) / (2 * e);
    return [Math.max(ra, 1e-4), Math.max(ry, 1e-4)];
  }
}

// ---------- grid -> geometry ----------
// rows: array of arrays of Vector3 (each row same length). wrapU: rows are closed loops (last column == first)
// colour attribute convention for the hero: r = ambient occlusion (1 = open), g = edge-wear mask, b unused
export function gridGeo(rows, { wrapU = false, uvs = null, flip = false, shade = null, cavity = 0 } = {}) {
  const R = rows.length, C = rows[0].length;
  const pos = new Float32Array(R * C * 3), nor = new Float32Array(R * C * 3), uv = new Float32Array(R * C * 2), col = new Float32Array(R * C * 3);
  const avg = new THREE.Vector3();
  const du = new THREE.Vector3(), dv = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
    const k = i * C + j, p = rows[i][j];
    pos[k * 3] = p.x; pos[k * 3 + 1] = p.y; pos[k * 3 + 2] = p.z;
    let jm = j - 1, jp = j + 1;
    if (wrapU) { if (jm < 0) jm = C - 2; if (jp > C - 1) jp = 1; } else { jm = Math.max(0, jm); jp = Math.min(C - 1, jp); }
    du.subVectors(rows[i][jp], rows[i][jm]);
    dv.subVectors(rows[Math.min(R - 1, i + 1)][j], rows[Math.max(0, i - 1)][j]);
    n.crossVectors(du, dv);
    if (n.lengthSq() < 1e-16) {
      // pole: average the neighbouring row's directions
      const ii = i === 0 ? 1 : i - 1; const q = rows[ii]; let cx = 0, cy = 0, cz = 0;
      for (const v of q) { cx += v.x; cy += v.y; cz += v.z; } cx /= q.length; cy /= q.length; cz /= q.length;
      n.set(p.x - cx, p.y - cy, p.z - cz);
      if (n.lengthSq() < 1e-16) n.set(0, i === 0 ? -1 : 1, 0);
    }
    n.normalize(); if (flip) n.negate();
    nor[k * 3] = n.x; nor[k * 3 + 1] = n.y; nor[k * 3 + 2] = n.z;
    if (uvs) { uv[k * 2] = uvs[i][j][0]; uv[k * 2 + 1] = uvs[i][j][1]; }
    let ao = 1, ed = 0;
    if (shade) { const sv = shade(i, j); ao = sv[0]; ed = sv[1]; }
    if (cavity && i > 0 && i < R - 1 && (wrapU || (j > 0 && j < C - 1))) {
      // mean curvature from the 4-neighbourhood: k = 2 (P - avg).n / e^2  (1/m; + convex, - concave)
      const a1 = rows[i][jm], a2 = rows[i][jp], b1 = rows[i - 1][j], b2 = rows[i + 1][j];
      avg.set(0, 0, 0).add(a1).add(a2).add(b1).add(b2).multiplyScalar(0.25);
      const e2 = (p.distanceToSquared(a1) + p.distanceToSquared(a2) + p.distanceToSquared(b1) + p.distanceToSquared(b2)) / 4;
      const kc = (2 * ((p.x - avg.x) * n.x + (p.y - avg.y) * n.y + (p.z - avg.z) * n.z)) / Math.max(1e-8, e2);
      ao *= clamp(1 + cavity * 0.004 * Math.min(0, kc), 0.45, 1);
      ed = Math.max(ed, clamp((kc - 45) / 140, 0, 1) * cavity);
    }
    col[k * 3] = ao; col[k * 3 + 1] = ed;
  }
  const idx = [];
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < C - 1; j++) {
    const a = i * C + j, b = a + 1, c = a + C, d = c + 1;
    if (!flip) idx.push(a, b, d, a, d, c); else idx.push(a, d, b, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// arc-length based UVs for a grid (u around the rows, v along the columns), in metres
export function gridUV(rows, scale = 1) {
  const R = rows.length, C = rows[0].length, out = [];
  // v: average arc length down the columns
  const vAcc = new Float64Array(C);
  for (let i = 0; i < R; i++) {
    const row = [], r = rows[i];
    let u = 0;
    for (let j = 0; j < C; j++) {
      if (j > 0) u += r[j].distanceTo(r[j - 1]);
      if (i > 0) vAcc[j] += r[j].distanceTo(rows[i - 1][j]);
      row.push([u * scale, vAcc[j] * scale]);
    }
    out.push(row);
  }
  return out;
}

// Skin a surface.  o: { ys | (y0,y1,ny), na, a0, a1 | arc(y)->[a0,a1], h (number | fn(a,y)), cap0, cap1 (dome depth), uvScale, flip }
export function loftGeo(surf, o = {}) {
  const ys = o.ys || lin(o.y0 ?? surf.y0, o.y1 ?? surf.y1, o.ny ?? 16);
  const na = o.na ?? 32;
  const hf = typeof o.h === 'function' ? o.h : null, hc = typeof o.h === 'number' ? o.h : 0;
  let closed = true;
  const rows = [];
  const n = new THREE.Vector3();
  for (const y of ys) {
    const [a0, a1] = o.arc ? o.arc(y) : [o.a0 ?? 0, o.a1 ?? TAU];
    if (Math.abs(a1 - a0 - TAU) > 1e-6) closed = false;
    const row = [];
    for (let j = 0; j <= na; j++) {
      const a = a0 + (a1 - a0) * j / na;
      const v = surf.pos(a, y);
      const h = hf ? hf(a, y) : hc;
      if (h) { surf.nrm(a, y, n); v.addScaledVector(n, h); }
      row.push(v);
    }
    rows.push(row);
  }
  // dome caps: extra rings shrinking to the axis with a quarter-ellipse profile
  const cap = (row, depth, dir, k) => {
    const c = new THREE.Vector3(); for (let j = 0; j < row.length - (closed ? 1 : 0); j++) c.add(row[j]); c.divideScalar(row.length - (closed ? 1 : 0));
    const out = [];
    for (let s = 1; s <= k; s++) {
      const t = (s / k) * Math.PI / 2, cs = Math.cos(t), sn = Math.sin(t);
      out.push(row.map((p) => new THREE.Vector3(c.x + (p.x - c.x) * cs, c.y + (p.y - c.y) * cs + dir * depth * sn, c.z + (p.z - c.z) * cs)));
    }
    return out;
  };
  if (o.cap0 !== undefined) rows.unshift(...cap(rows[0], o.cap0, -1, o.capSeg ?? 4).reverse());
  if (o.cap1 !== undefined) rows.push(...cap(rows[rows.length - 1], o.cap1, 1, o.capSeg ?? 4));
  let uvs = null;
  if (o.uvFn) {
    uvs = []; for (const y of ys) { const [a0, a1] = o.arc ? o.arc(y) : [o.a0 ?? 0, o.a1 ?? TAU]; const r = []; for (let j = 0; j <= na; j++) r.push(o.uvFn(a0 + (a1 - a0) * j / na, y)); uvs.push(r); }
    while (uvs.length < rows.length) { if (o.cap0 !== undefined && uvs.length < rows.length) uvs.unshift(uvs[0]); if (o.cap1 !== undefined && uvs.length < rows.length) uvs.push(uvs[uvs.length - 1]); }
  }
  return gridGeo(rows, { wrapU: closed, uvs: uvs || gridUV(rows, o.uvScale ?? 1), flip: !!o.flip, cavity: o.cavity ?? 1 });
}

// skin a surface between two boundary curves ylo(a) .. yhi(a) (rows follow the boundaries exactly)
export function loftBetween(surf, ylo, yhi, o = {}) {
  const na = o.na ?? 48, ns = o.ns ?? 12, a0 = o.a0 ?? 0, a1 = o.a1 ?? TAU;
  const closed = Math.abs(a1 - a0 - TAU) < 1e-6, sd = o.sDist || ((s) => s);
  const rows = [], n = new THREE.Vector3();
  for (let i = 0; i <= ns; i++) {
    const s = sd(i / ns), row = [];
    for (let j = 0; j <= na; j++) {
      const a = a0 + (a1 - a0) * j / na, y0 = ylo(a), y1 = yhi(a), y = y0 + (y1 - y0) * s;
      const v = surf.pos(a, y);
      const h = typeof o.h === 'function' ? o.h(a, y, s) : o.h || 0;
      if (h) { surf.nrm(a, y, n); v.addScaledVector(n, h); }
      row.push(v);
    }
    rows.push(row);
  }
  return gridGeo(rows, { wrapU: closed, uvs: gridUV(rows, o.uvScale ?? 1), flip: !!o.flip, cavity: o.cavity ?? 1 });
}

// plate from an outline given in absolute surface coordinates [[a, y], ...] (optionally smoothed through the points)
export function plateAY(surf, ay, o = {}) {
  let ca = 0, cy = 0; for (const [a, y] of ay) { ca += a; cy += y; } ca /= ay.length; cy /= ay.length;
  if (o.c) [ca, cy] = o.c;
  const [Ra, Ry] = surf.metric(ca, cy);
  let shape = ay.map(([a, y]) => [(a - ca) * Ra, (y - cy) * Ry]);
  if (o.smooth) shape = smoothPoly(shape, o.n ?? 48);
  if (o.round) shape = roundPoly(shape, o.round, 4);
  return plateGeo(surf, shape, { ...o, center: [ca, cy], metric: [Ra, Ry] });
}

// round tube following a curve of surface points [[a, y], ...] at lift h
export function rimGeo(surf, ay, r, h = 0, o = {}) {
  const pts = ay.map(([a, y]) => surf.at(a, y, h));
  const prof = ellipse(r * (o.sx ?? 1), r * (o.sy ?? 1), o.seg ?? 8);
  return sweepGeo(pts, prof, { closed: !!o.closed, up: o.up, scale: o.scale, caps: o.caps });
}

// mirror across the YZ plane (x -> -x) keeping outward winding
export function mirrorX(g) {
  const p = g.attributes.position, nn = g.attributes.normal;
  for (let i = 0; i < p.count; i++) { p.setX(i, -p.getX(i)); if (nn) nn.setX(i, -nn.getX(i)); }
  if (g.index) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.index.needsUpdate = true; }
  p.needsUpdate = true; if (nn) nn.needsUpdate = true;
  return g;
}

// ---------- 2D polygon helpers (metres) ----------
export function polyArea(p) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
export function resample(p, N) {
  const L = [0]; for (let i = 1; i <= p.length; i++) { const a = p[i - 1], b = p[i % p.length]; L.push(L[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const tot = L[L.length - 1], out = [];
  let k = 0;
  for (let i = 0; i < N; i++) {
    const s = (i / N) * tot;
    while (k < p.length - 1 && L[k + 1] < s) k++;
    const a = p[k], b = p[(k + 1) % p.length], t = (s - L[k]) / Math.max(1e-9, L[k + 1] - L[k]);
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}
export function insetPoly(pts, d) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    let e1x = p1[0] - p0[0], e1y = p1[1] - p0[1]; const l1 = Math.hypot(e1x, e1y) || 1; e1x /= l1; e1y /= l1;
    let e2x = p2[0] - p1[0], e2y = p2[1] - p1[1]; const l2 = Math.hypot(e2x, e2y) || 1; e2x /= l2; e2y /= l2;
    const n1x = -e1y, n1y = e1x, n2x = -e2y, n2y = e2x;
    let mx = n1x + n2x, my = n1y + n2y; const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;
    const k = d / Math.max(0.4, mx * n1x + my * n1y);
    out.push([p1[0] + mx * k, p1[1] + my * k]);
  }
  return out;
}
// rounded rectangle (CCW), centred
export function rrect(w, h, r, nc = 5) {
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4);
  const out = [], cs = [[w / 2 - r, -h / 2 + r, -Math.PI / 2], [w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, Math.PI / 2], [-w / 2 + r, -h / 2 + r, Math.PI]];
  for (const [cx, cy, a0] of cs) for (let i = 0; i <= nc; i++) { const a = a0 + (i / nc) * Math.PI / 2; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return out;
}
export function ellipse(rx, ry, n = 24, e = 2) {
  const out = [], p = 2 / e;
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU, c = Math.cos(a), s = Math.sin(a); out.push([rx * Math.sign(c) * Math.pow(Math.abs(c), p), ry * Math.sign(s) * Math.pow(Math.abs(s), p)]); }
  return out;
}
// round the corners of a polygon given as points (CCW); r = radius (number or per-vertex array)
export function roundPoly(pts, r, nc = 4) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const rr = Array.isArray(r) ? r[i] : r;
    const ax = p0[0] - p1[0], ay = p0[1] - p1[1], bx = p2[0] - p1[0], by = p2[1] - p1[1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (rr <= 0 || la < 1e-6 || lb < 1e-6) { out.push(p1); continue; }
    const d = Math.min(rr, la * 0.45, lb * 0.45);
    const s = [p1[0] + ax / la * d, p1[1] + ay / la * d], e = [p1[0] + bx / lb * d, p1[1] + by / lb * d];
    for (let k = 0; k <= nc; k++) { // quadratic bezier through the corner
      const t = k / nc, u = 1 - t;
      out.push([u * u * s[0] + 2 * u * t * p1[0] + t * t * e[0], u * u * s[1] + 2 * u * t * p1[1] + t * t * e[1]]);
    }
  }
  return out;
}
// smooth closed curve through control points (centripetal Catmull-Rom), n samples
export function smoothPoly(ctrl, n = 48) {
  const c = new THREE.CatmullRomCurve3(ctrl.map(([x, y]) => new THREE.Vector3(x, y, 0)), true, 'centripetal');
  return c.getSpacedPoints(n).slice(0, n).map((v) => [v.x, v.y]);
}

// ---------- armour plate conformed to a surface ----------
// shape: CCW outline in metres around `center` = [a, y] on the surface (x along +a, y along +y)
// o: { t thickness, bevel, h0 lift off the surface, crown, closed (two-sided half-round rim), n outline samples,
//      nB bevel rings, nI interior rings, sink (skirt depth into the surface), uv: 'm' | 'box', uvScale, hfn(a,y)->extra lift }
export function plateGeo(surf, shape, o = {}) {
  const [ca, cy] = o.center || [0, 0];
  const t = o.t ?? 0.02, h0 = o.h0 ?? 0, crown = o.crown ?? 0, closed = !!o.closed;
  const nB = o.nB ?? 3, nI = o.nI ?? 4, N = o.n ?? 48, sink = o.sink ?? 0.006;
  const [Ra, Ry] = o.metric || surf.metric(ca, cy);
  let pts = o.noResample ? shape.slice() : resample(shape, N);
  if (polyArea(pts) < 0) pts.reverse();
  const Np = pts.length;
  let gx = 0, gy = 0; for (const p of pts) { gx += p[0]; gy += p[1]; } gx /= Np; gy /= Np;
  if (o.pivot) { gx = o.pivot[0]; gy = o.pivot[1]; }
  // rings: [poly, height, kind]
  const rings = [];
  const scaleRing = (poly, s) => poly.map(([x, y]) => [gx + (x - gx) * s, gy + (y - gy) * s]);
  const r = closed ? t / 2 : Math.min(o.bevel ?? t * 0.6, t * 0.98);
  const inner = insetPoly(pts, r);
  const dome = (s) => crown * (1 - s * s);
  // each ring: [polygon, lift, ambient occlusion, edge-wear]
  if (closed) {
    const hb = h0, ht = h0 + t, hc = h0 + t / 2;
    rings.push([[[gx, gy]], hb - dome(0) * 0.3, 0.55, 0]);
    for (let j = 1; j < nI; j++) { const s = j / nI; rings.push([scaleRing(inner, s), hb - dome(s) * 0.3, 0.55, 0]); }
    for (let k = 0; k <= 2 * nB; k++) { const th = -Math.PI / 2 + (k / (2 * nB)) * Math.PI; rings.push([insetPoly(pts, r * (1 - Math.cos(th))), hc + r * Math.sin(th), 0.55 + 0.45 * (th / Math.PI + 0.5), Math.cos(th) * 0.9]); }
    for (let j = nI - 1; j >= 1; j--) { const s = j / nI; rings.push([scaleRing(inner, s), ht + dome(s), 1, 0]); }
    rings.push([[[gx, gy]], ht + dome(0), 1, 0]);
  } else {
    rings.push([pts, h0 - sink, 0.3, 0]);
    for (let k = 0; k <= nB; k++) { const th = (k / nB) * Math.PI / 2; rings.push([insetPoly(pts, r * (1 - Math.cos(th))), h0 + t - r + r * Math.sin(th), 0.62 + 0.38 * Math.sin(th), 0.35 + 0.65 * Math.sin(2 * th) * (k < nB ? 1 : 0.5)]); }
    for (let j = nI - 1; j >= 1; j--) { const s = j / nI; rings.push([scaleRing(inner, s), h0 + t + dome(s), 1, 0]); }
    rings.push([[[gx, gy]], h0 + t + dome(0), 1, 0]);
  }
  // to 3D
  const P = [], UV = [], SH = [], nrm = new THREE.Vector3();
  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
  for (const [x, y] of pts) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
  const us = o.uvScale ?? 1;
  const ringStart = [];
  for (const [poly, h, rao, red] of rings) {
    ringStart.push(P.length);
    for (const [x, y] of poly) {
      SH.push(rao, red);
      const a = ca + x / Ra, yy = cy + y / Ry;
      const v = surf.pos(a, yy); surf.nrm(a, yy, nrm);
      const hh = h + (o.hfn ? o.hfn(a, yy, x, y) : 0);
      v.addScaledVector(nrm, hh);
      P.push(v);
      if (o.uv === 'box') UV.push([(x - bx0) / (bx1 - bx0), (y - by0) / (by1 - by0)]); else UV.push([x * us + (o.uvOff ? o.uvOff[0] : 0), y * us + (o.uvOff ? o.uvOff[1] : 0)]);
    }
  }
  const idx = [];
  for (let k = 0; k < rings.length - 1; k++) {
    const A = ringStart[k], B = ringStart[k + 1], na = rings[k][0].length, nb = rings[k + 1][0].length;
    if (na === 1) { for (let i = 0; i < nb; i++) idx.push(A, B + ((i + 1) % nb), B + i); }
    else if (nb === 1) { for (let i = 0; i < na; i++) idx.push(A + i, A + ((i + 1) % na), B); }
    else for (let i = 0; i < na; i++) { const i2 = (i + 1) % na; idx.push(A + i, A + i2, B + i2, A + i, B + i2, B + i); }
  }
  const g = toGeo(P, UV, idx, SH);
  // orient so the front faces along the surface normal
  orientTo(g, surf.nrm(ca + gx / Ra, cy + gy / Ry), ringStart[rings.length - 1]);
  g.computeVertexNormals();
  return g;
}

function toGeo(P, UV, idx, SH = null) {
  const pos = new Float32Array(P.length * 3), uv = new Float32Array(P.length * 2), col = new Float32Array(P.length * 3);
  P.forEach((p, i) => { pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z; uv[i * 2] = UV[i][0]; uv[i * 2 + 1] = UV[i][1]; col[i * 3] = SH ? SH[i * 2] : 1; col[i * 3 + 1] = SH ? SH[i * 2 + 1] : 0; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}
// flip the winding if the triangle around vertex `vi` faces away from `dir`
function orientTo(g, dir, vi) {
  const idx = g.index.array, pos = g.attributes.position;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), acc = new THREE.Vector3();
  for (let i = 0; i < idx.length; i += 3) {
    if (idx[i] !== vi && idx[i + 1] !== vi && idx[i + 2] !== vi) continue;
    a.fromBufferAttribute(pos, idx[i]); b.fromBufferAttribute(pos, idx[i + 1]); c.fromBufferAttribute(pos, idx[i + 2]);
    n.crossVectors(b.sub(a), c.sub(a)); acc.add(n);
  }
  if (acc.dot(dir) < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.index.needsUpdate = true; }
}

// ---------- band (strap / belt / rib) wrapped around a surface ----------
// profile across the band: rounded rectangle of height (y1-y0) and thickness t. o: { a0, a1 (open arc ends get capped by closing the profile), na, r edge radius, h0, sink, hfn }
export function bandGeo(surf, y0, y1, o = {}) {
  const t = o.t ?? 0.02, h0 = o.h0 ?? 0, sink = o.sink ?? 0.004, na = o.na ?? 48, nc = o.nc ?? 3;
  const a0 = o.a0 ?? 0, a1 = o.a1 ?? TAU, closed = Math.abs(a1 - a0 - TAU) < 1e-6;
  const Y0 = typeof y0 === 'function' ? y0 : () => y0, Y1 = typeof y1 === 'function' ? y1 : () => y1;
  // profile across the band, parametric in s: list of [s (0 bottom .. 1 top edge), h, isTopEdge]
  // built per column because the edge heights may vary with the angle
  const rows = [], n = new THREE.Vector3();
  const profAt = (ya, yb, k1) => {
    const tt = t * k1, bb = (o.bulge || 0) * k1;
    const r = Math.max(1e-5, Math.min(o.r ?? tt * 0.5, tt * 0.98, (yb - ya) * 0.48)), prof = [[ya, h0 - sink, 0.3, 0]];
    for (let k = 0; k <= nc; k++) { const th = (k / nc) * Math.PI / 2; prof.push([ya + r - Math.cos(th) * r, h0 + tt - r + Math.sin(th) * r, 0.6 + 0.4 * Math.sin(th), Math.sin(2 * th) * 0.8 + 0.2]); }
    if (o.bulge) { const m = o.bulgeSeg ?? 3; for (let k = 1; k < m; k++) { const s = k / m; prof.push([ya + r + (yb - ya - 2 * r) * s, h0 + tt + bb * Math.sin(Math.PI * s), 1, 0]); } }
    for (let k = 0; k <= nc; k++) { const th = Math.PI / 2 + (k / nc) * Math.PI / 2; prof.push([yb - r - Math.cos(th) * r, h0 + tt - r + Math.sin(th) * r, 0.6 + 0.4 * Math.sin(th), Math.abs(Math.sin(2 * th)) * 0.8 + 0.2]); }
    prof.push([yb, h0 - sink, 0.3, 0]);
    return prof;
  };
  const cols = [];
  for (let j = 0; j <= na; j++) { const a = a0 + (a1 - a0) * j / na; cols.push([a, profAt(Y0(a), Y1(a), o.tscale ? Math.max(0.02, o.tscale(a)) : 1)]); }
  const np = cols[0][1].length;
  for (let pi = 0; pi < np; pi++) {
    const row = [];
    for (let j = 0; j <= na; j++) {
      const [a, prof] = cols[j], [y, h] = prof[pi];
      const v = surf.pos(a, y); surf.nrm(a, y, n);
      v.addScaledVector(n, h + (o.hfn ? o.hfn(a, y) : 0));
      row.push(v);
    }
    rows.push(row);
  }
  // rows run bottom->top (+y), columns run +a: same orientation as loftGeo -> outward normals
  const g = gridGeo(rows, { wrapU: closed, uvs: gridUV(rows, o.uvScale ?? 1), shade: (i, j) => [cols[j][1][i][2], cols[j][1][i][3]] });
  return g;
}

// ---------- sweep a 2D profile along a 3D path ----------
// path: Vector3[]; profile: [[x,y]] closed CCW (x along frame normal N, y along binormal B)
// o: { scale: number | fn(t)->number|[sx,sy], up: Vector3 hint for the first frame, caps: bool, closed: bool path loop, twist: fn(t)->rad }
export function sweepGeo(path, profile, o = {}) {
  const n = path.length, closedPath = !!o.closed;
  const T = [], N = [], B = [];
  for (let i = 0; i < n; i++) {
    const p = path[Math.max(0, i - 1)], q = path[Math.min(n - 1, i + 1)];
    const t = closedPath ? path[(i + 1) % n].clone().sub(path[(i - 1 + n) % n]) : q.clone().sub(p);
    T.push(t.normalize());
  }
  const up = (o.up || new THREE.Vector3(0, 1, 0)).clone();
  let nn = up.clone().sub(T[0].clone().multiplyScalar(up.dot(T[0])));
  if (nn.lengthSq() < 1e-8) nn = new THREE.Vector3(1, 0, 0).sub(T[0].clone().multiplyScalar(T[0].x));
  nn.normalize();
  for (let i = 0; i < n; i++) {
    if (i > 0) { // parallel transport
      const ax = new THREE.Vector3().crossVectors(T[i - 1], T[i]);
      const s = ax.length();
      if (s > 1e-8) { ax.divideScalar(s); const ang = Math.atan2(s, T[i - 1].dot(T[i])); nn.applyAxisAngle(ax, ang); }
      nn.sub(T[i].clone().multiplyScalar(nn.dot(T[i]))).normalize();
    }
    N.push(nn.clone()); B.push(new THREE.Vector3().crossVectors(T[i], nn).normalize());
  }
  const prof = profile.slice(); if (polyArea(prof) < 0) prof.reverse();
  const rows = [];
  for (let i = 0; i < n; i++) {
    const tt = n === 1 ? 0 : i / (n - 1);
    let sc = typeof o.scale === 'function' ? o.scale(tt) : o.scale ?? 1;
    const sx = Array.isArray(sc) ? sc[0] : sc, sy = Array.isArray(sc) ? sc[1] : sc;
    const tw = o.twist ? o.twist(tt) : 0, ct = Math.cos(tw), st = Math.sin(tw);
    const row = [];
    for (let k = 0; k <= prof.length; k++) {
      const [px0, py0] = prof[k % prof.length];
      const px = (px0 * ct - py0 * st) * sx, py = (px0 * st + py0 * ct) * sy;
      row.push(path[i].clone().addScaledVector(N[i], px).addScaledVector(B[i], py));
    }
    rows.push(row);
  }
  // rows along the path, columns around the (CCW) profile: du x dv = B x T = N -> outward, no flip
  const g = gridGeo(rows, { wrapU: true, uvs: gridUV(rows, o.uvScale ?? 1) });
  if (o.caps === false || closedPath) return g;
  // flat caps (triangulated profile)
  const tri = THREE.ShapeUtils.triangulateShape(prof.map(([x, y]) => new THREE.Vector2(x, y)), []);
  const parts = [g];
  for (const end of [0, n - 1]) {
    const row = rows[end], P = [], UV = [], idx = [];
    for (let k = 0; k < prof.length; k++) { P.push(row[k]); UV.push([prof[k][0], prof[k][1]]); }
    for (const [a, b, c] of tri) { if (end === 0) idx.push(a, c, b); else idx.push(a, b, c); }
    const cg = toGeo(P, UV, idx); cg.computeVertexNormals(); parts.push(cg);
  }
  return mergeGeos(parts);
}

// ---------- misc geometry ----------
export function mergeGeos(list) {
  // indexed merge (all inputs indexed with position/normal/uv)
  let nv = 0, ni = 0;
  for (const g of list) { if (!g.index) { const c = g.attributes.position.count, ix = []; for (let i = 0; i < c; i++) ix.push(i); g.setIndex(ix); } nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3), idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, ov * 3);
    if (!g.attributes.normal) g.computeVertexNormals();
    nor.set(g.attributes.normal.array, ov * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, ov * 2);
    if (g.attributes.color) col.set(g.attributes.color.array, ov * 3); else for (let i = 0; i < c; i++) col[(ov + i) * 3] = 1;
    const ia = g.index.array; for (let i = 0; i < ia.length; i++) idx[oi + i] = ia[i] + ov;
    ov += c; oi += ia.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
// matrix that maps +Y to `up` and +Z toward `fwd` (orthogonalised), at `pos`
const _m = new THREE.Matrix4();
export function frame(pos, up, fwd, scale = 1) {
  const y = up.clone().normalize();
  let z = fwd ? fwd.clone().sub(y.clone().multiplyScalar(fwd.dot(y))) : new THREE.Vector3(0, 0, 1).sub(y.clone().multiplyScalar(y.z));
  if (z.lengthSq() < 1e-8) z = new THREE.Vector3(1, 0, 0).sub(y.clone().multiplyScalar(y.x));
  z.normalize(); const x = new THREE.Vector3().crossVectors(y, z);
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  if (scale !== 1) m.multiply(new THREE.Matrix4().makeScale(...(Array.isArray(scale) ? scale : [scale, scale, scale])));
  m.setPosition(pos);
  return m;
}
export function xf(geo, m) { geo.applyMatrix4(m); return geo; }
export function T(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  geo.applyMatrix4(_m); return geo;
}
// generic vertex deformation + smooth normals (merges coincident vertices first)
export function deform(geo, fn, { smooth = true } = {}) {
  let g = geo;
  if (smooth) {
    g = geo.index ? geo.toNonIndexed() : geo.clone(); g.clearGroups();
    for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
    g = mergeVertices(g, 1e-5); planarUV(g);
  }
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); fn(v, i); p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals();
  return g;
}
export function smoothGeo(geo) { return deform(geo, () => {}); }
export function planarUV(g, axis = 'z', s = 1) {
  const p = g.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (axis === 'z') { uv[i * 2] = x * s; uv[i * 2 + 1] = y * s; } else if (axis === 'x') { uv[i * 2] = z * s; uv[i * 2 + 1] = y * s; } else { uv[i * 2] = x * s; uv[i * 2 + 1] = z * s; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
// extruded 2D outline (beveled) -> smooth-shaded indexed geometry, centred on z = 0
export function extrudeGeo(pts, depth, { bevel = 0.004, seg = 2, curveSegments = 8 } = {}) {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: seg, curveSegments, steps: 1 });
  g.translate(0, 0, -depth / 2);
  const out = smoothGeo(g); planarUV(out);
  return out;
}

// hemisphere rivet / bolt head (+Y up)
export function rivetGeo(r = 0.008, h = 0.6, seg = 7) { const g = new THREE.SphereGeometry(r, seg, 3, 0, TAU, 0, Math.PI / 2); g.scale(1, h, 1); return g; }

// a driven helper joint: each matrix update calls fn(group) first (e.g. copy a fraction of another joint's rotation)
const _umw = THREE.Object3D.prototype.updateMatrixWorld, _uwm = THREE.Object3D.prototype.updateWorldMatrix;
export function driven(parent, fn, name) {
  const g = new THREE.Group(); g.name = name || 'drv'; parent.add(g);
  g.updateMatrixWorld = function (force) { fn(this); _umw.call(this, force); };
  g.updateWorldMatrix = function (up, down) { fn(this); _uwm.call(this, up, down); };
  fn(g);
  return g;
}

// chain of interlocking oval links along a polyline path -> merged geometry
export function chainGeo(path, { link = 0.022, wire = 0.0055, tube = 5, rad = 10, gap = 0.75 } = {}) {
  const curve = new THREE.CatmullRomCurve3(path, false, 'centripetal');
  const L = curve.getLength(), step = link * 2 * gap, n = Math.max(2, Math.floor(L / step));
  const base = new THREE.TorusGeometry(link, wire, tube, rad); base.scale(1.45, 1, 1);
  const parts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, p = curve.getPointAt(u), t = curve.getTangentAt(u);
    const g = base.clone();
    if (i % 2) g.rotateX(Math.PI / 2);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), t);
    g.applyQuaternion(q); g.translate(p.x, p.y, p.z);
    parts.push(g);
  }
  return mergeGeos(parts);
}

// Same strategy as charkit.bake (one merged mesh per material per joint) but keeps the (ao, edge) colour attribute.
export function bakeHero(group) {
  const buckets = new Map();
  for (const child of [...group.children]) {
    if (!child.isMesh || child.userData.noBake) continue;
    child.updateMatrix();
    const g = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
    g.applyMatrix4(child.matrix);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    const n = g.attributes.position.count;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (!g.attributes.color) { const c = new Float32Array(n * 3); for (let i = 0; i < n; i++) c[i * 3] = 1; g.setAttribute('color', new THREE.BufferAttribute(c, 3)); }
    if (!buckets.has(child.material)) buckets.set(child.material, []);
    buckets.get(child.material).push(g);
    group.remove(child); child.geometry.dispose();
  }
  for (const [m, arr] of buckets) {
    const mesh = new THREE.Mesh(mergeIndexless(arr), m); mesh.castShadow = true; group.add(mesh);
  }
}
function mergeIndexless(arr) {
  let n = 0; for (const g of arr) n += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2], ['color', 3]]) {
    const a = new Float32Array(n * size); let o = 0;
    for (const g of arr) { a.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(a, size));
  }
  return out;
}
// Multiply baked AO (colour.r) by the occlusion of analytic sphere proxies, evaluated in the rest pose.
// proxies: [{ c: Vector3 (rig space), r, skip: Set of labels it must not darken }]; label(mesh) -> label of the mesh's joint
export function proxyOcclusion(root, meshes, proxies, label, k = 1) {
  root.updateMatrixWorld(true);
  const p = new THREE.Vector3(), nn = new THREE.Vector3(), d = new THREE.Vector3(), inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  for (const mesh of meshes) {
    const lab = label(mesh), list = proxies.filter((q) => !q.skip.has(lab));
    if (!list.length) continue;
    const m = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld), nm = new THREE.Matrix3().getNormalMatrix(m);
    const P = mesh.geometry.attributes.position, N = mesh.geometry.attributes.normal, C = mesh.geometry.attributes.color;
    for (let i = 0; i < P.count; i++) {
      p.fromBufferAttribute(P, i).applyMatrix4(m); nn.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      let occ = 0;
      for (const q of list) {
        d.subVectors(q.c, p); const dist = d.length(); if (dist < 1e-4) continue;
        const cos = (d.x * nn.x + d.y * nn.y + d.z * nn.z) / dist; if (cos <= 0) continue;
        const rr = q.r / Math.max(dist, q.r * 1.02); occ += cos * rr * rr;
      }
      C.setX(i, C.getX(i) * Math.max(0.35, 1 - k * occ));
    }
    C.needsUpdate = true;
  }
}

// stitching: small thread quads laid along a surface path [[a, y], ...] every `spacing` metres, lifted by h
export function stitchGeo(surf, ay, { spacing = 0.011, len = 0.0065, wid = 0.0022, h = 0.0006, closed = false } = {}) {
  const pts = ay.map(([a, y]) => surf.pos(a, y)), L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const P = [], N = [], idx = [], tot = L[L.length - 1], n = Math.floor(tot / spacing);
  const tg = new THREE.Vector3(), nr = new THREE.Vector3(), bi = new THREE.Vector3();
  let k = 0;
  for (let s = 0; s < n; s++) {
    const d = (s + 0.5) * spacing; while (k < L.length - 2 && L[k + 1] < d) k++;
    const t = (d - L[k]) / Math.max(1e-9, L[k + 1] - L[k]);
    const a = ay[k][0] + (ay[k + 1][0] - ay[k][0]) * t, y = ay[k][1] + (ay[k + 1][1] - ay[k][1]) * t;
    const c = surf.at(a, y, h); surf.nrm(a, y, nr); tg.subVectors(pts[k + 1], pts[k]).normalize(); bi.crossVectors(nr, tg).normalize();
    const base = P.length;
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { P.push(c.clone().addScaledVector(tg, u * len / 2).addScaledVector(bi, v * wid / 2)); N.push(nr.clone()); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P.flatMap((p) => [p.x, p.y, p.z])), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N.flatMap((p) => [p.x, p.y, p.z])), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(P.length * 2), 2));
  const col = new Float32Array(P.length * 3); for (let i = 0; i < P.length; i++) col[i * 3] = 0.75;
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  // orient so the quads face along the surface normal
  const a0 = new THREE.Vector3().fromArray(g.attributes.position.array, 0), a1 = new THREE.Vector3().fromArray(g.attributes.position.array, 3), a2 = new THREE.Vector3().fromArray(g.attributes.position.array, 6);
  if (a1.clone().sub(a0).cross(a2.clone().sub(a0)).dot(N[0]) < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const tmp = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = tmp; } }
  return g;
}
