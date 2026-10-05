import * as THREE from 'three';

// ===========================================================================
// Geometry toolkit for the procedural perps / civilians (chargeneric.js).
// Everything is authored in RIG space at rest pose (hips at y=1, character faces +Z,
// its left is +X) as raw indexed "pieces"; KitBuilder bakes a proximity AO term into
// the vertex colours, moves every piece into its bone's space and merges one indexed
// BufferGeometry per (bone, material slot).
// ===========================================================================
export const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const gauss = (x) => Math.exp(-x * x);

// piece = { p: [x,y,z...], n: [...], uv: [...], a: [ao...], ix: [...] }
export const piece = () => ({ p: [], n: [], uv: [], a: [], ix: [] });

export function computeNormals(P, weld = true) {
  const p = P.p, ix = P.ix, nv = p.length / 3, n = new Float64Array(nv * 3);
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    n[a] += nx; n[a + 1] += ny; n[a + 2] += nz; n[b] += nx; n[b + 1] += ny; n[b + 2] += nz; n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
  }
  if (weld) { // average normals of coincident vertices (UV seams, poles)
    const map = new Map();
    for (let i = 0; i < nv; i++) {
      const k = `${Math.round(p[i * 3] * 2e4)},${Math.round(p[i * 3 + 1] * 2e4)},${Math.round(p[i * 3 + 2] * 2e4)}`;
      const l = map.get(k); if (l) l.push(i); else map.set(k, [i]);
    }
    for (const l of map.values()) {
      if (l.length < 2) continue;
      let sx = 0, sy = 0, sz = 0; for (const i of l) { sx += n[i * 3]; sy += n[i * 3 + 1]; sz += n[i * 3 + 2]; }
      for (const i of l) { n[i * 3] = sx; n[i * 3 + 1] = sy; n[i * 3 + 2] = sz; }
    }
  }
  P.n = new Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    const x = n[i * 3], y = n[i * 3 + 1], z = n[i * 3 + 2], l = Math.hypot(x, y, z) || 1;
    P.n[i * 3] = x / l; P.n[i * 3 + 1] = y / l; P.n[i * 3 + 2] = z / l;
  }
  return P;
}
export function flipWinding(P) { for (let i = 0; i < P.ix.length; i += 3) { const t = P.ix[i + 1]; P.ix[i + 1] = P.ix[i + 2]; P.ix[i + 2] = t; } return P; }

// convert a three BufferGeometry into a piece
export function fromGeo(g) {
  const P = piece(), pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv;
  for (let i = 0; i < pa.count; i++) {
    P.p.push(pa.getX(i), pa.getY(i), pa.getZ(i));
    if (na) P.n.push(na.getX(i), na.getY(i), na.getZ(i));
    P.uv.push(ua ? ua.getX(i) : 0, ua ? ua.getY(i) : 0); P.a.push(1);
  }
  if (g.index) for (let i = 0; i < g.index.count; i++) P.ix.push(g.index.getX(i)); else for (let i = 0; i < pa.count; i++) P.ix.push(i);
  if (!na) computeNormals(P);
  g.dispose();
  return P;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
export function mat(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, order = 'XYZ') {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, order)), new THREE.Vector3(sx, sy, sz));
}
// apply a Matrix4 to a piece (in place); normals use the inverse transpose
export function xform(P, m) {
  const e = m.elements, nm = new THREE.Matrix3().getNormalMatrix(m).elements;
  const p = P.p, n = P.n;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    p[i] = e[0] * x + e[4] * y + e[8] * z + e[12]; p[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; p[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    const a = n[i], b = n[i + 1], c = n[i + 2];
    let nx = nm[0] * a + nm[3] * b + nm[6] * c, ny = nm[1] * a + nm[4] * b + nm[7] * c, nz = nm[2] * a + nm[5] * b + nm[8] * c;
    const l = Math.hypot(nx, ny, nz) || 1; n[i] = nx / l; n[i + 1] = ny / l; n[i + 2] = nz / l;
  }
  if (m.determinant() < 0) flipWinding(P);
  return P;
}
export const move = (P, x, y, z) => { for (let i = 0; i < P.p.length; i += 3) { P.p[i] += x; P.p[i + 1] += y; P.p[i + 2] += z; } return P; };
export function concat(...ps) {
  const R = piece();
  for (const P of ps) { if (!P) continue; const o = R.p.length / 3; R.p.push(...P.p); R.n.push(...P.n); R.uv.push(...P.uv); R.a.push(...P.a); for (const i of P.ix) R.ix.push(i + o); }
  return R;
}
export function clonePiece(P) { return { p: P.p.slice(), n: P.n.slice(), uv: P.uv.slice(), a: P.a.slice(), ix: P.ix.slice() }; }
// remap uv into rect [u0,v0,u1,v1] (optionally mirrored in u)
export function uvRect(P, r, flipU = false) { for (let i = 0; i < P.uv.length; i += 2) { const u = flipU ? 1 - P.uv[i] : P.uv[i]; P.uv[i] = r[0] + u * (r[2] - r[0]); P.uv[i + 1] = r[1] + P.uv[i + 1] * (r[3] - r[1]); } return P; }
export function uvSet(P, u, v) { for (let i = 0; i < P.uv.length; i += 2) { P.uv[i] = u; P.uv[i + 1] = v; } return P; }
export function aoMul(P, f) { for (let i = 0; i < P.a.length; i++) P.a[i] *= f(P.p[i * 3], P.p[i * 3 + 1], P.p[i * 3 + 2], i); return P; }

// ---------------------------------------------------------------------------
// LOFT: rings stacked along a path.  ring = { c:[x,y,z], rx, rz, e (superellipse exp, 2 = ellipse),
//   f:(t)=>radius multiplier, d:(t)=>[dx,dz] extra offset, ux/uz: ring-plane axes (default X / Z), v }
// t is the angle around the ring measured from +uz (front) towards +ux (character's left).
// u = 0 at a0 (default: front centre), increasing towards the left side, back, right side.
// ---------------------------------------------------------------------------
export function ringPoint(R, t) {
  const s = Math.sin(t), c = Math.cos(t), e = R.e ?? 2;
  let lx = e === 2 ? s : Math.sign(s) * Math.pow(Math.abs(s), 2 / e), lz = e === 2 ? c : Math.sign(c) * Math.pow(Math.abs(c), 2 / e);
  const k = R.f ? R.f(t) : 1;
  lx *= R.rx * k * (R.fx ? R.fx(t) : 1); lz *= R.rz * k * (R.fz ? R.fz(t) : 1);
  if (R.d) { const d = R.d(t); lx += d[0]; lz += d[1]; }
  const ux = R.ux || [1, 0, 0], uz = R.uz || [0, 0, 1];
  return [R.c[0] + ux[0] * lx + uz[0] * lz, R.c[1] + ux[1] * lx + uz[1] * lz, R.c[2] + ux[2] * lx + uz[2] * lz];
}
export function loft(rings, o = {}) {
  const seg = o.seg ?? 16, a0 = o.a0 ?? 0, a1 = o.a1 ?? TAU;
  const P = piece(), nr = rings.length, cols = seg + 1;
  // v by arc length of the ring centres unless given
  const vs = [0]; for (let i = 1; i < nr; i++) { const a = rings[i - 1].c, b = rings[i].c; vs.push(vs[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])); }
  const tot = vs[nr - 1] || 1;
  for (let i = 0; i < nr; i++) {
    const R = rings[i], v = R.v ?? (o.v0 ?? 0) + (vs[i] / tot) * ((o.v1 ?? 1) - (o.v0 ?? 0));
    for (let j = 0; j < cols; j++) {
      const t = a0 + (a1 - a0) * (j / seg);
      P.p.push(...ringPoint(R, t)); P.uv.push((o.u0 ?? 0) + (j / seg) * ((o.u1 ?? 1) - (o.u0 ?? 0)), v); P.a.push(R.ao ?? 1);
    }
  }
  for (let i = 0; i < nr - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
    P.ix.push(a, b, d, a, d, c);
  }
  const capAt = (ri, top) => { // flat-ish dome cap: one centre vertex pushed along the loft direction
    const R = rings[ri], base = ri * cols, ci = P.p.length / 3;
    const nb = rings[top ? ri - 1 : ri + 1].c, dx = R.c[0] - nb[0], dy = R.c[1] - nb[1], dz = R.c[2] - nb[2], l = Math.hypot(dx, dy, dz) || 1;
    const bulge = (top ? o.capTopBulge : o.capBotBulge) ?? 0.35 * Math.min(R.rx, R.rz);
    P.p.push(R.c[0] + dx / l * bulge, R.c[1] + dy / l * bulge, R.c[2] + dz / l * bulge); P.uv.push(((o.u0 ?? 0) + (o.u1 ?? 1)) / 2, top ? (o.v1 ?? 1) : (o.v0 ?? 0)); P.a.push(R.ao ?? 1);
    for (let j = 0; j < seg; j++) { if (top) P.ix.push(base + j, base + j + 1, ci); else P.ix.push(base + j + 1, base + j, ci); }
  };
  if (o.capTop) capAt(nr - 1, true);
  if (o.capBot) capAt(0, false);
  // orientation: the middle quad's normal must point away from its ring centre
  const mi = Math.floor((nr - 1) / 2), mj = Math.floor(seg / 2), A = mi * cols + mj, B = A + 1, C = A + cols;
  const pa = P.p.slice(A * 3, A * 3 + 3), pb = P.p.slice(B * 3, B * 3 + 3), pc = P.p.slice(C * 3, C * 3 + 3);
  const ux = pb[0] - pa[0], uy = pb[1] - pa[1], uz = pb[2] - pa[2], vx = pc[0] - pa[0], vy = pc[1] - pa[1], vz = pc[2] - pa[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const cc = rings[mi].c, out = (pa[0] - cc[0]) * nx + (pa[1] - cc[1]) * ny + (pa[2] - cc[2]) * nz;
  if ((out < 0) !== !!o.inside) flipWinding(P);
  computeNormals(P, o.weld ?? true);
  return P;
}

// parallel-transport frames along a polyline -> rings for loft (tubes, straps, fingers, chains of shapes)
export function sweepRings(pts, rFn, o = {}) {
  const n = pts.length, rings = [];
  let prevX = null;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    let X;
    if (!prevX) { const up = o.up || (Math.abs(ty) > 0.9 ? [0, 0, 1] : [0, 1, 0]); X = cross([tx, ty, tz], up); }
    else { const d = prevX[0] * tx + prevX[1] * ty + prevX[2] * tz; X = [prevX[0] - tx * d, prevX[1] - ty * d, prevX[2] - tz * d]; }
    let xl = Math.hypot(X[0], X[1], X[2]) || 1; X = [X[0] / xl, X[1] / xl, X[2] / xl]; prevX = X;
    const Z = cross(X, [tx, ty, tz]);
    const r = rFn(i / (n - 1), i);
    rings.push({ c: pts[i], rx: Array.isArray(r) ? r[0] : r, rz: Array.isArray(r) ? r[1] : r, ux: X, uz: Z, e: o.e ?? 2 });
  }
  return rings;
}
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function tube(pts, r, o = {}) { return loft(sweepRings(pts, typeof r === 'function' ? r : () => r, o), { seg: o.seg ?? 6, capTop: o.cap ?? true, capBot: o.cap ?? true, ...o }); }
// flat strap: a thin rectangle swept along a path lying on a surface; `nrm(i)` gives the outward surface normal at each point
export function strap(pts, w, th, nrmFn) {
  const P = piece(), n = pts.length;
  let acc = 0; const vs = [0]; for (let i = 1; i < n; i++) { acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]); vs.push(acc); }
  const corners = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]]; // (side, out)
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const t = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]), N = norm(nrmFn(i, pts[i])), S = norm(cross(t, N));
    for (const [s, o] of corners) P.p.push(pts[i][0] + S[0] * s * w + N[0] * o * th, pts[i][1] + S[1] * s * w + N[1] * o * th, pts[i][2] + S[2] * s * w + N[2] * o * th);
    P.uv.push(0, vs[i] / (acc || 1), 1, vs[i] / (acc || 1), 1, vs[i] / (acc || 1), 0, vs[i] / (acc || 1)); P.a.push(0.85, 0.85, 1, 1);
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < 4; k++) {
    const a = i * 4 + k, b = i * 4 + ((k + 1) % 4), c = a + 4, d = b + 4;
    P.ix.push(a, c, d, a, d, b);
  }
  // orientation check on the outer face (k=2): normal should match N
  computeNormals(P, false);
  const k0 = 2 + 4 * Math.floor(n / 2), N0 = norm(nrmFn(Math.floor(n / 2), pts[Math.floor(n / 2)]));
  if (P.n[k0 * 3] * N0[0] + P.n[k0 * 3 + 1] * N0[1] + P.n[k0 * 3 + 2] * N0[2] < 0) { flipWinding(P); computeNormals(P, false); }
  return P;
}
export const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// low-poly primitives
export function ellipsoid(rx, ry, rz, ws = 10, hs = 8, o = {}) {
  const g = new THREE.SphereGeometry(1, ws, hs, o.phiStart ?? -Math.PI / 2, o.phiLength ?? TAU, o.thetaStart ?? 0, o.thetaLength ?? Math.PI);
  g.scale(rx, ry, rz); return fromGeo(g);
}
export function rbox(w, h, d, r = 0.01, seg = 1) {
  const g = new THREE.BoxGeometry(1, 1, 1, seg * 2 + 1, seg * 2 + 1, seg * 2 + 1);
  // rounded box: push vertices onto a box with rounded edges (like RoundedBoxGeometry, but with our own normals)
  const pa = g.attributes.position, na = g.attributes.normal, hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i) * w, y = pa.getY(i) * h, z = pa.getZ(i) * d;
    const cx = clamp(x, -hw, hw), cy = clamp(y, -hh, hh), cz = clamp(z, -hd, hd);
    let dx = x - cx, dy = y - cy, dz = z - cz; const l = Math.hypot(dx, dy, dz);
    if (l > 1e-9) { dx /= l; dy /= l; dz /= l; } else { dx = na.getX(i); dy = na.getY(i); dz = na.getZ(i); }
    pa.setXYZ(i, cx + dx * r, cy + dy * r, cz + dz * r); na.setXYZ(i, dx, dy, dz);
  }
  const P = fromGeo(g);
  return P;
}
export function cylinder(rt, rb, h, seg = 10, o = {}) { return fromGeo(new THREE.CylinderGeometry(rt, rb, h, seg, o.hs ?? 1, o.open ?? false)); }
export function torus(R, r, rs = 4, ts = 8, arc = TAU) { return fromGeo(new THREE.TorusGeometry(R, r, rs, ts, arc)); }

// ---------------------------------------------------------------------------
// HEAD: a sculpted parametric surface.  Directions (theta from the crown, phi around from the
// front towards the character's left) are pushed onto an ellipsoid and then reshaped (jaw,
// chin, brow ridge, eye sockets, cheekbones, muzzle, cranium ...).  The texture parametrisation
// (u around with the face centred, v = 1 - theta/pi) is shared by the face painter, the hair
// shells and every head attachment, so paint lines up with geometry.
// ---------------------------------------------------------------------------
export const HEAD = {
  cy: 0.152, cz: 0.012, rx: 0.124, ry: 0.174, rz: 0.146,
  jawW: 0.9, chinW: 0.56, chin: 0.016, chinDrop: 0.004, brow: 0.016, cheek: 0.008, gaunt: 0, jowl: 0, cranium: 1.0, forehead: 0.008,
  muzzle: 0.01, sock: 0.014, eyeY: 0.06, eyePh: 0.33, neckBack: 0.26,
  nose: { len: 1, w: 1, tip: 1, bridge: 1, crook: 0, bend: 0 }, ear: 1, earOut: 1,
};
const UK = 1.55; // face emphasis in the u mapping
export const headU = (ph) => { const t = ph / Math.PI; return 0.5 + 0.5 * Math.sign(t) * (1 - Math.pow(1 - Math.abs(t), UK)); };
export const headPh = (u) => { const g = 2 * u - 1; return Math.sign(g) * (1 - Math.pow(1 - Math.abs(g), 1 / UK)) * Math.PI; };
export const headV = (th) => 1 - th / Math.PI;

// normalized ellipsoid direction -> sculpted point (head-bone space)
export function headPoint(H, th, ph) {
  const st = Math.sin(th), X = st * Math.sin(ph), Y = Math.cos(th), Z = st * Math.cos(ph);
  let x = X * H.rx, y = Y * H.ry, z = Z * H.rz;
  const Zf = clamp(Z, 0, 1), Zb = clamp(-Z, 0, 1), aph = Math.abs(ph);
  // lower face: V/U-shaped jaw seen from above
  const sLow = sstep(0.08, -0.85, Y);
  x *= lerp(1, lerp(H.jawW, H.chinW, Math.pow(Zf, 1.4)), sLow);
  // nape: the back of the lower skull tucks in towards the neck
  const sN = sstep(-0.05, -0.92, Y) * Zb;
  z += sN * H.rz * H.neckBack; x *= 1 - 0.2 * sN;
  // cranium / occiput
  z *= lerp(1, H.cranium, Zb * sstep(-0.15, 0.45, Y));
  // forehead slope + flatter crown
  z -= H.forehead * clamp(Y - 0.3, 0, 1) * Zf * 1.6;
  if (Y > 0.75) y -= (Y - 0.75) * 0.06 * H.ry;
  // chin
  const chinM = gauss((Y + 0.84) / 0.17) * Math.pow(Zf, 3);
  z += H.chin * chinM; y -= H.chinDrop * chinM;
  // flat underside of the jaw
  const ybot = -0.9 * H.ry - H.chinDrop * chinM; if (y < ybot) y = lerp(y, ybot, 0.7);
  // brow ridge (slight dip at the glabella)
  const browM = gauss((Y - 0.21) / 0.085) * gauss(ph / 0.78) * (1 - 0.35 * gauss(ph / 0.14));
  z += H.brow * browM;
  // eye sockets
  for (const s of [-1, 1]) {
    const m = gauss((Y - H.eyeY) / 0.105) * gauss((ph - s * H.eyePh) / 0.22);
    z -= H.sock * m; x -= s * H.sock * 0.25 * m;
  }
  // cheekbones (radial bulge) / hollow cheeks / jowls / temples
  const cheekM = gauss((Y + 0.08) / 0.13) * gauss((aph - 0.85) / 0.32);
  const gauntM = gauss((Y + 0.4) / 0.15) * gauss((aph - 0.78) / 0.3);
  const jowlM = gauss((Y + 0.62) / 0.24) * gauss((aph - 1.05) / 0.55);
  const templeM = gauss((Y - 0.36) / 0.15) * gauss((aph - 1.25) / 0.32);
  // squarer jaw angle (stays wide down to the gonion before turning to the chin)
  const jawBoxM = gauss((Y + 0.6) / 0.16) * gauss((aph - 1.3) / 0.42);
  const rad = H.cheek * cheekM - H.gaunt * gauntM + H.jowl * jowlM - 0.004 * templeM + (H.jawBox ?? 0.012) * jawBoxM;
  if (rad !== 0) { const l = Math.hypot(x, z) || 1; x += x / l * rad; z += z / l * rad; }
  // mouth area protrusion, lips
  z += H.muzzle * gauss((Y + 0.46) / 0.21) * gauss(ph / 0.5);
  z += 0.0035 * gauss((Y + 0.4) / 0.05) * gauss(ph / 0.3) + 0.003 * gauss((Y + 0.53) / 0.05) * gauss(ph / 0.26);
  return [x, y + H.cy, z + H.cz];
}
// analytic surface normal of the sculpted head (finite differences); radial at the poles
export function headNormal(H, th, ph) {
  const e = 2e-3, t0 = Math.max(1e-3, th - e), t1 = Math.min(Math.PI - 1e-3, th + e);
  const a = headPoint(H, t1, ph), b = headPoint(H, t0, ph), c = headPoint(H, th, ph + e), d = headPoint(H, th, ph - e);
  const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], v = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  let l = Math.hypot(n[0], n[1], n[2]);
  if (l < 1e-9 || th < 0.01 || th > Math.PI - 0.01) { const p = headPoint(H, th, ph); n = [p[0], p[1] - H.cy, p[2] - H.cz]; l = Math.hypot(n[0], n[1], n[2]) || 1; }
  return [n[0] / l, n[1] / l, n[2] / l];
}
export function headAO(H, th, ph) {
  const Y = Math.cos(th); let ao = 1;
  for (const s of [-1, 1]) ao -= 0.16 * gauss((Y - H.eyeY - 0.01) / 0.09) * gauss((ph - s * H.eyePh) / 0.2);
  ao -= 0.25 * sstep(-0.82, -0.98, Y);
  return clamp(ao, 0.45, 1);
}
export function headRes(lod = 1) { return { nu: Math.round(28 * lod), nv: Math.round(22 * lod) }; }
// grid (u,v) -> (th, ph)
const thOfV = (v) => (1 - v) * Math.PI;
export function headPiece(H, o = {}) {
  const { nu, nv } = o.res || headRes(1);
  const P = piece(), cols = nu + 1;
  for (let i = 0; i <= nv; i++) {
    const v = i / nv, th = thOfV(v);
    for (let j = 0; j <= nu; j++) {
      const u = j / nu, ph = headPh(u);
      P.p.push(...headPoint(H, th, ph)); P.uv.push(u, v); P.a.push(1);
    }
  }
  // eye holes: the painted eye patches (see buildHeadAndNeck) become the actual surface there
  const inEye = (k) => { const th = thOfV(P.uv[k * 2 + 1]), ph = headPh(P.uv[k * 2]), Y = Math.cos(th); return Math.abs(Y - H.eyeY) < 0.085 && Math.abs(Math.abs(ph) - H.eyePh) < 0.17; };
  for (let i = 0; i < nv; i++) for (let j = 0; j < nu; j++) {
    const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
    if (o.eyeHoles !== false || o.covered) {
      const cu = (P.uv[a * 2] + P.uv[d * 2]) / 2, cv = (P.uv[a * 2 + 1] + P.uv[d * 2 + 1]) / 2;
      const th = thOfV(cv), ph = headPh(cu), Y = Math.cos(th);
      if (o.eyeHoles !== false && Math.abs(Y - H.eyeY) < 0.06 && Math.abs(Math.abs(ph) - H.eyePh) < 0.15) continue;
      // skip quads hidden under headgear (all four corners covered)
      if (o.covered && [a, b, c, d].every((k) => o.covered(thOfV(P.uv[k * 2 + 1]), headPh(P.uv[k * 2])))) continue;
    }
    P.ix.push(a, d, b, a, c, d);
  }
  void inEye;
  computeNormals(P, true); fixOutward(P, [0, H.cy, H.cz]); // winding
  // analytic normals (identical to the eye patches' so lighting matches across the seam) + AO
  for (let k = 0; k < P.a.length; k++) {
    const th = thOfV(P.uv[k * 2 + 1]), ph = headPh(P.uv[k * 2]);
    const n = headNormal(H, th, ph); P.n[k * 3] = n[0]; P.n[k * 3 + 1] = n[1]; P.n[k * 3 + 2] = n[2];
    P.a[k] = headAO(H, th, ph);
  }
  return P;
}
export function fixOutward(P, c) {
  // compare the average outward-ness of normals; flip if mostly inward
  let s = 0; for (let i = 0; i < P.p.length; i += 3) s += (P.p[i] - c[0]) * P.n[i] + (P.p[i + 1] - c[1]) * P.n[i + 1] + (P.p[i + 2] - c[2]) * P.n[i + 2];
  if (s < 0) { flipWinding(P); for (let i = 0; i < P.n.length; i++) P.n[i] = -P.n[i]; }
  return P;
}
// project an arbitrary point (head space) onto the head parametrisation -> uv  (for attachments: nose, ears, shells)
export function headUVof(H, x, y, z) {
  const dx = x / H.rx, dy = (y - H.cy) / H.ry, dz = (z - H.cz) / H.rz, l = Math.hypot(dx, dy, dz) || 1;
  const th = Math.acos(clamp(dy / l, -1, 1)), ph = Math.atan2(dx, dz);
  return [headU(ph), headV(th)];
}
export function uvFromHead(P, H) { for (let i = 0; i < P.p.length / 3; i++) { const [u, v] = headUVof(H, P.p[i * 3], P.p[i * 3 + 1], P.p[i * 3 + 2]); P.uv[i * 2] = u; P.uv[i * 2 + 1] = v; } return P; }
// head surface point straight out from the centre along (th, ph), plus an outward offset
export function headOut(H, th, ph, off = 0) {
  const p = headPoint(H, th, ph); if (!off) return p;
  const dx = p[0], dy = p[1] - H.cy, dz = p[2] - H.cz, l = Math.hypot(dx, dy, dz) || 1;
  return [p[0] + dx / l * off, p[1] + dy / l * off, p[2] + dz / l * off];
}
// feature anchors in (th, ph)
export const thOfY = (Y) => Math.acos(clamp(Y, -1, 1));

// SHELL over the head (hair caps, beanies, balaclavas, helmets): for every grid direction inside
// the region, offset(th, ph) >= 0 gives the thickness above the scalp.  `rows`/`cols` sample a
// (th, ph) rectangle and `thMax(ph)` bounds it; the outer boundary is pulled onto the scalp so the
// shell edge tucks in, unless `open` (then a short rim turns inwards).
export function headShell(H, o) {
  const cols = o.cols ?? 28, rows = o.rows ?? 10, ph0 = o.ph0 ?? -Math.PI, ph1 = o.ph1 ?? Math.PI;
  const P = piece(), nc = cols + 1, closed = Math.abs(ph1 - ph0 - TAU) < 1e-6;
  for (let i = 0; i <= rows; i++) {
    const k = i / rows;
    for (let j = 0; j <= cols; j++) {
      const ph = ph0 + (ph1 - ph0) * (j / cols);
      const tmax = o.thMax(ph), th = (o.th0 ?? 0) + (tmax - (o.th0 ?? 0)) * Math.pow(k, o.kPow ?? 1);
      const off = o.off(th, ph, k);
      const p = headOut(H, th, ph, off);
      if (o.warp) o.warp(p, th, ph, k);
      P.p.push(...p);
      const uv = o.uv ? o.uv(th, ph, k, j / cols) : [headU(ph), headV(th)];
      P.uv.push(uv[0], uv[1]); P.a.push(o.ao ? o.ao(th, ph, k) : 1);
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const a = i * nc + j, b = a + 1, c = a + nc, d = c + 1;
    P.ix.push(a, d, b, a, c, d);
  }
  computeNormals(P, true);
  fixOutward(P, [0, H.cy, H.cz]);
  if (o.analytic) { // patches lying on the skin: take the head's own normals / AO
    for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) {
      const k = i * nc + j, kk = i / rows, ph = ph0 + (ph1 - ph0) * (j / cols), tmax = o.thMax(ph), th = (o.th0 ?? 0) + (tmax - (o.th0 ?? 0)) * Math.pow(kk, o.kPow ?? 1);
      const n = headNormal(H, th, ph); P.n[k * 3] = n[0]; P.n[k * 3 + 1] = n[1]; P.n[k * 3 + 2] = n[2]; P.a[k] = headAO(H, th, ph);
    }
  }
  return P;
}

// ---------------------------------------------------------------------------
// NOSE + EARS (head attachments, uv projected onto the face texture)
// ---------------------------------------------------------------------------
// face surface z at the midline for height y (search along ph = 0)
export function midZ(H, y) {
  let lo = 0.05, hi = Math.PI - 0.05;
  for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (headPoint(H, m, 0)[1] > y) lo = m; else hi = m; }
  return headPoint(H, (lo + hi) / 2, 0)[2];
}
export function nosePiece(H) {
  const N = H.nose, L = N.len, W = N.w, T = N.tip;
  const Yb = H.cy + 0.17 * H.ry * 0.55 + 0.0; // bridge top just under the brow
  const yTop = H.cy + H.ry * 0.17, yTip = H.cy - H.ry * (0.16 + 0.07 * L), yBot = yTip - 0.014 * T - 0.003;
  const ys = [yTop, lerp(yTop, yTip, 0.33), lerp(yTop, yTip, 0.7), yTip + 0.006, yTip - 0.003, yBot, yBot - 0.004];
  const rx = [0.0105, 0.0102 * N.bridge, 0.0125 * W, 0.0185 * W * T, 0.0245 * W * T, 0.0215 * W * T, 0.0125 * W];
  const rz = [0.004, 0.0135 * L, 0.0245 * L, 0.0345 * T * L, 0.0325 * T * L, 0.0205 * T, 0.005];
  const rings = ys.map((y, i) => {
    const bend = N.bend * Math.sin(Math.PI * i / (ys.length - 1)) * 0.004, crook = N.crook * gauss((i - 2) / 1.1) * 0.006;
    return { c: [bend, y, midZ(H, y) - 0.006], rx: rx[i], rz: rz[i] + crook, e: i < 3 ? 1.55 : 1.9 };
  });
  void Yb;
  const P = loft(rings, { seg: 10, a0: -Math.PI * 0.62, a1: Math.PI * 0.62 });
  uvFromHead(P, H);
  for (let i = 0; i < P.a.length; i++) { const y = P.p[i * 3 + 1]; P.a[i] = y < yTip - 0.006 ? 0.75 : 1; }
  return P;
}
export function earPiece(H, side) {
  const s = H.ear;
  const ry = 0.037 * s, rz = 0.025 * s;
  const P = ellipsoid(0.016 * s, ry, rz, 8, 7);
  // cup the ear: pull the inner face in and curl the rim; lobe hangs a little lower at the front
  for (let i = 0; i < P.p.length; i += 3) {
    const x = P.p[i], y = P.p[i + 1], z = P.p[i + 2];
    const r = Math.hypot(y / ry, z / rz);
    if (x > 0) P.p[i] = x * (0.55 + 0.6 * sstep(0.45, 1.0, r)); // shallow concha dish on the outward face
    P.p[i + 1] = y + 0.005 * s * (z / rz) - (y < 0 ? 0.004 * s * Math.max(0, z / rz) : 0);
  }
  computeNormals(P, true);
  const th = thOfY(-0.02), ph = side * (Math.PI / 2 + 0.1), base = headPoint(H, th, ph);
  const m = mat(base[0] + side * 0.005 * H.earOut, base[1], base[2] - 0.006, 0.0, side > 0 ? -0.32 : Math.PI + 0.32, side * 0.1 * H.earOut, 1, 1, 1, 'YXZ');
  // the ellipsoid's +x is its outward face; rotate so it faces outward on each side
  xform(P, m);
  uvFromHead(P, H);
  for (let i = 0; i < P.a.length; i++) P.a[i] = 0.8;
  return P;
}

// ---------------------------------------------------------------------------
// KIT BUILDER: collect pieces per (bone, slot) in rig space; bake AO; emit per-bone geometry.
// ---------------------------------------------------------------------------
export class KitBuilder {
  constructor(bonePos) { this.bonePos = bonePos; this.items = []; this.occ = []; }
  // occluder capsule for proximity AO: a, b endpoints, r radius, group tag
  occluder(a, b, r, group) { this.occ.push({ a, b, r, group }); }
  add(bone, slot, P, o = {}) {
    if (!P || !P.p.length) return null;
    if (o.rect) uvRect(P, o.rect, o.flipU);
    this.items.push({ bone, slot, P, group: o.group ?? bone, aoK: o.aoK ?? 1 });
    return P;
  }
  build() {
    // proximity AO from the occluder capsules (skip the piece's own group)
    const occ = this.occ;
    for (const it of this.items) {
      if (!it.aoK) continue;
      const p = it.P.p, n = it.P.n, a = it.P.a;
      for (let i = 0, k = 0; i < p.length; i += 3, k++) {
        let o = 0;
        for (const c of occ) {
          if (c.group === it.group) continue;
          const ax = c.a[0], ay = c.a[1], az = c.a[2], bx = c.b[0] - ax, by = c.b[1] - ay, bz = c.b[2] - az;
          const bb = bx * bx + by * by + bz * bz || 1;
          let t = ((p[i] - ax) * bx + (p[i + 1] - ay) * by + (p[i + 2] - az) * bz) / bb; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = ax + bx * t - p[i], qy = ay + by * t - p[i + 1], qz = az + bz * t - p[i + 2];
          const d = Math.hypot(qx, qy, qz);
          const prox = 1 - (d - c.r) / 0.16; if (prox <= 0) continue;
          const facing = d > 1e-6 ? (qx * n[i] + qy * n[i + 1] + qz * n[i + 2]) / d : 1;
          o += Math.min(1, prox) * clamp(facing * 0.7 + 0.3, 0, 1);
        }
        a[k] *= clamp(1 - 0.42 * o * it.aoK, 0.42, 1);
      }
    }
    // group by bone/slot, move into bone space
    const buckets = new Map();
    for (const it of this.items) {
      const key = it.bone + '|' + it.slot; let b = buckets.get(key);
      if (!b) { b = { bone: it.bone, slot: it.slot, list: [] }; buckets.set(key, b); }
      b.list.push(it.P);
    }
    const out = [];
    for (const b of buckets.values()) {
      let nv = 0, ni = 0; for (const P of b.list) { nv += P.p.length / 3; ni += P.ix.length; }
      const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3);
      const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
      const bp = this.bonePos[b.bone] || [0, 0, 0];
      let vo = 0, io = 0;
      for (const P of b.list) {
        const n = P.p.length / 3;
        for (let i = 0; i < n; i++) {
          pos[(vo + i) * 3] = P.p[i * 3] - bp[0]; pos[(vo + i) * 3 + 1] = P.p[i * 3 + 1] - bp[1]; pos[(vo + i) * 3 + 2] = P.p[i * 3 + 2] - bp[2];
          nor[(vo + i) * 3] = P.n[i * 3]; nor[(vo + i) * 3 + 1] = P.n[i * 3 + 1]; nor[(vo + i) * 3 + 2] = P.n[i * 3 + 2];
          uv[(vo + i) * 2] = P.uv[i * 2]; uv[(vo + i) * 2 + 1] = P.uv[i * 2 + 1];
          const a = P.a[i] ?? 1; col[(vo + i) * 3] = a; col[(vo + i) * 3 + 1] = a; col[(vo + i) * 3 + 2] = a;
        }
        for (let i = 0; i < P.ix.length; i++) idx[io + i] = P.ix[i] + vo;
        vo += n; io += P.ix.length;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeBoundingSphere(); g.computeBoundingBox();
      g.dispose = () => {}; // shared across every instance of the look: never free (enemies.js disposes geometry on removal)
      out.push({ bone: b.bone, slot: b.slot, geo: g, tris: ni / 3 });
    }
    return out;
  }
}
