import { G } from './state.js';

// ---------------------------------------------------------------------------
// Distance management for dynamic entities.  The scene is rendered up to three times a frame (sun shadow map, mirrored ground pass, main pass), and a
// character or vehicle is dozens of draw calls in each, so the cheapest frame is the one that does not draw what nobody can see:
//   * traffic cars and the parked Lawmaster beyond FAR are hidden (fog has already swallowed them: ~90 % haze by 450 m at street level)
//   * enemies only cast sun shadows while they are close enough for the shadow to matter (the shadow map covers +-70 m around the player)
// Only objects this module hid are ever re-shown, so anything the game hides on purpose stays hidden.
// ---------------------------------------------------------------------------

const FAR = 450, FAR2 = FAR * FAR, CAST2 = 36 * 36;
let acc = 0;

function setCast(root, on) { root.traverse((o) => { if (o.isMesh) o.castShadow = on; }); }

export function updateDynamicLOD(dt, camera, playerPos) {
  acc += dt; if (acc < 0.2) return; acc = 0;
  const cx = camera.position.x, cz = camera.position.z;
  if (G.traffic) for (const c of G.traffic.cars) {
    const m = c.model, far = (c.pos.x - cx) ** 2 + (c.pos.z - cz) ** 2 > FAR2;
    if (far && m.visible) { m.visible = false; m.userData._lodHid = true; }
    else if (!far && m.userData._lodHid) { m.visible = true; m.userData._lodHid = false; }
  }
  const b = G.bikeObj;
  if (b) {
    const far = (b.pos.x - cx) ** 2 + (b.pos.z - cz) ** 2 > FAR2 && !b.mounted && !b.called;
    if (far && b.model.visible) { b.model.visible = false; b.model.userData._lodHid = true; }
    else if (!far && b.model.userData._lodHid) { b.model.visible = true; b.model.userData._lodHid = false; }
  }
  if (G.enemies) for (const e of G.enemies.all) {
    if (e.removed) continue;
    const on = (e.pos.x - playerPos.x) ** 2 + (e.pos.z - playerPos.z) ** 2 < CAST2;
    if (e._cast !== on) { e._cast = on; setCast(e.ch.root, on); }
  }
}
