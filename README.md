# Untitled Disc Game

Disc golf in the browser, on real and not-so-real courses, for 1–6 players on one computer (hot seat) or online.

**Play:** https://wtreible.github.io/untitled-disc-game/

Real flight numbers (speed, glide, turn, fade) drive a physics flight model: discs turn and fade, stall when thrown nose-up, and catch the wind. You throw in first person or from a top-down map, then watch a chase-cam replay. Trees, chains, walls, windmills and dragons all collide.

## Courses

| Course | Holes | What it is |
|---|---|---|
| **Tali Recreation** | 18 | The real [Tali disc golf park](https://www.openstreetmap.org/way/40254405) (Helsinki) from OpenStreetMap, with its real trees from Helsinki's canopy data, cut back a few meters from every fairway, green and tee. The easy version. |
| **Tali Forest** | 18 | The real thing: the same holes and all ~10,500 trees. |
| **Oak Grove** | 18 | The Gold Course at [Oak Grove Regional Park](https://www.openstreetmap.org/relation/18072611) (Stockton, California) from OpenStreetMap: short, open holes among the park's mapped oaks (drawn as oaks), a pond on 17. |
| **Běchovice** | 18 | [DiscGolfPark Běchovice](https://www.openstreetmap.org/relation/14137393) (Prague) from OpenStreetMap, from the long tees: Prague's hardest course, long par 4s and 5s round its woods of oak, birch and pine. |
| **Skatås** | 20 | The yellow course at [Skatås](https://www.openstreetmap.org/relation/913917) (Gothenburg), one of Sweden's classics: short, technical holes through pine, spruce and birch, with its 2,300 mapped trees. 14b and 15b included. |
| **Kincaid Park** | 18 | [Kincaid Park](https://www.openstreetmap.org/way/767928285) (Anchorage, Alaska): long and tight holes through birch and spruce. |
| **Julkujärvi** | 18 | The PRO course at [Julkujärvi](https://www.openstreetmap.org/way/1562971247) (Ylöjärvi, near Tampere): par 4s and 5s through Finnish pine and birch. |
| **Blue Lake** | 18 | [Blue Lake Park](https://www.openstreetmap.org/way/142321221) (Portland, Oregon), host of the 2014 PDGA Worlds and the first Portland Open, among oaks and firs. OSM has no hole 8, so ours is made up: a 111 m par 3 across open ground from the 7th basket. |
| **Mini Golf Madness** | 9 | Full-size disc golf themed like mini golf: a windmill with spinning blades, a castle gate, giant animals. |
| **Fantasy Fairways** | 9 | Medieval: a giant knight, a basket inside a castle courtyard, a dragon on the last hole. |
| **Rainbow Runs** | 9 | A rainbow road floating in space. Off the road is OB. Mystery boxes, rings, asteroids, a gap to jump. |
| **Wiener Prater** | 18 | The course in Vienna's [Prater](https://www.openstreetmap.org/relation/14543666): 65–210 m holes through the old park's chestnuts, oaks and poplars, with the course's own pars. The 7th tees off under the A23 viaduct. |
| **Pirate's Cove** | 9 | Sandy islands in the sea: carry the cove, round a stranded wreck and a lookout tower, time the ghost ship, hit the island basket. Overboard is +1. |
| **Graveyard Shift** | 9 | A haunted cemetery at night: through the cemetery gates, a pumpkin patch, round a great crypt, past a wandering ghost, dead woods, the bog, Lantern Lane, shuffling zombies, and the vampire's fenced lair. |
| **Tutorial** | – | Training: ten steps on the range, each done by doing it, from aiming to a made putt (aim, distance, throw, the wobble zone, discs, hyzer and anhyzer, forehand, shots, the map, a putt). Played alone, even in a room. |
| **Putting** | – | Training: a putting ladder on the range. Three putts at each of five stations (15, 20, 25, 33 and 45 ft), worth 1 to 5 points a make; 45 is perfect. Friends take turns putt by putt (hot seat or online). |
| **Driving Range** | – | Training: a long open range with a line every 50 ft and big signs every 100 ft. Set the wind and weather, place and remove baskets and trees, and see how far and how far off line each throw went. Friends take turns from the tee (hot seat or online); whoever is up sets the range. Nothing scored. |

**Play online:** host a room from the Players panel and send friends the link; everyone plays from their own browser. See [docs/14-online.md](docs/14-online.md).

**Crazy mode** (a switch on the main menu, any course and any holes): draft an augment after every hole. Earn your ghost line, or hex your friends' course.

**Pick a bag** (also on the menu): everyone carries 4 of the 7 discs for the round.

## How to play

| | |
|---|---|
| Aim | First person: drag or arrow keys (↑/↓ launch angle), W/S target distance, scroll to zoom, click the minimap. Top-down: click or drag on the map, W/S target distance. |
| Disc | Click a card in the disc picker (its chart shows how that disc flies), or `[` / `]` |
| Release angle | Q (hyzer, curves left) / E (anhyzer, curves right) |
| Forehand / backhand | T |
| Shot | G (or the shot chip): normal, tomahawk / thumber (overhand, up over trees), roller (rolls on edge under them) |
| Throw | Hold Space, let go at the power you want. The white tick on the meter reaches your target; the dashed line is the flight if you throw it perfectly. The striped red end of the meter (past 90%) is the wobble zone: a little farther, but your aim wobbles more. |
| View | C: first person / top-down. In top-down: right-drag to pan, scroll to zoom, F to re-frame. |
| Replay | Drag to orbit, scroll to zoom, R resets, Space skips. Hold Shift to fast-forward any flight or replay. |
| Hole flyover | Space or click skips it (Settings → Hole flyovers) |
| Sound | N mutes; Music and Effects volumes in Settings |
| Quick chat | Hold Z (or the chat button at the top), point at a line and let go, or press 1–8. Everyone in the room sees it. |
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

Every push to `main` typechecks, runs the tests (the room server's too, against `wrangler dev`), deploys the rooms Worker if `server/` changed since the last successful run (so a failed Worker deploy is retried on the next push), then builds the game and publishes it to GitHub Pages (`.github/workflows/deploy.yml`). Pull requests get the checks only. One-time setup: in the repo on GitHub, **Settings → Pages → Build and deployment → Source: GitHub Actions**.

The build is a static site with relative asset URLs, so `dist/` also works on Netlify, Cloudflare Pages, or any file server, from any folder.

- **Online rooms** run on a Cloudflare Worker (free plan): `npx wrangler login`, then `npm run server:deploy` the first time. Put the `wss://…workers.dev` address it prints in a repo variable named `ROOMS_URL` (Settings → Secrets and variables → Actions → Variables) and re-run the deploy. Until then "Play online" is hidden. For CI to deploy the Worker afterwards, add the repo secrets `CLOUDFLARE_API_TOKEN` (the "Edit Cloudflare Workers" token template) and `CLOUDFLARE_ACCOUNT_ID`; without them it skips the Worker with a warning. **Run workflow** with "Deploy the rooms Worker too" deploys it without a `server/` change.
- **Satellite imagery is off in public builds.** Esri World Imagery is licensed under Esri's Master License Agreement, which generally needs an ArcGIS account for public apps, so Tali Forest shows its drawn ground instead. If you have that sorted, build with `VITE_ESRI_IMAGERY=on`.

## Development

| Command | What it does |
|---|---|
| `npm run disc-course` | Rebuild Tali Forest (`public/courses/tali.json`) from OpenStreetMap + HSY canopy. Downloads are cached in `data/raw/`. `-- --course <way id> --out <name>` for another course. |
| `npm run disc-course -- --style simple --out tali-simple` | Rebuild Tali Recreation |
| `npm run disc-course -- --course relation/18072611 --out oak-grove --trees osm --broadleaf Oak` | Rebuild Oak Grove. A course mapped as a relation of holes; outside Helsinki, `--trees osm` plants OpenStreetMap's mapped trees and woods |
| `npm run disc-course -- --course relation/14137393 --out bechovice --trees osm --broadleaf Oak,CommonTree,Birch --name "DiscGolfPark Běchovice"` | Rebuild Běchovice. `--broadleaf` / `--conifer` pick the tree models by name (`CommonTree`, `Birch`, `Oak`, `Pine`, `Spruce`); `--name` overrides OSM's |
| `npm run disc-course -- --course relation/913917 --out skatas --trees osm --broadleaf Birch,Oak --conifer Pine,Spruce --name "Skatås (Yellow)"` | Rebuild Skatås |
| `npm run disc-course -- --course 767928285 --out kincaid --trees osm --broadleaf Birch --conifer Spruce --hole-ref 996506301:4 --name "Kincaid Park"` | Rebuild Kincaid Park. `--hole-ref way:ref` numbers a hole line mapped without one |
| `npm run disc-course -- --course 1562971247 --out julkujarvi --trees osm --broadleaf Birch --conifer Pine,Spruce --name "Julkujärvi PRO"` | Rebuild Julkujärvi |
| `npm run disc-course -- --course 142321221 --out blue-lake --trees osm --broadleaf Oak,CommonTree --conifer Spruce --name "Blue Lake Park" --add-hole "8:45.555344,-122.439403;45.556125,-122.438512:3"` | Rebuild Blue Lake. `--add-hole REF:lat,lon;lat,lon[:PAR]` adds a hole OSM doesn't have (tee first, basket last) |
| `npm run import-trees -- --src <pack folder>` | Import the birches, spruces and oaks from Quaternius' [Textured LowPoly Trees](https://opengameart.org/content/lowpoly-textured-trees) (CC0), then `npm run tree-shapes` |
| `npm run disc-course -- --course relation/14543666 --out prater --trees osm --broadleaf Oak,CommonTree --conifer Pine --name "Wiener Prater"` | Rebuild Wiener Prater |
| `npm run silly-course` / `fantasy-course` / `rainbow-course` / `pirate-course` / `graveyard-course` | Rebuild the themed courses |
| `npm run course-summary` | Refresh the menu's par and length stats after rebuilding a course |
| `npm run tree-shapes` | Re-measure the tree models' trunks and leaf volumes (collision shapes) |
| `npm run slim-models` | Strip animations the courses don't use from the character models |
| `npm run server:dev` | Run the online room server locally (dev builds connect to it) |
| `npm run server:deploy` | Deploy the room server to Cloudflare (CI does this when `server/` changes) |
| `npm run test:rooms` | The room server's protocol tests, against a `wrangler dev` started and stopped for them |
| `npm run typecheck` | TypeScript (the game and the room server) |

```
scripts/        course builders (OpenStreetMap + canopy → course JSON, themed courses), model tools
src/course/     course model, OSM → course, tree planting
src/disc/       discs, flight model and collisions, trees, augments
src/render/     three.js scenes, props, trees, imagery
src/modes/      game controllers: disc.ts runs a round (turns, camera, HUD, frame loop); discRound.ts its
                shared state, discSync.ts its events to and from the room, scorecard.ts, picks.ts (bag,
                drafts), chaseCam.ts, discKeys.ts, discKit.ts (constants, helpers). golf.ts is an
                older mode, off the menu
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
