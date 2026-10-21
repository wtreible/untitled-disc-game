// Per-player modifiers. Neutral values = the base game; roguelike powerups change them
// (src/rogue/powerups.ts). Multipliers (×) stack by multiplying, adders (+) by adding.
export interface Mods {
  /** × distance (applied as release speed ∝ distance^0.27, matching the model's v^3.7). */
  distance: number;
  /** × distance on tee throws only. */
  teeDistance: number;
  /** × aim/power wobble on throws, and on putts. */
  aimError: number;
  puttAimError: number;
  /** Muscling past 90% no longer adds wobble. */
  noOverpowerWobble: boolean;
  /** + flight numbers on every disc. */
  glide: number;
  turn: number;
  fade: number;
  /** × effect of hyzer/anhyzer release angle. */
  shape: number;
  /** + chains catch probability (1 = always). */
  catchBonus: number;
  /** + catch probability on throws from the tee. */
  teeCatchBonus: number;
  /** Probability a cut-through gets caught anyway. */
  cutToCatch: number;
  /** × basket radii (tray, chains, band) for this player's throws. */
  basketScale: number;
  /** Tap-in radius (m). */
  tapIn: number;
  /** Anything that stops within this distance of the basket is holed (m). */
  gimme: number;
  /** Discs stopping within this radius slide up to magnetPull m toward the basket (m, 0 = off). */
  magnet: number;
  magnetPull: number;
  /** × branch hit density; probability a branch hit is ignored. */
  branch: number;
  branchPass: number;
  /** × speed kept after a trunk hit. */
  trunkKeep: number;
  /** Trees the disc passes through per throw (Infinity = all). */
  phaseTrees: number;
  /** Tree kicks go toward the basket instead of a random direction. */
  kickToward: boolean;
  /** × speed kept by a branch kick (base 20–40%, at most 95%). */
  kickKeep: number;
  /** After a tree hit the disc keeps flying instead of tumbling (Pinball Wizard). */
  liveKicks: boolean;
  /** × skid distance after landing; sticky = no skid and near-misses of OB/water are saved. */
  skid: number;
  sticky: boolean;
  /** No penalty strokes for OB/water. */
  obInsurance: boolean;
  /** × putt range. */
  puttRange: number;
  /** Late-flight steering toward the basket (0 = off). */
  homing: number;
  /** × how much wind moves your disc (0 = none). */
  windScale: number;
  /** For you, the wind blows toward the basket (same strength). */
  tailwind: boolean;
  // Turn/round-level effects, handled by the controller rather than the flight model:
  meterSpeed: number;
  pickupBonus: number;
  mulligans: number;
  perfectForm: number;
  clone: boolean;
  treeChopper: boolean;
  rerolls: number;
  extraCard: number;
  /** Fraction of the ghost (predicted) flight line shown, 0..1. Base game 1; roguelike starts at 0. */
  ghost: number;
  /** Ghost line also shows the ±1σ wobble spread (Oracle). */
  ghostCone: boolean;
  // Personal course changes (only the owner plays and sees them):
  /** Your tee is this many meters closer along the hole line. */
  teeForward: number;
  /** Your basket sits this fraction of the hole closer to the tee. */
  pinCloser: number;
  /** Trees you may remove (for you only) at the start of each hole. */
  clearCut: number;
  // Hexes: change the course for every other player, not the owner:
  /** Bushes the owner plants within 4–15 m of the basket each hole. */
  hexSapling: number;
  /** Trees the owner plants anywhere on the hole each hole. */
  hexThicket: number;
  /** Ponds (3 m, water) the owner places on the hole each hole. */
  hexPond: number;
  /** × opponents' meter speed. */
  hexMeter: number;
  /** Opponents tee this many meters farther back. */
  hexBackTee: number;
  /** × opponents' basket size. */
  hexShrink: number;
  /** × wind for opponents. */
  hexWind: number;
}

export function neutralMods(): Mods {
  return {
    distance: 1, teeDistance: 1, aimError: 1, puttAimError: 1, noOverpowerWobble: false,
    glide: 0, turn: 0, fade: 0, shape: 1,
    catchBonus: 0, teeCatchBonus: 0, cutToCatch: 0, basketScale: 1, tapIn: 1, gimme: 0, magnet: 0, magnetPull: 1.5,
    branch: 1, branchPass: 0, trunkKeep: 1, phaseTrees: 0, kickToward: false, kickKeep: 1, liveKicks: false,
    skid: 1, sticky: false, obInsurance: false, puttRange: 1, homing: 0, windScale: 1, tailwind: false,
    meterSpeed: 1, pickupBonus: 0, mulligans: 0, perfectForm: 0, clone: false, treeChopper: false, rerolls: 0, extraCard: 0,
    ghost: 1, ghostCone: false, teeForward: 0, pinCloser: 0, clearCut: 0,
    hexSapling: 0, hexThicket: 0, hexPond: 0, hexMeter: 1, hexBackTee: 0, hexShrink: 1, hexWind: 1,
  };
}

/** Roguelike starting point: like the base game, but the ghost line has to be earned. */
export function rogueStartMods(): Mods {
  return { ...neutralMods(), ghost: 0 };
}

/**
 * The modifiers that act on `player`'s throws: their own, plus every other player's hexes.
 * Hexes never affect their owner.
 */
export function effectiveMods(all: Mods[], player: number): Mods {
  const m = { ...all[player] };
  all.forEach((o, i) => {
    if (i === player) return;
    m.meterSpeed *= o.hexMeter;
    m.basketScale *= o.hexShrink;
    m.windScale *= o.hexWind;
  });
  return m;
}

/** Meters the player's tee moves back because of opponents' Back Tees. */
export function backTeeFor(all: Mods[], player: number): number {
  return all.reduce((s, o, i) => (i === player ? s : s + o.hexBackTee), 0);
}

export const NEUTRAL: Readonly<Mods> = Object.freeze(neutralMods());
