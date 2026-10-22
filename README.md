# Untitled Disc Game

Disc golf in the browser, on real and not-so-real courses, for 1–6 players on one computer (hot seat) or online.

**Play:** https://wtreible.github.io/untitled-disc-game/

Real flight numbers (speed, glide, turn, fade) drive a physics flight model: discs turn and fade, stall when thrown nose-up, and catch the wind. You throw in first person or from a top-down map, then watch a chase-cam replay. Trees, chains, walls, windmills and dragons all collide.

## Courses

| Course | Holes | What it is |
|---|---|---|
| **Tali Recreation** | 18 | The real [Tali disc golf park](https://www.openstreetmap.org/way/40254405) (Helsinki) from OpenStreetMap, with its real trees from Helsinki's canopy data, cut back a few meters from every fairway, green and tee. The easy version. |
| **Tali Forest** | 18 | The real thing: the same holes and all ~10,500 trees. |
| **Mini Golf Madness** | 9 | Full-size disc golf themed like mini golf: a windmill with spinning blades, a castle gate, giant animals. |
| **Fantasy Fairways** | 9 | Medieval: a giant knight, a basket inside a castle courtyard, a dragon on the last hole. |
| **Rainbow Runs** | 9 | A rainbow road floating in space. Off the road is OB. Mystery boxes, rings, asteroids, a gap to jump. |

**Play online:** host a room from the Players panel and send friends the link; everyone plays from their own browser. See [docs/14-online.md](docs/14-online.md).

**Crazy mode** (a switch on the main menu, any course and any holes): draft an augment after every hole. Earn your ghost line, or hex your friends' course.

**Pick a bag** (also on the menu): everyone carries 4 of the 7 discs for the round.

## How to play

| | |
|---|---|
| Aim | First person: drag or arrow keys (↑/↓ launch angle), W/S target distance, scroll to zoom, click the minimap. Top-down: click or drag on the map. |
| Disc | Click a card in the disc picker (its chart shows how that disc flies), or `[` / `]` |
| Release angle | Q (hyzer, curves left) / E (anhyzer, curves right) |
| Forehand / backhand | T |
| Shot | G (or the shot chip): normal, tomahawk / thumber (overhand, up over trees), roller (rolls on edge under them) |
| Throw | Hold Space, let go at the power you want. The white tick on the meter reaches your target; the dashed line is the flight if you throw it perfectly. |
| View | C: first person / top-down. In top-down: right-drag to pan, scroll to zoom, F to re-frame. |
| Replay | Drag to orbit, scroll to zoom, R resets, Space skips. Hold Shift to fast-forward any flight or replay. |
| Hole flyover | Space or click skips it (Settings → Hole flyovers) |
| Sound | N mutes; Music and Effects volumes in Settings |
| Help | ? lists every control |
| Menu | Esc or ⏸: settings (music and effects volume, units, replays, hole flyovers, weather, field of view, graphics quality, frame rate), scorecard, quit |

The wind for each hole is in the top-left banner; its arrow turns with your view. A headwind turns discs over, a tailwind makes them drop, a crosswind pushes them sideways.

## Run it locally

Needs [Node.js](https://nodejs.org) 20 or newer.

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run build      # static site in dist/
```

Dev builds stream Esri satellite imagery under Tali Forest; public builds don't (see below).

## Deploying (GitHub Pages)

Every push to `main` builds the game and publishes it to GitHub Pages (`.github/workflows/deploy.yml`). One-time setup: in the repo on GitHub, **Settings → Pages → Build and deployment → Source: GitHub Actions**.

The build is a static site with relative asset URLs, so `dist/` also works on Netlify, Cloudflare Pages, or any file server, from any folder.

- **Online rooms** run on a Cloudflare Worker (free plan): `npx wrangler login`, then `npm run server:deploy`. Put the `wss://…workers.dev` address it prints in a repo variable named `ROOMS_URL` (Settings → Secrets and variables → Actions → Variables) and re-run the deploy. Until then "Play online" is hidden.
- **Satellite imagery is off in public builds.** Esri World Imagery is licensed under Esri's Master License Agreement, which generally needs an ArcGIS account for public apps, so Tali Forest shows its drawn ground instead. If you have that sorted, build with `VITE_ESRI_IMAGERY=on`.

## Development

| Command | What it does |
|---|---|
| `npm run disc-course` | Rebuild Tali Forest (`public/courses/tali.json`) from OpenStreetMap + HSY canopy. Downloads are cached in `data/raw/`. `-- --course <way id> --out <name>` for another course. |
| `npm run disc-course -- --style simple --out tali-simple` | Rebuild Tali Recreation |
| `npm run silly-course` / `fantasy-course` / `rainbow-course` | Rebuild the themed courses |
| `npm run tree-shapes` | Re-measure the tree models' trunks and leaf volumes (collision shapes) |
| `npm run slim-models` | Strip animations the courses don't use from the character models |
| `npm run server:dev` | Run the online room server locally (dev builds connect to it) |
| `npm run server:deploy` | Deploy the room server to Cloudflare |
| `npm run typecheck` | TypeScript |

```
scripts/        course builders (OpenStreetMap + canopy → course JSON, themed courses), model tools
src/course/     course model, OSM → course, tree planting
src/disc/       discs, flight model and collisions, trees, augments
src/render/     three.js scenes, props, trees, imagery
src/modes/      game controllers (disc.ts; golf.ts is an older mode, off the menu)
src/ui/         menu, settings, disc picker, broadcast graphics
public/         built courses and 3D models
docs/           design notes and the decision log
```

Design notes and every decision so far: [`docs/`](docs/README.md).

## Credits

- Course data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL)
- Tree canopy: [HSY land cover 2024](https://www.hsy.fi/en/environmental-information/open-data/) (Helsingin seudun ympäristöpalvelut, CC BY 4.0)
- Satellite imagery (dev builds): © Esri and its partners, streamed, not stored
- 3D models, all [CC0](https://creativecommons.org/publicdomain/zero/1.0/): [Kenney](https://kenney.nl) (Minigolf, Cube Pets, Nature, Castle, Fantasy Town, Space and Mini Characters kits), [KayKit Adventurers](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) by Kay Lousberg, and [Quaternius](https://quaternius.com) (Animated Monsters, Stylized Nature MegaKit). Each pack's license is next to its models in `public/models/`.
- Music and sound, all CC0: [Kenney](https://kenney.nl) (Impact, Interface, RPG Audio and Music Jingles packs) and [OpenGameArt](https://opengameart.org) artists TinyWorlds, Zane Little Music, RandomMind, yd, isaiah658, sketchman3, aquinn, rubberduck, artisticdude and expl0it3r. Track by track: [`public/audio/CREDITS.md`](public/audio/CREDITS.md).
