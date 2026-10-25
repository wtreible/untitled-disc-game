# Ideas for more depth (possibilities)

A list of possible additions, collected 2026-10-25, now being built in steps (below). **Done** marks what's in. ★ marks the picks that looked best for the effort. **Courses** is the area being looked at first; real elevation is evaluated in [07-elevation-lidar](07-elevation-lidar.md).

## Shots and rules

| Idea | What it is | Builds on |
|---|---|---|
| ★ **The lie decides the shot** (**done**, D98) | Deep rough or under trees: standstill only (no X-step, less power, wider wobble). A trunk right in front forces a forehand, roller or overhand. | Lies (`p.lie`), shots, throw styles (D93) |
| **Circle 1 / circle 2 putting** (**done**, D98) | Inside 10 m a normal putt. 10–20 m: an optional jump putt, more range but worse accuracy. | Putt style, `puttRange` |
| **Mandos and drop zones** (**done**, D103) | Mandatories (pass a tree or pole on the marked side) and drop zones for water/OB islands. Some are mapped in OSM. | Course model, OB rules |
| **Nose angle** (**done**, D99) | Nose up stalls and floats short; nose down goes far but drops early. Pairs with first-person launch angle and 2-stage throws. | Flight model `launch`, `nose` |

## Courses

| Idea | What it is | Builds on |
|---|---|---|
| ★ **Real elevation** (**done**, D94–D96) | Bare-earth elevation (lidar DEMs) under the real courses: uphill and downhill holes, rollaways down slopes, raised baskets. Evaluated in [07-elevation-lidar](07-elevation-lidar.md). | `Terrain` interface (D9) |
| **Layouts and pin positions** (**done**, D100) | Short/long tees and A/B pins per hole, picked per round (Kincaid already has two baskets per hole). | Course builder, hole model |
| **Look-ahead camera** (**done**, D100) | Before throwing, fly out to the landing zone and look back at the tee. Most useful once elevation is in. | Flyover / chase cameras |

## Progression

| Idea | What it is | Builds on |
|---|---|---|
| ★ **Stats and a player rating** (**done**, D97) | Circle 1/2 putting %, fairway hits, parked, scrambles, OB rate; a PDGA-style rating from recent rounds. Kept per browser. | Round event log |
| **Tour mode** | A season of events across the real courses with entry rules (X-step only, a hex every hole…). Winnings buy discs and plastics (grippy for wet days, beat-in discs that turn more). The natural home for disc wear (deferred). | Bag building, Crazy mode rules |
| **Daily challenge** | One seeded hole or round a day for everyone, with a leaderboard through the room server. | Seeded rounds, room server |

## Opponents and modes

| Idea | What it is | Builds on |
|---|---|---|
| ★ **Bots** (**done**, D104) | Computer players at a few skill levels: aim with the ghost line, tuned execution error. Rivals in solo play; fill empty seats online, so teams and Crazy mode get full cards. | Ghost flights, `execution` (D93) |
| **More formats** | Skins (carry-overs), match play, alternate-shot doubles, Bounty (the leader wears a hex). | Round log, teams, hexes |
| **Course editor** | Place tees, baskets, trees and OB on a blank or real map; share as a code. Endless content, but the biggest build. | [08-level-editor-and-disc-golf](08-level-editor-and-disc-golf.md) |

## Feedback

| Idea | What it is | Builds on |
|---|---|---|
| **Shot analysis** (**done**, D97; the comparison with the disc's flight numbers is not) | After a throw: carry, peak height, how far it turned and faded, release speed, next to what the disc's flight numbers predicted. | Throw samples, disc charts |

## Steps (2026-10-25)

1. Stats, player rating and shot analysis (**done**, D97)
2. The lie decides the shot; circle 1 / circle 2 putting with jump putts (**done**, D98)
3. Throwing depth: nose angle, the putting reticle, throw-style hooks for augments; the Dev control schemes reworked (**done**, D99)
4. Course play: look-ahead camera, layouts and pin positions (**done**, D100)
5. Mandos and drop zones (**done**, D103)
6. Bots (**done**, D104)
7. More formats: skins, match play, alternate-shot doubles, Bounty
8. Daily challenge
9. Tour mode
10. Course editor
