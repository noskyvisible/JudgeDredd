// Gameplay bot: walks to perps, fights with the daystick, judges each one correctly and watches the wagon take them away.
// Prints arrests / rank / cred over time and any page errors, so a softlock or a broken loop shows up.   node tools/bot.mjs [url]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }
const URL_ = process.argv[2] || 'http://localhost:8000/';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:320,height:180} });
const errs=[]; p.on('pageerror',e=>errs.push(e.stack.split('\n').slice(0,4).join(' | ')));
await p.addInitScript(()=>{ window.__noRender=true; });
await p.goto(URL_);
await p.waitForFunction(()=>window.__test,null,{timeout:120000});
const out = await p.evaluate(()=>{
  const T=window.__test,G=window.__G,I=T.input,P=T.player; const log=[];
  T.startGame(); P.rank=5;P.hp=400;P.maxHp=400;
  const evts=[]; const ob=T.hud.banner.bind(T.hud); T.hud.banner=(a,b,c)=>{evts.push(a); return ob(a,b,c);}; const of_=T.hud.feed.bind(T.hud); T.hud.feed=(a,c)=>{ if(/CLEAN|RAPID|ALL HOSTILES|PERK/.test(a)) evts.push(a); return of_(a,c);};
  const keys=['KeyW','KeyA','KeyS','KeyD','KeyE','KeyF'];
  const rel=()=>{ for(const k of keys) I.setKey(k,false); I.setMouse(0,false); };
  let judged=0, t0=0, lastEvent=0;
  const names=['riot','sniper','gangwar','weapons','boss','brawl'];
  for(const n of names) G.crimes.dispatch(n);
  const sc = G.crimes.scenes[0]; P.pos.set(sc.pos.x+8,0,sc.pos.z+8);
  for(let f=0; f<60*240; f++){
    rel();
    if(G.modal){ if(G.judgement.cur){ if(!G.judgement.locked){ G.judgement.select(G.judgement.cur.correct); G.judgement.confirm(); } else { G.judgement.close(); } } window.__step(1); continue; }
    const live = G.enemies.all.filter(e=>!e.removed&&e.state!=='dead'&&!e.judged);
    const judgeable = live.filter(e=>e.judgeable);
    const fighters = live.filter(e=>!e.judgeable && !e.T.meek);
    const tgt = fighters.length ? fighters : judgeable;
    let best=null,bd=1e9; for(const e of tgt){ const d=Math.hypot(e.pos.x-P.pos.x,e.pos.z-P.pos.z); if(d<bd){bd=d;best=e;} }
    if(best){
      const dx=best.pos.x-P.pos.x, dz=best.pos.z-P.pos.z;
      P.camYaw = Math.atan2(dx,dz);
      if(bd>(best.judgeable?1.6:2.2)) I.setKey('KeyW',true);
      if(best.judgeable){ if(bd<3) I.setKey('KeyE',true); }
      else { I.setMouse(0, true); if(best.state==='telegraph' && f%7===0) I.setKey('KeyF',true); }
      if(bd>40){ P.pos.set(best.pos.x+5,0,best.pos.z+5); }
    } else {
      // nothing nearby: teleport to next scene with enemies
      const s = G.crimes.active.find(s=>s.spawned) || G.crimes.active[0];
      if(s && f%120===0) P.pos.set(s.pos.x+6,0,s.pos.z+6);
    }
    window.__step(1);
    if(f%1200===0||1&&f%600===0) log.push(f+' arrests='+P.stats.arrests+' perf='+P.stats.perfect+' kills='+P.stats.kills+' live='+live.length+' scenes='+G.crimes.scenes.map(s=>s.key+':'+s.state).join(','));
  }
  const types={}; for(const e of G.enemies.all) types[e.type]=(types[e.type]||0)+1; return {evts:evts.slice(0,40), types, hpLeft:Math.round(P.hp), log: log.slice(-3), stats:P.stats, rank:P.rank, cred:P.cred, wagons:G.crimes.wagons.length};
});
console.log(JSON.stringify(out,null,1)); console.log(errs.join('\n'));
await b.close();
