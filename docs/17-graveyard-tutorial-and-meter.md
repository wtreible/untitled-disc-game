# Graveyard Shift, the tutorial, and the meter (2026-10-23)

## Graveyard Shift (arcade)

A 9-hole night course through a haunted cemetery (`npm run graveyard-course`, `scripts/build-graveyard-course.ts` → `public/courses/graveyard.json`). Models: [Kenney Graveyard Kit](https://kenney.nl/assets/graveyard-kit) (CC0; `public/models/graveyard/License.txt`). The characters' 32 animation clips are cut to the one each plays by `npm run slim-models`.

| # | Hole | Set piece |
|---|---|---|
| 1 | Cemetery Gates | An iron fence across the fairway, the 5 m gate open in the middle; rows of graves |
| 2 | Pumpkin Patch | Pumpkins through the dogleg and in a ring round the basket; the groundskeeper |
| 3 | The Crypt | A great crypt across the line just short of the basket: round it or over the roof |
| 4 | Wandering Ghost | A giant ghost drifting 40 m back and forth across the fairway |
| 5 | Dead Wood | A narrow corridor of crooked dead pines, two on the line |
| 6 | The Bog | A murky pond to carry (water, +1), tall rocks in it |
| 7 | Lantern Lane | A lane between stone walls, lamp posts down both sides |
| 8 | Zombie Shuffle | Three zombies shambling across the dogleg, out of step |
| 9 | The Vampire's Lair | The basket in a ring of iron fence, the gate toward the tee; the vampire waits |

**Night**: a new `night` weather (moonlit, purple sky, no birds or cloud shadows), never picked at random. A course file's `weather` fixes its weather whatever the round would pick; Graveyard Shift's is `night`. The driving range panel offers it too.

## Tutorial (Training)

The driving range with a card of ten steps (`src/modes/tutorial.ts`), each done by doing it: aim (turn 4°), set the distance (W/S, 8 m), throw, throw in the wobble zone, change disc, throw with hyzer or anhyzer, throw a forehand, throw a tomahawk, thumber or roller, switch views, and make a 25 ft putt. Skip moves on; End tutorial goes back to the menu.

- Played alone on this browser, even in a room (the room's lobby sees the driving range). Calm and sunny, one basket at 150 ft; the range panel is hidden and the setup isn't saved.
- `src/modes/disc.ts` tells the tutorial what's lined up each frame and how each throw went when it lands; the tutorial asks for baskets. The putt step moves the basket to 25 ft and sets up the putt (the putter, a flat backhand, a normal shot, aimed at the basket), since the range otherwise keeps the last throw's settings.

## Throw power and the wobble zone

- **Throws reach 10% farther** (`FLIGHT.throwPower = 1.1`, putts unchanged): the meter's fill maps through each disc's fitted curve to 110% of the old distance (9–13% measured per disc at half and full power). The curves are still fitted at the base distance (`scripts/calibrate-disc.ts` sets the boost to 1 while fitting).
- **The wobble zone stays the top 10% of the meter** (`FLIGHT.wobbleFrom = 0.9`, the same formula as before). The HUD stripes it red at the meter's end, over the fill; hidden for putts (they don't wobble more) and with Run-Up or Golden Arm.

## Menu

The course list is two compact tiles to a row (name and a one-line description; the full blurb is in the next column), so 16 courses take about the right column's height (816 px against 937 px at 1400 px wide, down from 1,398 px for 13).
