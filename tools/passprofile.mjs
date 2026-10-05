// Per-pass draw-call profile of one real frame: wraps the renderer's draw function and attributes every call to its pass
// (sun shadow map / mirrored ground pass / main pass) and to a category (dynamic Group vs. world mesh kinds).
//   node tools/passprofile.mjs [fight6|street_neon|hall|aerial] [--chunk 500] [url]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }
const args = process.argv.slice(2);
const shot = args.find((a) => !a.startsWith('--') && !a.startsWith('http')) || 'fight6';
const url = args.find((a) => a.startsWith('http')) || 'http://localhost:8000/';
const ci = args.indexOf('--chunk'), chunk = ci >= 0 ? +args[ci + 1] : 0;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 800, height: 450 } });
await p.addInitScript((c) => { window.__noRender = true; if (c) globalThis.__CHUNK = c; }, chunk);
await p.goto(url);
await p.waitForFunction(() => window.__test, null, { timeout: 180000 });
const res = await p.evaluate(async (shot) => {
  const T = window.__test, G = window.__G, P = T.player, THREE = T.THREE;
  T.startGame(); T.setQuality(2);
  const at = { street_neon: [452, -498], fight6: [-250, 50], aerial: [-150, 50], hall: [0, 62], ride: [-300, 50] }[shot] || [-250, 50];
  P.pos.set(at[0], 0, at[1]); P.camYaw = shot === 'hall' ? Math.PI : 0; P.camPitch = 0.16; P.camDist = 6.5;
  if (shot === 'fight6') for (const [dx, dz, ty] of [[3.2, 2.6, 'thug'], [-3.4, 3.8, 'gunman'], [0.6, 6.5, 'brute'], [5, 8, 'thug'], [-6, 9, 'gunman'], [2, 12, 'junkie']]) { const e = new T.Enemy(ty, new THREE.Vector3(P.pos.x + dx, 0, P.pos.z + dz)); e.aggro = true; G.enemies.add(e); }
  if (shot === 'ride') { T.bike.place(P.pos.x + 1.8, P.pos.z, Math.PI / 2); P.pos.set(T.bike.pos.x - 1.6, 0, T.bike.pos.z); G.mount(); T.bike.speed = 50; for (let i = 0; i < 150; i++) { T.bike.ctrl.throttle = 0.6; T.bike.ctrl.hold = false; window.__step(1); } }
  for (let i = 0; i < 150 && shot !== 'ride'; i++) window.__step(1);
  const r = T.renderer, sc = T.scene, mirrorCam = T.reflection.cam;
  const stats = { shadow: new Map(), mirror: new Map(), main: new Map() };
  const orig = r.renderBufferDirect;
  r.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    const pass = (material.isMeshDepthMaterial || material.isMeshDistanceMaterial) ? 'shadow' : (camera === mirrorCam ? 'mirror' : 'main');
    let top = object; while (top.parent && top.parent !== sc && top.parent.type !== 'Scene') top = top.parent;
    const mat = Array.isArray(object.material) ? object.material[0] : object.material;
    const key = top.isGroup ? 'dynamic group (char/car/bike)' : `${object.isInstancedMesh ? 'instanced ' : ''}${object.type}${mat ? '/' + mat.type : ''}${object.geometry && object.geometry.attributes.position.count > 8000 ? ' [big]' : ''}`;
    const m = stats[pass]; const e = m.get(key) || { n: 0, tris: 0 }; e.n++;
    const g = object.geometry; e.tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (object.isInstancedMesh ? (object.count || 1) : 1); m.set(key, e);
    return orig.apply(this, arguments);
  };
  window.__render();
  r.renderBufferDirect = orig;
  const out = {};
  for (const k of ['shadow', 'mirror', 'main']) { let n = 0, t = 0; for (const e of stats[k].values()) { n += e.n; t += e.tris; } out[k] = { calls: n, tris: Math.round(t / 1000), top: [...stats[k].entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 9).map(([key, v]) => `${String(v.n).padStart(4)} ${String((v.tris / 1000) | 0).padStart(5)}k  ${key}`) }; }
  return out;
}, shot);
for (const k of ['shadow', 'mirror', 'main']) { console.log(`== ${k}: ${res[k].calls} calls, ${res[k].tris}k tris`); for (const l of res[k].top) console.log('   ' + l); }
await b.close();
