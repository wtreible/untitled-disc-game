// Roguelike powerups and the between-holes draft. Proposed list, pending review (docs/11-roguelike.md).
import type { Mods } from '../disc/mods';

export type Tier = 'common' | 'epic' | 'legendary';
export const TIERS: Tier[] = ['common', 'epic', 'legendary'];

export interface Powerup {
  id: string;
  name: string;
  tier: Tier;
  text: string;
  /** Owning one already excludes it from future drafts. */
  unique?: boolean;
  /**
   * 'self': changes your own throws. 'personal': changes the course for you only.
   * 'hex': changes the course for everyone else (never you) — only offered with 2+ players.
   */
  kind: 'self' | 'personal' | 'hex';
  apply: (m: Mods) => void;
}

const P = (tier: Tier, id: string, name: string, text: string, apply: (m: Mods) => void, unique = false, kind: Powerup['kind'] = 'self'): Powerup => ({ id, name, tier, text, apply, unique, kind });
const personal = (tier: Tier, id: string, name: string, text: string, apply: (m: Mods) => void, unique = false) => P(tier, id, name, text, apply, unique, 'personal');
const hex = (tier: Tier, id: string, name: string, text: string, apply: (m: Mods) => void, unique = false) => P(tier, id, name, text, apply, unique, 'hex');

export const POWERUPS: Powerup[] = [
  // ---- Common (20): small, stackable stat bumps ----
  P('common', 'grip-tape', 'Grip Tape', '+6% distance.', (m) => { m.distance *= 1.06; }),
  P('common', 'steady-hands', 'Steady Hands', '20% less aim wobble.', (m) => { m.aimError *= 0.8; }),
  P('common', 'fresh-plastic', 'Fresh Plastic', '+1 glide on every disc.', (m) => { m.glide += 1; }),
  P('common', 'chain-magnet', 'Chain Magnet', '+8% chance the chains catch.', (m) => { m.catchBonus += 0.08; }),
  P('common', 'soft-hands', 'Soft Hands', 'Tap-in range +0.6 m (1 m → 1.6 m).', (m) => { m.tapIn += 0.6; }),
  P('common', 'pine-sap', 'Pine Sap', 'Branches are 20% less likely to grab your disc.', (m) => { m.branch *= 0.8; }),
  P('common', 'tee-grip', 'Tee Pad Grip', '+10% distance on tee throws.', (m) => { m.teeDistance *= 1.1; }),
  P('common', 'skip-shot', 'Skip Shot', 'Discs slide 50% farther after landing.', (m) => { m.skid *= 1.5; }),
  P('common', 'shot-shaper', 'Shot Shaper', 'Hyzer and anhyzer curve 25% more.', (m) => { m.shape *= 1.25; }),
  P('common', 'smooth-release', 'Smooth Release', 'The power meter moves 20% slower.', (m) => { m.meterSpeed *= 0.8; }),
  P('common', 'putting-practice', 'Putting Practice', 'Putts reach 15% farther and wobble 20% less.', (m) => { m.puttRange *= 1.15; m.puttAimError *= 0.8; }),
  P('common', 'beat-in', 'Beat-In Plastic', '−0.5 fade on every disc: straighter finishes.', (m) => { m.fade -= 0.5; }),
  P('common', 'flippy', 'Flippy Plastic', '−0.5 turn on every disc: more turnover.', (m) => { m.turn -= 0.5; }),
  P('common', 'overstable', 'Overstable Stamp', '+0.5 turn and +0.5 fade: dependable fade.', (m) => { m.turn += 0.5; m.fade += 0.5; }),
  P('common', 'reroll-token', 'Reroll Token', '+1 draft reroll.', (m) => { m.rerolls += 1; }),
  P('common', 'glancing-blow', 'Glancing Blow', 'Trunk hits keep 40% more speed.', (m) => { m.trunkKeep *= 1.4; }),
  P('common', 'wide-chains', 'Wide Chains', 'Baskets are 6% bigger for you.', (m) => { m.basketScale *= 1.06; }),
  P('common', 'run-up', 'Run-Up', 'Throws past 90% power no longer add wobble.', (m) => { m.noOverpowerWobble = true; }, true),
  P('common', 'lucky-leaves', 'Lucky Leaves', '15% of branch hits miss you.', (m) => { m.branchPass = 1 - (1 - m.branchPass) * 0.85; }),
  P('common', 'second-wind', 'Second Wind', '+2 throws before you must pick up.', (m) => { m.pickupBonus += 2; }),
  P('common', 'scouts-eye', "Scout's Eye", 'See the first 30% of your ghost flight line.', (m) => { m.ghost = Math.min(1, m.ghost + 0.3); }),
  personal('common', 'forward-tee', 'Forward Tee', 'Your tee is 8 m closer on every hole (only for you).', (m) => { m.teeForward += 8; }),
  hex('common', 'sapling', 'Sapling', 'Before each hole, plant a bush near the basket. Opponents see and hit it; you never do.', (m) => { m.hexSapling += 1; }),
  hex('common', 'heckler', 'Heckler', "Opponents' power meters run 15% faster.", (m) => { m.hexMeter *= 1.15; }),
  hex('common', 'back-tees', 'Back Tees', 'Opponents tee off 8 m farther back.', (m) => { m.hexBackTee += 8; }),

  // ---- Epic (15): bigger bumps and new tricks ----
  P('epic', 'laser-line', 'Laser Line', 'Half the aim wobble on every throw and putt.', (m) => { m.aimError *= 0.5; m.puttAimError *= 0.5; }),
  P('epic', 'chain-monster', 'Chain Monster', '+20% catch chance; half of cut-throughs get caught.', (m) => { m.catchBonus += 0.2; m.cutToCatch = 1 - (1 - m.cutToCatch) * 0.5; }),
  P('epic', 'mulligan', 'Mulligan', 'Once per hole, take a throw back right after it lands (M).', (m) => { m.mulligans += 1; }),
  P('epic', 'ghost-disc', 'Ghost Disc', 'Each throw passes through the first tree it touches.', (m) => { m.phaseTrees += 1; }),
  P('epic', 'big-arm', 'Big Arm', '+15% distance.', (m) => { m.distance *= 1.15; }),
  P('epic', 'ace-hunter', 'Ace Hunter', '+30% catch chance on throws from the tee.', (m) => { m.teeCatchBonus += 0.3; }),
  P('epic', 'lucky-kicks', 'Lucky Kicks', 'Trees kick your disc toward the basket.', (m) => { m.kickToward = true; }, true),
  personal('epic', 'magnet-basket', 'Magnet Basket', 'Discs stopping within 4 m of your basket slide 1.5 m closer. You see its pull.', (m) => { m.magnet = Math.max(m.magnet, 4); }, true),
  P('epic', 'hover', 'Hover Plastic', '+2 glide and −1 fade on every disc.', (m) => { m.glide += 2; m.fade -= 1; }),
  P('epic', 'ob-insurance', 'OB Insurance', 'No penalty strokes for OB or water.', (m) => { m.obInsurance = true; }, true),
  personal('epic', 'wide-basket', 'Wide Basket', 'Baskets are 20% bigger for you.', (m) => { m.basketScale *= 1.2; }),
  P('epic', 'double-draft', 'Double Draft', 'Drafts show one more card.', (m) => { m.extraCard += 1; }),
  P('epic', 'thread-the-needle', 'Thread the Needle', 'Branches are 50% less likely to grab your disc.', (m) => { m.branch *= 0.5; }),
  P('epic', 'jump-putt', 'Jump Putt', 'Putts reach 40% farther.', (m) => { m.puttRange *= 1.4; }),
  P('epic', 'sticky-plastic', 'Sticky Plastic', 'Discs stop where they land; landing within 2 m of OB or water is saved.', (m) => { m.sticky = true; }, true),
  P('epic', 'flight-plan', 'Flight Plan', 'See 60% more of your ghost flight line.', (m) => { m.ghost = Math.min(1, m.ghost + 0.6); }),
  personal('epic', 'the-bucket', 'The Bucket', 'Your basket is 100% bigger, and looks it (only for you).', (m) => { m.basketScale *= 2; }, true),
  personal('epic', 'clear-cut', 'Clear-Cut', 'Before each hole, remove one tree, for you only.', (m) => { m.clearCut += 1; }),
  hex('epic', 'thicket', 'Thicket', 'Before each hole, plant 3 trees on the hole. Opponents see and hit them; you never do.', (m) => { m.hexThicket += 3; }),
  hex('epic', 'pond-prank', 'Pond Prank', 'Before each hole, drop a pond on the hole. For opponents it is water (+1).', (m) => { m.hexPond += 1; }),

  // ---- Legendary (9): rule-breakers ----
  P('legendary', 'phase-disc', 'Phase Disc', 'Your disc passes through every tree.', (m) => { m.phaseTrees = Infinity; }, true),
  P('legendary', 'homing-chains', 'Homing Chains', 'Discs bend toward the basket late in flight.', (m) => { m.homing += 1; }),
  P('legendary', 'black-hole', 'Black Hole', 'Chains catch anything they touch; baskets 35% bigger.', (m) => { m.catchBonus += 1; m.basketScale *= 1.35; }, true),
  P('legendary', 'golden-arm', 'Golden Arm', '+30% distance and no wobble when muscling a throw.', (m) => { m.distance *= 1.3; m.noOverpowerWobble = true; }, true),
  P('legendary', 'rewind', 'Rewind', '2 mulligans per hole (M).', (m) => { m.mulligans += 2; }),
  P('legendary', 'perfect-form', 'Perfect Form', 'Once per hole, arm a throw (P) that flies exactly on the ghost line.', (m) => { m.perfectForm += 1; }),
  P('legendary', 'gimme-circle', 'Gimme Circle', 'Anything that stops within 5 m of the basket is in.', (m) => { m.gimme = Math.max(m.gimme, 5); }, true),
  P('legendary', 'clone-disc', 'Clone Disc', 'Every throw is thrown twice; you play the better one.', (m) => { m.clone = true; }, true),
  P('legendary', 'lumberjack', 'Lumberjack', 'Trees your disc hits are cut down for the rest of the round.', (m) => { m.treeChopper = true; }, true),
  P('legendary', 'oracle', 'Oracle', 'See your whole ghost flight line, plus the spread of your wobble.', (m) => { m.ghost = 1; m.ghostCone = true; }, true),
  personal('legendary', 'short-pin', 'Short Pin', 'Your basket sits 20% closer to the tee on every hole (only for you).', (m) => { m.pinCloser += 0.2; }, true),
  hex('legendary', 'shrink-ray', 'Shrink Ray', "Opponents' baskets are 40% smaller.", (m) => { m.hexShrink *= 0.6; }, true),
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
 * Draw `n` distinct cards of one tier (excluding uniques the player owns). The center card has a
 * BUMP_CHANCE of coming from the next tier up instead.
 */
export function drawOffer(rng: () => number, owned: string[], n = 3, tier: Tier = rollTier(rng), players = 2): Offer {
  const avail = (t: Tier, taken: Powerup[]) =>
    POWERUPS.filter((p) => p.tier === t && !(p.unique && owned.includes(p.id)) && !taken.includes(p) && (players > 1 || p.kind !== 'hex'));
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
