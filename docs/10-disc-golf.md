# Disc golf (default mode)

Implemented 2026-10-19. Two disc courses share the real Tali hole layout; golf (TCC #17) remains selectable.

| Course | Look | Trees | File |
|---|---|---|---|
| **Tali Recreation**, default (the easy version) | Flat vector drawing: rough, mown fairway lanes (10 m), paths, roads/buildings (OB), water, tee pads | The real forest's trees (9.2k), thinned: no crown within 3 m of a fairway edge, of a 6 m green around each basket, or within 5 m of a tee (`RECREATION` in `src/course/disc-build.ts`) | `public/courses/tali-simple.json` (`npm run disc-course -- --style simple --out tali-simple`) |
| Tali Forest (the real version) | Live Esri imagery (dev builds) or the drawn classes | ~10.5k trees planted in HSY canopy | `public/courses/tali.json` |

Both start in **first person**; C switches to the top-down map (and back), and the choice carries across turns. Inside 20 m, first person turns on automatically.

## Tali Recreation: the real trees, thinned (2026-10-20)

Tali Recreation plants exactly the real version's trees (same HSY canopy, same seed), then drops every tree whose crown comes within 3 m of a fairway edge (fairways are 5 m either side of the hole line), within 3 m of a 6 m green around each basket, or within 5 m of a tee. That removes 1,328 of 10,533 trees (9,205 left). The rest of the forest stands as mapped, so it plays like the real course with a forgiving lane. Same throw sweep as the tree-model numbers below: 21% of throws touch a tree (53% on Tali Forest). Lies come from the drawn ground (no canopy polygons), and branch density is the forest's 0.11/m.

(Until 2026-10-20 this course used 1–5 designed trees per hole with a defender at every basket; those are gone.)

- Branch density 0.4/m on Mini Golf Madness and Fantasy Fairways, 0.11/m on both Talis (lowered 2026-10-20 from 0.9 / 0.25: a disc passing through a crown's middle is knocked down ~84% of the time instead of ~96%, ~50% instead of ~73% near the edge). Stored per course as `branch_density`.

**2D and 3D are one world:** the top-down tree symbols (shadow, crown disc, trunk dot) are drawn from the same list and radii as the 3D trunks and crowns, and the vector ground meshes are the same in both cameras. A yellow beacon marks the current basket in first person.

## Course: Tali, Helsinki

The marquee US courses (Maple Hill, DeLaveaga, Idlewild, Winthrop Gold, Blue Ribbon Pines, Smugglers' Notch) have **no holes mapped in OSM** (checked 2026-10-19; Maple Hill is a single point). Of ~11,000 `disc_golf=hole` ways worldwide, the best-mapped famous-ish candidates were Tali (Helsinki), Toronto Island and Mercer County Park. Tali won because it's fully mapped *and* has open tree data (HSY canopy), which tree collisions need.

| Item | Value |
|---|---|
| OSM course | `way/40254405` "Talin frisbeegolfpuisto" |
| Holes | 18 `disc_golf=hole` lines, 58–218 m; every hole has a mapped tee and basket at its ends (the two that seemed missing were just outside an earlier, too-small query box) |
| Par | **Not tagged in OSM.** Estimated from length: < 150 m → 3, < 240 m → 4, else 5. Shown as "(est.)" in the HUD |
| OB | Roads (buffered by class), buildings, parking, the neighboring golf course, water; outside the course polygon + 35 m hole corridors |

## Trees

Source: **HSY land cover 2024** (Helsingin seudun ympäristöpalvelut), WFS layers `maanpeite_puusto_{2_10m,10_15m,15_20m,yli20m}_2024`: canopy polygons by height class, derived from lidar and aerial imagery. Open, no key. Every HSY dataset found on the HRI catalog is CC BY 4.0; the license page for this specific dataset wasn't found, so that's **likely but unconfirmed**. Attributed on screen either way.

HSY gives *where canopy of a given height is*, not trunk positions. The pipeline (`plantTrees` in `src/course/disc-build.ts`):

1. Rasterizes canopy polygons at 1 m, taller classes winning.
2. Dart-throws blue-noise trunk positions inside canopy, spacing by class (3 / 4 / 5 / 6 m).
3. Height uniform within the class; crown radius 0.55 × spacing; trunk radius 0.06 + 0.012·h.
4. Crown base: young (2–10 m class) trees bushy from 0.3–1.5 m; taller trees 25–55% of height.
5. **Fairway lanes:** no trunks within 3 m of any hole line; crowns overhanging a lane are limbed up to ≥ 3.5 m. Without this, canopy that overhangs real fairways became trunks in the fairway.
6. No trunks within 3 m of a tee or 2 m of a basket.

Result: ~10.5k trees. Positions match the photo at forest scale (open lanes and clearings line up) but individual trunks are synthetic. Upgrade path: individual tree detection from a lidar CHM (docs/07).

## Flight model (`src/disc/flight.ts`)

- Point mass + bank angle φ. Lift and drag from angle of attack (Hummel 2003 / Potts & Crowther form: CL = CL0 + CLα·α, CD = CD0 + CDα·(α−α0)², a = ½ρA/m·v²·C). The disc's nose angle stays fixed, so as the path drops the angle of attack rises and the disc glides.
- Lift tilts with bank, which is what makes discs curve. Flight numbers drive the bank: **turn** rolls toward anhyzer while speed > 60% of release; **fade** rolls back toward hyzer as it slows. Underpowered throws never turn and fade early, as real ones do.
- Turn and fade each push the bank toward a limit set by the flight numbers (turn about −31° for turn −1; fade 21–35° for fade 1–3) and ease off near it. Unbounded, fade rolled drivers past 170° (upside down) by landing.
- Release angle (hyzer/anhyzer, Q/E) sets the initial bank; forehand (T) mirrors the curve.
- Power meter maps to release speed through the measured distance-vs-speed curve, so meter fill ≈ fraction of max distance (distance grows ~v^3.7 otherwise).
- **Stall:** past ~26° angle of attack, lift fades to zero at 90° and drag rises toward a flat plate. Without it, high launches stalled and drifted backward toward the thrower.
- **Per-disc launch, speed and meter curve** (2026-10-20): each disc has a default launch near its best (distance driver 0.09 rad, fairway 0.09, midrange 0.10, putter 0.13), a release speed fitted so that default reaches its range (110 / 90 / 72 / 58 m), and a measured distance-vs-speed curve the meter inverts, so meter fill ≈ fraction of max distance for every disc. In first person, launch = view pitch + that default (putts: +0.12 rad). A pitched-down line drive with the distance driver gains ~18%; launching much higher or lower loses distance.
- Verified with an 8,640-throw sweep (every disc × power × release angle × launch −20°…41° × backhand/forehand × stacked augments): no NaN, nothing underground, no backward flights, banks within limits; only absurd distance stacks (+74%) still reach a 37 m apex.

## The bag (2026-10-21)

| Disc | Speed \| Glide \| Turn \| Fade | Full-power flat | Shape (right-hand backhand) |
|---|---|---|---|
| Distance driver | 12 \| 5 \| −1 \| 3 | ~110 m | slight turn, fades back to the line |
| Overstable driver | 11 \| 4 \| 0 \| 4 | ~90 m | no turn, hard fade (~30 m left): hyzers, headwinds |
| Fairway driver | 7 \| 5 \| −1 \| 2 | ~90 m | drifts right ~12 m |
| Turnover fairway | 7 \| 5 \| −1 \| 1 | ~84 m | turns right ~24 m and holds |
| Midrange | 5 \| 5 \| 0 \| 1 | ~72 m | straight |
| Approach | 4 \| 3 \| 0 \| 3 | ~52 m | short, dependable fade |
| Putter | 2 \| 3 \| 0 \| 1 | ~58 m | straight |

New discs are fitted with `scripts/calibrate-disc.ts` (release speed for the range, then the meter curve), so half a meter is ~half the distance for every disc. Disc suggestions only pick the everyday four (distance, fairway, midrange, putter).

### Bag building (2026-10-21)

Optional (menu → Round → Pick a bag): everyone carries 4 of the 7 discs for the round, picked before hole 1 (a `bag` event; online all at once, in hot seat in turn). The disc picker, [ / ] and suggestions only use the bag. The putting stroke needs the putter: leave it at home and you putt with whatever you carry. Crazy mode's **Bag Pocket** (common, only offered with bag building) adds a slot, filled before the next hole.

## Throw styles (2026-10-21)

The shot chip (or G) picks the kind of throw, back to normal after each throw. Not for putts.

| Shot | Release | Flight | Driver, full power |
|---|---|---|---|
| Normal | Hyzer / flat / anhyzer, backhand or forehand | The disc's flight numbers | ~110 m |
| Tomahawk | Overhand, on edge, launched steep | Rolls over onto its back and dives left; flies rim first (low drag, small side force), stops where it lands. Over trees | ~40 m, apex ~11 m, ~8 m left |
| Thumber | Tomahawk's mirror image | Dives right | ~40 m, ~8 m right |
| Roller | A big anhyzer, launched low | Touches down ~15–20 m out and rolls on edge, curling more as it slows (which way: the disc's stability and the hand), then falls flat. Under trees | ~80 m |

## Disc picker (2026-10-20)

The bottom row of the HUD is the disc picker: one compact card per disc (seven) with its **flight chart**, flight numbers and typical full-power distance. Click a card (or [ / ]) to pick it. The charts are the game's own physics: a full-power flat throw in calm air on an open field, seen from above with the release at the bottom, all on one scale so lengths compare. Side-to-side is drawn 2× wider so turn and fade read clearly. With forehand selected (T) the charts mirror. (`src/ui/discPicker.ts`)

## Wind (2026-10-20)

Each hole draws a wind when it starts: 30% calm (0–1 m/s), 50% breezy (1–3), 20% windy (3–5), any direction. The hole banner shows the speed (m/s or mph) and an arrow turned to your view (up the screen = straight ahead). Calm hides the arrow.

- **Physics:** lift, drag, angle of attack and the turn/fade speed thresholds all use the disc's motion **through the air** (velocity minus wind). A headwind means more airspeed: more lift and a longer turn, so drivers turn over. A tailwind means less: the disc fades sooner and drops. A crosswind drifts it downwind. Rolling discs ignore wind.
- **Height:** full strength from 10 m up, easing to 40% at the ground (`windAt`, a rough power-law profile), so putts feel it less than drives.
- **At 5 m/s** (flat, full power, from `tests/wind.test.ts` and a sweep): the distance driver goes 110 m L1 calm → 90 m R40 into a headwind, 93 m L20 downwind; crosswinds move it 15–20 m. Soft putter shots lose ~25% downwind and gain ~15% into the wind (the extra lift outweighs the drag at those speeds). That's why the cap is 5 m/s.
- The aim preview and the power meter's target tick simulate with the wind, so they show its effect. Disc suggestions use calm ranges.
- Wind stays the same for every player on a hole and isn't a Crazy mode effect (yet).

## Collisions

| Obstacle | Model |
|---|---|
| Trunk | The model's trunk as stacked slices (it bends on some trees) up to where it forks; reflect horizontal velocity, keep ~half the speed, disc "dies" (lift ×0.2, extra drag) |
| Leaves | Branch-hit probability per meter traveled **inside the model's leaf clumps** only; a hit kicks the disc in a random direction at 20–40% speed. Bare branches and the gaps between clumps don't collide |

### Tree models (2026-10-20)

Course trees are branched models from Quaternius' [Stylized Nature MegaKit](https://opengameart.org/content/stylized-nature-megakit) (CC0, free Standard version): five broadleaf (`CommonTree_1–5`) and five pines (`Pine_1–5`) in `public/models/qtrees/`. Bark textures are downscaled to 512 px.

- **Which model:** picked from a hash of the tree's position (low-crowned trees are 65% pines, others 25%), with a hashed turn. Scaled so the model's height is the tree's `h` and its farthest leaf is at the tree's crown radius `r`. `src/disc/treeShapes.ts` does this for both physics and rendering.
- **Shapes** (`npm run tree-shapes`, `scripts/build-tree-shapes.ts`): leaf triangles are rasterized into a 0.3 m voxel grid, gaps between leaf cards closed, clump interiors filled, then opened back. The trunk is traced in 0.4 m slices from the base until it forks. Every rendered leaf vertex falls inside (or within one voxel of) the leaf volume.
- **Density:** the leaf clumps hold 38% of the volume of the ellipsoid crowns they replace (22–56% by model), so branch density inside them is ×1.3 (0.8 × base, the old crown's average, × 1.3). A disc still meets fewer branches. Same 3,240-throw sweep, old crown → models: Tali branch hits 4.2% → 1.9% of throws, trunk 3.6% → 3.7%; Tali Forest branch 25% → 17%, trunk 38% → 41%.
- **Rendering:** instanced per model and part (bark, leaves). Courses with more than 1,500 trees (Tali Forest) draw models only for the nearest trees in view of the first-person eye, re-picked every 4 m or 8° turn, with trees that are already models kept until clearly out (15% farther, behind, or outranked); the rest keep the simple trunk + ellipsoid stand-ins. A tree switching between model and stand-in **dissolves over 0.45 s** (a per-instance 4×4 screen-door dither, so no transparency sorting) instead of popping. **While a throw is followed** (its flight and chase-cam replay, yours or a friend's), the model set is locked to the 1.5× budget of trees nearest the flight path: nothing changes mid-flight, and in simulation 80–100% of the trees within 25 m of the chase camera are models, against 45–69% for the moving eye zone. How many depends on **Settings → Graphics**: High 300 within 90 m (pixel density up to 2×), Medium 120 within 60 m (1.5×, the default), Low none at all (1×). Collision is the same on every setting. **Show frame rate** puts an fps readout under the leaderboard. Themed courses' own model trees (Kenney etc.) keep their trunk + ellipsoid collision.
| Basket chains | Entering the chain zone: catch probability from how centered the line is (perpendicular offset from the pole) and speed. Misses near the edge **cut through**; other misses usually **rattle in** (65%, less for firm putts over 8 m/s) and only otherwise **spit out** backward. Spit-outs are ~2% of putts (were ~10%, 2026-10-20) |
| Top band / lid, tray (cage), pole | Bounce off with heavy speed loss. The disc is pushed back outside the surface it hit (without that it stuck to the cage and slid down it) |
| Tray from above | A disc coming down inside the tray's footprint (a spit-out or band hit falling back) lands in the tray and counts, as in the PDGA rules |
| Water / OB | +1, play from where the disc last crossed in (casual, D19) |
| Tap-in | Putts from < 1 m drop in |

## Basket size and forgiveness

The basket is ~15% wider than a PDGA target (tray r 0.38 m, chains r 0.33 m, band r 0.37 m) and the chain section ~25% taller (0.78–1.45 m), with a gentler catch curve (`CATCH` in `src/disc/flight.ts`). Measured over 100 putts at the HUD's suggested power (before → after, 2026-10-20):

| Putt | Centered | 30 cm off |
|---|---|---|
| 5 m | 82% → 98% | 35% → 69% |
| 10 m | 52% → 83% | 45% → 75% |
| 15 m | 34% → 53% | 42% → 67% |

## First-person putting

First person shows a top-down **minimap** of the current hole (bottom-left; click it to aim), **W/S** moves the target distance (Shift: 5 m), and the **scroll wheel zooms**. Inside 20 m (circle 2), after the tee throw, the camera switches to the thrower's eyes (1.65 m) with a putter selected. Drag/arrows aim; up/down sets launch angle (launch = view pitch + 7°). The power tick shows the power whose flight crosses the basket at mid-chain height. C toggles first person anywhere; the ghost arc shows the zero-error flight path in 3D.

## Replays

After each throw (except tap-ins and tiny putts), the throw replays from a camera riding ~4–5 m behind and 1.2 m above the disc, at 1.25× speed with a fixed 55° lens. The disc position is interpolated between flight samples and the camera eases its position and heading (frame-rate independent); snapping to raw samples made it shake. Drag to orbit around the disc, scroll to zoom (1.2–60 m), R resets the view; the orbit carries over to the next replay. Space skips (clicking doesn't). Settings (⚙ / Esc) turns replays off. The mulligan window and next turn start after the replay.

## Rules

Stroke play, local hot-seat, away rule within a hole, **honors** on the next tee (lowest score on the previous hole first). Max 2 × par + 2 then pick up. Scorecard after each hole.
