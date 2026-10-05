import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { eagleShape } from './world.js';
import { G } from './state.js';
import { makeCanvas, canvasTex, clamp, damp } from './util.js';
import { patchRim } from './shaders.js';
import { V3, lin, cosSpace, se, smoothstep, mix, surface, patch, capRing, ringAt, M4, xf, rod, pipe, lathe, coil, slab, warp, patchGlass, Kit } from './vehicle_geo.js';
import * as TX from './vehicle_tex.js';
import { WetStreaks } from './vehicle_fx.js';

// ===========================================================================
// THE LAWMASTER — hero pursuit cruiser of the Justice Department.
// Sculpted frame-mounted fairing that flows out of the tank into a shark nose (big headlamp,
// auxiliary lamps, gold eagle, twin slung cannons), boxer twin with a glowing fusion cell,
// chrome crash bars, raked telescopic fork with exposed gold springs and twin drilled discs,
// shaft-drive swingarm on twin gold-sprung shocks, fat treaded tyres with raised sidewall
// lettering, hard panniers with eagle plates, wraparound LED tail, red/blue strobes front and rear.
// Bike-local axes: +Z forward, +Y up, origin on the ground between the wheels.
//
// Hierarchy (static parts merged per material per group):
//   model (bike.js: position / yaw / lean)
//    └ roll
//       └ sprung (pitch / heave about the centre of mass)
//          └ inner (bike space at rest): frame, body, engine, rider
//             ├ rake -> front (steering; rotation.y) -> forkLow (dive slide) -> fw -> frontSpin
//             └ swing (swingarm angle) -> rear -> rearSpin
// ===========================================================================

const RAKE = 30 * Math.PI / 180;
const HEAD = V3(0, 1.42, 0.81);            // steering head (top yoke) in bike space
const FORK_L = 1.074, FORK_OFF = 0.06;     // fork length along the steering axis / offset ahead of it
const COM = V3(0, 0.82, -0.05);
const PIVOT = V3(0, 0.60, -0.40);          // swingarm pivot
const RF = 0.52, RR = 0.55;                // wheel radii
const AXLE_F = V3(0, RF, 1.40), AXLE_R = V3(0, RR, -1.30);
const WB = AXLE_F.z - AXLE_R.z;
const Z0 = 0.58, Z1 = 1.86;                // fairing extent (rear edge hugs the tank)
const TZ0 = -2.08, TZ1 = -0.86;            // tail cowl extent
const LAMP = V3(0, 1.245, Z1 - 0.045);     // main headlamp centre
const PARK_ROLL = -0.1;                     // parked: settles this far onto the side stand (toward +X, the left)
const STAND_PIVOT = V3(0.24, 0.42, -0.3), STAND_FOOT = V3(0.48, 0.048, -0.42);   // foot touches the ground once rolled
const STAND_LEN = STAND_PIVOT.distanceTo(STAND_FOOT);
const Q_STAND_DOWN = new THREE.Quaternion().setFromUnitVectors(V3(0, -1, 0), STAND_FOOT.clone().sub(STAND_PIVOT).normalize());
const Q_STAND_UP = new THREE.Quaternion().setFromUnitVectors(V3(0, -1, 0), V3(0.03, 0.06, -1).normalize());

// bike space -> front (steering) local space at zero steer
const toFront = (x, y, z) => { const dy = y - HEAD.y, dz = z - HEAD.z, c = Math.cos(RAKE), s = Math.sin(RAKE); return V3(x, dy * c - dz * s, dy * s + dz * c); };

// ---------------------------------------------------------------- materials
// Static materials are shared per palette; anything animated per bike is created per instance.
const STATIC = new Map();
function staticMats(P) {
  const key = [P.body, P.accent, P.glow, P.seat, P.stripe, P.perp].join('_');
  if (STATIC.has(key)) return STATIC.get(key);
  const flake = TX.flakeTex(); flake.repeat.set(10, 10);
  const leather = TX.leatherTex();
  const brushed = TX.brushedTex(); brushed.repeat.set(2, 2);
  const tread = TX.treadTex(); tread.repeat.set(6, 1);
  const sw = TX.sidewallTex();
  const m = {
    paint: new THREE.MeshPhysicalMaterial({ color: P.body, metalness: 0.5, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.05, normalMap: flake, normalScale: new THREE.Vector2(0.18, 0.18), envMapIntensity: 1.9 }),
    accent: new THREE.MeshPhysicalMaterial({ color: P.accentPaint, metalness: 0.45, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, normalMap: flake, normalScale: new THREE.Vector2(0.15, 0.15), envMapIntensity: 1.7 }),
    gold: new THREE.MeshPhysicalMaterial({ color: P.accent, metalness: 1, roughness: 0.24, emissive: new THREE.Color(P.accent).multiplyScalar(0.08), envMapIntensity: 1.8 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe2e6ee, metalness: 1, roughness: 0.07, envMapIntensity: 2.4 }),
    brushed: new THREE.MeshStandardMaterial({ color: 0xb4b8c0, metalness: 1, roughness: 0.34, roughnessMap: brushed, envMapIntensity: 1.7 }),
    gun: new THREE.MeshStandardMaterial({ color: 0x2b2e35, metalness: 0.85, roughness: 0.36, envMapIntensity: 1.5 }),
    satin: new THREE.MeshStandardMaterial({ color: 0x15161b, metalness: 0.6, roughness: 0.42, envMapIntensity: 1.2 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0b0b0e, metalness: 0.15, roughness: 0.62 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0d0d0f, metalness: 0, roughness: 0.86 }),
    tread: new THREE.MeshStandardMaterial({ color: 0x17171a, metalness: 0, roughness: 0.78, normalMap: tread, normalScale: new THREE.Vector2(1.5, 1.5), envMapIntensity: 0.8 }),
    sidewall: new THREE.MeshStandardMaterial({ map: sw.map, normalMap: sw.normal, normalScale: new THREE.Vector2(1.2, 1.2), metalness: 0, roughness: 0.72, envMapIntensity: 0.8 }),
    leather: new THREE.MeshPhysicalMaterial({ color: P.seat, map: leather.map, normalMap: leather.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.48, metalness: 0.05, clearcoat: 0.35, clearcoatRoughness: 0.35 }),
    glass: patchGlass(new THREE.MeshPhysicalMaterial({ color: 0x30404e, metalness: 0.0, roughness: 0.03, envMapIntensity: 2.8, side: THREE.DoubleSide, depthWrite: false }), 0.14, 0.85, 2.2),
    lensGlass: patchGlass(new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.0, roughness: 0.02, envMapIntensity: 2.0, depthWrite: false }), 0.05, 0.6, 2.0),
    mirror: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.0, envMapIntensity: 2.2 }),
    disc: new THREE.MeshStandardMaterial({ map: TX.discTex(), alphaTest: 0.5, metalness: 0.9, roughness: 0.28, side: THREE.DoubleSide, envMapIntensity: 1.4 }),
    heat: new THREE.MeshStandardMaterial({ map: TX.heatTex(), metalness: 1, roughness: 0.12, envMapIntensity: 2.0 }),
    perf: new THREE.MeshStandardMaterial({ color: 0x18191d, map: TX.perfTex(), alphaTest: 0.5, metalness: 0.7, roughness: 0.4, side: THREE.DoubleSide }),
    eagle: new THREE.MeshPhysicalMaterial({ color: P.accent, metalness: 1, roughness: 0.2, normalMap: TX.eagleNormal(), normalScale: new THREE.Vector2(1.0, 1.0), emissive: new THREE.Color(P.accent).multiplyScalar(0.1), envMapIntensity: 2.0 }),
    reflector: new THREE.MeshStandardMaterial({ map: TX.reflectorTex(), color: 0xffffff, metalness: 1, roughness: 0.12, envMapIntensity: 2.0, side: THREE.DoubleSide }),
    dash: new THREE.MeshBasicMaterial({ map: TX.dashTex(), color: new THREE.Color(1.5, 1.5, 1.5), toneMapped: false }),
    ready: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2010).multiplyScalar(1.8), toneMapped: false }),
  };
  m.eagle.normalMap.repeat.set(0.5, 1 / 1.35); m.eagle.normalMap.offset.set(0.5, 0.25 / 1.35);
  {   // chevron stripes for the front fender crown (classic red / white Lawmaster); perps get their own colours
    const [sc, sx] = makeCanvas(512, 128); sx.fillStyle = P.stripe ? '#16161a' : '#ece8de'; sx.fillRect(0, 0, 512, 128);
    for (let i = -2; i < 12; i += 2) { sx.fillStyle = P.stripe ?? '#c21a16'; sx.beginPath(); sx.moveTo(i * 44, 0); sx.lineTo(i * 44 + 44, 0); sx.lineTo(i * 44 + 44 - 60, 128); sx.lineTo(i * 44 - 60, 128); sx.fill(); }
    sx.strokeStyle = 'rgba(20,0,0,0.5)'; sx.lineWidth = 3; for (let i = -2; i < 14; i++) { sx.beginPath(); sx.moveTo(i * 44, 0); sx.lineTo(i * 44 - 60, 128); sx.stroke(); }
    m.stripes = new THREE.MeshPhysicalMaterial({ map: canvasTex(sc), roughness: 0.3, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.5 });
  }
  const dec = (tex, o = {}) => new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.35, depthWrite: false, metalness: 0.85, roughness: 0.22, polygonOffset: true, polygonOffsetFactor: -2, envMapIntensity: 2.0, ...o });
  m.badge = dec(TX.wordTex(P.perp ? 'DEMON' : 'LAWMASTER', { fill: P.perp ? '#ff4040' : 'chrome' }));
  m.justice = dec(TX.wordTex(P.perp ? 'NO LAW' : 'JUSTICE DEPT', { fill: 'gold', italic: false }));
  m.number = dec(TX.wordTex(P.perp ? 'SPD-66' : 'MC-1 0451', { fill: P.perp ? '#ff4a4a' : '#d8dce4', italic: false, w: 512, h: 96 }), { metalness: 0.3, roughness: 0.35 });
  m.plate = new THREE.MeshStandardMaterial({ map: TX.plateTex(P.perp ? 'GRK 666' : 'JUDGE 1', P.perp ? { bg: '#d8d0b8', band: '#7a1010' } : {}), roughness: 0.42, metalness: 0.25 });
  for (const k of ['paint', 'accent', 'gun', 'satin']) patchRim(m[k], 0x7aa6ff, 3.2, k === 'paint' ? 0.16 : 0.12);
  for (const k of ['glass', 'lensGlass', 'badge', 'justice', 'number']) m[k].userData.noShadow = true;
  STATIC.set(key, m);
  return m;
}
function dynamicMats(P) {
  const E = (c, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false });
  return {
    lens: E(0xfff2dc, 2.6), drl: E(0xbfe6ff, 2.4), amberL: E(0xff8a10, 0.35), amberR: E(0xff8a10, 0.35), tail: E(0xff1208, 1.7), brake: E(0xff1a10, 1.6),
    glow: E(P.glow, 2.2), tip: E(0xff5a20, 0.6),
    sirenL: new THREE.MeshBasicMaterial({ color: 0x401010, toneMapped: false }), sirenR: new THREE.MeshBasicMaterial({ color: 0x101040, toneMapped: false }),
    blur: new THREE.MeshStandardMaterial({ map: TX.blurTex(), color: 0x6a6e78, transparent: true, opacity: 0, metalness: 0.8, roughness: 0.4, depthWrite: false, envMapIntensity: 1.2 }),
  };
}

const rb = (w, h, d, r = 0.02, s = 1) => new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
const rb1 = (w, h, d, r = 0.01) => rb(w, h, d, r, 1);
// place geometry: +Y of the geometry along dir, origin at pos
const _o3 = new THREE.Object3D();
function along(geo, pos, dir, sy = 1) { _o3.position.copy(pos); _o3.quaternion.setFromUnitVectors(V3(0, 1, 0), dir.clone().normalize()); _o3.scale.set(1, sy, 1); _o3.updateMatrix(); return geo.applyMatrix4(_o3.matrix); }
// sculpted eagle relief: bevelled extrusion of the Justice Dept eagle, wings bent by `bend` (m per m^2)
let EAGLE_SHAPE = null;
function smoothEagle() {
  if (EAGLE_SHAPE) return EAGLE_SHAPE;
  let pts = eagleShape().getPoints(1).map((p) => [p.x, p.y]);
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6) pts.pop();
  for (let it = 0; it < 1; it++) { const o = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); } pts = o; }
  EAGLE_SHAPE = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  return EAGLE_SHAPE;
}
function eagleGeo(width, depth, bend = 0, smooth = true) {
  const g = new THREE.ExtrudeGeometry(smooth ? smoothEagle() : eagleShape(), { depth, bevelEnabled: true, bevelThickness: depth * 0.6, bevelSize: smooth ? 0.022 : 0.015, bevelSegments: smooth ? 2 : 1, curveSegments: 1 });
  g.translate(0, -0.4, -depth / 2); g.scale(width / 2, width / 2, width / 2);
  if (bend) warp(g, (v) => { v.z -= bend * v.x * v.x; }, true);
  return g;
}

// Wheel: fat tyre (tread crown + lettered sidewalls), dished rim with chrome lips, 6 split spokes, hub, disc(s), blur discs.
// Built around the X axle, spinning about X, collected into `spin`.
function buildWheel(kit, spin, mats, R, W, discs) {
  const rIn = R * 0.64, hw = W / 2, SEG = 56;
  const side = [[rIn - 0.005, hw * 0.78], [rIn + 0.02, hw * 0.9], [rIn + (R - rIn) * 0.35, hw * 0.99], [rIn + (R - rIn) * 0.55, hw * 1.0], [R - 0.06, hw * 0.97]];
  const crown = []; for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI; crown.push([R - 0.06 + 0.06 * Math.pow(Math.sin(a), 0.55), -hw * 0.97 * Math.cos(a)]); }
  const lat = (pairs, out) => { const g = lathe(pairs, SEG, out); g.rotateZ(-Math.PI / 2); return g; };
  const cg = lat(crown, [1, 0]); { const uv = cg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i)); }
  kit.add(cg, mats.tread, spin);
  for (const s of [-1, 1]) {
    const g = lat(side.map(([r, a]) => [r, s * a]), [0, s]); const uv = g.attributes.uv;
    // lettering: u around (reads clockwise from either side), v from the bead outward
    for (let i = 0; i < uv.count; i++) { const v = uv.getY(i); uv.setXY(i, s > 0 ? 1 - uv.getX(i) : uv.getX(i), s > 0 ? 1 - v : v); }
    kit.add(g, mats.sidewall, spin);
  }
  kit.add(xf(new THREE.CylinderGeometry(rIn, rIn, W * 0.8, 40, 1, true), 0, 0, 0, 0, 0, Math.PI / 2), mats.gun, spin);
  for (const s of [-1, 1]) kit.add(xf(new THREE.TorusGeometry(rIn + 0.004, 0.012, 4, SEG), s * hw * 0.8, 0, 0, 0, Math.PI / 2, 0), mats.chrome, spin);
  for (const s of [-1, 1]) { const face = lathe([[rIn - 0.002, s * hw * 0.8], [rIn - 0.03, s * hw * 0.74], [rIn - 0.05, s * hw * 0.58]], SEG, [0, s]); face.rotateZ(-Math.PI / 2); kit.add(face, mats.brushed, spin); }
  const spokeR = rIn - 0.04;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const P = (r, da, ax) => V3(ax, Math.cos(a + da) * r, Math.sin(a + da) * r);
    kit.add(rod(P(0.07, 0, 0), P(0.17, 0, 0), 0.022, 6, 0.017), mats.gun, spin);
    for (const s of [-1, 1]) kit.add(rod(P(0.165, 0, 0), P(spokeR, s * 0.17, 0), 0.013, 6, 0.011), mats.gun, spin);
    for (const s of [-1, 1]) kit.add(rod(P(0.17, 0, s * 0.012), P(spokeR - 0.01, s * 0.165, s * 0.009), 0.004, 4), mats.chrome, spin);
  }
  kit.add(xf(lathe([[0.0, -hw * 0.55], [0.06, -hw * 0.55], [0.085, -hw * 0.35], [0.085, hw * 0.35], [0.06, hw * 0.55], [0.0, hw * 0.55]], 20, [1, 0]), 0, 0, 0, 0, 0, -Math.PI / 2), mats.gun, spin);
  for (const s of [-1, 1]) {
    kit.add(xf(lathe([[0, 0.02], [0.05, 0.016], [0.062, 0.0]], 20, [0, 1]), s * hw * 0.55, 0, 0, 0, 0, -s * Math.PI / 2), mats.chrome, spin);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; kit.add(xf(new THREE.CylinderGeometry(0.009, 0.009, 0.02, 6), s * hw * 0.55, Math.cos(a) * 0.072, Math.sin(a) * 0.072, 0, 0, Math.PI / 2), mats.chrome, spin); }
  }
  for (const ax of discs) { const d = new THREE.RingGeometry(0.06, rIn - 0.075, 40, 1); d.rotateY(Math.PI / 2); d.translate(ax, 0, 0); kit.add(d, mats.disc, spin); }
  for (const s of [-1, 1]) { const b = new THREE.CircleGeometry(rIn - 0.004, 36); b.rotateY(s * Math.PI / 2); b.translate(s * hw * 0.86, 0, 0); kit.add(b, mats.blur, spin); }   // outboard of discs and rim face
}

// ---------------------------------------------------------------- flame shader (boost afterburner with shock diamonds)
let FLAME_MAT = null;
function flameMaterial() {
  if (FLAME_MAT) return FLAME_MAT;
  FLAME_MAT = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    uniforms: { time: { value: 0 }, power: { value: 0 }, col: { value: new THREE.Color(0.35, 0.6, 1.0) } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform float time; uniform float power; uniform vec3 col; varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      void main(){
        float t = vUv.y;                                    // 0 at the nozzle -> 1 at the tail
        float core = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float diamonds = 0.55 + 0.45 * smoothstep(0.35, 1.0, sin(t * 26.0 - time * 3.0) * 0.5 + 0.5) * (1.0 - t);
        float turb = n(vec2(vUv.x * 6.0, t * 7.0 - time * 22.0));
        float a = pow(1.0 - t, 1.5) * core * diamonds * (0.65 + 0.7 * turb) * power;
        vec3 c = mix(vec3(1.4, 1.5, 1.8), col * 1.6, smoothstep(0.0, 0.35, t));
        c = mix(c, vec3(1.6, 0.5, 0.9), smoothstep(0.55, 1.0, t) * 0.5);
        gl_FragColor = vec4(c * a * 2.2, a);
      }`,
  });
  return FLAME_MAT;
}
// volumetric headlight cone (additive, rain-streaked) — local +Z forward, apex at the origin
function beamMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { time: { value: 0 }, k: { value: 1 }, len: { value: 14 } },
    vertexShader: `uniform float len; varying float vT; varying vec3 vW; varying vec3 vN; varying vec3 vV; varying vec3 vAx;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vT = clamp(position.z / len, 0.0, 1.0);
        vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); vAx = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0)); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform float time; uniform float k; varying float vT; varying vec3 vW; varying vec3 vN; varying vec3 vV; varying vec3 vAx;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        float fres = pow(abs(dot(normalize(vN), normalize(vV))), 1.4);
        float a = (1.0 - vT) * (1.0 - vT) * smoothstep(0.0, 0.06, vT) * fres * 0.3 * k;
        a *= 1.0 - 0.85 * smoothstep(0.55, 0.95, dot(normalize(vV), vAx));   // looking into the lamp: glare sprites take over
        float col = hash(floor(vW.xz * 9.0)); float streak = smoothstep(0.86, 1.0, col) * (0.5 + 0.5 * sin((vW.y + time * 13.0 * (0.6 + col)) * 2.6));
        a *= 1.0 + streak * 3.0;
        gl_FragColor = vec4(1.0, 0.95, 0.84, a);
      }`,
  });
}

// ---------------------------------------------------------------- tail-light trails (long-exposure streaks at speed)
const TRAIL_N = 34;
function makeTrails() {
  const n = TRAIL_N, g = new THREE.BufferGeometry();
  const pos = new Float32Array(2 * n * 2 * 3), alpha = new Float32Array(2 * n * 2), idx = [];
  for (let t = 0; t < 2; t++) for (let i = 0; i < n - 1; i++) { const a = (t * n + i) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage)); g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    uniforms: { color: { value: new THREE.Color(1.0, 0.06, 0.03) } },
    vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 color; varying float vA; void main(){ gl_FragColor = vec4(color * 2.4 * vA, vA); }',
  });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 11; mesh.visible = false;
  return { mesh, hist: [[], []], pool: [], pos, alpha };
}

// ---------------------------------------------------------------- body surfaces
const tent = (v, c, w) => Math.max(0, 1 - Math.abs(v - c) / w);
const FV_CREASE = [0.235, 0.765], TV_CREASE = [0.245, 0.755];
// split a surface along v at crease lines (hard edges): ranges = [[v0, v1, n], ...]
const creased = (kit, fn, us, ranges, mat, parent, o = {}) => { for (const [a, b, n] of ranges) kit.add(surface(fn, us, lin(a, b, n), o), mat, parent); };
const tankFn = (z, v, out) => {
  const t = (z + 0.26) / (0.80 + 0.26);
  const top = 1.265 + 0.165 * (1 - Math.pow(1 - smoothstep(0, 0.75, t), 2)) - 0.03 * smoothstep(0.85, 1, t);
  const bot = 1.0 + 0.04 * t;
  const hw = 0.16 + 0.12 * smoothstep(0.0, 0.5, t) - 0.07 * smoothstep(0.7, 1.0, t);
  const th = -Math.PI / 2 - v * Math.PI * 2;
  let [x, y] = se(th, 2.7); const hh = (top - bot) / 2, ty = (y + 1) / 2;
  x *= hw * (1 - 0.22 * ty * ty) * (1 + 0.06 * Math.exp(-Math.pow((ty - 0.45) / 0.12, 2)));
  return out.set(x, bot + hh + y * hh, z);
};
// fairing: hugs the tank at the back, rises to a cockpit hump under the screen, dives into a brow-overhung nose
const fairFn = (z, v, out) => {
  const t = (z - Z0) / (Z1 - Z0);
  const top = mix(1.445, 1.62, smoothstep(0, 0.34, t)) - 0.25 * Math.pow(smoothstep(0.36, 1.0, t), 1.2);
  const bot = 0.97 + 0.18 * smoothstep(0.05, 0.3, t) - 0.04 * smoothstep(0.5, 1.0, t);
  const hw = 0.47 - 0.26 * Math.pow(smoothstep(0.42, 1.0, t), 1.2);
  const taper = 0.36 * (1 - smoothstep(0.0, 0.42, t));
  const th = -Math.PI / 2 - v * Math.PI * 2;
  let [x, y] = se(th, mix(3.0, 2.5, t));
  const hh = (top - bot) / 2, ty = (y + 1) / 2;
  // sharp shoulder crease along each flank (the surface is split at FV_CREASE so the edge catches a crisp highlight)
  const k = 0.05 * smoothstep(0.06, 0.3, t) * (1 - smoothstep(0.82, 1.0, t));
  x *= hw * (1 - taper * ty) * (1 - 0.14 * ty * ty) * (1 + k * (tent(v, FV_CREASE[0], 0.09) + tent(v, FV_CREASE[1], 0.09)));
  return out.set(x, bot + hh + y * hh, z - 0.08 * (1 - ty) * smoothstep(0.55, 1.0, t));
};
const seatFn = (z, v, out) => {
  const t = (z + 1.0) / (1.0 - 0.27);    // 0 rear .. 1 front
  const hw = 0.25 - 0.08 * smoothstep(0.55, 1.0, t);
  const top = 1.205 - 0.035 * Math.exp(-Math.pow((t - 0.55) / 0.22, 2)) + 0.07 * (1 - smoothstep(0.0, 0.32, t)) + 0.02 * smoothstep(0.9, 1, t);
  const bot = 1.07;
  const th = -Math.PI / 2 - v * Math.PI * 2; let [x, y] = se(th, 3.2); const hh = (top - bot) / 2;
  x *= hw * (1 - 0.1 * ((y + 1) / 2));
  return out.set(x, bot + hh + y * hh, z);
};
const tailFn = (z, v, out) => {
  const t = (z - TZ0) / (TZ1 - TZ0);   // 0 tail end .. 1 front
  const top = 1.04 + 0.2 * smoothstep(0.0, 0.55, t) - 0.03 * smoothstep(0.85, 1.0, t);
  const bot = 0.86 + 0.1 * smoothstep(0.4, 1.0, t);
  const hw = 0.25 + 0.08 * Math.sin(Math.min(1, t * 1.3) * Math.PI * 0.5) - 0.02 * smoothstep(0.8, 1, t);
  const th = -Math.PI / 2 - v * Math.PI * 2; let [x, y] = se(th, 2.6); const hh = (top - bot) / 2;
  x *= hw * (1 - 0.15 * ((y + 1) / 2) ** 2) * (1 + 0.04 * smoothstep(0.05, 0.3, t) * (tent(v, TV_CREASE[0], 0.08) + tent(v, TV_CREASE[1], 0.08)));
  return out.set(x, bot + hh + y * hh, z - 0.05 * (1 - t) * (1 - (y + 1) / 2));
};
const wsFn = (u, v, out) => {   // wrap-around windscreen: u base -> top, v across
  const z = mix(1.06, 0.80, u) - 0.15 * v * v * (0.55 + 0.45 * u), y = mix(1.59, 1.93, Math.pow(u, 0.9)) - 0.09 * v * v, w = mix(0.4, 0.3, u);
  return out.set(v * w, y, z);
};
const line = (fn, u0, u1, v0, v1, n, r, mat, parent, kit) => { const pts = []; for (let i = 0; i <= n; i++) pts.push(fn(mix(u0, u1, i / n), mix(v0, v1, i / n), V3())); kit.add(pipe(pts, r, 6, n * 2), mat, parent); };

// ===========================================================================
// MODEL
// ===========================================================================
export function makeLawmasterModel(pal = {}) {
  const perp = pal.body !== undefined;
  const P = { body: pal.body ?? 0x0c0d11, accent: pal.accent ?? 0xd6a328, glow: pal.glow ?? 0x3ab8ff, seat: pal.seat ?? (perp ? 0x141216 : 0x3a1612), stripe: pal.stripe ?? (perp ? '#d81e2a' : undefined), perp };
  P.accentPaint = P.perp ? 0x1a1a1e : 0x6a0a0e;
  const mats = { ...staticMats(P), ...dynamicMats(P) };
  const kit = new Kit();

  // ---------------- hierarchy ----------------
  const g = new THREE.Group();
  const roll = new THREE.Group(); g.add(roll);
  const sprung = new THREE.Group(); sprung.position.copy(COM); roll.add(sprung);
  const inner = new THREE.Group(); inner.position.copy(COM).negate(); sprung.add(inner);
  const rake = new THREE.Group(); rake.position.copy(HEAD); rake.rotation.x = -RAKE; inner.add(rake);
  const front = new THREE.Group(); rake.add(front);
  const forkLow = new THREE.Group(); front.add(forkLow);
  const fw = new THREE.Group(); fw.position.set(0, -FORK_L, FORK_OFF); fw.rotation.x = RAKE; forkLow.add(fw);
  const frontSpin = new THREE.Group(); fw.add(frontSpin);
  const swing = new THREE.Group(); swing.position.copy(PIVOT); inner.add(swing);
  const rear = new THREE.Group(); rear.position.copy(AXLE_R).sub(PIVOT); swing.add(rear);
  const rearSpin = new THREE.Group(); rear.add(rearSpin);
  const springF = new THREE.Group(); front.add(springF);

  // ---------------- wheels ----------------
  buildWheel(kit, frontSpin, mats, RF, 0.40, [-0.13, 0.13]);
  buildWheel(kit, rearSpin, mats, RR, 0.47, [-0.14]);
  kit.add(xf(lathe([[0.0, 0.0], [0.1, 0.0], [0.13, 0.04], [0.11, 0.09], [0.05, 0.11], [0, 0.11]], 24, [1, 0]), 0.2, 0, 0, 0, 0, -Math.PI / 2), mats.brushed, rear);   // final drive (left)
  kit.add(xf(new THREE.CylinderGeometry(0.03, 0.03, 0.62, 10), 0, 0, 0, 0, 0, Math.PI / 2), mats.chrome, rear);

  // ---------------- fork (front-local: +Y up the steering axis, +Z ahead) ----------------
  const FX = 0.29;
  const yoke = (y, d) => { const o = []; for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; const [cx, cz] = se(a, 3.2); o.push([cx * (FX + 0.055), cz * 0.08 + 0.03]); } const s = slab(o, d, 0.008, 2); s.rotateX(-Math.PI / 2); s.translate(0, y, 0); return s; };
  kit.add(yoke(0.0, 0.05), mats.brushed, front); kit.add(yoke(-0.24, 0.06), mats.gun, front);
  for (const s of [-1, 1]) {
    kit.add(rod(V3(s * FX, 0.06, FORK_OFF), V3(s * FX, -0.80, FORK_OFF), 0.031, 16), mats.chrome, front);
    kit.add(xf(new THREE.CylinderGeometry(0.036, 0.036, 0.035, 16), s * FX, 0.075, FORK_OFF), mats.chrome, front);
    kit.add(rod(V3(s * FX, -0.56, FORK_OFF), V3(s * FX, -FORK_L + 0.02, FORK_OFF), 0.047, 16, 0.044), mats.gun, forkLow);
    kit.add(xf(new THREE.CylinderGeometry(0.052, 0.052, 0.03, 16), s * FX, -0.56, FORK_OFF), mats.gold, forkLow);
    kit.add(xf(rb(0.07, 0.12, 0.12, 0.025), s * FX, -FORK_L, FORK_OFF), mats.gun, forkLow);
    kit.add(xf(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 8), s * (FX + 0.03), -FORK_L, FORK_OFF, 0, 0, Math.PI / 2), mats.chrome, forkLow);
    kit.add(xf(coil(0.05, 0.0085, 1, 8, 4, 11), s * FX, 0, FORK_OFF), mats.gold, springF);       // exposed springs (scaled per frame)
    const lp = V3(s * 0.13, -FORK_L + 0.11, FORK_OFF - 0.19);                                    // gold 4-pot caliper behind each disc
    kit.add(xf(rb(0.075, 0.17, 0.075, 0.028), lp.x, lp.y, lp.z, RAKE, 0, 0), mats.gold, forkLow);
    kit.add(xf(rb1(0.03, 0.12, 0.05), lp.x + s * 0.04, lp.y, lp.z, RAKE, 0, 0), mats.gun, forkLow);
    kit.add(rod(V3(s * FX, -FORK_L + 0.17, FORK_OFF - 0.02), lp, 0.016, 6), mats.gun, forkLow);
  }
  kit.add(xf(new THREE.CylinderGeometry(0.022, 0.022, FX * 2 + 0.02, 10), 0, -FORK_L, FORK_OFF, 0, 0, Math.PI / 2), mats.chrome, forkLow);
  {   // front fender on the sliders, with the red / white chevron crown
    const fwid = 0.25;
    // x = -v so that (a up, v up) faces outward
    const fenFn = (a, v, out) => { const r = RF + 0.055 + 0.025 * (1 - v * v); const th = a - RAKE; return out.set(-v * fwid * (0.94 + 0.06 * Math.cos(a)), -FORK_L + Math.sin(th) * r, FORK_OFF + Math.cos(th) * r); };
    const A0 = 0.1, A1 = 2.55;
    kit.add(surface(fenFn, lin(A0, A1, 26), lin(-1, 1, 8)), mats.paint, forkLow);
    kit.add(surface(fenFn, lin(A0, A1, 26), lin(-1, 1, 8), { flip: true, offset: 0.006 }), mats.black, forkLow);
    kit.add(patch(fenFn, A0 + 0.08, A1 - 0.2, -0.62, 0.62, 24, 4, { offset: 0.004 }), mats.stripes, forkLow);
    for (const s of [-1, 1]) line(fenFn, A0, A1, s, s, 20, 0.008, mats.chrome, forkLow, kit);
  }

  // ---------------- handlebars, grips, controls, instrument pod (steering) ----------------
  const gripIn = [], gripOut = [];
  for (const s of [-1, 1]) {
    kit.add(rod(toFront(s * 0.09, 1.44, 0.81), toFront(s * 0.09, 1.565, 0.79), 0.022, 10), mats.chrome, front);    // riser
    const pts = [toFront(0, 1.565, 0.79), toFront(s * 0.1, 1.567, 0.785), toFront(s * 0.21, 1.6, 0.67), toFront(s * 0.33, 1.623, 0.44), toFront(s * 0.42, 1.62, 0.22), toFront(s * 0.45, 1.615, 0.17)];
    kit.add(pipe(pts, 0.019, 10, 32), mats.chrome, front);
    const gi = toFront(s * 0.45, 1.615, 0.17), go = toFront(s * 0.60, 1.605, 0.12);
    gripIn.push(gi); gripOut.push(go);
    kit.add(along(lathe([[0.022, 0], [0.028, 0.01], [0.031, 0.03], [0.029, 0.05], [0.032, 0.07], [0.029, 0.09], [0.032, 0.11], [0.03, 0.13], [0.026, 0.155]], 12, [1, 0]), gi, go.clone().sub(gi)), mats.rubber, front);
    kit.add(xf(new THREE.SphereGeometry(0.03, 10, 6), go.x + s * 0.01, go.y, go.z), mats.chrome, front);
    const sh = toFront(s * 0.43, 1.622, 0.19); kit.add(xf(rb1(0.06, 0.055, 0.07, 0.015), sh.x, sh.y, sh.z), mats.black, front);
    kit.add(rod(toFront(s * 0.42, 1.625, 0.22), toFront(s * 0.6, 1.60, 0.235), 0.007, 6), mats.chrome, front);
    const rv = toFront(s * 0.36, 1.66, 0.25); kit.add(xf(rb1(0.05, 0.03, 0.04), rv.x, rv.y, rv.z), mats.gun, front);
  }
  { const cl = toFront(0, 1.565, 0.79); kit.add(xf(rb1(0.22, 0.045, 0.07, 0.015), cl.x, cl.y, cl.z), mats.brushed, front); }
  {
    const pod = toFront(0, 1.635, 0.775);
    kit.add(xf(rb(0.22, 0.11, 0.07, 0.03), pod.x, pod.y, pod.z, -0.35, 0, 0), mats.black, front);
    const scr = new THREE.PlaneGeometry(0.18, 0.085); scr.rotateY(Math.PI); scr.rotateX(-0.35); scr.translate(pod.x, pod.y + 0.004, pod.z - 0.037);
    kit.add(scr, mats.dash, front);
  }

  // ---------------- frame ----------------
  for (const s of [-1, 1]) {
    kit.add(pipe([V3(s * 0.06, 1.33, 0.80), V3(s * 0.13, 1.0, 0.66), V3(s * 0.16, 0.5, 0.56), V3(s * 0.16, 0.25, 0.32), V3(s * 0.16, 0.22, -0.05), V3(s * 0.17, 0.34, -0.36), V3(s * 0.18, 0.62, -0.42), V3(s * 0.17, 1.0, -0.42)], 0.03, 7, 28), mats.satin, inner);
    kit.add(pipe([V3(s * 0.08, 1.04, -0.30), V3(s * 0.17, 1.06, -0.6), V3(s * 0.2, 1.08, -1.0), V3(s * 0.19, 1.02, -1.6), V3(s * 0.15, 0.98, -1.9)], 0.026, 6, 20), mats.satin, inner);
    kit.add(xf(rb1(0.03, 0.16, 0.14), s * 0.19, 0.6, -0.40), mats.gun, inner);
  }
  kit.add(pipe([V3(0, 1.36, 0.80), V3(0, 1.16, 0.55), V3(0, 1.05, 0.15), V3(0, 1.03, -0.3)], 0.038, 8, 16), mats.satin, inner);

  // ---------------- engine: boxer twin + fusion cell ----------------
  {
    const cc = rb(0.34, 0.36, 0.62, 0.08, 2); warp(cc, (v) => { v.x *= 1 - 0.18 * Math.max(0, -v.y / 0.18); });
    kit.add(xf(cc, 0, 0.47, 0.13), mats.gun, inner);
    kit.add(xf(rb(0.3, 0.3, 0.36, 0.07, 2), 0, 0.5, -0.24), mats.gun, inner);
    for (const s of [-1, 1]) {
      kit.add(xf(lathe([[0, 0.025], [0.1, 0.022], [0.13, 0.01], [0.135, 0]], 28, [0, 1]), s * 0.17, 0.48, 0.1, 0, 0, -s * Math.PI / 2), mats.chrome, inner);
      kit.add(xf(new THREE.TorusGeometry(0.135, 0.01, 6, 28), s * 0.172, 0.48, 0.1, 0, Math.PI / 2, 0), mats.gold, inner);
      kit.add(xf(lathe([[0, 0.02], [0.07, 0.016], [0.085, 0]], 20, [0, 1]), s * 0.155, 0.5, -0.25, 0, 0, -s * Math.PI / 2), mats.brushed, inner);
    }
    const finPro = []; const nf = 8;
    for (let i = 0; i <= nf; i++) { const y = i / nf * 0.22; finPro.push([0.1, y]); if (i < nf) { finPro.push([0.148, y + 0.005]); finPro.push([0.148, y + 0.015]); finPro.push([0.1, y + 0.02]); } }
    for (const s of [-1, 1]) {
      const fin = lathe(finPro, 20); fin.rotateZ(-s * Math.PI / 2); fin.translate(s * 0.17, 0.52, 0.31);
      kit.add(fin, mats.brushed, inner);
      kit.add(xf(rb(0.13, 0.22, 0.26, 0.05, 2), s * 0.455, 0.53, 0.31), mats.chrome, inner);
      for (let k = 0; k < 5; k++) kit.add(xf(rb1(0.008, 0.12, 0.01, 0.003), s * 0.521, 0.53, 0.21 + k * 0.05), mats.glow, inner);
      kit.add(xf(rb1(0.04, 0.24, 0.28, 0.012), s * 0.395, 0.53, 0.31), mats.black, inner);
      kit.add(xf(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 6), s * 0.46, 0.66, 0.36, 0.5, 0, 0), mats.black, inner);
    }
    const cz = 0.12, cy = 0.86, cl2 = 0.44;
    kit.add(xf(new THREE.CylinderGeometry(0.05, 0.05, cl2 - 0.04, 16), 0, cy, cz, Math.PI / 2, 0, 0), mats.glow, inner);
    kit.add(xf(new THREE.CylinderGeometry(0.085, 0.085, cl2 - 0.06, 20, 1, true), 0, cy, cz, Math.PI / 2, 0, 0), mats.glass, inner);
    for (const s of [-1, 1]) kit.add(xf(lathe([[0, 0.0], [0.095, 0.0], [0.1, 0.02], [0.08, 0.045], [0, 0.05]], 20, [1, 0]), 0, cy, cz + s * cl2 / 2, s * Math.PI / 2, 0, 0), mats.chrome, inner);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + 0.3; kit.add(rod(V3(Math.cos(a) * 0.092, cy + Math.sin(a) * 0.092, cz - cl2 / 2 + 0.02), V3(Math.cos(a) * 0.092, cy + Math.sin(a) * 0.092, cz + cl2 / 2 - 0.02), 0.006, 5), mats.chrome, inner); }
    kit.add(xf(rb(0.2, 0.08, 0.36, 0.03), 0, 0.73, cz), mats.gun, inner);
    for (const s of [-1, 1]) {   // heat-tinted headers -> megaphone mufflers with perforated shields and glowing tips
      kit.add(pipe([V3(s * 0.43, 0.41, 0.36), V3(s * 0.42, 0.28, 0.46), V3(s * 0.3, 0.17, 0.36), V3(s * 0.25, 0.15, 0.0), V3(s * 0.3, 0.24, -0.5), V3(s * 0.38, 0.38, -0.9)], 0.034, 8, 36), mats.heat, inner);
      const a0 = V3(s * 0.39, 0.40, -0.92), a1 = V3(s * 0.41, 0.53, -2.02), dir = a1.clone().sub(a0).normalize(), len = a1.distanceTo(a0);
      kit.add(along(lathe([[0.0, 0], [0.05, 0.0], [0.066, 0.06], [0.074, 0.3], [0.08, 0.8], [0.086, 1.06], [0.078, 1.1], [0.05, 1.1]], 24, [1, 0]), a0, dir, len / 1.1), mats.chrome, inner);
      kit.add(along(new THREE.CylinderGeometry(0.084, 0.084, 0.5, 16, 1, true, s > 0 ? -0.2 : Math.PI - 1.6, 1.8), a0.clone().lerp(a1, 0.45), dir), mats.perf, inner);
      const tipP = a1.clone().addScaledVector(dir, 0.012);
      kit.add(along(new THREE.TorusGeometry(0.062, 0.016, 6, 20).rotateX(Math.PI / 2), tipP, dir), mats.gun, inner);
      kit.add(along(new THREE.CircleGeometry(0.05, 16).rotateX(-Math.PI / 2), tipP.clone().addScaledVector(dir, -0.02), dir), mats.tip, inner);
    }
    for (const s of [-1, 1]) kit.add(pipe([V3(s * 0.12, 0.98, 0.66), V3(s * 0.4, 0.86, 0.58), V3(s * 0.6, 0.66, 0.46), V3(s * 0.62, 0.42, 0.42), V3(s * 0.48, 0.25, 0.46), V3(s * 0.17, 0.24, 0.5)], 0.024, 7, 30), mats.chrome, inner);
  }

  // ---------------- tank ----------------
  {
    const tankZ = cosSpace(-0.26, 0.80, 22), tankV = lin(0, 1, 32);
    kit.add(surface(tankFn, tankZ, tankV, { closed: true }), mats.paint, inner);
    kit.add(patch(tankFn, -0.2, 0.56, 0.465, 0.535, 18, 3, { offset: 0.003 }), mats.black, inner);
    for (const vv of [0.462, 0.538]) line(tankFn, -0.2, 0.56, vv, vv, 14, 0.005, mats.chrome, inner, kit);
    kit.add(xf(lathe([[0, 0.02], [0.05, 0.018], [0.06, 0.0]], 20, [0, 1]), 0, tankFn(0.3, 0.5, V3()).y, 0.3), mats.chrome, inner);
    for (const s of [-1, 1]) {
      const vc = s < 0 ? 0.25 : 0.75;
      kit.add(patch(tankFn, -0.18, 0.1, vc - 0.07, vc + 0.07, 8, 6, { offset: 0.004 }), mats.rubber, inner);   // knee pads
      line(tankFn, 0.12, 0.6, s < 0 ? 0.3 : 0.7, s < 0 ? 0.33 : 0.67, 12, 0.004, mats.gold, inner, kit);      // gold pinstripe
    }
  }

  // ---------------- fairing ----------------
  const fz = lin(Z0, Z1, 26, [Z1 - 0.02, Z1 - 0.06]), fv = lin(0.1, 0.9, 36);
  creased(kit, fairFn, fz, [[0.1, FV_CREASE[0], 8], [FV_CREASE[0], FV_CREASE[1], 22], [FV_CREASE[1], 0.9, 8]], mats.paint, inner);
  void fv;
  // panel seams: nose cone ring + flank seam under the crease, gill vents behind the nose
  kit.add(patch(fairFn, 1.296, 1.304, 0.1, 0.9, 1, 40, { offset: 0.0016 }), mats.black, inner);
  for (const s of [-1, 1]) {
    const c = s < 0 ? FV_CREASE[0] : FV_CREASE[1], d = s < 0 ? -1 : 1;
    kit.add(patch(fairFn, Z0 + 0.3, 1.296, c + d * 0.03, c + d * 0.036, 18, 1, { offset: 0.0016 }), mats.black, inner);
    for (let k = 0; k < 3; k++) {
      const z0 = 1.40 + k * 0.07;
      kit.add(patch(fairFn, z0, z0 + 0.13, (u) => c + d * (0.025 + (u - z0) * 0.32), (u) => c + d * (0.04 + (u - z0) * 0.32), 4, 1, { offset: 0.0018 }), mats.black, inner);
    }
  }
  kit.add(surface(fairFn, lin(Z0, Z1, 14), lin(0.1, 0.9, 18), { flip: true, offset: 0.014 }), mats.black, inner);
  for (const s of [-1, 1]) kit.add(patch(fairFn, Z0 + 0.25, Z1 - 0.02, s < 0 ? 0.1 : 0.84, s < 0 ? 0.16 : 0.9, 26, 2, { offset: 0.003 }), mats.accent, inner);   // red lower lip
  kit.add(pipe(ringAt(fairFn, Z1, lin(0.1, 0.9, 30)), 0.009, 6, 60), mats.chrome, inner);
  {   // recessed nose face
    const ring = ringAt(fairFn, Z1 - 0.004, lin(0.1, 0.9, 30)); const c = ring.reduce((a, p) => a.add(p), V3()).multiplyScalar(1 / ring.length);
    const inset = ring.map((p) => p.clone().lerp(c, 0.05).setZ(Math.min(p.z, Z1) - 0.05));
    kit.add(capRing(inset, V3(0, 0, 1)), mats.black, inner);
    kit.add(surface((a, b, out) => { const k = b * (ring.length - 1), i = Math.min(ring.length - 2, Math.floor(k)), f = k - i; return out.copy(ring[i]).lerp(ring[i + 1], f).lerp(V3().copy(inset[i]).lerp(inset[i + 1], f), a); }, [0, 1], lin(0, 1, ring.length - 1), { flip: true }), mats.black, inner);
  }
  {   // main headlamp: chrome bezel, faceted reflector, DRL halo, projector core, domed lens
    const { x, y, z } = LAMP, lr = 0.1;
    kit.add(xf(lathe([[lr * 1.02, 0], [lr * 0.95, -0.025], [lr * 0.55, -0.07], [0.0, -0.085]], 28, [0, 1]), x, y, z, Math.PI / 2, 0, 0), mats.reflector, inner);
    kit.add(xf(new THREE.TorusGeometry(lr * 1.06, 0.016, 8, 36), x, y, z + 0.008), mats.chrome, inner);
    kit.add(xf(new THREE.TorusGeometry(lr * 0.86, 0.008, 6, 36), x, y, z + 0.004), mats.drl, inner);
    kit.add(xf(new THREE.CircleGeometry(lr * 0.42, 20), x, y, z - 0.035), mats.lens, inner);
    kit.add(xf(lathe([[lr * 0.44, 0], [lr * 0.44, -0.04]], 20, [1, 0]), x, y, z - 0.035, Math.PI / 2, 0, 0), mats.chrome, inner);
    const dome = new THREE.SphereGeometry(lr * 1.03, 24, 6, 0, Math.PI * 2, 0, 0.55); dome.rotateX(Math.PI / 2); dome.scale(1, 1, 0.45); dome.translate(x, y, z - 0.004);
    kit.add(dome, mats.lensGlass, inner);
    if (!P.perp) for (const s of [-1, 1]) kit.add(xf(rb1(0.045, 0.065, 0.02, 0.008), s * 0.165, y, Z1 - 0.055), s < 0 ? mats.sirenL : mats.sirenR, inner);   // front strobes
  }
  for (const s of [-1, 1]) {   // auxiliary passing lamps under the nose
    const p = V3(s * 0.2, 1.08, 1.70);
    kit.add(xf(lathe([[0, -0.07], [0.04, -0.07], [0.052, -0.04], [0.054, 0]], 16, [1, 0]), p.x, p.y, p.z, Math.PI / 2, 0, 0), mats.chrome, inner);
    kit.add(xf(new THREE.CircleGeometry(0.04, 16), p.x, p.y, p.z + 0.002), mats.lens, inner);
    kit.add(rod(V3(p.x, p.y + 0.03, p.z - 0.04), V3(p.x, 1.16, p.z - 0.06), 0.012, 6), mats.gun, inner);
  }
  for (const s of [-1, 1]) {
    kit.add(patch(fairFn, Z1 - 0.34, Z1 - 0.14, s < 0 ? 0.325 : 0.65, s < 0 ? 0.35 : 0.675, 8, 1, { offset: 0.004 }), s > 0 ? mats.amberL : mats.amberR, inner);   // indicator strips
    if (s > 0) kit.add(patch(fairFn, Z0 + 0.98, Z0 + 0.36, 0.79, 0.67, 14, 4, { offset: 0.004, swapUV: true }), mats.badge, inner);      // LAWMASTER, reads front -> back
    else kit.add(patch(fairFn, Z0 + 0.36, Z0 + 0.98, 0.21, 0.33, 14, 4, { offset: 0.004, swapUV: true }), mats.badge, inner);
  }
  if (!P.perp) kit.add(eagleGeo(0.6, 0.11, 0.85), mats.eagle, inner, M4(0, fairFn(1.56, 0.5, V3()).y + 0.012, 1.56, -1.15, 0, 0));   // gold eagle lying on the nose
  for (const s of [-1, 1]) {   // twin cannons slung under the fairing flanks
    const x = s * 0.4, y = 1.06;
    kit.add(xf(lathe([[0, 0], [0.05, 0.0], [0.07, 0.06], [0.072, 0.62], [0.058, 0.7], [0.0, 0.72]], 20, [1, 0]), x, y, 0.98, Math.PI / 2, 0, 0), mats.gun, inner);
    kit.add(rod(V3(x, y, 1.66), V3(x, y, 2.0), 0.03, 12), mats.gun, inner);
    for (let k = 0; k < 4; k++) kit.add(xf(new THREE.CylinderGeometry(0.038, 0.038, 0.018, 12), x, y, 1.9 + k * 0.026, Math.PI / 2, 0, 0), mats.black, inner);
    kit.add(xf(new THREE.TorusGeometry(0.03, 0.007, 6, 14), x, y, 2.005), mats.chrome, inner);
    kit.add(xf(rb1(0.03, 0.06, 0.4), x, y + 0.08, 1.3), mats.gun, inner);
    kit.add(xf(new THREE.SphereGeometry(0.011, 8, 6), x + s * 0.06, y + 0.035, 1.55), mats.ready, inner);
    for (let k = 0; k < 5; k++) kit.add(xf(rb1(0.012, 0.03, 0.05, 0.004), x + s * 0.07, y, 1.08 + k * 0.08), mats.black, inner);
  }
  for (const s of [-1, 1]) {   // fairing mirrors
    kit.add(pipe([V3(s * 0.4, 1.47, 1.07), V3(s * 0.5, 1.53, 1.06), V3(s * 0.56, 1.56, 1.03)], 0.012, 6, 10), mats.chrome, inner);
    const mh = new THREE.SphereGeometry(0.08, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2); mh.rotateX(-Math.PI / 2); mh.scale(1.25, 0.72, 0.6);
    kit.add(xf(mh, s * 0.59, 1.57, 1.01), mats.paint, inner);
    const mg = new THREE.CircleGeometry(0.074, 18); mg.rotateY(Math.PI); mg.scale(1.25, 0.72, 1);
    kit.add(xf(mg, s * 0.59, 1.57, 1.009), mats.mirror, inner);
  }
  kit.add(surface(wsFn, lin(0, 1, 8), lin(-1, 1, 14)), mats.glass, inner);     // windscreen + chrome top trim
  line(wsFn, 1, 1, -1, 1, 14, 0.008, mats.chrome, inner, kit);
  {   // inner fairing panel facing the rider (the tank passes through it), speaker grilles
    kit.add(capRing(ringAt(fairFn, Z0 + 0.02, lin(0.1, 0.9, 30)), V3(0, 0, -1)), mats.black, inner);
    for (const s of [-1, 1]) {
      const sp = new THREE.CircleGeometry(0.055, 18); sp.rotateY(Math.PI); kit.add(xf(sp, s * 0.33, 1.13, Z0 + 0.017), mats.perf, inner);
      kit.add(xf(new THREE.TorusGeometry(0.057, 0.006, 6, 20), s * 0.33, 1.13, Z0 + 0.016), mats.chrome, inner);
    }
  }

  // ---------------- seat ----------------
  {
    const seatZ = cosSpace(-1.0, -0.27, 20), seatV = lin(0, 1, 28);
    kit.add(surface(seatFn, seatZ, seatV, { closed: true, map: (i, j, nu, nv) => [j / (nv - 1) * 2.0, i / (nu - 1) * 1.0] }), mats.leather, inner);
    kit.add(capRing(ringAt(seatFn, -1.0, seatV), V3(0, 0, -1)), mats.leather, inner);
    kit.add(capRing(ringAt(seatFn, -0.27, seatV), V3(0, 0, 1)), mats.leather, inner);
    for (const vv of [0.3, 0.7]) line(seatFn, -0.98, -0.29, vv, vv, 16, 0.007, mats.black, inner, kit);
    const br = rb(0.36, 0.24, 0.08, 0.035, 2); warp(br, (v) => { v.z += 0.04 * (1 - (v.x / 0.18) ** 2); });
    kit.add(xf(br, 0, 1.40, -1.08, -0.18, 0, 0), mats.leather, inner);
    kit.add(pipe([V3(0.16, 1.1, -1.02), V3(0.18, 1.36, -1.13), V3(0.15, 1.53, -1.16), V3(0, 1.56, -1.17), V3(-0.15, 1.53, -1.16), V3(-0.18, 1.36, -1.13), V3(-0.16, 1.1, -1.02)], 0.016, 8, 32), mats.chrome, inner);
  }

  // ---------------- tail cowl over the rear wheel ----------------
  {
    const tz = cosSpace(TZ0, TZ1, 20), tv = lin(0.12, 0.88, 30);
    creased(kit, tailFn, tz, [[0.12, TV_CREASE[0], 7], [TV_CREASE[0], TV_CREASE[1], 18], [TV_CREASE[1], 0.88, 7]], mats.paint, inner);
    kit.add(surface(tailFn, cosSpace(TZ0, TZ1, 10), lin(0.12, 0.88, 14), { flip: true, offset: 0.012 }), mats.black, inner);
    kit.add(capRing(ringAt(tailFn, TZ0 + 0.001, tv), V3(0, 0, -1)), mats.paint, inner);
    kit.add(patch(tailFn, TZ0 + 0.03, TZ0 + 0.075, 0.2, 0.8, 3, 26, { offset: 0.004 }), mats.tail, inner);
    for (const s of [-1, 1]) {
      kit.add(patch(tailFn, TZ0 + 0.09, TZ0 + 0.17, s < 0 ? 0.2 : 0.74, s < 0 ? 0.26 : 0.8, 2, 2, { offset: 0.004 }), s > 0 ? mats.amberL : mats.amberR, inner);
      if (s > 0) kit.add(patch(tailFn, TZ0 + 0.75, TZ0 + 0.3, 0.75, 0.68, 8, 2, { offset: 0.004, swapUV: true }), mats.number, inner);
      else kit.add(patch(tailFn, TZ0 + 0.3, TZ0 + 0.75, 0.25, 0.32, 8, 2, { offset: 0.004, swapUV: true }), mats.number, inner);
    }
  }
  const tailY = tailFn(TZ0, 0.5, V3()).y;
  kit.add(xf(rb1(0.3, 0.05, 0.02), 0, tailY - 0.065, TZ0 - 0.012), mats.brake, inner);
  kit.add(xf(rb1(0.36, 0.17, 0.03), 0, 0.80, TZ0 - 0.02, 0.15, 0, 0), mats.black, inner);      // plate bracket
  { const pl = new THREE.PlaneGeometry(0.32, 0.14); pl.rotateY(Math.PI); kit.add(xf(pl, 0, 0.80, TZ0 - 0.037, -0.15, 0, 0), mats.plate, inner); }
  kit.add(xf(rb1(0.1, 0.03, 0.04), 0, 0.9, TZ0 - 0.03), mats.chrome, inner);
  if (!P.perp) {   // rear strobe bar
    kit.add(xf(rb(0.5, 0.06, 0.07, 0.02), 0, 1.30, -1.62), mats.black, inner);
    for (const s of [-1, 1]) kit.add(xf(rb1(0.2, 0.045, 0.02), s * 0.12, 1.30, -1.66), s < 0 ? mats.sirenL : mats.sirenR, inner);
    for (const s of [-1, 1]) kit.add(rod(V3(s * 0.18, 1.12, -1.5), V3(s * 0.2, 1.29, -1.6), 0.012, 6), mats.chrome, inner);
  }

  // ---------------- panniers (hard cases) ----------------
  for (const s of [-1, 1]) {
    const pb = rb(0.26, 0.46, 0.94, 0.07, 2);
    warp(pb, (v) => { const zt = (v.z + 0.47) / 0.94; v.x += s * 0.03 * (1 - (v.y / 0.23) ** 2) * (v.x * s > 0 ? 1 : 0); v.y *= 1 - 0.1 * (1 - zt); if (zt < 0.25) v.x -= s * 0.04 * (1 - zt / 0.25) * (v.x * s > 0 ? 1 : 0); });
    kit.add(xf(pb, s * 0.50, 0.83, -1.45), mats.paint, inner);
    kit.add(xf(rb1(0.275, 0.025, 0.95), s * 0.50, 0.95, -1.45), mats.black, inner);
    kit.add(xf(rb(0.27, 0.05, 0.9, 0.02), s * 0.50, 1.075, -1.45), mats.accent, inner);
    kit.add(xf(rb1(0.03, 0.06, 0.08), s * 0.645, 0.95, -1.2), mats.chrome, inner);
    kit.add(xf(rb1(0.03, 0.06, 0.08), s * 0.645, 0.95, -1.72), mats.chrome, inner);
    const ov = new THREE.CircleGeometry(0.12, 28); ov.scale(1.6, 0.9, 1); ov.rotateY(s * Math.PI / 2);
    kit.add(xf(ov, s * 0.663, 0.80, -1.45), mats.black, inner);
    kit.add(xf(new THREE.TorusGeometry(0.12, 0.008, 6, 28).scale(1.6, 0.9, 1), s * 0.664, 0.80, -1.45, 0, s * Math.PI / 2, 0), mats.gold, inner);
    if (!P.perp) kit.add(eagleGeo(0.3, 0.07, 0, false), mats.eagle, inner, M4(s * 0.668, 0.77, -1.45, 0, s * Math.PI / 2, 0));
    const jd = new THREE.PlaneGeometry(0.62, 0.09); jd.rotateY(s * Math.PI / 2); kit.add(xf(jd, s * 0.665, 0.65, -1.45), mats.justice, inner);
    kit.add(xf(rb1(0.12, 0.035, 0.02), s * 0.47, 0.70, -1.928), mats.tail, inner);
    kit.add(xf(rb1(0.025, 0.3, 0.02), s * 0.6, 0.84, -1.915), mats.tail, inner);
    kit.add(rod(V3(s * 0.2, 1.0, -1.1), V3(s * 0.37, 0.95, -1.1), 0.012, 6), mats.chrome, inner);
    kit.add(rod(V3(s * 0.2, 0.98, -1.7), V3(s * 0.37, 0.95, -1.7), 0.012, 6), mats.chrome, inner);
  }

  // ---------------- swingarm ----------------
  {
    const L = AXLE_R.clone().sub(PIVOT);
    for (const s of [-1, 1]) {
      const a = V3(s * 0.25, 0, -0.02), b = V3(s * 0.25, L.y, L.z + 0.02);
      if (s > 0) kit.add(rod(a, b, 0.05, 14, 0.042), mats.brushed, swing);
      else { const arm = rb(0.05, 0.92, 0.1, 0.02); warp(arm, (v) => { v.z *= 1 - 0.35 * ((0.46 - v.y) / 0.92); }); kit.add(along(arm, a.clone().lerp(b, 0.5), a.clone().sub(b)), mats.gun, swing); }
    }
    kit.add(xf(new THREE.CylinderGeometry(0.035, 0.035, 0.56, 10), 0, 0, 0, 0, 0, Math.PI / 2), mats.chrome, swing);
    kit.add(xf(rb(0.5, 0.06, 0.12, 0.02), 0, -0.01, -0.12), mats.gun, swing);
    kit.add(xf(rb(0.06, 0.14, 0.07, 0.022), -0.14, L.y + 0.2, L.z + 0.1, 0.4, 0, 0), mats.gold, swing);
  }
  const shocks = [];   // twin rear shocks: group at the (moving) swingarm mount, +Y toward the frame mount
  for (const s of [1, -1]) {
    const grp = new THREE.Group(); inner.add(grp);
    const top = new THREE.Group(); grp.add(top);
    kit.add(rod(V3(0, -0.17, 0), V3(0, 0, 0), 0.03, 12), mats.chrome, top);
    kit.add(xf(new THREE.CylinderGeometry(0.044, 0.044, 0.028, 14), 0, -0.165, 0), mats.gold, top);
    kit.add(xf(new THREE.TorusGeometry(0.028, 0.011, 6, 12), 0, 0, 0, 0, Math.PI / 2, 0), mats.chrome, top);
    const low = new THREE.Group(); grp.add(low);
    kit.add(rod(V3(0, 0, 0), V3(0, 0.3, 0), 0.012, 8), mats.chrome, low);
    kit.add(xf(new THREE.TorusGeometry(0.028, 0.011, 6, 12), 0, 0, 0, 0, Math.PI / 2, 0), mats.chrome, low);
    kit.add(xf(new THREE.CylinderGeometry(0.042, 0.042, 0.02, 14), 0, 0.045, 0), mats.gold, low);
    const spr = new THREE.Group(); grp.add(spr);
    kit.add(coil(0.042, 0.009, 1, 7, 4, 11), mats.gold, spr);
    shocks.push({ grp, top, spr, a: V3(s * 0.25, 0.64, -0.96), b: V3(s * 0.22, 1.10, -0.80) });
  }

  // ---------------- side stand (swings down when parked) ----------------
  const stand = new THREE.Group(); stand.position.copy(STAND_PIVOT); inner.add(stand);
  {
    // forged leg tapering to the foot; the foot pad is built flat to the road in the deployed pose
    const toLocal = new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), PARK_ROLL).multiply(Q_STAND_DOWN).invert();
    const up = V3(0, 1, 0).applyQuaternion(toLocal), out = V3(1, 0, 0).applyQuaternion(Q_STAND_DOWN.clone().invert());
    const foot = V3(0, -STAND_LEN, 0);
    kit.add(rod(V3(0, 0, 0), V3(0, -STAND_LEN + 0.02, 0), 0.026, 10, 0.017), mats.chrome, stand);
    const pad = new THREE.CylinderGeometry(0.044, 0.05, 0.018, 14);
    pad.applyMatrix4(new THREE.Matrix4().compose(foot.clone().addScaledVector(up, 0.009), new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), up), V3(1, 1, 1)));
    kit.add(pad, mats.gun, stand);
    kit.add(rod(V3(0, -0.07, 0), V3(0, -0.06, 0).addScaledVector(out, 0.075), 0.011, 6, 0.008), mats.chrome, stand);   // kick tab
    kit.add(xf(new THREE.CylinderGeometry(0.03, 0.03, 0.055, 12), 0, 0, 0, 0, 0, Math.PI / 2), mats.gun, stand);         // pivot boss
  }

  // ---------------- pegs + foot controls ----------------
  const pegs = [V3(0.50, 0.66, -0.12), V3(-0.50, 0.66, -0.12)];
  for (const p of pegs) {
    const s = Math.sign(p.x);
    kit.add(rod(V3(s * 0.17, 0.5, -0.2), V3(s * 0.4, 0.64, -0.13), 0.02, 6), mats.gun, inner);
    kit.add(xf(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 10), p.x, p.y, p.z, 0, 0, Math.PI / 2), mats.chrome, inner);
    for (let k = 0; k < 4; k++) kit.add(xf(new THREE.CylinderGeometry(0.033, 0.033, 0.018, 10), p.x - s * 0.06 + s * k * 0.04, p.y, p.z, 0, 0, Math.PI / 2), mats.rubber, inner);
  }
  kit.add(rod(V3(-0.45, 0.6, -0.1), V3(-0.47, 0.58, 0.12), 0.01, 6), mats.chrome, inner);
  kit.add(rod(V3(0.45, 0.6, -0.1), V3(0.47, 0.6, 0.12), 0.01, 6), mats.chrome, inner);

  kit.build();

  // ---------------- dynamic extras ----------------
  // the player's bike carries a real headlight; perp bikes use emissive + a fake road pool so spawning one never changes the scene's light count (that would recompile every lit shader)
  let spot, siren, roadPool = null;
  if (!P.perp) {
    spot = new THREE.SpotLight(0xfff0d8, 0, 90, 0.5, 0.7, 1.2); spot.position.set(LAMP.x, LAMP.y, LAMP.z + 0.1); spot.target.position.set(0, 0.2, Z1 + 16); inner.add(spot); inner.add(spot.target);
    siren = new THREE.PointLight(0xff2020, 0, 22, 2); siren.position.set(0, 1.6, -1.2); inner.add(siren);
  } else {
    spot = { intensity: 0, isFake: true }; siren = { intensity: 0, color: new THREE.Color(), isFake: true };
    roadPool = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 11).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: TX.glowTex(), color: new THREE.Color(0xfff0d8).multiplyScalar(0.32), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    roadPool.position.set(0, 0.035, Z1 + 6.5); roadPool.renderOrder = 4; g.add(roadPool);
  }
  const beamGeo = new THREE.ConeGeometry(2.2, 14, 16, 1, true); beamGeo.translate(0, -7, 0); beamGeo.rotateX(-Math.PI / 2);
  const beam = new THREE.Mesh(beamGeo, beamMaterial()); beam.position.set(LAMP.x, LAMP.y, LAMP.z + 0.03); beam.rotation.x = 0.07; beam.renderOrder = 5; beam.frustumCulled = false; inner.add(beam);
  const spr = (tex, col, sx, sy) => { const m = new THREE.SpriteMaterial({ map: tex, color: col, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }); const s = new THREE.Sprite(m); s.scale.set(sx, sy, 1); s.renderOrder = 12; return s; };
  const gT = TX.glowTex(), sT = TX.streakTex();
  const flares = {
    sirL: [spr(gT, 0xff2a20, 0.9, 0.9), spr(gT, 0xff2a20, 0.9, 0.9)], sirR: [spr(gT, 0x2a6aff, 0.9, 0.9), spr(gT, 0x2a6aff, 0.9, 0.9)],
    head: [spr(gT, 0xfff4e0, 1.1, 1.1), spr(gT, 0xfff4e0, 0.5, 0.5), spr(sT, 0xcfe4ff, 2.8, 0.2)],
    tail: spr(gT, 0xff2010, 0.7, 0.45), brake: spr(sT, 0xff3020, 1.4, 0.12),
  };
  flares.sirL[0].position.set(-0.165, LAMP.y, Z1 + 0.0); flares.sirR[0].position.set(0.165, LAMP.y, Z1 + 0.0);
  flares.sirL[1].position.set(-0.12, 1.30, -1.7); flares.sirR[1].position.set(0.12, 1.30, -1.7);
  flares.head[0].position.set(LAMP.x, LAMP.y, LAMP.z + 0.04); flares.head[1].position.set(0, 1.08, 1.73); flares.head[2].position.set(LAMP.x, LAMP.y, LAMP.z + 0.06);
  flares.tail.position.set(0, tailY, TZ0 - 0.05); flares.brake.position.set(0, tailY - 0.065, TZ0 - 0.04);
  for (const s of [...flares.sirL, ...flares.sirR, ...flares.head, flares.tail, flares.brake]) inner.add(s);
  const flames = [], flameMat = flameMaterial().clone();
  for (const s of [-1, 1]) {
    const a0 = V3(s * 0.39, 0.40, -0.92), a1 = V3(s * 0.41, 0.53, -2.02), dir = a1.clone().sub(a0).normalize();
    const fg = new THREE.ConeGeometry(0.075, 1.0, 14, 5, true); fg.translate(0, 0.5, 0);   // wide base (uv.y = 0) at the nozzle, apex (uv.y = 1) 1 m back
    const f = new THREE.Mesh(fg, flameMat); f.position.copy(a1).addScaledVector(dir, 0.02); f.quaternion.setFromUnitVectors(V3(0, 1, 0), dir); f.visible = false; f.renderOrder = 11; f.frustumCulled = false;
    f.userData.seed = s * 13.7; inner.add(f); flames.push(f);
  }
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 4.4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: TX.glowTex(), color: new THREE.Color(P.glow).multiplyScalar(0.5), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  pool.position.set(0, 0.03, -0.05); pool.renderOrder = 4; g.add(pool);
  const trails = makeTrails(); g.add(trails.mesh);
  const streaks = new WetStreaks(g, 3);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 4.3).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: TX.shadowTex(), color: 0x000000, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
  shadow.position.set(0, 0.02, -0.05); shadow.renderOrder = 3; g.add(shadow);

  // ---------------- handles ----------------
  g.userData = {
    rear, front, rearSpin, frontSpin, wr: rearSpin, wf: frontSpin, spot, siren,
    sirenL: new THREE.Mesh(new THREE.BufferGeometry(), mats.sirenL), sirenR: new THREE.Mesh(new THREE.BufferGeometry(), mats.sirenR),   // bike.js flashes .material.color
    exhaust: [V3(-0.41, 0.53, -2.1), V3(0.41, 0.53, -2.1)],
    mats, roll, sprung, inner, rake, forkLow, fw, swing, springF, shocks, flares, flames, flameMat, beam, pool, shadow, trails, tailY, roadPool, streaks, stand,
    anchors: {
      seat: V3(0, 1.19, -0.58),
      pegL: pegs[0].clone(), pegR: pegs[1].clone(),
      gripL: gripIn[1].clone().lerp(gripOut[1], 0.5), gripR: gripIn[0].clone().lerp(gripOut[0], 0.5),   // in `front` space
      gripAxisL: gripOut[1].clone().sub(gripIn[1]).normalize(), gripAxisR: gripOut[0].clone().sub(gripIn[0]).normalize(),
    },
    vis: { park: 0, cf: 0, cr: 0, vf: 0, vr: 0, prevSpeed: 0, acc: 0, spinF: 0, spinR: 0, brakeK: 0, boostK: 0, surge: 0, vsurge: 0, t: Math.random() * 10, dist: 0, heat: 0, glowBase: new THREE.Color(P.glow) },
  };
  updateLawmasterVisuals({ model: g, speed: 0, steer: 0, ctrl: { throttle: 0, brake: 0, hold: true }, lean: 0 }, 0);
  // despawned perp bikes are simply removed from the scene: free this instance's GPU buffers then
  // (static materials and canvas textures are shared/cached and stay alive)
  const shared = new Set(Object.values(staticMats(P)));
  g.addEventListener('removed', () => {
    g.traverse((o) => { if (o.isMesh || o.isInstancedMesh) { o.geometry.dispose(); for (const m of [].concat(o.material)) if (!shared.has(m)) m.dispose(); } });
    for (const s of [...flares.sirL, ...flares.sirR, ...flares.head, flares.tail, flares.brake]) s.material.dispose();
  });
  return g;
}


// ===========================================================================
// Per-frame visual animation: suspension (fork dive / rear squat / bumps / idle shake), steering
// geometry, wheel spin + blur, brake / tail / indicators, engine pulse, exhaust heat + boost flames,
// strobe flares, headlight beam.  Called from Lawmaster.sync(); never touches the physics state.
// ===========================================================================
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m4 = new THREE.Matrix4(), _r4 = new THREE.Matrix4();
const AXIS_IN = V3(0, Math.cos(RAKE), -Math.sin(RAKE));   // fork axis (up) in bike space
const FAXLE_IN = V3(0, HEAD.y - FORK_L * Math.cos(RAKE) + FORK_OFF * Math.sin(RAKE), HEAD.z + FORK_L * Math.sin(RAKE) + FORK_OFF * Math.cos(RAKE));
const SA = AXLE_R.clone().sub(PIVOT), SA_ANG = Math.atan2(SA.y, -SA.z);
const UPV = V3(0, 1, 0);
function noise1(x) { const i = Math.floor(x), f = x - i, h = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }; const u = f * f * (3 - 2 * f); return h(i) * (1 - u) + h(i + 1) * u; }

export function updateLawmasterVisuals(bike, dt) {
  const u = bike.model.userData, V = u.vis, M = u.mats; if (!V) return;
  const c = bike.ctrl || {}, sp = bike.speed || 0, asp = Math.abs(sp), live = !bike.crashed;
  V.t += dt;
  // ---- longitudinal acceleration (smoothed) ----
  if (dt > 0) { const a = (sp - V.prevSpeed) / dt; V.acc = damp(V.acc, clamp(a, -60, 60), 10, dt); }
  V.prevSpeed = sp;
  // ---- suspension targets: load transfer, boost squat, cornering load, road texture, idle shake ----
  const brk = c.brake > 0 && sp > 0.5 ? c.brake : 0;
  const decel = Math.max(0, -V.acc), accel = Math.max(0, V.acc);
  V.dist += asp * dt;
  const road = smoothstep(2, 30, asp);
  const bumpF = (noise1(V.dist * 1.7) - 0.5) * 0.018 * road, bumpR = (noise1((V.dist - WB) * 1.7) - 0.5) * 0.02 * road;
  const corner = Math.abs(bike.lean || 0) * 0.03;
  const engineOn = live && (bike.mounted || bike.perp || bike.called);
  const idle = engineOn && asp < 1 ? Math.sin(V.t * 52) * 0.0012 + Math.sin(V.t * 23.7) * 0.0008 : 0;
  const tf = clamp(decel * 0.0032 + brk * 0.02 - accel * 0.0009 + corner + bumpF + idle, -0.04, 0.085);
  const tr = clamp(accel * 0.0016 + (bike.boosting ? 0.03 : 0) - decel * 0.0011 + corner + bumpR + idle, -0.035, 0.07);
  if (dt > 0) {
    const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    for (let i = 0; i < n; i++) {
      V.vf += (260 * (tf - V.cf) - 20 * V.vf) * h; V.cf += V.vf * h;
      V.vr += (220 * (tr - V.cr) - 18 * V.vr) * h; V.cr += V.vr * h;
      V.vsurge += (90 * (clamp(-V.acc * 0.006, -0.12, 0.16) - V.surge) - 11 * V.vsurge) * h; V.surge += V.vsurge * h;   // rider inertia
    }
  } else { V.cf = tf; V.cr = tr; }
  V.cf = clamp(V.cf, -0.05, 0.1); V.cr = clamp(V.cr, -0.05, 0.08);
  const pitch = (V.cf - V.cr) / WB, heave = -(V.cf * 0.55 + V.cr * 0.45);
  u.sprung.rotation.x = pitch; u.sprung.position.y = COM.y + heave;
  // wheels stay on the ground: solve the fork slide and the swingarm angle in chassis space
  u.sprung.updateMatrix(); u.inner.updateMatrix();
  _m4.multiplyMatrices(u.sprung.matrix, u.inner.matrix).invert();
  _v.copy(AXLE_F).applyMatrix4(_m4);
  const slide = clamp(_w.copy(_v).sub(FAXLE_IN).dot(AXIS_IN), -0.06, 0.12);
  u.forkLow.position.y = slide;
  u.springF.position.y = -0.56 + slide; u.springF.scale.y = -0.265 - u.springF.position.y;      // slider top -> lower yoke
  _v.copy(AXLE_R).applyMatrix4(_m4).sub(PIVOT);
  u.swing.rotation.x = Math.atan2(_v.y, -_v.z) - SA_ANG;
  _r4.makeRotationX(u.swing.rotation.x);
  for (const s of u.shocks) {
    _w.copy(s.a).sub(PIVOT).applyMatrix4(_r4).add(PIVOT);
    const d = _v.copy(s.b).sub(_w), len = d.length(); d.multiplyScalar(1 / len);
    s.grp.position.copy(_w); s.grp.quaternion.setFromUnitVectors(UPV, d);
    s.top.position.y = len; s.spr.position.y = 0.055; s.spr.scale.y = Math.max(0.05, len - 0.165 - 0.055);
  }
  // ---- parked on the side stand: stand swings down, bike settles onto it (visual roll about the ground line) ----
  const parked = live && !bike.perp && !bike.mounted && !bike.called && asp < 0.6 && G.mounted !== bike;
  V.park = dt > 0 ? damp(V.park, parked ? 1 : 0, parked ? 3.2 : 9, dt) : (parked ? 1 : 0);
  const kp = smoothstep(0, 1, V.park);
  if (u.stand) u.stand.quaternion.slerpQuaternions(Q_STAND_UP, Q_STAND_DOWN, smoothstep(0, 0.6, V.park));
  u.roll.rotation.z = PARK_ROLL * smoothstep(0.35, 1, kp);
  // ---- steering geometry: full lock at walking pace, a few degrees at speed ----
  u.front.rotation.y = -(bike.steer || 0) * mix(0.42, 0.07, smoothstep(4, 45, asp));
  // ---- wheels: spin + blur ----
  V.spinF += sp * dt / RF; V.spinR += sp * dt / RR;
  u.frontSpin.rotation.x = V.spinF; u.rearSpin.rotation.x = V.spinR;
  M.blur.opacity = 0.92 * smoothstep(9, 34, asp / RR);
  // ---- lights ----
  const on = engineOn || G.mounted === bike;
  V.brakeK = damp(V.brakeK, (brk > 0 || c.hold) && live ? 1 : 0, 18, dt || 1);
  M.tail.color.setRGB(1.0, 0.07, 0.04).multiplyScalar(live ? (on ? 1.8 : 1.0) : 0.05);
  M.brake.color.setRGB(1.0, 0.08, 0.05).multiplyScalar(live ? 0.9 + V.brakeK * (c.hold && !brk ? 1.6 : 4.2) : 0.04);
  M.lens.color.setRGB(1.0, 0.95, 0.86).multiplyScalar(live ? (on ? 3.2 : 1.3) : 0.05);
  M.drl.color.setRGB(0.75, 0.9, 1.0).multiplyScalar(live ? 2.6 : 0.05);
  const blink = Math.floor(V.t * 3.2) % 2 === 0, st = bike.steer || 0, turning = asp < 22 && Math.abs(st) > 0.45;
  M.amberL.color.setRGB(1, 0.5, 0.06).multiplyScalar(((turning && st < 0) || bike.crashed) && blink ? 3.2 : 0.09 * (live ? 1 : 0.3));
  M.amberR.color.setRGB(1, 0.5, 0.06).multiplyScalar(((turning && st > 0) || bike.crashed) && blink ? 3.2 : 0.09 * (live ? 1 : 0.3));
  const rpm = 4 + asp * 0.35 + (c.throttle || 0) * 6;
  V.boostK = damp(V.boostK, bike.boosting ? 1 : 0, bike.boosting ? 10 : 3, dt || 1);
  const pulse = 0.5 + 0.5 * Math.sin(V.t * rpm);
  M.glow.color.copy(V.glowBase).multiplyScalar(live ? 1.3 + 0.7 * pulse + (c.throttle || 0) * 1.2 + V.boostK * 3.0 : 0.05);
  V.heat = damp(V.heat, live ? 0.25 + (c.throttle || 0) * 0.7 + V.boostK * 2.0 : 0, 2.5, dt || 1);
  M.tip.color.setRGB(1.0 * V.heat + 0.6 * V.boostK, 0.32 * V.heat + 0.8 * V.boostK, 0.1 * V.heat + 1.6 * V.boostK);
  for (const f of u.flames) {
    f.visible = live && V.boostK > 0.04;
    const L = (0.7 + 0.55 * V.boostK) * (0.85 + 0.3 * noise1(V.t * 30 + f.userData.seed)), w = 1 + 0.15 * Math.sin(V.t * 47 + f.userData.seed);
    f.scale.set(w, L, w);
  }
  u.flameMat.uniforms.time.value = V.t; u.flameMat.uniforms.power.value = V.boostK;
  // strobe flares follow the siren colours bike.js writes
  const Lr = M.sirenL.color.r, Rb = M.sirenR.color.b;
  for (const s of u.flares.sirL) s.material.opacity = live ? clamp((Lr - 0.5) / 2.5, 0, 1) : 0;
  for (const s of u.flares.sirR) s.material.opacity = live ? clamp((Rb - 0.5) / 2.5, 0, 1) : 0;
  const hk = live ? (on ? 0.85 : 0.3) : 0;
  u.flares.head[0].material.opacity = hk; u.flares.head[1].material.opacity = hk * 0.9; u.flares.head[2].material.opacity = hk * 0.6;
  u.flares.tail.material.opacity = live ? (on ? 0.55 : 0.35) : 0;
  u.flares.brake.material.opacity = live ? V.brakeK * 0.9 : 0;
  u.beam.material.uniforms.time.value = V.t; u.beam.material.uniforms.k.value = on ? 1 : 0; u.beam.visible = on;
  if (u.roadPool) { u.roadPool.visible = on; u.roadPool.rotation.z = -(bike.model.rotation.z || 0); }
  u.pool.rotation.z = -(bike.model.rotation.z || 0); u.shadow.rotation.z = u.pool.rotation.z; u.shadow.visible = !bike.crashed; u.pool.material.opacity = live ? 0.55 + 0.25 * pulse * (on ? 1 : 0.3) : 0;
  u.exhaust[0].set(-0.41, 0.53 - V.cr * 0.6, -2.1); u.exhaust[1].set(0.41, 0.53 - V.cr * 0.6, -2.1);
  updateTrails(bike, u, dt, live ? smoothstep(22, 45, asp) * (0.55 + 0.45 * V.brakeK) : 0);
  // wet-road reflections of the tail light (seen from the chase camera) and the headlamp (seen from ahead)
  const W = u.streaks;
  if (W && G.camera) {
    W.begin();
    if (live) {
      const cam = G.camera.position;   // _tm / _ti were refreshed by updateTrails for this frame
      _sp.set(0, u.tailY - 0.05, TZ0 - 0.05).applyMatrix4(_tm); W.add(_sp, cam, 1.7, 0.09, 0.05, 0.42 + 0.5 * V.brakeK, 0.38, 3.0, _ti);
      if (on) { _sp.set(0, LAMP.y, Z1 + 0.05).applyMatrix4(_tm); W.add(_sp, cam, 1.5, 1.42, 1.25, 0.55, 1.0, 4.0, _ti); }
    }
    W.end();
  }
}
const _sp = new THREE.Vector3();

// tail-light streaks: world-space history of the two tail-bar ends, written camera-facing in model space
const _tq = new THREE.Quaternion(), _te = new THREE.Euler(), _tm = new THREE.Matrix4(), _ti = new THREE.Matrix4(), _tp = new THREE.Vector3(), _ts = new THREE.Vector3(1, 1, 1);
const _ta = new THREE.Vector3(), _tb = new THREE.Vector3(), _tc = new THREE.Vector3(), _td = new THREE.Vector3(), _cam = new THREE.Vector3();
function updateTrails(bike, u, dt, k) {
  const T = u.trails; if (!T) return;
  const m = bike.model;
  _tq.setFromEuler(_te.set(0, m.rotation.y, m.rotation.z, 'YXZ')); _tm.compose(_tp.copy(m.position), _tq, _ts); _ti.copy(_tm).invert();
  if (k <= 0.001 || !dt) { if (T.hist[0].length) { for (const h of T.hist) { T.pool.push(...h); h.length = 0; } } T.mesh.visible = false; return; }
  const maxLen = 11, w = 0.042;
  for (let t = 0; t < 2; t++) {
    const h = T.hist[t];
    const p = T.pool.pop() || new THREE.Vector3();
    p.set(t ? 0.17 : -0.17, u.tailY - 0.03, TZ0 - 0.03).applyMatrix4(_tm);
    h.unshift(p);
    let len = 0; for (let i = 1; i < h.length; i++) { len += h[i].distanceTo(h[i - 1]); if (len > maxLen || i >= TRAIL_N - 1) { T.pool.push(...h.splice(i + 1)); break; } }
  }
  (G.camera ? _cam.copy(G.camera.position) : _cam.set(0, 2, -10)).applyMatrix4(_ti);   // camera in model space
  for (let t = 0; t < 2; t++) {
    const h = T.hist[t], n = h.length;
    for (let i = 0; i < TRAIL_N; i++) {
      const o = (t * TRAIL_N + i) * 2;
      if (i >= n || n < 2) { T.alpha[o] = T.alpha[o + 1] = 0; T.pos.fill(0, o * 3, o * 3 + 6); continue; }
      _ta.copy(h[i]).applyMatrix4(_ti); _tb.copy(h[Math.max(0, i - 1)]).applyMatrix4(_ti); _tc.copy(h[Math.min(n - 1, i + 1)]).applyMatrix4(_ti);
      _td.subVectors(_tb, _tc); const view = _tb.subVectors(_cam, _ta); _td.cross(view).normalize().multiplyScalar(w * (1 - 0.6 * i / n));
      T.pos[o * 3] = _ta.x + _td.x; T.pos[o * 3 + 1] = _ta.y + _td.y; T.pos[o * 3 + 2] = _ta.z + _td.z;
      T.pos[o * 3 + 3] = _ta.x - _td.x; T.pos[o * 3 + 4] = _ta.y - _td.y; T.pos[o * 3 + 5] = _ta.z - _td.z;
      T.alpha[o] = T.alpha[o + 1] = Math.min(1, k * 1.35) * Math.pow(1 - i / (n - 1), 1.4);
    }
  }
  T.mesh.geometry.attributes.position.needsUpdate = true; T.mesh.geometry.attributes.alpha.needsUpdate = true; T.mesh.visible = true;
}

// ===========================================================================
// Rider: planar two-bone IK — arms in chest space to the grips, legs in hip space to the pegs —
// with a swivel about the limb axis (elbows flare, knees splay).  Wrists wrap the bars (right hand
// rolls the throttle), ankles plant the soles on the pegs, torso / head react to speed, steering,
// braking, boost, rider inertia and the suspension (the rider sits inside the sprung chassis).
// ===========================================================================
function planarIK(a, b, tx, ty, tz, bendUp = false) {
  const h = Math.hypot(tx, tz), D = Math.hypot(h, ty);
  const Dc = clamp(D, Math.abs(a - b) + 0.01, a + b - 0.002);
  let psi = h > 1e-5 ? Math.atan2(-tx, -tz) : 0;
  const beta = Math.atan2(h, -ty);
  const gamma = Math.acos(clamp((a * a + Dc * Dc - b * b) / (2 * a * Dc), -1, 1));
  let phi = bendUp ? beta + gamma : beta - gamma;
  const ph = Dc * Math.sin(beta), py = Dc * Math.cos(beta);
  const Phi = Math.atan2(ph - a * Math.sin(phi), py - a * Math.cos(phi));
  let e = Phi - phi;
  if (Math.abs(psi) > Math.PI / 2) { psi -= Math.sign(psi) * Math.PI; phi = -phi; e = -e; }
  return { psi, phi, e };
}

const _t = new THREE.Vector3(), _s = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _f = new THREE.Vector3(), _ax = new THREE.Vector3();
const GRIP_OFF = V3(0, -0.105, 0.01), BALL_OFF = V3(0, -0.075, 0.13), _QH = new THREE.Quaternion(), _QI = new THREE.Quaternion();
const _MB = new THREE.Matrix4(), _Q = new THREE.Quaternion(), _Qa = new THREE.Quaternion(), _Qb = new THREE.Quaternion(), _Qc = new THREE.Quaternion(), _M = new THREE.Matrix4(), _E = new THREE.Euler();
function eulerInto(q, order, out) { _E.setFromQuaternion(q, order); out[0] = _E.x; out[1] = _E.y; out[2] = _E.z; }
// swivelled shoulder/hip rotation: planar (psi, phi) then a twist of `sw` about the limb axis `ax`
function limbQuat(r, ax, sw, out) { _Qa.setFromEuler(_E.set(r.phi, r.psi, 0, 'YXZ')); return out.setFromAxisAngle(ax, sw).multiply(_Qa); }

export function ridePoseIK(ch, bike) {
  const S = ch.style.scale;
  const u = bike.model.userData;
  if (u.inner && ch.root.parent !== u.inner) { ch.root.removeFromParent(); u.inner.add(ch.root); }   // ride inside the sprung chassis
  ch.root.rotation.set(0, 0, 0);
  const st = { tuck: 0, up: 0, look: 0, twist: 0, idle: Math.random() * 10 };
  const qHand = new THREE.Quaternion(), qUpper = new THREE.Quaternion(), qFore = new THREE.Quaternion(), qFoot = new THREE.Quaternion(), qThigh = new THREE.Quaternion(), qShin = new THREE.Quaternion();
  ch.override = (B, dt) => {
    const A = u.anchors, V = u.vis || {}, c = bike.ctrl || {}, d = dt || 1 / 60;
    const sp = Math.abs(bike.speed || 0), steer = bike.steer || 0;
    st.tuck += ((bike.boosting ? 1 : clamp((sp - 30) / 60, 0, 0.45)) - st.tuck) * Math.min(1, d * 6);
    st.up += ((c.brake > 0 && sp > 2 ? 1 : 0) - st.up) * Math.min(1, d * 8);
    st.look += (steer * clamp(sp / 12, 0.3, 1) - st.look) * Math.min(1, d * 5);
    st.twist += ((c.throttle || 0) * (1 - st.up) - st.twist) * Math.min(1, d * 10);
    st.idle += d;
    const surge = V.surge || 0, lean = bike.model.rotation.z || 0;
    const still = clamp(1 - sp / 3, 0, 1);
    // hips on the saddle (slide back a touch when tucked)
    ch.root.position.set(0, A.seat.y + 0.13 - 1.0 * S - st.tuck * 0.015, A.seat.z - st.tuck * 0.05);
    B.pos[0] = 0; B.pos[1] = 0; B.pos[2] = 0;
    B.hips[0] = -0.05 + st.tuck * 0.12; B.hips[1] = 0; B.hips[2] = 0;
    // torso: upright-ish cruise, tucked on boost, sits up under braking, surges with inertia, leans into turns
    B.torso[0] = 0.24 + st.tuck * 0.5 - st.up * 0.14 + surge * 1.2 + clamp(sp / 80, 0, 1) * 0.1;
    B.torso[1] = steer * 0.12;
    B.torso[2] = -lean * 0.25 - steer * 0.04;
    // head: eyes level against the lean, look into the turn / around when idle, up over the screen when tucked
    B.head[0] = -B.torso[0] * 0.8 - st.tuck * 0.12 + still * 0.05 * Math.sin(st.idle * 0.7);
    B.head[1] = -st.look * 0.35 + still * 0.35 * Math.sin(st.idle * 0.33) * Math.sin(st.idle * 0.11 + 1);
    B.head[2] = -lean * 0.6;
    ch.applyPose(B);
    bike.model.updateMatrixWorld(true);

    // ---------------- arms (chest space) ----------------
    const a1 = Math.abs(ch.elL.position.y) || 0.38, a2 = Math.abs(ch.wrL.position.y) || 0.38;
    const gOff = ch.gripOffset || GRIP_OFF;                   // grip centre in hand space (a rig may override it)
    const arm = (L) => {
      const sh = L ? ch.shL : ch.shR, wr = L ? ch.wrL : ch.wrR;
      _M.copy((sh.parent || ch.chest).matrixWorld).invert();                                                   // solve in the shoulder's parent space (chest today)
      _t.copy(L ? A.gripL : A.gripR); u.front.localToWorld(_t); _t.applyMatrix4(_M);                         // grip -> chest space
      _x.copy(L ? A.gripAxisL : A.gripAxisR).transformDirection(u.front.matrixWorld).transformDirection(_M);   // bar axis -> chest space
      if (_x.x < 0) _x.negate();                                                                               // hand +X = rider's left
      _f.copy(_t).sub(sh.position).normalize();
      let r = null;
      for (let it = 0; it < 2; it++) {
        // hand frame: X along the bar, fingers (-Y) wrapping forward/down, knuckles (+Z) up
        _y.copy(_f).addScaledVector(_x, -_f.dot(_x)).normalize().negate();
        _y.applyAxisAngle(_x, 0.28 + (L ? 0 : st.twist * 0.35));
        _z.crossVectors(_x, _y).normalize(); _y.crossVectors(_z, _x).normalize();
        qHand.setFromRotationMatrix(_MB.makeBasis(_x, _y, _z));
        _w.copy(gOff).applyQuaternion(qHand); _w.subVectors(_t, _w).sub(sh.position);                    // wrist target
        r = planarIK(a1, a2, _w.x, _w.y, _w.z);
        _ax.copy(_w).normalize();
        limbQuat(r, _ax, (L ? 1 : -1) * (0.55 + st.tuck * 0.35), qUpper);
        qFore.copy(qUpper).multiply(_Qb.setFromEuler(_E.set(r.e, 0, 0)));
        _f.set(0, -1, 0).applyQuaternion(qFore);
      }
      const shA = L ? B.shL : B.shR, elA = L ? B.elL : B.elR, wrA = L ? B.wrL : B.wrR;
      eulerInto(qUpper, sh.rotation.order || 'YXZ', shA); elA[0] = r.e;
      _Qc.copy(qFore).invert().multiply(qHand); eulerInto(_Qc, wr.rotation.order || 'XYZ', wrA);
    };
    arm(true); arm(false);
    if (ch.aim > 0.02) {   // aiming: right arm leaves the bar and points the Lawgiver where the camera looks
      const a = ch.aim;
      B.shR[0] += (-Math.PI / 2 - ch.aimPitch - B.shR[0]) * a; B.shR[1] += ((ch.aimYaw || 0) * 0.9 - B.shR[1]) * a; B.shR[2] *= 1 - a; B.elR[0] += (-0.1 - B.elR[0]) * a;
      B.wrR[0] *= 1 - a; B.wrR[1] *= 1 - a; B.wrR[2] *= 1 - a;
    }

    // ---------------- legs (hips space) ----------------
    const l1 = Math.abs(ch.knL.position.y) || 0.46, l2 = Math.abs(ch.anL.position.y) || 0.4;
    const innerQ = u.inner.getWorldQuaternion(_QI);
    const leg = (L) => {
      const hp = L ? ch.hipL : ch.hipR, an = L ? ch.anL : ch.anR, out = L ? 1 : -1, hpar = hp.parent || ch.hips;
      const hipsInv = hpar.getWorldQuaternion(_QH).invert();
      // foot frame in bike space: toes forward + a little out, sole level with the toe dipped slightly
      _z.set(out * 0.14, -0.1, 1).normalize(); _y.set(0, 1, 0); _x.crossVectors(_y, _z).normalize(); _y.crossVectors(_z, _x).normalize();
      qFoot.setFromRotationMatrix(_MB.makeBasis(_x, _y, _z)).premultiply(innerQ).premultiply(hipsInv);
      // the ball of the foot rests on top of the peg
      _t.copy(L ? A.pegL : A.pegR); _t.y += 0.034; u.inner.localToWorld(_t); hpar.worldToLocal(_t);
      _w.copy(BALL_OFF).applyQuaternion(qFoot); _w.subVectors(_t, _w).sub(hp.position);
      const r = planarIK(l1, l2, _w.x, _w.y, _w.z, true);
      _ax.copy(_w).normalize();
      limbQuat(r, _ax, -out * 0.16, qThigh);
      const hA = L ? B.hipL : B.hipR, kA = L ? B.knL : B.knR, aA = L ? B.anL : B.anR;
      eulerInto(qThigh, hp.rotation.order || 'YXZ', hA); kA[0] = Math.max(0, r.e);
      qShin.copy(qThigh).multiply(_Qc.setFromEuler(_E.set(kA[0], 0, 0)));
      _Qc.copy(qShin).invert().multiply(qFoot); eulerInto(_Qc, an.rotation.order || 'XYZ', aA);
    };
    leg(true); leg(false);
  };
}
