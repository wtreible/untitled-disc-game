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
| [08-level-editor-and-disc-golf](08-level-editor-and-disc-golf.md) | Park-to-course editor, disc golf variant (future) |
| [09-glossary](09-glossary.md) | Terms used across these docs |
| [10-disc-golf](10-disc-golf.md) | Disc golf mode: Tali course, tree data, flight model, collisions, first-person putting |

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
| D18 | No wind in v1. | 2026-10-19 |
| D19 | Out of bounds: casual drop near where the ball left the course, +1 stroke (not stroke and distance). | 2026-10-19 |
| D20 | **Disc golf is the default mode**; golf stays selectable. Course: Tali, Helsinki (best-mapped famous course with open tree data). | 2026-10-19 |
| D21 | Trees for disc golf: individual trees planted inside HSY 2024 canopy polygons, trunk-free fairway lanes; trunk + crown + basket collisions. | 2026-10-19 |
| D22 | First-person 3D putting inside 20 m; C toggles first person anywhere. | 2026-10-19 |
| D23 | Disc golf plays full rounds (18 / front 9 / back 9 / single hole) with a scorecard and honors. | 2026-10-19 |

## Open questions

- **Tali pars:** not in OSM; estimated from length. Real pars would need the course's own card (or tagging OSM).
- **HSY license:** HSY datasets on HRI are CC BY 4.0; this dataset's own page wasn't found. Attributed regardless.
- **Synthetic trunks:** canopy is real, trunk positions aren't. A lidar canopy height model would fix that.

- **Sentinel-2:** proposed as a derivation source, but at 10 m/px it can't resolve hole-scale features. Currently recorded as *evaluated, rejected*. Reopen if there's a use for it (e.g., coarse park-scale tree/water masks).
- **Famous-hole identity:** OSM's Main #17 uses the member routing. Championship (composite) routings at TCC renumber holes, so "the famous 17th" should be checked against the club's own routing before we label it that way.
