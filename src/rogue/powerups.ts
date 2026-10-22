// Roguelike powerups and the between-holes draft. Proposed list, pending review (docs/11-roguelike.md).
import type { Mods } from '../disc/mods';

export type Tier = 'common' | 'epic' | 'legendary';
export const TIERS: Tier[] = ['common', 'epic', 'legendary'];

/** What an augment is about: the draft cards, the browser and the side panel group by it. */
export type Category = 'power' | 'accuracy' | 'flight' | 'putting' | 'trees' | 'course' | 'hex' | 'luck';
export const CATEGORIES: { id: Category; label: string; blurb: string }[] = [
  { id: 'power', label: 'Power', blurb: 'Distance and the power meter.' },
  { id: 'accuracy', label: 'Accuracy & Sight', blurb: 'Less wobble, and seeing your flight before you throw.' },
  { id: 'flight', label: 'Flight & Plastic', blurb: 'Flight numbers, shaping, skids and wind.' },
  { id: 'putting', label: 'Putting & Chains', blurb: 'Catching, tap-ins and putt range.' },
  { id: 'trees', label: 'Trees & Hazards', blurb: 'Branches, trunks, OB and water.' },
  { id: 'course', label: 'Your Course', blurb: 'Changes to the course that only you play.' },
  { id: 'hex', label: 'Hexes', blurb: 'Changes to everyone else’s course, never yours.' },
  { id: 'luck', label: 'Second Chances', blurb: 'Mulligans, rerolls and better drafts.' },
];

export interface Powerup {
  id: string;
  name: string;
  tier: Tier;
  category: Category;
  text: string;
  /** Owning one already excludes it from future drafts. */
  unique?: boolean;
  /**
   * 'self': changes your own throws. 'personal': changes the course for you only.
   * 'hex': changes the course for everyone else (never you) — only offered with 2+ players.
   */
  kind: 'self' | 'personal' | 'hex';
  /** Only offered when the round uses bag building. */
  needsBag?: boolean;
  apply: (m: Mods) => void;
}

const P = (tier: Tier, category: Category, id: string, name: string, text: string, apply: (m: Mods) => void, unique = false, kind: Powerup['kind'] = 'self'): Powerup => ({ id, name, tier, category, text, apply, unique, kind });
const personal = (tier: Tier, id: string, name: string, text: string, apply: (m: Mods) => void, unique = false) => P(tier, 'course', id, name, text, apply, unique, 'personal');
const hex = (tier: Tier, id: string, name: string, text: string, apply: (m: Mods) => void, unique = false) => P(tier, 'hex', id, name, text, apply, unique, 'hex');

// Values stepped up ~20–30% on 2026-10-21 (docs/11-roguelike.md).
export const POWERUPS: Powerup[] = [
  // ---- Common: small, stackable stat bumps ----
  P('common', 'power', 'grip-tape', 'Grip Tape', '+11% distance.', (m) => { m.distance *= 1.11; }),
  P('common', 'accuracy', 'steady-hands', 'Steady Hands', '35% less aim wobble.', (m) => { m.aimError *= 0.65; }),
  P('common', 'flight', 'fresh-plastic', 'Fresh Plastic', '+2 glide on every disc.', (m) => { m.glide += 2; }),
  P('common', 'putting', 'chain-magnet', 'Chain Magnet', '+15% chance the chains catch.', (m) => { m.catchBonus += 0.15; }),
  P('common', 'putting', 'soft-hands', 'Soft Hands', 'Tap-in range +1.5 m (1 m → 2.5 m).', (m) => { m.tapIn += 1.5; }),
  P('common', 'trees', 'pine-sap', 'Pine Sap', 'Branches are 40% less likely to grab your disc.', (m) => { m.branch *= 0.6; }),
  P('common', 'power', 'tee-grip', 'Tee Pad Grip', '+18% distance on tee throws.', (m) => { m.teeDistance *= 1.18; }),
  P('common', 'flight', 'skip-shot', 'Skip Shot', 'Discs slide twice as far after landing.', (m) => { m.skid *= 2; }),
  P('common', 'flight', 'shot-shaper', 'Shot Shaper', 'Hyzer and anhyzer curve 50% more.', (m) => { m.shape *= 1.5; }),
  P('common', 'power', 'smooth-release', 'Smooth Release', 'The power meter moves 35% slower.', (m) => { m.meterSpeed *= 0.65; }),
  P('common', 'putting', 'putting-practice', 'Putting Practice', 'Putts reach 30% farther and wobble 35% less.', (m) => { m.puttRange *= 1.3; m.puttAimError *= 0.65; }),
  P('common', 'flight', 'beat-in', 'Beat-In Plastic', '−1 fade on every disc: straighter finishes.', (m) => { m.fade -= 1; }),
  P('common', 'flight', 'flippy', 'Flippy Plastic', '−1 turn on every disc: more turnover.', (m) => { m.turn -= 1; }),
  P('common', 'flight', 'overstable', 'Overstable Stamp', '+1 turn and +1 fade: dependable fade.', (m) => { m.turn += 1; m.fade += 1; }),
  P('common', 'luck', 'reroll-token', 'Reroll Token', '+3 draft rerolls.', (m) => { m.rerolls += 3; }),
  P('common', 'trees', 'glancing-blow', 'Glancing Blow', 'Trunk hits keep 90% more speed.', (m) => { m.trunkKeep *= 1.9; }),
  P('common', 'putting', 'wide-chains', 'Wide Chains', 'Baskets are 13% bigger for you.', (m) => { m.basketScale *= 1.13; }),
  { ...P('common', 'flight', 'bag-pocket', 'Bag Pocket', 'Carry one more disc: pick it before the next hole.', (m) => { m.bagSlots += 1; }), needsBag: true },
  P('common', 'power', 'run-up', 'Run-Up', '+5% distance, and throws past 90% power no longer add wobble.', (m) => { m.noOverpowerWobble = true; m.distance *= 1.05; }, true),
  P('common', 'trees', 'lucky-leaves', 'Lucky Leaves', '30% of branch hits miss you.', (m) => { m.branchPass = 1 - (1 - m.branchPass) * 0.7; }),
  P('common', 'luck', 'second-wind', 'Second Wind', '+4 throws before you must pick up.', (m) => { m.pickupBonus += 4; }),
  P('common', 'accuracy', 'scouts-eye', "Scout's Eye", 'See the first 50% of your ghost flight line.', (m) => { m.ghost = Math.min(1, m.ghost + 0.5); }),
  P('common', 'flight', 'wind-cheater', 'Wind Cheater', 'Wind pushes your disc around 40% less.', (m) => { m.windScale *= 0.6; }),
  P('common', 'accuracy', 'caddie', 'Caddie', '15% less wobble on throws and putts, and +0.5 m tap-in range.', (m) => { m.aimError *= 0.85; m.puttAimError *= 0.85; m.tapIn += 0.5; }),
  personal('common', 'forward-tee', 'Forward Tee', 'Your tee is 15 m closer on every hole (only for you).', (m) => { m.teeForward += 15; }),
  hex('common', 'sapling', 'Sapling', 'Before each hole, plant a big bush near the basket. Opponents see and hit it; you never do.', (m) => { m.hexSapling += 1; }),
  hex('common', 'heckler', 'Heckler', "Opponents' power meters run 28% faster.", (m) => { m.hexMeter *= 1.28; }),
  hex('common', 'back-tees', 'Back Tees', 'Opponents tee off 15 m farther back.', (m) => { m.hexBackTee += 15; }),
  hex('common', 'crosswind', 'Crosswind', 'Opponents feel 40% more wind.', (m) => { m.hexWind *= 1.4; }),

  // ---- Epic: bigger bumps and new tricks ----
  P('epic', 'accuracy', 'laser-line', 'Laser Line', '55% less aim wobble on every throw and putt.', (m) => { m.aimError *= 0.45; m.puttAimError *= 0.45; }),
  P('epic', 'putting', 'chain-monster', 'Chain Monster', '+25% catch chance; 60% of cut-throughs get caught.', (m) => { m.catchBonus += 0.25; m.cutToCatch = 1 - (1 - m.cutToCatch) * 0.4; }),
  P('epic', 'luck', 'mulligan', 'Mulligan', 'Once per hole, take a throw back right after it lands (M).', (m) => { m.mulligans += 1; }),
  P('epic', 'trees', 'ghost-disc', 'Ghost Disc', 'Each throw passes through the first 2 trees it touches.', (m) => { m.phaseTrees += 2; }),
  P('epic', 'power', 'big-arm', 'Big Arm', '+19% distance.', (m) => { m.distance *= 1.19; }),
  P('epic', 'putting', 'ace-hunter', 'Ace Hunter', '+38% catch chance on throws from the tee.', (m) => { m.teeCatchBonus += 0.38; }),
  P('epic', 'trees', 'lucky-kicks', 'Lucky Kicks', 'Trees kick your disc toward the basket, a bit harder.', (m) => { m.kickToward = true; m.kickKeep *= 1.3; }, true),
  P('epic', 'flight', 'hover', 'Hover Plastic', '+2.5 glide and −1.25 fade on every disc.', (m) => { m.glide += 2.5; m.fade -= 1.25; }),
  P('epic', 'trees', 'ob-insurance', 'OB Insurance', 'No penalty strokes for OB or water.', (m) => { m.obInsurance = true; }, true),
  personal('epic', 'wide-basket', 'Wide Basket', 'Baskets are 25% bigger for you.', (m) => { m.basketScale *= 1.25; }),
  P('epic', 'luck', 'double-draft', 'Double Draft', 'Drafts show one more card.', (m) => { m.extraCard += 1; }),
  P('epic', 'trees', 'thread-the-needle', 'Thread the Needle', 'Branches are 60% less likely to grab your disc.', (m) => { m.branch *= 0.4; }),
  P('epic', 'putting', 'jump-putt', 'Jump Putt', 'Putts reach 50% farther.', (m) => { m.puttRange *= 1.5; }),
  P('epic', 'flight', 'sticky-plastic', 'Sticky Plastic', 'Discs stop where they land; landing within 2 m of OB or water is saved.', (m) => { m.sticky = true; }, true),
  P('epic', 'accuracy', 'flight-plan', 'Flight Plan', 'See 75% more of your ghost flight line.', (m) => { m.ghost = Math.min(1, m.ghost + 0.75); }),
  P('epic', 'flight', 'featherweight', 'Featherweight', '+3 glide, and wind pushes your disc around 25% less.', (m) => { m.glide += 3; m.windScale *= 0.75; }),
  personal('epic', 'the-bucket', 'The Bucket', 'Your basket is 100% bigger, and looks it (only for you).', (m) => { m.basketScale *= 2; }, true),
  personal('epic', 'clear-cut', 'Clear-Cut', 'Before each hole, remove one tree, for you only.', (m) => { m.clearCut += 1; }),
  personal('epic', 'personal-tailwind', 'Personal Tailwind', 'For you, the wind always blows toward the basket (same strength).', (m) => { m.tailwind = true; }, true),
  hex('epic', 'thicket', 'Thicket', 'Before each hole, plant 4 trees on the hole. Opponents see and hit them; you never do.', (m) => { m.hexThicket += 4; }),
  hex('epic', 'pond-prank', 'Pond Prank', 'Before each hole, drop a pond on the hole. For opponents it is water (+1).', (m) => { m.hexPond += 1; }),
  hex('epic', 'storm-caller', 'Storm Caller', 'Opponents feel 80% more wind.', (m) => { m.hexWind *= 1.8; }),

  // ---- Legendary: rule-breakers, most of them visible on the course ----
  P('legendary', 'trees', 'phase-disc', 'Phase Disc', 'Your disc passes through every tree, and you see through them.', (m) => { m.phaseTrees = Infinity; }, true),
  P('legendary', 'flight', 'homing-chains', 'Homing Chains', 'Discs bend toward the basket late in flight.', (m) => { m.homing += 1.25; }),
  P('legendary', 'putting', 'black-hole', 'Black Hole', 'Chains catch anything they touch; baskets 45% bigger. A vortex swirls in your chains.', (m) => { m.catchBonus += 1; m.basketScale *= 1.45; }, true),
  P('legendary', 'power', 'golden-arm', 'Golden Arm', '+35% distance, no wobble when muscling a throw, and a golden disc.', (m) => { m.distance *= 1.35; m.noOverpowerWobble = true; }, true),
  P('legendary', 'luck', 'rewind', 'Rewind', '3 mulligans per hole (M).', (m) => { m.mulligans += 3; }),
  P('legendary', 'accuracy', 'perfect-form', 'Perfect Form', 'Twice per hole, arm a throw (P) that flies exactly on the ghost line.', (m) => { m.perfectForm += 2; }),
  P('legendary', 'putting', 'gimme-circle', 'Gimme Circle', 'Anything that stops within 6 m of the basket is in. You see the circle.', (m) => { m.gimme = Math.max(m.gimme, 6); }, true),
  P('legendary', 'luck', 'clone-disc', 'Clone Disc', 'Every throw is thrown twice; you play the better one.', (m) => { m.clone = true; }, true),
  P('legendary', 'trees', 'lumberjack', 'Lumberjack', 'Trees your disc hits are cut down for the rest of the round, leaving stumps.', (m) => { m.treeChopper = true; }, true),
  P('legendary', 'accuracy', 'oracle', 'Oracle', 'See your whole ghost flight line, plus the spread of your wobble.', (m) => { m.ghost = 1; m.ghostCone = true; }, true),
  P('legendary', 'trees', 'pinball-wizard', 'Pinball Wizard', 'Trees bounce your disc on toward the basket: it keeps most of its speed and keeps flying.', (m) => { m.trunkKeep *= 3; m.kickToward = true; m.kickKeep *= 2.2; m.liveKicks = true; }, true),
  personal('legendary', 'magnet-basket', 'Magnet Basket', 'A magnet on your basket: discs stopping within 6 m slide up to 3 m closer.', (m) => { m.magnet = Math.max(m.magnet, 6); m.magnetPull = Math.max(m.magnetPull, 3); }, true),
  personal('legendary', 'short-pin', 'Short Pin', 'Your basket sits 25% closer to the tee on every hole (only for you).', (m) => { m.pinCloser += 0.25; }, true),
  personal('legendary', 'weather-control', 'Weather Control', 'No wind for you, and twice the wind for everyone else.', (m) => { m.windScale = 0; m.hexWind *= 2; }, true),
  hex('legendary', 'shrink-ray', 'Shrink Ray', "Opponents' baskets are 45% smaller.", (m) => { m.hexShrink *= 0.55; }, true),
];

export const byId = (id: string) => POWERUPS.find((p) => p.id === id)!; // undefined for unknown ids

/** Tier of the draft after a hole. */
export const TIER_WEIGHTS: Record<Tier, number> = { common: 0.7, epic: 0.25, legendary: 0.05 };
/** The starter augment, drafted before hole 1, rolls better tiers. */
export const STARTER_WEIGHTS: Record<Tier, number> = { common: 0.4, epic: 0.45, legendary: 0.15 };
/** Chance the center card of a draft is bumped one tier up. */
export const BUMP_CHANCE = 0.05;

export function rollTier(rng: () => number, w: Record<Tier, number> = TIER_WEIGHTS): Tier {
  const r = rng();
  if (r < w.legendary) return 'legendary';
  if (r < w.legendary + w.epic) return 'epic';
  return 'common';
}

export interface Offer {
  tier: Tier;
  cards: Powerup[];
  /** Index of the bumped card, if any. */
  bumped: number | null;
}

/**
 * Draw `n` distinct cards of one tier (excluding uniques the player owns, hexes when playing alone
 * and bag augments without bag building). The center card has a
 * BUMP_CHANCE of coming from the next tier up instead.
 */
export function drawOffer(rng: () => number, owned: string[], n = 3, tier: Tier = rollTier(rng), players = 2, bag = false): Offer {
  const avail = (t: Tier, taken: Powerup[]) =>
    POWERUPS.filter((p) => p.tier === t && !(p.unique && owned.includes(p.id)) && !taken.includes(p) && (players > 1 || p.kind !== 'hex') && (bag || !p.needsBag));
  const pick = (list: Powerup[]) => list[Math.floor(rng() * list.length)];
  const cards: Powerup[] = [];
  for (let i = 0; i < n; i++) {
    const list = avail(tier, cards);
    if (list.length) cards.push(pick(list));
  }
  let bumped: number | null = null;
  const center = Math.floor((cards.length - 1) / 2);
  const up = TIERS[TIERS.indexOf(tier) + 1];
  if (up && cards.length && rng() < BUMP_CHANCE) {
    const list = avail(up, cards);
    if (list.length) { cards[center] = pick(list); bumped = center; }
  }
  return { tier, cards, bumped };
}
