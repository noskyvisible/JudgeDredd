import * as THREE from 'three';
import { makeEagle } from './world.js';
import { patchRim } from './shaders.js';
import { rb, cap, cyl, add, bake, textures, makeMat } from './charkit.js';

// ===========================================================================
// Hero: Judge Joe Dredd.  Hand-built kit modelled on the classic comic art:
// black glossy uniform, black helmet with RED visor and gold eagle crest, gold eagle-wing
// pauldron (right) + big ribbed gold pauldron (left), gold chain to a chest badge, green
// gauntlets / bracers / belt / knee pads / boots, eagle-shield buckle and a thigh holster.
// Every bone's static meshes are baked into one mesh per material to keep draw calls low.
// ===========================================================================
export function buildHero(ch, st) {
  const T = textures();
  const suit = makeMat(0x0c0d11, { roughness: 0.3, metalness: 0.12, grain: 0.35, envMapIntensity: 1.3 });
  const suit2 = makeMat(0x101116, { roughness: 0.62, metalness: 0.05, grain: 0.5 });
  const helmet = makeMat(0x08090c, { roughness: 0.2, metalness: 0.55, envMapIntensity: 1.5 });
  const gold = makeMat(0xd6a328, { roughness: 0.3, metalness: 0.7, emissive: 0x3a2506, emissiveIntensity: 0.5, envMapIntensity: 1.3 });
  const goldDark = makeMat(0xa87a1c, { roughness: 0.38, metalness: 0.7, emissive: 0x2a1a04, emissiveIntensity: 0.4 });
  const green = makeMat(0x2a5b30, { roughness: 0.5, metalness: 0.12, grain: 0.7, envMapIntensity: 1.1 });
  const greenDark = makeMat(0x1d4023, { roughness: 0.55, metalness: 0.1, grain: 0.7 });
  const visor = makeMat(0x7a0d0d, { roughness: 0.14, metalness: 0.35, emissive: 0xff2412, emissiveIntensity: 0.85, envMapIntensity: 1.2 });
  const skin = makeMat(0xb98a6a, { roughness: 0.62 });
  const teeth = makeMat(0xe6e0d2, { roughness: 0.4 });
  const sole = makeMat(0x070708, { roughness: 0.8 });
  const badgeMat = new THREE.MeshStandardMaterial({ map: T.badge, roughness: 0.35, metalness: 0.6, emissive: 0x2a1a04, emissiveMap: T.badge, emissiveIntensity: 0.25 });
  const buckleMat = new THREE.MeshStandardMaterial({ map: T.buckle, roughness: 0.35, metalness: 0.6 });
  for (const m of [suit, suit2, helmet, gold, goldDark, green, greenDark, skin]) patchRim(m, 0x7aa6ff, 3.2, 0.3);
  ch.mats = { armor: suit, under: suit2, gold, skin, boots: green };

  const { hips } = ch;
  // ---- pelvis, belt ----
  add(hips, rb(0.56, 0.26, 0.34, 0.07), suit, 0, 0, 0);
  add(hips, rb(0.64, 0.15, 0.4, 0.05), green, 0, 0.02, 0);
  for (let i = 0; i < 9; i++) add(hips, new THREE.SphereGeometry(0.014, 6, 5), gold, -0.24 + i * 0.06, 0.085, 0.205);
  for (const [x, z, r] of [[-0.25, 0.17, 0.35], [0.25, 0.17, -0.35], [-0.31, 0.02, 1.2], [0.31, 0.02, -1.2]]) add(hips, rb(0.11, 0.13, 0.08, 0.025), green, x, -0.02, z, 0, r * 0.5, 0);
  add(hips, rb(0.22, 0.15, 0.05, 0.03), buckleMat, 0, 0.02, 0.215);
  add(hips, rb(0.025, 0.12, 0.02, 0.008), goldDark, -0.125, 0.02, 0.215); add(hips, rb(0.025, 0.12, 0.02, 0.008), goldDark, 0.125, 0.02, 0.215);

  // ---- torso ----
  const { torso, chest } = ch;     // `chest` pivots 0.3 above `torso`, so upper-body parts below are authored 0.3 lower than the old single-joint torso
  add(torso, rb(0.46, 0.26, 0.3, 0.08), suit2, 0, 0.09, 0);                          // abdomen
  add(chest, rb(0.82, 0.5, 0.44, 0.14), suit, 0, 0.17, 0);                          // chest
  for (const sx of [-1, 1]) add(chest, rb(0.34, 0.14, 0.34, 0.06), suit, sx * 0.3, 0.4, -0.01, 0, 0, -sx * 0.32);   // trapezius slopes
  add(chest, cyl(0.12, 0.16, 0.12, 12), suit, 0, 0.48, 0);
  add(chest, rb(0.62, 0.44, 0.1, 0.05), suit2, 0, 0.15, -0.21);                     // back plate
  add(chest, rb(0.34, 0.34, 0.06, 0.05), suit2, 0, 0.2, 0.215);                     // sternum plate
  // chest badge (character's left breast)
  add(chest, new THREE.PlaneGeometry(0.17, 0.215), badgeMat, 0.19, 0.2, 0.222);
  // chain from the eagle pauldron down to the badge
  {
    const S = new THREE.Vector3(-0.34, 0.46, 0.16), E = new THREE.Vector3(0.18, 0.33, 0.225), n = 15;
    const P = (t) => new THREE.Vector3(S.x + (E.x - S.x) * t, S.y + (E.y - S.y) * t - 0.2 * Math.sin(Math.PI * t), 0.222 + 0.01 * Math.sin(Math.PI * t));
    const linkGeo = new THREE.TorusGeometry(0.021, 0.0065, 5, 10); linkGeo.scale(1.4, 1, 1);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), p = P(t), q = P(Math.min(1, t + 0.04)), pr = P(Math.max(0, t - 0.04)), tan = q.clone().sub(pr).normalize();
      const m = new THREE.Mesh(linkGeo, gold); m.position.copy(p);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tan);
      if (i % 2) m.rotateX(Math.PI / 2);
      chest.add(m);
    }
  }
  // ---- neck & helmet ----
  const { neck, head } = ch;
  add(neck, cyl(0.1, 0.12, 0.16), suit2, 0, -0.04, 0);
  add(neck, rb(0.36, 0.1, 0.28, 0.04), suit, 0, -0.1, 0);
  // dome
  add(head, new THREE.SphereGeometry(0.235, 22, 16), helmet, 0, 0.17, 0, 0, 0, 0, 1.06, 1.0, 1.12);
  add(head, rb(0.06, 0.1, 0.42, 0.03), helmet, 0, 0.385, -0.02);                    // crest
  // red visor band (front 150°) with black frame
  const vg = new THREE.CylinderGeometry(0.247, 0.247, 0.1, 28, 1, true, -0.44 * Math.PI, 0.88 * Math.PI);
  add(head, vg, visor, 0, 0.15, 0, 0, 0, 0, 1.07, 1, 1.13).material.side = THREE.DoubleSide;
  for (const dy of [0.058, -0.058]) add(head, new THREE.CylinderGeometry(0.251, 0.251, 0.02, 28, 1, true, -0.46 * Math.PI, 0.92 * Math.PI), helmet, 0, 0.15 + dy, 0, 0, 0, 0, 1.07, 1, 1.13).material.side = THREE.DoubleSide;
  // gold eagle crest on the brow
  const crest = makeEagle(gold, 0.2, 0.025); crest.position.set(0, 0.3, 0.215); crest.rotation.set(-0.95, 0, 0); crest.userData.noBake = false; head.add(crest);
  // face: jaw, nose, grimace
  add(head, rb(0.3, 0.2, 0.22, 0.06), skin, 0, 0.0, 0.105);
  add(head, rb(0.05, 0.08, 0.06, 0.02), skin, 0, 0.085, 0.245);
  add(head, rb(0.14, 0.02, 0.012, 0.005), sole, 0, 0.032, 0.218);                  // mouth slit
  add(head, rb(0.125, 0.022, 0.01, 0.004), teeth, 0, 0.045, 0.22);                  // clenched teeth
  add(head, rb(0.2, 0.07, 0.13, 0.04), skin, 0, -0.07, 0.17);                       // chin
  add(head, rb(0.34, 0.035, 0.05, 0.015), helmet, 0, -0.1, 0.16);                   // chin strap
  for (const x of [-0.215, 0.215]) add(head, rb(0.06, 0.26, 0.32, 0.025), helmet, x, 0.05, 0.03);   // cheek guards
  add(head, rb(0.42, 0.2, 0.1, 0.04), helmet, 0, 0.02, -0.16);                      // neck guard

  // ---- arms ----
  const arm = (side) => {
    const sx = side === 'L' ? 1 : -1, sh = side === 'L' ? ch.shL : ch.shR, el = side === 'L' ? ch.elL : ch.elR, hand = side === 'L' ? ch.handL : ch.handR;
    sh.position.set(sx * 0.52, 0.36, 0);
    add(sh, new THREE.SphereGeometry(0.105, 12, 10), suit, 0, 0, 0);
    add(sh, cap(0.098, 0.2), suit, 0, -0.2, 0);                                     // upper arm
    add(el, rb(0.14, 0.1, 0.14, 0.04), suit, 0, 0.0, 0);                             // elbow pad
    add(el, cyl(0.078, 0.062, 0.3, 12), green, 0, -0.2, 0);                          // bracer
    add(el, cyl(0.088, 0.088, 0.045, 12), greenDark, 0, -0.07, 0);                   // cuff
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; add(el, new THREE.SphereGeometry(0.011, 5, 4), gold, Math.sin(a) * 0.082, -0.07, Math.cos(a) * 0.082); }
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; add(el, new THREE.SphereGeometry(0.011, 5, 4), gold, Math.sin(a) * 0.066, -0.3, Math.cos(a) * 0.066); }
    // gauntlet
    add(hand, cyl(0.082, 0.1, 0.09, 12), greenDark, 0, 0.0, 0);
    add(hand, rb(0.16, 0.18, 0.17, 0.055), green, 0, -0.1, 0);
    for (let i = -1; i <= 1; i++) add(hand, rb(0.04, 0.035, 0.15, 0.012), greenDark, i * 0.045, -0.2, 0.0);
    add(hand, cap(0.03, 0.07), green, sx * -0.085, -0.08, 0.05, 0, 0, 0.3);
    for (let i = 0; i < 4; i++) add(hand, new THREE.SphereGeometry(0.01, 5, 4), gold, -0.06 + i * 0.04, -0.045, 0.09);
    return { sh, sx };
  };
  const aL = arm('L'), aR = arm('R');
  // right shoulder: golden eagle-wing pauldron (fan of feathers + head), turned to show its face
  {
    const sh = aR.sh, sx = -1;
    add(sh, new THREE.SphereGeometry(0.18, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), goldDark, sx * 0.04, 0.03, 0, 0, 0, -sx * 0.25, 1.2, 0.85, 1.15);
    const wing = new THREE.Group(); wing.position.set(sx * 0.1, 0.05, 0.0); wing.rotation.set(0, 0.75, sx * -0.18);
    const pivot = new THREE.Vector3(0, 0.03, 0.14);
    const layers = [{ off: 0.0, k: 1.0, w: 0.1, mat: gold }, { off: 0.045, k: 0.74, w: 0.09, mat: goldDark }];
    layers.forEach((ly, li) => {
      for (let i = 0; i < 8; i++) {
        const a = (8 + i * 11) * Math.PI / 180, L = (0.34 + 0.08 * Math.sin(i * 0.8)) * ly.k + (i >= 6 ? 0.05 : 0);
        const dir = new THREE.Vector3(0, Math.sin(a), -Math.cos(a));
        const p = pivot.clone().addScaledVector(dir, L / 2); p.x += sx * ly.off;
        add(wing, rb(0.03, L, ly.w, 0.012), ly.mat, p.x, p.y, p.z, a - Math.PI / 2, 0, 0);
      }
    });
    add(wing, new THREE.SphereGeometry(0.058, 10, 8), gold, sx * 0.0, 0.2, 0.2);
    add(wing, new THREE.ConeGeometry(0.034, 0.12, 6), goldDark, 0, 0.18, 0.285, Math.PI / 2 + 0.55, 0, 0);
    add(wing, rb(0.07, 0.1, 0.1, 0.03), gold, 0, 0.12, 0.17);
    add(wing, rb(0.04, 0.3, 0.3, 0.05), goldDark, sx * 0.03, 0.2, -0.02, 0.5, 0, 0);
    wing.scale.setScalar(1.35);
    bake(wing); sh.add(wing);
  }
  // left shoulder: big ribbed fist-style pauldron (bands run left-right, bulging outward)
  {
    const sh = aL.sh, sx = 1;
    add(sh, new THREE.SphereGeometry(0.19, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), goldDark, sx * 0.04, -0.01, 0, 0, 0, -sx * 0.2, 1.2, 0.8, 1.1);
    const ridge = [[0.235, 0.3, 0.052], [0.165, 0.4, 0.058], [0.09, 0.44, 0.06], [0.015, 0.42, 0.058], [-0.06, 0.34, 0.05]];
    ridge.forEach(([y, len, r], i) => {
      add(sh, cap(r, len - 2 * r, 5, 10), i % 2 ? goldDark : gold, sx * (0.11 + (i === 0 ? -0.01 : 0)), y, 0.0, 0, 0, Math.PI / 2 - sx * 0.18, 1, 1, 2.0);
    });
    for (const [y, x] of [[0.2, 0.2], [0.1, 0.28], [0.0, 0.27]]) add(sh, new THREE.SphereGeometry(0.014, 6, 5), goldDark, sx * x, y, 0.1);
  }

  // ---- legs ----
  const leg = (side) => {
    const sx = side === 'L' ? 1 : -1, hp = side === 'L' ? ch.hipL : ch.hipR, kn = side === 'L' ? ch.knL : ch.knR;
    hp.position.set(sx * 0.17, -0.08, 0);
    add(hp, new THREE.SphereGeometry(0.13, 12, 10), suit, 0, 0, 0);
    add(hp, cap(0.125, 0.21), suit, 0, -0.23, 0, 0, 0, 0, 1, 1, 1.05);                // thigh
    // knee pad (big rounded green) + straps
    add(kn, rb(0.235, 0.23, 0.16, 0.085), green, 0, 0.0, 0.095);
    for (const [x, y] of [[-0.075, 0.06], [0.075, 0.06], [-0.075, -0.06], [0.075, -0.06]]) add(kn, new THREE.SphereGeometry(0.014, 6, 5), gold, x, y, 0.178);
    add(kn, rb(0.2, 0.04, 0.17, 0.015), suit, 0, 0.14, 0.04);
    // boot / shin
    add(kn, cap(0.088, 0.22), green, 0, -0.25, 0.005);
    add(kn, rb(0.2, 0.065, 0.2, 0.03), greenDark, 0, -0.1, 0);
    for (const y of [-0.2, -0.3]) add(kn, cyl(0.093, 0.093, 0.025, 12), suit, 0, y, 0);
    add(kn, new THREE.SphereGeometry(0.013, 5, 4), gold, 0, -0.2, 0.093); add(kn, new THREE.SphereGeometry(0.013, 5, 4), gold, 0, -0.3, 0.093);
    const an = side === 'L' ? ch.anL : ch.anR;
    add(an, rb(0.175, 0.11, 0.35, 0.05), green, 0, -0.01, 0.075);
    add(an, rb(0.185, 0.04, 0.37, 0.02), sole, 0, -0.055, 0.075);
    return { hp, sx };
  };
  leg('L'); const lr = leg('R');
  // thigh holster on the right leg
  add(ch.hipR, rb(0.1, 0.26, 0.19, 0.035), suit2, -0.12, -0.24, 0.02);
  add(ch.hipR, cyl(0.125, 0.125, 0.03, 12), suit, 0, -0.18, 0); add(ch.hipR, cyl(0.12, 0.12, 0.03, 12), suit, 0, -0.34, 0);
  add(ch.hipR, rb(0.03, 0.05, 0.05, 0.01), goldDark, -0.17, -0.2, 0.05);

  for (const g of [ch.hips, ch.torso, ch.chest, ch.neck, ch.head, ch.shL, ch.shR, ch.elL, ch.elR, ch.handL, ch.handR, ch.hipL, ch.hipR, ch.knL, ch.knR, ch.anL, ch.anR]) bake(g);
}
