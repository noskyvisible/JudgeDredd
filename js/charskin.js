import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Skinning for animated rigs built from rigid parts.  A character is dozens of small static meshes parented to joint groups; the Lawmaster is
// the same thing built from sprung / steered / spinning groups.  Each is drawn up to three times a frame (sun-shadow pass, mirrored ground pass,
// main pass), so the cheapest big win is to collapse every static mesh of a rig into ONE SkinnedMesh PER MATERIAL, driven by the rig's existing
// groups used directly as bones.  Dredd goes from 73 draw calls per pass to 12, a perp from ~25 to 3-5, the Lawmaster from ~70 to ~20.
//
// The maths is deliberately trivial so the result is identical to the rigid hierarchy it replaces:
//   * every vertex is stored in the local space of the node that owned its mesh (mesh.matrix applied), weight 1 on that single node
//   * all bind data is identity: bindMatrix = I, boneInverses = I, 'attached' bind mode (bindMatrixInverse = inverse(mesh.matrixWorld))
//   => skinned world position = node.matrixWorld * localVertex, exactly what the parent-child chain produced.
// Because the stored geometry depends on no instance state, merged geometry is cached by its source geometries and shared between instances.
//
// Meshes that must stay individual are left alone: transparent / custom-ordered / invisible ones, anything with its own onBeforeRender or
// dynamic geometry, anything the caller excludes (the Lawmaster's toggled lights, flames, trails: everything referenced from its userData), and
// everything under a skipped node (weapon mounts).  Append ?noskin to the page URL to disable all of this (A/B checks).
// ---------------------------------------------------------------------------

const DISABLED = typeof location !== 'undefined' && /[?&]noskin\b/.test(location.search);
const IDENT = new THREE.Matrix4();
const BASE_ON_BEFORE = THREE.Object3D.prototype.onBeforeRender;
const cache = new Map();            // key (source geometry uuids + local matrices + bone indices) -> merged BufferGeometry
let uid = 0;

const eligible = (o, exclude) =>
  o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh && o.visible && o.renderOrder === 0 && !o.userData.noSkin && !exclude.has(o) &&
  o.material && !Array.isArray(o.material) && !o.material.transparent && o.geometry && o.geometry.attributes.position &&
  o.geometry.attributes.position.usage === THREE.StaticDrawUsage && o.onBeforeRender === BASE_ON_BEFORE && o.layers.mask === 1 &&
  o.children.length === 0 && o.frustumCulled !== false;

const attrNames = (g) => Object.keys(g.attributes).sort().join(',');

/** Every Object3D reachable from `data` (a userData bag): such objects are toggled / updated by game code and must never be merged away. */
export function referencedObjects(data, out = new Set(), depth = 0) {
  if (!data || depth > 4) return out;
  if (data.isObject3D) { out.add(data); return out; }
  if (data.isMaterial || data.isTexture || data.isVector2 || data.isVector3 || data.isColor || data.isEuler || data.isQuaternion || data.isMatrix4 || data.isBufferGeometry) return out;
  if (Array.isArray(data)) { for (const v of data) referencedObjects(v, out, depth + 1); return out; }
  if (typeof data === 'object') for (const k of Object.keys(data)) referencedObjects(data[k], out, depth + 1);
  return out;
}

/**
 * Skin the static meshes found below `start` (its descendants; each owning node becomes a bone).  The SkinnedMeshes are added to `parent`.
 *   skip     nodes whose subtrees are left untouched         exclude  Set of meshes that must stay individual
 *   sphere   {center:[x,y,z], radius}: explicit culling sphere (stored vertices are in joint space, not around the object)
 * Returns { skeleton, meshes } or null if nothing was merged.
 */
export function skinSubtree({ start, parent, skip = [], exclude = new Set(), sphere }) {
  const skipSet = new Set(skip.filter(Boolean));
  const bones = [], boneIdx = new Map(), byMat = new Map();
  const boneOf = (node) => { let i = boneIdx.get(node); if (i === undefined) { i = bones.length; bones.push(node); boneIdx.set(node, i); } return i; };

  const visit = (node) => {
    for (const c of node.children) {
      if (skipSet.has(c) || c.userData.noSkin || !c.visible) continue;
      if (eligible(c, exclude)) { const m = c.material; if (!byMat.has(m)) byMat.set(m, []); byMat.get(m).push({ mesh: c, node }); }
      else if (c.children.length) visit(c);
    }
  };
  visit(start);
  if (!byMat.size) return null;

  const skinned = [];
  for (const [mat, list] of byMat) {
    if (list.length < 2) continue;                                   // nothing to gain
    if (new Set(list.map((e) => attrNames(e.mesh.geometry))).size > 1) continue;   // differing attribute sets cannot be merged faithfully
    for (const e of list) e.mesh.updateMatrix();
    // bone indices are assigned in traversal order, which is the same for every instance of the same build, so the cache key is stable across instances
    const idx = list.map((e) => boneOf(e.node));
    const ckey = list.map((e, i) => e.mesh.geometry.uuid + ':' + e.mesh.matrix.elements.map((v) => Math.round(v * 1e5)).join(',') + '@' + idx[i]).join('|');
    let merged = cache.get(ckey);
    if (!merged) {
      const anyIndexed = list.some((e) => e.mesh.geometry.index), allIndexed = list.every((e) => e.mesh.geometry.index);
      const geos = list.map((e, i) => {
        let g = e.mesh.geometry;
        g = (anyIndexed && !allIndexed && g.index) ? g.toNonIndexed() : g.clone();
        g.applyMatrix4(e.mesh.matrix);                              // into the owning node's local space
        const n = g.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
        for (let v = 0; v < n; v++) { si[v * 4] = idx[i]; sw[v * 4] = 1; }
        g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
        return g;
      });
      merged = mergeGeometries(geos, false);
      if (!merged) continue;
      cache.set(ckey, merged);
      if (cache.size > 256) cache.delete(cache.keys().next().value);   // builds whose geometry is recreated per instance never hit: do not let them pile up
    }
    const sm = new THREE.SkinnedMesh(merged, mat);
    sm.name = 'skin' + (uid++);
    sm.castShadow = list.some((e) => e.mesh.castShadow); sm.receiveShadow = list.some((e) => e.mesh.receiveShadow);
    sm.boundingSphere = new THREE.Sphere(new THREE.Vector3(...sphere.center), sphere.radius);
    sm.userData.fromRig = true;
    skinned.push({ sm, list });
  }
  if (!skinned.length) return null;

  // one shared skeleton for the whole rig (a single bone-texture upload per frame), identity bind data
  const skeleton = new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4()));
  for (const { sm, list } of skinned) {
    parent.add(sm);
    sm.bind(skeleton, IDENT);
    for (const e of list) e.mesh.removeFromParent();
  }
  return { skeleton, meshes: skinned.map((s) => s.sm) };
}

/** Characters: the rig below rigRoot, minus the weapon mounts; the explicit culling sphere covers a stretched-out body plus a held weapon. */
export function skinCharacter(ch) {
  if (DISABLED || ch.style?.noSkin) return false;
  const S = ch.style?.scale || 1;
  const r = skinSubtree({ start: ch.rigRoot, parent: ch.root, skip: [ch.gunMount, ch.batonMount, ch.toolR], sphere: { center: [0, 1.1 * S, 0], radius: 2.7 * S } });
  if (!r) return false;
  ch.skeleton = r.skeleton; ch.skinnedMeshes = r.meshes;
  return true;
}

/** Vehicles built from animated groups (the Lawmaster): everything referenced from userData stays untouched. */
export function skinVehicle(model, { noSkin = false, sphere = { center: [0, 0.9, 0], radius: 3.4 } } = {}) {
  if (DISABLED || noSkin) return false;
  const r = skinSubtree({ start: model, parent: model, exclude: referencedObjects(model.userData), sphere });
  if (!r) return false;
  model.userData.skinned = r.meshes;
  return true;
}
