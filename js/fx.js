import * as THREE from 'three';
import { G } from './state.js';
import { rand, clamp, makeCanvas, canvasTex } from './util.js';

// ---------------------------------------------------------------------------
// Effects engine
//  - sprite particles (soft glow / noisy smoke / fire ramp) in two pools (additive + alpha)
//  - streak sparks drawn as velocity-aligned line segments
//  - electric arcs (jittering polylines)
//  - decals (bullet holes, scorch marks)
//  - rings, star flares, flash lights, ribbons, camera shake, hit-stop / slow-mo,
//    post-process shockwaves and floating text
// ---------------------------------------------------------------------------

const PVERT = `
attribute float size; attribute vec4 col; attribute float kind; attribute float age; attribute float seed;
varying vec4 vCol; varying float vKind; varying float vAge; varying float vSeed;
uniform float scale;
void main(){
  vCol = col; vKind = kind; vAge = age; vSeed = seed;
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  gl_PointSize = min(size * scale / max(0.1, -mv.z), 420.0);
  gl_Position = projectionMatrix * mv;
}`;
const PFRAG = `
varying vec4 vCol; varying float vKind; varying float vAge; varying float vSeed;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1.0,0.0)), f.x), mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float sn = sin(vSeed * 6.2831 + vAge * 1.2), cs = cos(vSeed * 6.2831 + vAge * 1.2);
  c = mat2(cs, -sn, sn, cs) * c;
  float d = length(c) * 2.0;
  vec3 rgb = vCol.rgb; float a;
  if (vKind < 0.5) {                       // soft glow
    a = pow(smoothstep(1.0, 0.0, d), 2.0);
  } else if (vKind < 1.5) {                // smoke puff: lumpy density with a faked top-left light
    vec2 q = c * 2.0;
    float n = fbm(q * 1.7 + vSeed * 19.0);
    float n2 = fbm(q * 1.7 + vSeed * 19.0 + vec2(0.35, 0.35));
    float dens = (1.0 - d) * 1.25 + (n - 0.5) * 1.1;
    a = smoothstep(0.0, 0.55, dens);
    float lit = clamp(0.62 + (n - n2) * 5.0, 0.35, 1.45);   // brighter toward the light, darker in the lee
    rgb *= lit;
  } else {                                 // fire: turbulent density -> heat ramp (white-hot core -> orange -> red -> ember)
    vec2 q = c * 2.0;
    float n  = fbm(q * 1.8 + vec2(vSeed * 31.0, -vAge * 1.4 + vSeed * 7.0));
    float n2 = fbm(q * 3.7 + vec2(-vAge * 0.9, vSeed * 13.0));
    float dens = clamp((1.0 - d) * 1.4 + (n - 0.45) * 1.2 + (n2 - 0.45) * 0.45 - vAge * 0.5, 0.0, 1.0);
    a = smoothstep(0.02, 0.5, dens);
    float heat = clamp(dens * (1.3 - vAge * 0.95), 0.0, 1.25);
    vec3 hot = vec3(2.1, 1.7, 0.95), mid = vec3(1.7, 0.66, 0.12), cool = vec3(0.5, 0.11, 0.035), ember = vec3(0.1, 0.025, 0.015);
    vec3 ramp = heat > 0.66 ? mix(mid, hot, (heat - 0.66) / 0.59) : (heat > 0.3 ? mix(cool, mid, (heat - 0.3) / 0.36) : mix(ember, cool, heat / 0.3));
    rgb = ramp * vCol.rgb;
  }
  float al = vCol.a * a;
#ifdef PREMULT
  gl_FragColor = vec4(rgb * al, vKind > 1.5 ? al * 0.8 : 0.0);   // glow = pure additive, fire = emissive and semi-opaque
  if (al < 0.003) discard;
#else
  gl_FragColor = vec4(rgb, al);
  if (al < 0.003) discard;
#endif
}`;

class ParticlePool {
  constructor(max, additive) {
    this.max = max; this.head = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.kind = new Float32Array(max); this.age = new Float32Array(max); this.seed = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.grow = new Float32Array(max);
    this.c0 = new Float32Array(max * 4); this.size0 = new Float32Array(max);
    this.floor = new Uint8Array(max);
    const g = new THREE.BufferGeometry();
    for (const [n, a, s] of [['position', this.pos, 3], ['col', this.col, 4], ['size', this.size, 1], ['kind', this.kind, 1], ['age', this.age, 1], ['seed', this.seed, 1]]) g.setAttribute(n, new THREE.BufferAttribute(a, s).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PVERT, fragmentShader: PFRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending, uniforms: { scale: { value: 800 } },
      defines: additive ? { PREMULT: 1 } : {},
    });
    if (additive) { this.mat.blendEquation = THREE.AddEquation; this.mat.blendSrc = THREE.OneFactor; this.mat.blendDst = THREE.OneMinusSrcAlphaFactor; }
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = additive ? 10 : 9;
    this.life.fill(0);
  }
  emit(x, y, z, vx, vy, vz, r, g, b, a, size, life, grav = 0, drag = 0, grow = 0, floor = 0, kind = 0) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    const i3 = i * 3, i4 = i * 4;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.c0[i4] = r; this.c0[i4 + 1] = g; this.c0[i4 + 2] = b; this.c0[i4 + 3] = a;
    this.size0[i] = size; this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow; this.floor[i] = floor; this.kind[i] = kind; this.seed[i] = Math.random(); this.age[i] = 0;
  }
  update(dt) {
    const { pos, vel, life, maxLife, col, c0, size, size0, grav, drag, grow, floor, age } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) { size[i] = 0; continue; }
      life[i] -= dt;
      if (life[i] <= 0) { size[i] = 0; col[i * 4 + 3] = 0; continue; }
      const i3 = i * 3, i4 = i * 4;
      const k = life[i] / maxLife[i];
      const dr = Math.exp(-drag[i] * dt);
      vel[i3] *= dr; vel[i3 + 1] = vel[i3 + 1] * dr - grav[i] * dt; vel[i3 + 2] *= dr;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      if (floor[i] && pos[i3 + 1] < 0.05) { pos[i3 + 1] = 0.05; vel[i3 + 1] *= -0.4; vel[i3] *= 0.7; vel[i3 + 2] *= 0.7; }
      col[i4] = c0[i4]; col[i4 + 1] = c0[i4 + 1]; col[i4 + 2] = c0[i4 + 2]; col[i4 + 3] = c0[i4 + 3] * (this.kind[i] > 1.5 ? Math.min(1, k * 2.2) : k);
      size[i] = size0[i] * (1 + grow[i] * (1 - k)); age[i] = 1 - k;
    }
    for (const n of ['position', 'col', 'size', 'age', 'kind', 'seed']) this.geo.attributes[n].needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Streak sparks: each spark is a line segment from its position back along its velocity
// ---------------------------------------------------------------------------
class SparkPool {
  constructor(max) {
    this.max = max; this.head = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.c = new Float32Array(max * 3); this.trail = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    this.life.fill(0);
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 6); this.col = new Float32Array(max * 8);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('col', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mesh = new THREE.LineSegments(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'attribute vec4 col; varying vec4 vC; void main(){ vC = col; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
      fragmentShader: 'varying vec4 vC; void main(){ gl_FragColor = vC; }',
    }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 11;
  }
  emit(x, y, z, vx, vy, vz, r, g, b, life, trail = 0.04, grav = 14, drag = 0.6) {
    const i = this.head; this.head = (this.head + 1) % this.max; const i3 = i * 3;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z; this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.c[i3] = r; this.c[i3 + 1] = g; this.c[i3 + 2] = b; this.life[i] = this.maxLife[i] = life; this.trail[i] = trail; this.grav[i] = grav; this.drag[i] = drag;
  }
  update(dt) {
    const { p, v, life, maxLife, c, trail, grav, drag, pos, col } = this;
    for (let i = 0; i < this.max; i++) {
      const o = i * 6, q = i * 8;
      if (life[i] <= 0) { if (col[q + 3] !== 0 || col[q + 7] !== 0) { col[q + 3] = 0; col[q + 7] = 0; pos[o + 1] = pos[o + 4] = -999; } continue; }
      life[i] -= dt; const i3 = i * 3;
      if (life[i] <= 0) { col[q + 3] = col[q + 7] = 0; pos[o + 1] = pos[o + 4] = -999; continue; }
      const dr = Math.exp(-drag[i] * dt);
      v[i3] *= dr; v[i3 + 1] = v[i3 + 1] * dr - grav[i] * dt; v[i3 + 2] *= dr;
      p[i3] += v[i3] * dt; p[i3 + 1] += v[i3 + 1] * dt; p[i3 + 2] += v[i3 + 2] * dt;
      if (p[i3 + 1] < 0.02 && grav[i] > 0) { p[i3 + 1] = 0.02; v[i3 + 1] *= -0.35; v[i3] *= 0.6; v[i3 + 2] *= 0.6; }
      const k = life[i] / maxLife[i], tl = trail[i];
      pos[o] = p[i3]; pos[o + 1] = p[i3 + 1]; pos[o + 2] = p[i3 + 2];
      pos[o + 3] = p[i3] - v[i3] * tl; pos[o + 4] = p[i3 + 1] - v[i3 + 1] * tl; pos[o + 5] = p[i3 + 2] - v[i3 + 2] * tl;
      col[q] = c[i3]; col[q + 1] = c[i3 + 1]; col[q + 2] = c[i3 + 2]; col[q + 3] = Math.min(1, k * 1.6);
      col[q + 4] = c[i3] * 0.5; col[q + 5] = c[i3 + 1] * 0.35; col[q + 6] = c[i3 + 2] * 0.3; col[q + 7] = 0;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.col.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Electric arcs: jittering camera-facing ribbons (re-rolled every frame so they crackle)
// each segment = a thin white-hot core quad + a wider soft coloured glow quad
// ---------------------------------------------------------------------------
class ArcPool {
  constructor(maxArcs = 28, seg = 9) {
    this.max = maxArcs; this.seg = seg; this.arcs = [];
    const nv = maxArcs * seg * 12;
    this.pos = new Float32Array(nv * 3); this.col = new Float32Array(nv * 4); this.across = new Float32Array(nv);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('col', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('across', new THREE.BufferAttribute(this.across, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g; g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: 'attribute vec4 col; attribute float across; varying vec4 vC; varying float vA; void main(){ vC = col; vA = across; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
      fragmentShader: 'varying vec4 vC; varying float vA; void main(){ float k = 1.0 - abs(vA); gl_FragColor = vec4(vC.rgb, vC.a * k * k); }',
    }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 13;
    this._d = new THREE.Vector3(); this._p1 = new THREE.Vector3(); this._p2 = new THREE.Vector3(); this._s = new THREE.Vector3(); this._m = new THREE.Vector3(); this._prev = new THREE.Vector3(); this._cur = new THREE.Vector3(); this._tc = new THREE.Vector3();
  }
  add(a, b, color, jitter, life, width = 1, still = false) {
    if (this.arcs.length >= this.max) this.arcs.shift();
    const A = { a: a.clone(), b: b.clone(), c: new THREE.Color(color), jitter, life, maxLife: life, width, still };
    if (still) { A.off = new Float32Array((this.seg + 1) * 2); for (let i = 0; i < A.off.length; i++) A.off[i] = Math.random() - 0.5; }   // fixed jagged shape (bolts)
    this.arcs.push(A);
  }
  quad(vi, a, b, side, w, r, g, bl, al, cr, cg, cb, ca) {
    // two triangles: (a-s, a+s, b-s) (a+s, b+s, b-s); `across` = -1 / +1 for the soft profile
    const { pos, col, across } = this, s = side;
    const pts = [[a, -1], [a, 1], [b, -1], [a, 1], [b, 1], [b, -1]];
    for (let i = 0; i < 6; i++) {
      const [pt, ac] = pts[i], o = (vi + i) * 3, c = (vi + i) * 4;
      pos[o] = pt.x + s.x * w * ac; pos[o + 1] = pt.y + s.y * w * ac; pos[o + 2] = pt.z + s.z * w * ac;
      col[c] = r; col[c + 1] = g; col[c + 2] = bl; col[c + 3] = al; across[vi + i] = ac;
    }
    return vi + 6;
  }
  update(dt) {
    let vi = 0; const { seg } = this;
    for (let n = this.arcs.length - 1; n >= 0; n--) { const A = this.arcs[n]; A.life -= dt; if (A.life <= 0) this.arcs.splice(n, 1); }
    const dir = this._d, perp1 = this._p1, perp2 = this._p2, side = this._s, mid = this._m, prev = this._prev, cur = this._cur, cam = G.camera ? G.camera.position : this._tc;
    for (const A of this.arcs) {
      const k = A.life / A.maxLife; dir.subVectors(A.b, A.a); const len = dir.length(); dir.divideScalar(len || 1);
      perp1.set(-dir.z, 0, dir.x); if (perp1.lengthSq() < 0.01) perp1.set(1, 0, 0); perp1.normalize(); perp2.crossVectors(dir, perp1).normalize();
      for (let s = 0; s <= seg; s++) {
        const t = s / seg, amp = Math.sin(Math.PI * t) * A.jitter * Math.min(1, len * 0.5);
        const r1 = A.still ? A.off[s * 2] + (Math.random() - 0.5) * 0.12 : Math.random() - 0.5, r2 = A.still ? A.off[s * 2 + 1] + (Math.random() - 0.5) * 0.12 : Math.random() - 0.5;
        cur.copy(A.a).addScaledVector(dir, len * t).addScaledVector(perp1, r1 * 2 * amp).addScaledVector(perp2, r2 * 2 * amp);
        if (s > 0) {
          mid.addVectors(prev, cur).multiplyScalar(0.5).sub(cam); side.subVectors(cur, prev).cross(mid).normalize();
          const flick = 0.75 + Math.random() * 0.5, wd = A.width;
          vi = this.quad(vi, prev, cur, side, 0.11 * wd * (0.5 + k * 0.5), 0, 0, 0, 0.55 * k * flick, 0, 0, 0, 0);   // soft glow (colour set below)
          for (let q = vi - 6; q < vi; q++) { this.col[q * 4] = A.c.r * 1.5; this.col[q * 4 + 1] = A.c.g * 1.5; this.col[q * 4 + 2] = A.c.b * 1.5; }
          vi = this.quad(vi, prev, cur, side, 0.024 * wd, 0, 0, 0, k * flick, 0, 0, 0, 0);                    // hot core
          for (let q = vi - 6; q < vi; q++) { this.col[q * 4] = 3.2; this.col[q * 4 + 1] = 3.2; this.col[q * 4 + 2] = 3.4; }
        }
        prev.copy(cur);
      }
    }
    this.geo.setDrawRange(0, vi);
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.col.needsUpdate = true; this.geo.attributes.across.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Decals: instanced quads laid on surfaces (bullet holes, scorch marks)
// ---------------------------------------------------------------------------
class DecalPool {
  constructor(max = 220) {
    this.max = max; this.head = 0;
    const g = new THREE.PlaneGeometry(1, 1);
    this.data = new Float32Array(max * 4);   // birth, kind, seed, 0
    g.setAttribute('iData', new THREE.InstancedBufferAttribute(this.data, 4));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, uniforms: { time: { value: 0 } },
      vertexShader: `attribute vec4 iData; varying vec2 vUv; varying vec4 vD;
        void main(){ vUv = uv; vD = iData; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec2 vUv; varying vec4 vD; uniform float time;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
        void main(){
          vec2 c = vUv - 0.5; float d = length(c) * 2.0;
          float age = time - vD.x; float fade = 1.0 - smoothstep(16.0, 22.0, age);
          if (vD.x < 0.0 || fade <= 0.0) discard;
          vec3 col = vec3(0.0); float a = 0.0;
          float n = vn(c * 9.0 + vD.z * 20.0);
          if (vD.y < 0.5) {            // bullet hole: dark pit, chipped rim, hot glow fading in 1.5 s
            float pit = smoothstep(0.34, 0.12, d + (n - 0.5) * 0.28);
            float rim = smoothstep(0.7, 0.3, d + (n - 0.5) * 0.5) * 0.45;
            a = max(pit * 0.95, rim); col = vec3(0.02);
            float hot = exp(-age * 2.2) * smoothstep(0.28, 0.0, d);
            col += vec3(3.0, 1.2, 0.35) * hot; a = max(a, hot);
          } else if (vD.y < 1.5) {     // scorch: soft dark smear with ragged edge
            float s = smoothstep(1.0, 0.1, d + (n - 0.5) * 0.7);
            a = s * 0.78; col = vec3(0.012, 0.01, 0.01);
            float hot = exp(-age * 0.8) * smoothstep(0.5, 0.0, d); col += vec3(1.6, 0.5, 0.12) * hot; a = max(a, hot * 0.6);
          } else {                     // plasma burn: ring
            float ring = smoothstep(0.1, 0.0, abs(d - 0.55 - (n - 0.5) * 0.12)); a = ring * 0.7 + smoothstep(0.5, 0.1, d) * 0.4; col = vec3(0.02, 0.03, 0.05) + vec3(0.2, 0.7, 1.4) * exp(-age * 1.6) * ring;
          }
          gl_FragColor = vec4(col, a * fade); if (gl_FragColor.a < 0.004) discard;
        }`,
    });
    this.mesh = new THREE.InstancedMesh(g, this.mat, max); this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
    const m = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < max; i++) { this.mesh.setMatrixAt(i, m); this.data[i * 4] = -1; }
  }
  add(p, n, kind, size) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * 6.28));
    const m = new THREE.Matrix4().compose(p.clone().addScaledVector(n, 0.01), q, new THREE.Vector3(size, size, 1));
    this.mesh.setMatrixAt(i, m); this.mesh.instanceMatrix.needsUpdate = true;
    this.data[i * 4] = G.time; this.data[i * 4 + 1] = kind; this.data[i * 4 + 2] = Math.random(); this.mesh.geometry.attributes.iData.needsUpdate = true;
  }
}

const _c = new THREE.Color(), _v = new THREE.Vector3();
const rings = [];
const lightPool = [];
let lightHead = 0;
const floaters = [];
let floatLayer;
let shakeAmt = 0;
let hitstopT = 0, slowT = 0, slowScale = 1;
let ringGeo, ringTex, flareTex; const flares = []; let flareHead = 0;

export const fx = {
  add: null, smoke: null, sparks: null, arcs: null, decals: null, shocks: [],
  init(scene) {
    this.scene = scene;
    this.add = new ParticlePool(7000, true);
    this.smoke = new ParticlePool(2200, false);
    this.sparks = new SparkPool(3600);
    this.arcs = new ArcPool(44, 9);
    this.decals = new DecalPool(220);
    scene.add(this.add.points, this.smoke.points, this.sparks.mesh, this.arcs.mesh, this.decals.mesh);

    const [c, x] = makeCanvas(128, 128);
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.72, 'rgba(255,255,255,0)'); g.addColorStop(0.9, 'rgba(255,255,255,0.95)'); g.addColorStop(0.95, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    ringTex = canvasTex(c);
    ringGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);

    {
      const [c2, x2] = makeCanvas(128, 128);
      const rg = x2.createRadialGradient(64, 64, 0, 64, 64, 64); rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.18, 'rgba(255,255,255,0.55)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      x2.fillStyle = rg; x2.fillRect(0, 0, 128, 128);
      x2.globalCompositeOperation = 'lighter';
      for (const [w2, h2] of [[128, 5], [5, 128], [92, 3], [3, 92]]) { const g2 = x2.createLinearGradient(64 - w2 / 2, 0, 64 + w2 / 2, 0); g2.addColorStop(0, 'rgba(255,255,255,0)'); g2.addColorStop(0.5, 'rgba(255,255,255,0.9)'); g2.addColorStop(1, 'rgba(255,255,255,0)'); x2.save(); x2.translate(64, 64); if (h2 > w2) x2.rotate(Math.PI / 2); x2.fillStyle = g2; x2.fillRect(-Math.max(w2, h2) / 2, -Math.min(w2, h2) / 2, Math.max(w2, h2), Math.min(w2, h2)); x2.restore(); }
      flareTex = canvasTex(c2);
      for (let i = 0; i < 6; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flareTex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, toneMapped: false, fog: false })); s.visible = false; s.renderOrder = 15; s.userData = { t: 0, dur: 0.06, size: 1 }; scene.add(s); flares.push(s); }
    }
    for (let i = 0; i < 5; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 30, 2);
      l.userData = { t: 0, dur: 0.1, peak: 0 };
      scene.add(l); lightPool.push(l);
    }
    floatLayer = document.getElementById('floaters');
  },
  setScale(h) { this.add.mat.uniforms.scale.value = h * 0.9; this.smoke.mat.uniforms.scale.value = h * 0.9; },

  // ----- emitters -----
  // streaking sparks (+ a few glowing motes so bloom has something to catch)
  spark(p, n = 8, color = 0xffc060, speed = 8, life = 0.5, dir = null, spread = 1) {
    _c.set(color);
    for (let i = 0; i < n; i++) {
      let vx, vy, vz;
      if (dir) { vx = dir.x + rand(-1, 1) * spread; vy = dir.y + rand(-1, 1) * spread; vz = dir.z + rand(-1, 1) * spread; const l = Math.hypot(vx, vy, vz) || 1; const s = rand(0.35, 1) * speed; vx = vx / l * s; vy = vy / l * s; vz = vz / l * s; }
      else { const a = rand(Math.PI * 2), e = rand(-0.2, 1), s = rand(0.3, 1) * speed; vx = Math.cos(a) * s; vy = e * s; vz = Math.sin(a) * s; }
      this.sparks.emit(p.x, p.y, p.z, vx, vy, vz, _c.r * 2.4, _c.g * 2.4, _c.b * 2.4, rand(0.25, 1) * life, 0.03 + Math.random() * 0.03, 16, 0.7);
    }
    if (n > 6) this.add.emit(p.x, p.y, p.z, 0, 0, 0, _c.r * 1.2, _c.g * 1.2, _c.b * 1.2, 0.7, 0.35, 0.08, 0, 0, -0.4);
  },
  burst(p, n, color, speed, size, life, grav = 0, drag = 2) {
    _c.set(color);
    for (let i = 0; i < n; i++) {
      _v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(0.3, 1) * speed);
      this.add.emit(p.x, p.y, p.z, _v.x, _v.y, _v.z, _c.r, _c.g, _c.b, 1, size * rand(0.6, 1.3), life * rand(0.6, 1), grav, drag, -0.3);
    }
  },
  glowPuff(p, color, size, life) { _c.set(color); this.add.emit(p.x, p.y, p.z, 0, 0, 0, _c.r * 1.5, _c.g * 1.5, _c.b * 1.5, 1, size, life, 0, 0, -0.8); },
  smokePuff(p, n = 3, size = 1.4, life = 1.4, dark = 0.18, up = 1.5) {
    for (let i = 0; i < n; i++) {
      this.smoke.emit(p.x + rand(-0.3, 0.3), p.y + rand(0, 0.3), p.z + rand(-0.3, 0.3), rand(-0.6, 0.6), up * rand(0.5, 1.2), rand(-0.6, 0.6), dark, dark, dark * 1.1, 0.55, size * rand(0.8, 1.4), life * rand(0.7, 1.2), -0.2, 0.8, 1.8, 0, 1);
    }
  },
  fire(p, n = 4, scale = 1) {
    for (let i = 0; i < n; i++) {
      this.add.emit(p.x + rand(-0.4, 0.4) * scale, p.y, p.z + rand(-0.4, 0.4) * scale, rand(-0.5, 0.5), rand(2, 4) * scale, rand(-0.5, 0.5), 1, 1, 1, 0.9, rand(0.9, 1.7) * scale, rand(0.45, 0.85), -1, 0.6, -0.55, 0, 2);
    }
    if (Math.random() < 0.4) this.smoke.emit(p.x, p.y + 1, p.z, rand(-0.5, 0.5), rand(1.5, 3), rand(-0.5, 0.5), 0.1, 0.1, 0.11, 0.45, rand(1.5, 2.5) * scale, rand(1, 1.8), -0.2, 0.5, 1.5, 0, 1);
  },
  rain(p) { this.add.emit(p.x, p.y, p.z, rand(-0.6, 0.6), rand(0.8, 2), rand(-0.6, 0.6), 0.4, 0.5, 0.75, 0.3, 0.09, 0.2, 6, 0, 0.4); },
  flare(p, color, size = 1.6, dur = 0.07) {
    const s = flares[flareHead]; flareHead = (flareHead + 1) % flares.length;
    s.position.copy(p); s.material.color.set(color).multiplyScalar(2.2); s.material.rotation = Math.random() * 6.28;
    s.userData.t = dur; s.userData.dur = dur; s.userData.size = size; s.scale.setScalar(size); s.visible = true;
  },
  muzzle(p, dir, color) {
    _c.set(color);
    this.flare(p, color, 2.2, 0.07);
    this.glowPuff(p, color, 1.6, 0.07);
    this.spark(p, 7, color, 22, 0.22, dir, 0.55);
    // ejected brass
    this.sparks.emit(p.x, p.y - 0.05, p.z, -dir.z * 3 + rand(-1, 1), rand(2, 4), dir.x * 3 + rand(-1, 1), 3.5, 2.6, 0.8, 0.5, 0.04, 22, 0.2);
    this.smokePuff(p, 1, 0.8, 0.7, 0.35, 0.4);
    this.flash(p, color, 6, 0.07, 14);
  },
  impact(p, n, color = 0xffd080, normal = null) { this.spark(p, n, color, 12, 0.55, normal, 0.9); this.flash(p, color, 2.5, 0.08, 10); this.glowPuff(p, color, 1.2, 0.1); },
  arc(a, b, color = 0x9fe0ff, jitter = 0.35, life = 0.12) { this.arcs.add(a, b, color, jitter, life); },
  // distant lightning bolt: jagged chain from the cloud base down to a rooftop, with forks
  bolt(top, ground, color = 0xcfe0ff, life = 0.3) {
    const d = top.distanceTo(G.camera.position) || 100, w = Math.max(1, d / 5.5);
    const dir = new THREE.Vector3().subVectors(ground, top), len = dir.length(), n = 6, pts = [top.clone()];
    for (let i = 1; i < n; i++) pts.push(top.clone().addScaledVector(dir, i / n).add(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).multiplyScalar(len * 0.07)));
    pts.push(ground.clone());
    for (let i = 0; i < n; i++) this.arcs.add(pts[i], pts[i + 1], color, len * 0.035, life, w, true);
    for (let k = 0; k < 3; k++) {
      const a = pts[1 + Math.floor(Math.random() * (n - 2))], b = a.clone().add(new THREE.Vector3(rand(-1, 1) * len * 0.25, -rand(0.12, 0.35) * len, rand(-1, 1) * len * 0.25));
      this.arcs.add(a, b, color, len * 0.04, life * 0.8, w * 0.55, true);
    }
  },
  arcBurst(c, radius = 1, n = 3, color = 0x9fe0ff, life = 0.1) {
    for (let i = 0; i < n; i++) {
      const a = new THREE.Vector3(c.x + rand(-0.2, 0.2), c.y + rand(-0.2, 0.2), c.z + rand(-0.2, 0.2));
      const b = new THREE.Vector3(c.x + rand(-radius, radius), c.y + rand(-radius * 0.6, radius), c.z + rand(-radius, radius));
      this.arc(a, b, color, 0.4, life);
    }
  },
  decal(p, normal, kind = 0, size = 0.3) { this.decals.add(p, normal, kind, size); },
  ring(p, color, maxScale = 6, dur = 0.5, vertical = null, thick = 1) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: ringTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    m.position.copy(p); if (vertical) m.lookAt(p.clone().add(vertical));
    m.scale.setScalar(0.1);
    m.renderOrder = 11;
    this.scene.add(m);
    rings.push({ m, t: 0, dur, maxScale, thick });
  },
  explosion(p, size = 1) {
    const q = p.clone(); q.y = Math.max(q.y, 0.6);
    this.flash(q, 0xff8a30, 22 * size, 0.55, 46 * size);
    this.ring(new THREE.Vector3(q.x, 0.2, q.z), 0xffa050, 13 * size, 0.55, null, 0.8);
    this.ring(new THREE.Vector3(q.x, 0.25, q.z), 0xfff0d0, 19 * size, 0.32, null, 0.5);
    // white-hot core flash (very brief)
    this.flare(q, 0xffd090, 5.5 * size, 0.14);
    this.glowPuff(q, 0xffb060, 6 * size, 0.16);
    // fireball: turbulent fire sprites that billow out, rise and cool from white to red
    for (let i = 0; i < 13 * size; i++) {
      const v = _v.set(rand(-1, 1), rand(0.0, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(2, 8) * size);
      this.add.emit(q.x + rand(-0.5, 0.5), q.y + rand(-0.3, 0.5), q.z + rand(-0.5, 0.5), v.x, v.y + 1.8, v.z, 1, 1, 1, 1, rand(1.7, 3.3) * size, rand(0.55, 1.15), -0.9, 2.3, 0.8, 0, 2);
    }
    // glowing embers & debris streaks
    for (let i = 0; i < 36 * size; i++) { const v = _v.set(rand(-1, 1), rand(-0.2, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(5, 22) * size); this.sparks.emit(q.x, q.y, q.z, v.x, v.y, v.z, 3.0, rand(0.7, 1.4), 0.22, rand(0.5, 1.4), 0.05, 18, 0.5); }
    this.spark(q, 24 * size, 0xffcc66, 22 * size, 1.1);
    // rolling smoke column + dust ring (drawn behind the fire)
    for (let i = 0; i < 20 * size; i++) { const v = _v.set(rand(-1, 1), rand(0.2, 1.7), rand(-1, 1)).normalize().multiplyScalar(rand(1.5, 7) * size); this.smoke.emit(q.x, q.y, q.z, v.x, v.y, v.z, 0.1, 0.09, 0.09, 0.8, rand(2.2, 4.4) * size, rand(1.8, 3.4), -0.4, 1.0, 2.0, 0, 1); }
    for (let i = 0; i < 16 * size; i++) { const a = rand(0, Math.PI * 2); this.smoke.emit(q.x, 0.3, q.z, Math.cos(a) * rand(6, 12) * size, 0.3, Math.sin(a) * rand(6, 12) * size, 0.3, 0.28, 0.3, 0.4, rand(1.5, 3) * size, rand(0.8, 1.6), 0, 2.4, 1.2, 0, 1); }
    if (q.y < 3) this.decal(new THREE.Vector3(q.x, 0.02, q.z), new THREE.Vector3(0, 1, 0), 1, 7 * size);
    this.shake(1.1 * size); this.shockwave(q, 0.9 * Math.min(1.4, size), 0.75, 0.5);
  },
  flash(p, color, intensity = 5, dur = 0.1, dist = 20) {
    const l = lightPool[lightHead]; lightHead = (lightHead + 1) % lightPool.length;
    l.position.copy(p); l.color.set(color); l.distance = dist; l.userData.t = dur; l.userData.dur = dur; l.userData.peak = intensity * 6; l.intensity = intensity * 6;
  },
  shockwave(p, strength = 1, life = 0.8, maxR = 0.55) { this.shocks.push({ p: p.clone(), t: 0, life, strength, maxR }); if (this.shocks.length > 4) this.shocks.shift(); },
  updateShocks(arr, cam) {
    for (let i = 0; i < 4; i++) {
      const s = this.shocks[i];
      if (!s) { arr[i].set(0, 0, 0, 0); continue; }
      const v = s.p.clone().project(cam);
      if (v.z > 1) { arr[i].set(0, 0, 0, 0); continue; }
      const k = s.t / s.life;
      arr[i].set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5, k * s.maxR, s.strength * (1 - k) * (1 - k));
    }
  },
  shake(a) { shakeAmt = Math.min(2.2, Math.max(shakeAmt, a)); },
  get shakeValue() { return shakeAmt; },
  hitstop(d) { hitstopT = Math.max(hitstopT, d); },
  slowmo(scale, dur) { slowScale = scale; slowT = dur; },
  text(worldPos, str, cls = '') {
    if (!floatLayer) return;
    if (floaters.length > 24) { const f = floaters.shift(); f.el.remove(); }
    const el = document.createElement('div'); el.className = 'float ' + cls; el.textContent = str;
    floatLayer.appendChild(el);
    floaters.push({ el, pos: worldPos.clone(), t: 0, life: 1.0, vx: rand(-20, 20) });
  },

  // ----- per-frame -----
  update(rdt, gdt) {
    this.add.update(gdt); this.smoke.update(gdt); this.sparks.update(gdt); this.arcs.update(gdt);
    this.decals.mat.uniforms.time.value = G.time;
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i]; r.t += gdt; const k = r.t / r.dur;
      if (k >= 1) { this.scene.remove(r.m); r.m.material.dispose(); rings.splice(i, 1); continue; }
      const e = 1 - Math.pow(1 - k, 3);
      r.m.scale.setScalar(0.1 + r.maxScale * e);
      r.m.material.opacity = (1 - k) * (1 - k) * r.thick;
    }
    for (const l of lightPool) {
      if (l.userData.t > 0) { l.userData.t -= gdt; l.intensity = Math.max(0, l.userData.peak * (l.userData.t / l.userData.dur)); }
      else l.intensity = 0;
    }
    for (const s of flares) if (s.visible) { s.userData.t -= rdt; if (s.userData.t <= 0) s.visible = false; else { const k = s.userData.t / s.userData.dur; s.scale.setScalar(s.userData.size * (0.6 + 0.6 * k)); s.material.opacity = k; } }
    for (let i = this.shocks.length - 1; i >= 0; i--) { this.shocks[i].t += rdt; if (this.shocks[i].t >= this.shocks[i].life) this.shocks.splice(i, 1); }
    shakeAmt = Math.max(0, shakeAmt - rdt * 3.2);
    // time scale
    let ts = 1;
    if (hitstopT > 0) { hitstopT -= rdt; ts = 0.03; }
    else if (slowT > 0) { slowT -= rdt; ts = slowScale; }
    G.timeScale = ts;
    // floating texts
    const cam = G.camera;
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i]; f.t += rdt;
      if (f.t > f.life) { f.el.remove(); floaters.splice(i, 1); continue; }
      const v = f.pos.clone(); v.y += f.t * 1.6; v.project(cam);
      if (v.z > 1) { f.el.style.display = 'none'; continue; }
      f.el.style.display = '';
      f.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * innerWidth + f.vx * f.t}px, ${(-v.y * 0.5 + 0.5) * innerHeight}px) translate(-50%,-50%) scale(${1 + Math.max(0, 0.25 - f.t) * 3})`;
      f.el.style.opacity = String(1 - Math.pow(f.t / f.life, 2));
    }
  },
};

// ---------------------------------------------------------------------------
// Ribbon trail (baton swipes, boost trails)
// ---------------------------------------------------------------------------
export class Ribbon {
  constructor(scene, n = 14, color = 0xfff0a0, width = 1) {
    this.n = n;
    this.pts = [];
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3);
    this.alpha = new Float32Array(n * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { color: { value: new THREE.Color(color) } },
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA=alpha; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
      fragmentShader: 'uniform vec3 color; varying float vA; void main(){ gl_FragColor = vec4(color*2.2, vA); }',
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    scene.add(this.mesh);
    this.active = false;
  }
  push(a, b) {
    this.pts.unshift([a.clone(), b.clone()]);
    if (this.pts.length > this.n) this.pts.pop();
    this.write();
  }
  decay() { if (this.pts.length) { this.pts.pop(); this.write(); } }
  write() {
    const m = this.pts.length;
    for (let i = 0; i < this.n; i++) {
      const p = this.pts[Math.min(i, m - 1)];
      if (!p) { this.alpha[i * 2] = this.alpha[i * 2 + 1] = 0; continue; }
      const k = i < m ? 1 - i / this.n : 0;
      this.pos.set([p[0].x, p[0].y, p[0].z, p[1].x, p[1].y, p[1].z], i * 6);
      this.alpha[i * 2] = k * 0.9; this.alpha[i * 2 + 1] = k * 0.2;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
  }
  clear() { this.pts.length = 0; this.write(); }
}
