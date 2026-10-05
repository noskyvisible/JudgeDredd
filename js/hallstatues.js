import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Character, makeLawgiver, makeBaton } from './character.js';
import { world } from './world.js';

// ---------------------------------------------------------------------------
// The two monumental Judge statues that flank the Hall of Justice approach: the real hero model, posed, scaled up ~9x and cast in gold.
// Everything is baked into one gold mesh + one emissive visor mesh per statue (the figure is static), wrapped in a Group so the
// reflection pass can skip it when it is far away.
// ---------------------------------------------------------------------------

const POSES = [   // [right-arm lift, left-arm lift, head yaw, torso twist]: one statue levels the Lawgiver, the other holds the daystick across the chest
  { shR: [-1.45, -0.06, -0.1], elR: -0.12, shL: [-0.35, 0.1, 0.28], elL: -1.35, hipL: [0.02, 0, 0.1], hipR: [-0.08, 0, -0.1], torso: [0.02, 0.18, 0], head: [0, -0.22, 0] },
  { shR: [-0.5, 0.2, -0.3], elR: -1.5, shL: [-1.2, -0.3, 0.5], elL: -0.5, hipL: [-0.08, 0, 0.1], hipR: [0.02, 0, -0.1], torso: [0.02, -0.18, 0], head: [0, 0.22, 0] },
];

export function buildHallStatues(scene) {
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xe6b038, metalness: 1, roughness: 0.28, clearcoat: 0.5, clearcoatRoughness: 0.25, envMapIntensity: 1.7, emissive: 0x4a3206, emissiveIntensity: 0.55 });
  const visorMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.1, 0.05).multiplyScalar(2.8), toneMapped: false });
  const isVisor = (m) => m.emissive && m.emissive.r > 0.8 && m.emissive.g < 0.3 && m.emissiveIntensity > 0.5;
  const out = [];
  [-1, 1].forEach((sx, idx) => {
    const ch = new Character('dredd');
    ch.gunMount.add(makeLawgiver()); ch.batonMount.add(makeBaton(0.85));
    // pose: settle the base, then override the arms / legs / spine for a heroic stance
    ch.speed = 0; for (let i = 0; i < 4; i++) ch.update(1 / 60);
    const P = POSES[idx], c = ch.cur;
    c.shR = [...P.shR]; c.elR = [P.elR, 0, 0]; c.shL = [...P.shL]; c.elL = [P.elL, 0, 0];
    c.hipL = [...P.hipL]; c.hipR = [...P.hipR]; c.knL = [0.04, 0, 0]; c.knR = [0.04, 0, 0]; c.torso = [...P.torso]; c.head = [...P.head];
    c.pos = [0, 0, 0];
    ch.applyPose(c);
    const statue = new THREE.Group(); statue.add(ch.root);
    const k = 9;
    ch.root.scale.setScalar(k); ch.root.position.set(0, 0, 0);
    statue.position.set(world.hallPos.x + sx * 21, 3.6, world.hallPos.z + 27); statue.rotation.y = -sx * 0.32;
    statue.updateMatrixWorld(true);
    const goldGeos = [], visorGeos = [], inv = new THREE.Matrix4().copy(statue.matrixWorld).invert();
    const rel = new THREE.Matrix4();
    ch.root.traverse((o) => {
      if (!o.isMesh) return;
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      rel.multiplyMatrices(inv, o.matrixWorld); g.applyMatrix4(rel);
      for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal' && n !== 'uv') g.deleteAttribute(n);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      (mats.some(isVisor) ? visorGeos : goldGeos).push(g);
    });
    // static now: drop the rig and keep the baked meshes
    statue.remove(ch.root);
    const gm = new THREE.Mesh(mergeGeometries(goldGeos, false), gold); gm.castShadow = true;
    statue.add(gm);
    if (visorGeos.length) statue.add(new THREE.Mesh(mergeGeometries(visorGeos, false), visorMat));
    scene.add(statue); out.push(statue);
  });
  return out;
}
