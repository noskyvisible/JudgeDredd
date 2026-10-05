import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeEagle } from './world.js';
import { makeCanvas, canvasTex, mulberry32, normalFromHeight, clamp } from './util.js';
import { patchRim } from './shaders.js';

// ---------------------------------------------------------------------------
// The Lawmaster: a chunky, retro-industrial heavy cruiser — matte black body, boxy front
// fairing with a square screen, gold eagle on the nose, red/white striped front fender, stacked
// round chrome headlamps, tall ape-hanger bars, chrome pipes and fat treaded tyres.
// Modelled on the classic comic / collectible look.  Bike-local axes: +Z forward, +Y up.
// ---------------------------------------------------------------------------

const rb = (w, h, d, r = 0.05, s = 3) => new RoundedBoxGeometry(w, h, d, s, r);
function put(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; parent.add(m); return m;
}
// cylinder / tube between two points
function tubeBetween(parent, a, b, r, mat, seg = 10) {
  const d = b.clone().sub(a), len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); m.castShadow = true; parent.add(m); return m;
}

let TEX = null;
function textures() {
  if (TEX) return TEX;
  const rng = mulberry32(31);
  // tread: chevron grooves across the tyre face
  const [hc, hx] = makeCanvas(256, 128); hx.fillStyle = 'rgb(140,140,140)'; hx.fillRect(0, 0, 256, 128);
  hx.strokeStyle = 'rgb(40,40,40)'; hx.lineWidth = 6; hx.lineCap = 'round';
  for (let x = 0; x < 256; x += 16) { hx.beginPath(); hx.moveTo(x, 30); hx.lineTo(x + 9, 64); hx.lineTo(x, 98); hx.stroke(); }
  hx.fillStyle = 'rgb(110,110,110)'; hx.fillRect(0, 0, 256, 22); hx.fillRect(0, 106, 256, 22);
  for (let i = 0; i < 1500; i++) { hx.fillStyle = `rgba(${rng() < 0.5 ? 0 : 255},0,0,0.1)`; hx.fillRect(rng() * 256, rng() * 128, 2, 2); }
  const tread = canvasTex(normalFromHeight(hc, 2.4), { repeat: true, srgb: false });
  // red / white diagonal stripes for the front fender
  const [sc, sx] = makeCanvas(512, 128); sx.fillStyle = '#e9e6de'; sx.fillRect(0, 0, 512, 128);
  for (let i = -2; i < 12; i += 2) { sx.fillStyle = '#c4201b'; sx.beginPath(); sx.moveTo(i * 44, 0); sx.lineTo(i * 44 + 44, 0); sx.lineTo(i * 44 + 44 - 60, 128); sx.lineTo(i * 44 - 60, 128); sx.fill(); }
  sx.strokeStyle = 'rgba(20,0,0,0.55)'; sx.lineWidth = 3; for (let i = -2; i < 14; i++) { sx.beginPath(); sx.moveTo(i * 44, 0); sx.lineTo(i * 44 - 60, 128); sx.stroke(); }
  const stripes = canvasTex(sc);
  // number plate
  const [pc, px] = makeCanvas(256, 96); px.fillStyle = '#d9d4c4'; px.fillRect(0, 0, 256, 96); px.strokeStyle = '#111'; px.lineWidth = 6; px.strokeRect(5, 5, 246, 86);
  px.fillStyle = '#111'; px.font = '900 52px Impact, "Arial Black", sans-serif'; px.textAlign = 'center'; px.textBaseline = 'middle'; px.fillText('JUDGE 1', 128, 52);
  const plate = canvasTex(pc);
  TEX = { tread, stripes, plate };
  return TEX;
}

function makeWheel(R, W, mats, T) {
  const spin = new THREE.Group();
  const rIn = R * 0.6, c = 0.1, pts = [];
  pts.push(new THREE.Vector2(rIn, -W / 2), new THREE.Vector2(R - c, -W / 2));
  for (let i = 0; i <= 6; i++) { const t = -Math.PI / 2 + (i / 6) * (Math.PI / 2); pts.push(new THREE.Vector2(R - c + c * Math.cos(t), -W / 2 + c + c * Math.sin(t))); }
  for (let i = 0; i <= 6; i++) { const t = (i / 6) * (Math.PI / 2); pts.push(new THREE.Vector2(R - c + c * Math.cos(t), W / 2 - c + c * Math.sin(t))); }
  pts.push(new THREE.Vector2(rIn, W / 2));
  const tyreGeo = new THREE.LatheGeometry(pts, 56); tyreGeo.rotateZ(Math.PI / 2);
  const uv = tyreGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 34);
  put(spin, tyreGeo, mats.tyre);
  // rim: dark dish + chrome lips + hub + lug nuts + spokes (spokes make the rotation readable)
  const rimGeo = new THREE.CylinderGeometry(rIn + 0.005, rIn + 0.005, W * 0.86, 32); rimGeo.rotateZ(Math.PI / 2); put(spin, rimGeo, mats.gun);
  const dish = new THREE.CylinderGeometry(rIn * 0.8, rIn * 0.8, W * 0.9, 32); dish.rotateZ(Math.PI / 2); put(spin, dish, mats.dark);
  for (const sx of [-1, 1]) {
    const ring = new THREE.TorusGeometry(rIn + 0.005, 0.02, 8, 40); ring.rotateY(Math.PI / 2); put(spin, ring, mats.chrome, sx * W * 0.45);
    const cap = new THREE.CylinderGeometry(0.11, 0.11, 0.05, 20); cap.rotateZ(Math.PI / 2); put(spin, cap, mats.chrome, sx * W * 0.47);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2, lug = new THREE.CylinderGeometry(0.018, 0.018, 0.035, 6); lug.rotateZ(Math.PI / 2); put(spin, lug, mats.chrome, sx * W * 0.47, Math.sin(a) * 0.17, Math.cos(a) * 0.17); }
  }
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; const sp = put(spin, new THREE.BoxGeometry(W * 0.84, 0.07, rIn * 0.88), mats.gun, 0, 0, 0); sp.rotation.x = a; sp.position.set(0, 0, 0); }
  return spin;
}

// returns the model group with userData used by the Lawmaster class and rider IK
export function makeLawmasterModel(pal = {}) {
  const T = textures();
  const body = pal.body ?? 0x101114, accent = pal.accent ?? 0xd6a328;
  const mats = {
    paint: new THREE.MeshStandardMaterial({ color: body, roughness: 0.5, metalness: 0.35, envMapIntensity: 1.2 }),
    gun: new THREE.MeshStandardMaterial({ color: 0x2c3037, roughness: 0.42, metalness: 0.75, envMapIntensity: 1.2 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.6, metalness: 0.4 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdadee6, roughness: 0.14, metalness: 1.0, envMapIntensity: 1.8 }),
    gold: new THREE.MeshStandardMaterial({ color: accent, roughness: 0.3, metalness: 0.7, emissive: 0x3a2506, emissiveIntensity: 0.5, envMapIntensity: 1.3 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x0e0e10, roughness: 0.9, metalness: 0.0, normalMap: T.tread, normalScale: new THREE.Vector2(1.3, 1.3) }),
    seat: new THREE.MeshStandardMaterial({ color: pal.seat ?? 0x4a1a12, roughness: 0.55, metalness: 0.05 }),
    stripes: new THREE.MeshStandardMaterial({ map: T.stripes, roughness: 0.35, metalness: 0.2, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ color: 0xe6eef8, roughness: 0.08, metalness: 0.25, emissive: 0x5a7490, emissiveIntensity: 0.9, side: THREE.DoubleSide, envMapIntensity: 1.2 }),
    lens: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.92, 0.75).multiplyScalar(2.0), toneMapped: false }),
    amber: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.55, 0.1).multiplyScalar(1.4), toneMapped: false }),
    tail: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.08, 0.05).multiplyScalar(2.2), toneMapped: false }),
    plate: new THREE.MeshStandardMaterial({ map: T.plate, roughness: 0.6 }),
  };
  if (pal.stripe) { const [sc, sx] = makeCanvas(512, 128); sx.fillStyle = '#16161a'; sx.fillRect(0, 0, 512, 128); for (let i = -2; i < 12; i += 2) { sx.fillStyle = pal.stripe; sx.beginPath(); sx.moveTo(i * 44, 0); sx.lineTo(i * 44 + 44, 0); sx.lineTo(i * 44 + 44 - 60, 128); sx.lineTo(i * 44 - 60, 128); sx.fill(); } mats.stripes.map = canvasTex(sc); }
  for (const m of [mats.paint, mats.gun]) patchRim(m, 0x7aa6ff, 3.0, 0.22);

  const g = new THREE.Group();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // ---- wheels ----
  const rear = new THREE.Group(); rear.position.set(0, 0.55, -1.3); g.add(rear);
  const rearSpin = makeWheel(0.55, 0.44, mats, T); rear.add(rearSpin);
  const front = new THREE.Group(); front.position.set(0, 1.3, 0.95); g.add(front);   // steering assembly
  const fw = new THREE.Group(); fw.position.set(0, 0.52 - 1.3, 1.4 - 0.95); front.add(fw);
  const frontSpin = makeWheel(0.52, 0.4, mats, T); fw.add(frontSpin);

  // ---- front fender (black arch + striped crown) ----
  const fen = new THREE.CylinderGeometry(0.62, 0.62, 0.5, 30, 1, true, -0.14 * Math.PI, 0.98 * Math.PI); fen.rotateZ(Math.PI / 2);
  put(fw, fen, new THREE.MeshStandardMaterial({ color: body, roughness: 0.4, metalness: 0.4, side: THREE.DoubleSide }));
  const crown = new THREE.CylinderGeometry(0.635, 0.635, 0.52, 20, 1, true, 0.02 * Math.PI, 0.52 * Math.PI); crown.rotateZ(Math.PI / 2);
  put(fw, crown, mats.stripes);
  // fork legs
  for (const sx of [-1, 1]) {
    tubeBetween(front, V(sx * 0.22, 0.02, 0.02), V(sx * 0.29, -0.78, 0.43), 0.036, mats.chrome);
    tubeBetween(front, V(sx * 0.22, 0.02, 0.02), V(sx * 0.27, -0.28, 0.14), 0.05, mats.gun);
  }
  put(front, rb(0.62, 0.1, 0.16, 0.03), mats.dark, 0, 0.0, 0.02);          // steering clamp
  // ---- front box fairing + screen + eagle + lamps ----
  put(front, rb(0.76, 0.5, 1.02, 0.08), mats.paint, 0, 0.06, 0.2);
  put(front, rb(0.82, 0.07, 1.04, 0.03), mats.gun, 0, 0.3, 0.2);
  const screenFrame = put(front, rb(0.7, 0.5, 0.045, 0.02), mats.dark, 0, 0.55, -0.12, -0.5, 0, 0);
  const screen = put(front, new THREE.PlaneGeometry(0.6, 0.4), mats.glass, 0, 0.55, -0.145, -0.5, Math.PI, 0);
  const eagle = makeEagle(mats.gold, 0.98, 0.075); eagle.position.set(0, 0.5, 0.6); eagle.rotation.x = -0.42; front.add(eagle);
  put(front, rb(0.22, 0.1, 0.16, 0.04), mats.gold, 0, 0.34, 0.6);
  for (const dy of [0.12, -0.08]) {
    const bez = new THREE.CylinderGeometry(0.105, 0.105, 0.06, 20); bez.rotateX(Math.PI / 2); put(front, bez, mats.chrome, 0, dy, 0.73);
    const lens = new THREE.CylinderGeometry(0.082, 0.082, 0.04, 20); lens.rotateX(Math.PI / 2); put(front, lens, mats.lens, 0, dy, 0.765);
  }
  for (const sx of [-1, 1]) {
    const mk = new THREE.SphereGeometry(0.045, 8, 6); put(front, mk, mats.amber, sx * 0.39, 0.0, 0.55);
  }
  // ---- handlebars (ape-hanger) ----
  const gripAnchors = [];
  for (const sx of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([V(sx * 0.12, 0.04, 0.0), V(sx * 0.27, 0.34, -0.02), V(sx * 0.46, 0.5, -0.3), V(sx * 0.52, 0.46, -0.72)]);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.03, 8), mats.chrome); tube.castShadow = true; front.add(tube);
    const end = curve.getPoint(1), tang = curve.getTangent(1);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.16, 10), mats.dark); grip.position.copy(end).addScaledVector(tang, -0.02); grip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tang); front.add(grip);
    gripAnchors.push(end.clone().addScaledVector(tang, -0.08));
    put(front, new THREE.CylinderGeometry(0.012, 0.012, 0.22, 6), mats.chrome, sx * 0.43, 0.38, -0.45, Math.PI / 2 - 0.25, 0, 0);   // brake lever
  }

  // ---- main body ----
  put(g, rb(0.54, 0.44, 1.0, 0.09), mats.paint, 0, 0.98, 0.3);                       // tank
  put(g, rb(0.48, 0.3, 2.1, 0.06), mats.gun, 0, 0.62, -0.2);                          // chassis
  for (const sx of [-1, 1]) {
    put(g, rb(0.05, 0.36, 1.1, 0.02), mats.gun, sx * 0.29, 0.9, -0.05);              // side plates
    for (let i = 0; i < 6; i++) put(g, new THREE.CylinderGeometry(0.014, 0.014, 0.02, 6), mats.chrome, sx * 0.32, 0.78 + (i % 2) * 0.2, -0.45 + Math.floor(i / 2) * 0.35, 0, 0, Math.PI / 2);
    const cyl = new THREE.CylinderGeometry(0.15, 0.15, 0.2, 18); cyl.rotateZ(Math.PI / 2); put(g, cyl, mats.gun, sx * 0.36, 0.5, 0.3);
    const ccap = new THREE.CylinderGeometry(0.11, 0.11, 0.04, 18); ccap.rotateZ(Math.PI / 2); put(g, ccap, mats.chrome, sx * 0.47, 0.5, 0.3);
    for (let i = 0; i < 3; i++) { const fin = new THREE.CylinderGeometry(0.17, 0.17, 0.015, 18); fin.rotateZ(Math.PI / 2); put(g, fin, mats.gun, sx * (0.28 + i * 0.045), 0.5, 0.3); }
    // long chrome rail + exhaust
    tubeBetween(g, V(sx * 0.42, 0.44, -1.5), V(sx * 0.42, 0.44, 0.95), 0.042, mats.chrome);
    for (const z of [-1.0, -0.2, 0.55]) put(g, new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10), mats.dark, sx * 0.42, 0.44, z, Math.PI / 2, 0, 0);
    tubeBetween(g, V(sx * 0.3, 0.74, -1.5), V(sx * 0.36, 0.76, -2.05), 0.075, mats.chrome);
    put(g, new THREE.CylinderGeometry(0.06, 0.06, 0.03, 10), mats.dark, sx * 0.36, 0.76, -2.06, Math.PI / 2, 0, 0);
    // foot pegs
    const peg = new THREE.CylinderGeometry(0.03, 0.03, 0.28, 8); peg.rotateZ(Math.PI / 2); put(g, peg, mats.chrome, sx * 0.55, 0.72, -0.2);
    const pegGrip = new THREE.CylinderGeometry(0.04, 0.04, 0.12, 8); pegGrip.rotateZ(Math.PI / 2); put(g, pegGrip, mats.dark, sx * 0.62, 0.72, -0.2);
  }
  // ---- rear body, seat, lights ----
  put(g, rb(0.84, 0.66, 1.22, 0.1), mats.paint, 0, 0.98, -1.3);
  put(g, rb(0.7, 0.1, 1.0, 0.03), mats.gun, 0, 1.33, -1.3);
  const rfen = new THREE.CylinderGeometry(0.66, 0.66, 0.6, 28, 1, true, -0.3 * Math.PI, 1.3 * Math.PI); rfen.rotateZ(Math.PI / 2);
  put(rear, rfen, new THREE.MeshStandardMaterial({ color: body, roughness: 0.45, metalness: 0.4, side: THREE.DoubleSide }));
  put(g, rb(0.54, 0.14, 0.62, 0.06), mats.seat, 0, 1.12, -0.58);                      // seat
  put(g, rb(0.5, 0.24, 0.1, 0.04), mats.seat, 0, 1.24, -0.95);                         // back rest
  put(g, rb(0.62, 0.08, 0.04, 0.015), mats.tail, 0, 1.05, -1.93);
  for (const sx of [-1, 1]) put(g, new THREE.SphereGeometry(0.05, 8, 6), mats.amber, sx * 0.34, 0.82, -1.92);
  put(g, new THREE.PlaneGeometry(0.32, 0.12), mats.plate, 0, 0.78, -1.94, 0, Math.PI, 0);
  // lights
  const spot = new THREE.SpotLight(0xfff0d8, 0, 90, 0.5, 0.7, 1.2); spot.position.set(0, 0.04, 0.8); spot.target.position.set(0, -0.6, 16); front.add(spot); front.add(spot.target);
  const siren = new THREE.PointLight(0xff2020, 0, 22, 2); siren.position.set(0, 2.0, 1.1); g.add(siren);
  const sirenL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.1), new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false })); sirenL.position.set(-0.2, 0.37, 0.18); front.add(sirenL);
  const sirenR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.1), new THREE.MeshBasicMaterial({ color: 0x2060ff, toneMapped: false })); sirenR.position.set(0.2, 0.37, 0.18); front.add(sirenR);

  g.userData = {
    rear, front, rearSpin, frontSpin, wr: rearSpin, wf: frontSpin, spot, siren, sirenL, sirenR,
    exhaust: [V(-0.36, 0.76, -2.1), V(0.36, 0.76, -2.1)],
    anchors: {
      seat: V(0, 1.19, -0.58),
      pegL: V(0.56, 0.72, -0.2), pegR: V(-0.56, 0.72, -0.2),
      gripL: gripAnchors[1].clone(), gripR: gripAnchors[0].clone(),   // in `front` group space
    },
  };
  return g;
}

// ---------------------------------------------------------------------------
// Planar two-bone IK shared by arms and legs.  Returns rig rotations
//   psi (yaw of the limb plane), phi (swing), e (bend)  using the rig's convention
//   (x < 0 swings forward).
// ---------------------------------------------------------------------------
function planarIK(a, b, tx, ty, tz) {
  const h = Math.hypot(tx, tz), D = Math.hypot(h, ty);
  const Dc = clamp(D, Math.abs(a - b) + 0.01, a + b - 0.005);
  let psi = h > 1e-5 ? Math.atan2(-tx, -tz) : 0;
  const beta = Math.atan2(h, -ty);
  const gamma = Math.acos(clamp((a * a + Dc * Dc - b * b) / (2 * a * Dc), -1, 1));
  let phi = beta - gamma;
  const ph = Dc * Math.sin(beta), py = Dc * Math.cos(beta);
  const Phi = Math.atan2(ph - a * Math.sin(phi), py - a * Math.cos(phi));
  let e = Phi - phi;
  if (Math.abs(psi) > Math.PI / 2) { psi -= Math.sign(psi) * Math.PI; phi = -phi; e = -e; }
  return { psi, phi, e };
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
// Seat the rider: hips on the saddle, boots on the pegs, hands on the bars (follows the steering).
export function ridePoseIK(ch, bike) {
  const S = ch.style.scale;
  ch.override = (B, dt) => {
    const u = bike.model.userData, A = u.anchors, steer = bike.steer || 0, ac = bike.accelLean || 0;
    // posture
    ch.root.position.set(0, A.seat.y + 0.13 - 1.0 * S, A.seat.z);
    B.pos[0] = 0; B.pos[1] = 0; B.pos[2] = 0;
    B.hips[0] = 0; B.hips[1] = 0; B.hips[2] = 0;
    B.torso[0] = 0.2 + ac * 0.12; B.torso[1] = steer * 0.18; B.torso[2] = -steer * 0.08;
    B.head[0] = -0.2; B.head[1] = -steer * 0.15;
    ch.applyPose(B);
    bike.model.updateMatrixWorld(true);
    // --- arms ---
    const arm = (side) => {
      const sh = side === 'L' ? ch.shL : ch.shR, anchor = side === 'L' ? u.anchors.gripL : u.anchors.gripR;
      _a.copy(anchor); u.front.localToWorld(_a);
      ch.chest.worldToLocal(_a); _a.sub(sh.position);
      return planarIK(0.38, 0.47, _a.x, _a.y, _a.z);
    };
    const aL = arm('L'), aR = arm('R');
    B.shL[0] = aL.phi; B.shL[1] = aL.psi; B.shL[2] = 0.05; B.elL[0] = aL.e;
    B.shR[0] = aR.phi; B.shR[1] = aR.psi; B.shR[2] = -0.05; B.elR[0] = aR.e;
    // aiming: right arm leaves the bar and points the Lawgiver where the camera looks
    if (ch.aim > 0.02) {
      const k = ch.aim;
      B.shR[0] += (-Math.PI / 2 - ch.aimPitch - B.shR[0]) * k; B.shR[1] += ((ch.aimYaw || 0) * 0.9 - B.shR[1]) * k; B.shR[2] *= 1 - k; B.elR[0] += (-0.1 - B.elR[0]) * k;
    }
    // --- legs ---
    const leg = (side) => {
      const hp = side === 'L' ? ch.hipL : ch.hipR, peg = side === 'L' ? A.pegL : A.pegR;
      _b.copy(peg); bike.model.localToWorld(_b);
      ch.hips.worldToLocal(_b); _b.sub(hp.position);
      _b.y += 0.04; // ankle sits slightly above the peg
      return planarIK(0.46, 0.46, _b.x, _b.y, _b.z);
    };
    const lL = leg('L'), lR = leg('R');
    B.hipL[0] = lL.phi; B.hipL[1] = lL.psi; B.hipL[2] = 0; B.knL[0] = Math.max(0, lL.e);
    B.hipR[0] = lR.phi; B.hipR[1] = lR.psi; B.hipR[2] = 0; B.knR[0] = Math.max(0, lR.e);
  };
}
