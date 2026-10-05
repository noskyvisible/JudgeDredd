import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeCanvas, canvasTex, mulberry32, normalFromHeight } from './util.js';

// ---------------------------------------------------------------------------
// Shared building blocks for the procedural character bodies (charhero.js / chargeneric.js):
// geometry shorthands, the per-bone mesh baker, shared canvas textures and the material factory.
// ---------------------------------------------------------------------------

export const rb = (w, h, d, r = 0.04, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, r);
export const cap = (r, len, rs = 5, hs = 10) => new THREE.CapsuleGeometry(r, len, rs, hs);
export const cyl = (rt, rbm, h, seg = 12) => new THREE.CylinderGeometry(rt, rbm, h, seg);

export function add(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz); parent.add(m); return m;
}

// merge the direct mesh children of a bone into one mesh per material
export function bake(group) {
  const buckets = new Map();
  for (const child of [...group.children]) {
    if (!child.isMesh || child.userData.noBake) continue;
    child.updateMatrix();
    let g = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
    g.applyMatrix4(child.matrix);
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!buckets.has(child.material)) buckets.set(child.material, []);
    buckets.get(child.material).push(g);
    group.remove(child); child.geometry.dispose();
  }
  for (const [m, arr] of buckets) { const mesh = new THREE.Mesh(mergeGeometries(arr, false), m); mesh.castShadow = true; group.add(mesh); }
}

// ---------- shared procedural textures ----------
let TEX = null;
export function textures() {
  if (TEX) return TEX;
  const rng = mulberry32(5);
  // leather / armour grain (height -> normal)
  const [hc, hx] = makeCanvas(256, 256); hx.fillStyle = 'rgb(128,128,128)'; hx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) { const l = rng() < 0.5 ? 0 : 255; hx.fillStyle = `rgba(${l},${l},${l},0.22)`; hx.fillRect(rng() * 256, rng() * 256, 2 + rng() * 2, 2 + rng() * 2); }
  for (let i = 0; i < 60; i++) { hx.strokeStyle = 'rgba(0,0,0,0.25)'; hx.lineWidth = 1; hx.beginPath(); let x = rng() * 256, y = rng() * 256; hx.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rng() - 0.5) * 30; y += (rng() - 0.5) * 30; hx.lineTo(x, y); } hx.stroke(); }
  const grain = canvasTex(normalFromHeight(hc, 1.4), { repeat: true, srgb: false });

  // chest badge: gold shield, DREDD lettering, small eagle
  const [bc, bx] = makeCanvas(256, 320);
  const g = bx.createLinearGradient(0, 0, 256, 320); g.addColorStop(0, '#f7d56a'); g.addColorStop(0.5, '#d9a52a'); g.addColorStop(1, '#a8761a');
  bx.fillStyle = '#2a1c05'; shieldPath(bx, 6, 6, 244, 308); bx.fill();
  bx.fillStyle = g; shieldPath(bx, 16, 16, 224, 288); bx.fill();
  bx.strokeStyle = '#7a5410'; bx.lineWidth = 6; shieldPath(bx, 30, 30, 196, 260); bx.stroke();
  bx.fillStyle = '#1a1206'; bx.font = '900 56px Impact, "Arial Black", sans-serif'; bx.textAlign = 'center'; bx.textBaseline = 'middle'; bx.fillText('DREDD', 128, 205);
  bx.fillStyle = '#1a1206'; bx.beginPath(); bx.moveTo(128, 60); bx.lineTo(160, 90); bx.lineTo(210, 70); bx.lineTo(180, 120); bx.lineTo(150, 118); bx.lineTo(128, 150); bx.lineTo(106, 118); bx.lineTo(76, 120); bx.lineTo(46, 70); bx.lineTo(96, 90); bx.closePath(); bx.fill();
  const badge = canvasTex(bc);

  // belt buckle: gold frame, stars and stripes shield
  const [uc, ux] = makeCanvas(256, 192);
  ux.fillStyle = '#c8921e'; ux.fillRect(0, 0, 256, 192);
  const ug = ux.createLinearGradient(0, 0, 0, 192); ug.addColorStop(0, '#f4d36a'); ug.addColorStop(1, '#b07a14'); ux.fillStyle = ug; ux.fillRect(10, 10, 236, 172);
  ux.fillStyle = '#c8211a'; for (let i = 0; i < 7; i += 2) ux.fillRect(36 + i * 26, 60, 26, 100); ux.fillStyle = '#f4f0e6'; for (let i = 1; i < 7; i += 2) ux.fillRect(36 + i * 26, 60, 26, 100);
  ux.fillStyle = '#1a3a8a'; ux.fillRect(36, 30, 182, 36); ux.fillStyle = '#fff'; for (let i = 0; i < 7; i++) { ux.beginPath(); ux.arc(54 + i * 24, 48, 4, 0, 7); ux.fill(); }
  ux.strokeStyle = '#6b4a0e'; ux.lineWidth = 6; ux.strokeRect(36, 30, 182, 130);
  const buckle = canvasTex(uc);

  TEX = { grain, badge, buckle };
  return TEX;
}
export function shieldPath(c, x, y, w, h) {
  c.beginPath(); c.moveTo(x, y); c.lineTo(x + w, y); c.lineTo(x + w, y + h * 0.6); c.quadraticCurveTo(x + w, y + h * 0.9, x + w / 2, y + h); c.quadraticCurveTo(x, y + h * 0.9, x, y + h * 0.6); c.closePath();
}

export function makeMat(color, o = {}) {
  const T = textures();
  const { grain, ...rest } = o;
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...rest });
  if (grain) { m.normalMap = T.grain; m.normalScale = new THREE.Vector2(grain, grain); T.grain.repeat.set(2, 2); }
  return m;
}

// ---------------------------------------------------------------------------
