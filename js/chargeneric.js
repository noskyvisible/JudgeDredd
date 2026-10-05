import * as THREE from 'three';
import { patchRim } from './shaders.js';
import { rb, cap, cyl, add, bake, makeMat } from './charkit.js';

// ===========================================================================
// Generic perps / civilians (thug, gunman, brute, junkie, biker, boss, civ)
// ===========================================================================
export function buildGeneric(ch, styleName, st) {
  const b = st.bulk;
  const cloth = makeMat(st.armor, { roughness: 0.6, metalness: 0.15, grain: 0.5 });
  const under = makeMat(st.under, { roughness: 0.8, metalness: 0.05, grain: 0.4 });
  const gold = makeMat(st.gold, { roughness: 0.4, metalness: 0.7 });
  const skin = makeMat(st.skin, { roughness: 0.65 });
  const boots = makeMat(st.boots, { roughness: 0.5, metalness: 0.2, grain: 0.5 });
  const dark = makeMat(0x0b0b0e, { roughness: 0.5, metalness: 0.4 });
  for (const m of [cloth, under, skin, boots]) patchRim(m, st.rim ?? 0x8a9ac8, 3.2, 0.22);
  ch.mats = { armor: cloth, under, gold, skin, boots };
  const { hips, torso, chest, neck, head } = ch;

  add(hips, rb(0.5 * b, 0.24, 0.3 * b, 0.06), under, 0, 0, 0);
  add(hips, rb(0.56 * b, 0.1, 0.34 * b, 0.03), dark, 0, 0.02, 0);
  add(torso, rb(0.5 * b, 0.28, 0.3 * b, 0.07), under, 0, 0.1, 0);
  add(chest, rb(0.7 * b, 0.42, 0.37 * b, 0.1), cloth, 0, 0.15, 0);
  add(chest, rb(0.8 * b, 0.1, 0.34 * b, 0.04), cloth, 0, 0.38, -0.01);
  if (st.plates !== undefined) {
    const plate = makeMat(st.plates, { roughness: 0.4, metalness: 0.6 });
    add(chest, rb(0.5 * b, 0.3, 0.1, 0.04), plate, 0, 0.17, 0.21 * b);
  }
  if (styleName === 'gunman') { add(chest, rb(0.52 * b, 0.34, 0.1, 0.04), dark, 0, 0.16, 0.2 * b); for (const x of [-0.18, 0, 0.18]) add(chest, rb(0.09, 0.12, 0.05, 0.02), under, x * b, 0.06, 0.26 * b); }
  add(neck, cyl(0.075, 0.09, 0.14), skin, 0, 0, 0);
  // head
  add(head, new THREE.SphereGeometry(0.19, 14, 10), skin, 0, 0.18, 0, 0, 0, 0, 1, 1.05, 1.02);
  add(head, rb(0.06, 0.05, 0.05, 0.02), skin, 0, 0.16, 0.19);
  if (st.hair !== undefined) {
    const hair = makeMat(st.hair, { roughness: 0.85 });
    add(head, new THREE.SphereGeometry(0.2, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 0.2, -0.01, 0, 0, 0, 1, 1.05, 1.05);
  }
  if (st.helmetCol) { const hm = makeMat(st.helmetCol, { roughness: 0.2, metalness: 0.7 }); add(head, new THREE.SphereGeometry(0.215, 14, 10), hm, 0, 0.2, 0, 0, 0, 0, 1, 0.98, 1.05); add(head, rb(0.3, 0.075, 0.1, 0.03), dark, 0, 0.18, 0.18); }
  if (st.mask) add(head, rb(0.28, 0.12, 0.06, 0.03), makeMat(st.mask, { roughness: 0.6 }), 0, 0.11, 0.165);
  if (styleName === 'junkie') add(head, rb(0.05, 0.3, 0.05, 0.02), new THREE.MeshStandardMaterial({ color: 0x80ff40, emissive: 0x80ff40, emissiveIntensity: 0.9 }), 0, 0.42, 0);
  // eyes (tiny dark dots keep faces readable)
  for (const x of [-0.07, 0.07]) add(head, new THREE.SphereGeometry(0.018, 6, 5), dark, x, 0.21, 0.182);

  // arms
  const arm = (side) => {
    const sx = side === 'L' ? 1 : -1, sh = side === 'L' ? ch.shL : ch.shR, el = side === 'L' ? ch.elL : ch.elR, hand = side === 'L' ? ch.handL : ch.handR;
    sh.position.set(sx * 0.46 * b, 0.33, 0);
    add(sh, new THREE.SphereGeometry(0.095 * b, 10, 8), cloth, 0, 0, 0);
    add(sh, cap(0.075 * b, 0.22), cloth, 0, -0.2, 0);
    add(el, cap(0.062 * b, 0.2), styleName === 'civ' ? cloth : under, 0, -0.19, 0);
    add(hand, rb(0.11, 0.13, 0.12, 0.04), styleName === 'civ' || styleName === 'junkie' ? skin : dark, 0, -0.06, 0);
    if (st.plates !== undefined) {
      const plate = makeMat(st.plates, { roughness: 0.4, metalness: 0.6 });
      add(sh, new THREE.SphereGeometry(0.17 * b, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), plate, sx * 0.04, 0.03, 0, 0, 0, -sx * 0.3, 1.2, 0.9, 1.15);
    }
  };
  arm('L'); arm('R');
  // legs
  const leg = (side) => {
    const sx = side === 'L' ? 1 : -1, hp = side === 'L' ? ch.hipL : ch.hipR, kn = side === 'L' ? ch.knL : ch.knR;
    hp.position.set(sx * 0.17 * b, -0.08, 0);
    add(hp, cap(0.095 * b, 0.26), under, 0, -0.22, 0);
    add(kn, cap(0.075 * b, 0.22), under, 0, -0.24, 0);
    const an = side === 'L' ? ch.anL : ch.anR;
    add(an, rb(0.14 * b, 0.13, 0.32, 0.05), boots, 0, 0, 0.07);
    add(an, rb(0.15 * b, 0.035, 0.34, 0.015), dark, 0, -0.055, 0.07);
    add(kn, rb(0.15 * b, 0.1, 0.14, 0.04), boots, 0, -0.32, 0);
  };
  leg('L'); leg('R');
  for (const g of [hips, torso, chest, neck, head, ch.shL, ch.shR, ch.elL, ch.elR, ch.handL, ch.handR, ch.hipL, ch.hipR, ch.knL, ch.knR, ch.anL, ch.anR]) bake(g);
}
