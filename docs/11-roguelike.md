# Crazy mode (roguelike)

Status: playable (2026-10-21: values stepped up ~20–30%, 8 new augments, categories, customizable drafts). Every augment below is implemented and tested.

Turned on with the **Crazy mode** switch on the main menu; works on any course and always plays the full course (18 holes at Tali, 9 at Mini Golf Madness). The normal disc golf modes have no augments and show the full ghost line.

## Draft

Set up on the main menu with Crazy mode on (the host's setup, online). Defaults in brackets:

- **Cards per draft** 2–5 [3]; Double Draft adds one. **Picks per draft** 1–3 [1]: with 2, players draft A, B, A, B.
- **Draft after** every hole, every 2nd or every 3rd [every hole]; never after the last hole. Best score on the hole drafts first.
- **Starter pick** before hole 1 [on], with boosted odds (epic ×1.8, legendary ×3, then normalized).
- **Tier odds** as relative weights [70 / 25 / 5]. Presets: Classic 70/25/5, Spicy 40/40/20, Wild 10/40/50, All legendary 0/0/1.
- **The tier is rolled once per draft for the whole group:** the first offer sets it; everyone after (and every reroll) gets the same tier.
- **Bump:** the center card has a 5% chance to be one tier up (legendary drafts can't bump). Marked "★ bumped".
- Augments last the run and stack unless unique. Skip is allowed. **Hexes are never offered in single player.**
- The rules are the round's first event (`rules`), so replays and friends online get the same ones.
- Play-testing: `?grant=0:sapling,1:the-bucket` in the URL gives augments to players (0-based) at the start of a run.

## Seeing augments

- **Side panel** (in play): the current player's augments by category (stacks as ×N) and the hexes others put on them. Hover a card for the full text.
- **Augment browser:** "Browse all augments" on the menu, or "Augments" in the pause menu mid-round (it marks who has what). By category, filterable by tier.
- **Scorecards** list everyone's augments as chips.
- **Legendaries show on the course** for their player: Magnet Basket's magnet on the basket, Black Hole's vortex in the chains, Gimme Circle's gold ring, Phase Disc's see-through trees, Lumberjack's stumps (for everyone), Golden Arm's gold disc.

## Three kinds of augment

| Kind | Who it affects | Examples |
|---|---|---|
| **you** | Your own throws | Big Arm, Laser Line, Ghost Disc |
| **your course** | The course *as you play and see it*, only for you | The Bucket (basket 100% bigger, visibly), Magnet Basket (you see the pull ring), Forward Tee, Short Pin, Clear-Cut |
| **hex** | The course for *everyone else*, never you; you don't even see it | Sapling, Thicket, Pond Prank, Back Tees, Heckler, Shrink Ray |

Placed hexes (Sapling, Thicket, Pond Prank) and Clear-Cut are placed by their owner in a short top-down step before each hole, and last that hole. Every player's throws run against their own copy of the course: their trees, their ponds, their basket.

## Ghost line is earned

Roguelike players start with **no ghost line** (the aim line, target ring and power tick remain). Scout's Eye (+50%) and Flight Plan (+75%) reveal the start of the predicted flight; Oracle shows all of it plus the ±1σ wobble spread.

## Catalog (66: 29 common, 22 epic, 15 legendary)

Generated from `src/rogue/powerups.ts` (2026-10-21). “Unique” augments can be owned once; the rest stack.

### Power

Distance and the power meter.

| Tier | Augment | Effect |
|---|---|---|
| common | Grip Tape | +11% distance. |
| common | Tee Pad Grip | +18% distance on tee throws. |
| common | Smooth Release | The power meter moves 35% slower. |
| common | Run-Up (unique) | +5% distance, and throws past 90% power no longer add wobble. |
| epic | Big Arm | +19% distance. |
| legendary | Golden Arm (unique) | +35% distance, no wobble when muscling a throw, and a golden disc. |

### Accuracy & Sight

Less wobble, and seeing your flight before you throw.

| Tier | Augment | Effect |
|---|---|---|
| common | Steady Hands | 35% less aim wobble. |
| common | Scout's Eye | See the first 50% of your ghost flight line. |
| common | Caddie | 15% less wobble on throws and putts, and +0.5 m tap-in range. |
| epic | Laser Line | 55% less aim wobble on every throw and putt. |
| epic | Flight Plan | See 75% more of your ghost flight line. |
| legendary | Perfect Form | Twice per hole, arm a throw (P) that flies exactly on the ghost line. |
| legendary | Oracle (unique) | See your whole ghost flight line, plus the spread of your wobble. |

### Flight & Plastic

Flight numbers, shaping, skids and wind.

| Tier | Augment | Effect |
|---|---|---|
| common | Fresh Plastic | +2 glide on every disc. |
| common | Skip Shot | Discs slide twice as far after landing. |
| common | Shot Shaper | Hyzer and anhyzer curve 50% more. |
| common | Beat-In Plastic | −1 fade on every disc: straighter finishes. |
| common | Flippy Plastic | −1 turn on every disc: more turnover. |
| common | Overstable Stamp | +1 turn and +1 fade: dependable fade. |
| common | Wind Cheater | Wind pushes your disc around 40% less. |
| common | Bag Pocket | Carry one more disc: pick it before the next hole. Only offered with bag building. |
| epic | Hover Plastic | +2.5 glide and −1.25 fade on every disc. |
| epic | Sticky Plastic (unique) | Discs stop where they land; landing within 2 m of OB or water is saved. |
| epic | Featherweight | +3 glide, and wind pushes your disc around 25% less. |
| legendary | Homing Chains | Discs bend toward the basket late in flight. |

### Putting & Chains

Catching, tap-ins and putt range.

| Tier | Augment | Effect |
|---|---|---|
| common | Chain Magnet | +15% chance the chains catch. |
| common | Soft Hands | Tap-in range +1.5 m (1 m → 2.5 m). |
| common | Putting Practice | Putts reach 30% farther and wobble 35% less. |
| common | Wide Chains | Baskets are 13% bigger for you. |
| epic | Chain Monster | +25% catch chance; 60% of cut-throughs get caught. |
| epic | Ace Hunter | +38% catch chance on throws from the tee. |
| epic | Jump Putt | Putts reach 50% farther. |
| legendary | Black Hole (unique) | Chains catch anything they touch; baskets 45% bigger. A vortex swirls in your chains. |
| legendary | Gimme Circle (unique) | Anything that stops within 6 m of the basket is in. You see the circle. |

### Trees & Hazards

Branches, trunks, OB and water.

| Tier | Augment | Effect |
|---|---|---|
| common | Pine Sap | Branches are 40% less likely to grab your disc. |
| common | Glancing Blow | Trunk hits keep 90% more speed. |
| common | Lucky Leaves | 30% of branch hits miss you. |
| epic | Ghost Disc | Each throw passes through the first 2 trees it touches. |
| epic | Lucky Kicks (unique) | Trees kick your disc toward the basket, a bit harder. |
| epic | OB Insurance (unique) | No penalty strokes for OB or water. |
| epic | Thread the Needle | Branches are 60% less likely to grab your disc. |
| legendary | Phase Disc (unique) | Your disc passes through every tree, and you see through them. |
| legendary | Lumberjack (unique) | Trees your disc hits are cut down for the rest of the round, leaving stumps. |
| legendary | Pinball Wizard (unique) | Trees bounce your disc on toward the basket: it keeps most of its speed and keeps flying. |

### Your Course

Changes to the course that only you play.

| Tier | Augment | Effect |
|---|---|---|
| common | Forward Tee | Your tee is 15 m closer on every hole (only for you). |
| epic | Wide Basket | Baskets are 25% bigger for you. |
| epic | The Bucket (unique) | Your basket is 100% bigger, and looks it (only for you). |
| epic | Clear-Cut | Before each hole, remove one tree, for you only. |
| epic | Personal Tailwind (unique) | For you, the wind always blows toward the basket (same strength). |
| legendary | Magnet Basket (unique) | A magnet on your basket: discs stopping within 6 m slide up to 3 m closer. |
| legendary | Short Pin (unique) | Your basket sits 25% closer to the tee on every hole (only for you). |
| legendary | Weather Control (unique) | No wind for you, and twice the wind for everyone else. |

### Hexes

Changes to everyone else’s course, never yours.

| Tier | Augment | Effect |
|---|---|---|
| common | Sapling | Before each hole, plant a big bush near the basket. Opponents see and hit it; you never do. |
| common | Heckler | Opponents' power meters run 28% faster. |
| common | Back Tees | Opponents tee off 15 m farther back. |
| common | Crosswind | Opponents feel 40% more wind. |
| epic | Thicket | Before each hole, plant 4 trees on the hole. Opponents see and hit them; you never do. |
| epic | Pond Prank | Before each hole, drop a pond on the hole. For opponents it is water (+1). |
| epic | Storm Caller | Opponents feel 80% more wind. |
| legendary | Shrink Ray (unique) | Opponents' baskets are 45% smaller. |

### Second Chances

Mulligans, rerolls and better drafts.

| Tier | Augment | Effect |
|---|---|---|
| common | Reroll Token | +3 draft rerolls. |
| common | Second Wind | +4 throws before you must pick up. |
| epic | Mulligan | Once per hole, take a throw back right after it lands (M). |
| epic | Double Draft | Drafts show one more card. |
| legendary | Rewind | 3 mulligans per hole (M). |
| legendary | Clone Disc (unique) | Every throw is thrown twice; you play the better one. |

## Implementation notes

- Code: `src/rogue/powerups.ts` (catalog, draft), `src/rogue/course.ts` (per-player course: trees, ponds, tees, baskets, placement rules), `src/disc/mods.ts` (modifiers; `effectiveMods` applies opponents' hexes).
- Distance bonuses scale the power meter, so "+15%" is ~+15% at any power.
- Mulligan / Rewind: ~2.6 s "M: mulligan" window after a throw lands. Perfect Form: P arms a zero-error throw.
- Clone Disc keeps the better of two throws; Lumberjack removes hit trees for everyone (a hit hex tree is removed from the hole).

