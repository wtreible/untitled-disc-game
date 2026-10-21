# Untitled Disc Game

*(repo: sat-golf)*

Browser golf on real courses: geometry from OpenStreetMap, drawn over live Esri satellite imagery, local hot-seat for 1–4 players.

- **Disc golf: Tali Recreation, default.** The real Tali (Helsinki) layout and its real trees (HSY canopy) drawn as a clean vector course, with the woods cut back a few meters from every fairway, green and tee: the easy version. Starts in first person; the top-down map (C) shows the same trees.
- **Crazy mode** (a switch on the main menu, any course): draft augments after every hole: earn your ghost line, hex your friends' course. See [docs/11-roguelike.md](docs/11-roguelike.md).
- **Disc golf: Mini Golf Madness.** A 9-hole full-size course themed like mini golf: thread a giant windmill's tunnel past spinning blades, throw through a castle gate, dodge giant animals, mushrooms and golf balls. See [docs/12-mini-golf-madness.md](docs/12-mini-golf-madness.md).
- **Disc golf: Fantasy Fairways.** Medieval: a giant knight on The Joust, a basket inside a castle courtyard, and a dragon over the last basket.
- **Disc golf: Rainbow Runs.** A rainbow road in space where off the road is OB: mystery boxes, rings, asteroids, a gap to jump. See [docs/13-fantasy-and-rainbow.md](docs/13-fantasy-and-rainbow.md).
- **Disc golf: Tali Forest.** The real version: the same holes and ~10.5k trees with nothing cut back, over satellite imagery (dev builds) or its drawn ground.
- Both: trunk/branch/chain collisions, full rounds with scorecard. See [docs/10-disc-golf.md](docs/10-disc-golf.md).
- Golf (The Country Club #17) is still in the code (`src/modes/golf.ts`) but off the menu: disc only for now.

Design docs and the decision log are in [`docs/`](docs/README.md).

## Run

Node was installed user-locally at `~/.local/node` (no sudo). Put it on your PATH:

```sh
export PATH="$HOME/.local/node/bin:$PATH"   # add to ~/.bashrc to keep it
npm install
npm run dev        # http://localhost:5173
```

## Deploy

`npm run build` writes a static site to `dist/` (about 13 MB, mostly models; each course loads only its own). Asset URLs are relative, so `dist/` works from any folder: a GitHub Pages project page, a Netlify or Cloudflare Pages site, or any static file server.

- **Satellite imagery is off in public builds.** Esri World Imagery is licensed under Esri's Master License Agreement, which generally needs an ArcGIS account for public apps. Tali Forest shows its drawn surface classes instead. Once that's sorted, build with `VITE_ESRI_IMAGERY=on npm run build`. Dev builds always use it.
- **Animated characters are slimmed** to the clips the courses use (`npm run slim-models`, after building courses). To use another KayKit clip, re-copy the original GLB first.

## Controls: disc golf

| Action | Input |
|---|---|
| Aim (top-down) | Click / drag on the map; ←/→ to nudge (Shift for fine) |
| Aim (first person) | Drag, or arrows; ↑/↓ sets launch angle; W/S target distance (Shift: 5 m); click the minimap to aim there; scroll to zoom (out to 105°) |
| Disc | `[` / `]` or the ‹ › buttons (distance driver, fairway, midrange, putter) |
| Release angle | Q (more hyzer, curves left) / E (more anhyzer, curves right), or click the release button |
| Forehand / backhand | T (mirrors the curve) |
| Throw | Hold Space, release at the power you want. The white tick reaches your target (putts: crosses the basket at chain height). The dashed ghost line is the error-free flight |
| First person / top-down | C. Starts in first person; inside 20 m it's always first person unless you press C |
| Pan / zoom / view / re-frame | Right-drag / scroll / V / F |
| Roguelike | M: mulligan (if owned, right after a throw lands); P: arm Perfect Form; before a hole, click the map to place hexes / clear-cuts |
| Replay | After each throw: drag to orbit around the disc, scroll to zoom, R resets the view, Space skips |
| Settings | ⚙ button or Esc: metric / imperial units, replays on/off, quit to menu |

## Controls: golf

| Action | Input |
|---|---|
| Aim | Click / drag on the map; ←/→ to nudge (Shift for fine) |
| Club | `[` / `]` or ↓/↑, or the ‹ › buttons |
| Swing | Hold Space (or the Swing button), release at the power you want. The white tick marks the power that reaches your aim point |
| Pan / zoom | Right- or middle-drag / scroll |
| View | V cycles photo → photo + classes → classes |
| Re-frame | F |

## Scripts

| Command | What it does |
|---|---|
| `npm run disc-course -- --style simple --out tali-simple` | Rebuild Tali Recreation (uses the HSY canopy, like the forest) |
| `npm run disc-course` | Rebuild `public/courses/tali.json` from OSM + HSY canopy (cached in `data/raw/`; HSY files are git-ignored and re-downloaded when missing). `-- --course <way id> --out <name>` for another course; `-- --no-hsy` outside Helsinki (no trees) |
| `npm run silly-course` | Rebuild `public/courses/silly.json` (Mini Golf Madness) |
| `npm run fantasy-course` | Rebuild `public/courses/fantasy.json` (Fantasy Fairways) |
| `npm run rainbow-course` | Rebuild `public/courses/rainbow.json` (Rainbow Runs) |
| `npm run tree-shapes` | Re-measure the tree models' trunks and leaf volumes into `src/disc/treeShapes.data.ts` |
| `npm run course` | Rebuild `public/courses/tcc-main-17.json` from cached OSM data (`data/raw/`). Add `-- --refresh` to re-query Overpass. Other holes: `-- --course <way id> --hole <ref> --links <name> --out <file>` |
| `npm test` | Unit tests (geo, surfaces, shot physics, rules, the built course file) |
| `npm run typecheck` | TypeScript |
| `npm run build` | Typecheck + production build to `dist/` |

## Layout

```
scripts/build-course.ts       golf pipeline: Overpass → course.json
scripts/build-disc-course.ts  disc pipeline: Overpass + HSY canopy → tali.json
src/course/                   shared (offline + runtime): local frame, OSM → course models, tree planting
src/game/                     surface grid, terrain interface, clubs, golf physics, turn/score rules, rounds
src/disc/                     discs, flight model + collisions, tree spatial index
src/render/                   Esri tiles, class texture, golf HoleScene, disc CourseScene (top-down + first person), 3D models
src/modes/                    golf.ts / disc.ts controllers (input, HUD, loop)
src/main.ts                   setup screen → mode
```

Attribution: imagery © Esri and its partners (streamed live, not stored); course data © OpenStreetMap contributors (ODbL); tree canopy © HSY land cover 2024; 3D models (all CC0) by Kenney (kenney.nl), Kay Lousberg (KayKit Adventurers) and Quaternius (Animated Monsters, Stylized Nature MegaKit trees).
