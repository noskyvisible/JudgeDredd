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
kidnap → *20 years* · terrorism → *life*. Higher-tier scenarios (hostages, bombs, gang wars, Block Bosses) unlock as your rank rises.

## Code map

| File | What it does |
|---|---|
| `js/world.js` | procedural city: roads, megablocks, shopfronts, signs, rain, sky, lightning, flyers, cables, searchlights, Hall of Justice |
| `js/facades.js`, `js/textures.js` | canvas-generated PBR building facades (albedo / emissive / roughness-metal / normal), wet asphalt, neon sign atlas |
| `js/shaders.js` | shader patches: wall wetness, road puddle ripples, height fog, fresnel rim light |
| `js/holo.js` | flickering holographic adverts above intersections |
| `js/character.js` | procedural humanoid rig + keyframed animation clips (Dredd, perps, civilians) |
| `js/charmodel.js` | the character bodies — Dredd's hero kit (red visor, gold eagle/ribbed pauldrons, green gear) and perp types |
| `js/lawmaster.js`, `js/carmodel.js` | the Lawmaster motorcycle + seated-rider IK; sedans, taxis, coupes and box trucks |
| `js/player.js` | Dredd controller: free-flow combat, counters, dodge, Lawgiver, camera, ranks |
| `js/bike.js` | Lawmaster physics, boost/drift, autopilot, hostile bikers |
| `js/weapons.js` | the six Lawgiver ammo types, projectiles, explosions, fire |
| `js/enemies.js` | perp AI (token-based surround, telegraphs, surrender), manager |
| `js/crimes.js` | dispatch, scenarios, bombs, hostages, chases, wagon, sentencing rules |
| `js/ui.js` | HUD, minimap, map, judgement screen |
| `js/fx.js` | fire/smoke/glow particles, streak sparks, electric arcs, lightning, bullet-hole & scorch decals, explosions, shockwaves, shake, hit-stop |
| `js/audio.js` | procedural SFX, engine, siren, rain and synth soundtrack |
| `js/civs.js`, `js/traffic.js`, `js/pickups.js` | citizens, road traffic, ammo & health pickups |

## Graphics

Rendered with a physically-based pipeline: PMREM image-based lighting from an imaginary lit skyline, shadowed sun,
dynamic point lights that hop between the lamps and neon nearest to you, height fog, wet roads with animated puddle ripples
and reflection smears, volumetric lamp / headlight cones, searchlights and holograms. Post-processing: gentle bloom, colour grade,
sharpen, speed blur, shock-wave distortion and chromatic aberration. `O` cycles quality (LOW / MEDIUM / HIGH) and the game
auto-lowers it if the frame rate collapses; `F3` shows an FPS counter.
