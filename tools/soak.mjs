// Soak test: dispatches every crime scenario, then plays 9000 frames of random input with the live render skipped.
// Reports exceptions and NaN positions.   node tools/soak.mjs [url]   (needs a static server, default http://localhost:8000/)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }
const URL_ = process.argv[2] || 'http://localhost:8000/';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:320,height:180} });
const errs=[];
p.on('pageerror',e=>errs.push('PAGEERROR: '+e.stack.split('\n').slice(0,4).join(' | ')));
p.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });
await p.addInitScript(()=>{ window.__noRender=true; });
await p.goto(URL_);
await p.waitForFunction(()=>window.__test, null, {timeout:120000});
const res = await p.evaluate(()=>{
  const T=window.__test, G=window.__G, out={errors:[],nan:[]};
  T.startGame();
  const keys=['KeyW','KeyA','KeyS','KeyD','ShiftLeft','Space','KeyE','KeyF','KeyQ','KeyR','KeyG','KeyB','KeyH','Tab','Digit1','Digit2','Digit3','Digit4','Digit5','Digit6'];
  const rk = Object.keys(window.__G.crimes?.constructor?.name?{}:{});
  let seed=1; const rnd=()=> (seed=(seed*16807)%2147483647)/2147483647;
  const { SCENARIOS } = {SCENARIOS:null};
  const scen=['jaywalker','litter','smoker','vandals','brawl','hotdog','mugging','robbery','slomo','weapons','arson','hostage','gangwar','bomb','boss','riot','sniper'];
  for(const k of scen){ try{ G.crimes.dispatch(k);}catch(e){out.errors.push('dispatch '+k+': '+e.stack.split('\n').slice(0,3).join('|'));} }
  T.player.hp = 1e9; T.player.maxHp=1e9;
  for(let f=0; f<9000; f++){
    try{
      if(f%20===0){ for(const k of keys) T.input.setKey(k, rnd()<0.3); T.input.setMouse(0, rnd()<0.4); T.input.setMouse(2, rnd()<0.2); }
      // teleport player to a scene periodically so combat actually happens
      if(f%600===0 && G.crimes.active.length){ const s=G.crimes.active[Math.floor(rnd()*G.crimes.active.length)]; T.player.pos.set(s.pos.x+6,0,s.pos.z+6); }
      window.__step(1);
      const p=T.player.pos; if(!isFinite(p.x+p.y+p.z)){ out.nan.push('player '+f); break; }
      const bp=T.bike.pos; if(!isFinite(bp.x+bp.y+bp.z)){ out.nan.push('bike '+f); break; }
    }catch(e){ out.errors.push(f+': '+e.stack.split('\n').slice(0,4).join(' | ')); break; }
  }
  out.stats={...T.player.stats, rank:T.player.rank, cred:T.player.cred, scenes:G.crimes.scenes.length, enemies:G.enemies.all.length};
  return out;
});
console.log(JSON.stringify(res,null,1)); console.log(errs.slice(0,10).join('\n'));
await b.close();
