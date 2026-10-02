import * as THREE from 'three';
import { G } from './state.js';
import { rand, clamp, makeCanvas, canvasTex } from './util.js';

// ---------------------------------------------------------------------------
// Particle system (single Points draw call, CPU pool) + rings, lights, ribbons,
// camera shake, hit-stop / slow-mo and floating text.
// ---------------------------------------------------------------------------

const PVERT = `
attribute float size; attribute vec4 col;
varying vec4 vCol;
uniform float scale;
void main(){
  vCol = col;
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  gl_PointSize = size * scale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const PFRAG = `
varying vec4 vCol;
void main(){
  vec2 c = gl_PointCoord - 0.5; float d = length(c)*2.0;
  float a = smoothstep(1.0, 0.0, d);
  a *= a;
  gl_FragColor = vec4(vCol.rgb, vCol.a * a);
  if (gl_FragColor.a < 0.003) discard;
}`;

class ParticlePool {
  constructor(max, additive) {
    this.max = max; this.n = 0; this.head = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.grow = new Float32Array(max);
    this.c0 = new Float32Array(max * 4); this.size0 = new Float32Array(max);
    this.floor = new Uint8Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('col', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PVERT, fragmentShader: PFRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { scale: { value: 800 } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 10 : 9;
    this.life.fill(0);
  }
  emit(x, y, z, vx, vy, vz, r, g, b, a, size, life, grav = 0, drag = 0, grow = 0, floor = 0) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    const i3 = i * 3, i4 = i * 4;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.c0[i4] = r; this.c0[i4 + 1] = g; this.c0[i4 + 2] = b; this.c0[i4 + 3] = a;
    this.size0[i] = size; this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow; this.floor[i] = floor;
  }
  update(dt) {
    const { pos, vel, life, maxLife, col, c0, size, size0, grav, drag, grow, floor } = this;
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
      col[i4] = c0[i4]; col[i4 + 1] = c0[i4 + 1]; col[i4 + 2] = c0[i4 + 2]; col[i4 + 3] = c0[i4 + 3] * k;
      size[i] = size0[i] * (1 + grow[i] * (1 - k));
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.col.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
}

const _c = new THREE.Color();
const rings = [];
const lightPool = [];
let lightHead = 0;
const floaters = [];
let floatLayer;
let shakeAmt = 0;
let hitstopT = 0, slowT = 0, slowScale = 1;
let ringGeo, ringTex, flareTex; const flares = []; let flareHead = 0;

export const fx = {
  add: null, smoke: null,
  init(scene) {
    this.scene = scene;
    this.add = new ParticlePool(7000, true);
    this.smoke = new ParticlePool(1500, false);
    scene.add(this.add.points, this.smoke.points);

    const [c, x] = makeCanvas(128, 128);
    const g = x.createRadialGradient(64, 64, 20, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,0.9)'); g.addColorStop(0.85, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
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
  spark(p, n = 8, color = 0xffc060, speed = 8, life = 0.5) {
    _c.set(color);
    for (let i = 0; i < n; i++) {
      const a = rand(Math.PI * 2), e = rand(-0.3, 1), s = rand(0.3, 1) * speed;
      this.add.emit(p.x, p.y, p.z, Math.cos(a) * s, e * s, Math.sin(a) * s, _c.r * 1.5, _c.g * 1.5, _c.b * 1.5, 1, rand(0.12, 0.3), rand(0.2, 1) * life, 18, 1.5, -0.5, 1);
    }
  },
  burst(p, n, color, speed, size, life, grav = 0, drag = 2) {
    _c.set(color);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(0.3, 1) * speed);
      this.add.emit(p.x, p.y, p.z, v.x, v.y, v.z, _c.r, _c.g, _c.b, 1, size * rand(0.6, 1.3), life * rand(0.6, 1), grav, drag, -0.3);
    }
  },
  glowPuff(p, color, size, life) { _c.set(color); this.add.emit(p.x, p.y, p.z, 0, 0, 0, _c.r * 1.5, _c.g * 1.5, _c.b * 1.5, 1, size, life, 0, 0, -0.8); },
  smokePuff(p, n = 3, size = 1.4, life = 1.4, dark = 0.18, up = 1.5) {
    for (let i = 0; i < n; i++) {
      this.smoke.emit(p.x + rand(-0.3, 0.3), p.y + rand(0, 0.3), p.z + rand(-0.3, 0.3), rand(-0.6, 0.6), up * rand(0.5, 1.2), rand(-0.6, 0.6), dark, dark, dark * 1.1, 0.5, size * rand(0.7, 1.3), life * rand(0.7, 1.2), -0.2, 0.8, 1.8);
    }
  },
  fire(p, n = 4, scale = 1) {
    for (let i = 0; i < n; i++) {
      this.add.emit(p.x + rand(-0.4, 0.4) * scale, p.y, p.z + rand(-0.4, 0.4) * scale, rand(-0.5, 0.5), rand(2, 4) * scale, rand(-0.5, 0.5), 2.2, rand(0.5, 1.1), 0.12, 0.9, rand(0.7, 1.4) * scale, rand(0.4, 0.8), -1, 0.6, -0.6);
    }
    if (Math.random() < 0.4) this.smoke.emit(p.x, p.y + 1, p.z, rand(-0.5, 0.5), rand(1.5, 3), rand(-0.5, 0.5), 0.1, 0.1, 0.11, 0.45, rand(1.5, 2.5) * scale, rand(1, 1.8), -0.2, 0.5, 1.5);
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
    for (let i = 0; i < 5; i++) this.add.emit(p.x, p.y, p.z, dir.x * 18 + rand(-4, 4), dir.y * 18 + rand(-4, 4), dir.z * 18 + rand(-4, 4), _c.r * 1.6, _c.g * 1.6, _c.b * 1.6, 1, rand(0.1, 0.22), rand(0.06, 0.15), 0, 4, -0.5);
    this.flash(p, color, 6, 0.07, 14);
  },
  impact(p, n, color = 0xffd080) { this.spark(p, n, color, 9, 0.5); this.flash(p, color, 2.5, 0.08, 10); this.glowPuff(p, color, 1.2, 0.1); },
  ring(p, color, maxScale = 6, dur = 0.5, vertical = null, thick = 1) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: ringTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    m.position.copy(p); if (vertical) m.lookAt(p.clone().add(vertical));
    m.scale.setScalar(0.1);
    m.renderOrder = 11;
    this.scene.add(m);
    rings.push({ m, t: 0, dur, maxScale, thick });
  },
  explosion(p, size = 1) {
    const q = p.clone(); q.y = Math.max(q.y, 0.5);
    this.flash(q, 0xff8a30, 40 * size, 0.6, 50 * size);
    this.ring(new THREE.Vector3(q.x, 0.2, q.z), 0xffa050, 12 * size, 0.5);
    this.ring(new THREE.Vector3(q.x, 0.25, q.z), 0xffffff, 18 * size, 0.35);
    for (let i = 0; i < 60 * size; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(-0.2, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(4, 20) * size);
      this.add.emit(q.x, q.y, q.z, v.x, v.y, v.z, 2.5, rand(0.5, 1.3), 0.2, 1, rand(0.8, 2.2) * size, rand(0.4, 1.0), 4, 1.8, -0.4);
    }
    for (let i = 0; i < 24 * size; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(0, 1.5), rand(-1, 1)).normalize().multiplyScalar(rand(3, 12) * size);
      this.smoke.emit(q.x, q.y, q.z, v.x, v.y, v.z, 0.08, 0.08, 0.09, 0.6, rand(2, 4) * size, rand(1.2, 2.6), -0.5, 1.2, 2);
    }
    this.spark(q, 30 * size, 0xffcc66, 22 * size, 1.1);
    this.shake(1.1 * size);
  },
  flash(p, color, intensity = 5, dur = 0.1, dist = 20) {
    const l = lightPool[lightHead]; lightHead = (lightHead + 1) % lightPool.length;
    l.position.copy(p); l.color.set(color); l.distance = dist; l.userData.t = dur; l.userData.dur = dur; l.userData.peak = intensity * 6; l.intensity = intensity * 6;
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
    this.add.update(gdt); this.smoke.update(gdt);
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
