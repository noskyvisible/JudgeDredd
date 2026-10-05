import * as THREE from 'three';
import { buildLawgiver, buildDaystick } from './charhero_weapons.js';

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.35, ...o });
function box(w, h, d, m, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z); mesh.castShadow = true; return mesh;
}

// ---------------------------------------------------------------------------
// Props held in hands
// ---------------------------------------------------------------------------
// Dredd's Lawgiver + daystick are built in charhero_weapons.js (userData contracts documented there)
export function makeLawgiver() { return buildLawgiver(); }
export function makeBaton(len = 0.85, tip = 0xfff0a0) { return buildDaystick(len, tip); }
export function makePistol(color = 0x333333) {
  const g = new THREE.Group();
  g.add(box(0.06, 0.1, 0.26, mat(color, { roughness: 0.4, metalness: 0.8 }), 0, 0.03, 0.1));
  g.add(box(0.05, 0.14, 0.06, mat(0x111111), 0, -0.07, 0));
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.05, 0.26); g.add(muzzle);
  const wrap = new THREE.Group(); wrap.add(g); wrap.userData.muzzle = muzzle;
  return wrap;
}
export function makeBat(color = 0x6a4a2a, len = 0.9) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.03, len, 8), mat(color, { roughness: 0.8, metalness: 0.1 })); m.position.y = -len * 0.3; g.add(m);
  g.rotation.x = -Math.PI / 2; const wrap = new THREE.Group(); wrap.add(g); wrap.traverse((o) => { if (o.isMesh) o.castShadow = true; }); return wrap;
}
