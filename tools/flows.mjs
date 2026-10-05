// Targeted flow checks the soak / bot do not cover: player death + respawn, mount / dismount cycles, a high-speed bike crash, a hostage and a bomb scene.
//   node tools/flows.mjs [url]     prints each flow's outcome and any page error
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }
const url = process.argv[2] || 'http://localhost:8000/';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 320, height: 180 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.stack.split('\n').slice(0, 3).join(' | '))); p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 200)); });
await p.addInitScript(() => { window.__noRender = true; });
await p.goto(url);
await p.waitForFunction(() => window.__test, null, { timeout: 180000 });
const res = await p.evaluate(() => {
  const T = window.__test, G = window.__G, P = T.player, I = T.input, THREE = T.THREE, out = {};
  T.startGame(); G.crimes.spawnT = 1e9;
  const run = (n) => { for (let i = 0; i < n; i++) window.__step(1); };
  const finite = (...v) => v.every((x) => Number.isFinite(x));
  run(60);
  // 1. death and respawn (on foot)
  { const hp0 = P.hp; P.hp = 5; P.armor = 0; P.damage(50, new THREE.Vector3(0, 0, 1), 'bullet'); run(30);
    out.death = { alive: P.alive, state: P.state, gDead: !!G.dead };
    run(260); // death timer -> respawn callback
    out.respawn = { alive: P.alive, hp: Math.round(P.hp), paused: G.paused, dead: !!G.dead }; if (G.paused) { G.paused = false; T.setPaused(false); } }
  // 2. mount / dismount cycles
  { P.pos.copy(T.bike.pos).add(new THREE.Vector3(2, 0, 0)); let ok = 0;
    for (let k = 0; k < 4; k++) { G.mount(); run(20); const mounted = G.mode === 'bike'; T.bike.speed = 3; run(10); I.setKey('KeyE', true); run(2); I.setKey('KeyE', false); T.bike.speed = 0; G.dismount(true); run(20); if (mounted && G.mode === 'foot') ok++; }
    out.mountCycles = { ok, of: 4, pos: finite(P.pos.x, P.pos.y, P.pos.z) }; }
  // 3. bike crash at speed into the nearest building
  { P.pos.set(-300, 0, 50); T.bike.place(P.pos.x + 1.8, P.pos.z, Math.PI / 2); P.pos.set(T.bike.pos.x - 1.6, 0, T.bike.pos.z); G.mount(); T.bike.speed = 90;
    for (let i = 0; i < 200; i++) { T.bike.ctrl.throttle = 1; T.bike.ctrl.hold = false; T.bike.ctrl.steer = i > 40 ? 1 : 0; window.__step(1); }
    out.crash = { speed: Math.round(T.bike.speed), hp: Math.round(T.bike.hp), pos: finite(T.bike.pos.x, T.bike.pos.z), mode: G.mode }; if (G.mode === 'bike') G.dismount(true); }
  // 4. a hostage scene and a bomb scene: spawn them and let them run
  for (const key of ['hostage', 'bomb', 'arson', 'hotdog']) { const s = G.crimes.dispatch(key); P.pos.set(s.pos.x + 7, 0, s.pos.z + 7); run(240); out[key] = { spawned: s.spawned, state: s.state, perps: s.perps.length }; }
  // 5. skinned characters still follow their joints: a thug's skinned meshes sit within a body's length of its root after a long sprint
  { const e = new T.Enemy('thug', new THREE.Vector3(P.pos.x + 20, 0, P.pos.z)); G.enemies.add(e); e.aggro = true; run(300); const sm = e.ch.skinnedMeshes || []; const d = Math.hypot(e.pos.x - e.ch.root.position.x, e.pos.z - e.ch.root.position.z); out.skinFollow = { skinned: sm.length, rootSync: d < 0.5 }; }
  return out;
});
console.log(JSON.stringify(res, null, 1));
console.log(errs.length ? 'ERRORS:\n' + errs.slice(0, 6).join('\n') : 'no page errors');
await b.close();
