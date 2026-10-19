# Gameplay

## Shot input (D10)

1. **Club:** pick from the bag. Defaults to the club whose carry is closest to the distance to the pin (or to the routing's next bend on a tee shot).
2. **Aim:** drag or rotate an aim line on the ground. The preview shows the landing spot for 100% power.
3. **Power:** hold-and-release meter, 0–100%. Optional later: a second click for accuracy (the classic three-click swing).

## Clubs

Tunable starting values (carry in yards, roughly a mid-handicap player):

| Club | Carry | Apex (m) | Roll factor |
|---|---|---|---|
| Driver | 230 | 30 | 0.12 |
| 3-wood | 210 | 28 | 0.10 |
| 5-wood | 195 | 27 | 0.08 |
| 4-iron | 180 | 26 | 0.07 |
| 5-iron | 170 | 26 | 0.06 |
| 6-iron | 160 | 27 | 0.05 |
| 7-iron | 150 | 28 | 0.045 |
| 8-iron | 140 | 29 | 0.04 |
| 9-iron | 130 | 30 | 0.035 |
| PW | 115 | 30 | 0.03 |
| SW | 90 | 28 | 0.02 |
| Putter | 0 (ground only) | 0 | — |

## Shot model (simple)

No aerodynamics. Each shot is:

1. **Carry** = `club.carry × power × lieMultiplier(startSurface)`, plus random dispersion: direction ± σθ, distance ± σd (both grow with club length and with bad lies).
2. **Flight** = a parabola in 3D from start to landing with height `club.apex × power`. Sampled each frame for rendering and for tree checks. Flight time scales with carry (~6 s for a driver).
3. **Landing** = classify the landing point (see surfaces), then **roll** = `carry × club.roll × surface.roll` along the flight direction, stepping through surface classes as it goes (roll into a bunker stops there; roll into water is a penalty).
4. **Putting** = ground-only. Ball speed decays at the green's friction rate; holed if it passes within the cup radius (0.054 m) at under ~1.3 m/s. On flat v1 greens, putts are straight lines.

`heightAt` is 0 in v1, but all of the above is written in 3D so slopes slot in later (roll gets a gravity term from `normalAt`).

## Surfaces

| Class | Lie multiplier (next shot) | Roll factor | Special |
|---|---|---|---|
| tee | 1.0 | 1.0 | Tee shot only |
| fairway | 1.0 | 1.0 | |
| rough | 0.85 | 0.4 | More dispersion |
| trees (ground) | 0.6 | 0.2 | Much more dispersion |
| bunker | 0.6 (SW: 0.9) | 0.05 | |
| green | putter only | 1.3 | |
| path | 0.95 | 1.5 | |
| water | — | — | 1-stroke penalty; drop at the last point the ball crossed into the hazard, back toward the tee |
| oob | — | — | Casual drop (D19): +1, ball placed 2 m inside the boundary where its path left the course |

## Trees: in-flight interaction

Options considered:

- **A. Landing only:** trees matter only as a ground class where the ball lands. Simplest; the ball flies through trunks.
- **B. Height blocking (chosen, D11):** each tree polygon has a canopy height (OSM `height` tag if present, else 15 m; later from lidar). Sample the flight path. If the ball is inside a tree footprint below canopy height, it hits the tree, loses most of its speed, and drops near the point of contact (small random offset). Cheap with a 3D ball, and it makes shot shape and club choice matter.
- **C. Random deflection:** like B, but the ball bounces off in a random direction at reduced speed. More realistic chaos and more frustrating. Can be added on top of B with a tunable probability.

## Scoring (D12)

- Stroke play vs the OSM `par`. Strokes = swings + penalties.
- End-of-hole result: name (eagle / birdie / par / bogey / double / +n) and score relative to par.
- Local hot-seat multiplayer (D16): players take turns; the player farthest from the pin plays next (golf's "away" rule); holed players are skipped.
- Max strokes cap (e.g. 2 × par + 2) to stop a bad hole from going on forever, which matters with friends watching.
