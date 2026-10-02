import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G } from './state.js';
import { fx } from './fx.js';
import { audio } from './audio.js';
import { rand, randInt, pick, chance, clamp, mulberry32, segAABB, makeCanvas, canvasTex } from './util.js';
import * as TX from './textures.js';

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
  N, S, ROAD, HALF, boxes,
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
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x0b0714);
    const envCols = [0xff2ea6, 0x40e0ff, 0xffa030, 0xffffff, 0x7a40ff, 0xff3030];
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(rand(6, 16), rand(4, 20)), new THREE.MeshBasicMaterial({ color: new THREE.Color(envCols[i % envCols.length]).multiplyScalar(rand(2, 6)), side: THREE.DoubleSide }));
      const a = (i / 24) * Math.PI * 2; m.position.set(Math.cos(a) * 30, rand(-4, 22), Math.sin(a) * 30); m.lookAt(0, 4, 0); envScene.add(m);
    }
    const top = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshBasicMaterial({ color: 0x2a1840 })); top.position.y = 40; top.rotation.x = Math.PI / 2; envScene.add(top);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(envScene, 0.03).texture;
    scene.environmentIntensity = 0.4;
    pm.dispose();

    // ===== sky & fog =====
    scene.background = new THREE.Color(0x120a1c);
    scene.fog = new THREE.FogExp2(0x1c1030, 0.0026);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { time: { value: 0 }, flash: { value: 0 } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
      fragmentShader: `varying vec3 vP; uniform float time; uniform float flash;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        void main(){
          vec3 d = normalize(vP); float y = d.y;
          vec3 hor = vec3(0.55,0.2,0.28), mid = vec3(0.12,0.05,0.2), top = vec3(0.025,0.02,0.07);
          vec3 c = mix(hor, mid, smoothstep(-0.05,0.35,y)); c = mix(c, top, smoothstep(0.3,0.9,y));
          vec2 uv = d.xz/(abs(y)+0.35)*2.0 + vec2(time*0.01, 0.0);
          float cl = n(uv*2.0)*0.5 + n(uv*5.0)*0.3 + n(uv*11.0)*0.2;
          c *= 0.55 + cl*0.9;
          c += vec3(0.4,0.4,0.6)*flash*(0.3+cl);
          gl_FragColor = vec4(c,1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), this.skyMat);
    sky.renderOrder = -10; scene.add(sky); this.sky = sky;

    // ===== lights =====
    this.hemi = new THREE.HemisphereLight(0x5a4a9a, 0x2a1a30, 0.55); scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0x8aa0ff, 0.9);
    this.sun.position.set(-60, 120, -40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 400;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.5;
    scene.add(this.sun, this.sun.target);

    // ===== textures & materials =====
    const facMats = [0, 1, 2, 3].map((v) => {
      const [map, em] = TX.makeFacade(v);
      return new THREE.MeshStandardMaterial({ map, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: [0.85, 0.95, 0.95, 0.85][v], roughness: 0.78, metalness: 0.25, vertexColors: true });
    });
    const [roadMap, roadRough] = TX.makeRoad();
    const roadMat = new THREE.MeshStandardMaterial({ map: roadMap, roughnessMap: roadRough, roughness: 1, metalness: 0.5, envMapIntensity: 1.6 });
    const [intMap, intRough] = TX.makeIntersection();
    const intMat = new THREE.MeshStandardMaterial({ map: intMap, roughnessMap: intRough, roughness: 1, metalness: 0.5, envMapIntensity: 1.6 });
    const swTex = TX.makeSidewalk(); swTex.repeat.set(BLOCK / 8, BLOCK / 8);
    const swMat = new THREE.MeshStandardMaterial({ map: swTex, roughness: 0.55, metalness: 0.3 });
    const grassTex = TX.makeGrass(); grassTex.repeat.set(10, 10);
    const grassMat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95 });
    const signTex = TX.makeSignAtlas();
    const signMat = new THREE.MeshBasicMaterial({ map: signTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, color: new THREE.Color(1.6, 1.6, 1.6) });
    this.signMat = signMat;
    const neonMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.5, metalness: 0.8 });

    // ===== accumulators =====
    const wallG = [[], [], [], []];
    const neonG = [];
    const signG = [];
    const metalG = [];
    const glow = []; // {x,y,z,r,g,b,size,blink}
    const lampPos = [];
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
      tint.setHSL(R(0.55, 0.78), R(0.05, 0.3), R(0.5, 1.0)); colorize(g, tint);
      wallG[variant].push(g);
    };
    const neonBox = (x, y, z, w, h, d, color, k = 2.2) => {
      const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z);
      tint.set(color).multiplyScalar(k); colorize(g, tint); neonG.push(g);
    };
    const metalBox = (x, y, z, w, h, d) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); tint.setScalar(1); colorize(g, tint); metalG.push(g); };
    const signQuad = (x, y, z, w, h, ry, idx) => {
      const g = new THREE.PlaneGeometry(w, h);
      const uv = g.attributes.uv;
      const col = idx % TX.SIGN_COLS, row = Math.floor(idx / TX.SIGN_COLS);
      for (let k = 0; k < 4; k++) uv.setXY(k, (col + uv.getX(k)) / TX.SIGN_COLS, 1 - (row + 1 - uv.getY(k)) / TX.SIGN_ROWS);
      g.rotateY(ry); g.translate(x, y, z); signG.push(g);
    };

    // ===== roads =====
    const roadGs = [], intGs = [];
    for (let k = 0; k <= N; k++) {
      for (let b = 0; b < N; b++) {
        // vertical road (x = roadX(k)) along block b
        let g = new THREE.PlaneGeometry(ROAD, BLOCK); g.rotateX(-Math.PI / 2);
        let uv = g.attributes.uv; for (let q = 0; q < 4; q++) uv.setY(q, uv.getY(q) * BLOCK / ROAD);
        g.translate(roadX(k), 0.0, blockC(b)); roadGs.push(g);
        // horizontal road
        g = new THREE.PlaneGeometry(ROAD, BLOCK); g.rotateX(-Math.PI / 2);
        uv = g.attributes.uv; for (let q = 0; q < 4; q++) uv.setY(q, uv.getY(q) * BLOCK / ROAD);
        g.rotateY(Math.PI / 2); g.translate(blockC(b), 0.0, roadX(k)); roadGs.push(g);
      }
      for (let m = 0; m <= N; m++) { const g = new THREE.PlaneGeometry(ROAD, ROAD); g.rotateX(-Math.PI / 2); g.translate(roadX(k), 0.002, roadX(m)); intGs.push(g); }
    }
    const roadMesh = new THREE.Mesh(mergeGeometries(roadGs), roadMat); roadMesh.receiveShadow = true; scene.add(roadMesh);
    const intMesh = new THREE.Mesh(mergeGeometries(intGs), intMat); intMesh.receiveShadow = true; scene.add(intMesh);
    const base = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x08080c, roughness: 0.9 }));
    base.position.y = -0.1; base.receiveShadow = true; scene.add(base);

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
        neonBox(tcx, top + 0.3, tcz, tw + 0.6, 0.5, td + 0.6, RP(this.palette(cx, cz)), 1.6);
        top += th;
      }
      // roof gear
      if (h > 30) {
        const ah = R(6, h > 120 ? 40 : 14);
        metalBox(tcx + R(-1, 1) * tw * 0.25, top + ah / 2, tcz + R(-1, 1) * td * 0.25, 0.5, ah, 0.5);
        glow.push({ x: tcx, y: top + ah + 0.5, z: tcz, c: [1.0, 0.1, 0.1], s: 7, blink: 1 });
        for (let q = 0; q < 2; q++) metalBox(tcx + R(-1, 1) * tw * 0.3, top + 1.2, tcz + R(-1, 1) * td * 0.3, R(2, 5), 2.4, R(2, 5));
      }
      // vertical neon edges on tall towers
      if (h > 60 && chance(0.6)) {
        const col = RP(this.palette(cx, cz)); const hh = h * R(0.4, 0.95);
        for (const [sx, sz] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) if (chance(0.5)) neonBox(cx + sx * (w / 2 + 0.15), hh / 2, cz + sz * (d / 2 + 0.15), 0.4, hh, 0.4, col, 2.0);
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
        glow.push({ x: pos[0] + nx * 2, y: sy, z: pos[1] + nz * 2, c: [0.6, 0.5, 0.6], s: sw * 1.1, blink: 0, a: 0.25 });
        if (sy < 14) { // street-level light pool of the sign
          lampPos.push({ x: pos[0] + nx * 5, z: pos[1] + nz * 5, c: new THREE.Color().setHSL(R(), 0.8, 0.45), r: 8 });
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
        this.buildHall(cx, cz, { building, neonBox, metalBox, signQuad, glow, addBox, scene, colorize, metalG, neonG, tint });
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
    const lampHead = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.25, 0.7).translate(0, 7.6, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.85, 0.6).multiplyScalar(2.5), toneMapped: false }), lampMatrix.length);
    const m4 = new THREE.Matrix4();
    lampMatrix.forEach(([x, z], idx) => {
      m4.makeTranslation(x, 0, z); lampPole.setMatrixAt(idx, m4); lampHead.setMatrixAt(idx, m4);
      glow.push({ x, y: 7.6, z, c: [1, 0.78, 0.5], s: 9, blink: 0, a: 0.8 });
      if (idx % 2 === 0) lampPos.push({ x, z, c: new THREE.Color(1, 0.7, 0.4), r: 14 });
    });
    scene.add(lampPole, lampHead);

    // ===== merge & add meshes =====
    const sw = new THREE.Mesh(mergeGeometries(swGs), swMat); sw.receiveShadow = true; scene.add(sw);
    // sidewalk uv: BoxGeometry uv 0..1 per face; repeat set on texture handles tiling
    if (grassGs.length) { const m = new THREE.Mesh(mergeGeometries(grassGs), grassMat); m.receiveShadow = true; scene.add(m); }
    wallG.forEach((arr, v) => {
      if (!arr.length) return;
      const m = new THREE.Mesh(mergeGeometries(arr), facMats[v]); m.castShadow = true; m.receiveShadow = true; scene.add(m);
    });
    if (neonG.length) scene.add(new THREE.Mesh(mergeGeometries(neonG), neonMat));
    if (metalG.length) { const m = new THREE.Mesh(mergeGeometries(metalG), new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x2a2d36, roughness: 0.5, metalness: 0.7 })); m.castShadow = true; m.receiveShadow = true; scene.add(m); }
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
    const { building, neonBox, metalBox, signQuad, glow, addBox, scene, colorize, metalG, tint } = h;
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
    // columns
    for (let q = -3; q <= 3; q++) {
      const g = new THREE.CylinderGeometry(1.3, 1.5, 34, 10); g.translate(cx + q * 8, 17, cz + 10.5); tint.setScalar(1.6); colorize(g, tint); metalG.push(g);
    }
    // steps
    metalBox(cx, 0.5, cz + 16, 60, 1, 6);
    // golden eagle statue on top
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc23a, metalness: 1, roughness: 0.28, emissive: 0x6a4a00, emissiveIntensity: 0.6 });
    const eagle = makeEagle(gold, 80, 14);
    eagle.position.set(cx, 162, cz - 12); scene.add(eagle);
    glow.push({ x: cx, y: 175, z: cz - 12, c: [1.4, 1.0, 0.3], s: 90, blink: 0, a: 0.35 });
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
          vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = size*scale/max(1.0,-mv.z); gl_Position = projectionMatrix*mv; }`,
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
    const mat = new THREE.MeshBasicMaterial({ map: canvasTex(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.32 });
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, lamps.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    lamps.forEach((l, i) => { p.set(l.x, 0.06, l.z); s.set(l.r * 2, 1, l.r * 2); m.compose(p, q, s); mesh.setMatrixAt(i, m); mesh.setColorAt(i, l.c); });
    mesh.frustumCulled = false; mesh.renderOrder = 3; scene.add(mesh);
  },

  buildRain(scene) {
    const n = 5000, size = 90;
    const pos = new Float32Array(n * 2 * 3), end = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = rand(size), y = rand(60), z = rand(size);
      pos.set([x, y, z, x, y, z], i * 6); end[i * 2] = 0; end[i * 2 + 1] = 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('end', new THREE.BufferAttribute(end, 1));
    this.rainMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { time: { value: 0 }, cam: { value: new THREE.Vector3() }, size: { value: size } },
      vertexShader: `attribute float end; uniform float time; uniform vec3 cam; uniform float size; varying float vA;
        void main(){
          vec3 p = position; float H = 60.0;
          p.y = mod(p.y - time*42.0, H) ;
          p.x += time*3.0;
          vec3 w = cam + (mod(p - cam + vec3(size*0.5, 30.0, size*0.5), vec3(size, H, size)) - vec3(size*0.5, 30.0, size*0.5));
          w.y = max(0.0, w.y) ;
          w += end * vec3(-0.15, 1.6, 0.0);
          vA = 0.35 * (1.0 - end*0.6);
          gl_Position = projectionMatrix * viewMatrix * vec4(w,1.0);
        }`,
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(0.6,0.75,1.0,vA); }',
    });
    const rain = new THREE.LineSegments(geo, this.rainMat); rain.frustumCulled = false; rain.renderOrder = 7; scene.add(rain);
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

  update(dt, center) {
    const t = G.time;
    this.skyMat.uniforms.time.value = t;
    this.glowMat.uniforms.time.value = t;
    this.rainMat.uniforms.time.value = t;
    this.rainMat.uniforms.cam.value.copy(G.camera.position);
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
    if (this.lightningT <= 0) { this.lightning = 1; this.lightningT = rand(9, 26); audio.thunder(); if (chance(0.5)) this.lightningT = 0.25; }
    this.lightning = Math.max(0, this.lightning - dt * 3.5);
    const fl = this.lightning * (0.6 + 0.4 * Math.sin(t * 60));
    this.skyMat.uniforms.flash.value = fl;
    this.hemi.intensity = 0.55 + fl * 1.6;
    this.sun.intensity = 0.9 + fl * 1.5;
    // steam vents + rain splashes near the player
    this.ventT -= dt;
    if (this.ventT <= 0) {
      this.ventT = 0.12;
      for (const v of this.vents) if (Math.abs(v.x - center.x) < 70 && Math.abs(v.z - center.z) < 70) fx.smokePuff(v, 1, 1.6, 2.2, 0.35, 2.4);
    }
    for (let i = 0; i < 10; i++) fx.rain(new THREE.Vector3(center.x + rand(-30, 30), 0.1, center.z + rand(-30, 30)));
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
