import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Character skinning: collapses a character's static rig meshes into ONE SkinnedMesh PER MATERIAL, driven by the character's existing joint groups
// (hips, torso, chest, shoulders, ...) used directly as bones.  A hero that was 82 draw calls per pass becomes ~a dozen, a perp ~6, and since a
// character is drawn in the sun-shadow pass, the mirrored ground pass and the main pass, that is the single biggest cut in the frame's draw calls.
//
// The maths is deliberately trivial so the result is identical to the rigid hierarchy it replaces:
//   * every vertex is stored in the local space of the joint that owned its mesh (mesh.matrix applied), weight 1 on that single joint
//   * all bind data is identity: bindMatrix = I, boneInverses = I, 'attached' bind mode (bindMatrixInverse = inverse(mesh.matrixWorld))
//   => skinned world position = joint.matrixWorld * localVertex, exactly what the parent-child chain produced.
// Because the stored geometry depends on no instance state, merged geometry is cached by its source geometries and shared between instances.
//
// Meshes that must stay individual are left alone: transparent / custom-ordered / invisible ones, anything with its own onBeforeRender, and
// everything under a weapon mount (weapons are swapped and toggled separately).  Append ?noskin to the page URL to disable this module (A/B checks).
// ---------------------------------------------------------------------------

const DISABLED = typeof location !== 'undefined' && /[?&]noskin\b/.test(location.search);
const IDENT = new THREE.Matrix4();
const BASE_ON_BEFORE = THREE.Object3D.prototype.onBeforeRender;
const cache = new Map();            // key (source geometry uuids + local matrices) -> merged BufferGeometry
let uid = 0;

const eligible = (o) =>
  o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh && o.visible && o.renderOrder === 0 && !o.userData.noSkin &&
  o.material && !Array.isArray(o.material) && !o.material.transparent && o.geometry && o.geometry.attributes.position &&
  o.onBeforeRender === BASE_ON_BEFORE && o.layers.mask === 1 && o.children.length === 0;

function attrKey(g) { return Object.keys(g.attributes).sort().join(',') + (g.index ? '+i' : ''); }

export function skinCharacter(ch) {
  if (DISABLED || ch.style?.noSkin) return false;
  const skip = new Set([ch.gunMount, ch.batonMount, ch.toolR].filter(Boolean));
  const bones = [], boneIdx = new Map(), byMat = new Map();
  const boneOf = (node) => { let i = boneIdx.get(node); if (i === undefined) { i = bones.length; bones.push(node); boneIdx.set(node, i); } return i; };

  // 1. gather: every eligible mesh, keyed by material, remembering the node (= bone) that owns it
  const visit = (node) => {
    for (const c of node.children) {
      if (skip.has(c) || c.userData.noSkin || !c.visible) continue;
      if (eligible(c)) { const m = c.material; if (!byMat.has(m)) byMat.set(m, []); byMat.get(m).push({ mesh: c, node }); }
      else if (c.children.length) visit(c);
    }
  };
  visit(ch.rigRoot);
  if (!byMat.size) return false;

  // 2. one merged, bone-indexed geometry per material
  const S = ch.style?.scale || 1, skinned = [];
  for (const [mat, list] of byMat) {
    if (list.length < 2) continue;                                   // nothing to gain
    const names = new Set(list.map((e) => attrKey(e.mesh.geometry)));
    if (names.size > 1) { // mixed attribute sets / indexing: normalise indexing; if the attribute names themselves differ keep the originals
      const noIdx = new Set(list.map((e) => Object.keys(e.mesh.geometry.attributes).sort().join(',')));
      if (noIdx.size > 1) continue;
    }
    for (const e of list) e.mesh.updateMatrix();
    // bone indices are assigned in traversal order, which is the same for every instance of the same look, so the cache key below is stable across instances
    const idx = list.map((e) => boneOf(e.node));
    const ckey = list.map((e, i) => e.mesh.geometry.uuid + ':' + e.mesh.matrix.elements.map((v) => Math.round(v * 1e5)).join(',') + '@' + idx[i]).join('|');
    let merged = cache.get(ckey);
    if (!merged) {
      const anyIndexed = list.some((e) => e.mesh.geometry.index), allIndexed = list.every((e) => e.mesh.geometry.index);
      const geos = list.map((e, i) => {
        let g = e.mesh.geometry;
        g = (anyIndexed && !allIndexed && g.index) ? g.toNonIndexed() : g.clone();
        g.applyMatrix4(e.mesh.matrix);                              // into the owning joint's local space
        const n = g.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
        for (let v = 0; v < n; v++) { si[v * 4] = idx[i]; sw[v * 4] = 1; }
        g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
        return g;
      });
      merged = mergeGeometries(geos, false);
      if (!merged) continue;
      cache.set(ckey, merged);
      if (cache.size > 256) cache.delete(cache.keys().next().value);   // looks whose geometry is rebuilt per instance never hit: do not let them pile up
    }
    const sm = new THREE.SkinnedMesh(merged, mat);
    sm.name = 'skin' + (uid++);
    sm.castShadow = list.some((e) => e.mesh.castShadow); sm.receiveShadow = list.some((e) => e.mesh.receiveShadow);
    // frustum culling needs an explicit sphere: the stored vertices are in joint space (all near the origin), not around the character
    sm.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.1 * S, 0), 2.7 * S);
    sm.userData.fromRig = true;
    skinned.push({ sm, list });
  }
  if (!skinned.length) return false;

  // 3. one shared skeleton for the whole character (a single bone-texture upload per frame), identity bind data
  const skeleton = new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4()));
  for (const { sm, list } of skinned) {
    ch.root.add(sm);
    sm.bind(skeleton, IDENT);
    for (const e of list) e.mesh.removeFromParent();
  }
  ch.skeleton = skeleton; ch.skinnedMeshes = skinned.map((s) => s.sm);
  return true;
}
