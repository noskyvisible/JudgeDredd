import * as THREE from 'three';
import { patchRim } from './shaders.js';
import { eagleShape } from './world.js';
import { heroTextures, ATLAS, atlasUV } from './charhero_tex.js';
import {
  Surf, loftGeo, plateGeo, plateAY, bandGeo, rimGeo, chainGeo, driven, extrudeGeo, rivetGeo, frame, xf, deform, mirrorX, bakeHero, proxyOcclusion, stitchGeo,
  rrect, ellipse, roundPoly, sstep, gauss, lin, wrapA, TAU, V,
} from './charhero_geo.js';
import { buildHelmet, buildFace, fistGeos, ribbedPauldron, eaglePauldron, bootFootGeos, smoothBox } from './charhero_parts.js';

// ===========================================================================
// Hero: Judge Joe Dredd.  Built from lofted anatomy (super-ellipse cross-sections) wearing conformed
// armour plates with real thickness and rolled edges: glossy clearcoated black uniform and helmet,
// red visor, gold eagle crest, ribbed gold pauldron (left) and eagle-wing pauldron (right), gold chain
// to the chest badge, worn green leather gauntlets / belt / knee pads / boots, eagle buckle, holster.
// Pauldrons, elbow couters and knee cops ride on driven helper joints that follow a fraction of the
// limb's rotation, so armour stays seated through extreme poses.  Each joint's static parts are baked
// into one mesh per material (bake()).
// ===========================================================================

// On top of patchRim: baked vertex AO (colour.r) darkens albedo and the indirect specular / clearcoat / sheen,
// and an edge-wear mask (colour.g) scuffs plate edges (tint + roughness, and thins the clearcoat).
function patchHero(mat, { edgeTint = 0.3, edgeRough = 0.2, aoSpec = 0.85, aoAlbedo = 0.65 } = {}) {
  const prev = mat.onBeforeCompile;
  mat.vertexColors = true;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uEdgeTint = { value: edgeTint }; shader.uniforms.uEdgeRough = { value: edgeRough };
    shader.uniforms.uAOSpec = { value: aoSpec }; shader.uniforms.uAOAlbedo = { value: aoAlbedo };
    shader.fragmentShader = 'uniform float uEdgeTint; uniform float uEdgeRough; uniform float uAOSpec; uniform float uAOAlbedo;\n' + shader.fragmentShader
      .replace('#include <color_fragment>', `float heroAO = 1.0, heroEdge = 0.0;
#if defined( USE_COLOR )
  heroAO = vColor.r; heroEdge = vColor.g;
#endif
diffuseColor.rgb *= mix( 1.0, heroAO, uAOAlbedo );
diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * ( 1.0 + 3.0 * uEdgeTint ) + vec3( 0.035 * uEdgeTint ), heroEdge );`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp( roughnessFactor + uEdgeRough * heroEdge, 0.04, 1.0 );`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  material.clearcoat *= 1.0 - 0.55 * heroEdge * step( 0.0, uEdgeRough );
  material.clearcoatRoughness = clamp( material.clearcoatRoughness + 0.6 * max( uEdgeRough, 0.0 ) * heroEdge, 0.05, 1.0 );
#endif`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
{
  float sao = mix( 1.0, heroAO, uAOSpec );
  reflectedLight.indirectSpecular *= sao;
  reflectedLight.indirectDiffuse *= mix( 1.0, heroAO, 0.5 );
  #ifdef USE_CLEARCOAT
    clearcoatSpecularIndirect *= sao;
  #endif
  #ifdef USE_SHEEN
    sheenSpecularIndirect *= sao;
  #endif
}`);
  };
  mat.customProgramCacheKey = () => 'rim-v1+hero-ao-v1';
  return mat;
}

function heroMaterials() {
  const T = heroTextures();
  const rep = (tex, r) => { const t = tex.clone(); t.repeat.set(r, r); t.needsUpdate = true; return t; };
  const lN = rep(T.leatherN, 4.6), lR = rep(T.leatherR, 4.6), lN2 = rep(T.leatherN, 6.5), lR2 = rep(T.leatherR, 3.2);
  const gR = rep(T.goldR, 3.0), gN = rep(T.goldN, 3.0), dS = rep(T.dropsN, 5.5), dH = rep(T.dropsN, 4.2);
  const P = (o) => new THREE.MeshPhysicalMaterial(o);
  const M = {
    // glossy black uniform: lacquered leather plates, a grain you only catch in the highlights
    suit: P({ color: 0x0b0c10, roughness: 0.44, metalness: 0.0, roughnessMap: lR, normalMap: lN, normalScale: new THREE.Vector2(0.45, 0.45),
      clearcoat: 1.0, clearcoatRoughness: 0.13, clearcoatNormalMap: dS, clearcoatNormalScale: new THREE.Vector2(0.45, 0.45), envMapIntensity: 1.7 }),   // rain beads on the lacquer
    // matte undersuit at the joints
    under: P({ color: 0x0f1015, roughness: 0.62, metalness: 0.0, roughnessMap: lR2, normalMap: lN2, normalScale: new THREE.Vector2(0.8, 0.8),
      clearcoat: 0.25, clearcoatRoughness: 0.45, sheen: 0.5, sheenColor: new THREE.Color(0x3a4258), sheenRoughness: 0.55, envMapIntensity: 1.1 }),
    helmet: P({ color: 0x07080b, roughness: 0.28, metalness: 0.1, clearcoat: 1.0, clearcoatRoughness: 0.05, clearcoatNormalMap: dH, clearcoatNormalScale: new THREE.Vector2(0.55, 0.55), envMapIntensity: 2.0 }),
    gold: P({ color: 0xdcaa48, roughness: 1.0, metalness: 1.0, roughnessMap: gR, normalMap: gN, normalScale: new THREE.Vector2(0.35, 0.35),
      emissive: 0x3a2508, emissiveIntensity: 0.6, envMapIntensity: 1.6 }),
    goldDark: P({ color: 0xa87a2c, roughness: 1.0, metalness: 1.0, roughnessMap: gR, normalMap: gN, normalScale: new THREE.Vector2(0.35, 0.35),
      emissive: 0x281a05, emissiveIntensity: 0.55, envMapIntensity: 1.4 }),
    green: P({ color: 0x2e6232, roughness: 0.58, metalness: 0.0, roughnessMap: lR, normalMap: lN, normalScale: new THREE.Vector2(0.9, 0.9),
      clearcoat: 0.35, clearcoatRoughness: 0.32, sheen: 0.35, sheenColor: new THREE.Color(0x6a9a5a), sheenRoughness: 0.5, envMapIntensity: 1.25 }),
    greenDark: P({ color: 0x1b3f20, roughness: 0.6, metalness: 0.0, roughnessMap: lR, normalMap: lN, normalScale: new THREE.Vector2(1.0, 1.0),
      clearcoat: 0.3, clearcoatRoughness: 0.35, envMapIntensity: 1.15 }),
    visor: P({ color: 0x2a0303, roughness: 0.06, metalness: 0.2, clearcoat: 1.0, clearcoatRoughness: 0.02, emissive: 0xff2a14, emissiveMap: T.visorE,
      emissiveIntensity: 1.6, envMapIntensity: 2.2 }),
    skin: P({ color: 0xffffff, map: T.skin, roughness: 0.55, normalMap: rep(T.skinN, 1), normalScale: new THREE.Vector2(0.35, 0.35),
      sheen: 0.3, sheenColor: new THREE.Color(0xff9a7a), sheenRoughness: 0.4, envMapIntensity: 0.8 }),
    metal: P({ color: 0x2c2e34, roughness: 0.9, metalness: 0.9, roughnessMap: rep(T.brushedR, 6), envMapIntensity: 1.4 }),
    rubber: P({ color: 0x0b0b0c, roughness: 0.82, metalness: 0.0, normalMap: lN2, normalScale: new THREE.Vector2(0.6, 0.6), envMapIntensity: 0.6 }),
    decal: new THREE.MeshStandardMaterial({ map: T.decal.map, roughnessMap: T.decal.mr, metalnessMap: T.decal.mr, roughness: 1, metalness: 1,
      emissive: 0x2a1a04, emissiveMap: T.decal.map, emissiveIntensity: 0.3, envMapIntensity: 1.5 }),
  };
  for (const k of ['suit', 'under', 'helmet', 'gold', 'goldDark', 'green', 'greenDark', 'skin', 'metal']) patchRim(M[k], 0x7aa6ff, 3.2, k === 'gold' || k === 'goldDark' ? 0.22 : 0.32);
  // edge wear per material: scuffed lacquer on black, rubbed-bright leather on green, polished edges on gold
  const wear = { suit: [0.45, 0.22], under: [0.2, 0.15], helmet: [0.35, 0.18], gold: [0.22, -0.12], goldDark: [0.35, -0.12], green: [0.5, 0.18], greenDark: [0.45, 0.18], skin: [0.0, 0.0], metal: [0.6, -0.1], rubber: [0.25, 0.1], visor: [0.0, 0.0] };
  for (const [k, [et, er]] of Object.entries(wear)) patchHero(M[k], { edgeTint: et, edgeRough: er, aoAlbedo: k === 'visor' ? 0.3 : 0.65 });
  return M;
}

const put = (g, geo, mat) => { const m = new THREE.Mesh(geo, mat); g.add(m); return m; };
const putAll = (g, list) => { for (const [geo, mat] of list) put(g, geo, mat); };
// shield outline (badge / buckle), centred, CCW
function shield(w, h, n = 10) {
  const pts = [[-w / 2, h / 2], [-w / 2, h / 2 - 0.6 * h]];
  for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; pts.push([u * u * (-w / 2) + 2 * u * t * (-w / 2) + t * t * 0, u * u * (h / 2 - 0.6 * h) + 2 * u * t * (-h / 2 + 0.1 * h) + t * t * (-h / 2)]); }
  for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; pts.push([u * u * 0 + 2 * u * t * (w / 2) + t * t * (w / 2), u * u * (-h / 2) + 2 * u * t * (-h / 2 + 0.1 * h) + t * t * (h / 2 - 0.6 * h)]); }
  pts.push([w / 2, h / 2]);
  return pts.reverse();   // -> CCW
}

export function buildHero(ch, st) {
  const M = heroMaterials();
  ch.mats = { armor: M.suit, under: M.under, gold: M.gold, skin: M.skin, boots: M.green };
  const { hips, torso, chest, neck, head } = ch;
  const groups = [hips, torso, chest, neck, head];

  // =================================================================== pelvis + utility belt (hips)
  const pelvis = new Surf([
    { y: -0.215, rx: 0.07, rz: 0.08, cz: 0.0 },
    { y: -0.19, rx: 0.14, rz: 0.12, cz: -0.004 },
    { y: -0.13, rx: 0.238, rz: 0.158, cz: -0.006 },
    { y: -0.06, rx: 0.282, rz: 0.176, cz: -0.01 },
    { y: 0.02, rx: 0.285, rz: 0.178, cz: -0.012 },
    { y: 0.1, rx: 0.272, rz: 0.17, cz: -0.012 },
    { y: 0.15, rx: 0.266, rz: 0.166, cz: -0.012 },
  ], { e: 2.3, mod: (a, y) => 0.013 * (gauss(wrapA(a - Math.PI), 0.42, 0.3) + gauss(wrapA(a - Math.PI), -0.42, 0.3)) * gauss(y, -0.1, 0.05) });
  put(hips, loftGeo(pelvis, { ys: lin(-0.215, 0.15, 14), na: 44, cap0: 0.01 }), M.suit);
  put(hips, bandGeo(pelvis, -0.045, 0.085, { t: 0.03, r: 0.012, na: 64 }), M.green);
  for (const y of [-0.035, 0.075]) put(hips, bandGeo(pelvis, y - 0.0035, y + 0.0035, { t: 0.003, h0: 0.03, r: 0.0014, na: 48, nc: 1 }), M.greenDark);
  for (const y of [-0.026, 0.066]) put(hips, stitchGeo(pelvis, lin(0, TAU, 97).map((a) => [a, y]), { h: 0.0306, spacing: 0.012 }), M.greenDark);
  // eagle-shield buckle
  put(hips, plateGeo(pelvis, rrect(0.19, 0.145, 0.024), { center: [0, 0.02], t: 0.018, h0: 0.03, bevel: 0.007, crown: 0.004 }), M.gold);
  put(hips, atlasUV(plateGeo(pelvis, rrect(0.15, 0.112, 0.014), { center: [0, 0.02], t: 0.003, h0: 0.05, bevel: 0.0012, uv: 'box', n: 40, nI: 2 }), ATLAS.buckle), M.decal);
  {
    const shp = eagleShape().getPoints().map((p) => [p.x * 0.052, (p.y - 0.4) * 0.052]);
    let g = extrudeGeo(shp, 0.008, { bevel: 0.002, seg: 1 });
    g = deform(g, (v) => { v.z -= (v.x * v.x) / (2 * 0.3); }, { smooth: false });
    const p = pelvis.at(0, 0.024, 0.058); put(hips, xf(g, frame(p, V(0, 1, 0), pelvis.nrm(0, 0.024))), M.gold);
  }
  // pouches all round: pillow-shaped plates conformed to the belt, each with a lid flap and a gold snap
  const pouch = (a, y, w, h, d) => {
    put(hips, plateGeo(pelvis, rrect(w, h, 0.016, 3), { center: [a, y], t: d, h0: 0.026, bevel: 0.014, crown: 0.008, n: 20, nI: 2, nB: 2 }), M.green);
    put(hips, plateGeo(pelvis, roundPoly([[-w / 2 - 0.004, -h * 0.05], [w / 2 + 0.004, -h * 0.05], [w / 2 + 0.004, h * 0.52], [-w / 2 - 0.004, h * 0.52]], [0.012, 0.012, 0.006, 0.006], 3), { center: [a, y + h * 0.04], t: 0.008, h0: 0.026 + d + 0.002, bevel: 0.003, crown: 0.004, n: 16, nI: 1, nB: 1, sink: 0.012 }), M.greenDark);
    put(hips, xf(rivetGeo(0.0075, 0.6, 7), frame(pelvis.at(a, y + h * 0.02, 0.026 + d + 0.011), pelvis.nrm(a, y))), M.gold);
  };
  for (const sx of [1, -1]) {
    pouch(sx * 0.6, 0.012, 0.085, 0.1, 0.045);
    pouch(sx * 0.98, 0.016, 0.075, 0.112, 0.05);
    pouch(sx * 2.42, 0.014, 0.096, 0.094, 0.045);
    // Lawgiver magazines in a triple carrier on the left hip, cuffs case on the right
    if (sx > 0) for (let i = 0; i < 3; i++) { const a = 1.28 + i * 0.13; put(hips, xf(smoothBox(0.036, 0.03, 0.09, 0.008), frame(pelvis.at(a, 0.03, 0.045), pelvis.nrm(a, 0.03), V(0, 1, 0))), M.metal); put(hips, xf(smoothBox(0.04, 0.034, 0.02, 0.006), frame(pelvis.at(a, 0.08, 0.047), pelvis.nrm(a, 0.03), V(0, 1, 0))), M.gold); }
    else { const a = -1.4; put(hips, xf(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 16, 1).rotateX(Math.PI / 2), frame(pelvis.at(a, 0.02, 0.058), V(0, 1, 0), pelvis.nrm(a, 0.02))), M.greenDark); put(hips, xf(new THREE.TorusGeometry(0.038, 0.006, 5, 16), frame(pelvis.at(a, 0.02, 0.084), V(0, 1, 0), pelvis.nrm(a, 0.02))), M.metal); }
  }
  pouch(Math.PI, 0.016, 0.17, 0.08, 0.04);
  // drop strap toward the thigh holster
  put(hips, plateAY(pelvis, [[-1.62, -0.16], [-1.3, -0.16], [-1.32, -0.03], [-1.6, -0.03]], { round: 0.008, t: 0.008, h0: 0.028 }), M.greenDark);

  // =================================================================== abdomen (torso joint)
  const abd = new Surf([
    { y: -0.12, rx: 0.262, rz: 0.16, cz: -0.012 },
    { y: 0.0, rx: 0.252, rz: 0.158, cz: -0.008 },
    { y: 0.12, rx: 0.262, rz: 0.164, cz: -0.002 },
    { y: 0.22, rx: 0.288, rz: 0.176, cz: 0.0 },
    { y: 0.34, rx: 0.318, rz: 0.186, cz: 0.0 },
  ], { e: 2.3, mod: (a) => -0.008 * gauss(wrapA(a - Math.PI), 0, 0.09) });
  put(torso, loftGeo(abd, { ys: lin(-0.12, 0.34, 10), na: 44 }), M.under);
  for (let k = 0; k < 3; k++) {   // segmented abdominal lames, each overlapping the one below
    const y0 = 0.0 + k * 0.083, y1 = y0 + 0.098;
    put(torso, plateAY(abd, [[-1.72, y0], [1.72, y0], [1.72, y1], [-1.72, y1]], { round: 0.03, t: 0.014, h0: 0.003 + k * 0.006, bevel: 0.006, crown: 0.003, nI: 2, n: 40, nB: 2 }), M.suit);
  }
  for (let k = 0; k < 2; k++) { const y0 = 0.02 + k * 0.085, y1 = y0 + 0.1; put(torso, plateAY(abd, [[Math.PI - 1.2, y0], [Math.PI + 1.2, y0], [Math.PI + 1.2, y1], [Math.PI - 1.2, y1]], { round: 0.03, t: 0.014, h0: 0.003 + k * 0.006, bevel: 0.006, crown: 0.003, nI: 2, n: 36, nB: 2 }), M.suit); }

  // =================================================================== chest
  const chestMod = (a, y) => {
    const A = Math.abs(a), b = wrapA(a - Math.PI);
    let m = 0.022 * gauss(A, 0.42, 0.32) * gauss(y, 0.2, 0.1) * sstep(0.04, 0.12, y);    // pecs
    m -= 0.006 * gauss(a, 0, 0.06) * sstep(0.03, 0.08, y) * (1 - sstep(0.36, 0.44, y));   // sternum
    m += 0.02 * gauss(Math.abs(b), 1.05, 0.3) * gauss(y, 0.12, 0.12);                      // lats
    m += 0.014 * gauss(Math.abs(b), 0.55, 0.22) * gauss(y, 0.29, 0.08);                    // scapulae
    m -= 0.01 * gauss(b, 0, 0.08);                                                          // spine
    return m;
  };
  const chestS = new Surf([
    { y: -0.1, rx: 0.3, rz: 0.186, cz: 0.0 },
    { y: -0.02, rx: 0.325, rz: 0.194, cz: 0.004 },
    { y: 0.08, rx: 0.368, rz: 0.206, cz: 0.008 },
    { y: 0.18, rx: 0.405, rz: 0.214, cz: 0.008 },
    { y: 0.27, rx: 0.428, rz: 0.212, cz: 0.002 },
    { y: 0.35, rx: 0.424, rz: 0.2, cz: -0.01 },
    { y: 0.42, rx: 0.37, rz: 0.184, cz: -0.022 },
    { y: 0.48, rx: 0.27, rz: 0.162, cz: -0.028 },
    { y: 0.53, rx: 0.178, rz: 0.14, cz: -0.03 },
    { y: 0.56, rx: 0.14, rz: 0.128, cz: -0.028 },
  ], { e: 2.6, mod: chestMod });
  put(chest, loftGeo(chestS, { ys: lin(-0.1, 0.56, 20), na: 52, cap0: 0.06, capSeg: 3 }), M.under);
  // pectoral plates with a zipped centre channel
  const pec = [[0.085, 0.43], [0.08, 0.1], [0.2, 0.045], [0.55, 0.032], [0.9, 0.07], [1.12, 0.16], [1.18, 0.3], [1.02, 0.41], [0.62, 0.46], [0.3, 0.468]];
  for (const sx of [1, -1]) put(chest, plateAY(chestS, pec.map(([a, y]) => [a * sx, y]), { smooth: true, n: 48, t: 0.014, h0: 0.0, bevel: 0.0065, crown: 0.008, nI: 4 }), M.suit);
  put(chest, plateGeo(chestS, rrect(0.022, 0.52, 0.007), { center: [0, 0.2], t: 0.006, h0: 0.0, bevel: 0.0025, nI: 3 }), M.metal);
  for (let i = 0; i < 11; i++) { const y = -0.03 + i * 0.044; put(chest, xf(new THREE.BoxGeometry(0.02, 0.008, 0.006), frame(chestS.at(0, y, 0.007), chestS.nrm(0, y), V(0, 1, 0))), M.metal); }
  // rivets along the outer pec edges
  for (const sx of [1, -1]) for (const [a, y] of [[1.06, 0.18], [1.1, 0.27], [1.0, 0.37], [0.95, 0.1], [0.6, 0.06]]) put(chest, xf(rivetGeo(0.0075, 0.6, 7), frame(chestS.at(sx * a, y, 0.016), chestS.nrm(sx * a, y))), M.metal);
  // back: scapular plate over a lower lame, vertebra guards down the spine, rivets
  const bp = [[Math.PI - 1.26, 0.2], [Math.PI - 0.7, 0.17], [Math.PI, 0.16], [Math.PI + 0.7, 0.17], [Math.PI + 1.26, 0.2], [Math.PI + 1.24, 0.34], [Math.PI + 0.95, 0.46], [Math.PI + 0.45, 0.515], [Math.PI, 0.52], [Math.PI - 0.45, 0.515], [Math.PI - 0.95, 0.46], [Math.PI - 1.24, 0.34]];
  put(chest, plateAY(chestS, bp, { smooth: true, n: 56, t: 0.017, h0: 0.0, bevel: 0.007, crown: 0.008, nI: 4 }), M.suit);
  put(chest, plateAY(chestS, [[Math.PI - 1.28, 0.0], [Math.PI + 1.28, 0.0], [Math.PI + 1.3, 0.2], [Math.PI - 1.3, 0.2]], { round: 0.035, t: 0.014, h0: -0.002, bevel: 0.006, crown: 0.004, nI: 2, n: 40, nB: 2 }), M.suit);
  for (let i = 0; i < 5; i++) { const y = 0.46 - i * 0.085; put(chest, plateAY(chestS, [[Math.PI - 0.07, y - 0.034], [Math.PI + 0.07, y - 0.034], [Math.PI + 0.055, y + 0.034], [Math.PI - 0.055, y + 0.034]], { round: 0.012, t: 0.012, h0: 0.017, bevel: 0.005, crown: 0.003, nI: 1, n: 16, nB: 2 }), M.suit); }
  for (const sx of [1, -1]) for (const [b, y] of [[1.15, 0.24], [1.18, 0.33], [0.92, 0.44], [1.18, 0.1]]) { const a = Math.PI + sx * b; put(chest, xf(rivetGeo(0.008, 0.6, 7), frame(chestS.at(a, y, 0.019), chestS.nrm(a, y))), M.metal); }
  // high collar: low under the chin, tall at the back
  const collarS = new Surf([
    { y: 0.42, rx: 0.205, rz: 0.19, cz: -0.03 },
    { y: 0.5, rx: 0.19, rz: 0.178, cz: -0.033 },
    { y: 0.58, rx: 0.177, rz: 0.17, cz: -0.036 },
    { y: 0.66, rx: 0.173, rz: 0.168, cz: -0.038 },
  ], { e: 2.2 });
  put(chest, bandGeo(collarS, 0.425, (a) => 0.445 + 0.17 * Math.pow((1 - Math.cos(a)) / 2, 0.75), { t: 0.03, r: 0.013, na: 44 }), M.suit);
  // chest badge + gold chain from the eagle pauldron
  put(chest, plateGeo(chestS, shield(0.142, 0.172), { center: [0.52, 0.27], t: 0.01, h0: 0.016, bevel: 0.004, crown: 0.003, n: 44, nI: 3 }), M.gold);
  put(chest, atlasUV(plateGeo(chestS, shield(0.122, 0.15), { center: [0.52, 0.272], t: 0.0025, h0: 0.0265, bevel: 0.001, uv: 'box', n: 44, nI: 2, nB: 1 }), ATLAS.badge), M.decal);
  {
    const a0 = -1.12, y0 = 0.43, a1 = 0.38, y1 = 0.335, path = [];
    for (let i = 0; i <= 16; i++) { const t = i / 16; path.push(chestS.at(a0 + (a1 - a0) * t, y0 + (y1 - y0) * t - 0.13 * Math.sin(Math.PI * t), 0.034)); }
    put(chest, chainGeo(path, { link: 0.019, wire: 0.0052, tube: 4, rad: 8 }), M.gold);
    put(chest, xf(rivetGeo(0.014, 0.6, 10), frame(chestS.at(a0, y0, 0.026), chestS.nrm(a0, y0))), M.gold);
  }

  // =================================================================== neck + head
  put(neck, loftGeo(new Surf([{ y: -0.14, rx: 0.115, rz: 0.12, cz: -0.02 }, { y: 0.14, rx: 0.108, rz: 0.112, cz: -0.02 }]), { ys: lin(-0.14, 0.14, 4), na: 24 }), M.under);
  putAll(head, buildHelmet(M));
  putAll(head, buildFace(M));

  // =================================================================== arms
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? 1 : -1, sh = ch['sh' + side], el = ch['el' + side], hand = ch['hand' + side];
    sh.position.set(sx * 0.52, 0.36, 0);
    groups.push(sh, el, hand);
    // upper arm: deltoid dome into biceps / triceps
    const ua = new Surf([
      { y: -0.45, rx: 0.084, rz: 0.088 },
      { y: -0.38, rx: 0.094, rz: 0.098 },
      { y: -0.3, rx: 0.109, rz: 0.113, cz: 0.006 },
      { y: -0.2, rx: 0.124, rz: 0.13, cz: 0.014 },
      { y: -0.1, rx: 0.133, rz: 0.135, cz: 0.006, cx: sx * 0.01 },
      { y: -0.02, rx: 0.138, rz: 0.138, cx: sx * 0.012 },
      { y: 0.04, rx: 0.13, rz: 0.131, cx: sx * 0.009 },
      { y: 0.095, rx: 0.09, rz: 0.092, cx: sx * 0.003 },
      { y: 0.132, rx: 0.0, rz: 0.0 },
    ], { e: 2.1, mod: (a) => -0.0035 * gauss(wrapA(a - sx * Math.PI / 2), 0, 0.05) });
    put(sh, loftGeo(ua, { ys: [...lin(-0.45, 0.04, 11), 0.07, 0.095, 0.112, 0.124, 0.132], na: 30 }), M.suit);
    // elbow couter on a helper joint that takes half the elbow bend
    const cop = driven(sh, (g) => { g.position.set(0, -0.38, 0); g.rotation.set(el.rotation.x * 0.5, 0, 0); }, 'couter' + side);
    groups.push(cop);
    const eS = new Surf([{ y: -0.12, rx: 0.094, rz: 0.096 }, { y: 0.0, rx: 0.103, rz: 0.106 }, { y: 0.12, rx: 0.098, rz: 0.101 }], { e: 2.1 });
    put(cop, plateAY(eS, [[Math.PI - 1.15, -0.075], [Math.PI + 1.15, -0.075], [Math.PI + 1.15, 0.08], [Math.PI - 1.15, 0.08]], { round: 0.035, t: 0.016, h0: 0.003, bevel: 0.007, crown: 0.012, nI: 4 }), M.suit);
    put(cop, plateAY(eS, [[Math.PI - 0.95, 0.07], [Math.PI + 0.95, 0.07], [Math.PI + 0.9, 0.125], [Math.PI - 0.9, 0.125]], { round: 0.02, t: 0.011, h0: 0.0, bevel: 0.005, nI: 3 }), M.suit);
    put(cop, xf(rivetGeo(0.009, 0.6, 8), frame(eS.at(Math.PI, 0.0, 0.03), eS.nrm(Math.PI, 0))), M.metal);
    // forearm + flared green gauntlet with straps
    const fa = new Surf([{ y: -0.4, rx: 0.06, rz: 0.052 }, { y: -0.34, rx: 0.065, rz: 0.057 }, { y: -0.22, rx: 0.079, rz: 0.073 }, { y: -0.1, rx: 0.092, rz: 0.09, cz: 0.004 }, { y: -0.02, rx: 0.094, rz: 0.094 }, { y: 0.05, rx: 0.09, rz: 0.092 }, { y: 0.1, rx: 0.064, rz: 0.064 }], { e: 2.1 });
    put(el, loftGeo(fa, { ys: lin(-0.38, 0.1, 10), na: 28 }), M.under);
    const gS = new Surf([{ y: -0.4, rx: 0.073, rz: 0.065 }, { y: -0.34, rx: 0.078, rz: 0.07 }, { y: -0.26, rx: 0.09, rz: 0.084 }, { y: -0.17, rx: 0.102, rz: 0.098 }, { y: -0.1, rx: 0.11, rz: 0.106 }, { y: -0.068, rx: 0.119, rz: 0.116 }], { e: 2.3 });
    put(el, loftGeo(gS, { ys: lin(-0.4, -0.068, 10), na: 32 }), M.green);
    put(el, loftGeo(gS, { ys: lin(-0.15, -0.068, 3), na: 32, h: -0.007, flip: true }), M.greenDark);
    put(el, rimGeo(gS, lin(0, TAU, 33).slice(0, 32).map((a) => [a, -0.071]), 0.009, -0.0035, { closed: true, seg: 6 }), M.greenDark);
    put(el, stitchGeo(gS, lin(0, TAU, 49).map((a) => [a, -0.088]), { spacing: 0.011 }), M.greenDark);
    put(el, stitchGeo(gS, lin(0, TAU, 49).map((a) => [a, -0.375]), { spacing: 0.011 }), M.greenDark);
    for (const y of [-0.31, -0.2]) {
      put(el, bandGeo(gS, y, y + 0.026, { t: 0.0075, r: 0.003, na: 24, nc: 2 }), M.greenDark);
      put(el, plateGeo(gS, rrect(0.034, 0.034, 0.006, 2), { center: [sx * Math.PI / 2, y + 0.013], t: 0.006, h0: 0.0075, bevel: 0.002, n: 24, nI: 2 }), M.gold);
      put(el, plateGeo(gS, rrect(0.012, 0.02, 0.004, 2), { center: [sx * Math.PI / 2, y + 0.013], t: 0.004, h0: 0.0135, bevel: 0.0015, n: 16, nI: 2 }), M.greenDark);
    }
    // hand
    const fist = fistGeos(M);
    if (sx < 0) for (const [g] of fist) mirrorX(g);
    putAll(hand, fist);
  }
  // pauldrons on helper joints that follow part of the arm's swing
  const pd = (side, kx, ky, kz) => {
    const sh = ch['sh' + side], sx = side === 'L' ? 1 : -1;
    const g = driven(chest, (o) => { o.position.set(sx * 0.52, 0.36, 0); o.rotation.set(sh.rotation.x * kx, sh.rotation.y * ky, sh.rotation.z * kz, 'YXZ'); }, 'pauldron' + side);
    groups.push(g); return g;
  };
  putAll(pd('L', 0.3, 0.3, 0.5), ribbedPauldron(M, 1));
  putAll(pd('R', 0.36, 0.3, 0.5), eaglePauldron(M, -1));

  // =================================================================== legs
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? 1 : -1, hp = ch['hip' + side], kn = ch['kn' + side], an = ch['an' + side];
    hp.position.set(sx * 0.17, -0.08, 0);
    groups.push(hp, kn, an);
    const thighMod = (a, y) => {
      const out = wrapA(a - sx * Math.PI / 2);
      return 0.012 * gauss(a, 0.15 * sx, 0.55) * gauss(y, -0.2, 0.12)        // quads
        + 0.01 * gauss(a, -sx * 0.75, 0.3) * gauss(y, -0.38, 0.06)           // vastus medialis
        + 0.01 * gauss(Math.abs(wrapA(a - Math.PI)), 0.3, 0.4) * gauss(y, -0.15, 0.12)   // hamstrings
        - 0.005 * gauss(out, 0, 0.045) - 0.0035 * gauss(wrapA(a + sx * Math.PI / 2), 0, 0.045)   // outer + inner seams
        - 0.004 * (gauss(y, -0.17, 0.008) + gauss(y, -0.29, 0.008)) * Math.max(0, Math.cos(a - 0.15 * sx)) ** 2;   // quilted front panel
    };
    const th = new Surf([
      { y: -0.53, rx: 0.098, rz: 0.104 },
      { y: -0.44, rx: 0.106, rz: 0.112, cz: 0.004 },
      { y: -0.34, rx: 0.128, rz: 0.132, cz: 0.01 },
      { y: -0.22, rx: 0.144, rz: 0.15, cz: 0.013 },
      { y: -0.1, rx: 0.153, rz: 0.159, cz: 0.008, cx: -sx * 0.004 },
      { y: 0.0, rx: 0.154, rz: 0.16, cx: -sx * 0.01 },
      { y: 0.07, rx: 0.136, rz: 0.146, cz: -0.004, cx: -sx * 0.012 },
      { y: 0.12, rx: 0.094, rz: 0.104, cz: -0.006, cx: -sx * 0.01 },
      { y: 0.148, rx: 0.0, rz: 0.0, cx: -sx * 0.008 },
    ], { e: 2.15, mod: thighMod });
    put(hp, loftGeo(th, { ys: [...lin(-0.53, -0.36, 4), -0.33, -0.3, -0.29, -0.28, -0.25, -0.21, -0.18, -0.17, -0.16, -0.13, -0.08, -0.03, 0.02, 0.07, 0.1, 0.12, 0.136, 0.148], na: 36 }), M.suit);
    // knee cop: helper joint with half the knee bend
    const kc = driven(hp, (g) => { g.position.set(0, -0.46, 0); g.rotation.set(kn.rotation.x * 0.5, 0, 0); }, 'knee' + side);
    groups.push(kc);
    const kS = new Surf([{ y: -0.13, rx: 0.1, rz: 0.11, cz: 0.012 }, { y: 0.0, rx: 0.112, rz: 0.122, cz: 0.02 }, { y: 0.13, rx: 0.114, rz: 0.12, cz: 0.012 }], { e: 2.2 });
    put(kc, plateAY(kS, [[-1.05, -0.105], [1.05, -0.105], [1.05, 0.12], [-1.05, 0.12]], { round: 0.04, t: 0.03, h0: 0.006, bevel: 0.013, crown: 0.016, nI: 4, n: 40 }), M.green);
    put(kc, plateGeo(kS, ellipse(0.046, 0.062, 24), { center: [0, 0.008], t: 0.012, h0: 0.046, bevel: 0.0055, crown: 0.006, n: 24, nI: 2 }), M.greenDark);
    for (const [a, y] of [[-0.62, -0.06], [0.62, -0.06], [-0.62, 0.08], [0.62, 0.08]]) put(kc, xf(rivetGeo(0.009, 0.65, 8), frame(kS.at(a, y, 0.047), kS.nrm(a, y))), M.gold);
    put(kc, bandGeo(kS, 0.02, 0.05, { t: 0.008, r: 0.003, a0: 1.0, a1: TAU - 1.0, na: 16, nc: 2 }), M.greenDark);
    // shin (mostly inside the boot) + tall green boot
    put(kn, loftGeo(new Surf([{ y: -0.2, rx: 0.088, rz: 0.094, cz: -0.012 }, { y: -0.06, rx: 0.095, rz: 0.102, cz: -0.008 }, { y: 0.02, rx: 0.098, rz: 0.102 }, { y: 0.08, rx: 0.084, rz: 0.088 }], { e: 2.1 }), { ys: lin(-0.2, 0.08, 5), na: 28 }), M.under);   // knee region above the boot (kept inside the shaft)
    const bS = new Surf([
      { y: -0.45, rx: 0.075, rz: 0.08, cz: 0.004 },
      { y: -0.38, rx: 0.078, rz: 0.084 },
      { y: -0.28, rx: 0.09, rz: 0.1, cz: -0.012 },
      { y: -0.16, rx: 0.104, rz: 0.116, cz: -0.018 },
      { y: -0.08, rx: 0.108, rz: 0.116, cz: -0.012 },
      { y: -0.035, rx: 0.115, rz: 0.121, cz: -0.006 },
    ], { e: 2.15 });
    put(kn, loftGeo(bS, { ys: lin(-0.45, -0.038, 13), na: 40 }), M.green);
    put(kn, loftGeo(bS, { ys: lin(-0.11, -0.038, 3), na: 40, h: -0.008, flip: true }), M.greenDark);
    put(kn, rimGeo(bS, lin(0, TAU, 37).slice(0, 36).map((a) => [a, -0.041]), 0.009, -0.003, { closed: true, seg: 6 }), M.greenDark);
    put(kn, stitchGeo(bS, lin(0, TAU, 49).map((a) => [a, -0.058]), { spacing: 0.011 }), M.greenDark);
    put(kn, plateAY(bS, [[-0.6, -0.37], [0.6, -0.37], [0.62, -0.09], [-0.62, -0.09]], { round: 0.03, t: 0.008, h0: 0.0, bevel: 0.004, crown: 0.004, nI: 3 }), M.green);   // shin guard
    for (const y of [-0.31, -0.2]) {
      put(kn, bandGeo(bS, y, y + 0.026, { t: 0.0075, r: 0.003, na: 28, nc: 2 }), M.greenDark);
      put(kn, plateGeo(bS, rrect(0.036, 0.034, 0.006, 2), { center: [sx * Math.PI / 2, y + 0.013], t: 0.006, h0: 0.0075, bevel: 0.002, n: 24, nI: 2 }), M.gold);
      put(kn, plateGeo(bS, rrect(0.013, 0.02, 0.004, 2), { center: [sx * Math.PI / 2, y + 0.013], t: 0.004, h0: 0.0135, bevel: 0.0015, n: 16, nI: 2 }), M.greenDark);
    }
    putAll(an, bootFootGeos(M, sx));
  }
  // thigh holster (right leg): moulded shell conformed to the thigh, open mouth, retention flap, two leg straps
  {
    const hp = ch.hipR, oa = -Math.PI / 2;
    const th = new Surf([{ y: -0.5, rx: 0.1, rz: 0.106 }, { y: -0.34, rx: 0.125, rz: 0.129, cz: 0.01 }, { y: -0.22, rx: 0.139, rz: 0.145, cz: 0.012 }, { y: -0.1, rx: 0.149, rz: 0.155, cz: 0.008, cx: 0.004 }], { e: 2.15 });
    put(hp, plateAY(th, [[oa - 0.42, -0.1], [oa + 0.5, -0.1], [oa + 0.46, -0.27], [oa + 0.2, -0.375], [oa - 0.12, -0.37], [oa - 0.38, -0.25]], { smooth: true, n: 40, t: 0.052, h0: 0.008, bevel: 0.018, crown: 0.012, nI: 3, nB: 3 }), M.suit);
    put(hp, plateAY(th, [[oa - 0.3, -0.118], [oa + 0.36, -0.118], [oa + 0.33, -0.1], [oa - 0.27, -0.1]], { round: 0.006, t: 0.006, h0: 0.058, bevel: 0.002, n: 20, nI: 2 }), M.under);
    put(hp, plateAY(th, [[oa - 0.2, -0.205], [oa + 0.05, -0.205], [oa + 0.05, -0.095], [oa - 0.2, -0.095]], { round: 0.012, t: 0.008, h0: 0.066, bevel: 0.003, crown: 0.003, n: 24, nI: 2, sink: 0.012 }), M.suit);
    put(hp, xf(rivetGeo(0.0085, 0.6, 7), frame(th.at(oa - 0.075, -0.19, 0.076), th.nrm(oa - 0.075, -0.19))), M.gold);
    for (const y of [-0.17, -0.31]) {
      put(hp, bandGeo(th, y, y + 0.03, { t: 0.008, r: 0.003, na: 28, nc: 2 }), M.greenDark);
      put(hp, plateGeo(th, rrect(0.034, 0.036, 0.006, 2), { center: [0.35, y + 0.015], t: 0.006, h0: 0.008, bevel: 0.002, n: 20, nI: 2 }), M.gold);
    }
  }

  for (const g of groups) bakeHero(g);
  // large-scale occlusion between body parts (armpits, under the pauldrons, inner thighs, under the chin) from sphere proxies
  const lab = new Map();
  for (const [k, v] of Object.entries({ hips, torso, chest, neck, head })) lab.set(v, k);
  for (const S of ['L', 'R']) for (const k of ['sh', 'el', 'hand', 'hip', 'kn', 'an']) lab.set(ch[k + S], k + S);
  for (const g of groups) if (g.name) lab.set(g, g.name);
  const sp = (x, y, z, r, ...skip) => ({ c: V(x, y, z), r, skip: new Set(skip) });
  const proxies = [
    sp(0, 1.16, -0.01, 0.25, 'torso', 'chest'), sp(0, 1.4, 0.0, 0.3, 'torso', 'chest'), sp(0, 1.63, -0.012, 0.33, 'torso', 'chest'),
    sp(0, 0.96, -0.01, 0.25, 'hips'), sp(0, 2.1, -0.01, 0.24, 'head', 'neck'), sp(0, 1.88, -0.02, 0.12, 'neck', 'head', 'chest'),
  ];
  for (const [S, sx] of [['L', 1], ['R', -1]]) proxies.push(
    sp(sx * 0.535, 1.62, 0, 0.13, 'sh' + S, 'couter' + S, 'pauldron' + S), sp(sx * 0.53, 1.46, 0.006, 0.112, 'sh' + S, 'couter' + S),
    sp(sx * 0.52, 1.24, 0, 0.098, 'el' + S, 'hand' + S, 'couter' + S), sp(sx * 0.52, 1.1, 0, 0.082, 'el' + S, 'hand' + S),
    sp(sx * 0.6, 1.93, -0.005, 0.2, 'pauldron' + S, 'sh' + S),
    sp(sx * 0.165, 0.82, 0.01, 0.148, 'hip' + S, 'knee' + S, 'hips'), sp(sx * 0.17, 0.62, 0.015, 0.13, 'hip' + S, 'knee' + S),
    sp(sx * 0.17, 0.32, -0.012, 0.1, 'kn' + S, 'knee' + S, 'an' + S), sp(sx * 0.17, 0.16, 0, 0.08, 'kn' + S, 'an' + S),
  );
  const meshes = []; for (const g of groups) for (const c of g.children) if (c.isMesh) meshes.push(c);
  proxyOcclusion(ch.rigRoot, meshes, proxies, (m) => lab.get(m.parent) || '', 0.8);
}
