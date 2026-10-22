# sat-golf docs

A browser golf game played on real courses: course geometry from OpenStreetMap, drawn top-down over live satellite imagery.

| Doc | What it covers |
|---|---|
| [01-vision-and-scope](01-vision-and-scope.md) | Intent, audience, v1 scope, roadmap |
| [02-architecture](02-architecture.md) | Stack, coordinate frame, 3D-ready world model, renderers |
| [03-data-sources](03-data-sources.md) | OSM, Esri, NAIP, Sentinel-2, licensing |
| [04-course-model](04-course-model.md) | Surface classes, OSM tag mapping, hole structure, the v1 hole |
| [05-gameplay](05-gameplay.md) | Clubs, shot model, surfaces, trees, scoring |
| [06-segmentation](06-segmentation.md) | Three segmentation approaches (future; not needed for v1) |
| [07-elevation-lidar](07-elevation-lidar.md) | Lidar / DEM terrain (future) |
| [08-level-editor-and-disc-golf](08-level-editor-and-disc-golf.md) | Park-to-course editor, the planned hole editor for sharing holes, disc golf variant (future) |
| [09-glossary](09-glossary.md) | Terms used across these docs |
| [10-disc-golf](10-disc-golf.md) | Disc golf mode: Tali course, tree data, flight model, collisions, first-person putting |
| [11-roguelike](11-roguelike.md) | Roguelike run mode: draft rules, augment kinds (self / your course / hex), full list |
| [12-mini-golf-madness](12-mini-golf-madness.md) | Themed 9-hole course with Kenney CC0 models: windmill, castle, animals; prop colliders |
| [13-fantasy-and-rainbow](13-fantasy-and-rainbow.md) | Arcade courses Fantasy Fairways (knight, castle, dragon) and Rainbow Runs (rainbow road in space); FBX, decals, stars |
| [14-online](14-online.md) | Online play: event-log rounds, the Cloudflare Durable Object room, lobby, rejoining, free tier |
| [15-pirates-cove-and-oak-grove](15-pirates-cove-and-oak-grove.md) | Arcade course Pirate's Cove (islands; the sea as a water hazard) and real course Oak Grove (Stockton, CA; trees from OpenStreetMap) |

## Decision log

| # | Decision | Date |
|---|---|---|
| D1 | Segmentation is not the point; OSM vectors are the source of truth for course geometry. | 2026-10-19 |
| D2 | Audience is the author and friends; solo hobby project. | 2026-10-19 |
| D3 | v1 = one hand-picked hole: The Country Club (Brookline, MA), Main course, hole 17, par 4. | 2026-10-19 |
| D4 | Display imagery: Esri World Imagery streamed live, not bundled. NAIP only for derivation/segmentation. | 2026-10-19 |
| D5 | Renderer: Three.js with an orthographic top-down camera; 3D-ready world model. | 2026-10-19 |
| D6 | Optional "class render" mode that redraws the hole from surface classes instead of the photo. | 2026-10-19 |
| D7 | Language: TypeScript + Vite. Pipeline: TS for vector/course logic (shared with runtime); Python later for raster jobs only. | 2026-10-19 |
| D8 | Coordinates: per-hole local tangent frame in meters. | 2026-10-19 |
| D9 | Flat terrain in v1 via `heightAt(x, y) = 0`; lidar later. | 2026-10-19 |
| D10 | Shot input: choose club, aim, set power. Simple shot model. | 2026-10-19 |
| D11 | Trees: block balls below canopy height (option B in 05-gameplay). | 2026-10-19 |
| D12 | Real par, stroke play. One tee per hole in v1. | 2026-10-19 |
| D13 | Segmentation/mapping errors are acceptable in v1. | 2026-10-19 |
| D14 | Future park-to-course: level editor with algorithm-suggested starting holes. | 2026-10-19 |
| D15 | Own physics code; no physics library. | 2026-10-19 |
| D16 | Multiplayer: local hot-seat (players take turns on one device). | 2026-10-19 |
| D17 | Hosting: localhost only for now (`npm run dev`). | 2026-10-19 |
| D18 | No wind in v1. (Superseded by D49.) | 2026-10-19 |
| D19 | Out of bounds: casual drop near where the ball left the course, +1 stroke (not stroke and distance). | 2026-10-19 |
| D20 | **Disc golf is the default mode**; golf stays selectable. Course: Tali, Helsinki (best-mapped famous course with open tree data). | 2026-10-19 |
| D21 | Trees for disc golf: individual trees planted inside HSY 2024 canopy polygons, trunk-free fairway lanes; trunk + crown + basket collisions. | 2026-10-19 |
| D22 | First-person 3D putting inside 20 m; C toggles first person anywhere. | 2026-10-19 |
| D23 | Disc golf plays full rounds (18 / front 9 / back 9 / single hole) with a scorecard and honors. | 2026-10-19 |
| D24 | **Default course: Tali (simple)**, a vector drawing of the real layout with 1–5 designed trees per hole and a defender at every basket. The satellite forest version stays selectable. | 2026-10-19 |
| D25 | Disc golf starts in first person; C toggles to the top-down map and the choice persists across turns. | 2026-10-19 |
| D26 | Branch density is per course (simple 0.9/m, forest 0.25/m). | 2026-10-19 |
| D27 | Turn and fade drive the bank toward limits from the flight numbers (fixes discs flipping upside down). | 2026-10-20 |
| D28 | First person gets a top-down minimap (click to aim), W/S target distance, scroll-wheel zoom. | 2026-10-20 |
| D29 | Roguelike is a **separate mode**: draft 1 of 3 powerups after each hole; tier 70/25/5; 5% center-card bump. Powerup list is a proposal under review. | 2026-10-20 |
| D30 | Roguelike runs are 18 holes; a starter augment (40/45/15) before hole 1; the ghost line is earned (starts hidden). | 2026-10-20 |
| D31 | Augments can change the course per player: "your course" ones only for the owner, hexes for everyone but the owner (placed before each hole). Each player throws against their own copy of the course. | 2026-10-20 |
| D32 | Flight model: stall past ~26° angle of attack; per-disc default launch, release speed and meter curve (fixes too-long flat launches, backward-drifting high launches, and first person launching drivers too high). | 2026-10-20 |
| D33 | Settings menu (⚙ / Esc) with metric (m) / imperial (ft for disc, yd for golf). | 2026-10-20 |
| D34 | Disc golf replays every throw from a disc-chasing camera (skip: Space/click; toggle in Settings). First-person zoom-out up to 105°. | 2026-10-20 |
| D35 | Common augments buffed ~50% (still below the epic version of the same effect). | 2026-10-20 |
| D36 | Replay camera is player-controlled: drag orbits, scroll zooms, R resets; only Space skips. | 2026-10-20 |
| D37 | New themed course "Mini Golf Madness": full-size disc golf, mini-golf theming via scaled-up Kenney CC0 models; prop colliders (incl. time-dependent windmill blades) precomputed at build time. | 2026-10-20 |

| D38 | Product name for now: **Untitled Disc Game**. Disc only on the menu (golf code kept). | 2026-10-20 |
| D39 | Roguelike is **Crazy mode**: a toggle that works on any course (plays the full course), not a separate menu item. | 2026-10-20 |
| D40 | Main menu redesign (logo, course cards, players, round, settings) and a pause menu with the same settings form; prefs: units, first person, replays, FOV, flight speed, hints. | 2026-10-20 |
| D41 | Broadcast-style graphics (after disc golf coverage like JomezPro): skewed result banner + name plate, event chips, hole bug, leaderboard, scorecard with birdie circles / bogey squares. | 2026-10-20 |
| D42 | Fewer spit-outs (soft chain hits rattle in; gentler fast-putt penalty) and less branch collision (densities 0.9→0.4 simple/silly, 0.25→0.11 forest). | 2026-10-20 |
| D43 | Two new arcade courses: **Fantasy Fairways** (medieval; knight, castle-courtyard basket, dragon on 9) and **Rainbow Runs** (rainbow road in space, off the road is OB; parody nods only). Models: Kenney Castle/Fantasy Town/Space kits, KayKit Adventurers, Quaternius Animated Monsters, all CC0. | 2026-10-20 |
| D44 | Main menu groups courses into **Real** (mapped: Tali, Tali Forest) and **Arcade** (themed: Mini Golf Madness, Fantasy Fairways, Rainbow Runs). | 2026-10-20 |
| D45 | Box colliders push the disc out through a face that isn't inside another collider (touching boxes trapped ~1 in 2,000 throws in mid-air). | 2026-10-20 |
| D46 | Course trees are branched CC0 models (Quaternius Stylized Nature MegaKit). Branch hits happen only inside their leaf clumps (×1.3 density, since the clumps are ~38% of the old crown volume); trunks follow the model. Big forests draw models near the eye only. | 2026-10-20 |
| D47 | Shippable static build: relative asset URLs (any folder), three.js in its own cached chunk, KayKit GLBs slimmed to their used clip (3.6 → 0.4 MB each). Esri imagery only in dev or with `VITE_ESRI_IMAGERY=on` (Esri MLA; public use generally needs an ArcGIS account). | 2026-10-20 |
| D48 | Settings → Graphics (Low / Medium default / High: pixel density and how many trees draw as models) and a frame-rate readout. Physics doesn't depend on it. | 2026-10-20 |
| D49 | Wind (supersedes D18 "no wind in v1"): a random wind per hole, up to 5 m/s, mostly calm or breezy. Aerodynamics use airspeed, so headwinds turn discs over and tailwinds make them drop. Shown in the hole banner with an arrow relative to the view. | 2026-10-20 |
| D50 | Disc picker at the bottom of the HUD with a flight chart per disc (from the physics, full-power flat, calm), replacing the ‹ › disc arrows. | 2026-10-20 |
| D51 | Tali (simple) becomes **Tali Recreation**, the easy version: the real version's HSY trees, thinned back 3 m from fairways and greens (and from tees); Tali Forest is the real version. Replaces D24's designed trees. | 2026-10-20 |
| D52 | The round is event-driven (`src/modes/discRound.ts`): hole starts (with wind), throws (with their computed flight), mulligans, drafts and placements are JSON events applied in order; replaying the log rebuilds the round. Groundwork for online play (a Cloudflare Durable Object room relaying events). | 2026-10-21 |
| D53 | Online play: one Cloudflare Durable Object per room (free plan) stores the lobby and event log and relays events; browsers run the game. The round's `stage` decides who acts next; a stale event is rejected and that browser rejoins. Hot seat is the case where every player is local. | 2026-10-21 |
| D54 | Online: throws are sent at release (applied on landing everywhere), and the thrower's aim, disc, release angle and meter stream live to watchers (relayed, not stored). | 2026-10-21 |
| D55 | Tree LOD stops popping: model ↔ stand-in switches dissolve (dither, 0.45 s), the eye zone has hysteresis, and following a throw locks the models to its flight-path corridor. | 2026-10-21 |
| D56 | Augments: values +20–30%, 8 new (wind-themed and more), categories, legendaries visible on the course, Magnet Basket legendary. Drafts customizable (cards, picks, frequency, starter, tier odds) with one tier per draft for the whole group; side panel, browser and scorecard show augments. | 2026-10-21 |
| D57 | Three specialty discs: overstable driver, turnover fairway, approach. Suggestions stay with the everyday four. | 2026-10-21 |
| D58 | Online: a name prompt before hosting or joining, renaming in the lobby, 2-digit suffixes for repeated names, up to 6 players. Crazy mode can play any hole selection; short-round blocks (1–3 / 4–6 / 7–9, or 6s on 18-hole courses). | 2026-10-21 |
| D59 | Online seats survive drops: a minute's grace in the lobby; mid-game the host can play for a disconnected player until they're back. Friends' throws are followed live with the chase camera; Up next strip on the leaderboard. | 2026-10-21 |
| D60 | Final card round summary (longest throw and longest make with Watch replays, tree magnet, aces, clean card), from the event log. | 2026-10-21 |
| D61 | Throw styles: tomahawk / thumber (overhand, over trees) and roller (on edge, under them). | 2026-10-21 |
| D62 | Optional bag building: 4 of 7 discs per player for the round; Bag Pocket augment adds a slot. | 2026-10-21 |
| D63 | Moving hazards (drawbridge, sweeping ring) as `hinge` and `slide` colliders; throws carry the game clock so moving props match on every screen. Hole editor recorded as planned work (08). | 2026-10-21 |
| D64 | Feet are the default units (Feet listed before Meters). An armed Perfect Form throw shows its whole ghost line. Main menu in three columns: courses and Tee off · course card and round · players and settings. | 2026-10-21 |
| D65 | Sound: CC0 music per course (menu, park, mini golf, medieval, space), bird / space ambience with wind that follows the hole's wind, and throw sounds read off the flight samples (hits, landing by surface, chains, splash, OB), live with distance falloff and again in the replay. Music and Effects volume sliders. Credits in `public/audio/CREDITS.md`. | 2026-10-22 |
| D66 | Making the course feel lived in, all scenery (the flight model never sees it): a flyover down each hole before its first throw (Settings → Hole flyovers); spectators by the basket (Kenney Mini Characters) who step out of any throw's path before it arrives, watch the disc and react; birds, butterflies, cloud shadows, a wind streamer on the basket and trees swaying with the hole's wind; leaves, puffs, splashes, sparks and swinging chains on contact; weather and time of day per round (sunny, golden hour, overcast, rain), picked from the first hole's wind so a room shares it (Settings → Weather); color commentary lines after throws. | 2026-10-22 |
| D68 | Two more courses: **Pirate's Cove** (arcade; islands where off the land is the sea, a water hazard, via a course `sea` flag; Kenney Pirate Kit, CC0) and **Oak Grove** Gold Course, Stockton CA (real; the first mapped course outside Helsinki, so its trees come from OpenStreetMap: mapped trees where they stand, woods planted like canopy). The course builder takes courses mapped as a relation of holes. | 2026-10-22 |
| D67 | Quality of life: N mutes (and a speaker button), ? lists the controls, the camera glides to the next lie instead of cutting, holding Shift fast-forwards flights and replays 3×. | 2026-10-22 |

## Open questions

- **Tali pars:** not in OSM; estimated from length. Real pars would need the course's own card (or tagging OSM).
- **HSY license:** HSY datasets on HRI are CC BY 4.0; this dataset's own page wasn't found. Attributed regardless.
- **Synthetic trunks:** canopy is real, trunk positions aren't. A lidar canopy height model would fix that.

- **Sentinel-2:** proposed as a derivation source, but at 10 m/px it can't resolve hole-scale features. Currently recorded as *evaluated, rejected*. Reopen if there's a use for it (e.g., coarse park-scale tree/water masks).
- **Famous-hole identity:** OSM's Main #17 uses the member routing. Championship (composite) routings at TCC renumber holes, so "the famous 17th" should be checked against the club's own routing before we label it that way.
