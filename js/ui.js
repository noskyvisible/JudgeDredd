import * as THREE from 'three';
import { G } from './state.js';
import { input } from './input.js';
import { audio } from './audio.js';
import { fx } from './fx.js';
import { world, N, S, HALF, ROAD, BLOCK, roadX } from './world.js';
import { AMMO } from './weapons.js';
import { RANKS } from './player.js';
import { SENTENCES, buildDossier } from './crimes.js';
import { clamp } from './util.js';

const $ = (id) => document.getElementById(id);
const el = {};
let feedN = 0, lastDistrict = '', bannerT = 0, hmT = 0;
const proj = new THREE.Vector3();
let mm, mmx, bm, bmx;

export const hud = {
  init() {
    for (const id of ['hud', 'vignette', 'speedlines', 'lightning', 'rankname', 'credbar', 'credtxt', 'district', 'crimebar', 'dispatch', 'combo', 'combonum', 'combobar', 'finisher',
      'minimap', 'fps', 'feed', 'hpbar', 'hptxt', 'armorbar', 'ammo', 'speedo', 'speed', 'boostbar', 'ap', 'crosshair', 'hitmark', 'prompt', 'firehint', 'gunkeys', 'banner', 'bannertitle', 'bannersub', 'warn', 'objective', 'mapscreen', 'bigmap', 'judge', 'pause', 'death', 'stats']) el[id] = $(id);
    mm = el.minimap; mmx = mm.getContext('2d'); bm = el.bigmap; bmx = bm.getContext('2d');
    // ammo slots
    el.ammo.innerHTML = '';
    AMMO.forEach((a, i) => {
      const d = document.createElement('div'); d.className = 'slot'; d.style.color = a.css; d.style.borderColor = a.css + '99';
      d.innerHTML = `<span class="k">${i + 1}</span><span class="n">${a.short}</span><span class="c">∞</span>`;
      el.ammo.appendChild(d);
    });
    this.slots = [...el.ammo.children];
    const nm = document.createElement('div'); nm.id = 'ammoname'; el.hud.appendChild(nm); el.ammoname = nm;
    G.hud = this;
    this.layout(); addEventListener('resize', () => this.layout());
  },
  // scale the HUD blocks with the viewport so nothing collides on small windows
  layout() {
    const hs = clamp(innerHeight / 760, 0.55, 1.15); this.hs = hs;
    el.hud.style.setProperty('--hs', hs.toFixed(3)); this._dh = null;
  },
  show(v) { el.hud.classList.toggle('hidden', !v); },
  banner(title, sub = '', cls = '') {
    el.banner.className = ''; void el.banner.offsetWidth; el.banner.className = 'on ' + cls;
    el.bannertitle.textContent = title; el.bannersub.textContent = sub;
  },
  feed(text, cls = '') {
    const d = document.createElement('div'); d.textContent = text; d.className = cls; el.feed.appendChild(d); el.feed.appendChild(document.createElement('br'));
    setTimeout(() => { d.remove(); }, 6000);
    while (el.feed.children.length > 12) el.feed.firstChild.remove();
  },
  damageFlash(a) { el.vignette.style.transition = 'none'; el.vignette.style.opacity = String(0.4 + a * 0.6); requestAnimationFrame(() => { el.vignette.style.transition = 'opacity .6s'; el.vignette.style.opacity = '0'; }); },
  hitMarker(crit) { const h = el.hitmark; h.className = ''; void h.offsetWidth; h.className = 'on' + (crit ? ' crit' : ''); },
  comboPop() { el.combonum.classList.add('pop'); setTimeout(() => el.combonum.classList.remove('pop'), 80); },
  warn() { el.warn.className = ''; void el.warn.offsetWidth; el.warn.className = 'on'; },
  fired(a) {
    const s = this.slots?.[AMMO.indexOf(a)]; if (s) { s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); }
    el.crosshair.classList.add('fired'); clearTimeout(this._ft); this._ft = setTimeout(() => el.crosshair.classList.remove('fired'), 90);
  },
  flashAmmo(i) { const s = this.slots[i]; s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); },

  update(dt) {
    const pl = G.player; if (!pl) return;
    const cm = G.crimes;
    // bars
    el.hpbar.style.width = (clamp(pl.hp / pl.maxHp, 0, 1) * 100) + '%'; el.hptxt.textContent = Math.ceil(pl.hp);
    el.armorbar.style.width = (clamp(pl.armor / pl.maxArmor, 0, 1) * 100) + '%';
    const rk = RANKS[pl.rank], nx = RANKS[pl.rank + 1];
    el.rankname.textContent = rk.name;
    el.credbar.style.width = nx ? (clamp((pl.cred - rk.cred) / (nx.cred - rk.cred), 0, 1) * 100) + '%' : '100%';
    el.credtxt.textContent = `${pl.cred} CRED${nx ? ' / ' + nx.cred : ''}`;
    el.crimebar.style.width = cm.crimeLevel + '%';
    const dn = world.district(pl.pos.x, pl.pos.z);
    if (dn !== lastDistrict) { lastDistrict = dn; el.district.textContent = dn; }
    // combo
    el.combo.classList.toggle('on', pl.combo > 1);
    el.combonum.textContent = pl.combo; el.combobar.style.width = (clamp(pl.comboT / 3.5, 0, 1) * 100) + '%';
    el.finisher.classList.toggle('on', !!pl.finisherReady);
    // ammo
    this.slots.forEach((s, i) => {
      const a = AMMO[i], n = pl.ammo[i]; s.classList.toggle('sel', i === pl.ammoIdx); s.classList.toggle('empty', n <= 0);
      s.querySelector('.c').textContent = n === Infinity ? '∞' : n;
    });
    const a = AMMO[pl.ammoIdx]; el.ammoname.innerHTML = `<span style="color:${a.css}">${a.name}</span><small>${a.desc}</small>`;
    // crosshair
    el.crosshair.classList.toggle('on', pl.aiming && pl.alive);
    el.firehint.classList.toggle('on', pl.aiming && pl.alive && G.time - (pl.lastShotT || -99) > 4 && !pl.firedOnce);
    if (pl.lastShotT > 0) pl.firedOnce = (pl.firedOnce || 0) + 0 || (G.time - pl.lastShotT < 0.5 ? true : pl.firedOnce);
    el.crosshair.style.setProperty('--sp', (pl.recoil * 10 + clamp(pl.speedNow, 0, 12) * 0.5) + 'px'); pl.recoil = Math.max(0, pl.recoil - dt * 6);
    // prompt
    el.prompt.classList.toggle('on', !!pl.prompt); el.prompt.textContent = pl.prompt;
    // speedo
    const bike = G.mode === 'bike' && G.bikeObj;
    el.speedo.classList.toggle('on', !!bike);
    if (bike) { el.speed.textContent = Math.round(Math.abs(bike.speed) * 3.6); el.boostbar.style.width = (bike.boostE * 100) + '%'; el.ap.classList.toggle('on', bike.auto); }
    el.speedlines.style.opacity = bike ? String(clamp((Math.abs(bike.speed) - 55) / 55, 0, 0.7) + (bike.boosting ? 0.2 : 0)) : '0';
    el.lightning.style.opacity = String(world.lightning * 0.18);
    // dispatch list
    this.updateDispatch();
    this.updateObjective();
    this.minimap();
    if (G.showFps) { el.fps.classList.add('on'); el.fps.textContent = `${Math.round(G.fps || 0)} fps · ${G.renderer.info.render.calls} calls · ${(G.renderer.info.render.triangles / 1000) | 0}k tris`; } else el.fps.classList.remove('on');
  },

  updateDispatch() {
    const cm = G.crimes; const html = [];
    const tr = cm.trackedScene();
    for (const s of cm.active) {
      const d = Math.round(s.dist);
      const urgent = s.timeLeft < 30;
      html.push(`<div class="case ${s === tr ? 'tracked' : ''}"><b>${s.title.toUpperCase()}</b><small><span>${s.district}</span><span>${d}m</span></small><small><span class="sev">${'■'.repeat(s.sev)}${'□'.repeat(5 - s.sev)}</span><span class="${urgent ? 'urgent' : ''}">${Math.max(0, Math.ceil(s.timeLeft))}s${s.spawned && s.remaining ? ' · ' + s.remaining + ' perps' : ''}${s.bomb && s.bombStarted ? ' · 💣' + Math.ceil(s.bomb.timer) : ''}</span></small></div>`);
    }
    const h = html.join('');
    if (h !== this._dh) { el.dispatch.innerHTML = h; this._dh = h; this._dispBottom = el.dispatch.getBoundingClientRect().bottom + 10; }
  },

  updateObjective() {
    const s = G.crimes.trackedScene();
    if (!s) { el.objective.style.display = 'none'; return; }
    const cam = G.camera;
    proj.set(s.pos.x, 28, s.pos.z).project(cam);
    let x = proj.x, y = proj.y; const behind = proj.z > 1;
    if (behind) { x = -x; y = -y; }
    const onscreen = !behind && Math.abs(x) < 0.92 && Math.abs(y) < 0.88;
    if (!onscreen) { const m = Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.85, 0.001); x /= m; y /= m; if (behind) { y = -0.85; } }
    el.objective.style.display = 'block';
    // keep the marker out of the HUD columns (left: rank + dispatch list, right: minimap + feed)
    let px = (x * 0.5 + 0.5) * innerWidth, py = (-y * 0.5 + 0.5) * innerHeight; const hs = this.hs || 1;
    if (px < 350 * hs && py < this._dispBottom) px = 350 * hs;
    else if (px > innerWidth - 270 * hs && py < 300 * hs) px = innerWidth - 270 * hs;
    if (px < 370 * hs && py > innerHeight - 120 * hs) py = innerHeight - 125 * hs;                       // player block
    else if (px > innerWidth - 440 * hs && py > innerHeight - 170 * hs) py = innerHeight - 175 * hs;   // ammo block
    el.objective.style.transform = `translate(${px}px, ${py}px) translate(-50%,-50%)`;
    el.objective.innerHTML = `<div class="dia"></div>${Math.round(s.dist)}m`;
  },

  // ---------- minimap ----------
  drawRoads(ctx, x0, z0, x1, z1) {
    ctx.fillStyle = '#2a2a38';
    for (let k = 0; k <= N; k++) {
      const c = roadX(k);
      ctx.fillRect(c - ROAD / 2, z0, ROAD, z1 - z0);
      ctx.fillRect(x0, c - ROAD / 2, x1 - x0, ROAD);
    }
  },
  minimap() {
    const pl = G.player, ctx = mmx, W = 240, R = 130; const sc = W / 2 / R;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#0a0b12'; ctx.fillRect(0, 0, W, W);
    const yaw = pl.camYaw;
    ctx.save(); ctx.translate(W / 2, W / 2); ctx.rotate(yaw + Math.PI); ctx.scale(sc, sc); ctx.translate(-pl.pos.x, -pl.pos.z);
    // blocks (district tinted) then roads
    ctx.fillStyle = '#14161f'; ctx.fillRect(-HALF - 40, -HALF - 40, 2 * HALF + 80, 2 * HALF + 80);
    this.drawRoads(ctx, -HALF - 11, -HALF - 11, HALF + 11, HALF + 11);
    // lane lines
    ctx.strokeStyle = 'rgba(255,210,74,.25)'; ctx.lineWidth = 1 / sc;
    for (let k = 0; k <= N; k++) { const c = roadX(k); ctx.beginPath(); ctx.moveTo(c, -HALF); ctx.lineTo(c, HALF); ctx.moveTo(-HALF, c); ctx.lineTo(HALF, c); ctx.stroke(); }
    // scenes
    for (const s of G.crimes.active) {
      const col = '#' + ['fff', '60c0ff', '70ff90', 'ffe040', 'ff9030', 'ff3030'][s.sev];
      ctx.fillStyle = col + '44'; ctx.beginPath(); ctx.arc(s.pos.x, s.pos.z, 16, 0, 7); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(s.pos.x, s.pos.z, 7 + Math.sin(G.time * 5) * 1.5, 0, 7); ctx.fill();
    }
    // entities
    for (const e of G.enemies.all) {
      if (e.removed || e.state === 'dead') continue;
      ctx.fillStyle = e.judgeable ? '#ffd24a' : e.isHostile ? '#ff3a3a' : '#ff9a6a'; ctx.beginPath(); ctx.arc(e.pos.x, e.pos.z, 3.5 / sc * 0.5 + 2, 0, 7); ctx.fill();
    }
    if (G.perpBikes) for (const b of G.perpBikes) if (!b.crashed) { ctx.fillStyle = '#ff3a3a'; ctx.beginPath(); ctx.arc(b.pos.x, b.pos.z, 6, 0, 7); ctx.fill(); }
    if (G.bikeObj && G.mode === 'foot') { ctx.fillStyle = '#40e0ff'; ctx.fillRect(G.bikeObj.pos.x - 4, G.bikeObj.pos.z - 4, 8, 8); }
    ctx.restore();
    // edge arrow for tracked scene
    const tr = G.crimes.trackedScene();
    if (tr) {
      const dx = tr.pos.x - pl.pos.x, dz = tr.pos.z - pl.pos.z; const f = dx * Math.sin(yaw) + dz * Math.cos(yaw), r = -dx * Math.cos(yaw) + dz * Math.sin(yaw);
      const d = Math.hypot(f, r);
      if (d * sc > W / 2 - 14) { const a = Math.atan2(r, -f); ctx.save(); ctx.translate(W / 2 + Math.sin(a) * (W / 2 - 14), W / 2 + (-Math.cos(a)) * (W / 2 - 14)); ctx.rotate(a); ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(7, 6); ctx.lineTo(-7, 6); ctx.closePath(); ctx.fill(); ctx.restore(); }
    }
    // player arrow (always up)
    ctx.save(); ctx.translate(W / 2, W / 2); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8); ctx.closePath(); ctx.stroke(); ctx.fill(); ctx.restore();
    // ring
    ctx.strokeStyle = 'rgba(255,210,74,.5)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(W / 2, W / 2, W / 2 - 2, 0, 7); ctx.stroke();
  },
  bigMap() {
    const ctx = bmx, W = 760, sc = W / (2 * HALF + 140); const pl = G.player;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#0a0b12'; ctx.fillRect(0, 0, W, W);
    ctx.save(); ctx.scale(sc, sc); ctx.translate(HALF + 70, HALF + 70);
    // districts as tinted blocks
    const cols = ['#3a1a1a', '#1a2a3a', '#2a1a3a', '#2a2a1a', '#3a3320', '#1a3a2a', '#3a2a1a', '#2a1a2a', '#1a3a3a'];
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) { ctx.fillStyle = cols[j * 3 + i]; ctx.fillRect(-HALF + i * (2 * HALF / 3), -HALF + j * (2 * HALF / 3), 2 * HALF / 3, 2 * HALF / 3); }
    this.drawRoads(ctx, -HALF - 11, -HALF - 11, HALF + 11, HALF + 11);
    ctx.fillStyle = '#ffd24a33'; ctx.fillRect(-BLOCK / 2, -BLOCK / 2, BLOCK, BLOCK);
    ctx.fillStyle = '#ffffffaa'; ctx.font = '900 30px Impact'; ctx.textAlign = 'center';
    const names = [['BLOCK-WAR HEIGHTS', 'SEKTOR 9 FINANCIAL', 'NEON ROW'], ['SLO-MO ALLEY', 'HALL OF JUSTICE', 'GRUD PARK'], ['INDUSTRIAL ZONE', 'UNDERCITY MARKET', 'CHOP DOCKS']];
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) { ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillText(names[j][i], -HALF + (i + 0.5) * (2 * HALF / 3), -HALF + (j + 0.5) * (2 * HALF / 3)); }
    for (const s of G.crimes.active) { const col = '#' + ['fff', '60c0ff', '70ff90', 'ffe040', 'ff9030', 'ff3030'][s.sev]; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(s.pos.x, s.pos.z, 16, 0, 7); ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 4; ctx.stroke(); ctx.fillStyle = '#fff'; ctx.font = '900 26px Impact'; ctx.fillText(s.title, s.pos.x, s.pos.z - 24); }
    if (G.bikeObj) { ctx.fillStyle = '#40e0ff'; ctx.fillRect(G.bikeObj.pos.x - 8, G.bikeObj.pos.z - 8, 16, 16); }
    ctx.translate(pl.pos.x, pl.pos.z); ctx.rotate(-pl.yaw + Math.PI); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(14, 16); ctx.lineTo(0, 8); ctx.lineTo(-14, 16); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.restore();
  },
  toggleMap() {
    const open = el.mapscreen.classList.contains('hidden');
    el.mapscreen.classList.toggle('hidden', !open);
    G.mapOpen = open; if (open) this.bigMap();
  },
  showPause(v) { el.pause.classList.toggle('hidden', !v); if (v) { const p = G.player; el.stats.innerHTML = `ARRESTS ${p.stats.arrests} · PERFECT VERDICTS ${p.stats.perfect} · KILLS ${p.stats.kills}<br>COUNTERS ${p.stats.counters} · FINISHERS ${p.stats.finishers} · BEST COMBO ${p.bestCombo}`; } },
  showDeath(v) { el.death.classList.toggle('hidden', !v); },
};

// ---------------------------------------------------------------------------
// Judgement screen
// ---------------------------------------------------------------------------
export const judgement = {
  cur: null, sel: -1, locked: false,
  open(perp) {
    if (G.modal) return;
    const d = buildDossier(perp); this.cur = d; this.sel = -1; this.locked = false;
    G.modal = true; input.unlock();
    audio.ui('beep'); audio.voice('I am the law.');
    const box = el.judge; box.classList.remove('hidden');
    const crimes = d.crimes.map((c) => `<div class="crime"><div>${c.name}<em>${c.statute}</em></div><div class="g">${SENTENCES[c.tier].short.toUpperCase()}</div></div>`).join('');
    const factors = d.factors.map((f) => `<div class="factor"><span>${f.text}</span><span class="${f.v > 0 ? 'p' : 'm'}">${f.v > 0 ? '+1 tier' : '−1 tier'}</span></div>`).join('') || '<div class="factor"><span>No aggravating or mitigating factors</span><span>—</span></div>';
    const ladder = SENTENCES.map((s, i) => `<div class="sent" data-i="${i}"><span>${i + 1}</span>${s.label}</div>`).join('');
    box.innerHTML = `<div class="jbox"><div class="jleft">
      <div class="jhead">MEGA-CITY ONE · JUSTICE DEPARTMENT · FIELD JUDGEMENT</div>
      <div class="jname">${perp.name.toUpperCase()}</div><div class="jid">ID ${perp.id} · PRIORS: ${perp.priors}${perp.T.meek ? '' : ' · ' + perp.T.label}</div>
      <div class="jsec">CHARGES &amp; GUIDELINE SENTENCE</div>${crimes}
      <div class="jsec">CIRCUMSTANCES</div>${factors}
      <div class="jmath">Guideline = the harshest charge${d.crimes.length > 1 ? ' (+1 for multiple offences)' : ''}. Each factor moves the sentence one step up or down the ladder.</div>
    </div><div class="jright"><div class="jhead">PASS SENTENCE</div><div class="ladder">${ladder}</div>
      <div class="jconfirm"><small>1–8 select · ENTER confirm · ESC step back</small><button id="jbtn" disabled>SENTENCE</button></div></div></div>`;
    box.querySelectorAll('.sent').forEach((n) => { n.onclick = () => this.select(+n.dataset.i); n.ondblclick = () => { this.select(+n.dataset.i); this.confirm(); }; });
    box.querySelector('#jbtn').onclick = () => this.confirm();
  },
  select(i) { if (this.locked) return; this.sel = i; audio.ui('select'); el.judge.querySelectorAll('.sent').forEach((n, k) => n.classList.toggle('sel', k === i)); el.judge.querySelector('#jbtn').disabled = false; },
  confirm() {
    if (this.locked || this.sel < 0) return; this.locked = true;
    const d = this.cur; const res = G.crimes.onJudged(d.perp, this.sel, d);
    audio.ui('gavel');
    el.judge.querySelectorAll('.sent').forEach((n, k) => { if (k === d.correct) n.classList.add('right'); else if (k === this.sel) n.classList.add('wrong'); });
    const box = el.judge.querySelector('.jbox');
    const r = document.createElement('div'); r.className = 'jresult ' + res.cls;
    const msgs = { good: 'The law is satisfied.', ok: 'Close enough for the streets.', bad: `The guideline was ${SENTENCES[d.correct].label}.` };
    r.innerHTML = `<h3>${res.verdict}</h3><p>${msgs[res.cls]}  ·  SENTENCE: ${SENTENCES[this.sel].label}</p>`;
    box.appendChild(r); el.judge.querySelector('#jbtn').disabled = true;
    audio.voice(res.cls === 'bad' ? 'Next time, read the law.' : 'Court is adjourned.');
    setTimeout(() => this.close(), res.cls === 'bad' ? 2800 : 2100);
  },
  close() { el.judge.classList.add('hidden'); el.judge.innerHTML = ''; G.modal = false; this.cur = null; G.onModalClosed?.(); },
  key(e) {
    if (!G.modal || !this.cur) return false;
    if (/^Digit[1-8]$/.test(e.code)) { this.select(+e.code.slice(5) - 1); return true; }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { this.confirm(); return true; }
    if (e.code === 'ArrowDown') { this.select(clamp(this.sel + 1, 0, 7)); return true; }
    if (e.code === 'ArrowUp') { this.select(clamp(this.sel < 0 ? 0 : this.sel - 1, 0, 7)); return true; }
    if (e.code === 'Escape' && !this.locked) { this.close(); return true; }
    return true;
  },
};
G.judgement = judgement;
