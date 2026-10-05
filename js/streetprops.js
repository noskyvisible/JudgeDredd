import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { world, N, BLOCK, blockC } from './world.js';
import { mulberry32, makeCanvas, canvasTex } from './util.js';

// ---------------------------------------------------------------------------
// Street furniture scattered along the sidewalks (one InstancedMesh per kind, seeded separately from the
// city generator so the layout never shifts): fire hydrants, bollards, glowing vending machines, benches,
// bins, newsstands, planters and roadwork barriers.  Every instance is a small solid for collisions.
// ---------------------------------------------------------------------------

const col = new THREE.Color();
function part(geo, x, y, z, color, rx = 0, ry = 0, rz = 0) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  if (rx || ry || rz) geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  geo.translate(x, y, z);
  col.set(color); const n = geo.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) geo.deleteAttribute(k);
  return geo;
}
const B = (w, h, d, ...a) => part(new THREE.BoxGeometry(w, h, d), ...a);
const C = (rt, rb, h, seg, ...a) => part(new THREE.CylinderGeometry(rt, rb, h, seg), ...a);
const merge = (arr) => mergeGeometries(arr, false);

// ---- geometry for each kind (local space: origin on the ground, +z faces the street) ----
const KINDS = {
  hydrant: { w: 0.5, d: 0.5, h: 1, geo: () => merge([C(0.2, 0.24, 0.8, 10, 0, 0.4, 0, 0xc42a22), C(0.16, 0.2, 0.18, 10, 0, 0.88, 0, 0xc42a22), C(0.07, 0.1, 0.1, 8, 0, 1.02, 0, 0xd8d0c0), C(0.09, 0.09, 0.5, 8, 0, 0.58, 0, 0xc42a22, 0, 0, Math.PI / 2), C(0.12, 0.12, 0.08, 8, 0.26, 0.58, 0, 0x9a1a14, 0, 0, Math.PI / 2), C(0.12, 0.12, 0.08, 8, -0.26, 0.58, 0, 0x9a1a14, 0, 0, Math.PI / 2)]) },
  bollard: { w: 3.4, d: 0.4, h: 1, geo: () => merge([-1.4, -0.7, 0, 0.7, 1.4].flatMap((x) => [C(0.1, 0.12, 0.95, 8, x, 0.475, 0, 0x30343c), C(0.105, 0.105, 0.1, 8, x, 0.78, 0, 0xffc030), C(0.1, 0.1, 0.05, 8, x, 0.97, 0, 0x202228)])) },
  bench: { w: 2.0, d: 0.7, h: 1, geo: () => merge([B(1.9, 0.07, 0.5, 0, 0.5, 0, 0x6a4a2c), B(1.9, 0.07, 0.12, 0, 0.88, -0.24, 0x6a4a2c, -0.2), B(1.9, 0.07, 0.12, 0, 0.74, -0.22, 0x6a4a2c, -0.2), B(0.06, 0.5, 0.5, 0.9, 0.25, 0, 0x2a2c32), B(0.06, 0.5, 0.5, -0.9, 0.25, 0, 0x2a2c32), B(0.06, 0.5, 0.06, 0.9, 0.7, -0.26, 0x2a2c32), B(0.06, 0.5, 0.06, -0.9, 0.7, -0.26, 0x2a2c32)]) },
  bin: { w: 0.8, d: 0.8, h: 1, geo: () => merge([C(0.34, 0.3, 0.95, 12, 0, 0.475, 0, 0x2f5a40), C(0.37, 0.37, 0.1, 12, 0, 1.0, 0, 0x1f3a2a), C(0.35, 0.35, 0.06, 12, 0, 0.62, 0, 0x203c2c), B(0.5, 0.05, 0.02, 0, 0.8, 0.3, 0x101010)]) },
  planter: { w: 1.7, d: 1.7, h: 1.6, geo: () => merge([B(1.5, 0.55, 1.5, 0, 0.275, 0, 0x4a4a52), B(1.6, 0.1, 1.6, 0, 0.58, 0, 0x5a5a64), part(new THREE.IcosahedronGeometry(0.6, 1), 0, 1.05, 0, 0x1f5a34), part(new THREE.IcosahedronGeometry(0.42, 1), 0.4, 0.95, 0.25, 0x2a6a3c), part(new THREE.IcosahedronGeometry(0.38, 1), -0.4, 0.98, -0.2, 0x18502c)]) },
  barrier: { w: 2.4, d: 0.5, h: 1.1, geo: () => merge([B(2.3, 0.28, 0.06, 0, 0.9, 0, 0xe8e8e8), B(2.3, 0.28, 0.06, 0, 0.55, 0, 0xe8e8e8), ...[-0.9, -0.3, 0.3, 0.9].map((x) => B(0.25, 0.28, 0.07, x, 0.9, 0.001, 0xe2661a)), ...[-0.6, 0, 0.6].map((x) => B(0.25, 0.28, 0.07, x, 0.55, 0.001, 0xe2661a)), B(0.07, 1.05, 0.07, -1.1, 0.52, 0, 0x30343c), B(0.07, 1.05, 0.07, 1.1, 0.52, 0, 0x30343c), B(0.5, 0.05, 0.4, -1.1, 0.025, 0, 0x30343c), B(0.5, 0.05, 0.4, 1.1, 0.025, 0, 0x30343c)]) },
  kiosk: { w: 2.2, d: 1.6, h: 2.8, geo: () => merge([B(2.0, 2.3, 1.4, 0, 1.15, 0, 0x2a2c34), B(2.3, 0.12, 1.7, 0, 2.36, 0, 0x4a4c56), B(1.9, 0.1, 0.5, 0, 1.0, 0.7, 0x3a3c44), B(0.08, 2.3, 0.08, -0.9, 1.15, 0.72, 0x1a1c20), B(0.08, 2.3, 0.08, 0.9, 1.15, 0.72, 0x1a1c20)]) },
  vending: { w: 1.1, d: 0.9, h: 1.9, geo: () => merge([B(1.0, 1.85, 0.8, 0, 0.925, 0, 0x30343e), B(1.04, 0.06, 0.84, 0, 1.88, 0, 0x4a4e5a), B(0.94, 0.04, 0.6, 0, 0.06, 0.1, 0x14161a)]) },
};
// the glowing fronts (emissive, unlit) for vending machines and kiosks
function frontTexture() {
  const [c, x] = makeCanvas(128, 256);
  x.fillStyle = '#10121a'; x.fillRect(0, 0, 128, 256);
  const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#c8c8d0');
  x.fillStyle = g; x.fillRect(6, 6, 116, 244);
  x.fillStyle = '#ffffff'; x.font = '900 26px Impact, "Arial Black", sans-serif'; x.textAlign = 'center'; x.fillStyle = '#222'; x.fillText('SLURP', 64, 34);
  for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) { x.fillStyle = `hsl(${(r * 53 + q * 97) % 360},70%,${50 + (q % 2) * 12}%)`; x.fillRect(12 + q * 36, 50 + r * 34, 28, 26); x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(12 + q * 36, 50 + r * 34 + 20, 28, 6); }
  x.fillStyle = '#111'; x.fillRect(88, 222, 28, 20);
  return canvasTex(c);
}

export function buildStreetProps(scene) {
  const rng = mulberry32(4242), R = (a = 1, b) => (b === undefined ? rng() * a : a + rng() * (b - a));
  const spots = Object.fromEntries(Object.keys(KINDS).map((k) => [k, []]));
  const pick = () => { const t = rng(); return t < 0.17 ? 'hydrant' : t < 0.3 ? 'bollard' : t < 0.46 ? 'bench' : t < 0.64 ? 'bin' : t < 0.75 ? 'planter' : t < 0.83 ? 'barrier' : t < 0.91 ? 'kiosk' : 'vending'; };
  const hallI = (N - 1) / 2;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if (i === hallI && j === hallI) continue;
    const cx = blockC(i), cz = blockC(j), half = BLOCK / 2;
    for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {            // the four street-facing edges of the block
      let t = -half + R(12, 20);
      while (t < half - 12) {
        const kind = pick(), K = KINDS[kind];
        const inset = 1.0 + K.d / 2 + R(0, 0.7);
        const px = cx + nx * (half - inset) + (nz !== 0 ? t : 0), pz = cz + nz * (half - inset) + (nx !== 0 ? t : 0);
        spots[kind].push({ x: px, z: pz, ry: Math.atan2(nx, nz), K });
        t += R(16, 34);
      }
    }
  }
  const frontTex = frontTexture();
  const dummy = new THREE.Object3D(), tint = new THREE.Color();
  const palette = [0xff5a4a, 0x5aff9a, 0x5ac8ff, 0xffd24a, 0xff7ad8, 0xffffff];
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.45 });
  let total = 0;
  streams.length = 0;
  for (const [kind, list] of Object.entries(spots)) {
    if (!list.length) continue;
    const K = KINDS[kind], geo = K.geo();
    // every instance's matrix is computed once; the live meshes only hold the ones near the camera (see updateStreetProps)
    list.forEach((s, k) => { dummy.position.set(s.x, 0.24, s.z); dummy.rotation.set(0, s.ry, 0); dummy.updateMatrix(); s.m = dummy.matrix.clone(); s.tint = new THREE.Color(palette[k % palette.length]).multiplyScalar(1.9); });
    const mesh = new THREE.InstancedMesh(geo, material, list.length); mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.count = 0;
    scene.add(mesh); total += list.length;
    const st = { kind, list, mesh, front: null };
    if (kind === 'vending' || kind === 'kiosk') {                          // glowing front panel, tinted per instance
      const w = kind === 'vending' ? 0.9 : 1.8, h = kind === 'vending' ? 1.55 : 1.5, y = kind === 'vending' ? 1.0 : 1.3, z = kind === 'vending' ? 0.41 : 0.72;
      const fm = new THREE.InstancedMesh(new THREE.PlaneGeometry(w, h).translate(0, y, z), new THREE.MeshBasicMaterial({ map: frontTex, toneMapped: false }), list.length); fm.frustumCulled = false; fm.count = 0;
      for (let k = 0; k < list.length; k++) fm.setColorAt(k, list[k].tint);
      scene.add(fm); st.front = fm;
    }
    streams.push(st);
    // solid for the player / bikes / civilians (axis-aligned footprint, rotated by side)
    list.forEach((s) => {
      const sw = Math.abs(Math.cos(s.ry)) > 0.5 ? K.w : K.d, sd = Math.abs(Math.cos(s.ry)) > 0.5 ? K.d : K.w;
      world.addBox({ minX: s.x - sw / 2, maxX: s.x + sw / 2, minZ: s.z - sd / 2, maxZ: s.z + sd / 2, h: K.h });
    });
  }
  updateStreetProps(1, new THREE.Vector3(0, 0, 0), true);
  return total;
}

// keep only the furniture within RANGE of the camera in the instance buffers: the whole city's worth would cost ~0.6 M triangles per pass
const streams = [], RANGE = 100;
export const streetPropStreams = streams;     // debug / tools: all spots per kind
let acc = 0, lastX = 1e9, lastZ = 1e9;
export function updateStreetProps(dt, center, force = false) {
  acc += dt;
  const moved = Math.hypot(center.x - lastX, center.z - lastZ);
  if (!force && acc < 0.5 && moved < 15) return;
  acc = 0; lastX = center.x; lastZ = center.z;
  const r2 = RANGE * RANGE;
  for (const { list, mesh, front } of streams) {
    let n = 0;
    for (const s of list) {
      const dx = s.x - center.x, dz = s.z - center.z;
      if (dx * dx + dz * dz > r2) continue;
      mesh.setMatrixAt(n, s.m); if (front) { front.setMatrixAt(n, s.m); front.setColorAt(n, s.tint); }
      n++;
    }
    mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
    if (front) { front.count = n; front.instanceMatrix.needsUpdate = true; if (front.instanceColor) front.instanceColor.needsUpdate = true; }
  }
}
