# Disc golf (default mode)

Implemented 2026-10-19. Two disc courses share the real Tali hole layout; golf (TCC #17) remains selectable.

| Course | Look | Trees | File |
|---|---|---|---|
| **Tali (simple)**, default | Flat vector drawing: rough, mown fairway lanes (10 m), paths, roads/buildings (OB), water, tee pads | 1–5 designed trees per hole (54 total), every basket guarded by a defender | `public/courses/tali-simple.json` (`npm run disc-course -- --style simple --out tali-simple`) |
| Tali (forest, satellite) | Live Esri imagery | ~10.5k trees planted in HSY canopy | `public/courses/tali.json` |

Both start in **first person**; C switches to the top-down map (and back), and the choice carries across turns. Inside 20 m, first person turns on automatically.

## Simple course: designed trees (`designTrees` in `src/course/disc-build.ts`)

Per hole, seeded, 1–5 trees (more on longer holes):

- **Defender** (every hole): low and bushy (6–10 m tall, branches from 0.3–0.8 m, crown radius 2–3 m), 4–9 m short of the basket, 0.5–1.8 m off the line. A straight run at the chains goes through foliage; curve around it. Tested: blocks most straight putts, a putt aimed wide gets through.
- **Gate** pair: either side of the line 15–30 m from the tee, 4–7 m out.
- **Mid-fairway**: 35–65% along, 1.5–4 m off the line, crown raised to 3–5 m (go under or around).
- **Flank**: 20–90% along, 6–12 m off the line.
- Never within 4 m of any tee, 2.5 m of any basket, 3 m of *another* hole's line, or in OB/water.
- Branch density 0.9/m (lone feature trees are fully leafy), versus 0.25/m in the forest, where a higher value made every throw a pinball. Stored per course as `branch_density`.

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

## Collisions

| Obstacle | Model |
|---|---|
| Trunk | Cylinder; reflect horizontal velocity, keep ~half the speed, disc "dies" (lift ×0.2, extra drag) |
| Crown | Ellipsoid matching the 3D crown; branch-hit probability per meter traveled inside it, denser toward the middle; a hit kicks the disc in a random direction at 20–40% speed |
| Basket chains | Entering the chain zone: catch probability from how centered the line is (perpendicular offset from the pole) and speed. Misses near the edge **cut through**; others **spit out** backward |
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
