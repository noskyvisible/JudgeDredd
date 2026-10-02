import * as THREE from 'three';
import { makeCanvas, canvasTex, mulberry32 } from './util.js';

// ---------------------------------------------------------------------------
// Street-level holographic adverts: tall flickering panels floating above intersections, fed by a
// faint light shaft from an emitter pad in the road.  Four adverts live in one canvas atlas; the shader adds
// scanlines, glitch bands, a sweeping highlight and edge fade.  Panels turn to face the camera (about Y).
// ---------------------------------------------------------------------------

const CW = 256, CH = 384;

function frameBrackets(x, w, h) {
  x.strokeStyle = 'rgba(255,255,255,0.95)'; x.lineWidth = 5; x.lineCap = 'square';
  const L = 34, m = 10;
  for (const [cx, cy, sx, sy] of [[m, m, 1, 1], [CW - m, m, -1, 1], [m, CH - m, 1, -1], [CW - m, CH - m, -1, -1]]) {
    x.beginPath(); x.moveTo(cx, cy + sy * L); x.lineTo(cx, cy); x.lineTo(cx + sx * L, cy); x.stroke();
  }
}
const label = (x, text, y, size = 44) => { x.font = `900 ${size}px Impact, "Arial Black", sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff'; x.fillText(text, CW / 2, y); };

function drawAtlas(eagleShape) {
  const [c, x] = makeCanvas(CW * 4, CH);
  x.clearRect(0, 0, CW * 4, CH);
  const cell = (i, fn) => { x.save(); x.translate(i * CW, 0); x.beginPath(); x.rect(0, 0, CW, CH); x.clip(); fn(); frameBrackets(x); x.restore(); };

  // 0: the Judge ("I AM THE LAW")
  cell(0, () => {
    const g = x.createLinearGradient(0, 40, 0, 300); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#8fd8ff');
    x.fillStyle = g;
    x.beginPath(); x.moveTo(46, 190); x.bezierCurveTo(40, 70, 216, 70, 210, 190); x.lineTo(206, 250); x.quadraticCurveTo(200, 300, 150, 308); x.lineTo(106, 308); x.quadraticCurveTo(56, 300, 50, 250); x.closePath(); x.fill();
    x.globalCompositeOperation = 'destination-out';           // visor slot
    x.beginPath(); x.moveTo(60, 166); x.lineTo(196, 166); x.lineTo(190, 208); x.lineTo(66, 208); x.closePath(); x.fill();
    x.fillRect(100, 262, 56, 5); x.fillRect(100, 274, 56, 5); x.fillRect(100, 286, 56, 5);   // chin vents
    x.globalCompositeOperation = 'source-over';
    x.fillStyle = 'rgba(255,60,60,0.9)'; x.beginPath(); x.moveTo(66, 170); x.lineTo(190, 170); x.lineTo(186, 202); x.lineTo(70, 202); x.closePath(); x.fill();
    x.fillStyle = '#ffd24a'; x.beginPath(); x.moveTo(128, 56); x.lineTo(140, 86); x.lineTo(116, 86); x.closePath(); x.fill();
    label(x, 'I AM THE', 338, 40); label(x, 'LAW', 366, 30);
  });
  // 1: eagle + JUSTICE
  cell(1, () => {
    const s = eagleShape(); const pts = s.getPoints(40);
    x.save(); x.translate(128, 190); x.scale(120, -120);
    const g = x.createLinearGradient(0, -1, 0, 1); g.addColorStop(0, '#ffe9a0'); g.addColorStop(1, '#ffb030'); x.fillStyle = g;
    x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.closePath(); x.fill(); x.restore();
    x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 4; x.strokeRect(34, 60, 188, 260);
    label(x, 'JUSTICE', 352, 52);
  });
  // 2: SLURP COLA
  cell(2, () => {
    const g = x.createLinearGradient(0, 70, 0, 300); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#ff7aa8'); x.fillStyle = g;
    x.beginPath(); x.moveTo(74, 100); x.lineTo(182, 100); x.lineTo(164, 300); x.quadraticCurveTo(128, 312, 92, 300); x.closePath(); x.fill();
    x.fillStyle = '#fff'; x.fillRect(66, 86, 124, 18);                                   // lid
    x.strokeStyle = '#fff'; x.lineWidth = 12; x.beginPath(); x.moveTo(138, 88); x.lineTo(158, 26); x.lineTo(196, 18); x.stroke();   // straw
    x.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 6; i++) { x.beginPath(); x.arc(100 + (i * 37) % 70, 140 + i * 24, 7 + (i % 3) * 3, 0, 7); x.fill(); } x.globalCompositeOperation = 'source-over';
    label(x, 'SLURP', 340, 46); label(x, 'COLA', 372, 24);
  });
  // 3: HOT DOG CITY
  cell(3, () => {
    const g = x.createLinearGradient(0, 100, 0, 280); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#ffb070'); x.fillStyle = g;
    const rr = (px, py, w, h, r) => { x.beginPath(); x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r); x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath(); x.fill(); };
    x.save(); x.translate(128, 190); x.rotate(-0.5);
    rr(-34, -112, 68, 224, 34);                                                           // bun
    x.fillStyle = '#ff5a3a'; rr(-18, -128, 36, 256, 18);                                  // sausage
    x.strokeStyle = '#ffe36a'; x.lineWidth = 7; x.beginPath(); x.moveTo(0, -100); for (let i = 0; i < 9; i++) x.lineTo(i % 2 ? 12 : -12, -100 + i * 25); x.stroke();   // mustard
    x.restore();
    label(x, 'HOT DOG', 338, 44); label(x, 'CITY', 368, 30);
  });
  return c;
}

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = `
uniform sampler2D map; uniform float time; uniform float cell; uniform vec3 tint; uniform float seed; varying vec2 vUv;
float hash(float n){ return fract(sin(n * 91.345 + seed * 17.0) * 47453.5453); }
void main(){
  vec2 uv = vUv;
  float band = floor(uv.y * 26.0);
  float g = step(0.955, hash(band + floor(time * 5.0)));
  uv.x += g * (hash(band * 3.1 + floor(time * 9.0)) - 0.5) * 0.14 + sin(uv.y * 38.0 + time * 3.0) * 0.003;
  vec4 t = texture2D(map, vec2((clamp(uv.x, 0.001, 0.999) + cell) * 0.25, uv.y));
  float scan = 0.7 + 0.3 * sin(vUv.y * 420.0 - time * 8.0);
  float flick = 0.86 + 0.14 * sin(time * 29.0 + seed * 7.0) * sin(time * 6.1);
  float edge = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x) * smoothstep(0.0, 0.04, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
  float sweep = 0.55 + 0.45 * pow(0.5 + 0.5 * sin(vUv.y * 7.0 - time * 1.5), 5.0);
  float a = (t.a * 0.95 + 0.05) * edge * sweep * scan * flick;
  vec3 col = mix(tint, t.rgb * tint * 1.4 + tint * 0.3, 0.7);
  gl_FragColor = vec4(col * 1.7, a * 0.9);
}`;

export function buildHolograms(scene, timeU, eagleShape, spots) {
  const atlas = canvasTex(drawAtlas(eagleShape), { aniso: 4 });
  const holos = [];
  const tints = [[0.35, 0.85, 1.0], [1.0, 0.75, 0.25], [1.0, 0.3, 0.7], [0.4, 1.0, 0.6]];
  const planeGeo = new THREE.PlaneGeometry(16, 24);
  const shaftGeo = new THREE.CylinderGeometry(5.0, 0.8, 34, 16, 1, true).translate(0, 17, 0);
  const shaftMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, uniforms: { time: timeU },
    vertexShader: 'varying float vH; varying vec3 vN; varying vec3 vV; varying vec3 vW; void main(){ vH = clamp(position.y / 34.0, 0.0, 1.0); vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }',
    fragmentShader: 'uniform float time; varying float vH; varying vec3 vN; varying vec3 vV; varying vec3 vW; void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.5); float s = 0.8 + 0.2 * sin(vW.y * 3.0 - time * 5.0); gl_FragColor = vec4(0.5, 0.85, 1.0, f * (1.0 - vH) * 0.1 * s); }',
  });
  const rng = mulberry32(31337);
  spots.forEach((sp, i) => {
    const k = i % 4, tn = tints[(i + (rng() * 4 | 0)) % 4];
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { map: { value: atlas }, time: timeU, cell: { value: k }, tint: { value: new THREE.Color(...tn) }, seed: { value: rng() * 10 } },
      vertexShader: VERT, fragmentShader: FRAG,
    });
    const m = new THREE.Mesh(planeGeo, mat); m.position.set(sp.x, sp.y, sp.z); m.renderOrder = 7; scene.add(m);
    const shaft = new THREE.Mesh(shaftGeo, shaftMat); shaft.position.set(sp.x, 0.2, sp.z); shaft.renderOrder = 6; scene.add(shaft);
    // emitter pad on the road
    const pad = new THREE.Mesh(new THREE.CircleGeometry(1.6, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(...tn).multiplyScalar(1.6), toneMapped: false, transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    pad.position.set(sp.x, 0.07, sp.z); pad.renderOrder = 3; scene.add(pad);
    holos.push(m);
  });
  return holos;
}
