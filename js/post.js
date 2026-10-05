import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// ---------------------------------------------------------------------------
// Post-processing stack (all linear HDR until the very last pass):
//   scene (MSAA, half-float) -> NaN scrub -> BloomStack (dual-filter pyramid + anamorphic streaks)
//   -> final pass: shock waves / speed blur / aberration, bloom composite, filmic tone map that keeps
//      neon saturated, grade, sharpen, vignette, grain + dither.
// ---------------------------------------------------------------------------

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const mkMat = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
const rtOpts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false };

// 13-tap dual-filter downsample; the first level also applies the soft-knee threshold with a Karis average so lone sparkles do not flicker
const DOWN_FS = `uniform sampler2D tSrc; uniform vec2 texel; uniform float uFirst; uniform float uThresh; uniform float uKnee; varying vec2 vUv;
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 prefilter(vec3 c){
  float br = max(max(c.r, c.g), c.b);
  float rq = clamp(br - uThresh + uKnee, 0.0, 2.0 * uKnee); rq = rq * rq / (4.0 * uKnee + 1e-4);
  return c * (max(rq, br - uThresh) / max(br, 1e-4));
}
vec3 S(vec2 o){ return texture2D(tSrc, vUv + o * texel).rgb; }
void main(){
  vec3 a = S(vec2(-2.,-2.)), b = S(vec2(0.,-2.)), c = S(vec2(2.,-2.));
  vec3 d = S(vec2(-2., 0.)), e = S(vec2(0., 0.)), f = S(vec2(2., 0.));
  vec3 g = S(vec2(-2., 2.)), h = S(vec2(0., 2.)), i = S(vec2(2., 2.));
  vec3 j = S(vec2(-1.,-1.)), k = S(vec2(1.,-1.)), l = S(vec2(-1., 1.)), m = S(vec2(1., 1.));
  vec3 r;
  if (uFirst > 0.5) {
    // Karis average: groups are weighted by 1/(1+luma) so a single over-bright pixel cannot flicker the whole bloom
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
    float w0 = 0.125 / (1.0 + luma(g0)), w1 = 0.125 / (1.0 + luma(g1)), w2 = 0.125 / (1.0 + luma(g2)), w3 = 0.125 / (1.0 + luma(g3)), w4 = 0.5 / (1.0 + luma(g4));
    r = (prefilter(g0) * w0 + prefilter(g1) * w1 + prefilter(g2) * w2 + prefilter(g3) * w3 + prefilter(g4) * w4) / (w0 + w1 + w2 + w3 + w4);
  } else {
    r = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(r, 1.0);
}`;
// tent upsample of the lower level added onto the level above
const UP_FS = `uniform sampler2D tHigh; uniform sampler2D tLow; uniform vec2 texel; uniform float uScatter; uniform float uHigh; varying vec2 vUv;
void main(){
  vec3 s = texture2D(tLow, vUv + texel * vec2(-1., -1.)).rgb + 2. * texture2D(tLow, vUv + texel * vec2(0., -1.)).rgb + texture2D(tLow, vUv + texel * vec2(1., -1.)).rgb
         + 2. * texture2D(tLow, vUv + texel * vec2(-1., 0.)).rgb + 4. * texture2D(tLow, vUv).rgb + 2. * texture2D(tLow, vUv + texel * vec2(1., 0.)).rgb
         + texture2D(tLow, vUv + texel * vec2(-1., 1.)).rgb + 2. * texture2D(tLow, vUv + texel * vec2(0., 1.)).rgb + texture2D(tLow, vUv + texel * vec2(1., 1.)).rgb;
  vec3 h = uHigh > 0.5 ? texture2D(tHigh, vUv).rgb : vec3(0.0);
  gl_FragColor = vec4(h + s / 16.0 * uScatter, 1.0);
}`;
// 1-D horizontal gaussian-ish blur that isolates the brightest peaks: stretches into the anamorphic streak
const STREAK_FS = `uniform sampler2D tSrc; uniform vec2 texel; uniform float uPeak; varying vec2 vUv;
void main(){
  vec3 acc = vec3(0.0); float ws = 0.0;
  for (int i = -8; i <= 8; i++) {
    float w = exp(-float(i * i) / 28.0);
    vec3 c = texture2D(tSrc, vUv + vec2(float(i) * 2.0 * texel.x, 0.0)).rgb;
    acc += max(c - vec3(uPeak), 0.0) * w; ws += w;
  }
  gl_FragColor = vec4(acc / ws, 1.0);
}`;

class BloomStack extends Pass {
  constructor(w, h) {
    super();
    this.needsSwap = false;
    this.levels = 6; this.streakOn = true; this.strength = 1;
    this.threshold = 1.05; this.knee = 0.7; this.scatter = 0.62; this.streakPeak = 2.2;
    this.quad = new FullScreenQuad(null);
    this.down = []; this.up = []; this.sBlur = []; this.sUp = [];
    this.downMat = mkMat(DOWN_FS, { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, uFirst: { value: 0 }, uThresh: { value: this.threshold }, uKnee: { value: this.knee } });
    this.upMat = mkMat(UP_FS, { tHigh: { value: null }, tLow: { value: null }, texel: { value: new THREE.Vector2() }, uScatter: { value: 1 }, uHigh: { value: 1 } });
    this.streakMat = mkMat(STREAK_FS, { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, uPeak: { value: this.streakPeak } });
    this.black = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType); this.black.needsUpdate = true;
    this.setSize(w, h);
  }
  get bloomTex() { return this.enabled && this.up[0] ? this.up[0].texture : this.black; }
  get streakTex() { return this.enabled && this.streakOn && this.sUp[1] ? this.sUp[1].texture : this.black; }
  setSize(w, h) {
    for (const r of [...this.down, ...this.up, ...this.sBlur, ...this.sUp]) r?.dispose();
    this.down = []; this.up = []; this.sBlur = []; this.sUp = [];
    let cw = Math.max(2, Math.floor(w / 2)), ch = Math.max(2, Math.floor(h / 2));
    for (let i = 0; i < this.levels; i++) {
      this.down.push(new THREE.WebGLRenderTarget(cw, ch, rtOpts)); this.up.push(new THREE.WebGLRenderTarget(cw, ch, rtOpts));
      this.sBlur.push(i >= 1 ? new THREE.WebGLRenderTarget(cw, ch, rtOpts) : null); this.sUp.push(i >= 1 ? new THREE.WebGLRenderTarget(cw, ch, rtOpts) : null);
      cw = Math.max(2, Math.floor(cw / 2)); ch = Math.max(2, Math.floor(ch / 2));
    }
    this.size = [w, h];
  }
  run(renderer, mat, target) { this.quad.material = mat; renderer.setRenderTarget(target); this.quad.render(renderer); }
  render(renderer, writeBuffer, readBuffer) {
    const L = this.levels, dm = this.downMat, um = this.upMat;
    const prev = renderer.getRenderTarget();
    // 1. downsample pyramid (first level thresholds)
    let src = readBuffer.texture, sw = readBuffer.width, sh = readBuffer.height;
    dm.uniforms.uThresh.value = this.threshold; dm.uniforms.uKnee.value = this.knee;
    for (let i = 0; i < L; i++) {
      dm.uniforms.tSrc.value = src; dm.uniforms.texel.value.set(1 / sw, 1 / sh); dm.uniforms.uFirst.value = i === 0 ? 1 : 0;
      this.run(renderer, dm, this.down[i]);
      src = this.down[i].texture; sw = this.down[i].width; sh = this.down[i].height;
    }
    // 2. upsample, adding each level on top of the one above
    um.uniforms.uScatter.value = this.scatter;
    for (let i = L - 1; i >= 0; i--) {
      if (i === L - 1) { um.uniforms.tLow.value = this.down[i].texture; um.uniforms.uHigh.value = 0; um.uniforms.tHigh.value = this.down[i].texture; um.uniforms.uScatter.value = 1; um.uniforms.texel.value.set(1 / this.down[i].width, 1 / this.down[i].height); }
      else { um.uniforms.tLow.value = this.up[i + 1].texture; um.uniforms.tHigh.value = this.down[i].texture; um.uniforms.uHigh.value = 1; um.uniforms.uScatter.value = this.scatter; um.uniforms.texel.value.set(1 / this.up[i + 1].width, 1 / this.up[i + 1].height); }
      this.run(renderer, um, this.up[i]);
    }
    // 3. anamorphic streaks: horizontally smear only the brightest peaks of the mid levels, then merge them back up
    if (this.streakOn) {
      const sm = this.streakMat; sm.uniforms.uPeak.value = this.streakPeak;
      for (let i = 1; i < L; i++) { sm.uniforms.tSrc.value = this.down[i].texture; sm.uniforms.texel.value.set(1 / this.down[i].width, 1 / this.down[i].height); this.run(renderer, sm, this.sBlur[i]); }
      for (let i = L - 1; i >= 1; i--) {
        if (i === L - 1) { um.uniforms.uHigh.value = 0; um.uniforms.tLow.value = this.sBlur[i].texture; um.uniforms.tHigh.value = this.sBlur[i].texture; um.uniforms.uScatter.value = 1; um.uniforms.texel.value.set(1 / this.sBlur[i].width, 1 / this.sBlur[i].height); }
        else { um.uniforms.uHigh.value = 1; um.uniforms.tLow.value = this.sUp[i + 1].texture; um.uniforms.tHigh.value = this.sBlur[i].texture; um.uniforms.uScatter.value = 0.9; um.uniforms.texel.value.set(1 / this.sUp[i + 1].width, 1 / this.sUp[i + 1].height); }
        this.run(renderer, um, this.sUp[i]);
      }
    }
    renderer.setRenderTarget(prev);
  }
}

// Screen-space ambient occlusion from the scene's resolved depth texture (no extra geometry pass): normals are rebuilt from depth,
// a spiral of hemisphere samples is tested against the depth buffer at half resolution, then a depth-aware blur removes the noise.
const AO_FS = `uniform sampler2D tDepth; uniform vec2 res; uniform vec2 proj; uniform mat4 projMat; uniform float near, far, uRadius, uStrength; varying vec2 vUv;
float viewZ(float d){ return (near * far) / ((far - near) * d - far); }
vec3 viewPos(vec2 uv, float d){ float z = viewZ(d); return vec3((uv * 2.0 - 1.0) * (-z) / proj, z); }
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main(){
  float d0 = texture2D(tDepth, vUv).r;
  if (d0 >= 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec2 px = 1.0 / res;
  vec3 P = viewPos(vUv, d0);
  if (-P.z > 90.0) { gl_FragColor = vec4(1.0); return; }
  vec3 Pr = viewPos(vUv + vec2(px.x, 0.0), texture2D(tDepth, vUv + vec2(px.x, 0.0)).r), Pl = viewPos(vUv - vec2(px.x, 0.0), texture2D(tDepth, vUv - vec2(px.x, 0.0)).r);
  vec3 Pu = viewPos(vUv + vec2(0.0, px.y), texture2D(tDepth, vUv + vec2(0.0, px.y)).r), Pd = viewPos(vUv - vec2(0.0, px.y), texture2D(tDepth, vUv - vec2(0.0, px.y)).r);
  vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
  vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
  vec3 N = normalize(cross(dx, dy)); if (N.z < 0.0) N = -N;
  vec3 T = normalize(abs(N.y) < 0.99 ? cross(N, vec3(0.0, 1.0, 0.0)) : cross(N, vec3(1.0, 0.0, 0.0))); vec3 B = cross(N, T);
  float rot = ign(gl_FragCoord.xy) * 6.2831853;
  float occ = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    float fi = (float(i) + 0.5) / float(SAMPLES);
    float a = rot + float(i) * 2.399963;
    float r = sqrt(fi);
    vec3 sd = T * (cos(a) * r) + B * (sin(a) * r) + N * sqrt(max(0.0, 1.0 - fi));
    vec3 S = P + sd * uRadius * mix(0.12, 1.0, fi * fi);
    vec4 sp = projMat * vec4(S, 1.0);
    vec2 suv = sp.xy / sp.w * 0.5 + 0.5;
    float sz = viewZ(texture2D(tDepth, suv).r);
    float range = smoothstep(0.0, 1.0, uRadius / max(abs(P.z - sz), 1e-3));
    occ += (sz >= S.z + 0.04 + 0.01 * (-P.z) ? 1.0 : 0.0) * range;
  }
  float ao = 1.0 - clamp(occ / float(SAMPLES) * uStrength, 0.0, 1.0);
  ao = mix(ao, 1.0, smoothstep(55.0, 90.0, -P.z));
  gl_FragColor = vec4(vec3(ao), 1.0);
}`;
const AO_BLUR_FS = `uniform sampler2D tAO; uniform sampler2D tDepth; uniform vec2 texel; uniform vec2 dir; uniform float near, far; varying vec2 vUv;
float viewZ(float d){ return (near * far) / ((far - near) * d - far); }
void main(){
  float zc = viewZ(texture2D(tDepth, vUv).r);
  float acc = 0.0, ws = 0.0;
  for (int i = -3; i <= 3; i++) {
    vec2 uv = vUv + dir * texel * float(i);
    float z = viewZ(texture2D(tDepth, uv).r);
    float w = exp(-float(i * i) / 6.0) * exp(-abs(z - zc) * 1.6 / max(1.0, -zc * 0.15));
    acc += texture2D(tAO, uv).r * w; ws += w;
  }
  gl_FragColor = vec4(vec3(acc / ws), 1.0);
}`;
class SSAOPass extends Pass {
  constructor(camera, w, h) {
    super();
    this.depthTex = null;
    this.needsSwap = false; this.camera = camera; this.radius = 1.7; this.strength = 2.6; this.samples = 10;
    this.quad = new FullScreenQuad(null);
    const o = { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false };
    this.rt = [new THREE.WebGLRenderTarget(2, 2, o), new THREE.WebGLRenderTarget(2, 2, o)];
    this.make();
    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat); this.white.needsUpdate = true;
    this.setSize(w, h);
  }
  make() {
    const common = { tDepth: { value: null }, near: { value: 0.1 }, far: { value: 1000 } };
    this.aoMat = mkMat(AO_FS, { ...common, res: { value: new THREE.Vector2() }, proj: { value: new THREE.Vector2(1, 1) }, projMat: { value: new THREE.Matrix4() }, uRadius: { value: this.radius }, uStrength: { value: this.strength } });
    this.aoMat.defines = { SAMPLES: this.samples };
    this.blurMat = mkMat(AO_BLUR_FS, { ...common, tAO: { value: null }, texel: { value: new THREE.Vector2() }, dir: { value: new THREE.Vector2() } });
  }
  setSamples(n) { if (n !== this.samples) { this.samples = n; this.aoMat.defines = { SAMPLES: n }; this.aoMat.needsUpdate = true; } }
  get aoTex() { return this.enabled ? this.rt[0].texture : this.white; }
  setSize(w, h) { this.w = Math.max(2, Math.floor(w / 2)); this.h = Math.max(2, Math.floor(h / 2)); for (const r of this.rt) r.setSize(this.w, this.h); }
  render(renderer, writeBuffer, readBuffer) {
    const depth = readBuffer.depthTexture; if (!depth) return;
    this.depthTex = depth;
    const c = this.camera, pm = c.projectionMatrix, am = this.aoMat.uniforms, bm = this.blurMat.uniforms, prev = renderer.getRenderTarget();
    am.tDepth.value = depth; am.res.value.set(this.w, this.h); am.proj.value.set(pm.elements[0], pm.elements[5]); am.projMat.value.copy(pm);
    am.near.value = c.near; am.far.value = c.far; am.uRadius.value = this.radius; am.uStrength.value = this.strength;
    this.quad.material = this.aoMat; renderer.setRenderTarget(this.rt[1]); this.quad.render(renderer);
    bm.tDepth.value = depth; bm.near.value = c.near; bm.far.value = c.far; bm.texel.value.set(1 / this.w, 1 / this.h);
    bm.tAO.value = this.rt[1].texture; bm.dir.value.set(1, 0); this.quad.material = this.blurMat; renderer.setRenderTarget(this.rt[0]); this.quad.render(renderer);
    bm.tAO.value = this.rt[0].texture; bm.dir.value.set(0, 1); renderer.setRenderTarget(this.rt[1]); this.quad.render(renderer);
    // result lives in rt[1]; expose it as rt[0] for the final pass by swapping
    const t = this.rt[0]; this.rt[0] = this.rt[1]; this.rt[1] = t;
    renderer.setRenderTarget(prev);
  }
}

// scrub NaN / Inf / absurd HDR values before bloom: one bad pixel would otherwise be blurred across the whole screen (black frame)
const SCRUB = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: VERT,
  fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0); gl_FragColor = vec4(clamp(c.rgb, 0.0, 64.0), 1.0); }',
};

const FINAL = {
  uniforms: {
    tDiffuse: { value: null }, tBloom: { value: null }, tStreak: { value: null }, tAO: { value: null }, uAO: { value: 1 }, uDbg: { value: 0 }, uFade: { value: 1 },
    tDepth: { value: null }, uDof: { value: 0 }, uFocus: { value: 10 }, uAperture: { value: 1.6 }, uNear: { value: 0.1 }, uFar: { value: 1000 },
    time: { value: 0 }, res: { value: new THREE.Vector2(1, 1) },
    uBloom: { value: 0.55 }, uStreak: { value: 0.5 }, uExposure: { value: 1.12 },
    aber: { value: 0.0006 }, vig: { value: 0.42 }, grain: { value: 0.025 }, speed: { value: 0 }, sharpen: { value: 0.3 },
    sat: { value: 1.12 }, contrast: { value: 1.08 }, flash: { value: 0 }, hurt: { value: 0 },
    shock: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
  },
  vertexShader: VERT,
  fragmentShader: `uniform sampler2D tDiffuse, tBloom, tStreak, tAO, tDepth; uniform float uAO, uDbg, uFade, uDof, uFocus, uAperture, uNear, uFar; uniform vec2 res; uniform float time, uBloom, uStreak, uExposure, aber, vig, grain, speed, sharpen, sat, contrast, flash, hurt; uniform vec4 shock[4]; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    // filmic curve that keeps neon saturated: per-channel ACES blended with a hue-preserving luminance-mapped colour, then a gentle white roll-off of over-exposed highlights
    vec3 tonemap(vec3 c) {
      c *= uExposure;
      vec3 t = aces(c);
      float l = luma(c), lt = luma(t);
      vec3 hp = c * (lt / max(l, 1e-4));
      float over = max(max(hp.r, hp.g), hp.b);
      hp = hp / max(1.0, over);
      hp = mix(hp, vec3(lt), smoothstep(1.5, 8.0, over) * 0.55);
      return mix(t, hp, 0.5);
    }
    vec3 encode(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    // AO darkens ambient light only: bright (emissive) pixels are exempt so neon never gets dirty halos
    vec3 hdr(vec2 uv) { vec3 c = texture2D(tDiffuse, uv).rgb; float ao = texture2D(tAO, uv).r; return c * mix(1.0, ao, uAO * (1.0 - smoothstep(0.8, 2.6, luma(c)))); }
    // depth of field (cinematics only): circle of confusion from scene depth, gathered over a golden-angle disc; bright pixels weigh more so lights become bokeh
    float distZ(vec2 uv) { float d = texture2D(tDepth, uv).r; return (uNear * uFar) / (uFar - d * (uFar - uNear)); }
    float cocAt(float z) { return clamp(abs(z - uFocus) / max(z, 0.5) * uAperture, 0.0, 1.0); }
    vec3 sceneColor(vec2 uv) {
      if (uDof < 0.001) return hdr(uv);
      float maxR = 16.0 * res.y / 1080.0 * uDof;
      float z = distZ(uv), coc = cocAt(z) * maxR;
      if (coc < 0.7) return hdr(uv);
      vec3 acc = hdr(uv); float ws = 1.0; vec2 px = 1.0 / res;
      for (int i = 0; i < 16; i++) {
        float fi = float(i) + 0.5, a = fi * 2.399963, r = sqrt(fi / 16.0) * coc;
        vec2 suv = uv + vec2(cos(a), sin(a)) * r * px;
        float sc = cocAt(distZ(suv)) * maxR;
        vec3 c = hdr(suv);
        float w = clamp(sc - r + 1.0, 0.0, 1.0) * (1.0 + luma(c) * 0.5);
        acc += c * w; ws += w;
      }
      return acc / ws;
    }
    void main(){
      vec2 uv = vUv; float aspect = res.x / res.y;
      // expanding shockwave rings bend the image
      for (int i = 0; i < 4; i++) {
        vec4 s = shock[i];
        if (s.w > 0.001) {
          vec2 d = uv - s.xy; d.x *= aspect; float r = length(d);
          float ring = exp(-pow((r - s.z) / 0.045, 2.0));
          vec2 dir = d / (r + 1e-4); dir.x /= aspect;
          uv -= dir * ring * s.w * 0.05;
        }
      }
      if (uDbg > 0.5) { gl_FragColor = vec4(vec3(texture2D(tAO, vUv).r), 1.0); return; }   // debug view: raw AO buffer
      vec2 c = uv - 0.5; float d2 = dot(c, c);
      vec3 col;
      if (speed > 0.01) { // radial speed blur
        vec3 acc = vec3(0.0);
        for (int i = 0; i < 8; i++) { float t = float(i) / 7.0; acc += hdr(0.5 + c * (1.0 - speed * 0.07 * t)); }
        col = acc / 8.0;
      } else col = sceneColor(uv);
      // chromatic aberration grows toward the edges
      vec2 off = c * aber * (1.0 + d2 * 8.0);
      col.r = hdr(uv + off).r * 0.5 + col.r * 0.5;
      col.b = hdr(uv - off).b * 0.5 + col.b * 0.5;
      // bloom + anamorphic streaks (cool tint), lens-style: a touch of the glow is added in the wider falloff too
      vec3 bl = texture2D(tBloom, uv).rgb, st = texture2D(tStreak, uv).rgb;
      col += bl * uBloom * mix(vec3(1.0), vec3(1.06, 0.97, 0.92), 0.5) + st * uStreak * vec3(0.55, 0.78, 1.15);
      vec3 mapped = tonemap(col);
      // unsharp mask on the tone-mapped image (so bright lights don't ring)
      vec2 px = 1.0 / res;
      vec3 nb = (tonemap(hdr(uv + vec2(px.x, 0.0))) + tonemap(hdr(uv - vec2(px.x, 0.0))) + tonemap(hdr(uv + vec2(0.0, px.y))) + tonemap(hdr(uv - vec2(0.0, px.y)))) * 0.25;
      mapped += clamp(mapped - nb, -0.08, 0.08) * sharpen * 2.0;
      vec3 g = encode(clamp(mapped, 0.0, 1.0));
      // grade (display space): saturation, S-curve contrast, teal-violet shadows / warm highlights
      float l = luma(g);
      g = mix(vec3(l), g, sat);
      g = (g - 0.5) * contrast + 0.5;
      g += vec3(-0.012, 0.004, 0.032) * (1.0 - smoothstep(0.0, 0.5, l)) + vec3(0.03, 0.012, -0.015) * smoothstep(0.45, 1.0, l);
      g += vec3(0.55, 0.6, 0.9) * flash * 0.12;
      g *= 1.0 - d2 * vig * 2.0;
      g = mix(g, g * vec3(1.15, 0.55, 0.55), hurt * smoothstep(0.1, 0.45, d2));
      // film grain + triangular dither (kills banding in the dark fog gradients)
      float n1 = hash(vUv * res + time), n2 = hash(vUv * res * 1.37 + time + 17.0);
      g += (n1 - 0.5) * grain + (n1 + n2 - 1.0) / 255.0;
      gl_FragColor = vec4(clamp(g, 0.0, 1.0) * uFade, 1.0);
    }`,
};

export function createPost(renderer, scene, camera, W, H, PR) {
  const rt = new THREE.WebGLRenderTarget(W * PR, H * PR, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(W * PR, H * PR) });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(PR);
  composer.addPass(new RenderPass(scene, camera));
  const ssao = new SSAOPass(camera, W * PR, H * PR);
  composer.addPass(ssao);
  composer.addPass(new ShaderPass(SCRUB));
  const bloom = new BloomStack(W * PR, H * PR);
  composer.addPass(bloom);
  const post = new ShaderPass(FINAL);
  composer.addPass(post);
  const U = post.uniforms;
  const sync = () => { U.tBloom.value = bloom.bloomTex; U.tStreak.value = bloom.streakTex; U.tAO.value = ssao.aoTex; U.tDepth.value = composer.renderTarget2.depthTexture; U.uNear.value = camera.near; U.uFar.value = camera.far; };
  const origRender = post.render.bind(post);
  post.render = (r, wb, rb, dt, mask) => { sync(); origRender(r, wb, rb, dt, mask); };
  return {
    composer, post, bloom, ssao, uniforms: U,
    setSize(w, h, pr) {
      composer.setPixelRatio(pr); composer.setSize(w, h);
      const dw = Math.floor(w * pr), dh = Math.floor(h * pr);
      bloom.setSize(dw, dh); ssao.setSize(dw, dh); U.res.value.set(dw, dh);
    },
    setQuality(Q) {
      bloom.enabled = Q.bloom; bloom.streakOn = !!Q.streaks;
      U.uBloom.value = Q.bloom ? 0.55 : 0; U.uStreak.value = Q.streaks ? 0.5 : 0;
      ssao.enabled = !!Q.ao; if (Q.ao) ssao.setSamples(Q.ao);
    },
  };
}
