# JUDGE DREDD: MEGA-CITY ONE

An open-world, third-person action game built with **Three.js** — and *nothing else*. Every model, texture,
particle, sound effect and music note is generated procedurally in code. No asset files.

> *"I am the law."*

You are **Judge Dredd**. Respond to crime across a rain-soaked, neon-drenched Mega-City One on your
**Lawmaster** bike. Take perps down with your **Lawgiver** (six ammo types) and your **daystick**
(free-flow combat), then **judge and sentence** every one of them — different crimes carry different sentences.

The design brief this game was built from is in [`PROMPT.md`](PROMPT.md).

## Run it

It is a static site — any file server works (Three.js is vendored in `vendor/`, no internet or build step needed):

```bash
python3 -m http.server 8000      # or: npx serve .
# open http://localhost:8000
```

Use a desktop browser with WebGL2 (Chrome / Edge / Firefox). Click **Enter the streets** — the mouse is captured.

## Controls

| Key | On foot | On the Lawmaster |
|---|---|---|
| `WASD` | move | throttle / brake / steer |
| `Shift` | sprint | boost |
| `Space` | dodge-roll (i-frames) | handbrake / drift |
| Mouse | camera | camera |
| `LMB` | daystick combo (free-flow) · fire when aiming | fire when aiming |
| `RMB` (hold) / `Z` (toggle) | aim the Lawgiver | aim |
| `R` | **hip-fire** the Lawgiver (aims for you, no `RMB` needed) | hip-fire |
| `F` | **counter** (when an attacker flashes red) | — |
| `Q` | snap-shot at the nearest perp | snap-shot |
| `1`–`6` / wheel | select Lawgiver ammo | same |
| `E` | judge a perp · mount bike · hold to defuse a bomb | dismount (when slow) |
| `B` | call the Lawmaster to you | — |
| `G` | — | autopilot to tracked crime |
| `H` | — | siren |
| `Tab` | cycle tracked crime | cycle tracked crime |
| `M` | city map | city map |
| `P` / `Esc` | pause | pause |
| `V` / `N` / `O` / `F3` | toggle voice · music · graphics quality · FPS counter | |

## The loop

1. **Dispatch** — calls come in constantly. A beacon marks each scene; the HUD, minimap and map track them.
2. **Ride** (`G` for autopilot) or run to the scene. Unanswered crimes expire and raise the **Crime Level**.
3. **Fight** — daystick combos dash from perp to perp; counter anything that flashes red (`F`); dodge with `Space`;
   build a combo to unleash the **Judgement finisher**. Daystick damage *subdues*; bullets can *kill*.
   Hitting someone who has surrendered is **excessive force**. Shooting civilians is worse.
4. **Judge** — walk up to a surrendered/subdued perp, press `E`. Read the dossier: every crime has a guideline
   sentence, and each circumstance (resisted arrest, repeat offender, armed, first offence, cooperated…) shifts
   it up or down one step. Pick the right one on the ladder for full Street Cred.
5. A Justice Department **wagon** tractor-beams the perp away. Case closed, rank up.

### Lawgiver ammunition

| # | Ammo | Notes |
|---|---|---|
| 1 | Standard Execute | unlimited, rapid fire |
| 2 | Armour-Piercing | heavy damage, pierces enemies, armour and thin cover |
| 3 | Ricochet | bounces up to four times off walls / ground |
| 4 | Hi-Ex | explosive area damage and knock-back |
| 5 | Incendiary | leaves a burning patch (damage over time) |
| 6 | Heat-Seeker | slow missile that homes in on perps |

### Crimes and guideline sentences

Jaywalking / littering → *fine* · smoking → *30 days* · vandalism, hotdogging → *1 year* · assault → *2 years* ·
mugging, armed robbery, Slo-Mo dealing, illegal weapons → *5 years* · arson, hostage-taking, gang violence → *10 years* ·
kidnap → *20 years* · terrorism → *life*. rioting → *2 years* · attempted murder of a Judge → *20 years*.
Higher-tier scenarios (hostages, bombs, gang wars, snipers, Block Bosses) unlock as your rank rises.

### Escalation, bonuses and perks

- **Rank scales the opposition** — perps get ~10% more health and ~7% more damage per rank.
- **Snipers** (*Sniper Nest*, rank 2+) shoot from 20 m+ away. A long laser-sight telegraph warns you — dodge it.
- **Backup** — Riots, Arms Deals, Gang Wars and Block Boss scenes call in a reinforcement wave once the first wave is down.
- **Bonuses** — *Clean Arrest* (no fatalities) and *Rapid Response* (arrive early) add Street Cred on top of the case bonus.
- **Rank perks** — Street Judge: ammo pickups +50% · Senior: fast armour recharge · Marshal: counters heal 10 ·
  Chief Candidate: finisher charges at 6 combo · Living Legend: Lawmaster boost +20%.
- A red arc around the crosshair points toward whoever just hit you.

## Code map

| File | What it does |
|---|---|
| `js/main.js` | renderer, quality tiers, render loop (mirror pass → shadow → main → post), cinematic title camera, game flow |
| `js/world.js` | procedural city: roads, megablocks, shopfronts, signs, rain, sky, district atmospheres, lightning, cables, searchlights, Hall of Justice (plaza seal, banners) |
| `js/facades.js`, `js/textures.js` | canvas-generated PBR building facades (albedo / emissive / roughness-metal / normal), wet asphalt, neon sign atlas |
| `js/shaders.js` | shader patches: height fog, wet walls, **interior-mapped lit windows**, road puddle ripples + **planar-reflection sampling**, fresnel rim light |
| `js/reflect.js` | planar ground reflections: the scene rendered again from a camera mirrored in the road plane |
| `js/post.js` | post stack: dual-filter bloom pyramid, anamorphic streaks, SSAO from depth, depth of field, filmic tone map, grade, grain |
| `js/streetprops.js`, `js/monorail.js`, `js/flyers.js`, `js/hallstatues.js` | street furniture, elevated monorail with lit trains, flying traffic, the gold Judge statues (the real hero model, cast in gold) |
| `js/character.js` | procedural humanoid rig (hips > torso > chest > neck > head, shoulder/elbow/wrist, hip/knee/ankle) |
| `js/animcore.js`, `js/animloco.js`, `js/animclips.js` | animation: IK locomotion with planted feet, secondary-motion springs, impulses and look-at, spline-interpolated clip library with directional variants |
| `js/charhero*.js`, `js/props.js` | Dredd: lofted anatomy, conformed armour, clear-coat suit, eagle and ribbed pauldrons; Lawgiver Mk II and daystick |
| `js/chargeneric*.js`, `js/propsperp.js`, `js/charkit.js` | perps and civilians: 43 looks, painted faces, shared texture sheets, per-instance seeded variation; weapons |
| `js/charskin.js` | **skinning**: merges a rig's static meshes into one SkinnedMesh per material (identity bind, pixel-equivalent) — characters and the Lawmaster |
| `js/lawmaster.js`, `js/carmodel.js`, `js/vehicle_*.js`, `js/bike.js`, `js/traffic.js` | the Lawmaster (sprung / steered / spinning rig, rider IK), eight car types, bike physics, traffic |
| `js/lod.js` | distance management for dynamic entities (far cars hidden, enemy shadow casting by distance) |
| `js/player.js` | Dredd controller: free-flow combat, counters, dodge, Lawgiver, camera, ranks and perks |
| `js/weapons.js` | the six Lawgiver ammo types, velocity-aligned projectile billboards, explosions, fire |
| `js/enemies.js` | perp AI (token-based surround, telegraphs, surrender), manager |
| `js/crimes.js` | dispatch, scenarios, backup waves, bombs, hostages, chases, wagon, sentencing rules |
| `js/ui.js` | HUD, minimap, map, judgement screen with mugshots |
| `js/fx.js` | fire/smoke/glow particles, streak sparks, electric arcs, lightning, decals, explosions, shockwaves, shake, hit-stop |
| `js/audio.js` | procedural SFX, engine, siren, rain, monorail rumble and synth soundtrack |
| `js/civs.js`, `js/pickups.js` | citizens, ammo and health pickups |

## Graphics

A physically-based pipeline in linear HDR: PMREM image-based lighting from an imaginary lit skyline, shadowed sun, dynamic point lights that hop between
the lamps and neon nearest to you, height fog, and **planar reflections on the wet roads** (neon, windows, lamps, the Hall and the sky mirror in the
asphalt, blurred by roughness). Lit windows are **interior-mapped rooms** with parallax. Each of the nine districts has its own sky, fog and grade, blended
as you cross the city. Post-processing: soft multi-scale bloom with anamorphic streaks, ambient occlusion, depth of field on cinematic moments, a filmic tone
map that keeps neon saturated, grade, speed blur, shock-wave distortion and chromatic aberration. `O` cycles quality (LOW / MEDIUM / HIGH): LOW drops
reflections, shadows and bloom; MEDIUM drops the streaks and halves the AO. The game auto-lowers it if the frame rate collapses, and caps the internal
resolution per tier so a 4K window does not push 8 M pixels through the heavy passes. `F3` shows an FPS counter.

## Performance notes

The expensive part of a browser frame is draw calls, and a character or vehicle is drawn up to three times (sun shadow map, mirrored ground pass, main pass).
Everything that moves is therefore **skinned**: each rig's static meshes are merged into one `SkinnedMesh` per material, driven by the rig's own joint groups
(`js/charskin.js`). Dredd drops from 73 draw calls per pass to 12, a perp from ~25 to 3-5, the Lawmaster from ~70 to ~25. Far traffic is hidden (fog already hides it),
enemies only cast shadows when close, and the mirror pass only draws nearby dynamic entities. Typical frame (HIGH, all three passes): ~330-570 draw calls, 2.4-2.7 M triangles;
the same scenes were 900-1200 draw calls before. `?noskin` on the page URL turns skinning off for A/B comparisons.

## Developer tools (`tools/`)

All of them drive headless Chromium (software GL is fine) against a static server (`python3 -m http.server 8000`) and need Playwright.

| Tool | Use |
|---|---|
| `shots.mjs` | still frames at named vantage points (`--shots hall,street_neon,fight6,bike,title0 --size 1280x720 --hud --page`); `--eval` runs JS in the page, `--chunk` / `--quality` for experiments |
| `studio.mjs` | character contact sheets: turntables, clip strips (`--pose frames:slashR:8`), walk cycles (`--cycle walk:3.2:8`); `--seed` fixes a perp's look |
| `perpstudio.mjs`, `vstudio.mjs` | one perp look / the vehicles under studio lighting |
| `anim-check.mjs` | numeric animation checks: foot slide, sole contact, knee limits, NaNs, update cost |
| `passprofile.mjs`, `drawprofile.mjs` | draw calls and triangles attributed per pass (shadow / mirror / main) and per object kind |
| `soak.mjs`, `ridesoak.mjs`, `bot.mjs` | 9,000 frames of random input over every scenario; a ride soak; a bot that plays fight → judge → wagon |
| `build-single.mjs`, `make-artifact.mjs` | bundle the whole game into one self-contained HTML file / a page body for publishing |
