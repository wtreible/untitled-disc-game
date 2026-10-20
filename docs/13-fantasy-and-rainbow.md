# Fantasy Fairways and Rainbow Runs (arcade courses)

Two more hand-designed 9-hole courses in the **Arcade** group on the main menu (the **Real** group holds the courses mapped from OpenStreetMap). Both are built the same way as [Mini Golf Madness](12-mini-golf-madness.md): a builder script places CC0 models and writes their colliders into the course file. Shared builder helpers are in `scripts/course-kit.ts`.

| Course | Build | File |
|---|---|---|
| Fantasy Fairways | `npm run fantasy-course` | `public/courses/fantasy.json` |
| Rainbow Runs | `npm run rainbow-course` | `public/courses/rainbow.json` |

## Fantasy Fairways (medieval)

| # | Name | Gimmick |
|---|---|---|
| 1 | The King's Road | A cobbled road lined with banners and lamp posts (the posts collide) |
| 2 | Market Day | Dogleg through market stalls, a cart on the corner, a fountain behind the basket |
| 3 | The Joust | **A giant knight** (10 m, blocking animation) guards the basket; a hedge "tilt barrier" splits the fairway |
| 4 | Siege Line | Catapults and trebuchets across the fairway |
| 5 | Castle Keep | **The basket is in a castle courtyard**: 5 × 5 tiles of wall (8.5 m high) with corner towers and a 6.5 m gate. Fly the gate or go over the wall |
| 6 | The Moat | A moat across the fairway between two watchtowers |
| 7 | Wizard's Tower | A 26 m tower beside the basket; a wizard casting at the tee |
| 8 | Haunted Hollow | Crooked trees, skeletons and bats along an S-bend |
| 9 | Dragon's Lair | **A dragon** hovers 5 m up in front of the basket (body and wing colliders), ringed by rocks |

## Rainbow Runs (space)

A rainbow road floating in space. Only the road is in bounds: off it is the void, OB (+1, with "Lost in space!"), dropped at the last point the disc was over a road. There are no guardrails. It's a parody of a certain kart racer's final track: the nods are names, the striped road, item-style mystery boxes and a checkered start; there are no borrowed assets.

| # | Name | Gimmick |
|---|---|---|
| 1 | Lights Out | A straight start from a checkered grid between alien and astronaut fans |
| 2 | Mystery Box Alley | Two rows of spinning "?" boxes floating over the road (they're empty) |
| 3 | Ring Road | Three hex rings on the line, each with an 8 m opening starting about 1 m up |
| 4 | The Chicane | S-curves with parked racers on the apexes |
| 5 | Asteroid Belt | Asteroids at every height from the road to 10 m up |
| 6 | Rocket Garage | Rockets beside the road and one on the line before the basket |
| 7 | Gap Jump | The road stops for 22 m: throw over the void |
| 8 | Hairpin Galaxy | A U-turn. Par 3 for the 55 m carry straight across the void; the road around is the safe way |
| 9 | Final Lap | A finish ring, a crowd down the home straight, a checkered finish line |

The road is a smoothed center line (Chaikin) turned into ribbons: one boundary polygon per road, seven stripe decals, white edge lines. Stars are scattered over the void (drawn under the road) and on a sky dome that only the first-person camera sees.

## Models

All **CC0**. Each pack's license file is next to its models in `public/models/<pack>/`. Only the models used are copied.

| Pack | Author | Used for |
|---|---|---|
| [Castle Kit](https://kenney.nl/assets/castle-kit) | Kenney | Walls, towers, siege engines, banners, trees, rocks |
| [Fantasy Town Kit](https://kenney.nl/assets/fantasy-town-kit) | Kenney | Market stalls, cart, fountain, lanterns, hedges, trees |
| [Space Kit](https://kenney.nl/assets/space-kit) | Kenney | Rings, asteroids, crystals, racers, rockets, aliens, astronauts, dish |
| [KayKit Adventurers](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) | Kay Lousberg | Knight, Mage (glTF with ~76 animations) |
| [Animated Monsters](https://opengameart.org/content/lowpoly-animated-monsters) | Quaternius | Dragon, Skeleton, Bat (FBX, loaded with three.js `FBXLoader`) |

Notes on the models:

- **Space Kit** models sit around (2, 0, 1.5) instead of the origin, so their props carry `offset` to recenter them.
- **Quaternius FBX** materials load as shiny Phong with white specular and emissive set equal to the color. They're made matte on load. The dragon and bats are near-black as authored, so the course `tint`s them by material name (a red dragon).
- **KayKit** GLBs report raw bounds about 1.5× their skinned size, so the knight and mage sizes are measured in three.js (2.47 and 2.72 units tall) and hard-coded in the builder.
- **Mystery boxes** are a procedural model (`proc:mystery-box`, a canvas "?" texture) spinning about the vertical axis.

## Renderer and course-file additions

- `PropDef.offset` (recenter), `PropDef.tint` (material colors), `spin.axis`, FBX and `proc:` models (`src/render/props.ts`).
- `DiscCourseFile.decals` (flat colored shapes over the ground), `stars` (count), and `toasts` (themed event messages, e.g. OB).

## Collision fix: touching boxes

Wall tiles, hedge segments and the castle and windmill pieces are boxes that touch. Pushing a disc out of one box along the shortest axis could put it inside the next box, which pushed it back. Each push also damped its vertical speed, so about 1 throw in 2,000 (2 of 4,320 test throws) hung in the air for the full 20 s (on the Mini Golf Madness castle, 11.8 m up). A box now pushes the disc out through the nearest face that doesn't lead into another collider (`tests/props.test.ts`, "touching boxes").
