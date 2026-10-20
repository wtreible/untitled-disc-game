# Roguelike run (separate mode)

Status: **proposal under review** (2026-10-20). The draft mechanic and every powerup below are implemented and tested, so the list can be play-tested. Expect names, numbers and membership to change.

Selected as "Disc golf: Roguelike run (Tali simple)" on the setup screen. The normal disc golf modes have no powerups.

## Draft

- After every hole except the last, each player drafts one powerup, best score on that hole first.
- One tier is rolled per draft: common 70%, epic 25%, legendary 5%. All 3 cards come from that tier.
- **Bump:** the center card has a 5% chance to come from the next tier up (common → epic, epic → legendary; legendary drafts can't bump). Marked "★ bumped".
- Powerups last the whole run and stack unless marked unique; owned uniques aren't offered again. Skip is allowed.
- Code: `src/rogue/powerups.ts` (catalog + draft), `src/disc/mods.ts` (the modifier set the flight model reads).

## Common (20)

| # | Name | Effect | |
|---|---|---|---|
| 1 | Grip Tape | +6% distance. | stacks |
| 2 | Steady Hands | 20% less aim wobble. | stacks |
| 3 | Fresh Plastic | +1 glide on every disc. | stacks |
| 4 | Chain Magnet | +8% chance the chains catch. | stacks |
| 5 | Soft Hands | Tap-in range +0.6 m (1 m → 1.6 m). | stacks |
| 6 | Pine Sap | Branches are 20% less likely to grab your disc. | stacks |
| 7 | Tee Pad Grip | +10% distance on tee throws. | stacks |
| 8 | Skip Shot | Discs slide 50% farther after landing. | stacks |
| 9 | Shot Shaper | Hyzer and anhyzer curve 25% more. | stacks |
| 10 | Smooth Release | The power meter moves 20% slower. | stacks |
| 11 | Putting Practice | Putts reach 15% farther and wobble 20% less. | stacks |
| 12 | Beat-In Plastic | −0.5 fade on every disc: straighter finishes. | stacks |
| 13 | Flippy Plastic | −0.5 turn on every disc: more turnover. | stacks |
| 14 | Overstable Stamp | +0.5 turn and +0.5 fade: dependable fade. | stacks |
| 15 | Reroll Token | +1 draft reroll. | stacks |
| 16 | Glancing Blow | Trunk hits keep 40% more speed. | stacks |
| 17 | Wide Chains | Baskets are 6% bigger for you. | stacks |
| 18 | Run-Up | Throws past 90% power no longer add wobble. | unique |
| 19 | Lucky Leaves | 15% of branch hits miss you. | stacks |
| 20 | Second Wind | +2 throws before you must pick up. | stacks |

## Epic (15)

| # | Name | Effect | |
|---|---|---|---|
| 1 | Laser Line | Half the aim wobble on every throw and putt. | stacks |
| 2 | Chain Monster | +20% catch chance; half of cut-throughs get caught. | stacks |
| 3 | Mulligan | Once per hole, take a throw back right after it lands (M). | stacks |
| 4 | Ghost Disc | Each throw passes through the first tree it touches. | stacks |
| 5 | Big Arm | +15% distance. | stacks |
| 6 | Ace Hunter | +30% catch chance on throws from the tee. | stacks |
| 7 | Lucky Kicks | Trees kick your disc toward the basket. | unique |
| 8 | Magnet Basket | Discs stopping within 4 m of the basket slide 1.5 m closer. | unique |
| 9 | Hover Plastic | +2 glide and −1 fade on every disc. | stacks |
| 10 | OB Insurance | No penalty strokes for OB or water. | unique |
| 11 | Wide Basket | Baskets are 20% bigger for you. | stacks |
| 12 | Double Draft | Drafts show one more card. | stacks |
| 13 | Thread the Needle | Branches are 50% less likely to grab your disc. | stacks |
| 14 | Jump Putt | Putts reach 40% farther. | stacks |
| 15 | Sticky Plastic | Discs stop where they land; landing within 2 m of OB or water is saved. | unique |

## Legendary (9)

| # | Name | Effect | |
|---|---|---|---|
| 1 | Phase Disc | Your disc passes through every tree. | unique |
| 2 | Homing Chains | Discs bend toward the basket late in flight. | stacks |
| 3 | Black Hole | Chains catch anything they touch; baskets 35% bigger. | unique |
| 4 | Golden Arm | +30% distance and no wobble when muscling a throw. | unique |
| 5 | Rewind | 2 mulligans per hole (M). | stacks |
| 6 | Perfect Form | Once per hole, arm a throw (P) that flies exactly on the ghost line. | stacks |
| 7 | Gimme Circle | Anything that stops within 5 m of the basket is in. | unique |
| 8 | Clone Disc | Every throw is thrown twice; you play the better one. | unique |
| 9 | Lumberjack | Trees your disc hits are cut down for the rest of the round. | unique |

## Implementation notes

- Distance bonuses scale the power meter (which maps ~linearly to distance), so "+15%" is ~+15% at any power. Past a full meter, release speed follows the measured full-power sensitivity.
- Mulligan / Rewind: after a throw lands, a ~2.6 s window shows "M: mulligan"; pressing M restores the player's lie and strokes. Not offered after holing out.
- Perfect Form: P arms it for the next throw, which uses zero execution error (exactly the ghost line).
- Clone Disc simulates two throws and keeps the better one (holed, else closer to the basket, with penalties counting 30 m).
- Lumberjack removes trees for everyone for the rest of the run (3D instance hidden, map symbols redrawn).

## Open questions for review

- Base game currently shows the full ghost flight line. A roguelike usually makes information a reward (e.g. short ghost line by default, powerups to extend it). Change the base?
- Run structure: is a run just 18 holes, or should there be lives / a par target that ends the run early?
- Should drafts be per player (current) or one shared pick in co-op?

