# Mini Golf Madness (themed course)

A full-size disc golf course (9 holes, 75–130 m) themed like mini golf, built from free CC0 models scaled up to be obstacles. Hand-designed, not from OSM. Build: `npm run silly-course` → `public/courses/silly.json`. Pick the Mini Golf Madness card on the main menu.

## Holes

| # | Name | Gimmick |
|---|---|---|
| 1 | Windmill Way | A 15× windmill on the line, blades spinning toward you. Thread the arched tunnel (4.5 m wide, 2.1 m high) with a low, flat throw, go around, or risk the blades high. Laying up ~20–30 m short then threading it is the safe play |
| 2 | Moo-ve Over | Dogleg; a giant cow eating next to the basket, a pig at the corner |
| 3 | Castle Crash | Throw through the 9 m castle gate (or around the towers) |
| 4 | Penguin Parade | A line of dancing penguins across the fairway with a gap in the middle |
| 5 | Giraffe Gate | Two giraffes flank the line; an elephant guards the basket |
| 6 | Mushroom Kingdom | Giant mushrooms on and around the line |
| 7 | Ball Pit | Giant golf balls as boulders |
| 8 | Lion's Den | A lion on a rock by the basket, palms along the way |
| 9 | Island Green | The basket on an island in a pond, with a crab and chicks |

## Models

All from [Kenney](https://kenney.nl), **CC0** (public domain; credit appreciated, not required). Each pack's `License.txt` is in `public/models/<pack>/`.

- **Minigolf Kit 3.1**: windmill, castle, giant golf balls, tee flags
- **Cube Pets 2.0**: animals, with their idle / eat / dance / walk animations
- **Nature Kit**: trees, mushrooms, rocks, flowers, bushes

Only the ~40 models used are copied (≈2 MB). Nature Kit materials set `metallicFactor 1`, which renders black without an environment map, so prop materials are made matte on load.

## Props and collisions (`src/disc/props.ts`)

Colliders are computed at build time from measured model geometry (including node transforms: Nature Kit models sit under a parent shifted down 0.05) and stored in the course file, so physics never waits on model loading.

| Prop | Collider |
|---|---|
| Windmill | Tunnel-level walls and lintel, tapering tower slices, gabled roof (boxes); four **spinning blades** (rotating arms, swat the disc with the blade's own velocity) |
| Castle | Two towers, the gate lintel, side rails (boxes); the model is sunk by its base tile so the gate floor is at ground level |
| Mushrooms | Two cylinders: a narrow stem under a wide cap (one cap-wide cylinder made the stem area solid) |
| Animals, balls, rocks | Vertical cylinders from the model footprint |
| Trees | The normal tree model (trunk + crown) sized from the model's bounding box |

**Timing:** blade angle = phase + ω·t on a game clock. The physics evaluates the blades at release clock + flight time; the clock advances with flight playback speed, and replays rewind it to the throw's time, so the blades you see are the blades the disc meets.

**Debug:** add `?debug=colliders` to the URL to draw every collider as a magenta wireframe.
