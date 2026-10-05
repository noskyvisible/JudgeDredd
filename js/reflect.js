import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Planar ground reflections.  The scene is rendered a second time from a camera
// mirrored in the ground plane into a half-resolution HDR target; the road,
// intersection and sidewalk shaders (see patchRoad in shaders.js) sample it with
// a roughness-driven blur, so wet asphalt mirrors Dredd, traffic, neon and the sky.
// Ground meshes live on layer 1 (the main camera sees layers 0+1, this one only 0)
// so the road never occludes its own reflection.
// ---------------------------------------------------------------------------

const PLANE_Y = 0;
const _p = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _t = new THREE.Vector3();

export class GroundReflection {
  constructor() {
    this.enabled = false;
    this.scale = 0.5;
    this.rt = null;
    this.cam = new THREE.PerspectiveCamera();
    this.cam.layers.set(0);
    this.vp = new THREE.Matrix4();
    this.hide = [];                       // objects that must not appear in the mirror (rain, ground decals, light cones)
    this.uniforms = {
      uReflTex: { value: null },
      uReflVP: { value: this.vp },
      uReflOn: { value: 0 },
      uReflRes: { value: new THREE.Vector2(1, 1) },
    };
  }

  resize(w, h) {
    const rw = Math.max(64, Math.round(w * this.scale)), rh = Math.max(64, Math.round(h * this.scale));
    if (this.rt && this.rt.width === rw && this.rt.height === rh) return;
    this.rt?.dispose();
    this.rt = new THREE.WebGLRenderTarget(rw, rh, {
      type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true,
    });
    this.uniforms.uReflTex.value = this.rt.texture;
    this.uniforms.uReflRes.value.set(rw, rh);
  }

  setEnabled(on, scale = this.scale) {
    this.enabled = on; this.scale = scale;
    this.uniforms.uReflOn.value = on ? 1 : 0;
  }

  // Renders the mirrored view.  Leaves the shadow map freshly updated for the main pass to reuse.
  render(renderer, scene, camera) {
    if (!this.enabled) return false;
    // skip the whole second pass when the ground cannot be on screen (looking steeply up) or is too far below to matter
    camera.updateMatrixWorld();
    _f.set(0, 0, -1).transformDirection(camera.matrixWorld);
    const camY = camera.matrixWorld.elements[13];
    if (camY > 140 || _f.y > Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) + 0.06) { this.uniforms.uReflOn.value = 0; return false; }
    this.uniforms.uReflOn.value = 1;
    const size = renderer.getDrawingBufferSize(_t);
    this.resize(size.x, size.y);
    camera.updateMatrixWorld();
    const cam = this.cam;
    cam.fov = camera.fov; cam.aspect = camera.aspect; cam.near = camera.near; cam.far = camera.far; cam.updateProjectionMatrix();
    _p.setFromMatrixPosition(camera.matrixWorld);
    _f.set(0, 0, -1).transformDirection(camera.matrixWorld);
    _u.set(0, 1, 0).transformDirection(camera.matrixWorld);
    cam.position.set(_p.x, 2 * PLANE_Y - _p.y, _p.z);
    cam.up.set(_u.x, -_u.y, _u.z);
    cam.lookAt(_p.x + _f.x, 2 * PLANE_Y - (_p.y + _f.y), _p.z + _f.z);
    cam.updateMatrixWorld(true);
    this.vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

    const prev = renderer.getRenderTarget();
    const vis = this.hide.map((o) => o.visible);
    for (const o of this.hide) o.visible = false;
    renderer.setRenderTarget(this.rt);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prev);
    this.hide.forEach((o, i) => (o.visible = vis[i]));
    return true;
  }
}

export const reflection = new GroundReflection();
