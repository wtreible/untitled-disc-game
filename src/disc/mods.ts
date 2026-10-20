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
  /** Discs stopping within this radius slide 1.5 m toward the basket (m, 0 = off). */
  magnet: number;
  /** × branch hit density; probability a branch hit is ignored. */
  branch: number;
  branchPass: number;
  /** × speed kept after a trunk hit. */
  trunkKeep: number;
  /** Trees the disc passes through per throw (Infinity = all). */
  phaseTrees: number;
  /** Tree kicks go toward the basket instead of a random direction. */
  kickToward: boolean;
  /** × skid distance after landing; sticky = no skid and near-misses of OB/water are saved. */
  skid: number;
  sticky: boolean;
  /** No penalty strokes for OB/water. */
  obInsurance: boolean;
  /** × putt range. */
  puttRange: number;
  /** Late-flight steering toward the basket (0 = off). */
  homing: number;
  // Turn/round-level effects, handled by the controller rather than the flight model:
  meterSpeed: number;
  pickupBonus: number;
  mulligans: number;
  perfectForm: number;
  clone: boolean;
  treeChopper: boolean;
  rerolls: number;
  extraCard: number;
}

export function neutralMods(): Mods {
  return {
    distance: 1, teeDistance: 1, aimError: 1, puttAimError: 1, noOverpowerWobble: false,
    glide: 0, turn: 0, fade: 0, shape: 1,
    catchBonus: 0, teeCatchBonus: 0, cutToCatch: 0, basketScale: 1, tapIn: 1, gimme: 0, magnet: 0,
    branch: 1, branchPass: 0, trunkKeep: 1, phaseTrees: 0, kickToward: false,
    skid: 1, sticky: false, obInsurance: false, puttRange: 1, homing: 0,
    meterSpeed: 1, pickupBonus: 0, mulligans: 0, perfectForm: 0, clone: false, treeChopper: false, rerolls: 0, extraCard: 0,
  };
}

export const NEUTRAL: Readonly<Mods> = Object.freeze(neutralMods());
