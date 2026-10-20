# sat-golf

Browser golf on real courses: geometry from OpenStreetMap, drawn over live Esri satellite imagery, local hot-seat for 1–4 players.

- **Disc golf: Tali (simple), default.** The real Tali (Helsinki) layout drawn as a clean vector course with 1–5 trees per hole and a defender guarding every basket. Starts in first person; the top-down map (C) shows the same trees.
- **Disc golf: Roguelike run.** 18 holes on the simple course: a starter augment, then a draft after every hole (common / epic / legendary). Earn your ghost line; hex your friends' course. See [docs/11-roguelike.md](docs/11-roguelike.md).
- **Disc golf: Mini Golf Madness.** A 9-hole full-size course themed like mini golf: thread a giant windmill's tunnel past spinning blades, throw through a castle gate, dodge giant animals, mushrooms and golf balls. See [docs/12-mini-golf-madness.md](docs/12-mini-golf-madness.md).
- **Disc golf: Tali (forest).** The same holes over satellite imagery with ~10k trees from HSY canopy data.
- Both: trunk/branch/chain collisions, full rounds with scorecard. See [docs/10-disc-golf.md](docs/10-disc-golf.md).
- **Golf:** The Country Club (Brookline, MA), Main #17.

Design docs and the decision log are in [`docs/`](docs/README.md).

## Run

Node was installed user-locally at `~/.local/node` (no sudo). Put it on your PATH:

```sh
export PATH="$HOME/.local/node/bin:$PATH"   # add to ~/.bashrc to keep it
npm install
npm run dev        # http://localhost:5173
```

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
| `npm run disc-course -- --style simple --out tali-simple` | Rebuild the simple course (no HSY needed) |
| `npm run disc-course` | Rebuild `public/courses/tali.json` from OSM + HSY canopy (cached in `data/raw/`; HSY files are git-ignored and re-downloaded when missing). `-- --course <way id> --out <name>` for another course; `-- --no-hsy` outside Helsinki (no trees) |
| `npm run silly-course` | Rebuild `public/courses/silly.json` (Mini Golf Madness) |
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

Attribution: imagery © Esri and its partners (streamed live, not stored); course data © OpenStreetMap contributors (ODbL); tree canopy © HSY land cover 2024; 3D models by Kenney (kenney.nl), CC0.
