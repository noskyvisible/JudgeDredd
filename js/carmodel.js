import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Procedural Mega-City traffic: sedans, taxis, low coupes and box trucks.
// Cars face +Z, y up, origin on the ground at the centre.  Static parts are merged per material
// (paint / glass / trim / lamps / tail) so a car costs ~10 draw calls; wheels are separate meshes
// that spin, and the front pair steers.
// ---------------------------------------------------------------------------

const rb = (w, h, d, r = 0.06, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));

// shared (never tinted) materials
let SH = null;
function shared() {
  if (SH) return SH;
  SH = {
    glass: new THREE.MeshStandardMaterial({ color: 0x06090f, roughness: 0.04, metalness: 0.95 }),
    trim: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.55 }),
    lamp: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    wheel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.5 }),
  };
  return SH;
}

// colourise a geometry (vertex colours, HDR allowed)
function tintGeo(g, c) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

let WHEEL_GEO = {};
function wheelGeo(r, w) {
  const key = r + '_' + w;
  if (WHEEL_GEO[key]) return WHEEL_GEO[key];
  const tire = tintGeo(new THREE.CylinderGeometry(r, r, w, 18).rotateZ(Math.PI / 2), [0.035, 0.035, 0.04]);
  const rim = tintGeo(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.02, 14).rotateZ(Math.PI / 2), [0.62, 0.65, 0.7]);
  const hub = tintGeo(new THREE.CylinderGeometry(r * 0.22, r * 0.22, w + 0.05, 8).rotateZ(Math.PI / 2), [0.1, 0.1, 0.11]);
  // five spokes as dark bars so the spin is readable
  const spokes = [];
  for (let i = 0; i < 5; i++) spokes.push(tintGeo(new THREE.BoxGeometry(w + 0.03, r * 0.08, r * 1.15).rotateX((i / 5) * Math.PI), [0.08, 0.08, 0.09]));
  const g = mergeGeometries([tire, rim, hub, ...spokes].map((x) => (x.index ? x.toNonIndexed() : x)), false);
  WHEEL_GEO[key] = g; return g;
}

// side profile (z forward, y up) extruded across the car width
function profile(pts, width, bevel = 0.05) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -(width - bevel * 2) / 2); g.rotateY(-Math.PI / 2);   // shape-x -> +Z, extrusion -> X
  return g;
}

const NEON = [0x20c0ff, 0xff30b0, 0x40ff90, 0xffa030, 0x9060ff, 0x2060ff];

/**
 * @param kind 'sedan' | 'taxi' | 'coupe' | 'truck'
 * @param color paint colour (hex)
 * @returns Group with userData { len, paint, tail, wheels, front, lamps, kind }
 */
export function makeCarModel(kind, color, neon = null) {
  const SHm = shared();
  const root = new THREE.Group();
  const chassis = new THREE.Group(); root.add(chassis);
  const parts = { paint: [], glass: [], trim: [], lamp: [], tail: [] };
  const put = (list, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, col = null) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(1, 1, 1));
    let g = geo.index ? geo.toNonIndexed() : geo.clone(); g.applyMatrix4(m);
    for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal' && n !== 'uv' && n !== 'color') g.deleteAttribute(n);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (col && !g.attributes.color) tintGeo(g, col);
    parts[list].push(g);
  };
  const paintCol = new THREE.Color(kind === 'taxi' ? 0xe2b21c : color);
  const dark = [0.045, 0.047, 0.055], chrome = [0.7, 0.73, 0.78];
  // a bar between two points in the (z, y) plane at lateral offset x
  const bar = (list, p0, p1, th, x, col) => {
    const dz = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.hypot(dz, dy);
    put(list, new THREE.BoxGeometry(th, th, len + th), x, (p0[1] + p1[1]) / 2, (p0[0] + p1[0]) / 2, -Math.atan2(dy, dz), 0, 0, col);
  };
  let L, Wd, wheelR, wheelW, wx, axles, headY, tailY;

  if (kind === 'truck') {
    L = 6.8; Wd = 2.3; wheelR = 0.46; wheelW = 0.32; wx = 1.02; axles = [[3.0, true], [-1.6, false], [-2.9, false]]; headY = 0.95; tailY = 1.1;
    put('trim', rb(2.0, 0.34, L - 0.3, 0.08), 0, 0.66, 0, 0, 0, 0, dark);                           // chassis rail
    put('paint', rb(2.25, 1.75, 2.15, 0.22), 0, 1.58, 2.35);                                         // cab
    put('glass', rb(2.0, 0.78, 0.1, 0.05), 0, 1.98, 3.42, -0.18);                                     // windscreen
    for (const s of [-1, 1]) put('glass', rb(0.06, 0.62, 1.0, 0.03), s * 1.13, 1.98, 2.55);           // side windows
    put('trim', rb(2.0, 0.34, 0.16, 0.05), 0, 0.95, 3.44, 0, 0, 0, dark);                             // bumper
    put('trim', rb(1.1, 0.4, 0.06, 0.03), 0, 1.38, 3.43, 0, 0, 0, chrome);                           // grille
    put('paint', rb(2.34, 2.5, 4.1, 0.14), 0, 2.0, -1.55);                                           // cargo box (tinted lighter below)
    put('trim', rb(2.36, 0.18, 4.12, 0.05), 0, 0.82, -1.55, 0, 0, 0, dark);                           // cargo skirt
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) put('trim', rb(0.05, 2.3, 0.1, 0.02), s * 1.18, 2.0, -3.3 + i * 0.95, 0, 0, 0, [0.07, 0.07, 0.08]);   // ribs
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) put('lamp', rb(0.06, 0.06, 0.18, 0.02), s * 1.16, 3.18, -3.0 + i * 1.5, 0, 0, 0, [3.0, 1.6, 0.2]);   // amber markers
    put('tail', rb(2.0, 0.12, 0.06, 0.03), 0, 1.0, -3.62);
  } else {
    const coupe = kind === 'coupe';
    L = coupe ? 4.5 : 4.6; Wd = coupe ? 2.0 : 1.9; wheelR = coupe ? 0.34 : 0.36; wheelW = coupe ? 0.3 : 0.26; wx = Wd / 2 + 0.0; axles = [[1.42, true], [-1.4, false]];
    const lowTop = coupe ? 0.82 : 0.94, lowBot = 0.28;
    headY = coupe ? 0.64 : 0.74; tailY = coupe ? 0.72 : 0.8;
    put('paint', rb(Wd, lowTop - lowBot, L, coupe ? 0.2 : 0.22), 0, (lowTop + lowBot) / 2, 0);        // lower body
    // greenhouse: dark glass extrusion + painted roof panel and pillars
    const cabW = Wd - 0.3;
    const pts = coupe ? [[-1.35, lowTop - 0.04], [-0.75, 1.2], [0.3, 1.22], [1.0, lowTop - 0.02]] : [[-1.3, lowTop - 0.04], [-0.95, 1.4], [0.5, 1.42], [1.02, lowTop - 0.02]];
    put('glass', profile(pts, cabW, 0.05));
    const roofY = coupe ? 1.235 : 1.435;
    put('paint', rb(cabW + 0.04, 0.07, pts[2][0] - pts[1][0] + 0.12, 0.03), 0, roofY, (pts[1][0] + pts[2][0]) / 2);
    for (const s of [-1, 1]) {
      const px = s * (cabW / 2 + 0.01);
      bar('paint', [pts[2][0], pts[2][1] - 0.02], [pts[3][0], pts[3][1]], 0.07, px);                      // A pillar
      bar('paint', [pts[0][0], pts[0][1]], [pts[1][0], pts[1][1] - 0.02], 0.07, px);                      // C pillar
      put('paint', rb(0.07, pts[1][1] - lowTop, 0.08, 0.02), px, (pts[1][1] + lowTop) / 2, coupe ? -0.2 : -0.12);   // B pillar
      put('trim', rb(0.11, 0.07, 0.2, 0.03), s * (Wd / 2 + 0.05), lowTop + 0.1, 0.62, 0, 0, 0, dark);   // mirror
    }
    // nose, grille, bumpers
    put('trim', rb(Wd - 0.1, 0.2, 0.2, 0.06), 0, 0.4, L / 2 - 0.04, 0, 0, 0, dark);
    put('trim', rb(Wd - 0.1, 0.2, 0.2, 0.06), 0, 0.4, -L / 2 + 0.04, 0, 0, 0, dark);
    put('trim', rb(0.95, 0.15, 0.06, 0.03), 0, headY - 0.04, L / 2 + 0.03, 0, 0, 0, [0.02, 0.02, 0.025]);
    put('trim', rb(0.8, 0.025, 0.07, 0.01), 0, headY + 0.07, L / 2 + 0.035, 0, 0, 0, chrome);
    // sills and wheel-arch brows
    for (const s of [-1, 1]) {
      put('trim', rb(0.06, 0.1, L - 1.9, 0.03), s * (Wd / 2 + 0.01), lowBot + 0.06, 0, 0, 0, 0, dark);
      for (const [az] of axles) put('trim', rb(0.12, 0.07, wheelR * 3.0, 0.03), s * (Wd / 2 - 0.02), lowTop - 0.05 + (coupe ? 0.0 : 0.02), az, 0, 0, 0, dark);
    }
    // door shut lines
    for (const s of [-1, 1]) for (const z of coupe ? [0.5] : [0.55, -0.68]) put('trim', new THREE.BoxGeometry(0.012, lowTop - lowBot - 0.14, 0.014), s * (Wd / 2 + 0.003), (lowTop + lowBot) / 2 + 0.02, z, 0, 0, 0, [0.02, 0.02, 0.025]);
    // headlights + DRL, tail lights
    for (const s of [-1, 1]) {
      put('lamp', rb(coupe ? 0.52 : 0.44, 0.1, 0.06, 0.03), s * (Wd / 2 - 0.34), headY + 0.03, L / 2 + 0.02, 0, 0, s * (coupe ? 0.08 : 0), [4.0, 3.7, 3.0]);
      put('lamp', rb(0.3, 0.025, 0.06, 0.01), s * (Wd / 2 - 0.34), headY - 0.06, L / 2 + 0.02, 0, 0, 0, [1.6, 2.0, 2.8]);
      put('tail', rb(0.4, 0.1, 0.06, 0.03), s * (Wd / 2 - 0.3), tailY, -L / 2 - 0.02);
    }
    put('tail', rb(Wd - 0.9, 0.05, 0.055, 0.02), 0, tailY, -L / 2 - 0.02);
    if (coupe) {   // spoiler
      for (const s of [-1, 1]) put('trim', rb(0.06, 0.24, 0.1, 0.02), s * 0.62, 1.0, -L / 2 + 0.42, 0, 0, 0, dark);
      put('paint', rb(Wd - 0.15, 0.05, 0.4, 0.02), 0, 1.14, -L / 2 + 0.38, -0.08);
    }
    if (kind === 'taxi') {   // roof sign
      put('lamp', rb(0.7, 0.2, 0.28, 0.06), 0, roofY + 0.14, -0.2, 0, 0, 0, [3.2, 2.4, 0.5]);
      put('trim', rb(0.74, 0.05, 0.32, 0.02), 0, roofY + 0.035, -0.2, 0, 0, 0, dark);
    }
    put('trim', rb(0.04, 0.5, 0.04, 0.01), -0.55, roofY + 0.28, -0.9, 0.35, 0, 0, dark);               // antenna
  }
  // underglow strip
  const nc = new THREE.Color(neon ?? NEON[Math.floor(Math.random() * NEON.length)]);
  if (kind !== 'truck' || Math.random() < 0.3) {
    put('lamp', new THREE.BoxGeometry(Wd - 0.55, 0.03, L - 1.3), 0, 0.15, 0, 0, 0, 0, [nc.r * 2.0, nc.g * 2.0, nc.b * 2.0]);
  }

  // ---- merge ----
  const paintMat = new THREE.MeshPhysicalMaterial({ color: paintCol, roughness: 0.34, metalness: 0.6, clearcoat: 0.9, clearcoatRoughness: 0.1 });
  const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.06, 0.05), toneMapped: false });
  const mats = { paint: paintMat, glass: SHm.glass, trim: SHm.trim, lamp: SHm.lamp, tail: tailMat };
  for (const [k, arr] of Object.entries(parts)) {
    if (!arr.length) continue;
    const useVC = k === 'trim' || k === 'lamp';
    for (const g of arr) if (useVC && !g.attributes.color) tintGeo(g, [0.1, 0.1, 0.11]);
    const geos = arr.map((g) => { if (!useVC && g.attributes.color) g.deleteAttribute('color'); return g; });
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), mats[k]);
    mesh.castShadow = k === 'paint' || k === 'glass'; chassis.add(mesh);
    if (k === 'lamp') mesh.userData.lamp = true;
    if (k === 'tail') mesh.userData.tail = true;
  }
  // ---- wheels ----
  const wheels = [], front = [];
  const wg = wheelGeo(wheelR, wheelW);
  for (const [az, steer] of axles) for (const s of [-1, 1]) {
    for (const dual of kind === 'truck' && az < 0 ? [0, 1] : [0]) {
      const piv = new THREE.Group(); piv.position.set(s * (wx - (dual ? 0.34 : 0)) + s * 0.0, wheelR, az); const w = new THREE.Mesh(wg, SHm.wheel); w.castShadow = true; piv.add(w); root.add(piv);
      wheels.push(w); if (steer) front.push(piv);
    }
  }
  root.userData = { len: L, wid: Wd, kind, paint: paintMat, tail: tailMat, wheels, front, wheelR, chassis, lampMesh: chassis.children.find((c) => c.userData.lamp), tailMesh: chassis.children.find((c) => c.userData.tail), neon: nc };
  return root;
}

export const CAR_KINDS = ['sedan', 'sedan', 'coupe', 'taxi', 'truck'];
