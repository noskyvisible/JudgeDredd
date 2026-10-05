import * as THREE from 'three';
import { V3, lin, se, smoothstep, mix, surface, patch, capRing, ringAt, xf, rod, lathe, cbox, slab, tint, patchGlass, Kit } from './vehicle_geo.js';

// ---------------------------------------------------------------------------
// Flying traffic: instanced "spinner" aircars cruising in lanes above the street grid near the player.
// Every part is one InstancedMesh shared by all flyers (body / glass / lights / beams = 4 draw calls),
// no real lights: emissive running lights (blinking per instance in the shader) and additive headlight cones.
//
// Hook-up (not wired in by this module):
//   import { createFlyers } from './flyers.js';
//   const flyers = createFlyers(scene);            // after world.build()
//   flyers.update(dt, player.pos);                  // every frame (e.g. next to world.update in main.js)
// Options: createFlyers(scene, { count: 28, roadX: (k) => -750 + k * 100, lines: 15, minAlt: 16, maxAlt: 44 })
// ---------------------------------------------------------------------------

function buildSpinner() {
  const kit = new Kit(), host = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial(), glass = new THREE.MeshStandardMaterial(), lights = new THREE.MeshBasicMaterial({ vertexColors: true });
  const L = 5.0;
  // fuselage: wedge nose, raised spine, flat belly; v runs bottom -> -X -> top -> +X
  const bodyFn = (z, v, out) => {
    const t = (z + L / 2) / L;   // 0 tail .. 1 nose
    const hw = 0.42 + 0.58 * Math.sin(Math.min(1, (t + 0.05) * 1.25) * Math.PI * 0.5) * (1 - 0.55 * smoothstep(0.72, 1.0, t));
    const top = 0.55 + 0.42 * Math.exp(-Math.pow((t - 0.5) / 0.3, 2)) - 0.25 * smoothstep(0.75, 1.0, t);
    const bot = 0.12 + 0.12 * smoothstep(0.8, 1.0, t) + 0.08 * (1 - smoothstep(0.0, 0.15, t));
    const th = -Math.PI / 2 - v * Math.PI * 2; const [x, y] = se(th, 2.6); const hh = (top - bot) / 2;
    return out.set(x * hw * (1 - 0.25 * ((y + 1) / 2) ** 2), bot + hh + y * hh, z);
  };
  const zs = lin(-L / 2, L / 2, 18), vs = lin(0, 1, 20);
  kit.add(surface(bodyFn, zs, vs, { closed: true }), paint, host);
  kit.add(capRing(ringAt(bodyFn, -L / 2, vs), V3(0, 0, -1)), paint, host);
  kit.add(capRing(ringAt(bodyFn, L / 2, vs), V3(0, 0, 1)), paint, host);
  // canopy bubble
  const can = new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5); can.scale(1.25, 0.75, 2.6); can.translate(0, 0.86, 0.45);
  kit.add(can, glass, host);
  // thruster nacelles + fins
  for (const s of [-1, 1]) {
    const nac = lathe([[0, -1.7], [0.16, -1.66], [0.22, -1.3], [0.23, 0.5], [0.17, 1.05], [0.0, 1.22]], 12, [1, 0]); nac.rotateX(Math.PI / 2); nac.translate(s * 1.15, 0.4, -0.45);
    kit.add(nac, paint, host);
    kit.add(xf(cbox(0.62, 0.07, 1.2, 0.02), s * 0.8, 0.4, -0.5, 0, 0, -s * 0.1), paint, host);                           // stub wing
    const fin = slab([[0, 0], [0.95, 0], [1.3, 0.62], [1.02, 0.66]], 0.05, 0.01); fin.rotateY(Math.PI / 2);              // swept fin (outline in z-y)
    kit.add(xf(fin, s * 0.42, 0.78, -2.45, 0, 0, s * 0.42), paint, host);
  }
  // running lights: vertex colour + blink group in uv.x (0 steady, 1 strobe, 2 nav blink)
  const lamp = (g, col, mode) => { const gg = tint(g.index ? g.toNonIndexed() : g, col); const uv = new Float32Array(gg.attributes.position.count * 2); for (let i = 0; i < uv.length; i += 2) uv[i] = mode; gg.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); kit.add(gg, lights, host); };
  lamp(new THREE.BoxGeometry(0.9, 0.05, 0.04).translate(0, 0.32, L / 2 + 0.01), [4, 3.8, 3.4], 0);                                  // headlight strip
  for (const s of [-1, 1]) lamp(new THREE.BoxGeometry(0.22, 0.08, 0.04).translate(s * 0.28, 0.45, -L / 2 - 0.01), [3.2, 0.12, 0.08], 0);   // tail lights
  for (const s of [-1, 1]) lamp(new THREE.CircleGeometry(0.17, 12).rotateY(Math.PI).translate(s * 1.15, 0.4, -2.16), [0.8, 2.0, 5.0], 0);   // thrusters
  for (const s of [-1, 1]) lamp(new THREE.BoxGeometry(0.3, 0.03, 1.2).translate(s * 1.15, 0.16, -0.5), [0.5, 1.5, 4.0], 0);           // belly glow
  lamp(new THREE.BoxGeometry(0.5, 0.02, 2.4).translate(0, 0.115, 0.0), [0.35, 1.0, 2.6], 0);                                          // keel light
  lamp(new THREE.SphereGeometry(0.09, 6, 4).translate(-1.15, 0.44, 0.75), [5, 0.2, 0.12], 2);                                      // nav red (left / -X)
  lamp(new THREE.SphereGeometry(0.09, 6, 4).translate(1.15, 0.44, 0.75), [0.12, 5, 0.8], 2);                                        // nav green
  lamp(new THREE.BoxGeometry(0.2, 0.08, 0.2).translate(0, 1.0, -1.0), [6, 6, 7], 1);                                            // roof strobe
  const geos = kit.geometries();
  return { body: geos.get(paint), glass: geos.get(glass), lights: geos.get(lights), len: L };
}

function lightsMaterial() {
  const m = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } }, toneMapped: false, fog: false,
    vertexShader: `attribute vec3 color; varying vec3 vC; varying float vB; uniform float time;
      void main(){
        float ph = fract(float(gl_InstanceID) * 0.6180339);
        float strobe = step(0.92, fract(time * 1.1 + ph)), nav = 0.35 + 0.65 * step(0.5, fract(time * 0.8 + ph));
        vB = uv.x < 0.5 ? 1.0 : (uv.x < 1.5 ? strobe : nav);
        vC = color;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: 'varying vec3 vC; varying float vB; void main(){ if (vB < 0.02) discard; gl_FragColor = vec4(vC * vB, 1.0); }',
  });
  return m;
}
function beamMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { time: { value: 0 } },
    vertexShader: `varying float vT; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){ vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0); vW = wp.xyz; vT = clamp(position.z / 22.0, 0.0, 1.0);
        vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `varying float vT; varying vec3 vN; varying vec3 vV; varying vec3 vW; uniform float time;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        float fres = pow(abs(dot(normalize(vN), normalize(vV))), 1.4);
        float a = (1.0 - vT) * (1.0 - vT) * smoothstep(0.0, 0.05, vT) * fres * 0.22;
        float col = hash(floor(vW.xy * 7.0)); a *= 1.0 + 2.5 * smoothstep(0.88, 1.0, col) * (0.5 + 0.5 * sin(vW.y * 2.0 + time * 9.0));
        gl_FragColor = vec4(0.85, 0.92, 1.0, a);
      }`,
  });
}

const PAINTS = [0x1a1c22, 0x2a2e36, 0x5a1218, 0xd8dade, 0x14284a, 0x3a3a40, 0x6a5a30, 0x101012];

export function createFlyers(scene, o = {}) {
  const N = o.count ?? 36, roadX = o.roadX ?? ((k) => -750 + k * 100), LINES = o.lines ?? 15;
  const minAlt = o.minAlt ?? 16, maxAlt = o.maxAlt ?? 44, RANGE = o.range ?? 200;
  const S = buildSpinner();
  const body = new THREE.InstancedMesh(S.body, new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.7, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.6 }), N);
  const glass = new THREE.InstancedMesh(S.glass, patchGlass(new THREE.MeshStandardMaterial({ color: 0x0c1420, metalness: 0.2, roughness: 0.05, envMapIntensity: 2.2, depthWrite: false }), 0.5, 0.95, 2.2), N);
  const lmat = lightsMaterial(); const lights = new THREE.InstancedMesh(S.lights, lmat, N);
  const bgeo = new THREE.ConeGeometry(4.2, 22, 12, 1, true); bgeo.translate(0, -11, 0); bgeo.rotateX(-Math.PI / 2); bgeo.rotateX(0.18);
  const bmat = beamMaterial(); const beams = new THREE.InstancedMesh(bgeo, bmat, N);
  body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
  for (const m of [body, glass, lights, beams]) { m.frustumCulled = false; scene.add(m); }
  body.castShadow = false; beams.renderOrder = 6;
  const col = new THREE.Color();
  const fl = [];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const relane = (f, cx, cz) => {
    f.axis = Math.random() < 0.5 ? 'x' : 'z';
    const centre = f.axis === 'x' ? cz : cx, k0 = Math.round((centre + 750) / 100);
    const k = Math.max(0, Math.min(LINES, k0 + pick([-1, 0, 0, 0, 1, 1, -1, 2, -2])));
    f.dir = Math.random() < 0.5 ? 1 : -1;
    f.line = roadX(k) + f.dir * (3.5 + Math.random() * 3);     // keep right of the centreline
    f.alt = minAlt + Math.random() * (maxAlt - minAlt);
    f.speed = 18 + Math.random() * 22;
    const along = f.axis === 'x' ? cx : cz;
    f.s = along + (Math.random() * 2 - 1) * RANGE;
  };
  for (let i = 0; i < N; i++) {
    const f = { ph: Math.random() * 10, bank: 0 }; relane(f, 0, 0); fl.push(f);
    body.setColorAt(i, col.set(pick(PAINTS)));
  }
  body.instanceColor.needsUpdate = true;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
  let t = 0;
  return {
    meshes: [body, glass, lights, beams],
    update(dt, center) {
      t += dt; lmat.uniforms.time.value = t; bmat.uniforms.time.value = t;
      for (let i = 0; i < N; i++) {
        const f = fl[i];
        f.s += f.dir * f.speed * dt;
        const along = f.axis === 'x' ? center.x : center.z, perp = f.axis === 'x' ? center.z : center.x;
        if (Math.abs(f.line - perp) > RANGE * 1.1) relane(f, center.x, center.z);
        else if ((f.s - along) * f.dir > RANGE) { f.s = along - f.dir * RANGE; }                      // passed far ahead: re-enter behind
        else if ((f.s - along) * f.dir < -RANGE * 1.2) { f.s = along + f.dir * RANGE * 0.9; }
        const bob = Math.sin(t * 0.7 + f.ph) * 0.35, roll = Math.sin(t * 0.5 + f.ph * 1.3) * 0.05;
        if (f.axis === 'x') p.set(f.s, f.alt + bob, f.line); else p.set(f.line, f.alt + bob, f.s);
        const yaw = f.axis === 'x' ? (f.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (f.dir > 0 ? 0 : Math.PI);
        q.setFromEuler(e.set(-0.03, yaw, roll, 'YXZ')); m4.compose(p, q, sc);
        body.setMatrixAt(i, m4); glass.setMatrixAt(i, m4); lights.setMatrixAt(i, m4);
        p.y += 0.35; p.x += f.axis === 'x' ? f.dir * S.len * 0.5 : 0; p.z += f.axis === 'z' ? f.dir * S.len * 0.5 : 0; m4.compose(p, q, sc); beams.setMatrixAt(i, m4);
      }
      for (const m of [body, glass, lights, beams]) m.instanceMatrix.needsUpdate = true;
    },
    dispose() { for (const m of [body, glass, lights, beams]) { scene.remove(m); m.dispose(); } },
  };
}
