# Crazy mode (roguelike)

Status: playable; augment list still open to changes (2026-10-20). Every augment below is implemented and tested.

Turned on with the **Crazy mode** switch on the main menu; works on any course and always plays the full course (18 holes at Tali, 9 at Mini Golf Madness). The normal disc golf modes have no augments and show the full ghost line.

## Draft

- **Starter augment** before hole 1, rolled with better odds: common 40%, epic 45%, legendary 15%.
- After every hole except the last, each player drafts one, best score on that hole first. Tier: common 70%, epic 25%, legendary 5%; all cards from that tier.
- **Bump:** the center card has a 5% chance to be one tier up (legendary drafts can't bump). Marked "★ bumped".
- Augments last the run and stack unless unique. Skip is allowed. **Hexes are never offered in single player.**
- Play-testing: `?grant=0:sapling,1:the-bucket` in the URL gives augments to players (0-based) at the start of a run.

## Three kinds of augment

| Kind | Who it affects | Examples |
|---|---|---|
| **you** | Your own throws | Big Arm, Laser Line, Ghost Disc |
| **your course** | The course *as you play and see it*, only for you | The Bucket (basket 100% bigger, visibly), Magnet Basket (you see the pull ring), Forward Tee, Short Pin, Clear-Cut |
| **hex** | The course for *everyone else*, never you; you don't even see it | Sapling, Thicket, Pond Prank, Back Tees, Heckler, Shrink Ray |

Placed hexes (Sapling, Thicket, Pond Prank) and Clear-Cut are placed by their owner in a short top-down step before each hole, and last that hole. Every player's throws run against their own copy of the course: their trees, their ponds, their basket.

## Ghost line is earned

Roguelike players start with **no ghost line** (the aim line, target ring and power tick remain). Scout's Eye (+30%) and Flight Plan (+60%) reveal the start of the predicted flight; Oracle shows all of it plus the ±1σ wobble spread.

## Common (25)

| # | Name | Effect | Affects | |
|---|---|---|---|---|
| 1 | Grip Tape | +9% distance. | you | stacks |
| 2 | Steady Hands | 30% less aim wobble. | you | stacks |
| 3 | Fresh Plastic | +1.5 glide on every disc. | you | stacks |
| 4 | Chain Magnet | +12% chance the chains catch. | you | stacks |
| 5 | Soft Hands | Tap-in range +1 m (1 m → 2 m). | you | stacks |
| 6 | Pine Sap | Branches are 30% less likely to grab your disc. | you | stacks |
| 7 | Tee Pad Grip | +15% distance on tee throws. | you | stacks |
| 8 | Skip Shot | Discs slide 80% farther after landing. | you | stacks |
| 9 | Shot Shaper | Hyzer and anhyzer curve 40% more. | you | stacks |
| 10 | Smooth Release | The power meter moves 30% slower. | you | stacks |
| 11 | Putting Practice | Putts reach 25% farther and wobble 30% less. | you | stacks |
| 12 | Beat-In Plastic | −0.75 fade on every disc: straighter finishes. | you | stacks |
| 13 | Flippy Plastic | −0.75 turn on every disc: more turnover. | you | stacks |
| 14 | Overstable Stamp | +0.75 turn and +0.75 fade: dependable fade. | you | stacks |
| 15 | Reroll Token | +2 draft rerolls. | you | stacks |
| 16 | Glancing Blow | Trunk hits keep 70% more speed. | you | stacks |
| 17 | Wide Chains | Baskets are 10% bigger for you. | you | stacks |
| 18 | Run-Up | +3% distance, and throws past 90% power no longer add wobble. | you | unique |
| 19 | Lucky Leaves | 25% of branch hits miss you. | you | stacks |
| 20 | Second Wind | +3 throws before you must pick up. | you | stacks |
| 21 | Scout's Eye | See the first 40% of your ghost flight line. | you | stacks |
| 22 | Forward Tee | Your tee is 12 m closer on every hole (only for you). | your course | stacks |
| 23 | Sapling | Before each hole, plant a big bush near the basket. Opponents see and hit it; you never do. | **hex** | stacks |
| 24 | Heckler | Opponents' power meters run 22% faster. | **hex** | stacks |
| 25 | Back Tees | Opponents tee off 12 m farther back. | **hex** | stacks |

## Epic (20)

| # | Name | Effect | Affects | |
|---|---|---|---|---|
| 1 | Laser Line | Half the aim wobble on every throw and putt. | you | stacks |
| 2 | Chain Monster | +20% catch chance; half of cut-throughs get caught. | you | stacks |
| 3 | Mulligan | Once per hole, take a throw back right after it lands (M). | you | stacks |
| 4 | Ghost Disc | Each throw passes through the first tree it touches. | you | stacks |
| 5 | Big Arm | +15% distance. | you | stacks |
| 6 | Ace Hunter | +30% catch chance on throws from the tee. | you | stacks |
| 7 | Lucky Kicks | Trees kick your disc toward the basket. | you | unique |
| 8 | Magnet Basket | Discs stopping within 4 m of your basket slide 1.5 m closer. You see its pull. | your course | unique |
| 9 | Hover Plastic | +2 glide and −1 fade on every disc. | you | stacks |
| 10 | OB Insurance | No penalty strokes for OB or water. | you | unique |
| 11 | Wide Basket | Baskets are 20% bigger for you. | your course | stacks |
| 12 | Double Draft | Drafts show one more card. | you | stacks |
| 13 | Thread the Needle | Branches are 50% less likely to grab your disc. | you | stacks |
| 14 | Jump Putt | Putts reach 40% farther. | you | stacks |
| 15 | Sticky Plastic | Discs stop where they land; landing within 2 m of OB or water is saved. | you | unique |
| 16 | Flight Plan | See 60% more of your ghost flight line. | you | stacks |
| 17 | The Bucket | Your basket is 100% bigger, and looks it (only for you). | your course | unique |
| 18 | Clear-Cut | Before each hole, remove one tree, for you only. | your course | stacks |
| 19 | Thicket | Before each hole, plant 3 trees on the hole. Opponents see and hit them; you never do. | **hex** | stacks |
| 20 | Pond Prank | Before each hole, drop a pond on the hole. For opponents it is water (+1). | **hex** | stacks |

## Legendary (12)

| # | Name | Effect | Affects | |
|---|---|---|---|---|
| 1 | Phase Disc | Your disc passes through every tree. | you | unique |
| 2 | Homing Chains | Discs bend toward the basket late in flight. | you | stacks |
| 3 | Black Hole | Chains catch anything they touch; baskets 35% bigger. | you | unique |
| 4 | Golden Arm | +30% distance and no wobble when muscling a throw. | you | unique |
| 5 | Rewind | 2 mulligans per hole (M). | you | stacks |
| 6 | Perfect Form | Once per hole, arm a throw (P) that flies exactly on the ghost line. | you | stacks |
| 7 | Gimme Circle | Anything that stops within 5 m of the basket is in. | you | unique |
| 8 | Clone Disc | Every throw is thrown twice; you play the better one. | you | unique |
| 9 | Lumberjack | Trees your disc hits are cut down for the rest of the round. | you | unique |
| 10 | Oracle | See your whole ghost flight line, plus the spread of your wobble. | you | unique |
| 11 | Short Pin | Your basket sits 20% closer to the tee on every hole (only for you). | your course | unique |
| 12 | Shrink Ray | Opponents' baskets are 40% smaller. | **hex** | unique |

## Implementation notes

- Code: `src/rogue/powerups.ts` (catalog, draft), `src/rogue/course.ts` (per-player course: trees, ponds, tees, baskets, placement rules), `src/disc/mods.ts` (modifiers; `effectiveMods` applies opponents' hexes).
- Distance bonuses scale the power meter, so "+15%" is ~+15% at any power.
- Mulligan / Rewind: ~2.6 s "M: mulligan" window after a throw lands. Perfect Form: P arms a zero-error throw.
- Clone Disc keeps the better of two throws; Lumberjack removes hit trees for everyone (a hit hex tree is removed from the hole).

