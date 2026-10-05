import * as THREE from 'three';
import { bake } from './charkit.js';
import { patchRim } from './shaders.js';
import { eagleShape } from './world.js';
import { makeCanvas, canvasTex } from './util.js';
import { heroTextures, ATLAS, atlasUV } from './charhero_tex.js';
import { Surf, loftGeo, sweepGeo, extrudeGeo, rrect, ellipse, roundPoly, lin, mergeGeos, deform, gauss, V } from './charhero_geo.js';

// ===========================================================================
// Dredd's weapons.
//   Lawgiver Mk II: machined slide over a polymer frame, ribbed barrel shroud with a ported muzzle brake,
//     top rail + sights, stippled raked grip with finger grooves, trigger guard, gold trim + eagle,
//     an illuminated ammo window (rear + side), an ammo ring round the barrel and an LED strip.
//     userData: muzzle (barrel tip), disp (the glowing mesh; .material.color is the ammo colour), setAmmo(hex)
//   Daystick: wrapped grip, gold guard ring + pommel, grooved steel shaft, electrified end cap.
//     userData: tipLocal / baseLocal (in `inner` space), tipMat (glowing material), inner (the rotated group)
// Frames: the hand grips the Lawgiver at the wrap origin (grip axis along +Y, barrel along +Z);
// the daystick shaft runs along the inner group's -Y with the hand at its origin.
// ===========================================================================

let GLOW_TEX = null;
function displayTexture() {
  if (GLOW_TEX) return GLOW_TEX;
  const [c, x] = makeCanvas(128, 64);
  x.fillStyle = '#000'; x.fillRect(0, 0, 128, 64);
  x.fillStyle = '#fff'; x.fillRect(96, 0, 32, 64);                         // solid swatch (ring / LED strip)
  x.fillStyle = '#1a1a1a'; x.fillRect(3, 3, 90, 58);
  x.fillStyle = '#fff'; x.font = 'bold 26px monospace'; x.textBaseline = 'middle'; x.fillText('88', 8, 22);
  for (let i = 0; i < 8; i++) { x.fillStyle = i < 6 ? '#fff' : '#555'; x.fillRect(8 + i * 10, 42, 7, 12); }
  x.fillStyle = '#bbb'; x.fillRect(58, 10, 30, 3); x.fillRect(58, 18, 22, 3); x.fillRect(58, 26, 26, 3);
  GLOW_TEX = canvasTex(c);
  return GLOW_TEX;
}
// remap a geometry's uvs to a sub-rect of the glow texture
const uvRect = (g, u0, v0, u1, v1) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0)); return g; };
const SOLID = [0.8, 0.1, 0.95, 0.9];

let WMATS = null;   // shared by every Lawgiver / daystick (the glowing parts get their own per-weapon material)
function weaponMats() {
  if (WMATS) return WMATS;
  const T = heroTextures();
  const rep = (t, r) => { const c = t.clone(); c.repeat.set(r, r); c.needsUpdate = true; return c; };
  const P = (o) => new THREE.MeshPhysicalMaterial(o);
  const m = {
    gunmetal: P({ color: 0x2e3138, metalness: 0.85, roughness: 0.95, roughnessMap: rep(T.brushedR, 5), clearcoat: 0.45, clearcoatRoughness: 0.2, envMapIntensity: 1.5 }),
    polymer: P({ color: 0x121317, metalness: 0.05, roughness: 0.6, normalMap: rep(T.gripN, 14), normalScale: new THREE.Vector2(0.7, 0.7), envMapIntensity: 1.0 }),
    gold: P({ color: 0xdcaa48, metalness: 1.0, roughness: 1.0, roughnessMap: rep(T.goldR, 6), emissive: 0x3a2508, emissiveIntensity: 0.5, envMapIntensity: 1.6 }),
    decal: new THREE.MeshStandardMaterial({ map: T.decal.map, roughnessMap: T.decal.mr, metalnessMap: T.decal.mr, roughness: 1, metalness: 1, envMapIntensity: 1.2 }),
  };
  patchRim(m.gunmetal, 0x7aa6ff, 3.0, 0.25); patchRim(m.polymer, 0x7aa6ff, 3.0, 0.25);
  WMATS = m;
  return m;
}
const put = (g, geo, mat) => { const mesh = new THREE.Mesh(geo, mat); g.add(mesh); return mesh; };
// side profile in (z, y) extruded across x (centred), beveled
function profileSolid(pts, width, bevel = 0.003) { const g = extrudeGeo(pts, width - 2 * bevel, { bevel, seg: 2 }); g.rotateY(-Math.PI / 2); return g; }
// solid of revolution about +Y from (r, y) pairs, with the winding forced outward whatever the profile direction
function revolve(pts, seg = 20) {
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  const p = g.attributes.position, ix = g.index.array, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let acc = 0;
  for (let i = 0; i < ix.length; i += 3) {
    a.fromBufferAttribute(p, ix[i]); b.fromBufferAttribute(p, ix[i + 1]); c.fromBufferAttribute(p, ix[i + 2]);
    const n = b.clone().sub(a).cross(c.clone().sub(a)), m = a.add(b).add(c).divideScalar(3); acc += n.x * m.x + n.z * m.z;
  }
  if (acc < 0) { for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } }
  g.computeVertexNormals();
  return g;
}
// solid of revolution about +Z from (r, z) pairs
function lathe(rz, seg = 20) { const g = revolve(rz, seg); g.rotateX(Math.PI / 2); return g; }
function box(w, h, d, x, y, z) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; }

export function buildLawgiver() {
  const M = weaponMats();
  const glow = new THREE.MeshBasicMaterial({ color: 0x40ff80, map: displayTexture(), toneMapped: false });
  const g = new THREE.Group();
  const BY = 0.082;   // barrel axis height above the grip centre
  // ---- slide
  put(g, profileSolid([[-0.078, 0.05], [0.236, 0.05], [0.236, 0.102], [0.196, 0.123], [-0.058, 0.123], [-0.078, 0.108]], 0.046, 0.004), M.gunmetal);
  for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) put(g, box(0.003, 0.05, 0.004, sx * 0.0235, 0.088, -0.066 + i * 0.008), M.gunmetal);   // rear serrations
  put(g, box(0.05, 0.012, 0.016, 0, 0.112, 0.178), M.gold);                                                                                       // gold band
  // ---- top rail + sights
  put(g, box(0.02, 0.008, 0.21, 0, 0.127, 0.068), M.gunmetal);
  for (let i = 0; i < 10; i++) put(g, box(0.024, 0.004, 0.008, 0, 0.133, -0.022 + i * 0.02), M.gunmetal);
  put(g, box(0.008, 0.016, 0.012, -0.009, 0.139, -0.058), M.gunmetal); put(g, box(0.008, 0.016, 0.012, 0.009, 0.139, -0.058), M.gunmetal);       // rear notch
  put(g, box(0.006, 0.02, 0.012, 0, 0.14, 0.205), M.gunmetal);                                                                                    // front post
  // ---- frame + trigger guard + trigger
  put(g, profileSolid([[-0.062, 0.014], [0.214, 0.014], [0.232, 0.03], [0.232, 0.054], [-0.062, 0.054]], 0.05, 0.004), M.polymer);
  {
    const path = new THREE.CatmullRomCurve3([V(0, 0.018, 0.028), V(0, -0.016, 0.034), V(0, -0.032, 0.062), V(0, -0.026, 0.1), V(0, 0.016, 0.112)]).getSpacedPoints(14);
    put(g, sweepGeo(path, rrect(0.016, 0.008, 0.003, 2), { up: V(1, 0, 0) }), M.polymer);
    const tr = new THREE.CatmullRomCurve3([V(0, 0.014, 0.058), V(0, -0.002, 0.064), V(0, -0.014, 0.06)]).getSpacedPoints(6);
    put(g, sweepGeo(tr, rrect(0.007, 0.004, 0.0015, 1), { up: V(1, 0, 0) }), M.gold);
  }
  // ---- raked grip with finger grooves + stippling, gold magazine base
  {
    const S = new Surf([
      { y: -0.118, rx: 0.016, rz: 0.028, cz: -0.032 },
      { y: -0.06, rx: 0.0175, rz: 0.031, cz: -0.018 },
      { y: 0.0, rx: 0.0178, rz: 0.031, cz: -0.004 },
      { y: 0.03, rx: 0.017, rz: 0.03, cz: 0.002 },
    ], { e: 2.7, mod: (a, y) => { const f = Math.max(0, Math.cos(a)); return -0.003 * f * f * (0.5 + 0.5 * Math.cos((y + 0.008) / 0.026 * Math.PI * 2)) * (y < 0.02 ? 1 : 0) + 0.003 * Math.max(0, -Math.cos(a)) * gauss(y, -0.03, 0.04); } });
    put(g, loftGeo(S, { ys: lin(-0.118, 0.03, 16), na: 20, cap0: 0.004, uvScale: 1 }), M.polymer);
    put(g, box(0.038, 0.012, 0.064, 0, -0.124, -0.033), M.gold);
  }
  // ---- barrel, ribbed shroud, ported muzzle brake, under-barrel emitter
  put(g, lathe([[0, 0.2], [0.0155, 0.2], [0.0155, 0.41], [0.011, 0.415], [0.011, 0.43], [0, 0.43]], 16).translate(0, BY, 0), M.gunmetal);
  {
    const prof = [[0.0, 0.234]];
    for (let i = 0; i < 6; i++) { const z = 0.24 + i * 0.022; prof.push([0.0255, z], [0.0255, z + 0.011], [0.0215, z + 0.013], [0.0215, z + 0.02]); }
    prof.push([0.024, 0.375], [0.0, 0.375]);
    put(g, lathe(prof, 14).translate(0, BY, 0), M.gunmetal);
  }
  put(g, profileSolid(roundPoly([[0.372, BY - 0.024], [0.436, BY - 0.024], [0.436, BY + 0.024], [0.372, BY + 0.024]], 0.006, 2), 0.05, 0.003), M.gunmetal);
  for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) put(g, box(0.004, 0.03, 0.008, sx * 0.0245, BY, 0.384 + i * 0.016), M.polymer);       // brake ports
  put(g, profileSolid([[0.226, 0.03], [0.33, 0.03], [0.342, 0.042], [0.342, 0.062], [0.226, 0.062]], 0.04, 0.003), M.polymer);                    // front frame
  put(g, lathe([[0, 0.3], [0.011, 0.3], [0.012, 0.345], [0.0, 0.345]], 12).translate(0, 0.045, 0), M.gunmetal);                                  // emitter housing
  // ---- glow: rear + side ammo windows, ammo ring round the barrel, LED strip along the right flank
  {
    const parts = [];
    const rear = new THREE.PlaneGeometry(0.034, 0.03); rear.rotateY(Math.PI); rear.translate(0, 0.088, -0.0835); parts.push(uvRect(rear, 0.0, 0.0, 0.75, 1.0));
    const side = new THREE.PlaneGeometry(0.06, 0.026); side.rotateY(Math.PI / 2); side.translate(0.0236, 0.088, -0.014); parts.push(uvRect(side, 0.0, 0.0, 0.75, 1.0));
    const ring = new THREE.TorusGeometry(0.0245, 0.0032, 6, 24); ring.translate(0, BY, 0.234); parts.push(uvRect(ring, ...SOLID));
    const led = new THREE.BoxGeometry(0.002, 0.004, 0.15); led.translate(-0.0238, 0.064, 0.09); parts.push(uvRect(led, ...SOLID));
    const lens = new THREE.CircleGeometry(0.009, 12); lens.translate(0, 0.045, 0.3455); parts.push(uvRect(lens, ...SOLID));
    put(g, mergeGeos(parts), glow);
  }
  // ---- markings (right flank) + gold eagle (left flank)
  { const d = new THREE.PlaneGeometry(0.15, 0.019); d.rotateY(-Math.PI / 2); d.translate(-0.0237, 0.1, 0.1); put(g, atlasUV(d, ATLAS.gunL), M.decal); }
  {
    const e = extrudeGeo(eagleShape().getPoints().map((p) => [p.x * 0.017, (p.y - 0.4) * 0.017]), 0.003, { bevel: 0.0008, seg: 1 });
    e.rotateY(Math.PI / 2); e.translate(0.0245, 0.094, 0.08); put(g, e, M.gold);
  }
  put(g, box(0.014, 0.018, 0.012, 0, 0.115, -0.084), M.gunmetal);   // hammer spur
  bake(g);
  const disp = g.children.find((o) => o.material === glow);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, BY, 0.44); g.add(muzzle);
  let last = -1;
  const setAmmo = (hex) => { if (hex === last) return; last = hex; glow.color.set(hex).multiplyScalar(1.6); };
  setAmmo(0x40ff80);
  const wrap = new THREE.Group(); wrap.add(g);
  wrap.userData = { muzzle, disp, setAmmo };
  wrap.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return wrap;
}

export function buildDaystick(len = 0.85, tip = 0xfff0a0) {
  const M = weaponMats();
  const tipMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(tip).multiplyScalar(2.0), toneMapped: false });
  const g = new THREE.Group();
  const yTip = -len * 0.85, yEnd = yTip + 0.045;
  // revolve about local Y: lathe in (r, y)
  const revY = revolve;
  // wrapped grip
  { const pts = [[0, 0.1]]; for (let i = 0; i <= 20; i++) { const y = 0.1 - i * 0.008; pts.push([0.0262 + 0.0028 * Math.abs(Math.sin(i * Math.PI / 2.0)), y]); } pts.push([0, 0.1 - 20 * 0.008]); put(g, revY(pts, 14), M.polymer); }
  put(g, revY([[0, 0.142], [0.012, 0.141], [0.026, 0.132], [0.031, 0.118], [0.03, 0.1], [0.0, 0.1]], 18), M.gold);                       // pommel
  put(g, new THREE.TorusGeometry(0.006, 0.0022, 5, 12).rotateY(Math.PI / 2).translate(0, 0.149, 0), M.gold);                             // lanyard loop
  put(g, revY([[0, -0.06], [0.03, -0.06], [0.036, -0.066], [0.036, -0.075], [0.03, -0.081], [0, -0.081]], 20), M.gold);                  // guard ring
  // grooved steel shaft, slight taper
  {
    const pts = [[0, -0.08]]; let y = -0.08;
    const n = 7, segL = (yEnd - 0.015 - y) / n;
    for (let i = 0; i < n; i++) { const r = 0.022 - (i / n) * 0.003; pts.push([r, y - 0.002], [r, y + segL + 0.004], [r - 0.002, y + segL + 0.0015], [r - 0.002, y + segL]); y += segL; }
    pts.push([0.019, yEnd - 0.012], [0.0, yEnd - 0.012]);
    put(g, revY(pts, 12), M.gunmetal);
  }
  // electrified end cap: steel collar with slots over a glowing core, glowing rings
  put(g, revY([[0, yEnd - 0.002], [0.025, yEnd - 0.002], [0.027, yEnd - 0.012], [0.025, yEnd - 0.03], [0, yEnd - 0.03]], 18), M.gunmetal);
  {
    const core = revY([[0, yEnd - 0.01], [0.019, yEnd - 0.012], [0.02, yTip + 0.006], [0.012, yTip], [0, yTip - 0.002]], 16);
    const r1 = new THREE.TorusGeometry(0.0225, 0.0028, 5, 20).rotateX(Math.PI / 2).translate(0, yEnd + 0.03, 0);
    const r2 = new THREE.TorusGeometry(0.0222, 0.0028, 5, 20).rotateX(Math.PI / 2).translate(0, yEnd + 0.05, 0);
    put(g, mergeGeos([core, r1, r2]), tipMat);
    for (let k = 0; k < 4; k++) { const f = box(0.006, 0.03, 0.008, 0, yEnd - 0.016, 0.02); f.rotateY((k / 4) * Math.PI * 2); put(g, f, M.gunmetal); }   // collar fins
  }
  bake(g);
  g.userData.tipLocal = new THREE.Vector3(0, -len * 0.35 - len / 2, 0);
  g.userData.baseLocal = new THREE.Vector3(0, -len * 0.35 - len * 0.1, 0);
  g.userData.tipMat = tipMat;
  g.rotation.x = -Math.PI / 2;   // along +z after the parent rotation
  const wrap = new THREE.Group(); wrap.add(g); wrap.userData = g.userData; wrap.userData.inner = g;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return wrap;
}
