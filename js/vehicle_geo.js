import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Vehicle geometry kit: parametric surfaces (lofts with creases, conforming overlay patches
// for lights / trims / decals), tube & lathe helpers, and a per-(parent, material) merger
// so a whole vehicle collapses into a handful of draw calls.
//
// Surface convention: fn(u, v, out) writes a point.  The outward normal is dS/du x dS/dv,
// so for a body lofted along +Z (u) the section parameter v must run bottom -> -X side -> top -> +X side.
// ---------------------------------------------------------------------------

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const mix = (a, b, t) => a + (b - a) * t;

// n+1 samples a..b ; optional extra break values merged in (kept sorted, deduped)
export function lin(a, b, n, extra = null) {
  const out = []; for (let i = 0; i <= n; i++) out.push(a + (b - a) * (i / n));
  if (extra) for (const e of extra) if (e > Math.min(a, b) + 1e-6 && e < Math.max(a, b) - 1e-6) out.push(e);
  out.sort((x, y) => (a < b ? x - y : y - x));
  return out.filter((v, i) => i === 0 || Math.abs(v - out[i - 1]) > 1e-6);
}
// cosine-spaced samples (denser at both ends) - good for rounded ends
export function cosSpace(a, b, n) { const out = []; for (let i = 0; i <= n; i++) out.push(a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * i / n))); return out; }

// superellipse point for angle th (n = 2 ellipse, larger = squarer)
export function se(th, n) { const c = Math.cos(th), s = Math.sin(th); return [Math.sign(c) * Math.pow(Math.abs(c), 2 / n), Math.sign(s) * Math.pow(Math.abs(s), 2 / n)]; }

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _n = new THREE.Vector3();

// outward normal of a parametric surface by central differences
export function surfNormal(fn, u, v, out, e = 1e-3) {
  fn(u + e, v, _a); fn(u - e, v, _b); _a.sub(_b);
  fn(u, v + e, _c); fn(u, v - e, _d); _c.sub(_d);
  out.crossVectors(_a, _c); const l = out.length();
  return l < 1e-14 ? out.set(0, 1, 0) : out.multiplyScalar(1 / l);
}

/**
 * Grid surface.  us / vs are parameter arrays.  Options:
 *   offset: push every point along the surface normal (overlay patches sit proud of the body)
 *   flip:   reverse the winding (inner liners)
 *   closed: v wraps (averages the seam normals)
 *   uvMode: 'arc' (metres) | 'unit' (0..1 over the patch, for decals)
 *   map:    (i, j, nu, nv) -> [u, v] custom UV function
 */
export function surface(fn, us, vs, o = {}) {
  const nu = us.length, nv = vs.length;
  const pos = new Float32Array(nu * nv * 3), uv = new Float32Array(nu * nv * 2);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    fn(us[i], vs[j], _p);
    if (o.offset) { surfNormal(fn, us[i], vs[j], _n, o.eps || 1e-3); _p.addScaledVector(_n, o.flip ? -o.offset : o.offset); }
    const k = (i * nv + j) * 3; pos[k] = _p.x; pos[k + 1] = _p.y; pos[k + 2] = _p.z;
  }
  if (o.map) { for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const t = o.map(i, j, nu, nv); uv[(i * nv + j) * 2] = t[0]; uv[(i * nv + j) * 2 + 1] = t[1]; } }
  else if (o.uvMode === 'unit') { for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { uv[(i * nv + j) * 2] = j / (nv - 1); uv[(i * nv + j) * 2 + 1] = i / (nu - 1); } }
  else {   // arc length: u along v-lines, v along u-lines (metres)
    for (let j = 0; j < nv; j++) { let acc = 0; for (let i = 0; i < nu; i++) { if (i) { const a = ((i - 1) * nv + j) * 3, b = (i * nv + j) * 3; acc += Math.hypot(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]); } uv[(i * nv + j) * 2 + 1] = acc; } }
    for (let i = 0; i < nu; i++) { let acc = 0; for (let j = 0; j < nv; j++) { if (j) { const a = (i * nv + j - 1) * 3, b = (i * nv + j) * 3; acc += Math.hypot(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]); } uv[(i * nv + j) * 2] = acc; } }
  }
  const idx = [];
  for (let i = 0; i < nu - 1; i++) for (let j = 0; j < nv - 1; j++) {
    const a = i * nv + j, b = (i + 1) * nv + j, c = i * nv + j + 1, d = (i + 1) * nv + j + 1;
    if (o.flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  const nrm = g.attributes.normal.array;
  if (o.closed) for (let i = 0; i < nu; i++) {
    const a = (i * nv) * 3, b = (i * nv + nv - 1) * 3;
    _n.set(nrm[a] + nrm[b], nrm[a + 1] + nrm[b + 1], nrm[a + 2] + nrm[b + 2]).normalize();
    nrm[a] = nrm[b] = _n.x; nrm[a + 1] = nrm[b + 1] = _n.y; nrm[a + 2] = nrm[b + 2] = _n.z;
  }
  // collapsed rows (poles) get one shared normal so the tip does not facet
  for (let i = 0; i < nu; i++) {
    let ext = 0; const r0 = i * nv * 3;
    for (let j = 1; j < nv; j++) { const k = (i * nv + j) * 3; ext = Math.max(ext, Math.abs(pos[k] - pos[r0]) + Math.abs(pos[k + 1] - pos[r0 + 1]) + Math.abs(pos[k + 2] - pos[r0 + 2])); }
    if (ext > 1e-5) continue;
    _n.set(0, 0, 0); for (let j = 0; j < nv; j++) { const k = (i * nv + j) * 3; _n.x += nrm[k]; _n.y += nrm[k + 1]; _n.z += nrm[k + 2]; }
    if (_n.lengthSq() < 1e-12) continue; _n.normalize();
    for (let j = 0; j < nv; j++) { const k = (i * nv + j) * 3; nrm[k] = _n.x; nrm[k + 1] = _n.y; nrm[k + 2] = _n.z; }
  }
  return g;
}

// A patch on surface fn mapped from a (u0..u1) x (vlo..vhi) parameter quad whose v-limits may vary with u
// (vlo(u) / vhi(u) functions or numbers).  Runs either way along u or v; always faces outward.
// UVs are unit: texture U runs along v (or along u with swapUV), texture V along the other.
export function patch(fn, u0, u1, vlo, vhi, nu, nv, o = {}) {
  const lo = typeof vlo === 'function' ? vlo : () => vlo, hi = typeof vhi === 'function' ? vhi : () => vhi;
  const um = (u0 + u1) / 2, rev = (u1 < u0) !== (hi(um) < lo(um));
  return surface((s, t, out) => {
    const u = mix(u0, u1, s), v = mix(lo(u), hi(u), t);
    fn(u, v, out);
    // offset along the BASE surface normal, not the reparametrised one
    if (o.offset) { surfNormal(fn, u, v, _n, o.eps || 1e-3); out.addScaledVector(_n, o.flip ? -o.offset : o.offset); }
    return out;
  }, lin(0, 1, nu), lin(0, 1, nv), { flip: rev !== !!o.flip, uvMode: 'unit', map: o.swapUV ? (i, j, nU, nV) => [i / (nU - 1), j / (nV - 1)] : null });
}

// flat cap closing a ring of points (triangulated in the plane perpendicular to `normal`)
export function capRing(pts, normal) {
  const n = normal.clone().normalize();
  const t1 = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(n).normalize() : new THREE.Vector3(1, 0, 0).cross(n).normalize();
  const t2 = n.clone().cross(t1);
  const c = new THREE.Vector3(); for (const p of pts) c.add(p); c.multiplyScalar(1 / pts.length);
  const p2 = pts.map((p) => new THREE.Vector2(p.clone().sub(c).dot(t1), p.clone().sub(c).dot(t2)));
  if (THREE.ShapeUtils.isClockWise(p2)) { p2.reverse(); pts = pts.slice().reverse(); }
  const tris = THREE.ShapeUtils.triangulateShape(p2, []);
  const pos = [], nor = [], uv = [];
  for (const t of tris) for (const k of t) { const p = pts[k]; pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); uv.push(p2[k].x, p2[k].y); }
  // make sure the winding agrees with `normal`
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const a = new THREE.Vector3(pos[0], pos[1], pos[2]), b = new THREE.Vector3(pos[3], pos[4], pos[5]), cc = new THREE.Vector3(pos[6], pos[7], pos[8]);
  if (pos.length >= 9 && b.sub(a).cross(cc.sub(a)).dot(n) < 0) { const P = g.attributes.position.array; for (let i = 0; i < P.length; i += 9) for (let k = 0; k < 3; k++) { const t = P[i + 3 + k]; P[i + 3 + k] = P[i + 6 + k]; P[i + 6 + k] = t; } }
  return g;
}
// the ring of a surface at u (v samples) - for capping lofts
export function ringAt(fn, u, vs) { return vs.map((v) => fn(u, v, new THREE.Vector3())); }

// ---------------- primitive helpers (all return BufferGeometry in final position) ----------------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
export function M4(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, order = 'XYZ') {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, order)), new THREE.Vector3(sx, sy, sz));
}
export function xf(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) { return geo.applyMatrix4(M4(x, y, z, rx, ry, rz, sx, sy, sz)); }
// orient a +Y-aligned geometry so it spans a -> b
export function alignY(geo, a, b) {
  const d = _a.copy(b).sub(a); const len = d.length();
  _q.setFromUnitVectors(_up, d.multiplyScalar(1 / len));
  _m.compose(_c.copy(a).add(b).multiplyScalar(0.5), _q, _s.set(1, 1, 1));
  return geo.applyMatrix4(_m);
}
export function rod(a, b, r, seg = 12, r2 = r) { const len = a.distanceTo(b); return alignY(new THREE.CylinderGeometry(r2, r, len, seg, 1), a, b); }
export function pipe(points, r, seg = 10, tub = 32, closed = false, tension = 0.5) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom', tension);
  return new THREE.TubeGeometry(curve, tub, r, seg, closed);
}
// lathe about the Y axis from [r, y] pairs.  `out` = [dr, dy]: the direction (in the r-y plane) the surface
// should face on average (e.g. [1,0] radially outward, [0,1] toward +Y); the profile is reversed if needed.
export function lathe(pairs, seg = 32, out = null, phiStart = 0, phiLen = Math.PI * 2) {
  let p = pairs;
  if (out) {
    let sr = 0, sy = 0;
    for (let i = 1; i < p.length; i++) { const dr = p[i][0] - p[i - 1][0], dy = p[i][1] - p[i - 1][1]; sr += dy; sy += -dr; }   // three's lathe faces (dy, -dr)
    if (sr * out[0] + sy * out[1] < 0) p = p.slice().reverse();
  }
  return new THREE.LatheGeometry(p.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), seg, phiStart, phiLen);
}

// Glass: fresnel-driven opacity (clear when looked through head-on, mirror-like at grazing angles)
export function patchGlass(mat, minA = 0.18, maxA = 0.92, pow = 2.6) {
  mat.transparent = true;
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
      { float fr = pow(1.0 - saturate(abs(dot(normalize(normal), normalize(vViewPosition)))), ${pow.toFixed(2)});
        diffuseColor.a = mix(${minA.toFixed(3)}, ${maxA.toFixed(3)}, fr); }
      #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `glass_${minA}_${maxA}_${pow}`;
  return mat;
}
// coil spring along +Y from 0..len
export function coil(R, r, len, turns, seg = 6, perTurn = 18) {
  const pts = []; const n = Math.round(turns * perTurn);
  for (let i = 0; i <= n; i++) { const t = i / n, a = t * turns * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * R, t * len, Math.sin(a) * R)); }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, r, seg, false);
}
// extruded 2D outline (array of [x, y]) along +Z by depth, centred on z
export function slab(outline, depth, bevel = 0.004, curveSeg = 4) {
  const s = new THREE.Shape(); s.moveTo(outline[0][0], outline[0][1]); for (let i = 1; i < outline.length; i++) s.lineTo(outline[i][0], outline[i][1]); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(1e-4, depth - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: curveSeg });
  g.translate(0, 0, -(depth - 2 * bevel) / 2); return g;
}
export function rbox(RoundedBox, w, h, d, r = 0.02, seg = 2) { return new RoundedBox(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)); }

// warp every vertex of a geometry: f(Vector3) mutates in place; normals recomputed (non-indexed keeps facets per original vertex normals -> recompute smooth)
export function warp(geo, f, recompute = true) {
  const p = geo.attributes.position; const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); f(v); p.setXYZ(i, v.x, v.y, v.z); }
  if (recompute) geo.computeVertexNormals();
  return geo;
}

// paint a whole geometry with one vertex colour (HDR allowed)
export function tint(g, c) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  const r = c.r ?? c[0], gg = c.g ?? c[1], b = c.b ?? c[2];
  for (let i = 0; i < n; i++) { a[i * 3] = r; a[i * 3 + 1] = gg; a[i * 3 + 2] = b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
}

// ---------------------------------------------------------------------------
// Kit: collects geometry per (parent object, material) and merges each bin into one mesh.
// ---------------------------------------------------------------------------
export class Kit {
  constructor() { this.bins = new Map(); }
  add(geo, mat, parent, matrix = null) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    const keep = mat.vertexColors ? ['position', 'normal', 'uv', 'color'] : ['position', 'normal', 'uv'];
    for (const n of Object.keys(g.attributes)) if (!keep.includes(n)) g.deleteAttribute(n);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (mat.vertexColors && !g.attributes.color) tint(g, [1, 1, 1]);
    g.morphAttributes = {};
    const key = parent.uuid + '|' + mat.uuid;
    let bin = this.bins.get(key); if (!bin) { bin = { parent, mat, geos: [] }; this.bins.set(key, bin); }
    bin.geos.push(g);
    return this;
  }
  build({ shadow = true, receive = false } = {}) {
    const meshes = [];
    for (const { parent, mat, geos } of this.bins.values()) {
      const merged = mergeGeometries(geos, false);
      const mesh = new THREE.Mesh(merged, mat); mesh.castShadow = shadow && !mat.transparent && !mat.userData?.noShadow; mesh.receiveShadow = receive;
      parent.add(mesh); meshes.push(mesh);
    }
    this.bins.clear();
    return meshes;
  }
  // merge one bin set into raw geometries per material (used by cached car bodies)
  geometries() {
    const out = new Map();
    for (const { mat, geos } of this.bins.values()) { const prev = out.get(mat); out.set(mat, prev ? mergeGeometries([prev, ...geos], false) : mergeGeometries(geos, false)); }
    this.bins.clear();
    return out;
  }
}

export function triCount(obj) {
  let t = 0, m = 0; obj.traverse((o) => { if (o.isMesh && o.visible) { m++; const g = o.geometry; t += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); } });
  return { tris: t, meshes: m };
}
