// Riding soak: mounts the Lawmaster and rides hard for N frames (random throttle / boost / brake / drift / steer / siren,
// autopilot bursts, dismount + remount), with a hotdogger chase (PerpBike) and traffic around.  Reports exceptions,
// NaN transforms on the bike / rider / perp bikes / traffic, and the vehicle visual state.
//   node tools/ridesoak.mjs [url] [frames]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }
const URL_ = process.argv[2] || 'http://localhost:8000/';
const FRAMES = +(process.argv[3] || 6000);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 320, height: 180 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.stack.split('\n').slice(0, 4).join(' | ')));
p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
await p.addInitScript(() => { window.__noRender = true; });
await p.goto(URL_);
await p.waitForFunction(() => window.__test, null, { timeout: 120000 });
const res = await p.evaluate((FRAMES) => {
  const T = window.__test, G = window.__G, I = T.input, out = { errors: [], nan: [], samples: [] };
  T.startGame(); T.player.hp = T.player.maxHp = 1e9;
  G.crimes.dispatch('hotdog'); G.crimes.dispatch('hotdog');
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const keys = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ShiftLeft', 'Space'];
  const bad = (o) => { if (!o) return false; const e = o.matrixWorld.elements; for (let i = 0; i < 16; i++) if (!isFinite(e[i])) return true; return false; };
  const mount = () => { const bk = T.bike; T.player.pos.set(bk.pos.x - 1.5, 0, bk.pos.z); G.mount(); };
  const sc = G.crimes.scenes.find((s) => s.key === 'hotdog' || s.def?.chase);
  if (sc) T.bike.place(sc.pos.x + 30, sc.pos.z + 6, 0);
  mount();
  for (let f = 0; f < FRAMES; f++) {
    if (f % 600 === 300 && sc && !(G.perpBikes || []).length) { T.bike.place(sc.pos.x + 25, sc.pos.z + 5, 0); T.player.pos.copy(T.bike.pos); }
    try {
      if (f % 30 === 0) { for (const k of keys) I.setKey(k, false); I.setKey('KeyW', rnd() < 0.75); I.setKey('KeyS', rnd() < 0.12); I.setKey(rnd() < 0.5 ? 'KeyA' : 'KeyD', rnd() < 0.5); I.setKey('ShiftLeft', rnd() < 0.3); I.setKey('Space', rnd() < 0.1); }
      if (f % 400 === 0) I.setKey('KeyH', true); else I.setKey('KeyH', false);
      if (f % 900 === 450) I.setKey('KeyG', true); else if (f % 900 === 451) I.setKey('KeyG', false);
      if (f % 1500 === 1499) { for (const k of keys) I.setKey(k, false); T.bike.speed = 0; T.bike.vx = T.bike.vz = 0; G.dismount(true); }
      if (f % 1500 === 20 && G.mode !== 'bike') mount();
      if (f % 700 === 0 && G.perpBikes) for (const pb of G.perpBikes) { pb.provoked = true; if (!pb.crashed && Math.hypot(pb.pos.x - T.bike.pos.x, pb.pos.z - T.bike.pos.z) > 150) pb.place(T.bike.pos.x + 30, T.bike.pos.z + 10, 0); }
      if (f === 2600 && G.perpBikes && G.perpBikes[0]) G.perpBikes[0].hurt(500, { type: 'bullet' });   // wreck one (crash visuals)
      window.__step(1);
      const bk = T.bike;
      if (!isFinite(bk.pos.x + bk.pos.z + bk.yaw + bk.lean)) { out.nan.push('bike pos ' + f); break; }
      if (bad(bk.model.userData.sprung) || bad(bk.model.userData.forkLow) || bad(bk.model.userData.swing)) { out.nan.push('bike rig ' + f); break; }
      if (G.mode === 'bike' && (bad(T.player.ch.wrL) || bad(T.player.ch.anR) || bad(T.player.ch.head))) { out.nan.push('rider ' + f); break; }
      if (G.perpBikes) for (const pb of G.perpBikes) if (bad(pb.model.userData.sprung) || (pb.rider && bad(pb.rider.wrR))) { out.nan.push('perp bike ' + f); f = FRAMES; break; }
      for (const c of G.traffic.cars) if (c.model.visible && bad(c.model.userData.chassis)) { out.nan.push('car ' + c.kind + ' ' + f); f = FRAMES; break; }
      if (f % 1000 === 0) { const u = bk.model.userData; out.samples.push({ f, speed: +bk.speed.toFixed(1), boost: bk.boosting, fork: +u.forkLow.position.y.toFixed(3), swing: +u.swing.rotation.x.toFixed(3), pitch: +u.sprung.rotation.x.toFixed(3), blur: +u.mats.blur.opacity.toFixed(2), mode: G.mode }); }
    } catch (e) { out.errors.push(f + ': ' + e.stack.split('\n').slice(0, 4).join(' | ')); break; }
  }
  out.kinds = {}; for (const c of G.traffic.cars) out.kinds[c.kind] = (out.kinds[c.kind] || 0) + 1;
  out.perpBikes = (G.perpBikes || []).map((pb) => ({ crashed: pb.crashed, speed: +pb.speed.toFixed(1) }));
  return out;
}, FRAMES);
console.log(JSON.stringify(res, null, 1));
console.log(errs.length ? errs.slice(0, 10).join('\n') : 'no page errors');
await b.close();
