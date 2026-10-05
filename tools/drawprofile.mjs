// Draw-call profile: renders the scene once with the main camera (no post / mirror / shadow) at a named shot's vantage and attributes
// draw calls + triangles to each top-level scene child, grouped by a readable label.   node tools/drawprofile.mjs [shot] [url]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }
const shot = process.argv[2] || 'street_neon', url = (process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'http://localhost:8000/'), useMirror = process.argv.includes('--mirror');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
await p.addInitScript(() => { window.__noRender = true; });
await p.goto(url);
await p.waitForFunction(() => window.__test, null, { timeout: 180000 });
const rows = await p.evaluate(async ([shot, useMirror]) => {
  const T = window.__test, G = window.__G, P = T.player, THREE = T.THREE;
  T.startGame(); T.setQuality(2);
  const at = { street_neon: [452, -498], fight: [-250, 50], aerial: [-150, 50], plaza: [0, 100] }[shot] || [452, -498];
  P.pos.set(at[0], 0, at[1]); P.camYaw = 0; P.camPitch = 0.12; P.camDist = 6.5;
  if (shot === 'fight') for (const [dx, dz, t] of [[3.2, 2.6, 'thug'], [-3.4, 3.8, 'gunman'], [0.6, 6.5, 'brute'], [5, 8, 'thug'], [-6, 9, 'gunman'], [2, 12, 'thug']]) { const e = new T.Enemy(t, new THREE.Vector3(P.pos.x + dx, 0, P.pos.z + dz)); e.aggro = true; G.enemies.add(e); }
  for (let i = 0; i < 120; i++) window.__step(1);
  T.camera.updateMatrixWorld(true);
  if (useMirror) window.__render();   // one full frame so the mirror camera is positioned
  const r = T.renderer, sc = T.scene, cam = useMirror ? T.reflection.cam : T.camera, kids = sc.children.slice(), vis = kids.map((k) => k.visible), rows = [];
  const label = (k) => {
    let n = 0, tris = 0, mat = null; k.traverse((o) => { if (o.isMesh || o.isPoints || o.isLine) { n++; mat = mat || (o.material && (o.material.type + (o.material.name ? ':' + o.material.name : ''))); const g = o.geometry; if (g) tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3; } });
    return `${k.type}${k.isMesh ? '/' + (k.material && k.material.type) : ''} meshes=${n} ${k.isInstancedMesh ? 'instanced' : ''}`;
  };
  const only = (subset) => { kids.forEach((k) => (k.visible = subset.includes(k))); r.info.reset(); r.render(sc, cam); return { calls: r.info.render.calls, tris: r.info.render.triangles }; };
  const total = only(kids);
  const groups = new Map();
  for (const k of kids) { const c = only([k]); if (!c.calls) continue; const key = label(k).replace(/meshes=\d+/, ''); const g = groups.get(key) || { calls: 0, tris: 0, n: 0 }; g.calls += c.calls; g.tris += c.tris; g.n++; groups.set(key, g); }
  const detail = [];
  for (const k of kids) { if (!k.isGroup) continue; const c = only([k]); if (!c.calls) continue; let d = Math.hypot(k.position.x - P.pos.x, k.position.z - P.pos.z); detail.push({ calls: c.calls, tris: c.tris, kids: k.children.length, d: Math.round(d), y: +k.position.y.toFixed(1), name: k.name || '', mats: [...new Set(((function f(o, a = []) { o.traverse((m) => { if (m.isMesh) a.push(m.material.type); }); return a; })(k)))].join(',') }); }
  detail.sort((a, b) => b.calls - a.calls);
  kids.forEach((k, i) => (k.visible = vis[i]));
  return { detail: detail.slice(0, 14), total, groups: [...groups.entries()].sort((a, b) => b[1].calls - a[1].calls).map(([k, v]) => ({ k, ...v })) };
}, [shot, useMirror]);
console.log(`shot ${shot}${useMirror ? ' (MIRROR camera)' : ''}: pass total ${rows.total.calls} calls, ${(rows.total.tris / 1000).toFixed(0)}k tris`);
console.log('top groups (calls, tris, children, distance m):'); for (const g of rows.detail) console.log('  ', String(g.calls).padStart(4), (g.tris / 1000).toFixed(1).padStart(6) + 'k', 'kids', String(g.kids).padStart(3), 'dist', String(g.d).padStart(4), g.mats);
for (const g of rows.groups.slice(0, 18)) console.log(String(g.calls).padStart(5), (g.tris / 1000).toFixed(0).padStart(6) + 'k', ('x' + g.n).padStart(5), g.k);
await b.close();
