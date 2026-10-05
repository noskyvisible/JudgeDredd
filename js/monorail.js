import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { world, N, HALF, roadX, blockC } from './world.js';
import { makeCanvas, canvasTex, mulberry32 } from './util.js';

// ---------------------------------------------------------------------------
// Elevated monorail: two lines run overhead along road centre-lines (one east-west, one north-south, at different heights),
// carried on pylons that stand in the road median (traffic keeps 5 m off the centre line).  A lit train loops on each.
// All static parts are a handful of draw calls; the train is two instanced meshes plus a head / tail glow.
// ---------------------------------------------------------------------------

const LINES = [
  { axis: 'x', at: () => roadX(10), y: 15.5, speed: 27, cars: 6, hue: 0xff4fb0 },     // east-west along z = roadX(10)
  { axis: 'z', at: () => roadX(3), y: 20.5, speed: 21, cars: 5, hue: 0x40e0ff },       // north-south along x = roadX(3)
];
const CAR_L = 13, GAP = 0.7;

function windowTexture() {
  const [c, x] = makeCanvas(1024, 96);
  x.fillStyle = '#05060a'; x.fillRect(0, 0, 1024, 96);
  const rng = mulberry32(99);
  for (let i = 0; i < 12; i++) {
    const px = 22 + i * 83, g = x.createLinearGradient(0, 14, 0, 82);
    const warm = rng() < 0.7; g.addColorStop(0, warm ? '#fff2c8' : '#c8ecff'); g.addColorStop(1, warm ? '#ffc880' : '#80c0ff');
    x.fillStyle = g; x.fillRect(px, 14, 66, 62);
    x.fillStyle = 'rgba(8,10,16,.8)';                                              // commuters: heads and shoulders against the glass
    for (let k = 0; k < 3; k++) if (rng() < 0.6) { const hx = px + 12 + k * 20 + rng() * 6; x.beginPath(); x.arc(hx, 46, 7, 0, 7); x.fill(); x.fillRect(hx - 9, 52, 18, 26); }
  }
  return canvasTex(c);
}
function glowTexture() {
  const [c, x] = makeCanvas(64, 64); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return canvasTex(c);
}

export function buildMonorail(scene) {
  const trains = [];
  const concrete = new THREE.MeshStandardMaterial({ color: 0x3a3c46, roughness: 0.8, metalness: 0.15 });
  const body = new THREE.MeshStandardMaterial({ color: 0xd6dae6, roughness: 0.28, metalness: 0.7, envMapIntensity: 1.4 });
  const winTex = windowTexture(), glowTex = glowTexture();
  const winMat = new THREE.MeshBasicMaterial({ map: winTex, toneMapped: false, color: new THREE.Color(1.3, 1.3, 1.3) });
  const spanLen = HALF * 2 + 140;
  for (const L of LINES) {
    const fixed = L.at(), alongX = L.axis === 'x';
    const rot = alongX ? Math.PI / 2 : 0;                                      // geometry is built along +z, then turned for the east-west line
    const place = (m, a, h = 0) => { m.rotation.y = rot; m.position.set(alongX ? a : fixed, h, alongX ? fixed : a); return m; };
    // guideway beam with glowing edge strips
    const beam = place(new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.2, spanLen), concrete), 0, L.y); beam.castShadow = true; scene.add(beam);
    const glowCol = new THREE.Color(L.hue).multiplyScalar(2.2);
    for (const sx of [-1.52, 1.52]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, spanLen), new THREE.MeshBasicMaterial({ color: glowCol, toneMapped: false }));
      strip.rotation.y = rot; strip.position.set(alongX ? 0 : fixed + sx * 0, L.y - 0.1, 0);
      const off = new THREE.Vector3(sx, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      strip.position.set((alongX ? 0 : fixed) + off.x, L.y - 0.1, (alongX ? fixed : 0) + off.z); scene.add(strip);
    }
    // pylons in the road median, one at the middle of every block segment; each is a solid
    const pyl = [];
    for (let i = 0; i < N; i++) {
      const a = blockC(i);
      pyl.push(new THREE.BoxGeometry(1.6, L.y - 0.6, 1.6).translate(a, (L.y - 0.6) / 2, 0), new THREE.BoxGeometry(3.4, 0.8, 2.6).translate(a, L.y - 1.0, 0), new THREE.BoxGeometry(2.0, 0.5, 2.0).translate(a, 0.25, 0));
      world.addBox(alongX ? { minX: a - 0.8, maxX: a + 0.8, minZ: fixed - 0.8, maxZ: fixed + 0.8, h: L.y } : { minX: fixed - 0.8, maxX: fixed + 0.8, minZ: a - 0.8, maxZ: a + 0.8, h: L.y });
    }
    const pm = new THREE.Mesh(mergeGeometries(pyl), concrete); pm.castShadow = true;
    if (alongX) pm.position.set(0, 0, fixed); else { pm.rotation.y = -Math.PI / 2; pm.position.set(fixed, 0, 0); }
    // (the pylon geometry is authored along x; for the north-south line it is turned so "a" runs along z)
    scene.add(pm);
    // the train: shell + glowing window bands, both instanced
    const n = L.cars;
    const shell = new THREE.InstancedMesh(new RoundedBoxGeometry(2.9, 3.0, CAR_L, 3, 0.4).translate(0, 0, 0), body, n); shell.frustumCulled = false; shell.castShadow = true;
    const wg = new THREE.PlaneGeometry(CAR_L - 1.6, 1.05);
    const wins = new THREE.InstancedMesh(mergeGeometries([wg.clone().rotateY(Math.PI / 2).translate(1.455, 0.45, 0), wg.clone().rotateY(-Math.PI / 2).translate(-1.455, 0.45, 0)]), winMat, n); wins.frustumCulled = false;
    const stripe = new THREE.InstancedMesh(new THREE.BoxGeometry(2.96, 0.12, CAR_L - 0.5).translate(0, -0.55, 0), new THREE.MeshBasicMaterial({ color: glowCol, toneMapped: false }), n); stripe.frustumCulled = false;
    scene.add(shell, wins, stripe);
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff0d0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, transparent: true })); head.scale.setScalar(9);
    const tail = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff2a20, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, transparent: true })); tail.scale.setScalar(6);
    scene.add(head, tail);
    trains.push({ L, n, shell, wins, stripe, head, tail, fixed, alongX, s: L.axis === 'x' ? -420 : -260, len: n * (CAR_L + GAP) });
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  return {
    trains,
    update(dt) {
      for (const t of trains) {
        t.s += t.L.speed * dt;
        if (t.s - t.len > HALF + 200) t.s = -HALF - 260;                         // loop: reappear at the far end
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.alongX ? Math.PI / 2 : 0);
        for (let i = 0; i < t.n; i++) {
          const a = t.s - i * (CAR_L + GAP);
          p.set(t.alongX ? a : t.fixed, t.L.y + 1.9, t.alongX ? t.fixed : a);
          m.compose(p, q, one); t.shell.setMatrixAt(i, m); t.wins.setMatrixAt(i, m); t.stripe.setMatrixAt(i, m);
        }
        t.shell.instanceMatrix.needsUpdate = t.wins.instanceMatrix.needsUpdate = t.stripe.instanceMatrix.needsUpdate = true;
        const front = t.s + CAR_L / 2, back = t.s - (t.n - 1) * (CAR_L + GAP) - CAR_L / 2;
        t.head.position.set(t.alongX ? front + 0.5 : t.fixed, t.L.y + 2.3, t.alongX ? t.fixed : front + 0.5);
        t.tail.position.set(t.alongX ? back - 0.5 : t.fixed, t.L.y + 2.3, t.alongX ? t.fixed : back - 0.5);
      }
    },
  };
}
