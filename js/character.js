import * as THREE from 'three';
import { G } from './state.js';
import { deg, lerp, smooth, clamp } from './util.js';
import { buildBody } from './charmodel.js';
export { makeLawgiver, makeBaton, makePistol, makeBat } from './props.js';

// ---------------------------------------------------------------------------
// Procedural humanoid rig + pose-based animation.
// The character faces +Z.  Character's left is +X, right is -X.
// Rotation conventions (limbs hang along -Y):  rotation.x < 0  swings the limb FORWARD.
// ---------------------------------------------------------------------------

const JOINTS = ['hips', 'torso', 'chest', 'head', 'shL', 'shR', 'elL', 'elR', 'wrL', 'wrR', 'hipL', 'hipR', 'knL', 'knR', 'anL', 'anR'];
const ZERO = () => { const o = {}; for (const j of JOINTS) o[j] = [0, 0, 0]; o.root = [0, 0, 0]; o.pos = [0, 0, 0]; return o; };

// Pose literal helper: degrees. Unspecified joints keep base.
const P = (o) => o;

export const CLIPS = {
  // ----- Dredd baton / gun melee: tuned keyframes (degrees) -----
  slashR: { dur: 0.46, hit: 0.5, side: 'L', frames: [
    [0.00, { torso: [8, 40, 0], shL: [-70, -20, 40], elL: [-100], hips: [0, 20, 0], pos: [0, 0, -0.1] }],
    [0.30, { torso: [10, 50, 0], shL: [-110, -30, 60], elL: [-60], hips: [0, 25, 0], pos: [0, 0, -0.1], hipL: [-15, 0, 0], hipR: [20, 0, 0], knR: [25] }],
    [0.52, { torso: [14, -45, 0], shL: [-80, 40, -10], elL: [-20], hips: [0, -30, 0], pos: [0, -0.05, 0.25], hipL: [-35, 0, 0], knL: [30], hipR: [20, 0, 0] }],
    [1.00, { torso: [8, -20, 0], shL: [-50, 20, 0], elL: [-60], hips: [0, -10, 0], pos: [0, 0, 0.1] }],
  ] },
  slashL: { dur: 0.46, hit: 0.5, side: 'L', frames: [
    [0.00, { torso: [8, -40, 0], shL: [-60, 50, -20], elL: [-80], hips: [0, -20, 0] }],
    [0.30, { torso: [10, -55, 0], shL: [-60, 70, -30], elL: [-50], hips: [0, -30, 0], hipR: [-15, 0, 0], hipL: [20, 0, 0] }],
    [0.52, { torso: [14, 50, 0], shL: [-90, -30, 20], elL: [-10], hips: [0, 30, 0], pos: [0, -0.05, 0.25], hipR: [-35, 0, 0], knR: [30] }],
    [1.00, { torso: [8, 20, 0], shL: [-50, 0, 0], elL: [-60], hips: [0, 10, 0] }],
  ] },
  overhead: { dur: 0.62, hit: 0.55, side: 'L', frames: [
    [0.00, { torso: [-10, 0, 0], shL: [-170, 0, 10], elL: [-50], shR: [-60, 0, 0], elR: [-60] }],
    [0.45, { torso: [-18, 0, 0], shL: [-195, 0, 10], elL: [-70], pos: [0, 0.08, -0.1], hipL: [-10, 0, 0], hipR: [15, 0, 0] }],
    [0.60, { torso: [32, 0, 0], shL: [-70, 0, 0], elL: [-15], pos: [0, -0.25, 0.35], hipL: [-45, 0, 0], knL: [45], hipR: [25, 0, 0], knR: [30] }],
    [1.00, { torso: [14, 0, 0], shL: [-40, 0, 0], elL: [-50], pos: [0, -0.1, 0.1] }],
  ] },
  thrust: { dur: 0.4, hit: 0.5, side: 'L', frames: [
    [0.00, { torso: [6, 35, 0], shL: [-60, 0, 0], elL: [-120], hips: [0, 15, 0] }],
    [0.45, { torso: [12, -20, 0], shL: [-90, 0, 0], elL: [-0], hips: [0, -15, 0], pos: [0, -0.1, 0.4], hipL: [-50, 0, 0], knL: [20], hipR: [30, 0, 0] }],
    [1.00, { torso: [8, 0, 0], shL: [-60, 0, 0], elL: [-60], pos: [0, 0, 0.1] }],
  ] },
  kick: { dur: 0.5, hit: 0.45, side: 'R', frames: [
    [0.00, { torso: [-8, 0, 0], hipR: [-40, 0, 0], knR: [70], shL: [-40, 20, 0], shR: [-30, -20, 0] }],
    [0.42, { torso: [-22, 0, 0], hipR: [-95, 0, 0], knR: [5], hipL: [10, 0, 0], pos: [0, 0, 0.1], shL: [-60, 30, 0], shR: [-30, -30, 0] }],
    [0.70, { torso: [-12, 0, 0], hipR: [-70, 0, 0], knR: [30], pos: [0, 0, 0.2] }],
    [1.00, { torso: [0, 0, 0], hipR: [-10, 0, 0], knR: [20] }],
  ] },
  gunbutt: { dur: 0.42, hit: 0.5, side: 'R', frames: [
    [0.00, { torso: [6, -40, 0], shR: [-50, 20, 0], elR: [-110], hips: [0, -20, 0] }],
    [0.45, { torso: [10, 45, 0], shR: [-90, -20, 30], elR: [-70], hips: [0, 25, 0], pos: [0, -0.05, 0.3], hipR: [-30, 0, 0] }],
    [1.00, { torso: [6, 10, 0], shR: [-60, 0, 0], elR: [-80] }],
  ] },
  spin: { dur: 0.7, hit: 0.5, side: 'L', frames: [
    [0.00, { torso: [10, 0, 0], shL: [-70, 40, 0], elL: [-50], pos: [0, -0.15, 0], hipL: [-25, 0, 0], knL: [40], hipR: [25, 0, 0], knR: [40] }],
    [0.5, { torso: [14, 180, 0], hips: [0, 180, 0], shL: [-90, 90, 0], elL: [0], shR: [-40, -80, 0], elR: [-20], pos: [0, -0.2, 0] }],
    [1.00, { torso: [8, 360, 0], hips: [0, 360, 0], shL: [-60, 0, 0], elL: [-60], pos: [0, 0, 0] }],
  ] },
  finisher: { dur: 1.0, hit: 0.62, side: 'L', frames: [
    [0.00, { torso: [-6, 0, 0], shL: [-195, 0, 15], elL: [-40], shR: [-110, -20, 0], elR: [-30], pos: [0, 0.12, 0], hipL: [-10, 0, 0], hipR: [10, 0, 0] }],
    [0.45, { torso: [-22, 0, 0], shL: [-215, 0, 20], elL: [-50], shR: [-120, -20, 0], elR: [-40], pos: [0, 0.3, 0] }],
    [0.62, { torso: [40, 0, 0], shL: [-60, 0, 0], elL: [-10], shR: [-60, -10, 0], elR: [-20], pos: [0, -0.35, 0.5], hipL: [-55, 0, 0], knL: [60], hipR: [30, 0, 0], knR: [40] }],
    [1.00, { torso: [18, 0, 0], shL: [-45, 0, 0], elL: [-50], pos: [0, -0.2, 0.2], hipL: [-30, 0, 0], knL: [40] }],
  ] },
  counter: { dur: 0.75, hit: 0.35, side: 'L', frames: [
    [0.00, { torso: [-4, 25, 0], shL: [-80, 30, 0], elL: [-80], hips: [0, 20, 0] }],
    [0.30, { torso: [10, -50, 0], shL: [-100, 20, 0], elL: [-20], hips: [0, -30, 0], pos: [0, -0.1, 0.3], hipL: [-30, 0, 0] }],
    [0.55, { torso: [-5, 60, 0], shL: [-140, 20, 20], elL: [-20], hips: [0, 40, 0], shR: [-60, -20, 0], elR: [-60] }],
    [1.00, { torso: [8, 0, 0], shL: [-50, 0, 0], elL: [-60] }],
  ] },
  punch: { dur: 0.4, hit: 0.5, side: 'R', frames: [
    [0.00, { torso: [4, -30, 0], shR: [-60, 0, 0], elR: [-110], hips: [0, -10, 0] }],
    [0.45, { torso: [10, 25, 0], shR: [-90, 0, 0], elR: [0], hips: [0, 15, 0], pos: [0, -0.05, 0.3] }],
    [1.00, { torso: [4, 0, 0], shR: [-40, 0, 0], elR: [-60] }],
  ] },
  swing: { dur: 0.7, hit: 0.5, side: 'R', frames: [
    [0.00, { torso: [-8, -30, 0], shR: [-150, 0, 0], elR: [-60], shL: [-30, 20, 0] }],
    [0.20, { torso: [-15, -45, 0], shR: [-170, 0, 0], elR: [-70], pos: [0, 0.05, 0] }],
    [0.50, { torso: [30, 40, 0], shR: [-70, -20, 0], elR: [-10], pos: [0, -0.15, 0.3] }],
    [1.00, { torso: [10, 10, 0], shR: [-50, 0, 0], elR: [-60] }],
  ] },
  shoot: { dur: 0.35, hit: 0.2, side: 'R', frames: [
    [0.00, { torso: [0, 0, 0], shR: [-90, 0, 0], elR: [-5] }],
    [0.20, { torso: [-4, 0, 0], shR: [-100, 0, 0], elR: [-5], pos: [0, 0, -0.05] }],
    [1.00, { torso: [0, 0, 0], shR: [-90, 0, 0], elR: [-5] }],
  ] },
  telegraph: { dur: 0.6, hit: 1.1, side: 'R', frames: [
    [0.00, { torso: [-4, -15, 0], shR: [-100, 10, 0], elR: [-90] }],
    [1.00, { torso: [-10, -35, 0], shR: [-160, 0, 0], elR: [-70] }],
  ] },
  hurt: { dur: 0.3, hit: 2, side: 'R', frames: [
    [0.00, { torso: [-24, 0, 0], head: [-18, 0, 0], pos: [0, 0, -0.2], shL: [-30, 30, 0], shR: [-30, -30, 0] }],
    [1.00, { torso: [0, 0, 0], head: [0, 0, 0] }],
  ] },
  dodge: { dur: 0.5, hit: 2, side: 'R', frames: [
    [0.00, { torso: [40, 0, 0], hipL: [-60, 0, 0], hipR: [-60, 0, 0], knL: [90], knR: [90], pos: [0, -0.5, 0], shL: [-60, 0, 0], shR: [-60, 0, 0], elL: [-90], elR: [-90] }],
    [1.00, { torso: [40, 0, 0], hipL: [-60, 0, 0], hipR: [-60, 0, 0], knL: [90], knR: [90], pos: [0, -0.5, 0], shL: [-60, 0, 0], shR: [-60, 0, 0], elL: [-90], elR: [-90] }],
  ] },
  surrender: { dur: 0.5, hit: 2, side: 'R', hold: true, frames: [
    [0.00, { torso: [0, 0, 0] }],
    [1.00, { torso: [6, 0, 0], head: [10, 0, 0], hipL: [-70, 10, 0], hipR: [-70, -10, 0], knL: [110], knR: [110], pos: [0, -0.55, 0], shL: [-165, 20, -20], shR: [-165, -20, 20], elL: [-100], elR: [-100] }],
  ] },
  subdued: { dur: 0.9, hit: 2, side: 'R', hold: true, frames: [
    [0.00, { torso: [0, 0, 0] }],
    [1.00, { root: [-88, 0, 0], torso: [0, 0, 0], pos: [0, -0.85, 0], shL: [-20, 20, 0], shR: [-20, -20, 0], hipL: [-20, 0, 0], knL: [30], hipR: [10, 0, 0], knR: [10] }],
  ] },
  getup: { dur: 0.7, hit: 2, side: 'R', frames: [
    [0.00, { root: [-88, 0, 0], pos: [0, -0.85, 0] }],
    [1.00, { root: [0, 0, 0], pos: [0, 0, 0] }],
  ] },
  die: { dur: 0.7, hit: 2, side: 'R', hold: true, frames: [
    [0.00, { torso: [0, 0, 0] }],
    [1.00, { root: [-90, 0, 0], pos: [0, -0.9, 0], torso: [10, 0, 0], head: [20, 0, 0], shL: [-20, 60, 0], shR: [-20, -60, 0], hipL: [10, 0, 0], hipR: [-10, 0, 0], knL: [20], knR: [10] }],
  ] },
};
// pre-convert degrees
for (const c of Object.values(CLIPS)) for (const f of c.frames) {
  const p = f[1];
  for (const k of Object.keys(p)) {
    if (k === 'pos') continue;
    p[k] = p[k].map(deg);
    while (p[k].length < 3) p[k].push(0);
  }
}

// ---------------------------------------------------------------------------
export const STYLES = {
  dredd: { scale: 0.9, bulk: 1.15, hero: true, eagle: true, gold: 0xd6a328, skin: 0xb98a6a, visor: 0xff3020 },
  // generic perps / civilians (js/chargeneric.js): colours come from seeded per-look palettes; opts may still pass
  // armor / under / skin / hair (hex) overrides, plus seed / variant (look index) / height
  thug: { scale: 0.86, bulk: 1.0 },
  gunman: { scale: 0.86, bulk: 1.0, glow: 0xff3418 },
  brute: { scale: 1.08, bulk: 1.45 },
  junkie: { scale: 0.84, bulk: 0.85, glow: 0x7dff3a },
  biker: { scale: 0.88, bulk: 1.05 },
  boss: { scale: 1.3, bulk: 1.55, glow: 0xff7a20 },
  civ: { scale: 0.82, bulk: 0.95 },
};
export const CHAR_HEIGHT = { dredd: 2.15, default: 2.1 }; // rig head-centre height per unit scale (see hit spheres)

export class Character {
  constructor(styleName = 'thug', opts = {}) {
    const st = { ...STYLES[styleName], ...opts };
    this.style = st; this.styleName = styleName;
    const S = st.scale;
    this.root = new THREE.Group();
    this.pivot = new THREE.Group(); this.pivot.position.y = 0.9 * S; this.root.add(this.pivot);
    this.rigRoot = new THREE.Group(); this.rigRoot.position.y = -0.9 * S; this.pivot.add(this.rigRoot);
    this.rigRoot.scale.setScalar(S);
    this.roll = 0;
    // ---- joint hierarchy (animation drives these) ----
    this.hips = new THREE.Group(); this.hips.position.y = 1.0; this.rigRoot.add(this.hips);
    this.torso = new THREE.Group(); this.torso.position.y = 0.1; this.hips.add(this.torso);       // lower spine (abdomen)
    this.chest = new THREE.Group(); this.chest.position.y = 0.3; this.torso.add(this.chest);       // upper spine: ribcage, shoulders, neck
    this.neck = new THREE.Group(); this.neck.position.set(0, 0.5, 0); this.chest.add(this.neck);
    this.head = new THREE.Group(); this.head.position.y = 0.05; this.neck.add(this.head);
    const mkArm = (sx) => {
      const sh = new THREE.Group(); sh.rotation.order = 'YXZ'; this.chest.add(sh);
      const el = new THREE.Group(); el.position.y = -0.38; sh.add(el);
      const wr = new THREE.Group(); wr.position.y = -0.38; el.add(wr);                              // wrist joint (hand + held props hang off it)
      const hand = new THREE.Group(); wr.add(hand);
      return { sh, el, wr, hand };
    };
    const aL = mkArm(1), aR = mkArm(-1);
    this.shL = aL.sh; this.elL = aL.el; this.wrL = aL.wr; this.handL = aL.hand; this.shR = aR.sh; this.elR = aR.el; this.wrR = aR.wr; this.handR = aR.hand;
    const mkLeg = () => {
      const hp = new THREE.Group(); hp.rotation.order = 'YXZ'; this.hips.add(hp);
      const kn = new THREE.Group(); kn.position.y = -0.46; hp.add(kn);
      const an = new THREE.Group(); an.position.y = -0.4; kn.add(an);                               // ankle joint (the boot hangs off it)
      return { hp, kn, an };
    };
    const lL = mkLeg(), lR = mkLeg();
    this.hipL = lL.hp; this.knL = lL.kn; this.anL = lL.an; this.hipR = lR.hp; this.knR = lR.kn; this.anR = lR.an;
    buildBody(this, styleName, st);

    // weapon anchors
    this.gunMount = new THREE.Group(); this.gunMount.rotation.x = deg(90); this.handR.add(this.gunMount);
    this.gunMount.position.y = -0.1;
    this.batonMount = new THREE.Group(); this.batonMount.position.y = -0.1; this.handL.add(this.batonMount);
    this.toolR = new THREE.Group(); this.toolR.position.y = -0.1; this.handR.add(this.toolR);

    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });

    // animation state
    this.phase = 0; this.speed = 0;
    this.base = ZERO(); this.cur = ZERO();
    this.clip = null; this.clipT = 0; this.clipW = 0; this.clipHold = false; this.clipSpeed = 1; this.events = [];
    this.aim = 0; this.aimPitch = 0; this.aimYaw = 0;
    this.override = null; // full-body override pose (e.g. riding)
    this.breath = Math.random() * 6;
    this.stepFoot = 0;
    this.rollT = -1;
  }

  // write a pose-array set onto the joint groups
  applyPose(cur) {
    this.hips.position.set(cur.pos[0], 1.0 + cur.pos[1], cur.pos[2]);
    this.hips.rotation.set(cur.hips[0], cur.hips[1], cur.hips[2]);
    this.rigRoot.rotation.set(cur.root[0], cur.root[1], cur.root[2]);
    this.pivot.rotation.x = this.roll;
    // the legacy 'torso' / 'head' pose keys are spread over the spine and neck chains, so every clip bends in an S-curve instead of hinging at the belt
    const T = cur.torso, C = cur.chest, hy = cur.head[1] - T[1] * 0.5 - cur.hips[1] * 0.4;
    this.torso.rotation.set(T[0] * 0.42, T[1] * 0.42, T[2] * 0.42);
    this.chest.rotation.set(T[0] * 0.58 + C[0], T[1] * 0.58 + C[1], T[2] * 0.58 + C[2]);
    this.neck.rotation.set(cur.head[0] * 0.4, hy * 0.4, cur.head[2] * 0.4);
    this.head.rotation.set(cur.head[0] * 0.6, hy * 0.6, cur.head[2] * 0.6);
    this.wrL.rotation.set(cur.wrL[0], cur.wrL[1], cur.wrL[2]); this.wrR.rotation.set(cur.wrR[0], cur.wrR[1], cur.wrR[2]);
    this.anL.rotation.set(cur.anL[0], cur.anL[1], cur.anL[2]); this.anR.rotation.set(cur.anR[0], cur.anR[1], cur.anR[2]);
    this.shL.rotation.set(cur.shL[0], cur.shL[1], cur.shL[2]); this.shR.rotation.set(cur.shR[0], cur.shR[1], cur.shR[2]);
    this.elL.rotation.set(cur.elL[0], 0, 0); this.elR.rotation.set(cur.elR[0], 0, 0);
    this.hipL.rotation.set(cur.hipL[0], cur.hipL[1], cur.hipL[2]); this.hipR.rotation.set(cur.hipR[0], cur.hipR[1], cur.hipR[2]);
    this.knL.rotation.set(Math.abs(cur.knL[0]), 0, 0); this.knR.rotation.set(Math.abs(cur.knR[0]), 0, 0);
  }

  play(name, { speed = 1, hold = false } = {}) {
    const c = CLIPS[name]; if (!c) return;
    this.clip = c; this.clipName = name; this.clipT = 0; this.clipSpeed = speed; this.hitFired = false; this.clipHold = !!c.hold;
    this.clipW = 0; this.clipDone = false;
  }
  stopClip() { this.clip = null; this.clipName = null; this.clipHold = false; }
  get clipActive() { return !!this.clip && !this.clipDone; }
  clipProgress() { return this.clip ? this.clipT / (this.clip.dur / this.clipSpeed) : 1; }

  // evaluate keyframes at normalised time k into target pose obj (partial)
  _evalClip(k, out) {
    const fr = this.clip.frames;
    let i = 0; while (i < fr.length - 2 && k > fr[i + 1][0]) i++;
    const [t0, p0] = fr[i], [t1, p1] = fr[Math.min(i + 1, fr.length - 1)];
    const u = t1 > t0 ? smooth(clamp((k - t0) / (t1 - t0), 0, 1)) : 1;
    const keys = new Set([...Object.keys(p0), ...Object.keys(p1)]);
    for (const j of keys) {
      if (j === 'pos') {
        const a = p0.pos || [0, 0, 0], b = p1.pos || [0, 0, 0];
        out.pos = [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
      } else {
        const a = p0[j] || [0, 0, 0], b = p1[j] || [0, 0, 0];
        out[j] = [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
      }
    }
  }

  update(dt, moving = {}) {
    this.events.length = 0;
    const B = this.base;
    for (const j of JOINTS) { B[j][0] = B[j][1] = B[j][2] = 0; }
    B.root[0] = B.root[1] = B.root[2] = 0; B.pos[0] = B.pos[1] = B.pos[2] = 0;
    // --- base locomotion ---
    const sp = this.speed; // m/s
    const run = clamp(sp / 7, 0, 1.2), walk = clamp(sp / 3, 0, 1);
    this.phase += dt * (sp * 1.35 + 0.0);
    this.breath += dt * 1.6;
    const ph = this.phase;
    const sw = Math.sin(ph * 1.8), sw2 = Math.sin(ph * 1.8 + Math.PI);
    const amp = lerp(0.45, 1.0, run) * walk;
    B.hipL[0] = sw * amp; B.hipR[0] = sw2 * amp;
    B.knL[0] = Math.max(0, -sw) * 1.1 * walk * (0.6 + run); B.knR[0] = Math.max(0, -sw2) * 1.1 * walk * (0.6 + run);
    B.shL[0] = sw2 * 0.5 * amp * (this.style.eagle ? 0.6 : 1); B.shR[0] = sw * 0.5 * amp * (this.style.eagle ? 0.6 : 1);
    B.elL[0] = -0.3 - run * 0.8; B.elR[0] = -0.3 - run * 0.8;
    B.shL[2] = 0.06; B.shR[2] = -0.06;
    B.torso[0] = run * 0.2 + Math.sin(this.breath) * 0.012; B.torso[1] = sw * 0.12 * amp;
    B.hips[1] = -sw * 0.1 * amp;
    B.pos[1] = -Math.abs(Math.cos(ph * 1.8)) * 0.06 * walk + Math.sin(this.breath) * 0.004 - (1 - walk) * 0.0;
    B.head[0] = -run * 0.1;
    if (this.style.eagle) { // Dredd: gun arm held low-ready, baton arm hip
      B.shR[0] = -0.7 + sw * 0.1 * amp; B.elR[0] = -1.0; B.shR[2] = -0.12;
      B.shL[0] = -0.2 + sw2 * 0.25 * amp; B.elL[0] = -0.9;
      B.hipL[2] = 0.04; B.hipR[2] = -0.04;
      B.pos[1] -= 0.03;
    } else if (this.stance === 'ready') {
      B.shR[0] = -0.6; B.elR[0] = -1.2; B.shL[0] = -0.6; B.elL[0] = -1.2;
    }
    // aiming: right arm points the gun along the aim pitch, torso twists toward it
    if (this.aim > 0.01) {
      const a = this.aim;
      B.shR[0] = lerp(B.shR[0], -deg(90) - this.aimPitch, a); B.shR[1] = lerp(B.shR[1], 0.08, a); B.shR[2] = lerp(B.shR[2], 0, a);
      B.elR[0] = lerp(B.elR[0], -0.08, a);
      B.shL[0] = lerp(B.shL[0], -0.45, a); B.elL[0] = lerp(B.elL[0], -1.2, a);
      B.torso[0] = lerp(B.torso[0], -this.aimPitch * 0.3 + 0.05, a);
      B.head[0] += -this.aimPitch * 0.4 * a;
      B.torso[1] = lerp(B.torso[1], 0.12, a);
    }
    if (this.override) this.override(B, dt);

    // --- clip overlay ---
    const cur = this.cur;
    for (const j of JOINTS) { cur[j][0] = B[j][0]; cur[j][1] = B[j][1]; cur[j][2] = B[j][2]; }
    cur.root[0] = B.root[0]; cur.root[1] = B.root[1]; cur.root[2] = B.root[2];
    cur.pos[0] = B.pos[0]; cur.pos[1] = B.pos[1]; cur.pos[2] = B.pos[2];
    if (this.clip) {
      const dur = this.clip.dur / this.clipSpeed;
      this.clipT += dt;
      const k = Math.min(1, this.clipT / dur);
      const tmp = {}; this._evalClip(k, tmp);
      // weight: ease in quickly, ease out at the end (unless hold)
      let w = 1;
      if (!this.clipHold) { const inW = clamp(this.clipT / 0.07, 0, 1), outW = clamp((1 - k) / 0.22, 0, 1); w = Math.min(inW, outW); }
      else w = clamp(this.clipT / 0.12, 0, 1);
      this.clipW = w;
      const sideJoints = this.clip.side === 'L';
      for (const j in tmp) {
        if (j === 'pos') { for (let q = 0; q < 3; q++) cur.pos[q] = lerp(cur.pos[q], B.pos[q] + tmp.pos[q], w); continue; }
        if (j === 'root') { for (let q = 0; q < 3; q++) cur.root[q] = lerp(cur.root[q], tmp.root[q], w); continue; }
        for (let q = 0; q < 3; q++) cur[j][q] = lerp(cur[j][q], tmp[j][q], w);
      }
      // fire hit event
      if (!this.hitFired && k >= this.clip.hit) { this.hitFired = true; this.events.push('hit'); }
      if (k >= 1 && !this.clipDone) { this.clipDone = true; this.events.push('done'); if (!this.clipHold) { this.clip = null; } }
    }
    // --- apply ---
    this.applyPose(cur);
    // footstep events
    if (walkStep(this, sp)) this.events.push('step');
    return this.events;
  }
}

function walkStep(c, sp) {
  if (sp < 1.2) return false;
  const s = Math.sin(c.phase * 1.8);
  const sign = s >= 0 ? 1 : -1;
  if (sign !== c.stepFoot) { const had = c.stepFoot !== 0; c.stepFoot = sign; return had; }
  return false;
}

