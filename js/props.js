import * as THREE from 'three';

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.35, ...o });
function box(w, h, d, m, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z); mesh.castShadow = true; return mesh;
}

// ---------------------------------------------------------------------------
// Props held in hands
// ---------------------------------------------------------------------------
export function makeLawgiver() {
  const g = new THREE.Group();
  const metal = mat(0x2a2c34, { roughness: 0.35, metalness: 0.85 });
  const dark = mat(0x0d0e12, { roughness: 0.5, metalness: 0.6 });
  const gold = mat(0xe8b52a, { roughness: 0.3, metalness: 0.95 });
  const body = box(0.09, 0.14, 0.42, metal, 0, 0.06, 0.12); g.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.34, 8), dark); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.1, 0.46); g.add(barrel);
  const grip = box(0.075, 0.2, 0.09, dark, 0, -0.07, 0.0); grip.rotation.x = -0.25; g.add(grip);
  g.add(box(0.1, 0.03, 0.2, gold, 0, 0.14, 0.12));
  g.add(box(0.075, 0.075, 0.18, dark, 0, 0.0, 0.3));
  const disp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.1), new THREE.MeshBasicMaterial({ color: 0x40ff80, toneMapped: false }));
  disp.position.set(0, 0.145, 0.04); g.add(disp); g.userData.disp = disp;
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.1, 0.64); g.add(muzzle); g.userData.muzzle = muzzle;
  const wrap = new THREE.Group(); wrap.add(g); g.position.set(0, -0.05, 0.0);
  wrap.userData = g.userData; wrap.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return wrap;
}
export function makeBaton(len = 0.85, tip = 0xfff0a0) {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, len, 8), mat(0x15161a, { roughness: 0.4, metalness: 0.7 }));
  shaft.position.y = -len * 0.35; g.add(shaft);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 8), mat(0xe8b52a, { metalness: 1, roughness: 0.3 })); ring.position.y = -0.12; g.add(ring);
  const tipM = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.1, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(tip).multiplyScalar(2.0), toneMapped: false })); tipM.position.y = -len * 0.35 - len / 2 + 0.04; g.add(tipM);
  g.userData.tipLocal = new THREE.Vector3(0, -len * 0.35 - len / 2, 0);
  g.userData.baseLocal = new THREE.Vector3(0, -len * 0.35 - len * 0.1, 0);
  g.userData.tipMat = tipM.material;
  g.rotation.x = -Math.PI / 2; // along +z after parent rotation
  const wrap = new THREE.Group(); wrap.add(g); wrap.userData = g.userData; wrap.userData.inner = g;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return wrap;
}
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
