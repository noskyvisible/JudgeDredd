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

// The animation system lives in animcore.js (splines, IK, springs), animloco.js (procedural gait)
// and animclips.js (keyframed clips); Character.update() layers them:
//   locomotion + carriage + aim  ->  clip overlay  ->  pelvis springs  ->  leg IK (or clip FK legs)
//   ->  transition inertialisation  ->  secondary springs  ->  look-at  ->  joints
import { CLIPS, pickClip, FIDGETS } from './animclips.js';
import { CI, NJ, NF, makePose, evalClip, m3EulerXYZ, m3EulerYXZ, m3Mul, m3TMul, m3RotX, eulerXYZ, solveTwoBone, SpringBank, wrapPi, wobble, TAU } from './animcore.js';
import { Gait, PERSONA, STANCE } from './animloco.js';
export { CLIPS };

const _mH = new Float64Array(9), _mA = new Float64Array(9), _mB = new Float64Array(9), _mK = new Float64Array(9), _mF = new Float64Array(9);
const _M = [0, 1, 2, 3, 4, 5, 6, 7].map(() => new THREE.Matrix4()), _Mi = new THREE.Matrix4();
const _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3(), _p3 = new THREE.Vector3(), _p4 = new THREE.Vector3();
const smooth01 = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const LIN = (i) => i >= 3 && i < 6;   // flat-buffer indices of the 'pos' channel (distances, never wrapped)

// joint lengths, hip offsets and boot geometry, read off the built model so IK matches whatever body the model code makes
function measureRig(ch) {
  const hipX = Math.abs(ch.hipL.position.x) || 0.17, hipY = ch.hipL.position.y || -0.08;
  const thigh = Math.abs(ch.knL.position.y) || 0.46, shin = Math.abs(ch.anL.position.y) || 0.4;
  let minY = -0.075, minZ = -0.11, maxZ = 0.26, any = false;
  const box = new THREE.Box3(), tmp = new THREE.Box3();
  for (const m of ch.anL.children) {
    if (!m.isMesh || !m.geometry) continue;
    m.updateMatrix(); m.geometry.computeBoundingBox();
    tmp.copy(m.geometry.boundingBox).applyMatrix4(m.matrix);
    if (any) box.union(tmp); else { box.copy(tmp); any = true; }
  }
  if (any) { minY = box.min.y; minZ = box.min.z; maxZ = box.max.z; }
  const footH = clamp(-minY, 0.04, 0.13);
  return { hipX, hipY, thigh, shin, footH, heel: clamp(-minZ - 0.02, 0.04, 0.2), ball: clamp(maxZ - 0.085, 0.08, 0.26), toe: clamp(maxZ, 0.1, 0.4), legLen: thigh + shin + footH };
}

// secondary-motion springs: index -> [omega, zeta, limit]
const SPR = [
  [9, 0.42, 0.55], [8, 0.42, 0.55], [9, 0.42, 0.5],       // 0-2  chest pitch / yaw / roll
  [11, 0.36, 0.7], [10, 0.36, 0.8], [11, 0.36, 0.6],      // 3-5  head pitch / yaw / roll
  [8, 0.32, 0.9], [8, 0.32, 0.7], [8, 0.32, 0.9], [8, 0.32, 0.7], // 6-9 shL x/z, shR x/z
  [10, 0.33, 0.9], [10, 0.33, 0.9],                        // 10-11 elbows
  [12, 0.5, 0.18], [12, 0.5, 0.18], [12, 0.5, 0.18],       // 12-14 pelvis offset
  [10, 0.45, 0.35], [10, 0.45, 0.35],                      // 15-16 pelvis pitch / roll
  [14, 0.3, 0.7], [14, 0.3, 0.7],                          // 17-18 wrists
  [9, 0.28, 0.5], [9, 0.28, 0.5], [9, 0.28, 0.6], [9, 0.28, 0.6], // 19-22 legs (only while lying down)
  [9, 0.45, 0.35],                                         // 23 pelvis yaw
];
function makeSprings() { const s = new SpringBank(SPR.length); SPR.forEach(([w, z, l], i) => s.set(i, w, z, l)); return s; }

// ---------------------------------------------------------------------------
export const STYLES = {
  dredd: { scale: 0.9, bulk: 1.15, hero: true, eagle: true, gold: 0xd6a328, skin: 0xb98a6a, visor: 0xff3020 },
  thug: { scale: 0.86, bulk: 1.0, armor: 0x5a3a2a, under: 0x2a2a3a, gold: 0x777777, skin: 0xc09070, hair: 0x2a1a10, boots: 0x15151a },
  gunman: { scale: 0.86, bulk: 1.0, armor: 0x2a3a4a, under: 0x1a1a24, gold: 0x999999, skin: 0xa07860, hair: 0x111111, boots: 0x101015, mask: 0x111111 },
  brute: { scale: 1.08, bulk: 1.45, armor: 0x4a4a52, under: 0x2a2020, gold: 0xb04a2a, skin: 0x9a7a6a, hair: 0x000000, boots: 0x101010, plates: 0x6a6a74 },
  junkie: { scale: 0.82, bulk: 0.85, armor: 0x2a5a4a, under: 0x3a2a4a, gold: 0x5aff9a, skin: 0xb0a080, hair: 0x80ff40, boots: 0x202030 },
  biker: { scale: 0.88, bulk: 1.05, armor: 0x5a1a22, under: 0x1a1218, gold: 0xaa2a3a, skin: 0xa07860, hair: 0x111111, boots: 0x0a0a0a, helmetCol: 0x7a1a28 },
  boss: { scale: 1.3, bulk: 1.55, armor: 0x6a1a1a, under: 0x1a1010, gold: 0xe8b52a, skin: 0x8a6a5a, hair: 0x000000, boots: 0x0a0a0a, plates: 0x8a2222, mask: 0xaa1111 },
  civ: { scale: 0.82, bulk: 0.95, armor: 0x3a4a6a, under: 0x2a2a3a, gold: 0x888888, skin: 0xc09070, hair: 0x3a2a1a, boots: 0x202025 },
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

    // ---- animation state ----
    this.speed = 0;
    this.base = makePose(); this.cur = makePose();
    this.clip = null; this.clipName = null; this.clipT = 0; this.clipW = 0; this.clipHold = false; this.clipSpeed = 1; this.clipDone = false; this.hitFired = false;
    this.events = [];
    this.aim = 0; this.aimPitch = 0; this.aimYaw = 0;
    this.override = null;   // full-body override pose (e.g. riding)
    this.stance = null;     // null | 'relaxed' | 'ready' (combat guard) | 'panic' (civilian flail)
    this.hipFire = false;   // aim from the hip instead of the eye line
    this.treadmill = false; // tools: animate ch.speed in place while the root stays put
    this.ground = null;     // 'back' | 'front' | 'side' while lying on the floor
    this.time = Math.random() * 50;
    this.geo = measureRig(this);
    this.persona = PERSONA[st.eagle ? 'dredd' : styleName] || PERSONA.default;
    this.gait = new Gait(this.geo, this.persona);
    this.spr = makeSprings();
    this._cb = new Float64Array(NF); this._lb = new Float64Array(NF);
    this._out = new Float64Array(NJ * 3); this._outV = new Float64Array(NJ * 3); this._hasOut = false;
    this._ix = new Float64Array(NJ * 3); this._iv = new Float64Array(NJ * 3); this._iT = 99; this._iW = 18; this._iPend = false;
    this._src = new Float64Array(10); this._srcV = new Float64Array(10); this._srcA = new Float64Array(10); this._srcNew = new Float64Array(10); this._srcOk = 0;
    this._m = { px: 0, pz: 0, yaw: 0, init: false, dtPrev: 1 / 60 };
    this._inp = { vx: 0, vz: 0, w: 0, intended: 0, tele: true, S };
    this._gopt = { stance: null, ready: false, noCycle: false, freezeFeet: false };
    this._look = new THREE.Vector3(); this._hasLook = false; this._lookW = 0; this._lookA = 0; this._lookP = 0;
    this._scan = { t: 2 + Math.random() * 5, yaw: 0, pitch: 0, on: false };
    this._linger = null; this._lingerT = 0;
    this._fid = null; this._fidT = 0; this._fidNext = 2 + Math.random() * 6;
    this._impact = false; this._nan = 0;
    this._dispRoll = 0; this._pivY = 0.9; this._cY = 0.9; this._lift = 0;
    this._seed = Math.random() * 10;
    this._fo = new Float64Array(6);   // foot spots (x, z, yaw) captured when the current clip started
  }
  get phase() { return this.gait.phase; }
  set phase(v) { this.gait.phase = v; }

  // seconds for one full left + right stride at the current speed
  cyclePeriod() { return this.gait.periodFor(this.gait.cyc ? this.gait.spd : this.speed, this.style.scale); }

  // write a pose-array set onto the joint groups
  applyPose(cur) {
    this.hips.position.set(cur.pos[0], 1.0 + cur.pos[1], cur.pos[2]);
    this.hips.rotation.set(cur.hips[0], cur.hips[1], cur.hips[2]);
    this.rigRoot.rotation.set(cur.root[0], cur.root[1], cur.root[2]);
    const S = this.style.scale;
    this.pivot.position.y = this._pivY * S; this.rigRoot.position.y = -this._cY * S + this._lift;
    this.pivot.rotation.x = this.override ? this.roll : this._dispRoll;
    // the legacy 'torso' / 'head' pose keys are spread over the spine and neck chains, so every clip bends in an S-curve instead of hinging at the belt
    const T = cur.torso, C = cur.chest, hy = cur.head[1] - T[1] * 0.5 - cur.hips[1] * 0.4;
    this.torso.rotation.set(T[0] * 0.42, T[1] * 0.42, T[2] * 0.42);
    this.chest.rotation.set(T[0] * 0.58 + C[0], T[1] * 0.58 + C[1], T[2] * 0.58 + C[2]);
    this.neck.rotation.set(cur.head[0] * 0.4, hy * 0.4, cur.head[2] * 0.4);
    this.head.rotation.set(cur.head[0] * 0.6, hy * 0.6, cur.head[2] * 0.6);
    this.wrL.rotation.set(cur.wrL[0], cur.wrL[1], cur.wrL[2]); this.wrR.rotation.set(cur.wrR[0], cur.wrR[1], cur.wrR[2]);
    this.anL.rotation.set(cur.anL[0], cur.anL[1], cur.anL[2]); this.anR.rotation.set(cur.anR[0], cur.anR[1], cur.anR[2]);
    this.shL.rotation.set(cur.shL[0], cur.shL[1], cur.shL[2]); this.shR.rotation.set(cur.shR[0], cur.shR[1], cur.shR[2]);
    // elbows and knees only ever flex (never hyperextend)
    this.elL.rotation.set(clamp(cur.elL[0], -2.7, 0), 0, 0); this.elR.rotation.set(clamp(cur.elR[0], -2.7, 0), 0, 0);
    this.hipL.rotation.set(cur.hipL[0], cur.hipL[1], cur.hipL[2]); this.hipR.rotation.set(cur.hipR[0], cur.hipR[1], cur.hipR[2]);
    this.knL.rotation.set(Math.min(2.75, Math.abs(cur.knL[0])), 0, 0); this.knR.rotation.set(Math.min(2.75, Math.abs(cur.knR[0])), 0, 0);
  }

  // play(name, { speed, dir }) — dir: hit / fall direction in character space (THREE.Vector3 or [x, y, z]); picks directional variants
  play(name, { speed = 1, hold = false, dir = null } = {}) {
    const c = pickClip(name, dir, this); if (!c) return;
    this.clip = c; this.clipName = name; this.clipT = 0; this.clipSpeed = speed > 0 ? speed : 1; this.hitFired = false; this.clipHold = !!c.hold;
    this.clipW = 0; this.clipDone = false; this._linger = null; this._fid = null; this._impact = false;
    // clip foot targets are offsets from where the feet are now (unless the clip places them absolutely)
    const F = this._fo, ft = this.gait.feet;
    for (let i = 0; i < 2; i++) { F[i * 3] = ft[i].x; F[i * 3 + 1] = ft[i].z; F[i * 3 + 2] = ft[i].yaw; }
    this._transition(c.blend);
  }
  stopClip() {
    if (this.clip || this._linger || this.ground) this._transition(0.16);
    this.clip = null; this.clipName = null; this.clipHold = false; this._linger = null; this.ground = null;
  }
  get clipActive() { return !!this.clip && !this.clipDone; }
  clipProgress() { return this.clip ? this.clipT / (this.clip.dur / this.clipSpeed) : 1; }
  _transition(blend) { this._iPend = true; this._iW = 4.6 / clamp(blend || 0.13, 0.04, 0.6); }

  // Kick the secondary-motion springs: dir is the push direction in character space (a shot from the front is (0,0,-1)),
  // strength ~0.3 (graze) .. 1 (solid hit) .. 2+ (blast).
  impulse(dir, strength = 1) {
    let x = 0, z = -1;
    if (dir) { if (Array.isArray(dir)) { x = +dir[0] || 0; z = +dir[2] || 0; } else { x = +dir.x || 0; z = +dir.z || 0; } }
    const l = Math.hypot(x, z); if (l > 1e-6) { x /= l; z /= l; } else { x = 0; z = -1; }
    const s = clamp(+strength || 0, 0, 3), V = this.spr.v, r1 = Math.random() - 0.5, r2 = Math.random() - 0.5;
    V[0] += z * 3.4 * s; V[2] -= x * 3.2 * s; V[1] += (x * 2.4 + r1 * 1.8) * s;   // chest rocks with the push, bends and twists away
    V[3] += z * 4.6 * s * (0.75 + 0.5 * Math.random()); V[4] += (x * 2.6 + r2 * 1.2) * s; V[5] -= x * 3.6 * s;   // head whips
    V[6] += z * 4.2 * s; V[8] += z * 4.2 * s;                                      // arms fling on inertia
    V[7] -= (x * 3.6 - 1.2 * Math.random()) * s; V[9] -= (x * 3.6 + 1.2 * Math.random()) * s;
    V[10] -= 2.6 * s; V[11] -= 2.6 * s; V[17] += r1 * 4 * s; V[18] += r2 * 4 * s;
    V[12] += x * 0.7 * s; V[14] += z * 0.7 * s; V[13] -= 0.4 * s;                 // pelvis shoved, knees give
    V[15] += z * 1.3 * s; V[16] -= x * 1.6 * s; V[23] += (x * 0.8 + r1) * s;
    if (this.ground) { V[19] += r1 * 3 * s; V[20] -= r2 * 3 * s; V[21] += 2 * s * Math.random(); V[22] += 2 * s * Math.random(); }
  }

  // Head / neck look-at (world position or null); smoothed, limited, and the chest helps for big turns.
  lookAt(p) {
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) { this._look.set(p.x, p.y, p.z); this._hasLook = true; }
    else this._hasLook = false;
  }
  // world direction -> character-space direction (for impulse / play dir)
  localDir(w, out = new THREE.Vector3()) {
    const yaw = this.root.rotation.y, s = Math.sin(yaw), c = Math.cos(yaw);
    return out.set(w.x * c - w.z * s, w.y || 0, w.x * s + w.z * c);
  }

  // ------------------------------------------------------------------------------------------ per frame
  update(dt, moving = {}) {
    const ev = this.events; ev.length = 0;
    if (!(dt > 0)) { this.applyPose(this.cur); return ev; }
    if (dt > 0.1) dt = 0.1;
    this.time += dt;
    if (this.override) return this._updateOverride(dt);
    const B = this.base, cur = this.cur, buf = cur.buf, g = this.gait;
    B.buf.fill(0);
    const inp = this._inp; this._measure(dt, inp);
    // clip clock first: the aim layer needs the shoot clip's weight
    const C = this.clip;
    let k = 0, w = 0;
    if (C) {
      this.clipT += dt;
      k = Math.min(1, this.clipT / (C.dur / this.clipSpeed));
      w = !this.clipHold && C.out > 0 ? smooth01((1 - k) / C.out) : 1;
      this.clipW = w;
    }
    // ---- locomotion + carriage + aim
    const go = this._gopt;
    go.stance = this._stanceDef(); go.ready = this.stance === 'ready' || this.aim > 0.5;
    go.freezeFeet = (C && w > 0.05 && (C.legFK[0] || C.legFK[1] || C.legIK[0] || C.legIK[1])) || this.ground !== null || this.roll !== 0;
    go.noCycle = !!(C && w > 0.5 && C.legFK[0] && C.legFK[1]) || this.ground !== null;
    g.update(dt, inp, B, go);
    this._carriage(dt, B);
    const aimW = Math.max(this.aim, C && C.aimArm ? w : 0);
    if (aimW > 0.001) this._aimLayer(B, aimW);
    // ---- clip overlay
    buf.set(B.buf);
    if (C) {
      const cb = this._cb;
      evalClip(C, k, cb);
      if (C.proc) C.proc(this, k, this.clipT, cb, C);
      this._blend(C, cb, w, buf, B.buf);
      if (!this.hitFired && k >= C.hit) { this.hitFired = true; ev.push('hit'); }
      if (C.impact !== undefined && !this._impact && k >= C.impact) this._land(C);
      if (k >= 1 && !this.clipDone) {
        this.clipDone = true; ev.push('done');
        if (C.stand) this.ground = null;
        if (!this.clipHold) { if (C.linger) { this._linger = C; this._lingerT = 0; } else if (!(C.out > 0.05)) this._transition(C.endBlend || 0.14); this.clip = null; }
      }
    } else if (this._linger) {
      const L = this._linger; this._lingerT += dt;
      const lw = 1 - smooth01((this._lingerT - L.linger) / 0.25);
      if (lw <= 0) this._linger = null;
      else { evalClip(L, 1, this._lb); this._blend(L, this._lb, lw, buf, B.buf); }
    } else this._fidget(dt, buf);
    // ---- pelvis springs go in before the IK so planted feet stay planted
    this._springDrive(dt);
    const X = this.spr.x;
    buf[3] += X[12]; buf[4] += X[13]; buf[5] += X[14]; buf[6] += X[15]; buf[7] += X[23]; buf[8] += X[16];
    // ---- legs: IK onto the feet (locomotion or clip targets), clip FK legs blended on top
    this._legs(cur, C, w);
    this._footSync(cur, C, w);
    // ---- transitions, secondary motion, look-at
    this._inertia(dt, buf);
    this._record(dt, buf);
    this._lookLayer(dt, cur, C);
    this._springApply(cur);
    this._rollPivot();
    this._floorFix(cur, dt);
    for (let i = 0; i < NJ * 3; i++) if (!(buf[i] === buf[i]) || buf[i] > 1e3 || buf[i] < -1e3) { buf[i] = 0; this._nan++; this._hasOut = false; }
    this.applyPose(cur);
    if (g.strike > 0 && g.spd > 1.0) ev.push('step');
    return ev;
  }

  _updateOverride(dt) {
    const B = this.base, cur = this.cur, ev = this.events, buf = cur.buf;
    B.buf.fill(0);
    this.override(B, dt);
    buf.set(B.buf);
    const C = this.clip;
    if (C) {
      this.clipT += dt;
      const k = Math.min(1, this.clipT / (C.dur / this.clipSpeed));
      const w = !this.clipHold && C.out > 0 ? smooth01((1 - k) / C.out) : 1;
      this.clipW = w;
      evalClip(C, k, this._cb);
      this._blend(C, this._cb, w, buf, B.buf, true);
      if (!this.hitFired && k >= C.hit) { this.hitFired = true; ev.push('hit'); }
      if (k >= 1 && !this.clipDone) { this.clipDone = true; ev.push('done'); if (!this.clipHold) this.clip = null; }
    }
    this._m.init = false; this._hasOut = false; this._dispRoll = 0; this._pivY = 0.9; this._cY = 0.9;
    this.applyPose(cur);
    return ev;
  }

  _blend(C, cb, w, buf, base, legsToo) {
    const ch = C.chans, add = C.additive;
    for (let j = 0; j < ch.length; j++) {
      const ci = ch[j];
      if (ci >= 12 && ci <= 17 && !legsToo) continue;   // FK legs are blended over the IK solution
      const o = ci * 3;
      if (ci >= 18 && !C.feetAbs) {
        // foot targets: offsets from the feet at clip start (x, lift, z) / (pitch, yaw offset, roll)
        const F = this._fo, s = (ci - 18) & 1;
        if (ci < 20) { buf[o] += (F[s * 3] + cb[o] - buf[o]) * w; buf[o + 1] += (cb[o + 1] - buf[o + 1]) * w; buf[o + 2] += (F[s * 3 + 1] + cb[o + 2] - buf[o + 2]) * w; }
        else { buf[o] += (cb[o] - buf[o]) * w; buf[o + 1] += (F[s * 3 + 2] + cb[o + 1] - buf[o + 1]) * w; buf[o + 2] += (cb[o + 2] - buf[o + 2]) * w; }
        continue;
      }
      if (add) { buf[o] += cb[o] * w; buf[o + 1] += cb[o + 1] * w; buf[o + 2] += cb[o + 2] * w; }
      else if (ci === 1) { buf[o] = base[o] + cb[o] * w; buf[o + 1] = base[o + 1] + cb[o + 1] * w; buf[o + 2] = base[o + 2] + cb[o + 2] * w; }
      else { buf[o] += (cb[o] - buf[o]) * w; buf[o + 1] += (cb[o + 1] - buf[o + 1]) * w; buf[o + 2] += (cb[o + 2] - buf[o + 2]) * w; }
    }
  }

  // root motion since the last update (the game moves the root right after update(), so this is last frame's motion, used as the
  // prediction for this one: exact at constant velocity)
  _measure(dt, inp) {
    const r = this.root, M = this._m, px = r.position.x, pz = r.position.z, yaw = r.rotation.y;
    let mvx = 0, mvz = 0, w = 0, tele = !M.init;
    if (M.init) {
      const dx = px - M.px, dz = pz - M.pz, dyw = wrapPi(yaw - M.yaw), d = Math.hypot(dx, dz);
      if (!(d < 2.5) || Math.abs(dyw) > 2.5) tele = true;
      else { const it = 1 / Math.max(1e-3, M.dtPrev), s = Math.sin(yaw), c = Math.cos(yaw); mvx = (dx * c - dz * s) * it; mvz = (dx * s + dz * c) * it; w = dyw * it; }
    }
    M.px = px; M.pz = pz; M.yaw = yaw; M.init = true; M.dtPrev = dt;
    const want = this.speed > 0 ? this.speed : 0;
    if (want > 0.2 && (this.treadmill || Math.hypot(mvx, mvz) < 0.02)) { mvx = 0; mvz = want; }
    inp.vx = mvx; inp.vz = mvz; inp.w = w; inp.intended = want; inp.tele = tele;
    if (tele) { this._hasOut = false; this.spr.reset(); this._srcOk = 0; }
  }

  _stanceDef() {
    const s = this.stance;
    if (this.aim > 0.5 && !this.hipFire) return STANCE.aim;
    if (s === 'ready') return STANCE.ready;
    if (s === 'panic' || s === 'cower') return STANCE.cower;
    if (this.style.eagle) return STANCE.dredd;
    if (this.persona.heavy >= 1) return STANCE.wide;
    return STANCE.relaxed;
  }

  // style-specific carriage of the arms on top of the gait's natural swing
  _carriage(dt, B) {
    const g = this.gait, mw = g.mw, iw = 1 - mw, rw = g.runW, t = this.time;
    const sw = Math.cos(TAU * (g.phase - 0.05)), amp = mw * clamp(g.spd / 1.6, 0.25, 1);
    if (this.style.eagle) {
      // Dredd: Lawgiver at low-ready, daystick hand riding by the belt, chest out
      const breath = Math.sin(t * 1.55 + this._seed);
      B.shR[0] = lerp(-0.34, -0.62, rw) - sw * 0.09 * amp - 0.015 * breath * iw; B.shR[1] = 0.12 + 0.05 * rw; B.shR[2] = -0.12 - 0.05 * rw;
      B.elR[0] = lerp(-0.92, -1.45, rw) + 0.04 * breath * iw;
      B.wrR[0] = 0.16; B.wrR[1] = 0; B.wrR[2] = 0.05;
      B.shL[0] = lerp(-0.06, -0.3, rw) + sw * lerp(0.3, 0.55, rw) * amp; B.shL[1] = -0.06; B.shL[2] = 0.17 + 0.03 * rw;
      B.elL[0] = lerp(-0.62, -1.5, rw) - Math.max(0, sw) * 0.3 * amp;
      B.wrL[0] = -0.3; B.wrL[1] = 0; B.wrL[2] = 0;
      B.chest[0] -= 0.035 * iw; B.torso[0] += 0.02;
      return;
    }
    const tool = this.toolR.children.length > 0 && this.toolR.children[0].visible;
    const gun = this.gunMount.children.length > 0 && this.gunMount.children[0].visible;
    const stK = g.stanceK, gw = stK * (1 - rw);
    if (this.stance === 'panic') {
      // civilians in a panic: arms thrown up and flailing, head ducked
      const f1 = wobble(t * 7.5, this._seed), f2 = wobble(t * 8.3, this._seed + 2), f3 = wobble(t * 11, this._seed + 4);
      const up = lerp(0.6, 1, mw);
      B.shL[0] = lerp(B.shL[0], -2.3 + f1 * 0.7, up); B.shL[2] = lerp(B.shL[2], 0.45 + f2 * 0.35, up); B.shL[1] = 0.2 * f3;
      B.shR[0] = lerp(B.shR[0], -2.2 + f2 * 0.7, up); B.shR[2] = lerp(B.shR[2], -0.45 + f3 * 0.35, up); B.shR[1] = -0.2 * f1;
      B.elL[0] = -1.1 + f3 * 0.5; B.elR[0] = -1.2 + f1 * 0.5; B.wrL[0] = -0.4 * f2; B.wrR[0] = 0.4 * f3;
      B.torso[0] += 0.12 * mw + 0.06; B.head[0] += 0.12 + 0.08 * f2; B.head[1] += 0.25 * f1 * mw;
      return;
    }
    if (gw > 0.01) {
      // combat guard
      const bob = Math.sin(t * 5.2 + this._seed) * 0.03 * iw;
      if (tool) { // bat cocked over the shoulder, free hand up
        B.shR[0] = lerp(B.shR[0], -1.55 + bob, gw); B.shR[1] = lerp(B.shR[1], 0.35, gw); B.shR[2] = lerp(B.shR[2], -0.55, gw); B.elR[0] = lerp(B.elR[0], -1.75, gw); B.wrR[0] = lerp(B.wrR[0], -0.5, gw);
        B.shL[0] = lerp(B.shL[0], -0.85 + bob, gw); B.shL[1] = lerp(B.shL[1], -0.3, gw); B.shL[2] = lerp(B.shL[2], 0.2, gw); B.elL[0] = lerp(B.elL[0], -1.75, gw); B.wrL[0] = lerp(B.wrL[0], -0.3, gw);
      } else if (gun) { // pistol low-ready, support hand near the chest
        B.shR[0] = lerp(B.shR[0], -0.75, gw); B.shR[1] = lerp(B.shR[1], -0.15, gw); B.shR[2] = lerp(B.shR[2], -0.08, gw); B.elR[0] = lerp(B.elR[0], -0.55, gw); B.wrR[0] = lerp(B.wrR[0], 0.15, gw);
        B.shL[0] = lerp(B.shL[0], -0.55, gw); B.shL[1] = lerp(B.shL[1], -0.35, gw); B.shL[2] = lerp(B.shL[2], 0.12, gw); B.elL[0] = lerp(B.elL[0], -1.55, gw);
      } else { // fists
        B.shL[0] = lerp(B.shL[0], -0.95 + bob, gw); B.shL[1] = lerp(B.shL[1], -0.32, gw); B.shL[2] = lerp(B.shL[2], 0.22, gw); B.elL[0] = lerp(B.elL[0], -1.95, gw); B.wrL[0] = lerp(B.wrL[0], -0.35, gw);
        B.shR[0] = lerp(B.shR[0], -0.7 - bob, gw); B.shR[1] = lerp(B.shR[1], 0.3, gw); B.shR[2] = lerp(B.shR[2], -0.22, gw); B.elR[0] = lerp(B.elR[0], -2.05, gw); B.wrR[0] = lerp(B.wrR[0], -0.35, gw);
      }
      B.torso[0] += 0.1 * gw; B.head[0] += 0.05 * gw;
      B.pos[1] += bob * 0.4;
    } else {
      if (tool) { B.shR[0] = B.shR[0] * 0.5 - 0.06; B.elR[0] = -(0.3 + 0.5 * rw); B.wrR[0] = 0.85 - (B.shR[0] + B.elR[0]) * 0.5; B.shR[2] -= 0.06; }   // bat carried low, pointing down-forward
      if (gun) { B.shR[0] = B.shR[0] * 0.5 - 0.3; B.elR[0] -= 0.45; B.wrR[0] = 0.1; }
    }
    if (this.persona.twitch) {
      const j1 = wobble(t * 9, this._seed + 7), j2 = wobble(t * 12.5, this._seed + 9);
      B.shL[0] += j1 * 0.12; B.shR[0] += j2 * 0.12; B.head[1] += j2 * 0.12; B.head[2] += j1 * 0.08; B.elL[0] -= Math.abs(j2) * 0.3; B.elR[0] -= Math.abs(j1) * 0.3;
    }
  }

  // aiming: the gun arm points along the aim pitch (compensating the spine), the body blades, the head sights down the arm
  _aimLayer(B, a) {
    const hip = this.hipFire, p = this.aimPitch || 0;
    const blade = (hip ? 0.08 : 0.2) * a;
    B.torso[1] += blade * 0.6; B.chest[1] += blade * 0.4;
    B.torso[0] += (-p * 0.2 + 0.03) * a;
    const cp = B.hips[0] + B.torso[0] + B.chest[0], cy = B.hips[1] + B.torso[1] + B.chest[1];
    if (!hip) {
      B.shR[0] += (-Math.PI / 2 - p - cp - B.shR[0]) * a;
      B.shR[1] += (-cy + 0.05 - B.shR[1]) * a;
      B.shR[2] += (0 - B.shR[2]) * a;
      B.elR[0] += (-0.05 - B.elR[0]) * a;
      B.wrR[0] *= 1 - a; B.wrR[1] *= 1 - a; B.wrR[2] *= 1 - a;
    } else {
      const up = -0.32 - cp * 0.5;
      B.shR[0] += (up - B.shR[0]) * a;
      B.shR[1] += (-cy * 0.85 + 0.1 - B.shR[1]) * a;
      B.shR[2] += (-0.14 - B.shR[2]) * a;
      B.elR[0] += ((-Math.PI / 2 - p - cp - up) - B.elR[0]) * a;
      B.wrR[0] *= 1 - a; B.wrR[1] *= 1 - a; B.wrR[2] *= 1 - a;
    }
    if (this.style.eagle) { const k = a * 0.8; B.shL[0] += (-0.5 - B.shL[0]) * k; B.shL[2] += (0.24 - B.shL[2]) * k; B.elL[0] += (-1.55 - B.elL[0]) * k; }
    else if (!hip) { const k = a * 0.9; B.shL[0] += (-1.28 - p - cp - B.shL[0]) * k; B.shL[1] += (-0.62 - cy - B.shL[1]) * k; B.shL[2] += (0.05 - B.shL[2]) * k; B.elL[0] += (-0.62 - B.elL[0]) * k; }
    const hyNet = 0.6 * B.hips[1] + 0.5 * B.torso[1] + B.chest[1] + B.head[1];
    B.head[1] += (-hyNet + 0.04) * a;
    B.head[0] += (-p * 0.6 - cp * 0.8 - B.head[0]) * a;
    B.head[2] += (hip ? 0 : 0.1) * a;
  }

  // idle fidgets (additive micro clips) while standing around with nothing else to do
  _fidget(dt, buf) {
    const g = this.gait;
    if (!this._fid) {
      if (g.mw > 0.05 || this.aim > 0.05 || this.ground || this.stance === 'panic') { this._fidNext = Math.max(this._fidNext, 1.5); return; }
      this._fidNext -= dt;
      if (this._fidNext > 0) return;
      const list = FIDGETS[this.style.eagle ? 'dredd' : this.stance === 'ready' ? 'ready' : 'relaxed'];
      if (!list || !list.length) { this._fidNext = 5; return; }
      this._fid = list[Math.floor(Math.random() * list.length)]; this._fidT = 0;
      this._fidNext = (this.style.eagle ? 5 : 3.5) + Math.random() * 5;
    }
    const F = this._fid;
    this._fidT += dt;
    const k = this._fidT / F.dur;
    if (k >= 1 || g.mw > 0.3 || this.aim > 0.3) { this._fid = null; return; }
    evalClip(F, k, this._lb);
    const env = smooth01(k / 0.15) * smooth01((1 - k) / 0.2);
    const ch = F.chans, lb = this._lb;
    for (let j = 0; j < ch.length; j++) { const o = ch[j] * 3; if (ch[j] >= 12) continue; buf[o] += lb[o] * env; buf[o + 1] += lb[o + 1] * env; buf[o + 2] += lb[o + 2] * env; }
  }

  // two-bone IK for both legs onto cur.fL / cur.fR, feet oriented by cur.ftL / cur.ftR; clip FK legs blended over it
  _legs(cur, C, w) {
    const geo = this.geo, H = _mH, buf = cur.buf;
    if (C && C.feetGround && w > 0) this._groundFeet(buf, C);
    m3EulerXYZ(H, buf[6], buf[7], buf[8]);
    const hx = buf[3], hy = 1.0 + buf[4], hz = buf[5];
    for (let s = 0; s < 2; s++) {
      const hp = s === 0 ? this.hipL : this.hipR, side = s === 0 ? 1 : -1;
      const fo = (18 + s) * 3, fto = (20 + s) * 3, ho = (12 + s) * 3, ko = (14 + s) * 3, ao = (16 + s) * 3;
      const ox = hp.position.x, oy = hp.position.y, oz = hp.position.z;
      const jx = hx + H[0] * ox + H[1] * oy + H[2] * oz, jy = hy + H[3] * ox + H[4] * oy + H[5] * oz, jz = hz + H[6] * ox + H[7] * oy + H[8] * oz;
      const tx = buf[fo] - jx, ty = geo.footH + buf[fo + 1] - jy, tz = buf[fo + 2] - jz;
      const lx = H[0] * tx + H[3] * ty + H[6] * tz, ly = H[1] * tx + H[4] * ty + H[7] * tz, lz = H[2] * tx + H[5] * ty + H[8] * tz;
      const fy = buf[fto + 1], pwx = Math.sin(fy) + side * 0.15, pwz = Math.cos(fy);
      const plx = H[0] * pwx + H[6] * pwz, ply = H[1] * pwx + H[7] * pwz, plz = H[2] * pwx + H[8] * pwz;
      const kn = solveTwoBone(geo.thigh, geo.shin, lx, ly, lz, plx, ply, plz, 1, buf, ho);
      buf[ko] = kn; buf[ko + 1] = 0; buf[ko + 2] = 0;
      // ankle = (shin frame)ᵀ · foot orientation
      m3EulerYXZ(_mA, buf[ho], buf[ho + 1], buf[ho + 2]);
      m3Mul(_mB, H, _mA); m3RotX(_mA, kn); m3Mul(_mK, _mB, _mA);
      m3EulerYXZ(_mF, buf[fto], buf[fto + 1], buf[fto + 2]);
      m3TMul(_mA, _mK, _mF);
      eulerXYZ(_mA, buf, ao);
      buf[ao] = clamp(buf[ao], -0.7, 0.95); buf[ao + 1] = clamp(buf[ao + 1], -0.45, 0.45); buf[ao + 2] = clamp(buf[ao + 2], -0.32, 0.32);
      if (C && C.legFK[s] && w > 0) {
        const cb = this._cb, m = C.mask;
        for (let c = 0; c < 3; c++) {
          buf[ho + c] += ((m[12 + s] ? cb[ho + c] : 0) - buf[ho + c]) * w;
          buf[ao + c] += ((m[16 + s] ? cb[ao + c] : 0) - buf[ao + c]) * w;
        }
        buf[ko] += ((m[14 + s] ? Math.abs(cb[ko]) : 0) - buf[ko]) * w;
      }
    }
  }

  // clips that plant feet on the real floor while the whole rig rotates (get-ups): move their targets from ground space into the
  // rotated rig frame (target_rig = R_rootᵀ · target_ground, same for the foot orientation)
  _groundFeet(buf, C) {
    m3EulerXYZ(_mA, buf[0], buf[1], buf[2]);
    for (let s = 0; s < 2; s++) {
      if (!C.legIK[s]) continue;
      const fo = (18 + s) * 3, fto = (20 + s) * 3, gx = buf[fo], gy = buf[fo + 1] + this.geo.footH, gz = buf[fo + 2];
      buf[fo] = _mA[0] * gx + _mA[3] * gy + _mA[6] * gz;
      buf[fo + 1] = _mA[1] * gx + _mA[4] * gy + _mA[7] * gz - this.geo.footH;
      buf[fo + 2] = _mA[2] * gx + _mA[5] * gy + _mA[8] * gz;
      m3EulerYXZ(_mF, buf[fto], buf[fto + 1], buf[fto + 2]);
      m3TMul(_mK, _mA, _mF);
      // back to (pitch, yaw, roll) = YXZ Euler
      const m23 = clamp(_mK[5], -1, 1); buf[fto] = Math.asin(-m23); buf[fto + 1] = Math.atan2(_mK[2], _mK[8]); buf[fto + 2] = Math.atan2(_mK[3], _mK[4]);
    }
  }

  // while a clip drives a leg, keep the locomotion foot where the clip put it so the IK takes over seamlessly afterwards
  _footSync(cur, C, w) {
    if (!C || w < 0.5) return;
    const buf = cur.buf;
    if (Math.abs(buf[0]) + Math.abs(buf[2]) > 0.2) return;   // rig rolled over (falls): nothing to plant
    const H = _mH, geo = this.geo;
    for (let s = 0; s < 2; s++) {
      if (!C.legFK[s] && !C.legIK[s]) continue;
      const f = this.gait.feet[s];
      if (C.legFK[s]) {
        const ho = (12 + s) * 3, ko = (14 + s) * 3, ao = (16 + s) * 3, hp = s ? this.hipR : this.hipL;
        m3EulerYXZ(_mA, buf[ho], buf[ho + 1], buf[ho + 2]);
        const kn = Math.abs(buf[ko]), ly = -geo.thigh - geo.shin * Math.cos(kn), lz = -geo.shin * Math.sin(kn);
        const qx = _mA[1] * ly + _mA[2] * lz + hp.position.x, qy = _mA[4] * ly + _mA[5] * lz + hp.position.y, qz = _mA[7] * ly + _mA[8] * lz + hp.position.z;
        f.x = buf[3] + H[0] * qx + H[1] * qy + H[2] * qz; f.z = buf[5] + H[6] * qx + H[7] * qy + H[8] * qz;
        m3Mul(_mB, H, _mA); m3RotX(_mK, kn); m3Mul(_mF, _mB, _mK); m3EulerXYZ(_mK, buf[ao], buf[ao + 1], buf[ao + 2]); m3Mul(_mB, _mF, _mK);
        f.yaw = Math.atan2(_mB[2], _mB[8]);
      } else { f.x = buf[(18 + s) * 3]; f.z = buf[(18 + s) * 3 + 2]; f.yaw = buf[(20 + s) * 3 + 1]; }
      f.pitch = 0; f.planted = true; f.timed = false; f.plantT = 1; f.s = 0; f.cool = 0.15;
      this.gait.ankle(f);
    }
  }

  // inertialised transitions: the offset from the previous pose decays critically damped, carrying its velocity
  _inertia(dt, buf) {
    const n = NJ * 3, X = this._ix, V = this._iv;
    if (this._iPend) {
      this._iPend = false;
      if (this._hasOut) {
        for (let i = 0; i < n; i++) { let d = this._out[i] - buf[i]; if (!LIN(i)) d = wrapPi(d); X[i] = d; V[i] = clamp(this._outV[i], -9, 9); }
        this._iT = 0;
      }
    }
    if (this._iT < 7 / this._iW) {
      this._iT += dt;
      const t = this._iT, wv = this._iW, e = Math.exp(-wv * t);
      for (let i = 0; i < n; i++) buf[i] += (X[i] + (V[i] + wv * X[i]) * t) * e;
    }
  }

  _record(dt, buf) {
    const n = NJ * 3, O = this._out, OV = this._outV, it = 1 / dt, had = this._hasOut;
    for (let i = 0; i < n; i++) { let d = buf[i] - O[i]; if (!LIN(i)) d = wrapPi(d); OV[i] = had ? d * it : 0; O[i] = buf[i]; }
    this._hasOut = true;
    // follow-through sources: pelvis, whole spine, shoulders, elbows
    const sn = this._srcNew, s = this._src, sv = this._srcV, sa = this._srcA;
    sn[0] = buf[6]; sn[1] = buf[7]; sn[2] = buf[8];
    sn[3] = buf[6] + buf[9] + buf[12]; sn[4] = buf[7] + buf[10] + buf[13]; sn[5] = buf[8] + buf[11] + buf[14];
    sn[6] = buf[18]; sn[7] = buf[21]; sn[8] = buf[24]; sn[9] = buf[27];
    for (let i = 0; i < 10; i++) {
      const v = this._srcOk > 0 ? wrapPi(sn[i] - s[i]) * it : 0;
      sa[i] = this._srcOk > 1 ? clamp((v - sv[i]) * it, -400, 400) : 0;
      sv[i] = v; s[i] = sn[i];
    }
    if (this._srcOk < 2) this._srcOk++;
  }

  _springDrive(dt) {
    const S = this.spr, F = S.f, V = S.v, g = this.gait, P = this.persona, A = this._srcA;
    const az = clamp(g.az, -18, 18), ax = clamp(g.ax, -18, 18);
    F[0] -= az * 0.045; F[3] -= az * 0.03; F[6] += az * 0.07; F[8] += az * 0.07; F[14] -= az * 0.004;
    F[2] += ax * 0.045; F[5] += ax * 0.03; F[7] -= ax * 0.06; F[9] -= ax * 0.06; F[12] -= ax * 0.004;
    F[1] -= g.wAcc * 0.01; F[4] -= g.wAcc * 0.014;
    const cf = clamp(g.w * g.spd, -25, 25); F[7] -= cf * 0.012; F[9] -= cf * 0.012;
    if (g.strike > 0) { const k = g.strike * (0.4 + 0.8 * P.heavy); V[3] += 0.45 * k; V[10] -= 0.8 * k; V[11] -= 0.8 * k; V[0] += 0.2 * k; V[13] -= 0.06 * k; V[6] += 0.15 * k; V[8] += 0.15 * k; }
    F[0] -= A[0] * 0.03; F[1] -= A[1] * 0.03; F[2] -= A[2] * 0.03;
    F[3] -= A[3] * 0.035; F[4] -= A[4] * 0.035; F[5] -= A[5] * 0.035;
    F[10] -= A[6] * 0.03; F[11] -= A[7] * 0.03; F[17] -= A[8] * 0.035; F[18] -= A[9] * 0.035;
    S.step(dt);
  }
  _springApply(cur) {
    const X = this.spr.x;
    cur.chest[0] += X[0]; cur.chest[1] += X[1]; cur.chest[2] += X[2];
    cur.head[0] += X[3]; cur.head[1] += X[4]; cur.head[2] += X[5];
    cur.shL[0] += X[6]; cur.shL[2] += X[7]; cur.shR[0] += X[8]; cur.shR[2] += X[9];
    cur.elL[0] += X[10]; cur.elR[0] += X[11]; cur.wrL[0] += X[17]; cur.wrR[0] += X[18];
    cur.hipL[0] += X[19]; cur.hipR[0] += X[20]; cur.knL[0] += X[21]; cur.knR[0] += X[22];
  }

  _land(C) {
    this._impact = true; if (C.ground) this.ground = C.ground;
    const V = this.spr.v, s = C.impactK ?? 1, R = Math.random;
    V[3] += (R() - 0.5) * 3 * s; V[5] += (R() - 0.5) * 3 * s; V[0] += (R() - 0.5) * 1.5 * s;
    V[6] += (R() - 0.5) * 4 * s; V[8] += (R() - 0.5) * 4 * s; V[7] += R() * 2.5 * s; V[9] -= R() * 2.5 * s;
    V[10] -= 2.5 * s * R(); V[11] -= 2.5 * s * R();
    V[19] += (R() - 0.5) * 2.5 * s; V[20] += (R() - 0.5) * 2.5 * s; V[21] += R() * 2.5 * s; V[22] += R() * 2.5 * s;
  }

  _lookLayer(dt, cur, C) {
    let want = 0, a = 0, p = 0;
    const g = this.gait, sc = this._scan;
    if (this._hasLook) {
      const r = this.root, S = this.style.scale;
      const ey = r.position.y + (1.95 + cur.pos[1]) * S;
      const dx = this._look.x - r.position.x, dy = this._look.y - ey, dz = this._look.z - r.position.z;
      const yw = r.rotation.y, s = Math.sin(yw), c = Math.cos(yw);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      a = Math.atan2(lx, lz); p = -Math.atan2(dy, Math.hypot(lx, lz) + 1e-6);
      want = Math.abs(a) < 1.95 ? 1 : 0;
      a = clamp(a, -1.3, 1.3); p = clamp(p, -0.6, 0.6);
      sc.on = false;
    } else {
      // idle head scan / looking around
      const idle = g.mw < 0.1 && !C && this.ground === null && this.aim < 0.1;
      sc.t -= dt;
      if (sc.t <= 0) {
        if (sc.on || !idle) { sc.on = false; sc.t = (this.style.eagle ? 3.5 : 2.5) + Math.random() * 4; }
        else { sc.on = true; sc.yaw = (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.5) * (this.stance === 'ready' ? 0.5 : 1); sc.pitch = (Math.random() - 0.65) * 0.25; sc.t = 0.9 + Math.random() * 1.5; }
      }
      if (sc.on && idle) { want = 1; a = sc.yaw; p = sc.pitch; }
    }
    const fac = C ? (C.look ?? 1) : this.ground !== null ? 0 : 1;
    this._lookW += (want * fac - this._lookW) * (1 - Math.exp(-5 * dt));
    const kk = 1 - Math.exp(-8 * dt);
    this._lookA += (a - this._lookA) * kk; this._lookP += (p - this._lookP) * kk;
    const lw = this._lookW;
    if (lw < 0.002) return;
    const yawNow = 0.6 * cur.hips[1] + 0.5 * cur.torso[1] + cur.chest[1] + cur.head[1];
    const pitNow = cur.hips[0] + cur.torso[0] + cur.chest[0] + cur.head[0];
    let dyaw = clamp(this._lookA - yawNow, -1.4, 1.4);
    const dpit = clamp(this._lookP - pitNow, -0.7, 0.7);
    const ex = Math.abs(dyaw) - 0.75;
    if (ex > 0) { const cy = Math.sign(dyaw) * ex * 0.5; cur.chest[1] += cy * lw; dyaw -= cy; }
    cur.head[1] += dyaw * lw; cur.head[0] += dpit * lw;
  }

  // Bodies on the floor (falls, knock-downs, deaths): keep hands, elbows, knees and feet above it by re-solving any limb that dips
  // under the floor with two-bone IK onto it (the floppy settle springs then can't push limbs through), and lift the whole rig if
  // the trunk or head would sink.  Only runs while the rig is rolled over, i.e. for the few characters lying down.
  _floorFix(cur, dt) {
    const buf = cur.buf;
    if (Math.abs(buf[0]) + Math.abs(buf[2]) < 0.5) { this._lift *= Math.exp(-10 * dt); return; }
    this.applyPose(cur);
    const S = this.style.scale, M = _M;
    this.pivot.updateMatrix(); this.rigRoot.updateMatrix(); this.hips.updateMatrix(); this.torso.updateMatrix(); this.chest.updateMatrix(); this.neck.updateMatrix(); this.head.updateMatrix();
    M[0].multiplyMatrices(this.pivot.matrix, this.rigRoot.matrix); M[1].multiplyMatrices(M[0], this.hips.matrix);
    M[2].multiplyMatrices(M[1], this.torso.matrix); M[3].multiplyMatrices(M[2], this.chest.matrix);
    // trunk + head: lift the rig so none of them sinks (heights relative to the root = the floor)
    let need = -1;
    _p1.setFromMatrixPosition(M[1]); need = Math.max(need, 0.14 * S - _p1.y);
    _p1.set(0, 0.2, 0).applyMatrix4(M[3]); need = Math.max(need, 0.18 * S - _p1.y);
    M[4].multiplyMatrices(M[3], this.neck.matrix); M[4].multiply(this.head.matrix); _p1.set(0, 0.17, 0).applyMatrix4(M[4]); need = Math.max(need, 0.2 * S - _p1.y);
    const want = Math.max(0, need + this._lift);
    this._lift += (want - this._lift) * (1 - Math.exp(-12 * dt));
    const lift = this._lift;
    // limbs
    for (let s = 0; s < 4; s++) {
      const arm = s < 2, side = s & 1;
      const a = arm ? (side ? this.shR : this.shL) : (side ? this.hipR : this.hipL);
      const b = arm ? (side ? this.elR : this.elL) : (side ? this.knR : this.knL);
      const c = arm ? (side ? this.wrR : this.wrL) : (side ? this.anR : this.anL);
      const P = arm ? M[3] : M[1];
      a.updateMatrix(); b.updateMatrix(); c.updateMatrix();
      M[5].multiplyMatrices(P, a.matrix); M[6].multiplyMatrices(M[5], b.matrix); M[7].multiplyMatrices(M[6], c.matrix);
      _p2.setFromMatrixPosition(M[6]);                                  // elbow / knee
      _p3.set(0, arm ? -0.1 : -0.05, arm ? 0 : 0.1).applyMatrix4(M[7]);  // hand / foot centre
      _p4.setFromMatrixPosition(M[7]);                                  // wrist / ankle
      const clear = (arm ? 0.07 : 0.09) * S - lift;
      const low = Math.min(_p2.y, _p3.y, _p4.y);
      if (low >= clear) continue;
      const up = clear - low;
      _p4.y += up; _p2.y += up + 0.15 * S;   // and bias the elbow / knee to bulge away from the floor
      _Mi.copy(P).invert();
      _p4.applyMatrix4(_Mi).sub(a.position); _p2.applyMatrix4(_Mi).sub(a.position);
      const la = Math.abs(b.position.y), lb = Math.abs(c.position.y);
      const ao = (arm ? 6 + side : 12 + side) * 3, bo = (arm ? 8 + side : 14 + side) * 3;
      const bend = solveTwoBone(la, lb, _p4.x, _p4.y, _p4.z, _p2.x, _p2.y, _p2.z, arm ? -1 : 1, buf, ao);
      buf[bo] = bend;
    }
  }

  // dodge roll: rotate about the tucked body's centre, which drops towards the ground mid-roll; slow in, fast through, slow out
  _rollPivot() {
    const r = this.roll;
    if (!r) { this._dispRoll = 0; this._pivY = 0.9; this._cY = 0.9; return; }
    const sg = r < 0 ? -1 : 1, k = clamp(Math.abs(r) / TAU, 0, 1);
    this._dispRoll = sg * TAU * (k - Math.sin(TAU * k) / TAU * 0.6);
    const tuck = Math.sin(Math.PI * k);
    this._cY = 0.9 - 0.32 * tuck; this._pivY = 0.9 - 0.42 * tuck;
  }
}
