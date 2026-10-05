// ---------------------------------------------------------------------------
// Keyframed clips.  Format: see compileClip() in animcore.js.  Degrees for rotations, rig units for
// pos (pelvis offset, additive on top of locomotion) and fL / fR (ankle targets: x, lift, z).
// By default fL / fR / ftL / ftR are OFFSETS from where the feet were when the clip started, so a
// strike steps out of whatever stance the character was in (feetAbs: absolute rig coordinates;
// feetGround: absolute floor coordinates even while the rig is rotated, for get-ups).
// Naming hipX / knX / anX hands that leg to the clip (FK, blended over the IK by clip weight);
// clips that name neither leave the legs to locomotion, which keeps the feet planted under
// whatever the pelvis does (crouches, lunges, recoils).
//
// Clip flags:  dur / hit / side / hold (gameplay semantics, unchanged), out (blend-out fraction of the
// tail back to locomotion), blend (inertial blend-in seconds), look (how much head look-at survives),
// additive, aimArm (gun arm forced onto the aim line while playing), linger (non-hold clips: keep the
// final pose this many seconds after 'done'), impact (k at which the body hits the floor), ground
// (resulting lying pose), stand (clears the lying state when done), proc (procedural layer), select
// (directional / state variant picker).
// ---------------------------------------------------------------------------
import { compileClip, mirrorDef, CI, wobble } from './animcore.js';

const O = {}; for (const k of Object.keys(CI)) O[k] = CI[k] * 3;
const D2R = Math.PI / 180;

// ---- procedural layers ------------------------------------------------------------------------------
// fear / adrenaline tremble on arms, head and spine
function tremble(amp) {
  return (ch, k, t, out) => {
    const s = ch._seed, a = amp * D2R, f = 23;
    out[O.shL] += wobble(t * f, s) * a; out[O.shL + 2] += wobble(t * f, s + 1) * a * 0.7;
    out[O.shR] += wobble(t * f, s + 2) * a; out[O.shR + 2] += wobble(t * f, s + 3) * a * 0.7;
    out[O.elL] += wobble(t * f * 1.2, s + 4) * a; out[O.elR] += wobble(t * f * 1.2, s + 5) * a;
    out[O.head] += wobble(t * f * 0.8, s + 6) * a * 0.6; out[O.head + 2] += wobble(t * f * 0.8, s + 7) * a * 0.5;
    out[O.torso] += wobble(t * f * 0.6, s + 8) * a * 0.3;
  };
}
// taser: rigid high-frequency convulsions while standing, decaying twitches once down
function convulse(ch, k, t, out, C) {
  const s = ch._seed;
  let a;
  if (k < 0.5) a = 0.16;
  else { const tt = Math.max(0, t - C.dur * 0.74); a = 0.1 * Math.exp(-tt / 0.7) + (Math.sin(t * 2.3 + s) > 0.97 ? 0.08 : 0) * Math.exp(-tt / 3); }
  const f = k < 0.5 ? 31 : 17;
  out[O.shL] += wobble(t * f, s) * a; out[O.shR] += wobble(t * f, s + 1) * a;
  out[O.shL + 2] += wobble(t * f, s + 2) * a; out[O.shR + 2] += wobble(t * f, s + 3) * a;
  out[O.elL] += wobble(t * f, s + 4) * a * 1.4; out[O.elR] += wobble(t * f, s + 5) * a * 1.4;
  out[O.wrL] += wobble(t * f, s + 6) * a * 1.5; out[O.wrR] += wobble(t * f, s + 7) * a * 1.5;
  out[O.head] += wobble(t * f, s + 8) * a; out[O.head + 1] += wobble(t * f, s + 9) * a;
  out[O.torso] += wobble(t * f, s + 10) * a * 0.6; out[O.torso + 2] += wobble(t * f, s + 11) * a * 0.5;
  out[O.hipL] += wobble(t * f, s + 12) * a * 0.4; out[O.hipR] += wobble(t * f, s + 13) * a * 0.4;
  out[O.knL] += Math.abs(wobble(t * f, s + 14)) * a * 0.6; out[O.knR] += Math.abs(wobble(t * f, s + 15)) * a * 0.6;
}
// faint dying twitches on the floor
function deathTwitch(ch, k, t, out, C) {
  if (k < 1) return;
  const tt = t - C.dur, s = ch._seed, a = 0.05 * Math.exp(-tt / 0.9);
  if (a < 0.002) return;
  out[O.wrL] += wobble(t * 13, s) * a * 2; out[O.wrR] += wobble(t * 13, s + 1) * a * 2;
  out[O.elL] += wobble(t * 9, s + 2) * a; out[O.knR] += Math.abs(wobble(t * 7, s + 3)) * a;
}

// ---- Dredd's combat-ready end pose (baton in the LEFT hand, Lawgiver in the RIGHT) ----
const READY = { chest: [0, 0, 0], shL: [-55, -14, 15], elL: [-80], wrL: [15, 0, 0], shR: [-32, 8, -12], elR: [-62], wrR: [10, 0, 0] };
const R = (o) => ({ ...READY, ...o });

const DEFS = {
  // ============================== Dredd: daystick / Lawgiver melee ==============================
  // forehand slash, left to right; the lead foot steps in, the back foot shuffles up after
  slashR: { dur: 0.46, hit: 0.5, side: 'L', out: 0.24, blend: 0.07, look: 0.6, frames: [
    [0.00, { hips: [1, 6, 0], torso: [3, 9, 0], chest: [1, 3, 0], head: [-3, -10, 0], shL: [-53, 9, -3], elL: [-136], wrL: [53, 4, 0], shR: [-34, 24, -16], elR: [-80], wrR: [10, 0, 0], pos: [0.02, -0.03, -0.03], fL: [0, 0, 0], fR: [0, 0, 0] }],
    [0.24, { hips: [1, 10, 0], torso: [2, 15, 0], chest: [1, 5, 0], head: [-2, -16, 0], shL: [-81, 48, -10], elL: [-124], wrL: [70, 48, 0], shR: [-38, 26, -18], elR: [-84], pos: [0.03, -0.05, -0.05], fL: [0.01, 0.07, 0.1] }, 1],
    [0.40, { hips: [3, 1, 0], torso: [6, 1, 0], chest: [2, 0, 0], head: [-5, -1, 0], shL: [-51, -7, -10], elL: [-114], wrL: [-5, 32, 0], shR: [-42, 0, -22], elR: [-86], pos: [0, -0.09, 0.1], fL: [0.01, 0.05, 0.26] }],
    [0.52, { hips: [4, -8, 0], torso: [8, -12, 0], chest: [2, -4, 0], head: [-8, 13, 0], shL: [-65, -18, -16], elL: [-52], wrL: [96, 24, 0], shR: [-46, -26, -28], elR: [-92], wrR: [10, 0, 0], pos: [-0.02, -0.12, 0.18], fL: [0.01, 0, 0.3], fR: [0, 0, 0] }],
    [0.66, { hips: [3, -12, 0], torso: [7, -19, 0], chest: [2, -7, 0], head: [-7, 20, 0], shL: [-73, -80, 32], elL: [-8], wrL: [95, -29, 0], shR: [-42, -30, -26], elR: [-88], pos: [-0.03, -0.1, 0.19] }, 0.3],
    [0.84, { hips: [2, -6, 0], torso: [5, -9, 0], chest: [1, -3, 0], head: [-5, 10, 0], shL: [-34, -35, -10], elL: [-71], wrL: [53, 16, 0], shR: [-34, 4, -14], elR: [-68], pos: [-0.01, -0.06, 0.15], fL: [0.01, 0, 0.3], fR: [0, 0.06, 0.12] }],
    [1.00, { hips: [2, -3, 0], torso: [5, -4, 0], chest: [1, -1, 0], head: [-4, 4, 0], shL: [-31, 1, -2], elL: [-115], wrL: [92, 3, 0], shR: [-32, 8, -12], elR: [-62], wrR: [10, 0, 0], pos: [0, -0.04, 0.13], fL: [0.01, 0, 0.3], fR: [0, 0, 0.16] }],
  ] },
  // backhand slash, right to left; the right foot steps
  slashL: { dur: 0.46, hit: 0.5, side: 'L', out: 0.24, blend: 0.07, look: 0.6, frames: [
    [0.00, { hips: [1, -6, 0], torso: [3, -9, 0], chest: [1, -3, 0], head: [-3, 10, 0], shL: [-101, -66, -10], elL: [-8], wrL: [46, -54, 0], shR: [-30, -6, -14], elR: [-72], wrR: [10, 0, 0], pos: [-0.02, -0.03, 0], fL: [0, 0, 0], fR: [0, 0, 0] }],
    [0.24, { hips: [1, -10, 0], torso: [2, -15, 0], chest: [1, -5, 0], head: [-2, 16, 0], shL: [-103, -65, -10], elL: [-8], wrL: [54, -54, 0], shR: [-34, -10, -16], elR: [-78], pos: [-0.03, -0.05, -0.02], fR: [0, 0.06, 0.08] }, 1],
    [0.40, { hips: [3, -1, 0], torso: [6, -2, 0], chest: [2, -1, 0], head: [-5, 2, 0], shL: [-89, -52, -2], elL: [-23], wrL: [95, -70, 0], shR: [-38, -2, -20], elR: [-82], pos: [0, -0.08, 0.1], fR: [0, 0.04, 0.2] }],
    [0.52, { hips: [4, 8, 0], torso: [8, 12, 0], chest: [2, 4, 0], head: [-8, -13, 0], shL: [-92, -42, 1], elL: [-8], wrL: [86, 46, 0], shR: [-44, 18, -24], elR: [-90], pos: [0.02, -0.12, 0.18], fL: [0, 0, 0], fR: [0, 0, 0.26] }],
    [0.66, { hips: [3, 12, 0], torso: [7, 19, 0], chest: [2, 7, 0], head: [-7, -20, 0], shL: [-41, 16, -26], elL: [-67], wrL: [95, 71, 0], shR: [-38, 24, -22], elR: [-86], pos: [0.03, -0.1, 0.18] }, 0.3],
    [0.84, { hips: [2, 5, 0], torso: [5, 8, 0], chest: [1, 3, 0], head: [-5, -8, 0], shL: [-34, -14, -9], elL: [-74], wrL: [56, 8, 0], shR: [-33, 10, -14], elR: [-68], pos: [0.01, -0.06, 0.14], fL: [0, 0.06, 0.12], fR: [0, 0, 0.26] }],
    [1.00, { hips: [2, 2, 0], torso: [5, 3, 0], chest: [1, 1, 0], head: [-4, -3, 0], shL: [-43, -11, -2], elL: [-91], wrL: [80, 2, 0], shR: [-32, 8, -12], elR: [-62], wrR: [10, 0, 0], pos: [0, -0.04, 0.12], fL: [0, 0, 0.16], fR: [0, 0, 0.26] }],
  ] },
  // heavy two-stage overhead: rise onto the toes with the stick high, slam down into a deep lunge
  overhead: { dur: 0.62, hit: 0.55, side: 'L', out: 0.22, blend: 0.08, look: 0.5, frames: [
    [0.00, { hips: [-1, 2, 0], torso: [-4, 3, 0], chest: [-1, 1, 0], head: [3, -3, 0], shL: [-108, -10, -7], elL: [-91], wrL: [62, -7, 0], shR: [-50, 10, -18], elR: [-72], wrR: [10, 0, 0], pos: [0, 0, -0.02], fL: [0, 0, 0], fR: [0, 0, 0] }],
    [0.30, { hips: [-3, 2, 0], torso: [-8, 3, 0], chest: [-2, 1, 0], head: [8, -3, 0], shL: [-149, -22, -12], elL: [-20], wrL: [25, -15, 0], shR: [-70, 10, -24], elR: [-62], pos: [0, 0.05, -0.06], fL: [0, 0.05, 0.06] }],
    [0.44, { hips: [-4, 2, 0], torso: [-11, 3, 0], chest: [-3, 1, 0], head: [10, -3, 0], shL: [-154, -24, -13], elL: [-8], wrL: [-7, -21, 0], shR: [-80, 10, -26], elR: [-56], pos: [0, 0.07, -0.08], fL: [0, 0.09, 0.14] }, 1],
    [0.56, { hips: [10, 0, 0], torso: [24, 0, 0], chest: [6, 0, 0], head: [-22, 0, 0], shL: [-69, -26, -7], elL: [-21], wrL: [81, 31, 0], shR: [-40, -10, -28], elR: [-90], pos: [0, -0.3, 0.3], fL: [0, 0, 0.38], fR: [0, 0, 0] }],
    [0.68, { hips: [12, 0, 0], torso: [28, 0, 0], chest: [7, 0, 0], head: [-25, 0, 0], shL: [-74, -29, -4], elL: [-8], wrL: [85, 33, 0], shR: [-36, -10, -26], elR: [-86], pos: [0, -0.34, 0.32] }, 0.3],
    [0.85, { hips: [5, 0, 0], torso: [12, 0, 0], chest: [3, 0, 0], head: [-11, 0, 0], shL: [-26, -17, -9], elL: [-80], wrL: [59, 9, 0], shR: [-34, 6, -16], elR: [-68], pos: [0, -0.15, 0.22], fR: [0, 0.06, 0.14] }],
    [1.00, { hips: [2, 0, 0], torso: [5, 0, 0], chest: [1, 0, 0], head: [-5, 0, 0], shL: [-38, -6, -2], elL: [-103], wrL: [86, 3, 0], shR: [-32, 8, -12], elR: [-62], wrR: [10, 0, 0], pos: [0, -0.05, 0.16], fL: [0, 0, 0.38], fR: [0, 0, 0.2] }],
  ] },
  // spear-jab with the daystick: coil at the hip, drive the arm straight, lunge long
  thrust: { dur: 0.4, hit: 0.5, side: 'L', out: 0.24, blend: 0.07, look: 0.6, frames: [
    [0.00, { hips: [1, 7, 0], torso: [2, 11, 0], chest: [1, 4, 0], head: [-2, -12, 0], shL: [11, -23, -4], elL: [-88], wrL: [65, 0, 0], shR: [-30, 12, -14], elR: [-72], wrR: [10, 0, 0], pos: [0, -0.04, -0.03], fL: [0, 0, 0], fR: [0, 0, 0] }],
    [0.24, { hips: [2, 10, 0], torso: [4, 15, 0], chest: [1, 5, 0], head: [-3, -16, 0], shL: [21, -32, 1], elL: [-91], wrL: [58, -1, 0], pos: [0, -0.07, -0.06], fL: [0, 0.07, 0.08] }, 1],
    [0.46, { hips: [4, -4, 0], torso: [8, -7, 0], chest: [2, -3, 0], head: [-8, 7, 0], shL: [-62, -13, -13], elL: [-61], wrL: [96, 31, 0], shR: [-46, -26, -28], elR: [-92], wrR: [10, 0, 0], pos: [0, -0.14, 0.26], fL: [0, 0, 0.36], fR: [0, 0, 0] }],
    [0.60, { hips: [4, -6, 0], torso: [10, -9, 0], chest: [2, -3, 0], head: [-9, 10, 0], shL: [-61, -11, -14], elL: [-65], wrL: [96, 33, 0], pos: [0, -0.15, 0.28] }, 0.3],
    [0.82, { hips: [3, -2, 0], torso: [6, -3, 0], chest: [2, -1, 0], head: [-5, 3, 0], shL: [-24, -15, -10], elL: [-101], wrL: [80, 12, 0], shR: [-34, 4, -14], elR: [-68], pos: [0, -0.07, 0.18], fR: [0, 0.06, 0.14] }],
    [1.00, { hips: [2, -1, 0], torso: [5, -2, 0], chest: [1, -1, 0], head: [-4, 2, 0], shL: [-34, -2, -2], elL: [-109], wrL: [89, 3, 0], shR: [-32, 8, -12], elR: [-62], wrR: [10, 0, 0], pos: [0, -0.04, 0.14], fL: [0, 0, 0.36], fR: [0, 0, 0.2] }],
  ] },
  // front push-kick with the right leg: chamber, extend through the heel, re-chamber, step down forward
  kick: { dur: 0.5, hit: 0.45, side: 'R', out: 0.22, blend: 0.07, look: 0.6, frames: [
    [0.00, { pos: [0, -0.02, 0], hips: [0, -8, 0], torso: [-4, -6, 0], head: [0, 6, 0], shL: [-45, 15, 25], elL: [-85], wrL: [15, 0, 0], shR: [-25, -25, -25], elR: [-70], hipR: [-20, 0, -4], knR: [35], anR: [10, 0, 0] }],
    [0.20, { pos: [0, 0.02, -0.03], hips: [-6, -10, 0], torso: [-8, -10, 0], head: [2, 8, 0], shL: [-60, 25, 35], elL: [-95], shR: [-30, -30, -35], elR: [-80], hipR: [-85, 0, -6], knR: [115], anR: [30, 0, 0] }, 1],
    [0.38, { pos: [0, 0.02, -0.06], hips: [-10, -4, 0], torso: [-16, -6, 0], hipR: [-92, 0, -4], knR: [40], anR: [10, 0, 0] }],
    [0.46, { pos: [0, 0.01, -0.08], hips: [-14, -2, 0], torso: [-22, -4, 0], head: [6, 2, 0], shL: [-70, 35, 45], elL: [-70], shR: [-20, -40, -45], elR: [-60], hipR: [-96, 0, -2], knR: [4], anR: [-12, 0, 0] }],
    [0.62, { pos: [0, 0, -0.02], hips: [-6, -4, 0], torso: [-10, -4, 0], hipR: [-80, 0, -4], knR: [95], anR: [25, 0, 0] }],
    [0.82, { pos: [0, -0.04, 0.08], hips: [0, -2, 0], torso: [2, -2, 0], head: [0, 0, 0], shL: [-50, 0, 18], elL: [-80], shR: [-30, 5, -14], elR: [-64], hipR: [-30, 0, -4], knR: [30], anR: [5, 0, 0] }],
    [1.00, R({ pos: [0, -0.03, 0.1], hips: [2, 0, 0], torso: [5, 0, 0], hipR: [-12, 0, -3], knR: [12], anR: [0, 0, 0] })],
  ] },
  // Lawgiver butt hook with the right arm
  gunbutt: { dur: 0.42, hit: 0.5, side: 'R', out: 0.24, blend: 0.07, look: 0.6, frames: [
    [0.00, { hips: [1, -8, 0], torso: [3, -12, 0], chest: [1, -4, 0], head: [-3, 13, 0], shR: [-27, 19, -64], elR: [-126], wrR: [43, 0, 0], shL: [-50, -8, 18], elL: [-84], wrL: [15, 0, 0], pos: [-0.02, -0.04, -0.02], fL: [0, 0, 0], fR: [0, 0, 0] }],
    [0.24, { hips: [2, -11, 0], torso: [4, -17, 0], chest: [1, -6, 0], head: [-3, 19, 0], shR: [-25, 17, -68], elR: [-120], wrR: [31, 0, 0], pos: [-0.03, -0.06, -0.04], fR: [0, 0.06, 0.08] }, 1],
    [0.48, { hips: [3, 10, 0], torso: [7, 15, 0], chest: [2, 5, 0], head: [-7, -16, 0], shR: [-35, 79, -78], elR: [-90], wrR: [33, 0, 0], shL: [-46, -14, 24], elL: [-90], pos: [0.02, -0.11, 0.2], fL: [0, 0, 0], fR: [0, 0, 0.24] }],
    [0.62, { hips: [3, 13, 0], torso: [7, 20, 0], chest: [2, 7, 0], head: [-6, -21, 0], shR: [-8, 101, -95], elR: [-68], wrR: [8, 0, 0], pos: [0.03, -0.1, 0.2] }, 0.3],
    [0.84, { hips: [2, 4, 0], torso: [5, 6, 0], chest: [1, 2, 0], head: [-4, -6, 0], shR: [-40, 20, -30], elR: [-80], wrR: [10, 0, 0], shL: [-52, -10, 16], elL: [-80], pos: [0, -0.06, 0.15], fL: [0, 0.05, 0.1] }],
    [1.00, { hips: [2, 1, 0], torso: [5, 2, 0], chest: [1, 1, 0], head: [-4, -2, 0], shR: [-32, 8, -12], elR: [-62], wrR: [10, 0, 0], shL: [-55, -14, 15], elL: [-80], wrL: [15, 0, 0], pos: [0, -0.04, 0.12], fL: [0, 0, 0.14], fR: [0, 0, 0.24] }],
  ] },
  // spinning slash: wind left, pirouette clockwise on the spot with the stick at full reach
  spin: { dur: 0.7, hit: 0.5, side: 'L', out: 0, endBlend: 0.16, blend: 0.07, look: 0, frames: [
    [0.00, { root: [0, 0, 0], pos: [0, -0.08, 0], torso: [8, 20, 0], chest: [0, 10, 0], head: [0, -20, 0], shL: [-70, -40, 10], elL: [-90], wrL: [20, 0, 0], shR: [-40, 20, -20], elR: [-80], wrR: [10, 0, 0] }],
    [0.15, { root: [0, 15, 0], pos: [0, -0.14, 0], torso: [10, 30, 0], chest: [0, 12, 0], head: [0, -26, 0], shL: [-80, -55, 10], elL: [-100] }, 1],
    [0.50, { root: [0, -180, 0], pos: [0, -0.18, 0], torso: [12, -10, 0], chest: [2, -8, 0], head: [0, 0, 0], shL: [-92, 75, 20], elL: [-6], wrL: [60, 0, 0], shR: [-50, -60, -40], elR: [-40] }],
    [0.80, { root: [0, -322, 0], pos: [0, -0.12, 0], torso: [10, -20, 0], shL: [-80, 30, 18], elL: [-40], wrL: [40, 0, 0], shR: [-40, -20, -24], elR: [-70] }],
    [1.00, R({ root: [0, -360, 0], pos: [0, -0.04, 0], torso: [9, 0, 0], head: [0, 0, 0] })],
  ] },
  // Judgement: crouch, leap with the stick high, slam into a hero landing (right knee down), hold, rise
  finisher: { dur: 1.0, hit: 0.62, side: 'L', out: 0.18, blend: 0.08, look: 0.3, frames: [
    [0.00, { pos: [0, -0.06, 0], torso: [6, 0, 0], head: [0, 0, 0], shL: [-60, 0, 15], elL: [-80], wrL: [15, 0, 0], shR: [-40, 0, -15], elR: [-70], wrR: [10, 0, 0],
      hipL: [-15, 0, 4], knL: [20], anL: [0, 0, 0], hipR: [-10, 0, -4], knR: [20], anR: [0, 0, 0] }],
    [0.18, { pos: [0, -0.32, -0.04], torso: [26, 0, 0], head: [-14, 0, 0], shL: [-20, 0, 30], elL: [-60], shR: [-20, 0, -30], elR: [-60],
      hipL: [-70, 0, 6], knL: [110], anL: [-25, 0, 0], hipR: [-70, 0, -6], knR: [110], anR: [-25, 0, 0] }, 1],
    [0.42, { pos: [0, 0.32, 0.06], torso: [-16, 0, 0], head: [-10, 0, 0], shL: [-205, 0, 15], elL: [-50], wrL: [-40, 0, 0], shR: [-160, -10, -15], elR: [-40],
      hipL: [-55, 0, 6], knL: [95], anL: [25, 0, 0], hipR: [-30, 0, -6], knR: [80], anR: [30, 0, 0] }],
    [0.50, { pos: [0, 0.34, 0.1], torso: [-22, 0, 0], shL: [-215, 0, 18], elL: [-56], wrL: [-50, 0, 0], shR: [-170, -10, -18], elR: [-46] }, 1],
    [0.62, { pos: [0, -0.46, 0.36], torso: [44, 0, 0], chest: [10, 0, 0], head: [16, 0, 0], shL: [-52, 0, 4], elL: [-10], wrL: [70, 0, 0], shR: [-30, -16, -40], elR: [-40],
      hipL: [-90, 0, 8], knL: [100], anL: [-10, 0, 0], hipR: [10, 0, -6], knR: [80], anR: [60, 0, 0] }],
    [0.72, { pos: [0, -0.5, 0.38], torso: [48, 0, 0], head: [20, 0, 0], shL: [-42, 0, 2], elL: [-14], wrL: [76, 0, 0] }, 0.4],
    [0.88, { pos: [0, -0.46, 0.36], torso: [36, 0, 0], head: [6, 0, 0] }],
    [1.00, { pos: [0, -0.3, 0.3], torso: [20, 0, 0], head: [0, 0, 0], shL: [-50, -10, 14], elL: [-70], wrL: [20, 0, 0], shR: [-30, 6, -14], elR: [-62],
      hipL: [-60, 0, 6], knL: [80], anL: [-10, 0, 0], hipR: [-20, 0, -6], knR: [80], anR: [20, 0, 0] }],
  ] },
  // counter: brace / parry high, snap a backhand into the attacker, shove with the gun arm, recover
  counter: { dur: 0.75, hit: 0.35, side: 'L', out: 0.22, blend: 0.05, look: 0.6, frames: [
    [0.00, { hips: [-1, 5, 0], torso: [-4, 8, 0], chest: [-1, 3, 0], head: [3, -8, 0], shL: [-112, -32, -4], elL: [-9], wrL: [87, -54, 0], shR: [-40, 20, -18], elR: [-80], wrR: [10, 0, 0], pos: [0, -0.06, -0.08], fL: [0, 0, 0], fR: [0, 0, 0] }],
    [0.14, { hips: [-2, 6, 0], torso: [-5, 9, 0], chest: [-1, 3, 0], head: [4, -10, 0], shL: [-114, -34, -6], elL: [-8], wrL: [84, -56, 0], pos: [0, -0.1, -0.1], fR: [0, 0.05, -0.06] }, 1],
    [0.34, { hips: [3, -13, 0], torso: [7, -20, 0], chest: [2, -7, 0], head: [-7, 21, 0], shL: [-47, -12, -24], elL: [-80], wrL: [97, 31, 0], shR: [-48, -30, -28], elR: [-92], pos: [-0.02, -0.14, 0.22], fL: [0, 0, 0.3], fR: [0, 0, -0.04] }],
    [0.46, { hips: [3, -15, 0], torso: [7, -24, 0], chest: [2, -9, 0], head: [-7, 25, 0], shL: [-75, -75, 34], elL: [-7], wrL: [96, -23, 0], pos: [-0.03, -0.13, 0.24] }, 0.3],
    [0.62, { hips: [2, 8, 0], torso: [4, 13, 0], chest: [1, 5, 0], head: [-3, -13, 0], shL: [-28, -24, 4], elL: [-95], wrL: [72, 1, 0], shR: [-88, 10, -10], elR: [-20], wrR: [0, 0, 0], pos: [0.02, -0.08, 0.2] }],
    [0.80, { hips: [2, 3, 0], torso: [5, 4, 0], chest: [1, 1, 0], head: [-4, -4, 0], shL: [-38, -11, -1], elL: [-94], wrL: [78, 2, 0], shR: [-50, 8, -14], elR: [-50], pos: [0, -0.06, 0.16], fR: [0, 0.05, 0.2] }],
    [1.00, { hips: [2, 0, 0], torso: [5, 0, 0], chest: [1, 0, 0], head: [-4, 0, 0], shL: [-38, -6, -2], elL: [-102], wrL: [86, 3, 0], shR: [-32, 8, -12], elR: [-62], wrR: [10, 0, 0], pos: [0, -0.04, 0.14], fL: [0, 0, 0.3], fR: [0, 0, 0.26] }],
  ] },

  // ============================== perps ==============================
  // right cross from the guard
  punch: { dur: 0.4, hit: 0.5, side: 'R', out: 0.25, blend: 0.07, frames: [
    [0.00, { hips: [1, -6, 0], torso: [2, -9, 0], chest: [1, -3, 0], head: [-2, 10, 0], shR: [-69, 35, 2], elR: [-100], wrR: [-20, 0, 0], shL: [-69, -40, -2], elL: [-114], wrL: [-20, 0, 0], pos: [0, -0.05, -0.04], fL: [0, 0, 0], fR: [0, 0, 0] }],
    [0.28, { hips: [2, -8, 0], torso: [4, -13, 0], chest: [1, -5, 0], head: [-3, 14, 0], shR: [-68, 36, 0], elR: [-112], pos: [0, -0.07, -0.06], fL: [0, 0.05, 0.06] }, 1],
    [0.48, { hips: [3, 8, 0], torso: [7, 13, 0], chest: [2, 5, 0], head: [-7, -14, 0], shR: [-103, 21, -2], elR: [-26], wrR: [10, 0, 0], shL: [-60, -36, 4], elL: [-118], pos: [0, -0.1, 0.22], fL: [0, 0, 0.22] }],
    [0.60, { hips: [4, 10, 0], torso: [8, 15, 0], chest: [2, 5, 0], head: [-8, -16, 0], shR: [-100, 17, -1], elR: [-36], pos: [0, -0.11, 0.24] }, 0.3],
    [0.82, { hips: [2, 2, 0], torso: [5, 3, 0], chest: [1, 1, 0], head: [-4, -3, 0], shR: [-65, 30, 1], elR: [-114], wrR: [-14, 0, 0], shL: [-66, -40, -2], elL: [-114], pos: [0, -0.06, 0.14] }],
    [1.00, { hips: [2, 0, 0], torso: [4, 0, 0], chest: [1, 0, 0], head: [-3, 0, 0], shR: [-65, 34, 0], elR: [-119], wrR: [-20, 0, 0], shL: [-69, -40, -2], elL: [-114], wrL: [-20, 0, 0], pos: [0, -0.05, 0.12], fL: [0, 0, 0.22], fR: [0, 0, 0.1] }],
  ] },
  // big bat swing out of the telegraph wind-up: diagonal down-and-across, full follow-through
  swing: { dur: 0.7, hit: 0.5, side: 'R', out: 0.22, blend: 0.06, frames: [
    [0.00, { hips: [-2, -10, 0], torso: [-5, -15, 0], chest: [-1, -5, 0], head: [4, 16, 0], shR: [-114, 14, 2], elR: [-80], wrR: [45, -1, 0], shL: [-50, -20, 30], elL: [-90], wrL: [0, 0, 0], pos: [0, 0, -0.04], fL: [0, 0, 0], fR: [0, 0, 0] }],
    [0.22, { hips: [-3, -13, 0], torso: [-8, -21, 0], chest: [-2, -8, 0], head: [8, 22, 0], shR: [-136, 22, 2], elR: [-30], wrR: [10, 0, 0], shL: [-40, -10, 34], elL: [-80], pos: [0, 0.03, -0.08], fL: [0, 0.07, 0.08] }, 1],
    [0.40, { hips: [3, -2, 0], torso: [6, -3, 0], chest: [2, -1, 0], head: [-5, 3, 0], shR: [-90, 27, -2], elR: [-95], wrR: [39, -22, 0], pos: [0, -0.08, 0.1], fL: [0, 0.04, 0.22] }],
    [0.52, { hips: [8, 11, 0], torso: [18, 18, 0], chest: [5, 6, 0], head: [-16, -19, 0], shR: [-64, 31, 19], elR: [-102], wrR: [96, -53, 0], shL: [-30, 20, 30], elL: [-60], pos: [0, -0.16, 0.26], fL: [0, 0, 0.3], fR: [0, 0, 0] }],
    [0.68, { hips: [9, 16, 0], torso: [20, 25, 0], chest: [5, 9, 0], head: [-19, -26, 0], shR: [-69, 35, -3], elR: [-6], wrR: [96, 2, 0], pos: [0, -0.18, 0.28] }, 0.3],
    [0.86, { hips: [4, 7, 0], torso: [10, 11, 0], chest: [2, 4, 0], head: [-9, -12, 0], shR: [-48, 28, 4], elR: [-21], wrR: [86, -28, 0], shL: [-50, -10, 26], elL: [-90], pos: [0, -0.1, 0.2], fR: [0, 0.06, 0.12] }],
    [1.00, { hips: [3, 3, 0], torso: [6, 4, 0], chest: [2, 1, 0], head: [-5, -4, 0], shR: [0, 9, 7], elR: [-93], wrR: [44, -6, 0], shL: [-50, -20, 24], elL: [-90], pos: [0, -0.06, 0.16], fL: [0, 0, 0.3], fR: [0, 0, 0.16] }],
  ] },
  // readable wind-up: weapon cocked high over the right shoulder, weight back, held with a tremor until the swing
  telegraph: { dur: 0.6, hit: 1.1, side: 'R', out: 0, linger: 1.4, blend: 0.1, proc: tremble(1.6), frames: [
    [0.00, { hips: [0, -3, 0], torso: [-1, -5, 0], chest: [0, -2, 0], head: [1, 5, 0], shR: [-47, -8, 5], elR: [-121], wrR: [44, -6, 0], shL: [-60, -20, 26], elL: [-90], wrL: [0, 0, 0], pos: [0, -0.02, 0], fL: [0, 0, 0] }],
    [0.40, { hips: [-1, -8, 0], torso: [-4, -13, 0], chest: [-1, -5, 0], head: [3, 14, 0], shR: [-104, 8, 1], elR: [-87], wrR: [47, -5, 0], shL: [-50, -14, 30], elL: [-88], pos: [0, -0.02, -0.04] }],
    [0.70, { hips: [-2, -10, 0], torso: [-6, -16, 0], chest: [-1, -6, 0], head: [6, 17, 0], shR: [-122, 14, 3], elR: [-64], wrR: [33, 0, 0], shL: [-44, -10, 32], elL: [-84], pos: [0, 0, -0.06], fL: [0, 0.04, 0.04] }, 1],
    [1.00, { hips: [-2, -10, 0], torso: [-5, -15, 0], chest: [-1, -6, 0], head: [5, 16, 0], shR: [-118, 14, 3], elR: [-70], wrR: [36, 1, 0], shL: [-45, -10, 32], elL: [-85], pos: [0, -0.02, -0.05], fL: [0, 0, 0.06] }],
  ] },
  // gun recoil, additive on top of the aim line (aimArm keeps the arm on target even when not aiming)
  shoot: { dur: 0.35, hit: 0.2, side: 'R', additive: true, aimArm: true, out: 0.4, blend: 0.03, frames: [
    [0.00, { shR: [0, 0, 0], elR: [0], wrR: [0, 0, 0], torso: [0, 0, 0], chest: [0, 0, 0], head: [0, 0, 0], pos: [0, 0, 0] }],
    [0.10, { shR: [-13, 2, 2], elR: [-14], wrR: [-14, 0, 0], torso: [-2, 0, 0], chest: [-4, 2, 0], head: [-3, 0, 0], pos: [0, 0, -0.02] }, 1],
    [0.38, { shR: [-3, 0, 0], elR: [-4], wrR: [-3, 0, 0], torso: [-0.5, 0, 0], chest: [-1, 1, 0], head: [-1, 0, 0], pos: [0, 0, -0.008] }],
    [1.00, { shR: [0, 0, 0], elR: [0], wrR: [0, 0, 0], torso: [0, 0, 0], chest: [0, 0, 0], head: [0, 0, 0], pos: [0, 0, 0] }],
  ] },
  // ranged telegraph: snap the gun up onto the target and settle the sights (additive over the aim line)
  aim: { dur: 0.5, hit: 2, side: 'R', additive: true, aimArm: true, out: 0, linger: 1.5, blend: 0.06, frames: [
    [0.00, { shR: [24, 0, 0], elR: [-30], wrR: [20, 0, 0], chest: [2, 0, 0], head: [6, 0, 0] }],
    [0.40, { shR: [-4, 0, 0], elR: [2], wrR: [-3, 0, 0], chest: [-1, 0, 0], head: [-1, 0, 0] }],
    [1.00, { shR: [0, 0, 0], elR: [0], wrR: [0, 0, 0], chest: [0, 0, 0], head: [0, 0, 0] }],
  ] },

  // ============================== reactions ==============================
  // directional hit reactions (additive, so they land on top of whatever the body is doing); 'hurt' picks one
  hurtF: { dur: 0.3, hit: 2, side: 'R', additive: true, out: 0.45, blend: 0.03, look: 0.3, frames: [
    [0.00, { hips: [0, 0, 0], torso: [0, 0, 0], chest: [0, 0, 0], head: [0, 0, 0], shL: [0, 0, 0], shR: [0, 0, 0], elL: [0], elR: [0], pos: [0, 0, 0] }],
    [0.13, { hips: [-6, 0, 0], torso: [-20, 0, 0], chest: [-8, 0, 0], head: [-22, 0, 0], shL: [-28, 0, 14], shR: [-28, 0, -14], elL: [-20], elR: [-20], pos: [0, -0.04, -0.1] }, 1],
    [0.45, { hips: [1, 0, 0], torso: [4, 0, 0], chest: [2, 0, 0], head: [6, 0, 0], shL: [6, 0, 0], shR: [6, 0, 0], elL: [-5], elR: [-5], pos: [0, -0.01, -0.03] }],
    [1.00, { hips: [0, 0, 0], torso: [0, 0, 0], chest: [0, 0, 0], head: [0, 0, 0], shL: [0, 0, 0], shR: [0, 0, 0], elL: [0], elR: [0], pos: [0, 0, 0] }],
  ] },
  hurtB: { dur: 0.3, hit: 2, side: 'R', additive: true, out: 0.45, blend: 0.03, look: 0.3, frames: [
    [0.00, { hips: [0, 0, 0], torso: [0, 0, 0], chest: [0, 0, 0], head: [0, 0, 0], shL: [0, 0, 0], shR: [0, 0, 0], elL: [0], elR: [0], pos: [0, 0, 0] }],
    [0.13, { hips: [8, 0, 0], torso: [22, 0, 0], chest: [8, 0, 0], head: [-16, 0, 0], shL: [22, 0, 12], shR: [22, 0, -12], elL: [-14], elR: [-14], pos: [0, -0.05, 0.1] }, 1],
    [0.45, { hips: [-1, 0, 0], torso: [-4, 0, 0], chest: [-1, 0, 0], head: [8, 0, 0], shL: [-4, 0, 0], shR: [-4, 0, 0], elL: [-4], elR: [-4], pos: [0, -0.01, 0.03] }],
    [1.00, { hips: [0, 0, 0], torso: [0, 0, 0], chest: [0, 0, 0], head: [0, 0, 0], shL: [0, 0, 0], shR: [0, 0, 0], elL: [0], elR: [0], pos: [0, 0, 0] }],
  ] },
  // hit from the character's left (pushed to its right): bends right, twists away, left arm flung out
  hurtL: { dur: 0.3, hit: 2, side: 'R', additive: true, out: 0.45, blend: 0.03, look: 0.3, frames: [
    [0.00, { hips: [0, 0, 0], torso: [0, 0, 0], chest: [0, 0, 0], head: [0, 0, 0], shL: [0, 0, 0], shR: [0, 0, 0], elL: [0], elR: [0], pos: [0, 0, 0] }],
    [0.13, { hips: [0, -8, 6], torso: [-6, -18, 14], chest: [0, -10, 8], head: [-8, -16, 20], shL: [-12, 0, 30], shR: [-14, 0, 8], elL: [-25], elR: [-10], pos: [-0.08, -0.03, 0] }, 1],
    [0.45, { hips: [0, 1, -1], torso: [1, 3, -3], chest: [0, 2, -2], head: [2, 4, -5], shL: [2, 0, -4], shR: [2, 0, -2], elL: [-4], elR: [-2], pos: [0.02, -0.01, 0] }],
    [1.00, { hips: [0, 0, 0], torso: [0, 0, 0], chest: [0, 0, 0], head: [0, 0, 0], shL: [0, 0, 0], shR: [0, 0, 0], elL: [0], elR: [0], pos: [0, 0, 0] }],
  ] },

  // dodge roll: dive, tuck tight (knees to chest, arms wrapped, chin down) while the rig rolls about its centre, come up crouched
  dodge: { dur: 0.5, hit: 2, side: 'R', out: 0.16, blend: 0.05, look: 0, frames: [
    [0.00, { pos: [0, -0.16, 0.04], torso: [26, 0, 0], chest: [6, 0, 0], head: [12, 0, 0], shL: [-70, 0, 20], shR: [-70, 0, -20], elL: [-60], elR: [-60], wrL: [20, 0, 0], wrR: [20, 0, 0],
      hipL: [-50, 0, 6], knL: [70], anL: [10, 0, 0], hipR: [-30, 0, -6], knR: [50], anR: [20, 0, 0] }],
    [0.16, { pos: [0, -0.36, 0], torso: [52, 0, 0], chest: [16, 0, 0], head: [32, 0, 0], shL: [-78, -14, 8], shR: [-78, 14, -8], elL: [-115], elR: [-115],
      hipL: [-105, 0, 8], knL: [135], anL: [35, 0, 0], hipR: [-100, 0, -8], knR: [135], anR: [35, 0, 0] }],
    [0.78, { pos: [0, -0.38, 0], torso: [55, 0, 0], chest: [18, 0, 0], head: [34, 0, 0], shL: [-80, -16, 8], shR: [-80, 16, -8], elL: [-118], elR: [-118],
      hipL: [-108, 0, 8], knL: [138], anL: [35, 0, 0], hipR: [-104, 0, -8], knR: [138], anR: [35, 0, 0] }],
    [1.00, { pos: [0, -0.2, 0.02], torso: [20, 0, 0], chest: [4, 0, 0], head: [6, 0, 0], shL: [-45, 0, 18], shR: [-40, 0, -18], elL: [-70], elR: [-70], wrL: [10, 0, 0], wrR: [10, 0, 0],
      hipL: [-55, 0, 6], knL: [80], anL: [-10, 0, 0], hipR: [-35, 0, -6], knR: [60], anR: [0, 0, 0] }],
  ] },

  // surrender: drop to one knee, then both, hands up beside the head, head bowed, trembling
  surrender: { dur: 0.5, hit: 2, side: 'R', hold: true, out: 0, blend: 0.1, look: 0.6, proc: tremble(1.4), frames: [
    [0.00, { pos: [0, -0.04, 0], torso: [4, 0, 0], head: [4, 0, 0], shL: [-40, 30, 20], elL: [-60], wrL: [0, 0, 0], shR: [-40, -30, -20], elR: [-60], wrR: [0, 0, 0],
      hipL: [-8, 0, 4], knL: [12], anL: [0, 0, 0], hipR: [-8, 0, -4], knR: [12], anR: [0, 0, 0] }],
    [0.30, { pos: [0, -0.3, -0.02], torso: [10, 0, 0], head: [8, 0, 0], shL: [-80, 70, 0], elL: [-80], shR: [-80, -70, 0], elR: [-80],
      hipL: [-60, 0, 6], knL: [80], anL: [-20, 0, 0], hipR: [-30, 0, -6], knR: [110], anR: [40, 0, 0] }],
    [0.60, { pos: [0, -0.52, -0.04], torso: [6, 0, 0], head: [12, 0, 0], shL: [-95, 88, 0], elL: [-95], shR: [-95, -88, 0], elR: [-95],
      hipL: [-50, 0, 8], knL: [136], anL: [70, 0, 0], hipR: [-50, 0, -8], knR: [136], anR: [70, 0, 0] }],
    [1.00, { pos: [0, -0.55, -0.06], torso: [8, 0, 0], head: [16, 0, 0], shL: [-100, 85, 0], elL: [-100], wrL: [-10, 0, 0], shR: [-100, -85, 0], elR: [-100], wrR: [-10, 0, 0],
      hipL: [-49, 0, 8], knL: [139], anL: [75, 0, 0], hipR: [-49, 0, -8], knR: [139], anR: [75, 0, 0] }],
  ] },
  // taser: rigid convulsion up on the toes, legs give, pitch forward onto the face, twitch out
  subdued: { dur: 0.9, hit: 2, side: 'R', hold: true, out: 0, blend: 0.05, look: 0, impact: 0.74, ground: 'front', proc: convulse, frames: [
    [0.00, { root: [0, 0, 0], pos: [0, 0.03, 0], torso: [-12, 0, 0], chest: [-6, 0, 0], head: [-20, 0, 0], shL: [-30, 0, 40], shR: [-30, 0, -40], elL: [-110], elR: [-110], wrL: [40, 0, 0], wrR: [40, 0, 0],
      hipL: [0, 0, 6], knL: [4], anL: [30, 0, 0], hipR: [0, 0, -6], knR: [4], anR: [30, 0, 0] }],
    [0.30, { pos: [0, 0.02, 0], torso: [-16, 6, 4], chest: [-8, 0, 0], head: [-26, 10, 0], shL: [-40, 10, 50], shR: [-36, -10, -46], elL: [-120], elR: [-115], hipL: [-4, 0, 8], knL: [6], hipR: [2, 0, -8], knR: [8] }],
    [0.48, { root: [6, 0, -4], pos: [0, -0.35, 0.02], torso: [10, 10, 6], chest: [0, 0, 0], head: [10, 10, 0], shL: [-20, 0, 20], shR: [-20, 0, -20], elL: [-60], elR: [-70], wrL: [10, 0, 0], wrR: [10, 0, 0],
      hipL: [-55, 0, 8], knL: [100], anL: [10, 0, 0], hipR: [-50, 0, -8], knR: [100], anR: [10, 0, 0] }],
    [0.60, { root: [30, 0, -8], pos: [0, -0.55, 0], torso: [20, 6, 4], head: [16, 0, 0], shL: [-50, 10, 20], shR: [-40, -10, -20], elL: [-40], elR: [-50],
      hipL: [-70, 0, 8], knL: [120], anL: [40, 0, 0], hipR: [-66, 0, -8], knR: [120], anR: [40, 0, 0] }],
    [0.74, { root: [86, 0, -6], pos: [0, -0.8, -0.2], torso: [4, 0, 0], head: [-6, 60, 0], shL: [-150, 20, 30], elL: [-30], shR: [-20, -10, -20], elR: [-60],
      hipL: [-10, 0, 10], knL: [20], anL: [30, 0, 0], hipR: [-20, 0, -10], knR: [40], anR: [30, 0, 0] }],
    [0.84, { root: [82, 0, -6], pos: [0, -0.78, -0.23], torso: [8, 0, 0], head: [-10, 55, 0] }],
    [1.00, { root: [88, 0, -6], pos: [0, -0.82, -0.22], torso: [2, 0, 0], head: [-8, 62, 0], shL: [-155, 25, 30], elL: [-35], wrL: [20, 0, 0], shR: [-10, -10, -15], elR: [-12], wrR: [30, 0, 0],
      hipL: [-6, 0, 12], knL: [16], anL: [40, 0, 0], hipR: [-24, 0, -10], knR: [50], anR: [40, 0, 0] }],
  ] },

  // knocked down by a heavy blow from the front: legs swept, slammed onto the back, bounce
  knockdownB: { dur: 0.6, hit: 2, side: 'R', hold: true, out: 0, blend: 0.04, look: 0, impact: 0.62, ground: 'back', frames: [
    [0.00, { root: [0, 0, 0], pos: [0, -0.02, -0.08], torso: [-18, 0, 0], chest: [-6, 0, 0], head: [-20, 0, 0], shL: [-50, 10, 30], shR: [-50, -10, -30], elL: [-40], elR: [-40], wrL: [0, 0, 0], wrR: [0, 0, 0],
      hipL: [-10, 0, 4], knL: [10], anL: [0, 0, 0], hipR: [-5, 0, -4], knR: [10], anR: [0, 0, 0] }],
    [0.25, { root: [-25, 0, 0], pos: [0, -0.25, -0.05], torso: [-6, 0, 0], head: [-6, 0, 0], shL: [-110, 10, 30], shR: [-100, -10, -30], elL: [-50], elR: [-50],
      hipL: [-45, 0, 6], knL: [50], anL: [-10, 0, 0], hipR: [-30, 0, -6], knR: [40], anR: [-10, 0, 0] }],
    [0.48, { root: [-62, 0, 0], pos: [0, -0.6, 0.08], torso: [8, 0, 0], head: [10, 0, 0], shL: [-140, 10, 40], shR: [-130, -10, -40], elL: [-40], elR: [-40], hipL: [-50, 0, 6], knL: [60], hipR: [-40, 0, -6], knR: [50] }],
    [0.62, { root: [-90, 0, 0], pos: [0, -0.84, 0.2], torso: [0, 0, 0], chest: [0, 0, 0], head: [-6, 0, 0], shL: [10, 10, 70], shR: [10, -10, -70], elL: [-24], elR: [-24], wrL: [50, 0, 0], wrR: [60, 0, 0],
      hipL: [-30, 0, 8], knL: [50], anL: [10, 0, 0], hipR: [-20, 0, -8], knR: [35], anR: [10, 0, 0] }],
    [0.75, { root: [-85, 0, 0], pos: [0, -0.82, 0.24], torso: [10, 0, 0], head: [10, 0, 0], shL: [0, 10, 60], shR: [0, -10, -60] }],
    [1.00, { root: [-90, 0, 0], pos: [0, -0.85, 0.2], torso: [4, 0, 0], head: [4, -20, 0], shL: [8, 12, 68], elL: [-20], wrL: [60, 0, 0], shR: [8, -12, -66], elR: [-22], wrR: [70, 0, 0],
      hipL: [-40, 0, 8], knL: [70], anL: [10, 0, 0], hipR: [-15, 0, -8], knR: [25], anR: [10, 0, 0] }],
  ] },
  // knocked down from behind: pitched forward, catches the fall on the hands
  knockdownF: { dur: 0.6, hit: 2, side: 'R', hold: true, out: 0, blend: 0.04, look: 0, impact: 0.62, ground: 'front', frames: [
    [0.00, { root: [0, 0, 0], pos: [0, -0.02, 0.08], torso: [20, 0, 0], chest: [6, 0, 0], head: [-14, 0, 0], shL: [20, 0, 20], shR: [20, 0, -20], elL: [-20], elR: [-20], wrL: [0, 0, 0], wrR: [0, 0, 0],
      hipL: [-10, 0, 4], knL: [12], anL: [0, 0, 0], hipR: [-5, 0, -4], knR: [12], anR: [0, 0, 0] }],
    [0.25, { root: [20, 0, 0], pos: [0, -0.25, 0.04], torso: [25, 0, 0], head: [-10, 0, 0], shL: [-60, 0, 20], shR: [-60, 0, -20], elL: [-30], elR: [-30], hipL: [-40, 0, 6], knL: [60], hipR: [-35, 0, -6], knR: [60] }],
    [0.50, { root: [60, 0, 0], pos: [0, -0.55, -0.1], torso: [10, 0, 0], head: [-20, 0, 0], shL: [-110, 10, 20], shR: [-110, -10, -20], elL: [-30], elR: [-30],
      hipL: [-40, 0, 6], knL: [70], anL: [30, 0, 0], hipR: [-30, 0, -6], knR: [60], anR: [30, 0, 0] }],
    [0.62, { root: [88, 0, 0], pos: [0, -0.82, -0.22], torso: [-4, 0, 0], chest: [0, 0, 0], head: [-14, 0, 0], shL: [-60, 30, 30], shR: [-60, -30, -30], elL: [-90], elR: [-90],
      hipL: [-8, 0, 8], knL: [16], anL: [40, 0, 0], hipR: [-8, 0, -8], knR: [16], anR: [40, 0, 0] }],
    [0.75, { root: [84, 0, 0], pos: [0, -0.8, -0.25], head: [-20, 0, 0] }],
    [1.00, { root: [89, 0, 0], pos: [0, -0.83, -0.22], torso: [-2, 0, 0], head: [-12, 40, 0], shL: [-62, 30, 30], elL: [-95], shR: [-60, -30, -30], elR: [-90],
      hipL: [-6, 0, 10], knL: [14], anL: [45, 0, 0], hipR: [-10, 0, -8], knR: [18], anR: [45, 0, 0] }],
  ] },
  // heavy get-up from the back: sit up pushing on the hands, feet planted, rock forward over them, rise
  getupB: { dur: 0.7, hit: 2, side: 'R', out: 0.25, blend: 0.1, look: 0.3, stand: true, feetAbs: true, feetGround: true, frames: [
    [0.00, { root: [-90, 0, 0], pos: [0, -0.85, 0.2], torso: [4, 0, 0], head: [4, -10, 0], shL: [8, 12, 68], elL: [-20], wrL: [60, 0, 0], shR: [8, -12, -66], elR: [-22], wrR: [70, 0, 0],
      fL: [0.2, 0.02, 0.6], fR: [-0.17, 0.02, 0.74], ftL: [-60, 0, 0], ftR: [-70, 0, 0] }],
    [0.24, { root: [-55, 0, 0], pos: [0, -0.74, 0.12], torso: [42, 0, 0], head: [12, 0, 0], shL: [34, 0, 30], elL: [-14], wrL: [-50, 0, 0], shR: [34, 0, -30], elR: [-14], wrR: [-50, 0, 0],
      fL: [0.18, 0, 0.32], fR: [-0.18, 0, 0.36], ftL: [0, 0.1, 0], ftR: [0, -0.1, 0] }, 1],
    [0.50, { root: [-14, 0, 0], pos: [0, -0.5, 0.04], torso: [42, 0, 0], head: [-10, 0, 0], shL: [-60, 0, 22], elL: [-50], wrL: [0, 0, 0], shR: [-60, 0, -22], elR: [-50], wrR: [0, 0, 0],
      fL: [0.18, 0, 0.12], fR: [-0.18, 0, 0.1], ftL: [0, 0, 0], ftR: [0, 0, 0] }],
    [0.76, { root: [0, 0, 0], pos: [0, -0.2, 0.02], torso: [22, 0, 0], head: [-4, 0, 0], shL: [-30, 0, 20], elL: [-50], shR: [-30, 0, -20], elR: [-50], fL: [0.17, 0, 0.06], fR: [-0.17, 0, -0.02] }],
    [1.00, { root: [0, 0, 0], pos: [0, -0.02, 0], torso: [6, 0, 0], head: [0, 0, 0], shL: [-10, 0, 10], elL: [-30], shR: [-10, 0, -10], elR: [-30], fL: [0.16, 0, 0.04], fR: [-0.16, 0, -0.02], ftL: [0, 0.1, 0], ftR: [0, -0.1, 0] }],
  ] },
  // from the face: push up, drag a knee under, foot planted, drive up
  getupF: { dur: 0.7, hit: 2, side: 'R', out: 0.25, blend: 0.1, look: 0.3, stand: true, feetAbs: true, feetGround: true, frames: [
    [0.00, { root: [89, 0, 0], pos: [0, -0.83, -0.22], torso: [-2, 0, 0], head: [-12, 20, 0], shL: [-62, 30, 30], elL: [-95], wrL: [0, 0, 0], shR: [-60, -30, -30], elR: [-90], wrR: [0, 0, 0],
      fL: [0.2, 0.02, -0.78], fR: [-0.2, 0.02, -0.78], ftL: [80, 0, 0], ftR: [80, 0, 0] }],
    [0.26, { root: [58, 0, 0], pos: [0, -0.68, -0.18], torso: [-14, 0, 0], head: [-24, 0, 0], shL: [-75, 10, 20], elL: [-10], wrL: [-60, 0, 0], shR: [-75, -10, -20], elR: [-10], wrR: [-60, 0, 0],
      fL: [0.18, 0.02, -0.55], fR: [-0.18, 0.02, -0.62], ftL: [70, 0, 0], ftR: [70, 0, 0] }, 1],
    [0.50, { root: [30, 0, 0], pos: [0, -0.5, -0.08], torso: [24, 0, 0], head: [-16, 0, 0], shL: [-50, 0, 20], elL: [-30], wrL: [-20, 0, 0], shR: [-60, 0, -20], elR: [-30], wrR: [-20, 0, 0],
      fL: [0.18, 0, 0.12], fR: [-0.18, 0.02, -0.3], ftL: [0, 0.1, 0], ftR: [50, 0, 0] }],
    [0.76, { root: [6, 0, 0], pos: [0, -0.22, 0.02], torso: [22, 0, 0], head: [-6, 0, 0], shL: [-30, 0, 20], elL: [-50], wrL: [0, 0, 0], shR: [-30, 0, -20], elR: [-50], wrR: [0, 0, 0],
      fL: [0.17, 0, 0.1], fR: [-0.17, 0, -0.06], ftL: [0, 0, 0], ftR: [0, 0, 0] }],
    [1.00, { root: [0, 0, 0], pos: [0, -0.02, 0], torso: [6, 0, 0], head: [0, 0, 0], shL: [-10, 0, 10], elL: [-30], shR: [-10, 0, -10], elR: [-30], fL: [0.16, 0, 0.06], fR: [-0.16, 0, -0.04], ftL: [0, 0.1, 0], ftR: [0, -0.1, 0] }],
  ] },

  // deaths: knees go first, then the topple, the slap onto the floor with a small bounce, limbs sprawl, head rolls to the side
  dieB: { dur: 0.85, hit: 2, side: 'R', hold: true, out: 0, blend: 0.04, look: 0, impact: 0.68, ground: 'back', proc: deathTwitch, frames: [
    [0.00, { root: [0, 0, 0], pos: [0, 0, -0.05], torso: [-16, 0, 0], chest: [-6, 0, 0], head: [-26, 0, 0], shL: [-60, 10, 25], shR: [-55, -10, -25], elL: [-50], elR: [-60], wrL: [0, 0, 0], wrR: [0, 0, 0],
      hipL: [-6, 0, 4], knL: [8], anL: [0, 0, 0], hipR: [-4, 0, -4], knR: [8], anR: [0, 0, 0] }],
    [0.22, { root: [-12, 0, 0], pos: [0, -0.26, -0.04], torso: [-8, 4, 0], head: [-14, 8, 0], shL: [-80, 10, 30], shR: [-70, -10, -30], elL: [-40], elR: [-50],
      hipL: [-38, 0, 6], knL: [62], anL: [-12, 0, 0], hipR: [-30, 0, -6], knR: [56], anR: [-10, 0, 0] }],
    [0.46, { root: [-56, 0, 0], pos: [0, -0.56, 0.06], torso: [12, 4, 0], head: [12, 10, 0], shL: [-130, 10, 36], shR: [-120, -10, -36], elL: [-40], elR: [-46],
      hipL: [-42, 0, 6], knL: [52], anL: [0, 0, 0], hipR: [-34, 0, -6], knR: [46], anR: [0, 0, 0] }],
    [0.68, { root: [-89, 0, 0], pos: [0, -0.84, 0.2], torso: [0, 0, 0], chest: [0, 0, 0], head: [-8, 20, 0], shL: [12, 10, 72], shR: [12, -10, -72], elL: [-20], elR: [-22], wrL: [50, 0, 0], wrR: [50, 0, 0],
      hipL: [-12, 0, 8], knL: [22], anL: [16, 0, 0], hipR: [-30, 0, -8], knR: [50], anR: [10, 0, 0] }],
    [0.78, { root: [-85, 0, 0], pos: [0, -0.82, 0.23], torso: [8, 0, 0], head: [8, 30, 0], shL: [4, 10, 64], shR: [4, -10, -64], elL: [-40], elR: [-42], knL: [26], knR: [56] }, 0.2],
    [1.00, { root: [-90, 0, 0], pos: [0, -0.86, 0.2], torso: [2, 0, 0], chest: [0, 0, 0], head: [2, 55, 0], shL: [14, 18, 76], elL: [-14], wrL: [70, 0, 0], shR: [16, -8, -58], elR: [-18], wrR: [60, 0, 0],
      hipL: [4, 0, 12], knL: [12], anL: [30, 0, 0], hipR: [-34, 0, -8], knR: [62], anR: [10, 0, 0] }],
  ] },
  dieF: { dur: 0.85, hit: 2, side: 'R', hold: true, out: 0, blend: 0.04, look: 0, impact: 0.68, ground: 'front', proc: deathTwitch, frames: [
    [0.00, { root: [0, 0, 0], pos: [0, 0, 0.06], torso: [18, 0, 0], chest: [8, 0, 0], head: [-18, 0, 0], shL: [24, 0, 18], shR: [20, 0, -18], elL: [-20], elR: [-24], wrL: [0, 0, 0], wrR: [0, 0, 0],
      hipL: [-6, 0, 4], knL: [10], anL: [0, 0, 0], hipR: [-4, 0, -4], knR: [10], anR: [0, 0, 0] }],
    [0.24, { root: [14, 0, 0], pos: [0, -0.3, 0.04], torso: [26, 0, 0], head: [-8, 0, 0], shL: [-20, 0, 20], shR: [-24, 0, -20], elL: [-30], elR: [-30],
      hipL: [-44, 0, 6], knL: [70], anL: [10, 0, 0], hipR: [-40, 0, -6], knR: [72], anR: [10, 0, 0] }],
    [0.48, { root: [55, 0, 0], pos: [0, -0.58, -0.08], torso: [14, 0, 0], head: [-18, 0, 0], shL: [-90, 10, 20], shR: [-80, -10, -20], elL: [-30], elR: [-40],
      hipL: [-40, 0, 6], knL: [64], anL: [30, 0, 0], hipR: [-36, 0, -6], knR: [62], anR: [30, 0, 0] }],
    [0.68, { root: [88, 0, 0], pos: [0, -0.83, -0.22], torso: [-2, 0, 0], chest: [0, 0, 0], head: [-10, 40, 0], shL: [-150, 16, 22], shR: [-4, -6, -14], elL: [-12], elR: [-14],
      hipL: [-6, 0, 10], knL: [14], anL: [40, 0, 0], hipR: [-14, 0, -8], knR: [24], anR: [40, 0, 0] }],
    [0.78, { root: [84, 0, 0], pos: [0, -0.81, -0.25], torso: [4, 0, 0], head: [-16, 50, 0] }, 0.2],
    [1.00, { root: [89, 0, 0], pos: [0, -0.84, -0.22], torso: [0, 0, 0], chest: [0, 0, 0], head: [-12, 68, 0], shL: [-158, 20, 24], elL: [-8], wrL: [40, 0, 0], shR: [10, -4, -14], elR: [-6], wrR: [30, 0, 0],
      hipL: [-2, 0, 12], knL: [8], anL: [50, 0, 0], hipR: [-20, 0, -10], knR: [36], anR: [45, 0, 0] }],
  ] },
  // pushed to its left (hit from the right): knees buckle, twists, crumples onto the left side, curls a little
  dieSL: { dur: 0.85, hit: 2, side: 'R', hold: true, out: 0, blend: 0.04, look: 0, impact: 0.7, ground: 'side', proc: deathTwitch, frames: [
    [0.00, { root: [0, 0, 0], pos: [0.04, 0, 0], hips: [0, 6, -4], torso: [-6, 10, -14], chest: [0, 4, -6], head: [-10, 10, -18], shL: [-20, 0, 30], shR: [-40, 0, -20], elL: [-30], elR: [-50], wrL: [0, 0, 0], wrR: [0, 0, 0],
      hipL: [-6, 0, 6], knL: [10], anL: [0, 0, 0], hipR: [-6, 0, -4], knR: [10], anR: [0, 0, 0] }],
    [0.26, { root: [0, 0, -10], pos: [0.06, -0.34, 0], hips: [0, 12, -6], torso: [14, 14, -10], head: [10, 14, -10], shL: [-20, 0, 20], shR: [-50, 0, -20], elL: [-40], elR: [-60],
      hipL: [-46, 0, 6], knL: [80], anL: [10, 0, 0], hipR: [-40, 0, -6], knR: [76], anR: [10, 0, 0] }],
    [0.50, { root: [10, 0, -52], pos: [-0.08, -0.6, 0], hips: [0, 14, -4], torso: [20, 16, -6], head: [16, 10, 0], shL: [-50, 0, 40], shR: [-70, 0, -30], elL: [-40], elR: [-60],
      hipL: [-56, 0, 6], knL: [84], anL: [20, 0, 0], hipR: [-50, 0, -6], knR: [80], anR: [20, 0, 0] }],
    [0.70, { root: [26, 0, -74], pos: [-0.2, -0.84, 0], hips: [0, 12, 0], torso: [24, 12, 0], chest: [6, 0, 0], head: [10, -10, 10], shL: [-80, 0, 30], shR: [-60, 0, -30], elL: [-20], elR: [-70],
      hipL: [-50, 0, 4], knL: [70], anL: [30, 0, 0], hipR: [-62, 0, -4], knR: [84], anR: [30, 0, 0] }],
    [0.80, { root: [24, 0, -70], pos: [-0.23, -0.82, 0], torso: [28, 12, 0], head: [14, -6, 6] }, 0.2],
    [1.00, { root: [28, 0, -74], pos: [-0.21, -0.85, 0], hips: [0, 12, 0], torso: [26, 12, 0], chest: [6, 0, 0], head: [16, -14, 12], shL: [-96, 4, -10], elL: [-16], wrL: [40, 0, 0], shR: [-40, 0, -24], elR: [-40], wrR: [50, 0, 0],
      hipL: [-46, 0, 4], knL: [64], anL: [35, 0, 0], hipR: [-66, 0, -4], knR: [92], anR: [35, 0, 0] }],
  ] },

  // ============================== civilians ==============================
  // cower: crouch into a ball, forearms over the head, trembling (legs stay with the IK, so the knees fold over planted feet)
  cower: { dur: 0.45, hit: 2, side: 'R', hold: true, out: 0, blend: 0.08, look: 0.4, proc: tremble(2.2), frames: [
    [0.00, { pos: [0, -0.06, 0], torso: [10, 0, 0], chest: [4, 0, 0], head: [6, 0, 0], shL: [-60, -20, 20], elL: [-90], wrL: [0, 0, 0], shR: [-60, 20, -20], elR: [-90], wrR: [0, 0, 0] }],
    [0.45, { pos: [0, -0.38, -0.04], torso: [36, 0, 0], chest: [14, 0, 0], head: [22, 0, 0], shL: [-135, -42, 14], elL: [-128], wrL: [-20, 0, 0], shR: [-135, 42, -14], elR: [-128], wrR: [-20, 0, 0] }, 1],
    [1.00, { pos: [0, -0.42, -0.05], torso: [40, 0, 0], chest: [16, 0, 0], head: [26, 0, 0], shL: [-140, -45, 12], elL: [-132], wrL: [-24, 0, 0], shR: [-140, 45, -12], elR: [-132], wrR: [-24, 0, 0] }],
  ] },
  // hands up: freeze, shrink a little, palms out by the head, look away; trembling
  handsup: { dur: 0.4, hit: 2, side: 'R', hold: true, out: 0, blend: 0.08, look: 0.5, proc: tremble(1.8), frames: [
    [0.00, { pos: [0, -0.02, 0], torso: [2, 0, 0], head: [2, 0, 0], shL: [-50, 40, 10], elL: [-70], wrL: [0, 0, 0], shR: [-50, -40, -10], elR: [-70], wrR: [0, 0, 0] }],
    [0.45, { pos: [0, -0.07, -0.04], torso: [-4, 0, 0], chest: [-2, 0, 0], head: [4, 14, 0], shL: [-98, 86, 0], elL: [-100], wrL: [-16, 0, 0], shR: [-98, -86, 0], elR: [-100], wrR: [-16, 0, 0] }, 1],
    [1.00, { pos: [0, -0.08, -0.04], torso: [2, 0, 0], chest: [0, 0, 0], head: [12, 18, 0], shL: [-102, 84, 0], elL: [-104], wrL: [-18, 0, 0], shR: [-102, -84, 0], elR: [-104], wrR: [-18, 0, 0] }],
  ] },
};

// mirrored variants
DEFS.hurtR = mirrorDef(DEFS.hurtL);
DEFS.dieSR = mirrorDef(DEFS.dieSL);

// 'hurt' / 'die' / 'knockdown' / 'getup' are the public names; they resolve to a variant from the push direction (character space)
// or from the lying state.  Their own entries carry the default variant so CLIPS[name].dur stays valid for callers.
const pickDir = (dir) => {
  if (!dir) return null;
  const x = Array.isArray(dir) ? dir[0] : dir.x, z = Array.isArray(dir) ? dir[2] : dir.z;
  if (!(Math.abs(x) + Math.abs(z) > 1e-4)) return null;
  if (Math.abs(z) >= Math.abs(x)) return z < 0 ? 'F' : 'B';   // pushed back = hit from the front
  return x < 0 ? 'L' : 'R';                                    // pushed to its right = hit from its left
};
DEFS.hurt = { ...DEFS.hurtF, select: (dir, ch) => (ch.ground ? (ch.ground === 'front' ? 'getupF' : 'getupB') : 'hurt' + (pickDir(dir) || 'F')) };
DEFS.die = { ...DEFS.dieB, select: (dir) => {
  const d = pickDir(dir);
  if (d === 'F') return 'dieB'; if (d === 'B') return 'dieF'; if (d === 'L') return 'dieSR'; if (d === 'R') return 'dieSL';
  const r = Math.random(); return r < 0.5 ? 'dieB' : r < 0.75 ? 'dieSL' : 'dieSR';
} };
DEFS.knockdown = { ...DEFS.knockdownB, select: (dir) => (pickDir(dir) === 'B' ? 'knockdownF' : 'knockdownB') };
DEFS.getup = { ...DEFS.getupB, select: (dir, ch) => (ch.ground === 'front' ? 'getupF' : 'getupB') };

// ---- idle fidgets: small additive micro-clips layered on standing idles --------------------------------
const FDEFS = {
  shrug: { dur: 1.4, frames: [[0, { shL: [0, 0, 0], shR: [0, 0, 0], chest: [0, 0, 0], head: [0, 0, 0] }], [0.35, { shL: [-6, 0, 8], shR: [-6, 0, -8], chest: [-3, 0, 0], head: [-4, 0, 6] }, 1], [0.7, { shL: [2, 0, -2], shR: [2, 0, 2], chest: [1, 0, 0], head: [2, 0, 0] }], [1, { shL: [0, 0, 0], shR: [0, 0, 0], chest: [0, 0, 0], head: [0, 0, 0] }]] },
  neck: { dur: 2.0, frames: [[0, { head: [0, 0, 0], chest: [0, 0, 0] }], [0.3, { head: [-6, 0, 16] }, 1], [0.55, { head: [8, 0, 0] }], [0.8, { head: [-4, 0, -16] }, 1], [1, { head: [0, 0, 0], chest: [0, 0, 0] }]] },
  shift: { dur: 2.4, frames: [[0, { pos: [0, 0, 0], hips: [0, 0, 0], torso: [0, 0, 0] }], [0.4, { pos: [-0.045, -0.004, 0], hips: [0, 4, -4], torso: [0, -4, 3] }, 1], [0.75, { pos: [-0.036, -0.003, 0], hips: [0, 3, -3], torso: [0, -3, 2] }], [1, { pos: [0, 0, 0], hips: [0, 0, 0], torso: [0, 0, 0] }]] },
  scratch: { dur: 2.2, frames: [[0, { shL: [0, 0, 0], elL: [0], head: [0, 0, 0] }], [0.3, { shL: [-120, -10, 20], elL: [-110], head: [10, 0, -8] }, 1], [0.45, { shL: [-124, -8, 22], elL: [-118], head: [12, 0, -10] }], [0.6, { shL: [-118, -10, 20], elL: [-108] }], [0.75, { shL: [-122, -8, 22], elL: [-116] }], [1, { shL: [0, 0, 0], elL: [0], head: [0, 0, 0] }]] },
  look: { dur: 2.6, frames: [[0, { head: [0, 0, 0], chest: [0, 0, 0] }], [0.25, { head: [-4, 40, 0], chest: [0, 8, 0] }, 1], [0.5, { head: [-2, 36, 0], chest: [0, 7, 0] }], [0.7, { head: [0, -30, 0], chest: [0, -6, 0] }, 1], [1, { head: [0, 0, 0], chest: [0, 0, 0] }]] },
  bounce: { dur: 1.0, frames: [[0, { pos: [0, 0, 0], shL: [0, 0, 0], shR: [0, 0, 0] }], [0.25, { pos: [0, 0.03, 0], shL: [-4, 0, 0], shR: [-4, 0, 0] }], [0.5, { pos: [0, -0.02, 0] }], [0.75, { pos: [0, 0.03, 0], shL: [-3, 0, 0], shR: [-3, 0, 0] }], [1, { pos: [0, 0, 0], shL: [0, 0, 0], shR: [0, 0, 0] }]] },
  taunt: { dur: 1.6, frames: [[0, { shL: [0, 0, 0], elL: [0], wrL: [0, 0, 0], head: [0, 0, 0], chest: [0, 0, 0] }], [0.2, { shL: [-30, 20, 0], elL: [40], head: [-6, 0, 0], chest: [-4, 0, 0] }, 1], [0.38, { elL: [10], wrL: [-40, 0, 0] }], [0.52, { elL: [44], wrL: [10, 0, 0] }], [0.66, { elL: [10], wrL: [-40, 0, 0] }], [0.8, { elL: [40], wrL: [0, 0, 0] }], [1, { shL: [0, 0, 0], elL: [0], wrL: [0, 0, 0], head: [0, 0, 0], chest: [0, 0, 0] }]] },
  dreddCheck: { dur: 2.2, frames: [[0, { shR: [0, 0, 0], elR: [0], wrR: [0, 0, 0], head: [0, 0, 0] }], [0.3, { shR: [-10, 14, 0], elR: [-22], wrR: [-14, -30, 0], head: [16, -24, 0] }, 1], [0.6, { shR: [-10, 14, 0], elR: [-20], wrR: [-12, -26, 0], head: [14, -22, 0] }], [1, { shR: [0, 0, 0], elR: [0], wrR: [0, 0, 0], head: [0, 0, 0] }]] },
  dreddRoll: { dur: 1.8, frames: [[0, { chest: [0, 0, 0], shL: [0, 0, 0], shR: [0, 0, 0], head: [0, 0, 0] }], [0.3, { chest: [-4, 0, 3], shL: [0, 0, 6], head: [0, 0, -8] }, 1], [0.6, { chest: [-4, 0, -3], shR: [0, 0, -6], head: [0, 0, 8] }, 1], [1, { chest: [0, 0, 0], shL: [0, 0, 0], shR: [0, 0, 0], head: [0, 0, 0] }]] },
};

const DEFAULTS = { out: 0.22, blend: 0.1, look: 1 };
export const CLIPS = {};
for (const [name, def] of Object.entries(DEFS)) CLIPS[name] = compileClip(name, { ...DEFAULTS, ...def });
const F = {}; for (const [name, def] of Object.entries(FDEFS)) F[name] = compileClip('fidget.' + name, { hit: 2, side: 'R', additive: true, ...def });
export const FIDGETS = {
  relaxed: [F.shrug, F.neck, F.shift, F.scratch, F.look, F.shift],
  ready: [F.bounce, F.taunt, F.bounce, F.neck],
  dredd: [F.dreddCheck, F.dreddRoll, F.shift],
};

export function pickClip(name, dir, ch) {
  const c = CLIPS[name];
  if (!c) return null;
  if (c.select) { const v = c.select(dir, ch); if (v && CLIPS[v]) return CLIPS[v]; }
  return c;
}
