# sat-golf

Browser golf on real courses: hole geometry from OpenStreetMap, drawn top-down over live Esri satellite imagery.
v1 is one hole, The Country Club (Brookline, MA), Main #17, with local hot-seat play for 1–4 players.

Design docs and the decision log are in [`docs/`](docs/README.md).

## Run

Node was installed user-locally at `~/.local/node` (no sudo). Put it on your PATH:

```sh
export PATH="$HOME/.local/node/bin:$PATH"   # add to ~/.bashrc to keep it
npm install
npm run dev        # http://localhost:5173
```

## Controls

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
| `npm run course` | Rebuild `public/courses/tcc-main-17.json` from cached OSM data (`data/raw/`). Add `-- --refresh` to re-query Overpass. Other holes: `-- --course <way id> --hole <ref> --links <name> --out <file>` |
| `npm test` | Unit tests (geo, surfaces, shot physics, rules, the built course file) |
| `npm run typecheck` | TypeScript |
| `npm run build` | Typecheck + production build to `dist/` |

## Layout

```
scripts/build-course.ts   offline pipeline: Overpass → OSM JSON → course.json
src/course/               shared (offline + runtime): local frame, OSM → course model
src/game/                 surface grid, terrain interface, clubs, shot physics, turn/score rules
src/render/               Esri tile stitching, class-render texture, Three.js scene
src/main.ts               input, HUD, game loop
```

Attribution: imagery © Esri and its partners (streamed live, not stored); course data © OpenStreetMap contributors (ODbL).
