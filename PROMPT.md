# JUDGE DREDD: MEGA-CITY ONE — Master Prompt

> Paste this into any capable coding model (or use it as the design bible for the project in this repo).
> The game in this repo (`index.html` + `js/`) was built from exactly this brief.

---

## 1. Elevator pitch

Build a **fully playable, open-world, third-person action game** that runs in the browser with **Three.js** and
**zero external assets**. Everything — the city, the characters, the Lawmaster bike, the weapons, the particles,
the sound effects and the music — is generated procedurally in code.

You are **Judge Joseph Dredd** on the mean, rain-soaked, neon-drenched streets of **Mega-City One**.
Crime never sleeps: dispatch calls come in all over the city. You ride your **Lawmaster** to the scene, take
down the perps with your **Lawgiver** (six ammo types) and your **daystick** (free-flow combat in the style of the
Batman Arkham games), then **judge and sentence** every criminal. Different crimes carry different sentences,
and you must get them right.

**Tone:** gritty, dark-satirical, comic-book. 2000 AD meets Blade Runner. *"I am the law."*

**Priorities, in order:** 1) game feel and combat 2) visuals and animation 3) systems depth 4) polish.
Visuals and animation should be as spectacular as the browser allows.

---

## 2. Technical constraints

- Vanilla ES modules + **Three.js** (vendored locally, no build step). Run with any static file server.
- **No external assets.** All geometry from primitives/procedural generation. All textures from `<canvas>`.
  All audio from the **Web Audio API** (procedural synthesis). Fonts: system fonts only.
- 60 fps target on a mid-range laptop GPU. Use merged geometry, instancing, pooled particles, a fixed light
  count (no shader recompiles at runtime), lazy spawning of crime scenes, and cheap fake lighting
  (additive glow sprites, light-pool decals, environment-map reflections) instead of lots of real lights.
- Mouse + keyboard (pointer lock). Clean module structure; shared state via one `G` object.

---

## 3. The world — Mega-City One

A dense, vertical, rainy megalopolis on a grid (~1.4 km across), enclosed by the **City Wall**.

- **Streets:** wet asphalt with lane markings, crosswalks and puddles that reflect neon. Sidewalks, curbs,
  streetlamps with glow halos and light pools, steam vents, dumpsters, crates, barrels.
- **Architecture:** megablock towers with setbacks, spires and blinking aircraft-warning lights; mid-rise
  blocks; parks and plazas; skybridges over the streets; lit windows in several facade styles.
  A huge outer skyline fades into fog beyond the wall.
- **Landmark:** the **Hall of Justice** at the centre of the city (giant golden eagle) — spawn / respawn point.
- **Districts:** named zones (Hall of Justice, Sektor 9 Financial, Grud Park, Slo-Mo Alley, Chinatown-style
  Neon Row, Industrial Zone, Block-War Heights …) shown on the HUD as you enter them.
- **Atmosphere:** rain streaks, fog, purple-orange smog sky, distant lightning with thunder, flying traffic
  streaming between towers, ground traffic on the roads, civilians on the sidewalks who panic at gunfire.
  Giant neon signs and billboards (JUSTICE, SLURP, GRUD, OZ …) baked into a canvas atlas.
- **Post-processing:** HDR bloom, filmic tone-mapping, vignette, film grain, chromatic aberration that spikes
  on damage and boost.

---

## 4. Judge Dredd (the player)

Procedurally modelled, fully rigged humanoid (hierarchy of joints, no skinned mesh needed):

- Iconic silhouette: gunmetal-black armour, huge golden shoulder pauldrons (left one carries the **eagle**),
  gold knee pads, utility belt with eagle buckle, tall boots, **helmet with the T-visor and the grim,
  permanently-scowling chin**. Never shows his eyes.
- Carries the **Lawgiver** in his right hand (glowing ammo display) and the **daystick** in his left.
- Procedural animation system: idle/breathing, walk, sprint, aiming, dodge-roll, hit-reactions,
  keyframed melee clips with blending, a seated riding pose.
- Health + armour, regeneration out of combat, ranks that grant stat bonuses.

### Controls

| Input | On foot | On the Lawmaster |
|---|---|---|
| `WASD` | move | throttle / brake / steer |
| `Shift` | sprint | **boost** (flame trail, FOV kick) |
| `Space` | dodge-roll | handbrake / drift |
| Mouse | camera | camera |
| `LMB` | daystick combo (free-flow) / **fire** when aiming | fire Lawgiver |
| `RMB` (hold) | aim Lawgiver (over-the-shoulder zoom) | aim |
| `F` | **counter** an attack (when the red warning flashes) | — |
| `1`–`6` / wheel | select Lawgiver ammo | same |
| `E` | mount bike / **judge** a perp / defuse bomb / pick up | dismount |
| `B` | call the Lawmaster | — |
| `G` | — | **autopilot** to the tracked crime |
| `H` | — | siren on/off |
| `Tab` | cycle tracked crime | cycle tracked crime |
| `Q` | snap-shot at nearest perp | snap-shot |
| `M` | full city map | |
| `P` / `Esc` | pause | |

---

## 5. The Lawmaster

Detailed procedural bike: long fairing, big wheels, eagle emblem plates, twin headlights (a real spotlight),
tail-lights, glowing engine, red/blue siren bar. Arcade physics with weight: acceleration, steering that
tightens with speed, **drifting** with tyre smoke and sparks, **boost** with exhaust flames and speed lines,
lean angle, suspension bob, collisions with buildings and traffic (damage, sparks, camera shake),
engine sound that follows speed. **Autopilot** drives the road grid to the tracked crime so you can
watch the city roll by. You can **shoot from the saddle**.

---

## 6. Lawgiver — six ammunition types

Voice-activated, each type with its own tracer colour, muzzle flash, impact FX, sound and behaviour.
Standard is unlimited; the rest are limited and dropped by perps / ammo crates.

| # | Ammo | Behaviour |
|---|---|---|
| 1 | **Standard Execute** | Fast, accurate, rapid fire (hold to spray). |
| 2 | **Armour-Piercing** | Slow fire, heavy damage, **pierces** enemies and thin cover, ignores armour. |
| 3 | **Ricochet** | Bounces off walls and the ground up to 4 times, retaining damage. Shoot around corners. |
| 4 | **Hi-Ex** | Explosive round — area damage, knock-back, shockwave, debris, camera shake. |
| 5 | **Incendiary** | Bursts into flames; leaves a burning patch that deals damage over time and panics enemies. |
| 6 | **Heat-Seeker** | Slow-curving missile that **homes in** on the nearest perp. |

Aiming: over-the-shoulder camera, dynamic crosshair, hit-markers, headshot bonus, light aim-assist.

---

## 7. Free-flow daystick combat (Arkham-style)

- `LMB` towards an enemy: Dredd **dashes** to the nearest target in the stick direction and strikes.
  Chain attacks flow from enemy to enemy with no hard lock-on.
- Different attacks: slashes, backhand, overhead smash, thrust, kick, gun-butt, spin — varied, keyframed
  animations with **baton trails**, impact flashes, **hit-stop**, screen shake and knock-back.
- Enemies surround you but only **a couple attack at once**. An attacker **flashes red** a split second
  before striking → press `F` to **counter** (brutal counter-animation, bonus score).
- `Space` dodge-roll with i-frames.
- **Combo meter** with multipliers; at high combo Dredd unleashes a cinematic **Judgement Finisher**
  (slow-motion, camera push-in, shockwave).
- Daystick damage never kills — it **subdues**. Bullets can kill. Perps at low health may **surrender**.
  Shooting a surrendered/unarmed perp is excessive force and costs Street Cred.
- Enemy types: thugs, gunmen, brutes (heavy, shielded — need AP/Hi-Ex), Slo-Mo junkies (fast, erratic),
  hostile bikers, the occasional boss.

---

## 8. Crime response loop (the heart of the game)

1. **Dispatch** calls come in continuously: radio chatter text + beep, a **light-beam beacon** over the scene
   (visible across the city), HUD list with distance and time limit, minimap blips + edge arrows.
2. **Ride / run** to the scene. Unanswered crimes expire, worsen and raise the city **Crime Level**.
3. **Fight** the perps (guns + daystick). Rescue hostages, defuse bombs, chase down speeding bikers,
   douse arson, break up gang wars.
4. **Judge them.** Walk up to each subdued or surrendered perp → `E`. A **Judgement screen** opens:
   dossier (name, ID, priors), list of **crimes with statute numbers**, **aggravating / mitigating factors**,
   and the **sentence ladder**:
   `Fine → 30 days → 1 year → 2 years → 5 years → 10 years → 20 years → Life`
5. Every crime has a **guideline sentence**; factors shift it up or down (weapon used +1, resisted arrest +1,
   repeat offender +1, cooperated −1, first offence −1 …). Pick the right sentence for full
   **Street Cred**; one tier off is "Fair"; further is a **Miscarriage of Justice** and costs you.
6. A **Justice Department wagon** descends with a tractor beam and hauls the perps away. Case closed,
   report on the HUD, rank up.

### Crime catalogue (each with its own sentence)

| Crime | Guideline |
|---|---|
| Jaywalking / Littering | Fine |
| Illegal smoking, noise | 30 days |
| Vandalism & graffiti | 1 year |
| Hotdogging (reckless riding) | 1 year |
| Assault / brawling | 2 years |
| Mugging, armed robbery | 5 years |
| Slo-Mo dealing | 5 years |
| Illegal weapons possession | 5 years |
| Arson | 10 years |
| Hostage-taking | 10 years |
| Grand theft / gang war | 10 years |
| Kidnap | 20 years |
| Terrorism / bombing | Life |

---

## 9. HUD & UI

Diegetic-feeling, comic-noir: health/armour bars, **Lawgiver ammo wheel** with six coloured slots,
combo counter, dispatch list, **minimap** + fullscreen map, objective arrows, interaction prompts,
Street Cred / rank / crime-level meter, district banner, speedometer, damage vignette, judgement dialog,
case report, title screen, pause menu and controls help.

---

## 10. Audio

Procedural Web Audio only: distinct gunshots per ammo type, baton cracks with electric zap, explosions,
ricochet pings, footsteps, rain and city ambience, thunder, bike engine that follows speed, siren,
UI blips, radio squelch. Dynamic **synth soundtrack** (pulsing bass, drums, pads) that intensifies in combat.
Optional speech synthesis for Dredd one-liners (*"I am the law."*).

---

## 11. Acceptance criteria

- Loads from a static server with no network access and no console errors.
- You can start, ride across the whole city, accept a call, win a fight using all six ammo types and the
  daystick, judge every perp, and watch the wagon take them away.
- It *looks* great: wet neon streets, bloom, rain, fog, flying traffic, readable silhouettes, punchy FX.
- It *feels* great: responsive controls, weighty hits, readable telegraphs, satisfying counters and finishers.
