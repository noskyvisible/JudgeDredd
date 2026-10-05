// Animation checks, run inside the game page (same harness as tools/studio.mjs):
//   * foot slide: characters locomote at constant speed with the root really moving (set after update(), like the game);
//     the world position of the planted contact point (heel while heel-rocking / flat, ball while flat / toe-rocking)
//     must not drift during stance
//   * sole contact of planted feet and standing stances, measured on the model's real boot vertices (no sinking / floating)
//   * no knee / elbow hyperextension, sane ankles, no NaN — across every clip (and directional variant) at several speeds,
//     with impulses and look-at targets thrown in
//   * lying poses end on the floor (core points not under it)
//   * average Character.update() cost over 1000 calls for 20 mixed characters
//
//   node tools/anim-check.mjs [--url http://localhost:8000/] [--quick]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const url = opt('url', args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:8000/');
const quick = args.includes('--quick');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.split('\n')[0]));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 200)); });
await page.addInitScript(() => { window.__noRender = true; });
await page.goto(url);
await page.waitForFunction(() => window.__test, null, { timeout: 180000 });

const res = await page.evaluate(({ quick }) => {
  const T = window.__test, THREE = T.THREE;
  const out = { slide: [], worstSlide: 0, sink: 0, problems: [], perf: null, ground: [] };
  const mk = (style) => {
    const ch = new T.Character(style);
    if (style === 'dredd') { ch.gunMount.add(T.makeLawgiver()); ch.batonMount.add(T.makeBaton(0.85)); }
    else if (style === 'gunman') ch.gunMount.add(T.makePistol());
    else if (style === 'thug' || style === 'brute' || style === 'boss') ch.toolR.add(T.makeBat(0x6a4a2a, 0.9));
    return ch;
  };
  const v3 = new THREE.Vector3();
  const dt = 1 / 60;
  // real sole contact: lowest boot vertex (world y) of an ankle, from the model's actual geometry (not the IK's foot model)
  const bootVerts = (ch, an) => {
    if (an._bv) return an._bv;
    ch.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(an.matrixWorld).invert(), rel = new THREE.Matrix4(), pts = [];
    an.traverse((o) => { if (!o.isMesh || !o.geometry) return; rel.multiplyMatrices(inv, o.matrixWorld); const pa = o.geometry.attributes.position;
      for (let i = 0; i < pa.count; i += 2) pts.push(new THREE.Vector3().fromBufferAttribute(pa, i).applyMatrix4(rel)); });
    return (an._bv = pts);
  };
  const soleY = (ch, an) => { const pts = bootVerts(ch, an), M = an.matrixWorld; let m = 1e9; for (const q of pts) { const y = M.elements[1] * q.x + M.elements[5] * q.y + M.elements[9] * q.z + M.elements[13]; if (y < m) m = y; } return m; };

  // ---------------------------------------------------------------- foot slide
  const styles = quick ? ['dredd', 'thug'] : ['dredd', 'thug', 'civ', 'brute', 'junkie', 'boss', 'gunman'];
  const speeds = quick ? [1.6, 4.5, 6.3, 11] : [1.2, 1.6, 2.5, 3.8, 4.8, 6.3, 8, 11];
  const dirs = quick ? [[0, 1]] : [[0, 1], [1, 0], [-0.6, -0.8]];
  for (const style of styles) for (const v of speeds) for (const d of dirs) {
    const ch = mk(style), g = ch.gait, geo = ch.geo;
    if (d[1] < 0.5 && v > 5) continue;   // nobody strafes / backpedals at a sprint
    const pos = new THREE.Vector3(), yaw = 0.3;
    const vx = (d[0] * Math.cos(yaw) + d[1] * Math.sin(yaw)) * v, vz = (-d[0] * Math.sin(yaw) + d[1] * Math.cos(yaw)) * v;
    ch.root.rotation.y = yaw;
    const st = [{}, {}];
    let maxD = 0, sum = 0, n = 0, sink = 0, flt = -1;
    for (let f = 0; f < 60 * 6; f++) {
      ch.speed = v; ch.update(dt);
      pos.x += vx * dt; pos.z += vz * dt; ch.root.position.copy(pos);
      if (f < 120) continue;
      ch.root.updateMatrixWorld(true);
      for (let i = 0; i < 2; i++) {
        const ft = g.feet[i], an = i ? ch.anR : ch.anL, s = st[i];
        if (!ft.planted) { if (s.on) { if (s.d > 0) { maxD = Math.max(maxD, s.d); sum += s.d; n++; } } s.on = false; continue; }
        if (!s.on) { s.on = true; s.d = 0; s.heel = null; s.ball = null; s.skip = 2; }
        if (s.skip-- > 0) continue;
        const heel = an.localToWorld(v3.set(0, -geo.footH, -geo.heel)).clone();
        const ball = an.localToWorld(v3.set(0, -geo.footH, geo.ball)).clone();
        if (f % 2 === 0) { const sy = soleY(ch, an); sink = Math.min(sink, sy); flt = Math.max(flt, sy); }
        if (ft.pitch <= 0.02) { if (!s.heel) s.heel = heel; else s.d = Math.max(s.d, Math.hypot(heel.x - s.heel.x, heel.z - s.heel.z)); } else s.heel = null;
        if (ft.pitch >= -0.02) { if (!s.ball) s.ball = ball; else s.d = Math.max(s.d, Math.hypot(ball.x - s.ball.x, ball.z - s.ball.z)); } else s.ball = null;
      }
    }
    const r = { style, v, dir: d.join(','), maxCm: +(maxD * 100).toFixed(2), meanCm: n ? +(sum / n * 100).toFixed(2) : 0, stances: n, sinkCm: +(sink * 100).toFixed(1), floatCm: +(flt * 100).toFixed(1), period: +ch.cyclePeriod().toFixed(3) };
    out.slide.push(r); out.worstSlide = Math.max(out.worstSlide, r.maxCm); out.sink = Math.min(out.sink, r.sinkCm); out.float = Math.max(out.float ?? -1, r.floatCm);
  }

  // ---------------------------------------------------------------- standing sole contact (idle / combat guard / aim)
  out.soles = [];
  for (const style of quick ? ['dredd', 'thug'] : ['dredd', 'thug', 'gunman', 'brute', 'junkie', 'boss', 'civ', 'biker']) {
    const ch = mk(style), row = { style };
    for (const [tag, setup] of [['idle', () => {}], ['ready', () => { ch.stance = 'ready'; }], ['aim', () => { ch.stance = null; ch.aim = 1; }]]) {
      setup(); let lo = 1e9, hi = -1e9;
      for (let f = 0; f < 240; f++) { ch.update(dt); if (f > 120 && f % 10 === 0) { ch.root.updateMatrixWorld(true); for (const an of [ch.anL, ch.anR]) { const y = soleY(ch, an); lo = Math.min(lo, y); hi = Math.max(hi, y); } } }
      row[tag] = [+(lo * 100).toFixed(2), +(hi * 100).toFixed(2)];
    }
    out.soles.push(row);
  }

  // ---------------------------------------------------------------- clips: limits + NaN
  const names = Object.keys(T.CLIPS);
  const dirsV = [null, [0, 0, -1], [0, 0, 1], [1, 0, 0], [-1, 0, 0]];
  const check = (ch, tag) => {
    const J = [ch.hips, ch.torso, ch.chest, ch.neck, ch.head, ch.shL, ch.shR, ch.elL, ch.elR, ch.wrL, ch.wrR, ch.hipL, ch.hipR, ch.knL, ch.knR, ch.anL, ch.anR, ch.rigRoot, ch.pivot];
    for (const j of J) { const r = j.rotation, p = j.position; if (!Number.isFinite(r.x + r.y + r.z + p.x + p.y + p.z)) { out.problems.push(tag + ' NaN'); return false; } }
    if (ch.knL.rotation.x < -1e-6 || ch.knR.rotation.x < -1e-6) { out.problems.push(tag + ' knee hyperextension'); return false; }
    if (ch.elL.rotation.x > 1e-6 || ch.elR.rotation.x > 1e-6) { out.problems.push(tag + ' elbow hyperextension'); return false; }
    for (const a of [ch.anL, ch.anR]) if (a.rotation.x < -0.85 || a.rotation.x > 1.35 || Math.abs(a.rotation.y) > 0.55 || Math.abs(a.rotation.z) > 0.55) { out.problems.push(tag + ` ankle ${a.rotation.x.toFixed(2)},${a.rotation.y.toFixed(2)},${a.rotation.z.toFixed(2)}`); return false; }
    return true;
  };
  let clipRuns = 0;
  for (const style of quick ? ['dredd', 'thug'] : ['dredd', 'thug', 'gunman', 'civ', 'brute']) {
    for (const name of names) for (const dir of (quick ? [null, [0, 0, 1]] : dirsV)) for (const sp of [0, 3, 7]) {
      const ch = mk(style); ch.root.rotation.y = 1; let px = 0;
      ch.lookAt(new THREE.Vector3(3, 1.5, 2));
      for (let f = 0; f < 30; f++) { ch.speed = sp; ch.update(dt); px += sp * dt; ch.root.position.x = px; }
      ch.play(name, { speed: 1.2, dir: dir ? new THREE.Vector3(...dir) : null }); clipRuns++;
      const dur = T.CLIPS[name].dur / 1.2;
      let ok = true;
      for (let t = 0; t < dur + 0.7 && ok; t += dt) {
        if (Math.random() < 0.03) ch.impulse([Math.random() - 0.5, 0, Math.random() - 0.5], Math.random() * 2);
        ch.aim = name === 'shoot' ? 1 : 0; ch.speed = sp * 0.5; ch.update(dt); px += sp * 0.5 * dt; ch.root.position.x = px;
        ok = check(ch, `${style}/${name}/${dir ? dir.join('') : '-'}/${sp}`);
      }
      if (out.problems.length > 30) break;
    }
  }
  out.clipRuns = clipRuns;
  // lying poses: core points above the floor
  for (const style of ['dredd', 'thug', 'brute']) for (const name of ['die', 'subdued', 'knockdown']) for (const dir of [null, [0, 0, -1], [0, 0, 1], [1, 0, 0], [-1, 0, 0]]) {
    if (!T.CLIPS[name]) continue;
    const ch = mk(style);
    for (let f = 0; f < 20; f++) ch.update(dt);
    ch.play(name, { dir: dir ? new THREE.Vector3(...dir) : null });
    for (let f = 0; f < 150; f++) ch.update(dt);
    ch.root.updateMatrixWorld(true);
    const S = ch.style.scale, pts = { hips: ch.hips, chest: ch.chest, neck: ch.neck, head: ch.head, handL: ch.handL, handR: ch.handR, knL: ch.knL, knR: ch.knR, anL: ch.anL, anR: ch.anR };
    const h = {};
    for (const [k, o] of Object.entries(pts)) h[k] = +(o.getWorldPosition(v3).y / S).toFixed(2);
    out.ground.push({ style, name, dir: dir ? dir.join('') : '-', ground: ch.ground, h });
  }

  // ---------------------------------------------------------------- performance
  const list = [];
  const sty = ['dredd', 'thug', 'gunman', 'brute', 'junkie', 'civ', 'boss', 'biker'];
  for (let i = 0; i < 20; i++) { const ch = mk(sty[i % sty.length]); ch.root.position.set(i * 3, 0, 0); list.push({ ch, sp: [0, 1.6, 4.5, 6.3, 0, 2][i % 6], x: i * 3 }); }
  const tgt = new THREE.Vector3(5, 1.6, 5);
  const loop = (n, measure) => {
    let t0 = performance.now();
    for (let f = 0; f < n; f++) {
      for (let i = 0; i < list.length; i++) {
        const L = list[i], ch = L.ch;
        if (f % 97 === i) ch.play(['punch', 'hurt', 'shoot', 'swing', 'slashR', 'telegraph'][i % 6], { speed: 1.2, dir: [0, 0, -1] });
        if (f % 151 === i) ch.impulse([0.3, 0, -1], 1);
        ch.aim = i % 5 === 0 ? 1 : 0; ch.stance = i % 3 === 0 ? 'ready' : null;
        if (i % 2) ch.lookAt(tgt); else ch.lookAt(null);
        ch.speed = L.sp; ch.update(dt);
        L.x += L.sp * dt; ch.root.position.x = L.x; ch.root.rotation.y = Math.sin(f * 0.01 + i) * 0.8;
      }
    }
    return (performance.now() - t0) / (n * list.length);
  };
  loop(200);
  out.perf = { msPerUpdate: +loop(1000).toFixed(4), chars: list.length, calls: 1000 * list.length };
  out.nanCount = list.reduce((a, L) => a + (L.ch._nan || 0), 0);
  return out;
}, { quick });

const bad = res.slide.filter((r) => r.maxCm >= 3);
console.log('FOOT SLIDE (max cm per stance; contact point drift in world space)');
for (const r of res.slide) console.log(`  ${r.style.padEnd(7)} v=${String(r.v).padEnd(4)} dir=${r.dir.padEnd(8)} max ${String(r.maxCm).padStart(5)}  mean ${String(r.meanCm).padStart(5)}  stances ${String(r.stances).padStart(2)}  sole ${String(r.sinkCm).padStart(5)}..${String(r.floatCm).padStart(4)}  period ${r.period}`);
console.log(`worst slide ${res.worstSlide} cm, ${bad.length} runs >= 3 cm; planted soles (real boot geometry) between ${res.sink} and ${res.float} cm`);
console.log('STANDING SOLES (lowest boot vertex, cm: min..max over both feet)');
for (const r of res.soles) console.log(`  ${r.style.padEnd(7)} idle ${r.idle.join('..').padEnd(12)} ready ${r.ready.join('..').padEnd(12)} aim ${r.aim.join('..')}`);
console.log(`clip runs ${res.clipRuns}, problems: ${res.problems.length}`);
for (const p of res.problems.slice(0, 30)) console.log('  ' + p);
console.log('LYING POSES (heights in rig units)');
for (const g of res.ground) console.log(`  ${g.style.padEnd(6)} ${g.name.padEnd(9)} dir ${g.dir.padEnd(4)} ground=${g.ground} ` + Object.entries(g.h).map(([k, v]) => `${k}:${v}`).join(' '));
console.log(`PERF: ${(res.perf.msPerUpdate * 1000).toFixed(1)} us per Character.update (avg over ${res.perf.calls} calls, ${res.perf.chars} characters); NaN repairs: ${res.nanCount}`);
console.log(errs.length ? 'ERRORS:\n' + errs.slice(0, 10).join('\n') : 'no page errors');
await browser.close();
