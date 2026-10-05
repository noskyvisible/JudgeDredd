import * as THREE from 'three';
import { glowTex } from './vehicle_tex.js';

// ---------------------------------------------------------------------------
// Night-rain light FX for vehicles, each a single instanced draw call:
//   LightGlints  camera-facing glare quads on lamps; fade when the lamp faces away, keep a minimum
//                screen size so distant traffic still twinkles.
//   WetStreaks   long soft reflections of lamps on the wet asphalt, stretched toward the camera.
// Usage per frame: g.begin(); g.add(...); ... g.end();
// ---------------------------------------------------------------------------

const quad = () => { const g = new THREE.PlaneGeometry(1, 1); return g; };

export class LightGlints {
  constructor(scene, max = 160) {
    this.max = max; this.n = 0;
    const geo = quad();
    this.dir = new Float32Array(max * 3); this.col = new Float32Array(max * 4);
    geo.setAttribute('aDir', new THREE.InstancedBufferAttribute(this.dir, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
      uniforms: { map: { value: glowTex() }, minPx: { value: 0.0045 } },
      vertexShader: `attribute vec3 aDir; attribute vec4 aCol; uniform float minPx; varying vec2 vUv; varying vec4 vC;
        void main(){
          vec4 c = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float s = length(instanceMatrix[0].xyz);
          vec3 toCam = cameraPosition - c.xyz; float d = length(toCam);
          float face = smoothstep(-0.05, 0.45, dot(normalize(aDir), toCam / d));
          vec4 mv = viewMatrix * c; mv.z += min(0.6, d * 0.5);             // pull toward the camera so the car body does not clip it
          mv.xy += position.xy * max(s, minPx * d);
          vUv = uv; vC = vec4(aCol.rgb, aCol.a * face);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying vec4 vC;
        void main(){ float a = texture2D(map, vUv).a * vC.a; if (a < 0.003) discard; gl_FragColor = vec4(vC.rgb * a, a); }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, max); this.mesh.frustumCulled = false; this.mesh.renderOrder = 13; this.mesh.count = 0;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4(); this._s = new THREE.Vector3(); this._q = new THREE.Quaternion();
  }
  begin() { this.n = 0; }
  // pos: world position, dir: world facing (unit), rgb: HDR colour, a: alpha, size: metres
  add(pos, dir, r, g, b, a, size) {
    if (this.n >= this.max) return; const i = this.n++;
    this._m.compose(pos, this._q, this._s.set(size, size, size)); this.mesh.setMatrixAt(i, this._m);
    this.dir[i * 3] = dir.x; this.dir[i * 3 + 1] = dir.y; this.dir[i * 3 + 2] = dir.z;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
  }
  end() {
    this.mesh.count = this.n; this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.geometry.attributes.aDir.needsUpdate = true; this.mesh.geometry.attributes.aCol.needsUpdate = true;
  }
}

export class WetStreaks {
  constructor(scene, max = 160) {
    this.max = max; this.n = 0;
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);   // x across, z along (0..1) toward the camera
    this.col = new Float32Array(max * 4);
    geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
      polygonOffset: true, polygonOffsetFactor: -4,
      vertexShader: `attribute vec4 aCol; varying vec2 vP; varying vec4 vC; varying float vD;
        void main(){ vP = vec2(position.x, position.z); vC = aCol; vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0); vD = distance(wp.xyz, cameraPosition);
          gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `varying vec2 vP; varying vec4 vC; varying float vD;
        void main(){
          float across = exp(-pow(vP.x * 3.2, 2.0)), along = pow(1.0 - vP.y, 1.5) * smoothstep(0.0, 0.08, vP.y);
          float rip = 0.75 + 0.25 * sin(vP.y * 40.0);   // broken up by the wet surface
          float a = across * along * rip * vC.a * (1.0 - smoothstep(70.0, 140.0, vD));
          if (a < 0.002) discard;
          gl_FragColor = vec4(vC.rgb * a, a);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, max); this.mesh.frustumCulled = false; this.mesh.renderOrder = 4; this.mesh.count = 0;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
  }
  begin() { this.n = 0; }
  // lamp: world position of the lamp; cam: camera world position; streak lies on the ground under the lamp and runs toward the camera
  add(lamp, cam, r, g, b, a, width = 0.5, len = 3.5, toLocal = null) {
    if (this.n >= this.max) return; const i = this.n++;
    const dx = cam.x - lamp.x, dz = cam.z - lamp.z, yaw = Math.atan2(dx, dz);
    const dist = Math.hypot(dx, dz), grazing = Math.min(1, cam.y / Math.max(1, dist));   // longer streaks at grazing angles
    const L = len * (1.6 - grazing) * (0.6 + 0.4 * Math.min(1, lamp.y / 0.8));
    this._q.setFromEuler(this._e.set(0, yaw, 0)); this._m.compose(this._p.set(lamp.x, 0.025, lamp.z), this._q, this._s.set(width, 1, L));
    if (toLocal) this._m.premultiply(toLocal);     // mesh parented to a moving object: store in its local space
    this.mesh.setMatrixAt(i, this._m);
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
  }
  end() { this.mesh.count = this.n; this.mesh.instanceMatrix.needsUpdate = true; this.mesh.geometry.attributes.aCol.needsUpdate = true; }
}
