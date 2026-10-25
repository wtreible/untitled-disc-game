# Ideas for more depth (possibilities)

A list of possible additions, collected 2026-10-25. Nothing here is planned yet. ★ marks the picks that looked best for the effort. **Courses** is the area being looked at first; real elevation is evaluated in [07-elevation-lidar](07-elevation-lidar.md).

## Shots and rules

| Idea | What it is | Builds on |
|---|---|---|
| ★ **The lie decides the shot** | Deep rough or under trees: standstill only (no X-step, less power, wider wobble). A trunk right in front forces a forehand, roller or overhand. | Lies (`p.lie`), shots, throw styles (D93) |
| **Circle 1 / circle 2 putting** | Inside 10 m a normal putt. 10–20 m: an optional jump putt, more range but worse accuracy. | Putt style, `puttRange` |
| **Mandos and drop zones** | Mandatories (pass a tree or pole on the marked side) and drop zones for water/OB islands. Some are mapped in OSM. | Course model, OB rules |
| **Nose angle** | Nose up stalls and floats short; nose down goes far but drops early. Pairs with first-person launch angle and 2-stage throws. | Flight model `launch`, `nose` |

## Courses

| Idea | What it is | Builds on |
|---|---|---|
| ★ **Real elevation** | Bare-earth elevation (lidar DEMs) under the real courses: uphill and downhill holes, rollaways down slopes, raised baskets. Evaluated in [07-elevation-lidar](07-elevation-lidar.md). | `Terrain` interface (D9) |
| **Layouts and pin positions** | Short/long tees and A/B pins per hole, picked per round (Kincaid already has two baskets per hole). | Course builder, hole model |
| **Look-ahead camera** | Before throwing, fly out to the landing zone and look back at the tee. Most useful once elevation is in. | Flyover / chase cameras |

## Progression

| Idea | What it is | Builds on |
|---|---|---|
| ★ **Stats and a player rating** | Circle 1/2 putting %, fairway hits, parked, scrambles, OB rate; a PDGA-style rating from recent rounds. Kept per browser. | Round event log |
| **Tour mode** | A season of events across the real courses with entry rules (X-step only, a hex every hole…). Winnings buy discs and plastics (grippy for wet days, beat-in discs that turn more). The natural home for disc wear (deferred). | Bag building, Crazy mode rules |
| **Daily challenge** | One seeded hole or round a day for everyone, with a leaderboard through the room server. | Seeded rounds, room server |

## Opponents and modes

| Idea | What it is | Builds on |
|---|---|---|
| ★ **Bots** | Computer players at a few skill levels: aim with the ghost line, tuned execution error. Rivals in solo play; fill empty seats online, so teams and Crazy mode get full cards. | Ghost flights, `execution` (D93) |
| **More formats** | Skins (carry-overs), match play, alternate-shot doubles, Bounty (the leader wears a hex). | Round log, teams, hexes |
| **Course editor** | Place tees, baskets, trees and OB on a blank or real map; share as a code. Endless content, but the biggest build. | [08-level-editor-and-disc-golf](08-level-editor-and-disc-golf.md) |

## Feedback

| Idea | What it is | Builds on |
|---|---|---|
| **Shot analysis** | After a throw: carry, peak height, how far it turned and faded, release speed, next to what the disc's flight numbers predicted. | Throw samples, disc charts |

## Suggested order (when picked up)

Stats and rating → lie and putting rules → bots → elevation. The first three are mostly logic on existing systems; elevation needs a data pipeline per real course.
