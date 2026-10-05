import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G } from './state.js';
import { fx } from './fx.js';
import { audio } from './audio.js';
import { rand, randInt, pick, chance, clamp, mulberry32, segAABB, makeCanvas, canvasTex } from './util.js';
import * as TX from './textures.js';
import { makeFacadeSet } from './facades.js';
import { patchWall, patchRoad } from './shaders.js';
import { reflection } from './reflect.js';
import { buildHolograms } from './holo.js';
const tmpDir = new THREE.Vector3();

export const N = 15;            // blocks per side
export const S = 100;           // block pitch
export const ROAD = 22;         // road width
export const BLOCK = S - ROAD;  // block size
export const HALF = (N * S) / 2;
const TILE = 12;

export const roadX = (k) => -HALF + k * S;                 // road centreline coordinate for line k (0..N)
export const blockC = (i) => -HALF + (i + 0.5) * S;        // block centre coordinate for block i (0..N-1)

const DISTRICTS = [
  ['Block-War Heights', 'Sektor 9 Financial', 'Neon Row'],
  ['Slo-Mo Alley', 'Hall of Justice', 'Grud Park District'],
  ['Industrial Zone', 'Undercity Market', 'Chop Docks'],
];
const PALETTES = [
  [0xff3030, 0xff8a30, 0xffd24a], [0x4a8aff, 0xffffff, 0x40e0ff], [0xff2ea6, 0x40e0ff, 0xb040ff],
  [0xa0ff40, 0x40ffb0, 0xffd24a], [0xffd24a, 0xff3030, 0xffffff], [0x40e0ff, 0xff2ea6, 0xffd24a],
  [0xff8a30, 0xffb040, 0xff3030], [0xb040ff, 0x40e0ff, 0xff2ea6], [0x40ffd0, 0xffe040, 0xff6a30],
];

// Each district has its own atmosphere: [horizon glow, mid sky, fog, hemisphere sky light, grade tint].  update() blends bilinearly between the
// nine district centres so crossing a district boundary is a slow colour drift, never a pop.
const AIR = [
  [[1.00, 0.38, 0.18, 0.20, 0.09, 0.07, 0x2e1410, 0x7a4a3a, [1.04, 0.97, 0.94]], [0.30, 0.62, 1.00, 0.06, 0.12, 0.30, 0x101a30, 0x3a5a9a, [0.96, 0.99, 1.06]], [1.00, 0.20, 0.72, 0.28, 0.06, 0.30, 0x2e1040, 0x8a3a9a, [1.05, 0.96, 1.05]]],
  [[0.72, 0.85, 0.20, 0.12, 0.16, 0.06, 0x1c2410, 0x5a7a2a, [1.00, 1.04, 0.94]], [0.95, 0.32, 0.36, 0.20, 0.07, 0.30, 0x26143a, 0x5a4a9a, [1.00, 1.00, 1.00]], [0.25, 0.90, 0.60, 0.05, 0.20, 0.20, 0x0e2a24, 0x2a7a6a, [0.95, 1.04, 1.00]]],
  [[1.00, 0.62, 0.20, 0.24, 0.12, 0.06, 0x2c1e0e, 0x8a6a2a, [1.05, 1.00, 0.93]], [0.95, 0.50, 0.28, 0.12, 0.10, 0.24, 0x1c1a2a, 0x5a5a7a, [1.02, 0.99, 0.98]], [0.50, 0.65, 0.90, 0.07, 0.10, 0.22, 0x141c2a, 0x4a6a8a, [0.96, 1.00, 1.05]]],
];
const _ac = new THREE.Color(), _bc = new THREE.Color();
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const boxes = [];
const grid = new Map();
const gkey = (cx, cz) => cx * 1000 + cz;
const gcell = (v) => Math.floor((v + HALF + S * 4) / S);

function addBox(b) {
  boxes.push(b);
  const x0 = gcell(b.minX), x1 = gcell(b.maxX), z0 = gcell(b.minZ), z1 = gcell(b.maxZ);
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    const k = gkey(x, z); let l = grid.get(k); if (!l) { l = []; grid.set(k, l); } l.push(b);
  }
}

export const world = {
  N, S, ROAD, HALF, boxes, addBox,
  hallPos: new THREE.Vector3(0, 0, 0),
  spawnPos: new THREE.Vector3(0, 0, 40),
  dynamic: [],      // dynamic solids {x,z,r,h,owner}
  vents: [],
  nodes: [],

  // ---------- queries ----------
  nearbyBoxes(x, z, out = []) {
    out.length = 0;
    const cx = gcell(x), cz = gcell(z);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const l = grid.get(gkey(cx + dx, cz + dz)); if (l) for (const b of l) if (!out.includes(b)) out.push(b);
    }
    return out;
  },
  // push a circle out of buildings; returns {nx,nz,pen} of the strongest contact or null
  collideCircle(p, r, y = 0) {
    let best = null; const list = this.nearbyBoxes(p.x, p.z, this._tmp || (this._tmp = []));
    for (const b of list) {
      if (b.h < y) continue;
      const cx = clamp(p.x, b.minX, b.maxX), cz = clamp(p.z, b.minZ, b.maxZ);
      let dx = p.x - cx, dz = p.z - cz; let d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      let nx, nz, pen;
      if (d2 < 1e-8) { // centre inside box: push along smallest axis
        const l = p.x - b.minX, rr = b.maxX - p.x, t = p.z - b.minZ, bt = b.maxZ - p.z;
        const m = Math.min(l, rr, t, bt);
        if (m === l) { nx = -1; nz = 0; } else if (m === rr) { nx = 1; nz = 0; } else if (m === t) { nx = 0; nz = -1; } else { nx = 0; nz = 1; }
        pen = m + r;
      } else { const d = Math.sqrt(d2); nx = dx / d; nz = dz / d; pen = r - d; }
      p.x += nx * pen; p.z += nz * pen;
      if (!best || pen > best.pen) best = { nx, nz, pen };
    }
    // outer wall
    const lim = HALF + ROAD / 2 - 2 - r;
    if (p.x > lim) { p.x = lim; best = best || { nx: -1, nz: 0, pen: 0.1 }; }
    if (p.x < -lim) { p.x = -lim; best = best || { nx: 1, nz: 0, pen: 0.1 }; }
    if (p.z > lim) { p.z = lim; best = best || { nx: 0, nz: -1, pen: 0.1 }; }
    if (p.z < -lim) { p.z = -lim; best = best || { nx: 0, nz: 1, pen: 0.1 }; }
    return best;
  },
  // raycast segment against static boxes. returns {t,nx,ny,nz} | null
  rayBoxes(a, b) {
    let best = null;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const probes = len > S * 0.8 ? Math.ceil(len / (S * 0.8)) : 1;
    const seen = new Set();
    for (let i = 0; i <= probes; i++) {
      const t = i / probes; const px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t;
      for (const bx of this.nearbyBoxes(px, pz, [])) {
        if (seen.has(bx)) continue; seen.add(bx);
        const h = segAABB(a.x, a.y, a.z, b.x, b.y, b.z, bx);
        if (h && (!best || h.t < best.t)) best = h;
      }
    }
    // ground
    if (a.y > 0 && b.y < 0) { const t = a.y / (a.y - b.y); if (!best || t < best.t) best = { t, nx: 0, ny: 1, nz: 0 }; }
    return best;
  },
  isRoad(x, z) {
    const gx = (x + HALF) / S, gz = (z + HALF) / S;
    const fx = Math.abs(gx - Math.round(gx)) * S, fz = Math.abs(gz - Math.round(gz)) * S;
    return fx < ROAD / 2 || fz < ROAD / 2;
  },
  district(x, z) {
    const i = clamp(Math.floor((x + HALF) / S), 0, N - 1), j = clamp(Math.floor((z + HALF) / S), 0, N - 1);
    return DISTRICTS[Math.floor(j / 5)][Math.floor(i / 5)];
  },
  palette(x, z) {
    const i = clamp(Math.floor((x + HALF) / S), 0, N - 1), j = clamp(Math.floor((z + HALF) / S), 0, N - 1);
    return PALETTES[Math.floor(j / 5) * 3 + Math.floor(i / 5)];
  },
  nodePos(i, j, out = new THREE.Vector3()) { return out.set(roadX(i), 0, roadX(j)); },
  nearestNode(x, z) { return [clamp(Math.round((x + HALF) / S), 0, N), clamp(Math.round((z + HALF) / S), 0, N)]; },
  randomIntersection(near, minD = 0, maxD = 1e9) {
    for (let t = 0; t < 40; t++) {
      const i = randInt(1, N - 1), j = randInt(1, N - 1);
      const p = this.nodePos(i, j);
      const d = near ? Math.hypot(p.x - near.x, p.z - near.z) : 0;
      if (d >= minD && d <= maxD) return { i, j, pos: p };
    }
    const i = randInt(1, N - 1), j = randInt(1, N - 1); return { i, j, pos: this.nodePos(i, j) };
  },
  // Route along the road grid between two world positions. Returns node list [{x,z}...]
  route(from, to) {
    const snap = (p) => {
      // nearest road centreline projection and its two bounding intersections
      const gx = (p.x + HALF) / S, gz = (p.z + HALF) / S;
      const kx = Math.round(gx), kz = Math.round(gz);
      const dx = Math.abs(gx - kx) * S, dz = Math.abs(gz - kz) * S;
      const cand = [];
      if (dx <= dz) { // on a vertical road (x const)
        const k = clamp(kx, 0, N); const j0 = clamp(Math.floor(gz), 0, N), j1 = clamp(Math.ceil(gz), 0, N);
        cand.push([k, j0], [k, j1]);
      } else {
        const k = clamp(kz, 0, N); const i0 = clamp(Math.floor(gx), 0, N), i1 = clamp(Math.ceil(gx), 0, N);
        cand.push([i0, k], [i1, k]);
      }
      return cand;
    };
    const A = snap(from), B = snap(to);
    let best = null;
    for (const a of A) for (const b of B) {
      const pa = this.nodePos(a[0], a[1]), pb = this.nodePos(b[0], b[1]);
      const cost = Math.hypot(pa.x - from.x, pa.z - from.z) + Math.abs(a[0] - b[0]) * S + Math.abs(a[1] - b[1]) * S + Math.hypot(pb.x - to.x, pb.z - to.z);
      if (!best || cost < best.cost) best = { a, b, cost };
    }
    const pts = [];
    let [i, j] = best.a; const [ti, tj] = best.b;
    pts.push({ x: roadX(i), z: roadX(j) });
    while (i !== ti) { i += Math.sign(ti - i); pts.push({ x: roadX(i), z: roadX(j) }); }
    while (j !== tj) { j += Math.sign(tj - j); pts.push({ x: roadX(i), z: roadX(j) }); }
    return pts;
  },

  // ---------- build ----------
  build(scene, renderer) {
    this.scene = scene;
    const rng = mulberry32(1977);
    const R = (a = 1, b) => (b === undefined ? rng() * a : a + rng() * (b - a));
    const RI = (a, b) => Math.floor(R(a, b + 1));
    const RP = (arr) => arr[Math.floor(rng() * arr.length)];

    // ===== environment map for neon reflections =====
    // A little imaginary city ringed around the origin: dark towers with lit window grids and a few
    // tall neon strips.  Baked to a PMREM so wet roads and glass reflect streaks of light, not blobs.
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x0a0612);
    const emat = (c, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide });
    const darkMat = new THREE.MeshBasicMaterial({ color: 0x07050c });
    const neonCols = [0xff2ea6, 0x40e0ff, 0xffa030, 0x7a40ff, 0xff3030, 0x30ffb0, 0xffd24a];
    const winCols = [0xffd9a0, 0xffe9c0, 0x9fd4ff, 0xffb070, 0xff80d0];
    const quadGeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2 + rand(-0.04, 0.04), r = rand(34, 70), h = rand(30, 95), bw = rand(9, 20);
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      const body = new THREE.Mesh(new THREE.BoxGeometry(bw, h, bw), darkMat); body.position.set(cx, h / 2 - 6, cz); envScene.add(body);
      const nx = -Math.cos(a), nz = -Math.sin(a); // inward normal
      for (let row = 0; row < 9; row++) for (let col = 0; col < 4; col++) {
        if (Math.random() > 0.38) continue;
        const q = new THREE.Mesh(quadGeo, emat(winCols[(Math.random() * winCols.length) | 0], rand(1.2, 2.6)));
        const off = (col - 1.5) * (bw / 4.4);
        q.scale.set(bw / 6, 2.2, 1);
        q.position.set(cx + nx * (bw / 2 + 0.05) + -nz * off, 2 + row * 4.2 + rand(0, 6), cz + nz * (bw / 2 + 0.05) + nx * off);
        q.lookAt(q.position.x + nx, q.position.y, q.position.z + nz); envScene.add(q);
      }
      if (Math.random() < 0.4) {
        const sh = h * rand(0.4, 0.85);
        const s = new THREE.Mesh(quadGeo, emat(neonCols[(Math.random() * neonCols.length) | 0], rand(4, 8)));
        s.scale.set(rand(0.7, 1.4), sh, 1); s.position.set(cx + nx * (bw / 2 + 0.1), sh / 2 - 4, cz + nz * (bw / 2 + 0.1)); s.lookAt(s.position.x + nx, s.position.y, s.position.z + nz); envScene.add(s);
      }
    }
    const ground = new THREE.Mesh(new THREE.CircleGeometry(100, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x050308 })); ground.position.y = -6; envScene.add(ground);
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(95, 16, 8), new THREE.MeshBasicMaterial({ color: 0x2a1030, side: THREE.BackSide })); envScene.add(envSky);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(envScene, 0.02).texture;
    scene.environmentIntensity = 0.5;
    pm.dispose();
    envScene.traverse((o) => { if (o.isMesh) { o.geometry.dispose?.(); } });

    // ===== sky & fog =====
    scene.background = new THREE.Color(0x120a1c);
    scene.fog = new THREE.FogExp2(0x26143a, 0.0029);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { time: { value: 0 }, flash: { value: 0 }, uHor: { value: new THREE.Color(0.95, 0.32, 0.36) }, uMid: { value: new THREE.Color(0.20, 0.07, 0.30) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
      // smog sky: a magenta-orange light-pollution glow at the horizon rising into violet and indigo, two drifting cloud decks that are
      // lit from below by the city (warm) and from above by lightning, plus a faint distant aurora-like neon haze
      fragmentShader: `varying vec3 vP; uniform float time; uniform float flash; uniform vec3 uHor; uniform vec3 uMid;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * n(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; } return s; }
        void main(){
          vec3 d = normalize(vP); float y = d.y;
          vec3 hor = uHor, mid = uMid, top = vec3(0.025, 0.02, 0.09);
          float up = clamp(y, 0.0, 1.0);
          vec3 c = mix(hor, mid, pow(smoothstep(-0.04, 0.55, y), 0.5));
          c = mix(c, top, smoothstep(0.28, 1.0, up));
          c += vec3(0.5, 0.16, 0.2) * exp(-abs(y) * 14.0) * 0.55;                          // glow right at the horizon
          // two cloud decks, projected onto planes so they converge toward the horizon
          float ay = max(abs(y), 0.035);
          vec2 u1 = d.xz / (ay + 0.12) * 1.15 + vec2(time * 0.012, time * 0.004);
          vec2 u2 = d.xz / (ay + 0.30) * 0.7 - vec2(time * 0.006, -time * 0.003) + 31.7;
          float c1 = fbm(u1 * 1.6), c2 = fbm(u2 * 1.9);
          float cov1 = smoothstep(0.42, 0.78, c1), cov2 = smoothstep(0.48, 0.82, c2) * 0.7;
          float below = smoothstep(0.0, 0.35, 1.0 - up);                                   // low clouds catch the city glow, high ones stay dark
          vec3 glow = mix(vec3(0.16, 0.07, 0.2), vec3(0.95, 0.38, 0.34), below * below) * (0.35 + 0.65 * c1);
          c = mix(c, glow, cov1 * 0.85);
          c = mix(c, vec3(0.10, 0.06, 0.16) + vec3(0.35, 0.13, 0.2) * below, cov2 * 0.55);
          // a pale smog-hazed moon with a wide halo (the clouds cover it), and a few faint stars in the clear gaps
          vec3 moonDir = normalize(vec3(-0.42, 0.5, -0.76)); float md = dot(d, moonDir);
          float cloudVeil = clamp(cov1 * 0.9 + cov2 * 0.5, 0.0, 1.0);
          c += vec3(0.62, 0.7, 1.0) * (smoothstep(0.99935, 0.99965, md) * 1.6 + pow(max(md, 0.0), 260.0) * 0.55 + pow(max(md, 0.0), 24.0) * 0.07) * (1.0 - cloudVeil * 0.85) * step(0.0, y);
          vec2 sg = floor(d.xz / (ay + 0.4) * 160.0); float sh = h(sg);
          c += vec3(0.8, 0.85, 1.0) * step(0.9965, sh) * (0.5 + 0.5 * sin(time * 2.0 + sh * 60.0)) * smoothstep(0.35, 0.8, y) * (1.0 - cloudVeil) * 0.55;
          // lightning lights the cloud decks from within
          c += vec3(0.5, 0.55, 0.9) * flash * (0.2 + 1.3 * (cov1 + cov2 * 0.6) * (0.4 + c1));
          c *= 0.85 + 0.15 * step(0.0, y);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), this.skyMat);
    sky.renderOrder = -10; scene.add(sky); this.sky = sky;

    // ===== lights =====
    this.hemi = new THREE.HemisphereLight(0x5a4a9a, 0x2a1a30, 0.6); scene.add(this.hemi); this.hemiBase = this.hemi.color.clone();
    this.sun = new THREE.DirectionalLight(0x8aa0ff, 0.5);
    this.sun.position.set(-60, 120, -40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 400;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.5;
    scene.add(this.sun, this.sun.target);

    // ===== textures & materials =====
    this.timeU = { value: 0 };
    const facMats = [0, 1, 2, 3].map((v) => {
      const s = makeFacadeSet(v);
      const m = new THREE.MeshStandardMaterial({
        map: s.map, emissiveMap: s.emissiveMap, emissive: 0xffffff, emissiveIntensity: [0.72, 0.8, 0.82, 0.7][v],
        roughnessMap: s.ormMap, metalnessMap: s.ormMap, roughness: 1, metalness: 1, normalMap: s.normalMap, normalScale: new THREE.Vector2(0.9, 0.9),
        vertexColors: true, envMapIntensity: 1.1,
      });
      return patchWall(m, v), m;
    });
    const [roadMap, roadRough, roadNorm] = TX.makeRoad();
    const roadMat = new THREE.MeshStandardMaterial({ map: roadMap, roughnessMap: roadRough, normalMap: roadNorm, normalScale: new THREE.Vector2(0.45, 0.45), roughness: 1, metalness: 0.1, envMapIntensity: 1.0 });
    patchRoad(roadMat, this.timeU, reflection.uniforms);
    const [intMap, intRough, intNorm] = TX.makeIntersection();
    const intMat = new THREE.MeshStandardMaterial({ map: intMap, roughnessMap: intRough, normalMap: intNorm, normalScale: new THREE.Vector2(0.45, 0.45), roughness: 1, metalness: 0.1, envMapIntensity: 1.0 });
    patchRoad(intMat, this.timeU, reflection.uniforms);
    const [swMap, swRough, swNorm] = TX.makeSidewalk();
    for (const t of [swMap, swRough, swNorm]) t.repeat.set(BLOCK / 8, BLOCK / 8);
    const swMat = new THREE.MeshStandardMaterial({ map: swMap, roughnessMap: swRough, normalMap: swNorm, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 1, metalness: 0.05, envMapIntensity: 0.8 });
    patchRoad(swMat, this.timeU, reflection.uniforms);
    const grassTex = TX.makeGrass(); grassTex.repeat.set(10, 10);
    const grassMat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95 });
    const signTex = TX.makeSignAtlas();
    const signMat = new THREE.MeshBasicMaterial({ map: signTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, color: new THREE.Color(1.15, 1.15, 1.15) });
    // neon life: every sign breathes slightly; a few are faulty and stutter / drop out
    signMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.timeU;
      shader.vertexShader = 'attribute float sid; varying float vSid;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSid = sid;');
      shader.fragmentShader = 'uniform float uTime; varying float vSid;\n' + shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
{
  float tt = uTime * (5.0 + vSid * 9.0) + vSid * 91.0;
  float glitch = smoothstep(0.5, 0.62, sin(tt) * sin(tt * 1.73 + 3.0) * 0.5 + 0.5);
  float faulty = step(0.8, vSid);
  float k = mix(1.0, 0.18 + 0.82 * glitch, faulty) * (0.93 + 0.07 * sin(uTime * 2.1 + vSid * 40.0));
  diffuseColor.rgb *= k;
}`);
    };
    signMat.customProgramCacheKey = () => 'sign-flicker';
    this.signMat = signMat;
    const neonMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    const shopMat = new THREE.MeshBasicMaterial({ map: TX.makeShopTex(), vertexColors: true, toneMapped: false });
    const shopG = [];
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.5, metalness: 0.8 });

    // ===== accumulators =====
    const wallG = [[], [], [], []];
    const neonG = [];
    const signG = [];
    const metalG = [];
    const glow = []; // {x,y,z,r,g,b,size,blink}
    const lampPos = [];
    const smears = [], neonSrc = [];
    const col3 = (hex) => new THREE.Color(hex);
    const edgeH = {}; // `${i},${j},${side}` -> min building height along edge
    const tint = new THREE.Color();

    const colorize = (g, c) => {
      const n = g.attributes.position.count; const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    };
    const building = (cx, cz, w, d, h, y0, variant, uvOff, collide) => {
      const g = new THREE.BoxGeometry(w, h, d);
      const uv = g.attributes.uv;
      for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
        const idx = f * 4 + k; let u = uv.getX(idx), v = uv.getY(idx);
        if (f < 2) { u = u * d / TILE + uvOff[0]; v = v * h / TILE + uvOff[1]; }
        else if (f > 3) { u = u * w / TILE + uvOff[0]; v = v * h / TILE + uvOff[1]; }
        else { u = 0.02; v = 0.02; }
        uv.setXY(idx, u, v);
      }
      g.translate(cx, y0 + h / 2, cz);
      tint.setHSL(R(0.55, 0.78), R(0.04, 0.22), R(0.66, 1.0)); colorize(g, tint);
      wallG[variant].push(g);
    };
    const neonBox = (x, y, z, w, h, d, color, k = 1.4) => {
      const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z);
      tint.set(color).multiplyScalar(k); colorize(g, tint); neonG.push(g);
    };
    const metalBox = (x, y, z, w, h, d) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); tint.setScalar(1); colorize(g, tint); metalG.push(g); };
    const darkBox = (x, y, z, w, h, d, shade = 0.5, rx = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); g.translate(x, y, z); tint.setScalar(shade); colorize(g, tint); metalG.push(g); };
    const cylBox = (x, y, z, rt, rb, h, shade = 0.6, seg = 10) => { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(x, y, z); tint.setScalar(shade); colorize(g, tint); metalG.push(g); };
    // rooftop clutter: AC units, stacks, water tanks, dishes
    const roofProps = (cx, cz, w, d, top) => {
      const n = RI(1, 4);
      for (let q = 0; q < n; q++) {
        const px = cx + R(-0.36, 0.36) * w, pz = cz + R(-0.36, 0.36) * d, k = R();
        if (k < 0.34) { const aw = R(2, 4.5), ad = R(2, 4); darkBox(px, top + 0.9, pz, aw, 1.8, ad, R(0.45, 0.8)); darkBox(px, top + 1.85, pz, aw * 0.8, 0.12, ad * 0.8, 0.95); }
        else if (k < 0.58) { cylBox(px, top + 2.5, pz, R(0.35, 0.8), R(0.45, 0.9), R(3, 6), 0.55, 8); }
        else if (k < 0.82) {
          cylBox(px, top + 3.4, pz, 1.6, 1.6, 2.6, 0.6, 14); cylBox(px, top + 5.1, pz, 0.1, 1.7, 0.9, 0.5, 14);
          for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) darkBox(px + lx * 1.2, top + 1.0, pz + lz * 1.2, 0.2, 2.0, 0.2, 0.4);
        } else { cylBox(px, top + 1.2, pz, 0.12, 0.12, 2.4, 0.5, 6); cylBox(px, top + 2.6, pz, 1.2, 0.1, 0.45, 0.8, 14); }
      }
    };
    const signQuad = (x, y, z, w, h, ry, idx) => {
      const g = new THREE.PlaneGeometry(w, h);
      const uv = g.attributes.uv;
      const col = idx % TX.SIGN_COLS, row = Math.floor(idx / TX.SIGN_COLS);
      for (let k = 0; k < 4; k++) uv.setXY(k, (col + uv.getX(k)) / TX.SIGN_COLS, 1 - (row + 1 - uv.getY(k)) / TX.SIGN_ROWS);
      g.rotateY(ry); g.translate(x, y, z); { const hh = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; g.setAttribute('sid', new THREE.BufferAttribute(new Float32Array(4).fill(hh - Math.floor(hh)), 1)); } signG.push(g);   // per-sign id from its position (no rng draw: the city layout must not shift)
    };

    // ===== roads =====
    const roadGs = [], intGs = [];
    for (let k = 0; k <= N; k++) {
      for (let b = 0; b < N; b++) {
        // vertical road (x = roadX(k)) along block b
        let g = new THREE.PlaneGeometry(ROAD, BLOCK); g.rotateX(-Math.PI / 2);
        let uv = g.attributes.uv; let vo = R(); for (let q = 0; q < 4; q++) uv.setY(q, uv.getY(q) * BLOCK / ROAD + vo);
        g.translate(roadX(k), 0.0, blockC(b)); roadGs.push(g);
        // horizontal road
        g = new THREE.PlaneGeometry(ROAD, BLOCK); g.rotateX(-Math.PI / 2);
        uv = g.attributes.uv; vo = R(); for (let q = 0; q < 4; q++) uv.setY(q, uv.getY(q) * BLOCK / ROAD + vo);
        g.rotateY(Math.PI / 2); g.translate(blockC(b), 0.0, roadX(k)); roadGs.push(g);
      }
      for (let m = 0; m <= N; m++) { const g = new THREE.PlaneGeometry(ROAD, ROAD); g.rotateX(-Math.PI / 2); g.translate(roadX(k), 0.002, roadX(m)); intGs.push(g); }
    }
    const roadMesh = new THREE.Mesh(mergeGeometries(roadGs), roadMat); roadMesh.receiveShadow = true; roadMesh.layers.set(1); scene.add(roadMesh);   // ground lives on layer 1: the mirror camera must not see it
    const intMesh = new THREE.Mesh(mergeGeometries(intGs), intMat); intMesh.receiveShadow = true; intMesh.layers.set(1); scene.add(intMesh);
    const base = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x08080c, roughness: 0.9 }));
    base.position.y = -0.1; base.receiveShadow = true; base.layers.set(1); scene.add(base);

    // ===== blocks =====
    const swGs = [], grassGs = [];
    const trees = [], props = { crate: [], barrel: [], dumpster: [] };
    const bridgeSpots = [];
    const lotFill = (i, j, x0, z0, x1, z1, depth, minH, maxH) => {
      // recursively subdivide lot into buildings
      const w = x1 - x0, d = z1 - z0;
      if ((w > 34 || d > 34) && depth < 3 && chance(0.85)) {
        const gap = R(3.5, 6);
        if (w > d) { const m = x0 + w * R(0.38, 0.62); lotFill(i, j, x0, z0, m - gap / 2, z1, depth + 1, minH, maxH); lotFill(i, j, m + gap / 2, z0, x1, z1, depth + 1, minH, maxH); }
        else { const m = z0 + d * R(0.38, 0.62); lotFill(i, j, x0, z0, x1, m - gap / 2, depth + 1, minH, maxH); lotFill(i, j, x0, m + gap / 2, x1, z1, depth + 1, minH, maxH); }
        return;
      }
      if (w < 8 || d < 8) return;
      tower((x0 + x1) / 2, (z0 + z1) / 2, w, d, R(minH, maxH), i, j);
    };
    const tower = (cx, cz, w, d, h, i, j, variantForce) => {
      const variant = variantForce ?? RP([0, 0, 1, 2, 2, 3 * (h < 50 ? 1 : 0)]);
      const uvOff = [R(), R()];
      building(cx, cz, w, d, h, 0, variant, uvOff);
      addBox({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h });
      // tiers
      let top = h, tw = w, td = d, tcx = cx, tcz = cz;
      const tiers = h > 80 ? RI(1, 3) : h > 45 ? RI(0, 2) : 0;
      for (let t = 0; t < tiers; t++) {
        tw *= R(0.62, 0.82); td *= R(0.62, 0.82);
        tcx += R(-1, 1) * (w - tw) * 0.25; tcz += R(-1, 1) * (d - td) * 0.25;
        const th = R(0.18, 0.4) * h;
        building(tcx, tcz, tw, td, th, top, variant, [R(), R()]);
        // neon trim at the step
        neonBox(tcx, top + 0.3, tcz, tw + 0.6, 0.5, td + 0.6, RP(this.palette(cx, cz)), 1.1);
        top += th;
      }
      // roof gear
      if (h > 30) {
        const ah = R(6, h > 120 ? 40 : 14);
        metalBox(tcx + R(-1, 1) * tw * 0.25, top + ah / 2, tcz + R(-1, 1) * td * 0.25, 0.5, ah, 0.5);
        glow.push({ x: tcx, y: top + ah + 0.5, z: tcz, c: [1.0, 0.1, 0.1], s: 7, blink: 1 });
        for (let q = 0; q < 2; q++) metalBox(tcx + R(-1, 1) * tw * 0.3, top + 1.2, tcz + R(-1, 1) * td * 0.3, R(2, 5), 2.4, R(2, 5));
      }
      // cornice + roof clutter
      if (h > 14) { darkBox(cx, h - 0.35, cz, w + 0.9, 0.7, d + 0.9, 0.55); darkBox(cx, h + 0.15, cz, w + 0.4, 0.3, d + 0.4, 0.35); }
      roofProps(tcx, tcz, tw, td, top);
      // pilasters on big towers
      if (h > 70 && w > 28) {
        for (const [nx, nz, len, sx, sz] of [[0, 1, w, cx, cz + d / 2], [0, -1, w, cx, cz - d / 2], [1, 0, d, cx + w / 2, cz], [-1, 0, d, cx - w / 2, cz]]) {
          const n = Math.floor(len / 13);
          for (let q = 0; q < n; q++) {
            const o = -len / 2 + (q + 0.5) * (len / n);
            darkBox(sx + nx * 0.4 + (nz !== 0 ? o : 0), h / 2, sz + nz * 0.4 + (nx !== 0 ? o : 0), nx !== 0 ? 0.8 : 1.0, h, nz !== 0 ? 0.8 : 1.0, 0.5);
          }
        }
      }
      // vertical neon edges on tall towers
      if (h > 60 && chance(0.6)) {
        const col = RP(this.palette(cx, cz)); const hh = h * R(0.4, 0.95);
        for (const [sx, sz] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) if (chance(0.5)) neonBox(cx + sx * (w / 2 + 0.15), hh / 2, cz + sz * (d / 2 + 0.15), 0.4, hh, 0.4, col, 1.3);
      }
      // signs on street-facing sides
      const sides = [[0, 1, w, cx, cz + d / 2, 0], [0, -1, w, cx, cz - d / 2, Math.PI], [1, 0, d, cx + w / 2, cz, Math.PI / 2], [-1, 0, d, cx - w / 2, cz, -Math.PI / 2]];
      for (const [nx, nz, len, sx, sz, ry] of sides) {
        // only if this side is near the block edge (faces a street)
        const edgeD = nx !== 0 ? Math.abs(sx - (blockC(i) + Math.sign(nx) * BLOCK / 2)) : Math.abs(sz - (blockC(j) + Math.sign(nz) * BLOCK / 2));
        if (edgeD > 6 || !chance(h > 100 ? 0.55 : 0.4)) continue;
        const idx = RI(0, TX.SIGN_COUNT - 1);
        const sw = clamp(len * R(0.45, 0.8), 8, 24), sh = sw / 2;
        const sy = R(6, Math.min(h - sh, 55));
        const off = (nx !== 0 || nz !== 0 ? 0.35 : 0);
        const pos = nx !== 0 ? [sx + nx * off, sz + R(-1, 1) * (len / 2 - sw / 2)] : [sx + R(-1, 1) * (len / 2 - sw / 2), sz + nz * off];
        signQuad(pos[0], sy, pos[1], sw, sh, ry, idx);
        glow.push({ x: pos[0] + nx * 2, y: sy, z: pos[1] + nz * 2, c: [0.6, 0.5, 0.6], s: sw * 0.9, blink: 0, a: 0.1 });

      }
      // ground-floor shopfronts with awnings, signs and blade signs on street-facing walls
      if (h > 10) for (const [nx, nz, len, sx, sz, ry] of sides) {
        const edgeD = nx !== 0 ? Math.abs(sx - (blockC(i) + Math.sign(nx) * BLOCK / 2)) : Math.abs(sz - (blockC(j) + Math.sign(nz) * BLOCK / 2));
        if (edgeD > 7) continue;
        const ax = nx !== 0 ? 0 : 1, az = nx !== 0 ? 1 : 0, pal = this.palette(cx, cz);
        let t = -len / 2 + R(1.5, 3);
        while (t < len / 2 - 5) {
          const bw = R(4, 8.5); if (t + bw > len / 2 - 1.5) break;
          const mid = t + bw / 2, col = RP(pal);
          const px = sx + ax * mid, pz = sz + az * mid;
          const gw = nx !== 0 ? 0.3 : bw, gd = nx !== 0 ? bw : 0.3;
          { const g = new THREE.BoxGeometry(gw, 3.0, gd); g.translate(px + nx * 0.25, 1.85, pz + nz * 0.25); if (nx !== 0) g.rotateY(0); tint.set(col).multiplyScalar(1.35); colorize(g, tint); shopG.push(g); }   // lit shop interior
          for (const s2 of [-1, 1]) darkBox(px + nx * 0.3 + ax * s2 * bw / 2, 1.85, pz + nz * 0.3 + az * s2 * bw / 2, nx !== 0 ? 0.5 : 0.35, 3.3, nz !== 0 ? 0.5 : 0.35, 0.3);
          darkBox(px + nx * 0.85, 3.65, pz + nz * 0.85, nx !== 0 ? 1.5 : bw + 0.8, 0.18, nz !== 0 ? 1.5 : bw + 0.8, 0.35);   // awning
          neonBox(px + nx * 1.55, 3.57, pz + nz * 1.55, nx !== 0 ? 0.07 : bw + 0.8, 0.09, nz !== 0 ? 0.07 : bw + 0.8, col, 1.0);
          if (chance(0.6)) signQuad(px + nx * 0.32, 4.85, pz + nz * 0.32, clamp(bw * 0.9, 3, 7), 1.7, ry, RI(0, TX.SIGN_COUNT - 1));
          smears.push({ x: px + nx * 2.4, z: pz + nz * 2.4, c: col3(col), a: 0.55, w: bw * 0.42, l: 7 });
          neonSrc.push({ x: px + nx * 2.0, y: 2.6, z: pz + nz * 2.0, c: col3(col) });
          t += bw + R(0.8, 3.2);
        }
        if (chance(0.5)) { // blade sign
          const col = RP(pal), along = R(-0.35, 0.35) * len, bx = sx + ax * along + nx * 1.0, bz = sz + az * along + nz * 1.0, by = R(6, 11);
          darkBox(bx, by, bz, nx !== 0 ? 1.8 : 0.18, 3.6, nz !== 0 ? 1.8 : 0.18, 0.3);
          for (const s2 of [-1, 1]) neonBox(bx + (nz !== 0 ? s2 * 0.12 : 0), by, bz + (nx !== 0 ? s2 * 0.12 : 0), nx !== 0 ? 1.4 : 0.05, 3.2, nz !== 0 ? 1.4 : 0.05, col, 1.2);
        }
      }
      return top;
    };

    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const cx = blockC(i), cz = blockC(j);
      // sidewalk slab
      const sg = new THREE.BoxGeometry(BLOCK, 0.24, BLOCK); sg.translate(cx, 0.12, cz);
      const suv = sg.attributes.uv; for (let q = 0; q < suv.count; q++) { /* keep uv scaled by texture repeat */ }
      swGs.push(sg);
      const centre = i === (N - 1) / 2 && j === (N - 1) / 2;
      const r0 = rng();
      let kind = r0 < 0.34 ? 'mega' : r0 < 0.72 ? 'cluster' : r0 < 0.82 ? 'slab' : r0 < 0.9 ? 'park' : r0 < 0.95 ? 'plaza' : 'industrial';
      if (centre) kind = 'hall';
      const m = 4, x0 = cx - BLOCK / 2 + m, x1 = cx + BLOCK / 2 - m, z0 = cz - BLOCK / 2 + m, z1 = cz + BLOCK / 2 - m;
      let minEdge = 0;
      if (kind === 'mega') {
        const n = RI(1, 3);
        if (n === 1) { minEdge = tower(cx + R(-2, 2), cz + R(-2, 2), R(42, 62), R(42, 62), R(150, 280), i, j); }
        else { lotFill(i, j, x0, z0, x1, z1, 1, 110, 230); minEdge = 100; }
        minEdge = 100;
      } else if (kind === 'cluster') { lotFill(i, j, x0, z0, x1, z1, 0, 24, 100); minEdge = 40; }
      else if (kind === 'slab') {
        const horiz = chance(0.5), len = R(55, 66), th = R(18, 26);
        for (const s of [-1, 1]) {
          const hh = R(50, 110);
          if (horiz) tower(cx, cz + s * 17, len, th, hh, i, j, 1); else tower(cx + s * 17, cz, th, len, hh, i, j, 1);
        }
        minEdge = 50;
      } else if (kind === 'industrial') {
        lotFill(i, j, x0, z0, x1, z1, 1, 8, 24); minEdge = 8;
        for (let q = 0; q < 3; q++) { // tanks & chimneys
          const px = cx + R(-25, 25), pz = cz + R(-25, 25), rad = R(3, 6), hh = R(14, 38);
          const g = new THREE.CylinderGeometry(rad, rad, hh, 12); g.translate(px, hh / 2, pz); tint.setScalar(1); colorize(g, tint); metalG.push(g);
          addBox({ minX: px - rad, maxX: px + rad, minZ: pz - rad, maxZ: pz + rad, h: hh });
          if (chance(0.5)) glow.push({ x: px, y: hh + 1, z: pz, c: [2.0, 0.7, 0.2], s: 14, blink: 2 });
        }
      } else if (kind === 'park') {
        const g = new THREE.PlaneGeometry(BLOCK - 8, BLOCK - 8).rotateX(-Math.PI / 2); g.translate(cx, 0.26, cz); grassGs.push(g);
        for (let q = 0; q < 26; q++) trees.push({ x: cx + R(-33, 33), z: cz + R(-33, 33), s: R(0.8, 1.6) });
        // holo pond
        const pond = new THREE.Mesh(new THREE.CircleGeometry(9, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.5, 0.8).multiplyScalar(1.4), toneMapped: false, transparent: true, opacity: 0.7 }));
        pond.position.set(cx + R(-10, 10), 0.3, cz + R(-10, 10)); scene.add(pond);
        minEdge = 0;
      } else if (kind === 'plaza') {
        // statue pedestal + holo ring
        const px = cx, pz = cz;
        metalBox(px, 1.5, pz, 6, 3, 6); metalBox(px, 7, pz, 2.2, 8, 2.2);
        addBox({ minX: px - 3, maxX: px + 3, minZ: pz - 3, maxZ: pz + 3, h: 11 });
        glow.push({ x: px, y: 12, z: pz, c: [1, 0.85, 0.3], s: 16, blink: 0 });
        for (const [sx, sz] of [[-26, -26], [26, 26], [-26, 26], [26, -26]]) { metalBox(cx + sx, 2, cz + sz, 4, 4, 4); addBox({ minX: cx + sx - 2, maxX: cx + sx + 2, minZ: cz + sz - 2, maxZ: cz + sz + 2, h: 4 }); }
      } else if (kind === 'hall') {
        this.buildHall(cx, cz, { building, neonBox, metalBox, darkBox, cylBox, signQuad, glow, addBox, scene, colorize, metalG, neonG, tint });
        minEdge = 0;
      }
      edgeH[`${i},${j}`] = minEdge;
      // sidewalk props
      if (kind !== 'park' && kind !== 'hall') {
        const np = RI(2, 5);
        for (let q = 0; q < np; q++) {
          const side = RI(0, 3), t = R(-BLOCK / 2 + 4, BLOCK / 2 - 4); const off = BLOCK / 2 - 2.2;
          const px = cx + (side < 2 ? (side === 0 ? -off : off) : t), pz = cz + (side < 2 ? t : (side === 2 ? -off : off));
          const type = RP(['crate', 'barrel', 'dumpster']);
          props[type].push({ x: px, z: pz, r: R(0, 6.28) });
          const s = type === 'dumpster' ? [3.6, 1.8, 1.8] : type === 'crate' ? [1.6, 1.6, 1.6] : [1.1, 1.4, 1.1];
          addBox({ minX: px - s[0] / 2, maxX: px + s[0] / 2, minZ: pz - s[2] / 2, maxZ: pz + s[2] / 2, h: s[1] });
        }
      }
      // steam vents at corners
      if (chance(0.5)) this.vents.push(new THREE.Vector3(cx + RP([-1, 1]) * (BLOCK / 2 + ROAD / 2 - 2), 0, cz + R(-30, 30)));
    }

    // ===== skybridges between adjacent tall blocks =====
    for (let q = 0; q < 70; q++) {
      const i = RI(0, N - 2), j = RI(0, N - 1);
      const a = edgeH[`${i},${j}`], b = edgeH[`${i + 1},${j}`];
      const lim = Math.min(a, b);
      if (!(lim > 36)) continue;
      const y = R(16, lim * 0.85), z = blockC(j) + R(-22, 22);
      const x = roadX(i + 1);
      const len = ROAD + 12;
      metalBox(x, y, z, len, 3.6, 6);
      neonBox(x, y - 1.9, z, len - 2, 0.25, 4, RP(this.palette(x, z)), 1.8);
      neonBox(x, y + 0.5, z - 3.05, len - 4, 1.2, 0.15, 0xffe0a0, 1.2);
      glow.push({ x, y: y - 2.2, z, c: [0.7, 0.6, 0.8], s: 22, blink: 0, a: 0.2 });
    }
    for (let q = 0; q < 70; q++) {
      const i = RI(0, N - 1), j = RI(0, N - 2);
      const a = edgeH[`${i},${j}`], b = edgeH[`${i},${j + 1}`];
      const lim = Math.min(a, b);
      if (!(lim > 36)) continue;
      const y = R(16, lim * 0.85), x = blockC(i) + R(-22, 22), z = roadX(j + 1);
      const len = ROAD + 12;
      metalBox(x, y, z, 6, 3.6, len);
      neonBox(x, y - 1.9, z, 4, 0.25, len - 2, RP(this.palette(x, z)), 1.8);
      glow.push({ x, y: y - 2.2, z, c: [0.7, 0.6, 0.8], s: 22, blink: 0, a: 0.2 });
    }

    // ===== outer wall + distant skyline =====
    const W = HALF + ROAD / 2 + 6;
    for (const [cx, cz, w, d] of [[0, -W - 6, 2 * W + 24, 12], [0, W + 6, 2 * W + 24, 12], [-W - 6, 0, 12, 2 * W], [W + 6, 0, 12, 2 * W]]) {
      building(cx, cz, w, d, 90, 0, 3, [R(), R()]);
      neonBox(cx, 91, cz, w + 0.4, 1.2, d + 0.4, 0xff7a20, 1.6);
    }
    for (let q = 0; q < 700; q++) {
      const a = R(0, Math.PI * 2), rr = R(HALF + 60, HALF + 1500);
      const px = Math.cos(a) * rr * 1.0, pz = Math.sin(a) * rr * 1.0;
      if (Math.abs(px) < W + 14 && Math.abs(pz) < W + 14) continue;
      const w = R(30, 90), d = R(30, 90), h = R(80, 420) * (1 + (rr - HALF) / 3000);
      building(px, pz, w, d, h, 0, RP([0, 1, 2]), [R(), R()]);
      if (chance(0.4)) glow.push({ x: px, y: h + 2, z: pz, c: [1, 0.1, 0.1], s: 18, blink: 1 });
    }
    // gate marker lights along wall
    for (let q = -W; q < W; q += 60) for (const [x, z] of [[q, -W], [q, W], [-W, q], [W, q]]) glow.push({ x, y: 40, z, c: [1.2, 0.5, 0.1], s: 14, blink: 0 });

    // ===== street lamps =====
    const lampMatrix = [];
    for (let k = 0; k <= N; k++) {
      for (let t = -HALF + 20; t < HALF; t += 40) {
        for (const side of [-1, 1]) {
          lampMatrix.push([roadX(k) + side * (ROAD / 2 - 1.2), t + (side > 0 ? 20 : 0), 1]);
          lampMatrix.push([t + (side > 0 ? 20 : 0), roadX(k) + side * (ROAD / 2 - 1.2), 0]);
        }
      }
    }
    const lampPole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.2, 7.5, 6).translate(0, 3.75, 0), darkMetal, lampMatrix.length);
    const lampHead = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.25, 0.7).translate(0, 7.6, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.85, 0.6).multiplyScalar(1.5), toneMapped: false }), lampMatrix.length);
    const m4 = new THREE.Matrix4();
    lampMatrix.forEach(([x, z], idx) => {
      m4.makeTranslation(x, 0, z); lampPole.setMatrixAt(idx, m4); lampHead.setMatrixAt(idx, m4);
      glow.push({ x, y: 7.6, z, c: [1, 0.78, 0.5], s: 5, blink: 0, a: 0.4 });
      if (idx % 2 === 0) lampPos.push({ x, z, c: new THREE.Color(1, 0.7, 0.4), r: 14 });
      smears.push({ x, z, c: new THREE.Color(1, 0.74, 0.42), a: 0.6, w: 0.9, l: 11 });
    });
    this.lamps = lampMatrix.map(([x, z]) => ({ x, z }));
    scene.add(lampPole, lampHead);

    // ===== merge & add meshes =====
    const sw = new THREE.Mesh(mergeGeometries(swGs), swMat); sw.receiveShadow = true; sw.layers.set(1); scene.add(sw);
    // sidewalk uv: BoxGeometry uv 0..1 per face; repeat set on texture handles tiling
    if (grassGs.length) { const m = new THREE.Mesh(mergeGeometries(grassGs), grassMat); m.receiveShadow = true; scene.add(m); }
    // The heavy layers (building walls, metal trim: ~1.3 M triangles that also cast shadows) are merged per coarse spatial chunk, so frustum culling and the
    // shadow / mirror passes (which cull against their own frusta) skip the parts of the city that are far away.  Chunks are coarse on purpose: every chunk
    // is one more draw call in every pass, and the small layers (neon, shopfronts, signs) cost more in draw calls than they could save in triangles, so they stay whole.
    const CHUNK = +(globalThis.__CHUNK || 500);
    const chunked = (geos, material, setup) => {
      // the outer skyline beyond the city wall would otherwise scatter into dozens of one-tower cells: cell indices are clamped into the city footprint
      const cells = new Map(), c = new THREE.Vector3(), lo = Math.floor(-HALF / CHUNK), hi = Math.floor(HALF / CHUNK), ix = (v) => Math.max(lo, Math.min(hi, Math.floor(v / CHUNK)));
      for (const g of geos) { g.computeBoundingBox(); g.boundingBox.getCenter(c); const k = ix(c.x) + ',' + ix(c.z); let a = cells.get(k); if (!a) cells.set(k, a = []); a.push(g); }
      for (const arr of cells.values()) { const m = new THREE.Mesh(mergeGeometries(arr), material); m.geometry.computeBoundingSphere(); setup?.(m); scene.add(m); }
    };
    wallG.forEach((arr, v) => { if (arr.length) chunked(arr, facMats[v], (m) => { m.castShadow = true; m.receiveShadow = true; }); });
    if (neonG.length) scene.add(new THREE.Mesh(mergeGeometries(neonG), neonMat));
    if (shopG.length) scene.add(new THREE.Mesh(mergeGeometries(shopG), shopMat));
    if (metalG.length) chunked(metalG, new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x2a2d36, roughness: 0.5, metalness: 0.7 }), (m) => { m.castShadow = true; m.receiveShadow = true; });
    if (signG.length) { const m = new THREE.Mesh(mergeGeometries(signG), signMat); m.renderOrder = 5; scene.add(m); }

    // trees
    if (trees.length) {
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.4, 3, 6).translate(0, 1.5, 0), new THREE.MeshStandardMaterial({ color: 0x2a1a10 }), trees.length);
      const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.4, 1).translate(0, 5, 0), new THREE.MeshStandardMaterial({ color: 0x1c4a3a, roughness: 0.9, flatShading: true, emissive: 0x021a10 }), trees.length);
      const mm = new THREE.Matrix4();
      trees.forEach((t, k) => { mm.makeScale(t.s, t.s, t.s).setPosition(t.x, 0.2, t.z); trunk.setMatrixAt(k, mm); crown.setMatrixAt(k, mm); });
      trunk.castShadow = crown.castShadow = true; scene.add(trunk, crown);
      trees.forEach((t) => { if (chance(0.15)) glow.push({ x: t.x, y: 4, z: t.z, c: [0.3, 1, 0.7], s: 6, blink: 0, a: 0.5 }); });
    }
    // props
    const propMeshes = {
      crate: new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 1.6, 1.6).translate(0, 0.8, 0), new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 0.8 }), props.crate.length || 1),
      barrel: new THREE.InstancedMesh(new THREE.CylinderGeometry(0.55, 0.55, 1.4, 10).translate(0, 0.7, 0), new THREE.MeshStandardMaterial({ color: 0x8a3a1a, roughness: 0.5, metalness: 0.6 }), props.barrel.length || 1),
      dumpster: new THREE.InstancedMesh(new THREE.BoxGeometry(3.6, 1.8, 1.8).translate(0, 0.9, 0), new THREE.MeshStandardMaterial({ color: 0x1f4a30, roughness: 0.6, metalness: 0.5 }), props.dumpster.length || 1),
    };
    const mq = new THREE.Matrix4(), rot = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    for (const [name, mesh] of Object.entries(propMeshes)) {
      props[name].forEach((p, k) => { rot.setFromAxisAngle(new THREE.Vector3(0, 1, 0), name === 'barrel' ? p.r : Math.round(p.r / 1.57) * 1.57); mq.compose(new THREE.Vector3(p.x, 0.24, p.z), rot, one); mesh.setMatrixAt(k, mq); });
      mesh.count = props[name].length; mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
    }

    // ===== glow sprites (lamps, signs, aircraft lights) =====
    this.buildGlow(scene, glow);
    // ===== light pool decals =====
    this.buildPools(scene, lampPos);
    // ===== wet-road reflection smears, lamp cones, lamp lights, cables, searchlights =====
    this.neonSrc = neonSrc;
    this.buildSmears(scene, smears);
    this.buildCones(scene);
    this.buildLights(scene);
    this.buildCables(scene, edgeH);
    this.buildSearchlights(scene);
    this.buildHolo(scene);
    // ===== rain =====
    this.buildRain(scene);
    // ===== flying traffic =====
    this.buildFlyers(scene);
    this.lightningT = rand(6, 14);
    this.lightning = 0;
    this.ventT = 0;
    // keep for later lookups
    this.facMats = facMats;
    this.roadMat = roadMat;
  },

  buildHall(cx, cz, h) {
    const { building, neonBox, metalBox, darkBox, cylBox, signQuad, glow, addBox, scene, colorize, metalG, tint } = h;
    // plaza paving is the sidewalk slab. Main building + wings + columns.
    building(cx, cz - 12, 56, 40, 60, 0, 0, [0.1, 0]);
    building(cx - 32, cz - 18, 20, 30, 38, 0, 1, [0.3, 0]);
    building(cx + 32, cz - 18, 20, 30, 38, 0, 1, [0.6, 0]);
    building(cx, cz - 12, 30, 24, 100, 60, 2, [0.4, 0.2]);
    addBox({ minX: cx - 28, maxX: cx + 28, minZ: cz - 32, maxZ: cz + 8, h: 60 });
    addBox({ minX: cx - 42, maxX: cx - 22, minZ: cz - 33, maxZ: cz - 3, h: 38 });
    addBox({ minX: cx + 22, maxX: cx + 42, minZ: cz - 33, maxZ: cz - 3, h: 38 });
    neonBox(cx, 61, cz - 12, 57, 1.2, 41, 0xffc040, 2);
    neonBox(cx, 161, cz - 12, 31, 1, 25, 0xffc040, 2);
    // ---- monumental frontage: colonnade, entablature, lit portal, paving inlay, statues ----
    // stone is floodlit: baked directional shading + a falloff with height, drawn unlit; gold is real metal with a warm emissive floor
    const stoneG = [], goldG = [], Ld = new THREE.Vector3(0.25, 0.45, 1).normalize();
    const bakeLit = (g, x, y, z, base, list) => {
      g.translate(x, y, z); const n = g.attributes.normal, p = g.attributes.position, c = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const lam = 0.3 + 0.7 * Math.max(0, n.getX(i) * Ld.x + n.getY(i) * Ld.y + n.getZ(i) * Ld.z), fall = 1 - 0.62 * Math.min(1, Math.max(0, p.getY(i) / 65));
        c[i * 3] = base[0] * lam * fall; c[i * 3 + 1] = base[1] * lam * fall; c[i * 3 + 2] = base[2] * lam * fall;
      }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3)); list.push(g);
    };
    const stone = (g, x, y, z, k = 1) => bakeLit(g, x, y, z, [0.5 * k, 0.43 * k, 0.32 * k], stoneG);
    for (let q = 0; q < 8; q++) {
      if (q === 3 || q === 4) continue;                                   // the entrance gap
      const x = cx - 24.5 + q * 7;
      stone(new THREE.CylinderGeometry(1.5, 1.7, 59, 18), x, 29.5, cz + 11.4);
      stone(new THREE.BoxGeometry(4.2, 1.0, 4.2), x, 59.6, cz + 11.4, 1.1); stone(new THREE.BoxGeometry(3.8, 1.2, 3.8), x, 0.6, cz + 11.4, 1.1);
    }
    stone(new THREE.BoxGeometry(60, 2.6, 6.4), cx, 62.2, cz + 10.6, 0.95);                  // entablature
    neonBox(cx, 63.7, cz + 13.9, 60, 0.45, 0.4, 0xffc040, 2.4);
    neonBox(cx, 60.9, cz + 13.9, 60, 0.3, 0.3, 0xffc040, 1.4);
    { // glowing portal: golden double doors under a fan-light, lit from within
      const [pc, px] = makeCanvas(256, 512);
      const pg = px.createLinearGradient(0, 0, 0, 512); pg.addColorStop(0, '#c98d34'); pg.addColorStop(0.45, '#ffdc96'); pg.addColorStop(1, '#fff2cc'); px.fillStyle = pg; px.fillRect(0, 0, 256, 512);
      px.strokeStyle = 'rgba(110,64,8,0.75)'; px.lineWidth = 4;
      for (const dx of [0, 128]) { px.fillStyle = 'rgba(140,84,12,0.16)'; px.fillRect(dx + 10, 130, 108, 372); px.strokeRect(dx + 10, 130, 108, 372); px.strokeRect(dx + 24, 150, 80, 150); px.strokeRect(dx + 24, 318, 80, 168); }
      px.fillStyle = 'rgba(70,36,0,0.85)'; px.fillRect(125, 130, 6, 382); px.fillRect(110, 300, 6, 40); px.fillRect(140, 300, 6, 40);
      px.beginPath(); px.arc(128, 128, 112, Math.PI, 2 * Math.PI); px.stroke();
      for (let i = 1; i < 8; i++) { const a = Math.PI + i * Math.PI / 8; px.beginPath(); px.moveTo(128, 128); px.lineTo(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112); px.stroke(); }
      px.fillStyle = 'rgba(70,36,0,0.9)'; px.beginPath(); px.moveTo(128, 52); px.lineTo(150, 84); px.lineTo(196, 70); px.lineTo(170, 112); px.lineTo(148, 108); px.lineTo(128, 128); px.lineTo(108, 108); px.lineTo(86, 112); px.lineTo(60, 70); px.lineTo(106, 84); px.closePath(); px.fill();
      const portal = new THREE.Mesh(new THREE.PlaneGeometry(11, 21), new THREE.MeshBasicMaterial({ map: canvasTex(pc), toneMapped: false, color: new THREE.Color(1.15, 1.1, 1.0) }));
      portal.position.set(cx, 10.5, cz + 8.3); scene.add(portal);
    }
    stone(new THREE.BoxGeometry(13, 1.6, 1.2), cx, 21.7, cz + 8.5, 0.9);
    for (const sx of [-1, 1]) { stone(new THREE.BoxGeometry(1.4, 22, 1.2), cx + sx * 6.3, 11, cz + 8.5, 0.9); neonBox(cx + sx * 5.55, 10.5, cz + 8.7, 0.12, 21, 0.12, 0xffc040, 2); }
    glow.push({ x: cx, y: 9, z: cz + 12, c: [1.4, 1.0, 0.5], s: 26, blink: 0, a: 0.2 });
    // paving inlay leading to the door (flat, so nobody trips on it)
    for (let i = 0; i < 5; i++) neonBox(cx, 0.28, cz + 15 + i * 4.2, 58 - i * 7, 0.05, 0.35, 0xffc040, 0.9);
    neonBox(cx, 0.28, cz + 15, 0.4, 0.05, 17, 0xffc040, 0.9);
    { // gold eagle emblem inlaid in the plaza (glossy, so it mirrors the façade in the rain) + two waving banners between the columns
      const eagleCanvas = (W, H, draw) => { const [c, x] = makeCanvas(W, H); draw(x, W, H); return canvasTex(c); };
      const eaglePath = (x, cx0, cy0, size) => {
        const pts = eagleShape().getPoints(); const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
        const w = Math.max(...xs) - Math.min(...xs), hh = Math.max(...ys) - Math.min(...ys), k = size / Math.max(w, hh), mx = (Math.max(...xs) + Math.min(...xs)) / 2, my = (Math.max(...ys) + Math.min(...ys)) / 2;
        x.beginPath(); pts.forEach((q, i) => { const px = cx0 + (q.x - mx) * k, py = cy0 - (q.y - my) * k; i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.closePath();
      };
      const emblem = eagleCanvas(1024, 1024, (x, W) => {
        const g = x.createLinearGradient(0, 120, 0, 900); g.addColorStop(0, '#fff0a0'); g.addColorStop(0.5, '#e8b030'); g.addColorStop(1, '#8a5a10');
        x.fillStyle = 'rgba(12,10,18,0.92)'; x.beginPath(); x.arc(512, 512, 500, 0, 7); x.fill();
        x.strokeStyle = g; x.lineWidth = 16; x.beginPath(); x.arc(512, 512, 488, 0, 7); x.stroke(); x.lineWidth = 6; x.beginPath(); x.arc(512, 512, 372, 0, 7); x.stroke();
        for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; x.fillStyle = g; x.beginPath(); x.moveTo(512 + Math.cos(a) * 372, 512 + Math.sin(a) * 372); x.lineTo(512 + Math.cos(a + 0.09) * 440, 512 + Math.sin(a + 0.09) * 440); x.lineTo(512 + Math.cos(a - 0.09) * 440, 512 + Math.sin(a - 0.09) * 440); x.fill(); }
        x.fillStyle = g; eaglePath(x, 512, 500, 560); x.fill(); x.strokeStyle = '#2a1804'; x.lineWidth = 5; x.stroke();
        x.font = '900 40px Impact, "Arial Black", sans-serif'; x.fillStyle = g; x.textAlign = 'center'; x.textBaseline = 'middle';
        const txt = 'JUSTICE DEPARTMENT  ·  MEGA-CITY ONE  ·  JUSTICE DEPARTMENT  ·  MEGA-CITY ONE  ·  ';
        for (let i = 0; i < txt.length; i++) { const a = -Math.PI / 2 + (i + 0.5) / txt.length * Math.PI * 2; x.save(); x.translate(512 + Math.cos(a) * 430, 512 + Math.sin(a) * 430); x.rotate(a + Math.PI / 2); x.fillText(txt[i], 0, 0); x.restore(); }
      });
      const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;
      const emMat = new THREE.MeshStandardMaterial({ map: emblem, roughnessMap: white, roughness: 0.28, metalness: 0.5, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false, emissive: 0x5a3a08, emissiveMap: emblem, emissiveIntensity: 0.55 });
      patchRoad(emMat, this.timeU, reflection.uniforms);
      const emMesh = new THREE.Mesh(new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2), emMat); emMesh.position.set(cx, 0.27, cz + 31);   // the plaza paving is the 0.24 m sidewalk slab
      emMesh.layers.set(1); emMesh.receiveShadow = true; scene.add(emMesh); this.emblemMesh = emMesh;
      const bannerTex = eagleCanvas(256, 1024, (x, W, H) => {
        const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#5a0d12'); g.addColorStop(1, '#2a0508'); x.fillStyle = g; x.fillRect(0, 0, W, H);
        const gg = x.createLinearGradient(0, 0, 0, H); gg.addColorStop(0, '#fff0a0'); gg.addColorStop(0.5, '#e8b030'); gg.addColorStop(1, '#8a5a10');
        x.strokeStyle = gg; x.lineWidth = 10; x.strokeRect(12, 12, W - 24, H - 24); x.lineWidth = 3; x.strokeRect(26, 26, W - 52, H - 52);
        x.fillStyle = gg; eaglePath(x, W / 2, 330, 190); x.fill();
        x.font = '900 64px Impact, "Arial Black", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
        'JUSTICE'.split('').forEach((ch, i) => x.fillText(ch, W / 2, 560 + i * 62));
        x.beginPath(); x.moveTo(W / 2, H - 60); x.lineTo(W / 2 - 40, H - 20); x.lineTo(W / 2 + 40, H - 20); x.closePath(); x.fill();
      });
      const bMat = new THREE.MeshStandardMaterial({ map: bannerTex, emissiveMap: bannerTex, emissive: 0xffffff, emissiveIntensity: 0.32, roughness: 0.85, side: THREE.DoubleSide });
      bMat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = this.timeU;
        shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
float sway = (1.0 - uv.y);
transformed.z += (sin(uTime * 1.7 + position.y * 0.32) * 0.55 + sin(uTime * 3.1 + position.y * 0.9) * 0.14) * sway;
transformed.x += sin(uTime * 1.3 + position.y * 0.2) * 0.18 * sway;`);
      };
      bMat.customProgramCacheKey = () => 'banner-wave';
      for (const sx of [-1, 1]) { const b = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 24, 4, 14), bMat); b.position.set(cx + sx * 14, 36, cz + 9.7); scene.add(b); darkBox(cx + sx * 14, 48.4, cz + 9.7, 7.2, 0.5, 0.7, 0.35); }
    }
    // monumental Judge statues flanking the approach
    for (const sx of [-1, 1]) {
      const x0 = cx + sx * 21, z0 = cz + 27;
      stone(new THREE.BoxGeometry(7.5, 2.4, 7.5), x0, 1.2, z0, 0.95); stone(new THREE.BoxGeometry(6.2, 1.2, 6.2), x0, 3.0, z0, 1.05);
      // (the statue figure itself is the real hero model, cast in gold: see js/hallstatues.js)
      glow.push({ x: x0, y: 9, z: z0 + 3, c: [1.0, 0.8, 0.45], s: 18, blink: 0, a: 0.12 });
      addBox({ minX: x0 - 3.2, maxX: x0 + 3.2, minZ: z0 - 3.2, maxZ: z0 + 3.2, h: 3.6 });
    }
    if (stoneG.length) scene.add(new THREE.Mesh(mergeGeometries(stoneG), new THREE.MeshBasicMaterial({ vertexColors: true })));
    if (goldG.length) { const gm = new THREE.Mesh(mergeGeometries(goldG), new THREE.MeshStandardMaterial({ color: 0xffd25a, metalness: 0.85, roughness: 0.35, emissive: 0x8a6a10, emissiveIntensity: 0.8 })); gm.castShadow = true; scene.add(gm); }
    // glowing vertical edges on the tower and the main block
    for (const [ex, ez, y0, hh] of [[-15.2, cz - 24.2, 60, 100], [15.2, cz - 24.2, 60, 100], [-15.2, cz + 0.2, 60, 100], [15.2, cz + 0.2, 60, 100], [-28.4, cz + 8.4, 0, 60], [28.4, cz + 8.4, 0, 60]]) neonBox(cx + ex, y0 + hh / 2, ez, 0.5, hh, 0.5, 0xffc040, 1.5);
    // golden eagle statue on top
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc23a, metalness: 1, roughness: 0.28, emissive: 0x6a4a00, emissiveIntensity: 0.6 });
    const eagle = makeEagle(gold, 80, 14);
    eagle.position.set(cx, 162, cz - 12); scene.add(eagle);
    glow.push({ x: cx, y: 175, z: cz - 12, c: [1.4, 1.0, 0.3], s: 70, blink: 0, a: 0.18 });
    // giant JUSTICE sign
    signQuad(cx, 48, cz + 8.4, 38, 19, 0, 0);
    // flood lights up
    for (const x of [-26, 26]) glow.push({ x: cx + x, y: 2, z: cz + 20, c: [1, 0.9, 0.6], s: 14, blink: 0 });
    this.hallPos.set(cx, 0, cz);
    this.spawnPos.set(cx, 0, cz + 24);
  },

  buildGlow(scene, list) {
    const n = list.length;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 4), size = new Float32Array(n), blink = new Float32Array(n);
    list.forEach((g, i) => {
      pos.set([g.x, g.y, g.z], i * 3); col.set([g.c[0], g.c[1], g.c[2], g.a ?? 1], i * 4); size[i] = g.s; blink[i] = g.blink ? g.blink + Math.random() * 10 : 0;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('col', new THREE.BufferAttribute(col, 4));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('blink', new THREE.BufferAttribute(blink, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { time: { value: 0 }, scale: { value: 800 } },
      vertexShader: `attribute float size; attribute vec4 col; attribute float blink; varying vec4 vC; uniform float time; uniform float scale;
        void main(){ vC = col; if (blink > 0.0) { float f = fract((time + blink) * (blink < 2.0 ? 0.55 : 1.7)); vC.a *= (blink < 2.0 ? step(f, 0.18) : 0.6 + 0.4*sin(time*9.0+blink)); }
          vec4 mv = modelViewMatrix*vec4(position,1.0); float dist = max(1.0,-mv.z); gl_PointSize = min(size*scale/dist, 160.0); vC.a *= smoothstep(4.0, 22.0, dist); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `varying vec4 vC; void main(){ vec2 c = gl_PointCoord-0.5; float d=length(c)*2.0; float a = pow(max(0.0,1.0-d),2.2); gl_FragColor = vec4(vC.rgb*1.4, vC.a*a); if(gl_FragColor.a<0.004) discard; }`,
    });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 8; scene.add(pts);
    this.glowMat = mat;
  },

  buildPools(scene, lamps) {
    const [c, x] = makeCanvas(128, 128);
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.5, 'rgba(255,255,255,0.25)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const mat = new THREE.MeshBasicMaterial({ map: canvasTex(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.18 });
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, lamps.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    lamps.forEach((l, i) => { p.set(l.x, 0.06, l.z); s.set(l.r * 2, 1, l.r * 2); m.compose(p, q, s); mesh.setMatrixAt(i, m); mesh.setColorAt(i, l.c); });
    mesh.frustumCulled = false; mesh.renderOrder = 3; scene.add(mesh); (this.mirrorHide ||= []).push(mesh);
  },

  buildSmears(scene, list) {
    const n = list.length;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry(); geo.index = base.index; geo.setAttribute('position', base.attributes.position); geo.setAttribute('uv', base.attributes.uv);
    const iPos = new Float32Array(n * 3), iCol = new Float32Array(n * 4), iSize = new Float32Array(n * 2);
    list.forEach((s, i) => { iPos.set([s.x, 0, s.z], i * 3); iCol.set([s.c.r, s.c.g, s.c.b, s.a ?? 0.5], i * 4); iSize.set([s.w, s.l], i * 2); });
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3)); geo.setAttribute('iCol', new THREE.InstancedBufferAttribute(iCol, 4)); geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(iSize, 2));
    geo.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { time: this.timeU },
      vertexShader: `attribute vec3 iPos; attribute vec4 iCol; attribute vec2 iSize; varying vec2 vUv; varying vec4 vCol;
        void main(){
          vec2 toCam = cameraPosition.xz - iPos.xz; float dist = length(toCam); vec2 dir = toCam / max(dist, 0.001); vec2 perp = vec2(-dir.y, dir.x);
          float camH = max(cameraPosition.y, 1.2);
          float lenM = iSize.y * clamp(dist / (camH * 6.0), 0.4, 1.7);
          vec3 p = vec3(iPos.x, 0.05, iPos.z);
          p.xz += perp * position.x * iSize.x + dir * (position.y + 0.5 - 0.1) * lenM;
          vUv = uv; vCol = iCol; vCol.a *= smoothstep(280.0, 90.0, dist) * smoothstep(2.0, 10.0, dist);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `varying vec2 vUv; varying vec4 vCol; uniform float time;
        void main(){
          float along = vUv.y, across = abs(vUv.x - 0.5) * 2.0;
          float a = pow(1.0 - along, 2.2) * (1.0 - across * across);
          a *= 0.7 + 0.3 * sin(along * 40.0 - time * 2.2 + vCol.r * 9.0);
          gl_FragColor = vec4(vCol.rgb * 1.2, a * vCol.a);
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 4; scene.add(mesh); (this.mirrorHide ||= []).push(mesh);
  },

  // soft light cones under the streetlamps nearest the player: rain streaks glitter inside them
  buildCones(scene) {
    const H = 7.4;
    const geo = new THREE.ConeGeometry(4.6, H, 18, 1, true).translate(0, H / 2, 0);   // apex up at the lamp head, base on the road
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { time: this.timeU },
      vertexShader: `varying float vH; varying vec3 vW; varying vec3 vN; varying vec3 vV;
        void main(){ vec4 wp = vec4(position, 1.0);
          #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
          #endif
          wp = modelMatrix * wp; vW = wp.xyz; vH = clamp(position.y / ${H.toFixed(1)}, 0.0, 1.0);
          vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `varying float vH; varying vec3 vW; varying vec3 vN; varying vec3 vV; uniform float time;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main(){
          float fres = pow(abs(dot(normalize(vN), normalize(vV))), 1.4);
          float a = (0.12 + 0.88 * vH) * fres * 0.1;
          float col = hash(floor(vW.xz * 9.0));
          float streak = smoothstep(0.86, 1.0, col) * (0.5 + 0.5 * sin((vW.y + time * 13.0 * (0.6 + col)) * 2.6));
          a *= 1.0 + streak * 3.2;
          gl_FragColor = vec4(1.0, 0.8, 0.52, a);
        }`,
    });
    this.cones = new THREE.InstancedMesh(geo, mat, 28); this.cones.frustumCulled = false; this.cones.renderOrder = 5; this.cones.count = 0; scene.add(this.cones); (this.mirrorHide ||= []).push(this.cones);
    this.coneT = 0;
  },

  // real (dynamic) lights hopped onto the streetlamps and neon shopfronts nearest the player
  buildLights(scene) {
    this.lampLights = []; this.neonLights = [];
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffc88c, 0, 34, 2); l.userData = { cur: -1, tgt: -1, k: 0, peak: 260 }; scene.add(l); this.lampLights.push(l); }
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffffff, 0, 26, 2); l.userData = { cur: -1, tgt: -1, k: 0, peak: 150 }; scene.add(l); this.neonLights.push(l); }
    this.lightT = 0; this._cand = [];
  },
  updateLights(dt, c) {
    this.lightT -= dt;
    const pick = (src, lights, maxD, label) => {
      const cand = this._cand; cand.length = 0;
      for (let i = 0; i < src.length; i++) { const s = src[i]; const dx = s.x - c.x, dz = s.z - c.z, d2 = dx * dx + dz * dz; if (d2 < maxD * maxD) cand.push([d2, i]); }
      cand.sort((a, b) => a[0] - b[0]);
      const want = cand.slice(0, lights.length).map((e) => e[1]);
      for (const l of lights) if (l.userData.tgt >= 0 && !want.includes(l.userData.tgt)) l.userData.tgt = -1;   // drop lamps that fell out of range
      for (const idx of want) { if (lights.some((l) => l.userData.tgt === idx)) continue; const free = lights.find((l) => l.userData.tgt === -1 && (l.userData.cur === -1 || l.userData.k <= 0.01)) || lights.find((l) => l.userData.tgt === -1); if (free) free.userData.tgt = idx; }
    };
    if (this.lightT <= 0) { this.lightT = 0.3; pick(this.lamps, this.lampLights, 60); pick(this.neonSrc, this.neonLights, 45); }
    const step = (l, src, heightY, isNeon) => {
      const u = l.userData;
      if (u.tgt !== u.cur) { u.k -= dt * 7; if (u.k <= 0) { u.k = 0; u.cur = u.tgt; if (u.cur >= 0) { const s = src[u.cur]; l.position.set(s.x, isNeon ? s.y : heightY, s.z); if (isNeon) l.color.copy(s.c); } } }
      else if (u.cur >= 0) u.k = Math.min(1, u.k + dt * 7);
      l.intensity = u.cur >= 0 ? u.peak * u.k * (isNeon ? 1 : 1) : 0;
    };
    for (const l of this.lampLights) step(l, this.lamps, 7.4, false);
    for (const l of this.neonLights) step(l, this.neonSrc, 0, true);
    // cones
    this.coneT -= dt;
    if (this.coneT <= 0 && this.cones) {
      this.coneT = 0.5;
      const cand = this._cand; cand.length = 0;
      for (let i = 0; i < this.lamps.length; i++) { const s = this.lamps[i]; const dx = s.x - c.x, dz = s.z - c.z, d2 = dx * dx + dz * dz; if (d2 < 70 * 70) cand.push([d2, i]); }
      cand.sort((a, b) => a[0] - b[0]);
      const m = new THREE.Matrix4(); const n = Math.min(28, cand.length);
      for (let k = 0; k < n; k++) { const s = this.lamps[cand[k][1]]; m.makeTranslation(s.x, 0, s.z); this.cones.setMatrixAt(k, m); }
      this.cones.count = n; this.cones.instanceMatrix.needsUpdate = true;
    }
  },

  // power / phone cables sagging across the streets between tall facades
  buildCables(scene, edgeH) {
    const pts = []; const V = (x, y, z) => pts.push(x, y, z);
    const seg = 12;
    const cable = (x0, y0, z0, x1, y1, z1, sag) => {
      for (let i = 0; i < seg; i++) {
        const t0 = i / seg, t1 = (i + 1) / seg, s0 = 4 * t0 * (1 - t0) * sag, s1 = 4 * t1 * (1 - t1) * sag;
        V(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0 - s0, z0 + (z1 - z0) * t0); V(x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1 - s1, z0 + (z1 - z0) * t1);
      }
    };
    for (let q = 0; q < 700; q++) {
      const i = randInt(0, N - 2), j = randInt(0, N - 1), lim = Math.min(edgeH[`${i},${j}`] || 0, edgeH[`${i + 1},${j}`] || 0);
      if (lim < 22) continue;
      const k = i + 1, z = blockC(j) + rand(-30, 30), y = rand(12, Math.min(40, lim - 4));
      cable(roadX(k) - ROAD / 2 - 4, y, z, roadX(k) + ROAD / 2 + 4, y + rand(-2, 2), z + rand(-3, 3), rand(0.8, 2.6));
    }
    for (let q = 0; q < 700; q++) {
      const i = randInt(0, N - 1), j = randInt(0, N - 2), lim = Math.min(edgeH[`${i},${j}`] || 0, edgeH[`${i},${j + 1}`] || 0);
      if (lim < 22) continue;
      const k = j + 1, x = blockC(i) + rand(-30, 30), y = rand(12, Math.min(40, lim - 4));
      cable(x, y, roadX(k) - ROAD / 2 - 4, x + rand(-3, 3), y + rand(-2, 2), roadX(k) + ROAD / 2 + 4, rand(0.8, 2.6));
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x06060a })); lines.frustumCulled = false; scene.add(lines);
  },

  // sweeping searchlights from the Hall of Justice
  buildSearchlights(scene) {
    const geo = new THREE.CylinderGeometry(14, 3, 520, 16, 1, true).translate(0, 260, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      vertexShader: 'varying float vH; varying vec3 vN; varying vec3 vV; void main(){ vH = position.y / 520.0; vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }',
      fragmentShader: 'varying float vH; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.6); gl_FragColor = vec4(0.75, 0.85, 1.0, f * (1.0 - vH * 0.7) * 0.075); }',
    });
    this.searchlights = [];
    const hall = this.hallPos;
    for (const [dx, y, dz, ph] of [[-32, 38, -18, 0], [32, 38, -18, 2], [-14, 60, -12, 4], [14, 60, -12, 1]]) {
      const m = new THREE.Mesh(geo, mat); m.position.set(hall.x + dx, y, hall.z + dz); m.frustumCulled = false; m.renderOrder = 6; scene.add(m); m.userData.ph = ph; this.searchlights.push(m);
    }
  },

  // holographic adverts floating above a scatter of intersections
  buildHolo(scene) {
    const rng = mulberry32(777), spots = [], c = N / 2;
    for (let tries = 0; tries < 600 && spots.length < 14; tries++) {
      const i = 1 + Math.floor(rng() * (N - 1)), j = 1 + Math.floor(rng() * (N - 1));
      if (Math.hypot(i - c, j - c) < 2.2 || spots.some((s) => Math.hypot(s.i - i, s.j - j) < 3)) continue;
      spots.push({ i, j, x: roadX(i), z: roadX(j), y: 40 + rng() * 12 });
    }
    this.holos = buildHolograms(scene, this.timeU, eagleShape, spots);
  },

  buildRain(scene) {
    // instanced camera-facing streaks (GL lines are 1 px and vanish at high resolution): wind-leaned, stretched along their fall, soft edged,
    // thicker and fainter with distance; the density breathes slowly (level)
    const n = 6500, size = 84;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry(); geo.index = base.index; geo.setAttribute('position', base.attributes.position); geo.setAttribute('uv', base.attributes.uv);
    const iPos = new Float32Array(n * 3), iSeed = new Float32Array(n);
    for (let i = 0; i < n; i++) { iPos.set([rand(size), rand(60), rand(size)], i * 3); iSeed[i] = Math.random(); }
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3)); geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(iSeed, 1));
    geo.instanceCount = n;
    this.rainLevel = 0.3;
    this.rainMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { time: { value: 0 }, cam: { value: new THREE.Vector3() }, size: { value: size }, level: { value: this.rainLevel } },
      vertexShader: `attribute vec3 iPos; attribute float iSeed; uniform float time; uniform vec3 cam; uniform float size; uniform float level; varying float vA; varying vec2 vUv;
        float h1(float x){ return fract(sin(x * 91.3458) * 47453.5453); }
        void main(){
          vUv = uv;
          if (iSeed > level) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }
          float speed = 30.0 + 16.0 * h1(iSeed);
          float H = 60.0;
          vec3 p = iPos; p.y = mod(p.y - time * speed, H); p.x += time * 2.2;
          vec3 w = cam + (mod(p - cam + vec3(size * 0.5, 30.0, size * 0.5), vec3(size, H, size)) - vec3(size * 0.5, 30.0, size * 0.5));
          w.y = max(0.0, w.y);
          vec3 toCam = cam - w; float dist = length(toCam); toCam /= max(dist, 1e-3);
          vec3 vel = normalize(vec3(-0.13, -1.0, 0.02));
          vec3 side = normalize(cross(vel, toCam));
          float len = 0.7 + 0.9 * h1(iSeed + 3.1);
          float width = (0.022 + 0.022 * h1(iSeed + 7.7)) * (1.0 + dist * 0.05);
          vec3 wp = w + side * (position.x * width) - vel * ((position.y + 0.5) * len);
          vA = (0.62 - 0.2 * h1(iSeed + 1.7)) * (1.0 - smoothstep(26.0, 52.0, dist)) * smoothstep(2.2, 8.0, dist) / (1.0 + dist * 0.012);
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: 'varying float vA; varying vec2 vUv; void main(){ float e = 1.0 - pow(abs(vUv.x * 2.0 - 1.0), 1.6); float t = 0.25 + 0.75 * vUv.y; gl_FragColor = vec4(vec3(0.62, 0.74, 1.0) * 1.1, vA * e * t); }',
    });
    const rain = new THREE.Mesh(geo, this.rainMat); rain.frustumCulled = false; rain.renderOrder = 7; scene.add(rain); (this.mirrorHide ||= []).push(rain);
  },

  buildFlyers(scene) {
    const n = 140;
    this.flyers = [];
    const pos = new Float32Array(n * 3 * 2), col = new Float32Array(n * 4 * 2), size = new Float32Array(n * 2), blink = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const lane = randInt(0, 5), horiz = chance(0.5);
      this.flyers.push({ y: 50 + lane * 28 + rand(-6, 6), off: rand(-HALF, HALF), t: rand(-HALF * 1.4, HALF * 1.4), speed: rand(30, 70) * (chance(0.5) ? 1 : -1), horiz, hue: Math.random() });
      col.set([1, 0.95, 0.85, 1], i * 8); col.set([1, 0.08, 0.05, 0.9], i * 8 + 4); size[i * 2] = 7; size[i * 2 + 1] = 6;
    }
    const geo = new THREE.BufferGeometry();
    this.flyPos = pos;
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('col', new THREE.BufferAttribute(col, 4)); geo.setAttribute('size', new THREE.BufferAttribute(size, 1)); geo.setAttribute('blink', new THREE.BufferAttribute(blink, 1));
    const pts = new THREE.Points(geo, this.glowMat); pts.frustumCulled = false; pts.renderOrder = 8; scene.add(pts);
    this.flyGeo = geo;
  },

  // district atmosphere: bilinear blend between the nine district centres (each district is 5 blocks wide); k = how far to move toward the target this call
  updateAir(center, k) {
    const u = clamp((center.x + HALF) / (S * 5) - 0.5, 0, 2), v = clamp((center.z + HALF) / (S * 5) - 0.5, 0, 2);
    const i0 = Math.min(1, Math.floor(u)), j0 = Math.min(1, Math.floor(v)), fu = u - i0, fv = v - j0;
    const at = (i, j) => AIR[j][i];
    const lerpCol = (idx, out) => { _ac.setHex(at(i0, j0)[idx]).lerp(_bc.setHex(at(i0 + 1, j0)[idx]), fu); const top = _ac.clone(); _ac.setHex(at(i0, j0 + 1)[idx]).lerp(_bc.setHex(at(i0 + 1, j0 + 1)[idx]), fu); out.copy(top.lerp(_ac, fv)); };
    const blend3 = (a, b, c) => { const t = mix3(a, b, fu), s = mix3(c.a, c.b, fu); return mix3(t, s, fv); };
    const rgb = (e, o) => [e[o], e[o + 1], e[o + 2]];
    const A = at(i0, j0), B = at(i0 + 1, j0), C = at(i0, j0 + 1), D = at(i0 + 1, j0 + 1);
    const hor = blend3(rgb(A, 0), rgb(B, 0), { a: rgb(C, 0), b: rgb(D, 0) }), mid = blend3(rgb(A, 3), rgb(B, 3), { a: rgb(C, 3), b: rgb(D, 3) }), tint = blend3(A[8], B[8], { a: C[8], b: D[8] });
    this.skyMat.uniforms.uHor.value.lerp(_ac.setRGB(hor[0], hor[1], hor[2]), k); this.skyMat.uniforms.uMid.value.lerp(_ac.setRGB(mid[0], mid[1], mid[2]), k);
    lerpCol(6, _bc); this.scene.fog.color.lerp(_bc, k);
    lerpCol(7, _bc); this.hemiBase = this.hemiBase || new THREE.Color(); this.hemiBase.lerp(_bc, k); this.hemi.color.copy(this.hemiBase);
    if (G.gradeTint) G.gradeTint.value.set(tint[0], tint[1], tint[2]);
  },

  update(dt, center) {
    const t = G.time;
    this.skyMat.uniforms.time.value = t;
    this.glowMat.uniforms.time.value = t;
    this.rainMat.uniforms.time.value = t;
    this.timeU.value = t;
    this.updateLights(dt, center);
    for (const s of this.searchlights) { s.rotation.y = t * 0.22 + s.userData.ph; s.rotation.z = 0.32 + 0.18 * Math.sin(t * 0.31 + s.userData.ph * 1.7); }
    this.rainMat.uniforms.cam.value.copy(G.camera.position);
    this.updateAir(center, Math.min(1, dt * 0.8));
    for (const h of this.holos) h.rotation.y = Math.atan2(G.camera.position.x - h.position.x, G.camera.position.z - h.position.z);
    this.rainLevel = 0.3 + 0.2 * Math.sin(t * 0.045) + 0.12 * Math.sin(t * 0.13 + 1.7) + this.lightning * 0.25; this.rainMat.uniforms.level.value = clamp(this.rainLevel, 0.12, 0.75);
    this.sun.position.set(center.x - 50, 130, center.z - 30);
    this.sun.target.position.copy(center);
    // flyers
    const p = this.flyPos;
    this.flyers.forEach((f, i) => {
      f.t += f.speed * dt; if (Math.abs(f.t) > HALF * 1.5) f.t = -Math.sign(f.speed) * HALF * 1.5;
      const x = f.horiz ? f.t : f.off, z = f.horiz ? f.off : f.t;
      const dir = Math.sign(f.speed);
      p[i * 6] = x; p[i * 6 + 1] = f.y; p[i * 6 + 2] = z;
      p[i * 6 + 3] = x - (f.horiz ? dir * 5 : 0); p[i * 6 + 4] = f.y; p[i * 6 + 5] = z - (f.horiz ? 0 : dir * 5);
    });
    this.flyGeo.attributes.position.needsUpdate = true;
    // lightning
    this.lightningT -= dt;
    if (this.lightningT <= 0) {
      this.lightning = 1; this.lightningT = rand(9, 26); audio.thunder(); if (chance(0.5)) this.lightningT = 0.25;
      // a bolt in the sky ahead of the camera: ~700 m out, streaking down from the cloud base
      const cam = G.camera.position, fwd = tmpDir.set(0, 0, -1).applyQuaternion(G.camera.quaternion); const yaw = Math.atan2(fwd.x, fwd.z) + rand(-0.6, 0.6), dist = 700;
      const e0 = rand(0.56, 0.78), e1 = rand(0.1, 0.28), y2 = yaw + rand(-0.12, 0.12);
      fx.bolt(new THREE.Vector3(cam.x + Math.sin(yaw) * dist, Math.tan(e0) * dist, cam.z + Math.cos(yaw) * dist), new THREE.Vector3(cam.x + Math.sin(y2) * dist, Math.tan(e1) * dist, cam.z + Math.cos(y2) * dist), 0xcfe0ff, rand(0.22, 0.38));
    }
    this.lightning = Math.max(0, this.lightning - dt * 3.5);
    const fl = this.lightning * (0.6 + 0.4 * Math.sin(t * 60));
    this.skyMat.uniforms.flash.value = fl;
    this.hemi.intensity = 0.55 + fl * 1.6;
    this.sun.intensity = 0.5 + fl * 1.5;
    // steam vents + rain splashes near the player
    this.ventT -= dt;
    if (this.ventT <= 0) {
      this.ventT = 0.12;
      for (const v of this.vents) if (Math.abs(v.x - center.x) < 70 && Math.abs(v.z - center.z) < 70) fx.smokePuff(v, 1, 1.6, 2.2, 0.35, 2.4);
    }
    const splashes = Math.round(2 + this.rainLevel * 4);
    for (let i = 0; i < splashes; i++) fx.rain(new THREE.Vector3(center.x + rand(-22, 22), 0.1, center.z + rand(-22, 22)));
  },
};

// ---------- eagle emblem (shared by Hall of Justice, pauldron, bike) ----------
export function eagleShape() {
  const half = [[0, 0.95], [0.07, 0.9], [0.1, 0.78], [0.27, 0.86], [0.55, 0.98], [0.92, 1.02], [0.86, 0.88], [0.97, 0.8], [0.82, 0.72], [0.9, 0.62],
    [0.72, 0.56], [0.76, 0.45], [0.55, 0.4], [0.5, 0.3], [0.3, 0.25], [0.18, 0.2], [0.22, 0.04], [0.12, -0.12], [0, -0.2]];
  const s = new THREE.Shape();
  s.moveTo(half[0][0], half[0][1]);
  for (let i = 1; i < half.length; i++) s.lineTo(half[i][0], half[i][1]);
  for (let i = half.length - 2; i >= 1; i--) s.lineTo(-half[i][0], half[i][1]);
  s.closePath();
  return s;
}
export function makeEagle(mat, width = 2, depth = 0.3) {
  const geo = new THREE.ExtrudeGeometry(eagleShape(), { depth, bevelEnabled: true, bevelThickness: depth * 0.12, bevelSize: 0.02, bevelSegments: 1 });
  geo.translate(0, -0.4, -depth / 2); geo.scale(width / 2, width / 2, 1);
  const m = new THREE.Mesh(geo, mat); m.castShadow = true; return m;
}
