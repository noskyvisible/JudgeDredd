import * as THREE from 'three';
import { G } from './state.js';
import { clamp, rand } from './util.js';

// Fully procedural audio: SFX, ambience, engine, siren and a dynamic synth soundtrack.
let ctx, master, sfxBus, musicBus, reverb, reverbSend, noiseBuf, comp;
let engine, siren, rainNode;
let musicOn = true, intensity = 0, nextStep = 0, step = 0, started = false;
const tmpV = new THREE.Vector3();
const right = new THREE.Vector3();

function makeNoise() {
  const len = ctx.sampleRate * 2;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
}
function makeReverb() {
  const len = ctx.sampleRate * 2.2;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  reverb = ctx.createConvolver(); reverb.buffer = buf;
  reverbSend = ctx.createGain(); reverbSend.gain.value = 0.22;
  reverbSend.connect(reverb); reverb.connect(master);
}

function spatial(pos) {
  if (!pos || !G.camera) return { g: 1, p: 0 };
  const cam = G.camera;
  tmpV.copy(pos).sub(cam.position);
  const d = tmpV.length();
  const g = clamp(1 / (1 + d * d / 900), 0, 1);
  right.set(1, 0, 0).applyQuaternion(cam.quaternion);
  const p = clamp(tmpV.normalize().dot(right) * 0.8, -1, 1);
  return { g, p };
}

function out(pos, gain) {
  const s = spatial(pos);
  const g = ctx.createGain(); g.gain.value = gain * s.g;
  const pan = ctx.createStereoPanner(); pan.pan.value = s.p;
  g.connect(pan); pan.connect(sfxBus); pan.connect(reverbSend);
  return g;
}

function noise(dest, t, dur, { type = 'lowpass', f0 = 2000, f1 = 200, q = 0.7, gain = 1, att = 0.002 } = {}) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + att);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(dest);
  src.start(t, Math.random()); src.stop(t + dur + 0.05);
}
function tone(dest, t, dur, { type = 'sine', f0 = 200, f1 = 50, gain = 1, att = 0.002 } = {}) {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + att);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + dur + 0.05);
}

export const audio = {
  get ready() { return !!ctx; },
  init() {
    if (ctx) { ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.8;
    comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    master.connect(comp); comp.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.32; musicBus.connect(master);
    makeNoise(); makeReverb();
    this.startAmbience();
    this.startEngine();
    this.startSiren();
    nextStep = ctx.currentTime + 0.1;
    started = true;
  },
  setMusic(on) { musicOn = on; if (musicBus) musicBus.gain.setTargetAtTime(on ? 0.32 : 0, ctx.currentTime, 0.2); },
  toggleMusic() { this.setMusic(!musicOn); return musicOn; },
  setIntensity(v) { intensity = v; },
  suspend() { ctx?.suspend(); }, resume() { ctx?.resume(); },

  startAmbience() {
    // rain = bandpassed noise, city = low rumble
    const mk = (f, q, g, type = 'bandpass') => {
      const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const gn = ctx.createGain(); gn.gain.value = g;
      s.connect(fl); fl.connect(gn); gn.connect(master); s.start();
      return gn;
    };
    rainNode = mk(5200, 0.6, 0.06);
    mk(240, 0.5, 0.12, 'lowpass');
    const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 43;
    const hg = ctx.createGain(); hg.gain.value = 0.015;
    const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 160;
    hum.connect(hf); hf.connect(hg); hg.connect(master); hum.start();
  },

  startEngine() {
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square';
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400; f.Q.value = 3;
    const g = ctx.createGain(); g.gain.value = 0;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(master);
    o1.start(); o2.start();
    engine = { o1, o2, f, g };
  },
  setEngine(active, speed01, boost) {
    if (!engine) return;
    const t = ctx.currentTime;
    const base = 38 + speed01 * 120 + (boost ? 40 : 0);
    engine.o1.frequency.setTargetAtTime(base, t, 0.08);
    engine.o2.frequency.setTargetAtTime(base * 0.503, t, 0.08);
    engine.f.frequency.setTargetAtTime(260 + speed01 * 1400 + (boost ? 800 : 0), t, 0.1);
    engine.g.gain.setTargetAtTime(active ? 0.06 + speed01 * 0.07 : 0, t, 0.15);
  },

  startSiren() {
    const o = ctx.createOscillator(); o.type = 'triangle';
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.7;
    const lg = ctx.createGain(); lg.gain.value = 260;
    const g = ctx.createGain(); g.gain.value = 0;
    o.frequency.value = 780;
    lfo.connect(lg); lg.connect(o.frequency);
    o.connect(g); g.connect(master); g.connect(reverbSend);
    o.start(); lfo.start();
    siren = { g };
  },
  setSiren(on) { if (siren) siren.g.gain.setTargetAtTime(on ? 0.035 : 0, ctx.currentTime, 0.1); },

  // ---------- SFX ----------
  shot(type, pos) {
    if (!ctx) return; const t = ctx.currentTime; const o = out(pos, 0.9);
    switch (type) {
      case 0: // standard
        noise(o, t, 0.16, { f0: 6000, f1: 400, gain: 0.9 });
        tone(o, t, 0.12, { type: 'square', f0: 260, f1: 60, gain: 0.5 });
        break;
      case 1: // AP: crack + sub
        noise(o, t, 0.28, { type: 'highpass', f0: 3000, f1: 800, gain: 1 });
        tone(o, t, 0.3, { type: 'sawtooth', f0: 180, f1: 35, gain: 0.8 });
        tone(o, t, 0.06, { type: 'sine', f0: 2400, f1: 900, gain: 0.4 });
        break;
      case 2: // ricochet
        noise(o, t, 0.14, { f0: 5000, f1: 700, gain: 0.7 });
        tone(o, t, 0.2, { type: 'triangle', f0: 1400, f1: 500, gain: 0.35 });
        break;
      case 3: // hi-ex launcher thump
        noise(o, t, 0.3, { f0: 1500, f1: 120, gain: 1 });
        tone(o, t, 0.35, { type: 'sine', f0: 140, f1: 30, gain: 1 });
        break;
      case 4: // incendiary whoosh
        noise(o, t, 0.4, { type: 'bandpass', f0: 800, f1: 3000, q: 1.5, gain: 0.8, att: 0.05 });
        tone(o, t, 0.2, { type: 'square', f0: 200, f1: 70, gain: 0.4 });
        break;
      case 5: // heat seeker
        noise(o, t, 0.5, { type: 'bandpass', f0: 500, f1: 4000, q: 2, gain: 0.7, att: 0.08 });
        tone(o, t, 0.5, { type: 'sawtooth', f0: 300, f1: 900, gain: 0.25, att: 0.05 });
        break;
    }
  },
  enemyShot(pos) {
    if (!ctx) return; const t = ctx.currentTime; const o = out(pos, 0.6);
    noise(o, t, 0.14, { f0: 3500, f1: 300, gain: 0.8 });
    tone(o, t, 0.1, { type: 'square', f0: 180, f1: 50, gain: 0.4 });
  },
  baton(heavy, pos) {
    if (!ctx) return; const t = ctx.currentTime; const o = out(pos, 0.9);
    noise(o, t, 0.1, { type: 'highpass', f0: 2500, f1: 1000, gain: 0.8 });
    tone(o, t, 0.12, { type: 'sine', f0: heavy ? 110 : 160, f1: 50, gain: 0.9 });
    // electric zap
    tone(o, t, 0.18, { type: 'sawtooth', f0: 1800 + rand(600), f1: 300, gain: 0.18 });
  },
  whoosh(pos) {
    if (!ctx) return; const t = ctx.currentTime; const o = out(pos, 0.5);
    noise(o, t, 0.2, { type: 'bandpass', f0: 600, f1: 2500, q: 0.8, gain: 0.5, att: 0.06 });
  },
  hit(pos) { if (!ctx) return; const t = ctx.currentTime; const o = out(pos, 0.7);
    noise(o, t, 0.08, { f0: 1500, f1: 200, gain: 0.7 }); tone(o, t, 0.1, { f0: 120, f1: 45, gain: 0.7 }); },
  hurt() { if (!ctx) return; const t = ctx.currentTime; const o = out(null, 0.8);
    tone(o, t, 0.22, { type: 'sawtooth', f0: 150, f1: 60, gain: 0.5 }); noise(o, t, 0.15, { f0: 900, f1: 150, gain: 0.5 }); },
  counter(pos) { if (!ctx) return; const t = ctx.currentTime; const o = out(pos, 1);
    tone(o, t, 0.25, { type: 'sine', f0: 900, f1: 1800, gain: 0.35 }); noise(o, t + 0.04, 0.15, { f0: 4000, f1: 300, gain: 0.9 });
    tone(o, t + 0.04, 0.3, { f0: 90, f1: 30, gain: 1 }); },
  explosion(size = 1, pos) {
    if (!ctx) return; const t = ctx.currentTime; const o = out(pos, 1.3 * Math.min(1, 0.6 + size * 0.4));
    noise(o, t, 0.9 * size + 0.3, { f0: 2500, f1: 60, gain: 1.3 });
    tone(o, t, 0.8 * size + 0.2, { f0: 100, f1: 22, gain: 1.4 });
    noise(o, t + 0.15, 1.2 * size + 0.3, { type: 'lowpass', f0: 600, f1: 40, gain: 0.8 });
  },
  ping(pos) { if (!ctx) return; const t = ctx.currentTime; const o = out(pos, 0.5);
    tone(o, t, 0.25, { type: 'triangle', f0: 2200 + rand(800), f1: 1200, gain: 0.35 }); },
  step(pos, heavy = 1) { if (!ctx) return; const t = ctx.currentTime; const o = out(pos, 0.22 * heavy);
    noise(o, t, 0.08, { f0: 700, f1: 120, gain: 0.8 }); },
  splash(pos) { if (!ctx) return; const t = ctx.currentTime; const o = out(pos, 0.15);
    noise(o, t, 0.12, { type: 'bandpass', f0: 2500, f1: 1200, q: 0.8, gain: 0.7 }); },
  thunder() {
    if (!ctx) return; const t = ctx.currentTime + rand(0.2, 1.2); const o = out(null, 1.2);
    noise(o, t, 3.5, { type: 'lowpass', f0: 500, f1: 40, gain: 1.2, att: 0.4 });
    tone(o, t, 3, { f0: 60, f1: 25, gain: 0.8, att: 0.3 });
  },
  skid() { if (!ctx) return; const t = ctx.currentTime; const o = out(null, 0.25);
    noise(o, t, 0.35, { type: 'bandpass', f0: 1800, f1: 1400, q: 5, gain: 0.5, att: 0.05 }); },
  crash(pos, s = 1) { if (!ctx) return; const t = ctx.currentTime; const o = out(pos, 0.7 * s);
    noise(o, t, 0.35, { f0: 2000, f1: 100, gain: 1 }); tone(o, t, 0.3, { type: 'square', f0: 90, f1: 30, gain: 0.7 }); },
  ui(kind = 'beep') {
    if (!ctx) return; const t = ctx.currentTime; const o = out(null, 0.5);
    switch (kind) {
      case 'beep': tone(o, t, 0.08, { type: 'square', f0: 880, f1: 880, gain: 0.25 }); break;
      case 'select': tone(o, t, 0.06, { type: 'square', f0: 1200, f1: 1500, gain: 0.2 }); break;
      case 'confirm': tone(o, t, 0.1, { type: 'square', f0: 600, f1: 600, gain: 0.25 }); tone(o, t + 0.1, 0.18, { type: 'square', f0: 900, f1: 900, gain: 0.25 }); break;
      case 'error': tone(o, t, 0.25, { type: 'sawtooth', f0: 160, f1: 100, gain: 0.35 }); break;
      case 'dispatch':
        for (let i = 0; i < 3; i++) tone(o, t + i * 0.13, 0.1, { type: 'square', f0: 1000 + (i % 2) * 400, f1: 1000 + (i % 2) * 400, gain: 0.22 });
        noise(o, t + 0.45, 0.15, { type: 'highpass', f0: 3000, f1: 3000, gain: 0.25 });
        break;
      case 'gavel':
        noise(o, t, 0.1, { f0: 2500, f1: 300, gain: 1 }); tone(o, t, 0.2, { f0: 200, f1: 60, gain: 1 });
        noise(o, t + 0.28, 0.1, { f0: 2500, f1: 300, gain: 1 }); tone(o, t + 0.28, 0.25, { f0: 160, f1: 50, gain: 1 });
        break;
      case 'pickup': tone(o, t, 0.08, { type: 'triangle', f0: 700, f1: 1400, gain: 0.3 }); tone(o, t + 0.08, 0.14, { type: 'triangle', f0: 1400, f1: 2100, gain: 0.3 }); break;
      case 'switch': tone(o, t, 0.05, { type: 'square', f0: 300, f1: 600, gain: 0.2 }); noise(o, t, 0.05, { type: 'highpass', f0: 4000, f1: 2000, gain: 0.3 }); break;
      case 'rank': for (let i = 0; i < 4; i++) tone(o, t + i * 0.1, 0.25, { type: 'triangle', f0: 440 * Math.pow(1.26, i), f1: 440 * Math.pow(1.26, i), gain: 0.25 }); break;
      case 'tick': tone(o, t, 0.04, { type: 'square', f0: 1800, f1: 1800, gain: 0.18 }); break;
    }
  },
  voice(text, { pitch = 0.1, rate = 0.78 } = {}) {
    if (!G.voiceOn || !window.speechSynthesis) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = pitch; u.rate = rate; u.volume = 0.9;
      const v = speechSynthesis.getVoices().find((x) => /en-(US|GB)/i.test(x.lang) && /male|david|daniel|alex|google uk english male/i.test(x.name)) ||
        speechSynthesis.getVoices().find((x) => /^en/i.test(x.lang));
      if (v) u.voice = v;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch (e) { /* no speech available */ }
  },

  // ---------- music ----------
  update(dt) {
    if (!started) return;
    // smooth the intensity changes and run the sequencer with a short look-ahead
    const bpm = 96 + intensity * 28;
    const stepDur = 60 / bpm / 4;
    while (nextStep < ctx.currentTime + 0.15) {
      this.playStep(step, nextStep, stepDur);
      nextStep += stepDur; step = (step + 1) % 64;
    }
    rainNode?.gain.setTargetAtTime(G.mode === 'bike' ? 0.03 : 0.06, ctx.currentTime, 0.4);
  },
  playStep(s, t, d) {
    if (!musicOn) return;
    const I = intensity;
    const bar = Math.floor(s / 16) % 4;
    const roots = [38.9, 38.9, 43.65, 32.7]; // Eb1, Eb1, F1, C1 -> dark minor-ish
    const root = roots[bar];
    const st = s % 16;
    // kick
    if (st % 4 === 0 && (I > 0.05 || st === 0)) tone(musicBus, t, 0.2, { f0: 140, f1: 40, gain: 0.9 });
    // snare
    if (st === 4 || st === 12) { noise(musicBus, t, 0.18, { type: 'bandpass', f0: 2200, f1: 1200, q: 0.8, gain: 0.5 }); tone(musicBus, t, 0.1, { f0: 220, f1: 120, gain: 0.3 }); }
    // hats
    if (I > 0.25 && st % 2 === 0) noise(musicBus, t, 0.04, { type: 'highpass', f0: 8000, f1: 8000, gain: 0.18 + (st % 4 === 2 ? 0.08 : 0) });
    if (I > 0.6 && st % 2 === 1) noise(musicBus, t, 0.03, { type: 'highpass', f0: 9000, f1: 9000, gain: 0.1 });
    // bass: pulsing 8ths
    if (st % 2 === 0 || (I > 0.5 && st % 4 === 3)) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = 6;
      fl.frequency.setValueAtTime(200 + I * 1600, t); fl.frequency.exponentialRampToValueAtTime(90, t + d * 1.8);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d * 1.9);
      const oct = (st % 8 === 6) ? 2 : 1;
      o.frequency.value = root * oct * (st === 10 ? 1.5 : 1);
      o.connect(fl); fl.connect(g); g.connect(musicBus); o.start(t); o.stop(t + d * 2);
    }
    // pad on bar start
    if (st === 0) {
      [1, 1.189, 1.498, 2.0].forEach((m, i) => {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = root * 4 * m; o.detune.value = (i - 1.5) * 7;
        const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 500 + I * 900;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.06 + I * 0.03, t + d * 5);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d * 16);
        o.connect(fl); fl.connect(g); g.connect(musicBus); o.start(t); o.stop(t + d * 16 + 0.1);
      });
    }
    // lead stab when intense
    if (I > 0.55 && (st === 3 || st === 7 || st === 14)) {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = root * 8 * (st === 14 ? 1.189 : 1);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.09, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d * 2.5);
      const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 2200;
      o.connect(fl); fl.connect(g); g.connect(musicBus); o.start(t); o.stop(t + d * 3);
    }
  },
};
