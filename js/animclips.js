// ---------------------------------------------------------------------------
// Keyframed clips (temporary port of the legacy data; re-authored below in later passes).
// ---------------------------------------------------------------------------
import { compileClip, mirrorDef } from './animcore.js';

const DEFS = {
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

const DEFAULTS = { out: 0.22, blend: 0.12, look: 1 };
export const CLIPS = {};
for (const [name, def] of Object.entries(DEFS)) CLIPS[name] = compileClip(name, { ...DEFAULTS, ...def });

export const FIDGETS = { relaxed: [], ready: [], dredd: [] };

// directional / state variants
export function pickClip(name, dir, ch) {
  const c = CLIPS[name];
  if (!c) return null;
  if (c.select) { const v = c.select(dir, ch); if (v && CLIPS[v]) return CLIPS[v]; }
  return c;
}
export { mirrorDef };
