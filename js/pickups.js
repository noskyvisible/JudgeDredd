import * as THREE from 'three';
import { G } from './state.js';
import { fx } from './fx.js';
import { audio } from './audio.js';
import { AMMO } from './weapons.js';
import { rand, pick, chance, randInt } from './util.js';

const geo = new THREE.BoxGeometry(0.7, 0.5, 0.7);
export class Pickups {
  constructor() { this.list = []; }
  spawn(pos, kind, ammoIdx = 1) {
    const color = kind === 'health' ? 0x40ff70 : AMMO[ammoIdx].color;
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2), toneMapped: false }));
    m.position.set(pos.x, 0.7, pos.z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.03, 6, 20), new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0.8 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = -0.55; m.add(ring);
    G.scene.add(m);
    this.list.push({ m, kind, ammoIdx, t: 0, life: kind === 'crate' ? 9999 : 40, color });
  }
  dropFrom(e) {
    if (chance(0.45)) this.spawn(e.pos, 'ammo', randInt(1, 5));
    else if (chance(0.3)) this.spawn(e.pos, 'health');
  }
  update(dt) {
    const pl = G.player;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]; p.t += dt; p.life -= dt;
      p.m.rotation.y += dt * 2; p.m.position.y = 0.8 + Math.sin(p.t * 3) * 0.12;
      if (p.t % 0.2 < dt) fx.add.emit(p.m.position.x + rand(-0.3, 0.3), 0.3, p.m.position.z + rand(-0.3, 0.3), 0, 1.5, 0, ((p.color >> 16) & 255) / 120, ((p.color >> 8) & 255) / 120, (p.color & 255) / 120, 0.8, 0.15, 0.6, 0, 0, 0);
      const d = Math.hypot(pl.pos.x - p.m.position.x, pl.pos.z - p.m.position.z);
      if (d < 2.4 && pl.alive) {
        if (p.kind === 'health') { if (pl.hp >= pl.maxHp - 1) continue; pl.heal(35); fx.text(p.m.position, '+HEALTH', 'good'); }
        else { const a = AMMO[p.ammoIdx]; const n = Math.max(2, Math.round(a.count / 2 * (pl.rank >= 1 ? 1.5 : 1))); pl.ammo[p.ammoIdx] = Math.min(a.count * 2, pl.ammo[p.ammoIdx] + n); fx.text(p.m.position, `+${n} ${a.short}`, 'good'); G.hud?.flashAmmo(p.ammoIdx); }
        audio.ui('pickup'); fx.burst(p.m.position, 12, p.color, 5, 0.2, 0.4);
        G.scene.remove(p.m); this.list.splice(i, 1); continue;
      }
      if (p.life <= 0) { G.scene.remove(p.m); this.list.splice(i, 1); }
    }
  }
}
