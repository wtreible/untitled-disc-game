// Disc flight, docs/08-level-editor-and-disc-golf.md.
//
// A point-mass integrator with one extra state, bank angle φ (+ = hyzer: for a right-hand
// backhand the left edge is low and the disc curves left). Lift is perpendicular to the velocity
// and tilted by φ, so curving comes from bank. Flight numbers drive the bank: `turn` rolls the disc
// toward anhyzer while it's fast, `fade` rolls it back toward hyzer as it slows. Underpowered
// throws never get fast enough to turn, so they fade early, as real discs do.
//
// Collisions: tree trunks (cylinders), crowns (ellipsoids, probabilistic branch hits), and the
// basket (pole, tray, chains, top band). The whole throw is simulated up front; renderers play
// back `samples` at 60 Hz.
import type { Tree } from '../course/disc-types';
import { distToPolyline, type Vec2 } from '../course/geo';
import type { SurfaceClass } from '../course/types';
import type { Rng } from '../game/physics';
import type { SurfaceGrid } from '../game/surfaces';
import type { Terrain, Vec3 } from '../game/terrain';
import { DISC_RADIUS, type Disc } from './discs';
import type { TreeIndex } from './trees';
import { NEUTRAL, type Mods } from './mods';
import { collideProps, nearColliders, type Collider } from './props';
import { GREEN_DENSITY_BOOST, type TreeShape } from './treeShapes';

const G = 9.81;
/** Putts from closer than this are dropped in. */
export const TAP_IN = 1.0;
const DT = 1 / 240;
const SAMPLE_EVERY = 4; // 240 / 4 = 60 Hz
const MAX_T = 20;

// Aerodynamics after Hummel (2003) / Potts & Crowther: CL = CL0 + CLa·α, CD = CD0 + CDa·(α − α0)²,
// accel = K·v²·C with K = ½ρA/m. Glide and speed ratings nudge CL0 and CD0. The disc's nose angle
// stays fixed (gyroscopic), so as the path drops the angle of attack rises and the disc glides.
// Tuned by grid search against typical amateur distances; tests/disc.test.ts pins the result.
export const FLIGHT = {
  /** ½ρA/m for a 175 g, 21 cm disc. */
  K: 0.5 * 1.23 * Math.PI * 0.105 ** 2 / 0.175,
  cl0: 0.2,
  cl0PerGlide: 0.012,
  cla: 1.4,
  cd0: 0.06,
  cd0PerSpeed: -0.0042,
  /** Drag floor. At 0.02 the distance driver glided so efficiently that a dead-flat launch flew 50% past its max. */
  cd0Min: 0.02,
  cda: 1.2,
  alpha0: -0.07,
  /**
   * Nose angle at release = noseBase + noseFollow·launch. Only partly following the launch keeps
   * the default launch near the sweet spot: fully following it made dead-flat launches fly
   * 50% past the tuned maximum (low angle of attack, low drag). Calibrated so the default launch
   * (0.11 rad) gets the same nose angle as before (0.14 rad).
   */
  noseBase: 0.03,
  noseFollow: 1,
  /** Stall: past this angle of attack, lift fades to 0 at 90° and drag rises toward a flat plate. */
  stallAlpha: 0.45,
  flatPlateCd: 1.1,
  /** Bank rate (rad/s) per unit of turn at full speed, and per unit of fade at low speed. */
  turnRate: 0.25,
  fadeRate: 0.8,
  /** Bank limits (rad): turn rolls toward −(base + per·|turn|), fade toward base + per·fade. */
  turnLimitBase: 0.3,
  turnLimitPer: 0.25,
  fadeLimitBase: 0.25,
  fadeLimitPer: 0.12,
  /** Rates taper to zero over this last stretch before a limit. */
  limitEase: 0.25,
  /** Release angle for hyzer = ±1. */
  maxReleaseBank: 0.35,
  /** Putts use this fraction of the meter, so a full putt meter reaches ~35 m (circle-2 putts need ~20 m at chain height). */
  puttScale: 0.6,
  /**
   * Throws (not putts) reach this much farther than the discs' measured curves: the meter's fill
   * maps to 110% of the old distances. The wobble zone stays the top 10% of the meter.
   */
  throwPower: 1.1,
  /** Throws past this much of the meter wobble more (muscling it); the HUD stripes that zone. */
  wobbleFrom: 0.9,
  /** Branch hits per meter traveled inside a crown. */
  branchDensity: 0.11,
  /** Skid deceleration after landing, m/s², by surface. */
  skid: { default: 7, trees: 11, path: 3.5, tee: 4, fairway: 6 } as Record<string, number>,
  /** Rollers: deceleration (m/s²) rolling on edge, by surface. */
  roll: { default: 2.6, trees: 4.5, path: 1.2, tee: 1.4, fairway: 1.6, green: 1.6 } as Record<string, number>,
  /** Rollers: how fast the path curls (rad/s) at full speed, and extra as the disc slows and leans. */
  rollCurl: 0.06,
  rollCurlSlow: 0.55,
  /** Rollers: below this speed (m/s) the disc falls flat and skids to a stop. */
  rollFall: 1.4,
  /** Overhand (tomahawk / thumber): release on edge, roll toward upside down at this rate (rad/s). */
  overBank: 1.35,
  overRoll: 0.7,
  overFlip: 2.6,
  /** Overhand: release speed vs a backhand (they're thrown with the arm, not the body). */
  overSpeed: 1,
  overLift: 0.07,
  overDrag: 0.045,
};

/**
 * Basket dimensions (m). A little bigger than a PDGA target (tray, chains and band radii up ~15%,
 * chain section ~25% taller) to make catches more forgiving in a game where you can't feel the putt.
 */
export const BASKET = {
  poleR: 0.024,
  trayBottom: 0.55,
  trayTop: 0.78,
  trayR: 0.38,
  chainR: 0.33,
  chainTop: 1.45,
  bandTop: 1.53,
  bandR: 0.37,
};

/** Chain catch tuning: probability = base − edgePenalty·edge³ − speedPenalty·(speed − fastSpeed)⁺. */
export const CATCH = {
  base: 0.98,
  edgePenalty: 0.55,
  speedPenalty: 0.015,
  fastSpeed: 13,
  min: 0.08,
  /** Misses with the line this far out (0 center … 1 edge) cut through instead of spitting out. */
  cutEdge: 0.8,
  /**
   * A disc that hits the chains without a clean catch often rattles and drops into the tray
   * anyway; real spit-outs are mostly firm putts. Rattle-in chance = rattle − rattlePerSpeed ·
   * (speed − rattleSpeed)⁺, applied before a would-be spit-out.
   */
  rattle: 0.65,
  rattlePerSpeed: 0.04,
  rattleSpeed: 8,
};

export interface DiscWorld {
  grid: SurfaceGrid;
  terrain: Terrain;
  trees: TreeIndex;
  basket: Vec2;
  /** More baskets the disc can hit or hole into (the driving range). Aim helpers use `basket` only. */
  extraBaskets?: Vec2[];
  /** Branch hits per meter inside a crown; defaults to FLIGHT.branchDensity. */
  branchDensity?: number;
  /** Extra water circles for this thrower only (roguelike Pond Prank). */
  hazards?: { c: Vec2; r: number }[];
  /** Themed-course props (windmill, castle, animals…). */
  props?: Collider[];
  /** Absolute time (s) at release; moving props (windmill blades) are evaluated at clock0 + t. */
  clock0?: number;
  /**
   * Trees drawn as branched models: their trunk slices and leaf clumps (src/disc/treeShapes.ts).
   * Trees without a shape (and worlds without this) use the trunk + crown ellipsoid.
   */
  treeShape?: (t: Tree) => TreeShape | null;
  /** Wind (m/s, the direction it blows toward) at 10 m up; weaker near the ground (windAt). */
  wind?: Vec2;
  /** Moving Basket (an opponent's hex): the basket drifts by `amp` × sin(2π t / period), t = clock. */
  basketDrift?: { amp: Vec2; period: number };
  /** Bridge Builder: water within `half` m of these segments plays as dry ground for this thrower. */
  bridges?: { a: Vec2; b: Vec2; half: number }[];
  /** The hole line (Gardener trims branches near it). */
  line?: Vec2[];
}

/** Where the basket is at absolute time `t` (it drifts with Moving Basket). */
export function basketAt(world: Pick<DiscWorld, 'basket' | 'basketDrift'>, t: number): Vec2 {
  const d = world.basketDrift;
  if (!d) return world.basket;
  const k = Math.sin((2 * Math.PI * t) / d.period);
  return [world.basket[0] + d.amp[0] * k, world.basket[1] + d.amp[1] * k];
}

/**
 * Wind at height z above the ground: full strength from 10 m up, easing to 40% near the ground
 * (a rough power-law profile). Rolling discs ignore it.
 */
export function windAt(w: Vec2, z: number): Vec2 {
  const k = Math.min(1, Math.max(0.4, Math.pow(Math.max(0, z) / 10, 0.3)));
  return [w[0] * k, w[1] * k];
}

/** Surface under (x, y) for this world's thrower: the course grid, plus any personal hazards. */
export function surfaceAt(world: DiscWorld, x: number, y: number): SurfaceClass {
  for (const h of world.hazards ?? []) if (Math.hypot(x - h.c[0], y - h.c[1]) < h.r) return 'water';
  const c = world.grid.classAt(x, y);
  // Bridge Builder: the water under your bridge is dry going.
  if (c === 'water' && world.bridges?.some((b) => distToPolyline([x, y], [b.a, b.b]) < b.half)) return 'path';
  return c;
}

export interface ThrowInput {
  start: Vec2;
  /** Aim yaw, radians CCW from +x. */
  aim: number;
  /** Meter fill 0..1 (distance is roughly proportional). */
  power: number;
  disc: Disc;
  /** -1 anhyzer … 0 flat … +1 hyzer. */
  hyzer: number;
  /** Launch (pitch) angle, radians. */
  launch?: number;
  releaseZ?: number;
  /** Putts: more accurate, less spin-driven curve. */
  style?: 'drive' | 'putt';
  /**
   * The kind of throw (not for putts): the usual flat-ish one, overhand (tomahawk curls left and
   * dives, thumber the mirror image; both go up over trees), or a roller (out on a big anhyzer,
   * then rolling on edge under them).
   */
  shot?: Shot;
  /** Mirror the curve for left-handed backhand / right-handed forehand. */
  mirror?: boolean;
  /** Player modifiers (roguelike powerups). Omitted = base game. */
  mods?: Mods;
  /** First throw of the hole (tee-only modifiers). */
  fromTee?: boolean;
  /** Zero execution error: fly exactly the ghost line (Perfect Form). */
  perfect?: boolean;
  /** Go on from mid-flight (Split Disc's other half): position, velocity and bank there. */
  resume?: { p: Vec3; v: Vec3; bank: number };
  /** Basket Buddy has a nudge left this hole. */
  buddy?: boolean;
  /** Thrown in an earthquake (an opponent's hex): much more wobble. */
  quake?: boolean;
  /** How the release went (src/modes/throwStyles.ts); it replaces the overpower wobble. */
  execution?: Execution;
}

/**
 * A release's execution: a pull (+) or push (−) in degrees and extra hyzer (+) or turn (−) in
 * radians (both mirrored with the throw), and × the random wobble.
 */
export interface Execution { yaw: number; bank: number; wobble: number }

export type Shot = 'standard' | 'tomahawk' | 'thumber' | 'roller';

/** Default launch angle for a shot (radians); the standard one is the disc's own. */
export function shotLaunch(shot: Shot | undefined, disc: Disc): number {
  return shot === 'tomahawk' || shot === 'thumber' ? 0.72 : shot === 'roller' ? -0.03 : disc.launch;
}

export type ThrowEvent = 'trunk' | 'branch' | 'chains' | 'spit' | 'cut' | 'band' | 'tray' | 'pole' | 'water' | 'oob' | 'holed' | 'phased' | 'saved' | 'gimme' | 'magnet' | 'prop'
  | 'skip' | 'burned' | 'boomerang' | 'buddy' | 'insured';

/**
 * Something to show at a moment of the flight (an augment at work): at sample k, what happened.
 * Played as the disc gets there, live and in the replay (src/modes/disc.ts).
 */
export type Mark = 'phase' | 'burn' | 'skip' | 'split' | 'buddy' | 'boomerang' | 'saved' | 'insured' | 'kick' | 'chop' | 'magnet' | 'gimme';

export interface ThrowResult {
  samples: Vec3[];
  /** Bank angle per sample, for rendering the disc's tilt. */
  banks: number[];
  rest: Vec2;
  restSurface: SurfaceClass;
  holed: boolean;
  penalty: number;
  events: ThrowEvent[];
  /** Trees the disc touched (for Lumberjack). */
  treesHit: Tree[];
  /** Tags of props hit, in order ('windmill', 'cow', …). */
  propHits?: string[];
  /** Fireball: trees burned away (gone for the thrower for the rest of the hole). */
  burned?: Tree[];
  /** Augments at work, by sample (see Mark). */
  marks?: [number, Mark][];
  /** Split Disc: where it split (the top of the flight), to fly the other half from. */
  apex?: { p: Vec3; v: Vec3; bank: number; k: number };
}

// Release-speed fractions at which each disc's `curve` (distance fractions) was measured.
const CURVE_SPEEDS = [0.15, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

/**
 * Meter fill (≈ wanted fraction of max distance) → release speed fraction, by inverting the disc's
 * measured curve. Distance grows steeply with speed (lift collapses at low speed) and differently
 * per disc, so a linear meter would waste its bottom half. Below the first point, interpolate
 * from (0, 0.1).
 */
export function meterToSpeed(m: number, disc: Disc): number {
  const x = Math.min(1, Math.max(0, m));
  const pts: [number, number][] = [[0, 0.1], ...disc.curve.map((d, i): [number, number] => [d, CURVE_SPEEDS[i]])];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    if (x <= x1) {
      const [x0, y0] = pts[i - 1];
      return y0 + ((x - x0) / Math.max(1e-9, x1 - x0)) * (y1 - y0);
    }
  }
  return 1;
}

/**
 * Lift and drag coefficients. Linear lift and quadratic drag up to the stall angle; past it, lift
 * fades to 0 at ±90° (a disc falling flat makes no lift) and drag rises toward a flat plate's.
 * Without the stall, a steeply falling disc's lift pointed backward and pushed it back toward the
 * thrower.
 */
export function aero(alpha: number, cl0: number, cd0: number): { CL: number; CD: number } {
  const S = FLIGHT.stallAlpha;
  const lin = (a: number) => ({ CL: cl0 + FLIGHT.cla * a, CD: cd0 + FLIGHT.cda * (a - FLIGHT.alpha0) ** 2 });
  if (Math.abs(alpha) <= S) return lin(alpha);
  const edge = lin(Math.sign(alpha) * S);
  const t = Math.min(1, (Math.abs(alpha) - S) / (Math.PI / 2 - S)); // 0 at stall, 1 at 90°
  return {
    CL: edge.CL * Math.cos((t * Math.PI) / 2),
    CD: edge.CD + (FLIGHT.flatPlateCd - edge.CD) * Math.sin((t * Math.PI) / 2),
  };
}

function gaussian(rng: Rng): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export interface SimOptions {
  /** Ignore trees, basket and randomness: the aim preview's "ghost" flight. */
  ghost?: boolean;
}

export function simulateThrow(input: ThrowInput, world: DiscWorld, rng: Rng = Math.random, opt: SimOptions = {}): ThrowResult {
  const m = input.mods ?? NEUTRAL;
  // Laser Disc: no turn and no fade at all.
  const disc: Disc = { ...input.disc, glide: input.disc.glide + m.glide, turn: m.straight ? 0 : input.disc.turn + m.turn, fade: m.straight ? 0 : input.disc.fade + m.fade };
  const putt = input.style === 'putt';
  const mirror = input.mirror ? -1 : 1;
  const shot: Shot = putt ? 'standard' : input.shot ?? 'standard';
  const overhand = shot === 'tomahawk' || shot === 'thumber';
  // Spotlight: no wobble on putts from close in. An earthquake: a lot more.
  const spot = putt && m.spotlight > 0 && Math.hypot(input.start[0] - world.basket[0], input.start[1] - world.basket[1]) <= m.spotlight;
  const ex = opt.ghost || input.perfect ? undefined : input.execution;
  const err = (spot ? 0 : putt ? m.puttAimError : m.aimError * (overhand ? m.overhandAim : 1)) * (input.quake ? 2.5 : 1) * (ex?.wobble ?? 1);
  const noise = opt.ghost || input.perfect ? () => 0 : () => gaussian(rng) * err;
  /** Overhand: which way it rolls over (tomahawk: to the left of travel). */
  const side = shot === 'thumber' ? -1 : 1;

  // Release, with execution error (bigger when muscling past ~90%).
  const over = m.noOverpowerWobble || ex ? 0 : Math.max(0, input.power - FLIGHT.wobbleFrom) / (1 - FLIGHT.wobbleFrom);
  const yaw = input.aim + ((noise() * (putt ? 0.5 : 1.4 + over * 2) + mirror * (ex?.yaw ?? 0)) * Math.PI) / 180;
  // Distance bonuses scale the meter, which maps ~linearly to distance; past full power, release
  // speed grows with the measured full-power sensitivity (distance ∝ v^~1.8 there).
  const meter = input.power * (putt ? FLIGHT.puttScale * m.puttRange : FLIGHT.throwPower * m.distance * (input.fromTee ? m.teeDistance : 1) * (overhand ? m.overhandDistance : 1));
  const power = (meter <= 1 ? meterToSpeed(meter, input.disc) : meter ** 0.55) * (1 + noise() * (putt ? 0.015 : 0.02));
  const launch = (input.launch ?? (putt ? 0.12 : shotLaunch(shot, input.disc))) + noise() * 0.01;
  let bank = overhand ? side * FLIGHT.overBank + noise() * 0.04
    : shot === 'roller' ? mirror * (-0.95 + input.hyzer * 0.2 + noise() * 0.04 + (ex?.bank ?? 0)) // a big anhyzer; hyzer softens it
      : mirror * (input.hyzer * FLIGHT.maxReleaseBank * m.shape + noise() * 0.04 + (ex?.bank ?? 0));
  const speed0 = disc.v0 * power * (overhand ? FLIGHT.overSpeed : 1);
  let p: Vec3 = [input.start[0], input.start[1], world.terrain.heightAt(input.start[0], input.start[1]) + (input.releaseZ ?? 1.0)];
  let v: Vec3 = [Math.cos(yaw) * Math.cos(launch) * speed0, Math.sin(yaw) * Math.cos(launch) * speed0, Math.sin(launch) * speed0];
  if (input.resume) { p = [...input.resume.p]; v = [...input.resume.v]; bank = input.resume.bank; }

  const cl0 = FLIGHT.cl0 + FLIGHT.cl0PerGlide * (disc.glide - 5);
  const cd0 = Math.max(FLIGHT.cd0Min, FLIGHT.cd0 + FLIGHT.cd0PerSpeed * disc.speed);
  const nose = FLIGHT.noseBase + FLIGHT.noseFollow * launch;
  // Putts get a fraction of the spin-driven roll: push putts are thrown flat and slow.
  const turnK = putt ? 0.3 : 1;

  const samples: Vec3[] = [[...p]];
  const banks: number[] = [bank];
  if (!opt.ghost && !input.resume && putt && Math.hypot(input.start[0] - world.basket[0], input.start[1] - world.basket[1]) < Math.max(TAP_IN, m.tapIn)) {
    // Tap-in: inside a meter you just drop it in.
    const [bx, by] = world.basket;
    for (let k = 1; k <= 20; k++) samples.push([p[0] + (bx - p[0]) * (k / 20), p[1] + (by - p[1]) * (k / 20), p[2] + (BASKET.trayBottom + 0.05 - p[2]) * (k / 20)]);
    return { samples, banks: samples.map(() => 0), rest: world.basket, restSurface: 'green', holed: true, penalty: 0, events: ['holed'], treesHit: [] };
  }
  const events: ThrowEvent[] = [];
  const propHits: string[] = [];
  const marks: [number, Mark][] = [];
  const mark = (kind: Mark, k = samples.length) => { marks.push([k, kind]); };
  const tctx: TreeCtx = { m, phaseLeft: m.phaseTrees, fireLeft: m.fireball, burned: [], passed: new Set(), hits: [], basket: world.basket, rng, events, mark, line: m.gardener > 0 ? world.line : undefined };
  let skipsLeft = m.skips;
  let apex: ThrowResult['apex'];
  const t0 = world.clock0 ?? 0;
  const bopt: BasketOpts = {
    B: scaledBasket(m.basketScale),
    catchBonus: m.catchBonus + (input.fromTee ? m.teeCatchBonus : 0),
    cutToCatch: m.cutToCatch,
    metalIn: m.metalIn,
  };
  let state: 'flight' | 'dead' | 'ground' | 'rolling' = 'flight';
  /** Roller: the speed it started rolling at, and which way it curls. */
  let roll0 = 0;
  const curl = mirror * (disc.turn + disc.fade < 1 ? -1 : 1);
  let holedAt: Vec3 | null = null;
  const baskets = [world.basket, ...(world.extraBaskets ?? [])];
  /** The basket it went into. */
  let holedIn = world.basket;
  const near: Tree[] = [];
  const inChains = baskets.map(() => false);

  for (let step = 1; step * DT < MAX_T; step++) {
    if (world.basketDrift) baskets[0] = basketAt(world, t0 + step * DT); // Moving Basket
    const s = Math.hypot(v[0], v[1], v[2]);
    const ground = world.terrain.heightAt(p[0], p[1]);

    if (state === 'ground' || state === 'rolling') {
      let sh = Math.hypot(v[0], v[1]);
      if (sh < 0.05) break;
      const surf = surfaceAt(world, p[0], p[1]);
      if (state === 'rolling') {
        // On edge: it rolls far, curling more as it slows and leans, then falls flat.
        const slow = 1 - Math.min(1, sh / Math.max(1e-6, roll0));
        const w = curl * (FLIGHT.rollCurl + FLIGHT.rollCurlSlow * slow * slow);
        const c = Math.cos(w * DT), sn = Math.sin(w * DT);
        v = [v[0] * c - v[1] * sn, v[0] * sn + v[1] * c, 0];
        const ns = Math.max(0, sh - (FLIGHT.roll[surf] ?? FLIGHT.roll.default) / (m.skid * m.roll) * DT);
        v = [(v[0] / sh) * ns, (v[1] / sh) * ns, 0];
        bank = curl * -(1.2 + 0.3 * slow);
        if (ns < FLIGHT.rollFall) { state = 'ground'; bank = 0; }
        sh = ns;
      } else {
        const decel = (FLIGHT.skid[surf] ?? FLIGHT.skid.default) / m.skid;
        const ns = Math.max(0, sh - decel * DT);
        v = [(v[0] / sh) * ns, (v[1] / sh) * ns, 0];
      }
      p = [p[0] + v[0] * DT, p[1] + v[1] * DT, ground + (state === 'rolling' ? DISC_RADIUS : 0)];
      if (state === 'rolling' && (surf === 'water' || surf === 'oob')) break; // rolled in
      if (!opt.ghost) {
        trunkCollide(p, v, world, near, tctx, 0.2);
        if (world.props) { const prevG: Vec3 = [p[0] - v[0] * DT, p[1] - v[1] * DT, p[2]]; const tag = collideProps(p, v, prevG, (world.clock0 ?? 0) + step * DT, nearColliders(world.props, p[0], p[1])); if (tag) { propHits.push(tag); events.push('prop'); } }
      }
    } else {
      // Forces, from the disc's motion through the air (its velocity minus the wind). A headwind
      // means more airspeed (more lift, longer turn); a tailwind less (it fades sooner).
      const w = world.wind && m.windScale > 0 ? windAt([world.wind[0] * m.windScale, world.wind[1] * m.windScale], p[2] - ground) : null;
      const air: Vec3 = w ? [v[0] - w[0], v[1] - w[1], v[2]] : v;
      const sa = w ? Math.hypot(air[0], air[1], air[2]) || 1e-6 : s;
      const q = sa / disc.v0; // airspeed relative to this disc's full-power release
      const f: Vec3 = [air[0] / sa, air[1] / sa, air[2] / sa];
      const hl = Math.hypot(f[0], f[1]) || 1e-6;
      const r: Vec3 = [f[1] / hl, -f[0] / hl, 0]; // horizontal right of travel
      const u: Vec3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]]; // up, ⟂ f
      // Angle of attack: fixed nose angle minus the flight path angle. A tumbling (dead) disc
      // gets a fraction of the lift and extra drag.
      const alpha = nose - Math.atan2(air[2], Math.hypot(air[0], air[1])); // −π/2 … +π/2-ish
      const dead = state === 'dead';
      // Overhand: the disc flies rim first (on edge, then upside down), so it barely stalls: low
      // drag and a small lift that, banked over, mostly pushes it sideways and then down.
      const { CL: cl, CD: cd } = overhand && !dead ? { CL: FLIGHT.overLift, CD: FLIGHT.overDrag } : aero(alpha, cl0, cd0);
      const CL = cl * (dead ? 0.2 : 1);
      const CD = cd + (dead ? 0.3 : 0);
      const L = FLIGHT.K * sa * sa * CL;
      const D = FLIGHT.K * sa * CD; // × air below gives K·sa²·CD against the airflow
      const n: Vec3 = [u[0] * Math.cos(bank) - r[0] * Math.sin(bank), u[1] * Math.cos(bank) - r[1] * Math.sin(bank), u[2] * Math.cos(bank) - r[2] * Math.sin(bank)];
      // Kite: a wind toward the basket lifts the disc more (as much more as it blows that way).
      let lift = L;
      if (m.kite > 0 && w && state === 'flight') {
        const bx = world.basket[0] - p[0], by = world.basket[1] - p[1], db = Math.hypot(bx, by) || 1, ws = Math.hypot(w[0], w[1]);
        if (ws > 0.1) lift *= 1 + m.kite * Math.max(0, (w[0] * bx + w[1] * by) / (db * ws));
      }
      const a: Vec3 = [lift * n[0] - D * air[0], lift * n[1] - D * air[1], lift * n[2] - D * air[2] - G];
      if (m.homing > 0 && state === 'flight') {
        // Homing: steer the horizontal velocity toward the basket late in flight, within 80 m.
        const bx = world.basket[0] - p[0], by = world.basket[1] - p[1];
        const db = Math.hypot(bx, by);
        const sh = Math.hypot(v[0], v[1]);
        if (db < 80 && db > 0.5 && q < 0.8 && sh > 0.5) {
          const cross = (v[0] * by - v[1] * bx) / (sh * db); // + = basket to the left
          const k = m.homing * 6 * Math.max(-1, Math.min(1, cross * 3));
          a[0] += (-v[1] / sh) * k;
          a[1] += (v[0] / sh) * k;
        }
      }
      const vzBefore = v[2];
      v = [v[0] + a[0] * DT, v[1] + a[1] * DT, v[2] + a[2] * DT];
      // Split Disc: note the top of the flight, where the other half peels off.
      if (m.split && !apex && !input.resume && state === 'flight' && vzBefore > 0 && v[2] <= 0) { apex = { p: [...p], v: [...v], bank, k: samples.length }; mark('split'); }
      const prev: Vec3 = p;
      p = [p[0] + v[0] * DT, p[1] + v[1] * DT, p[2] + v[2] * DT];

      if (state === 'flight' && overhand) {
        // Overhand: released on edge, it corkscrews over onto its back and dives.
        bank += side * FLIGHT.overRoll * DT * (side * bank < FLIGHT.overFlip ? 1 : 0);
      } else if (state === 'flight') {
        // Turn needs speed (> ~60% of full release); fade grows as the disc slows. Each drives the
        // bank toward a limit set by the flight numbers and eases off near it. Unbounded, fade
        // kept rolling until drivers landed upside down (bank ~175°).
        const hs = Math.min(1, Math.max(0, (q - 0.6) / 0.4));
        const ls = Math.min(1, Math.max(0, (0.8 - q) / 0.8));
        const b = mirror * bank; // work in right-hand-backhand terms
        const turnLimit = -(FLIGHT.turnLimitBase + FLIGHT.turnLimitPer * Math.max(0, -disc.turn));
        const fadeLimit = FLIGHT.fadeLimitBase + FLIGHT.fadeLimitPer * Math.max(0, disc.fade);
        const ease = (gap: number) => Math.min(1, Math.max(0, gap / FLIGHT.limitEase));
        let db = 0;
        if (disc.turn < 0) db -= FLIGHT.turnRate * -disc.turn * hs * turnK * ease(b - turnLimit);
        if (disc.fade > 0) db += FLIGHT.fadeRate * disc.fade * ls * ease(fadeLimit - b);
        bank = mirror * (b + db * DT);
      }

      if (!opt.ghost) {
        const hitTree = treeCollide(prev, p, v, world, near, tctx);
        // A tree hit usually kills the flight (tumbling). Pinball Wizard's disc keeps flying.
        if (hitTree && !m.liveKicks) { state = 'dead'; bank = (rng() - 0.5) * 1.2; }
        if (world.props) {
          const tag = collideProps(p, v, prev, (world.clock0 ?? 0) + step * DT, nearColliders(world.props, p[0], p[1]));
          if (tag) { state = 'dead'; bank = (rng() - 0.5) * 1.2; if (propHits[propHits.length - 1] !== tag) propHits.push(tag); events.push('prop'); }
        }
        for (let k = 0; k < baskets.length && !holedAt; k++) {
          const b = basketCollide(prev, p, v, baskets[k], rng, events, inChains[k], bopt);
          inChains[k] = b.inChains;
          if (b.holed) { holedAt = p; holedIn = baskets[k]; }
          if (b.hit) { state = 'dead'; }
        }
        if (holedAt) break;
      }

      if (p[2] <= ground) {
        // Landing: keep a fraction of horizontal speed as a skid.
        p = [p[0], p[1], ground];
        // Skipping Stone: fast enough onto water, it skips on instead of sinking.
        const sh0 = Math.hypot(v[0], v[1]);
        if (skipsLeft > 0 && sh0 > 4 && surfaceAt(world, p[0], p[1]) === 'water') {
          skipsLeft--;
          v = [v[0] * 0.7, v[1] * 0.7, Math.max(2.4, Math.abs(v[2]) * 0.3)];
          p = [p[0], p[1], ground + 0.02];
          events.push('skip');
          mark('skip');
          continue;
        }
        // A roller lands on edge and rolls on; an overhand throw lands upside down and stops.
        const rolls: boolean = shot === 'roller' && state === 'flight' && !m.sticky;
        const keep = m.sticky ? 0 : rolls ? 0.85 : state === 'dead' ? 0.25 : overhand ? 0.12 : 0.4;
        v = [v[0] * keep, v[1] * keep, 0];
        state = rolls ? 'rolling' : 'ground';
        roll0 = Math.hypot(v[0], v[1]);
        const surf = surfaceAt(world, p[0], p[1]);
        if (surf === 'water' || surf === 'oob') break;
      }
    }

    if (step % SAMPLE_EVERY === 0) {
      samples.push([...p]);
      banks.push(state === 'ground' ? 0 : bank);
    }
  }

  const treesHit = tctx.hits;
  const extra = (): Partial<ThrowResult> => ({ ...(tctx.burned.length ? { burned: tctx.burned } : {}), ...(marks.length ? { marks } : {}), ...(apex ? { apex } : {}) });
  const tEnd = t0 + (samples.length / 60);
  const holedResult = (from: Vec3, ev: ThrowEvent): ThrowResult => {
    // Drop into the tray.
    const [bx, by] = holedIn;
    const z0 = from[2];
    for (let k = 1; k <= 18; k++) {
      const t = k / 18;
      samples.push([from[0] + (bx - from[0]) * t * 0.6, from[1] + (by - from[1]) * t * 0.6, z0 + (BASKET.trayBottom + 0.05 - z0) * t]);
      banks.push(0);
    }
    if (ev !== 'holed') events.push(ev);
    events.push('holed');
    return { samples, banks, rest: holedIn, restSurface: 'green', holed: true, penalty: 0, events, treesHit, propHits, ...extra() };
  };
  if (holedAt) return holedResult(holedAt, 'holed');

  samples.push([...p]);
  banks.push(0);
  let rest: Vec2 = [p[0], p[1]];
  const surf = surfaceAt(world, rest[0], rest[1]);
  if (surf === 'water' || surf === 'oob') {
    // Play from where it last crossed into OB (casual, D19): last in-bounds point on the path.
    let drop: Vec2 = input.start;
    for (let i = samples.length - 1; i >= 0; i--) {
      const c = surfaceAt(world, samples[i][0], samples[i][1]);
      if (c !== 'water' && c !== 'oob') { drop = [samples[i][0], samples[i][1]]; break; }
    }
    // Sticky Plastic: a near miss (within 2 m of the edge) is saved, no penalty.
    if (m.sticky && Math.hypot(drop[0] - rest[0], drop[1] - rest[1]) <= 2) {
      events.push('saved');
      mark('saved', samples.length - 1);
      return { samples, banks, rest: drop, restSurface: surfaceAt(world, drop[0], drop[1]), holed: false, penalty: 0, events, treesHit, propHits, ...extra() };
    }
    events.push(surf);
    if (m.obInsurance) { events.push('insured'); mark('insured', samples.length - 1); }
    return { samples, banks, rest: drop, restSurface: surfaceAt(world, drop[0], drop[1]), holed: false, penalty: m.obInsurance ? 0 : 1, events, treesHit, propHits, ...extra() };
  }
  if (!opt.ghost) {
    const pin = basketAt(world, tEnd);
    /** Slide the resting disc `by` m toward the basket (a few samples of it sliding). */
    const slide = (by: number) => {
      const d0 = Math.hypot(rest[0] - pin[0], rest[1] - pin[1]) || 1;
      const ux = (pin[0] - rest[0]) / d0, uy = (pin[1] - rest[1]) / d0;
      for (let k = 1; k <= 30; k++) {
        const t = (k / 30) * by;
        samples.push([rest[0] + ux * t, rest[1] + uy * t, p[2]]);
        banks.push(0);
      }
      rest = [rest[0] + ux * by, rest[1] + uy * by];
    };
    let d = Math.hypot(rest[0] - pin[0], rest[1] - pin[1]);
    if (d < m.gimme) { mark('gimme', samples.length - 1); return holedResult([...p], 'gimme'); }
    if (m.magnet > 0 && d < m.magnet && d > 0.4) {
      // Magnet Basket: slide up to magnetPull m toward the basket.
      mark('magnet', samples.length - 1);
      slide(Math.min(m.magnetPull, d - 0.3));
      events.push('magnet');
      d = Math.hypot(rest[0] - pin[0], rest[1] - pin[1]);
    }
    // Boomerang: at rest past the basket (going away from where it was thrown), it comes back.
    const fx = pin[0] - input.start[0], fy = pin[1] - input.start[1], fl = Math.hypot(fx, fy) || 1;
    if (m.boomerang > 0 && d > 0.6 && ((rest[0] - pin[0]) * fx + (rest[1] - pin[1]) * fy) / fl > 0.3) {
      mark('boomerang', samples.length - 1);
      slide(Math.min(m.boomerang, d - 0.3));
      events.push('boomerang');
      d = Math.hypot(rest[0] - pin[0], rest[1] - pin[1]);
    }
    // Basket Buddy: a near miss is nudged in (once a hole; the round keeps count).
    if (input.buddy && d < 3) {
      mark('buddy', samples.length - 1);
      holedIn = pin;
      return holedResult([rest[0], rest[1], Math.max(p[2], 0.3)], 'buddy');
    }
  }
  return { samples, banks, rest, restSurface: surfaceAt(world, rest[0], rest[1]), holed: false, penalty: 0, events, treesHit, propHits, ...extra() };
}

interface TreeCtx {
  m: Mods;
  /** Trees left to pass through this throw (Ghost/Phase Disc), and ones already passed. */
  phaseLeft: number;
  /** Trees left to burn away this throw (Fireball), and the ones burned. */
  fireLeft: number;
  burned: Tree[];
  passed: Set<Tree>;
  /** Show something at this moment of the flight. */
  mark: (kind: Mark) => void;
  /** Gardener: the hole line (branches near it are trimmed). */
  line?: Vec2[];
  hits: Tree[];
  basket: Vec2;
  rng: Rng;
  events: ThrowEvent[];
  /** Pinball Wizard: where the last kick was (no new kick within 3 m of it). */
  lastKick?: Vec3;
}

/** True if the disc should ignore this tree (burning it away, or phasing through it). */
function phases(t: Tree, c: TreeCtx): boolean {
  if (c.passed.has(t)) return true;
  if (c.fireLeft > 0) {
    c.fireLeft--;
    c.passed.add(t);
    c.burned.push(t);
    c.events.push('burned');
    c.mark('burn');
    return true;
  }
  if (c.phaseLeft > 0) {
    c.phaseLeft--;
    c.passed.add(t);
    c.events.push('phased');
    c.mark('phase');
    return true;
  }
  return false;
}

/** Trunk cylinders (hard) and crown ellipsoids (probabilistic branch hits). Mutates p and v. */
function treeCollide(prev: Vec3, p: Vec3, v: Vec3, world: DiscWorld, near: Tree[], c: TreeCtx): boolean {
  const { rng, events, m } = c;
  if (trunkCollide(p, v, world, near, c, 0.35)) return true;
  const ds = Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
  for (const t of world.trees.near(p[0], p[1], near)) {
    const g = world.terrain.heightAt(t.x, t.y);
    const shape = world.treeShape?.(t);
    let density: number;
    if (shape) {
      // Branched model: branches only in the leaf clumps, at the crown's average density (0.8 of
      // the base, as the ellipsoid's 1.4 − k averages), stepped up for the smaller volume.
      if (!shape.green(p[0], p[1], p[2] - g)) continue;
      density = 0.8 * GREEN_DENSITY_BOOST;
    } else {
      const zc = g + (t.b + t.h) / 2;
      const hz = Math.max(0.3, (t.h - t.b) / 2);
      const dx = p[0] - t.x, dy = p[1] - t.y, dz = p[2] - zc;
      const k = (dx * dx + dy * dy) / ((t.r + DISC_RADIUS) ** 2) + (dz * dz) / (hz * hz);
      if (k >= 1) continue;
      density = 1.4 - k; // denser toward the crown's middle
    }
    // Gardener: the branches near your hole line are trimmed back.
    const trimmed = c.line && distToPolyline([t.x, t.y], c.line) < m.gardener ? 0.35 : 1;
    const lambda = (world.branchDensity ?? FLIGHT.branchDensity) * m.branch * density * trimmed;
    // Pinball Wizard: one bounce per few meters, not a pinball machine inside one crown.
    if (m.liveKicks && c.lastKick && Math.hypot(p[0] - c.lastKick[0], p[1] - c.lastKick[1], p[2] - c.lastKick[2]) < 3) continue;
    if (rng() < 1 - Math.exp(-lambda * ds)) {
      if (phases(t, c)) continue;
      if (m.branchPass > 0 && rng() < m.branchPass) continue;
      events.push('branch');
      if (!c.hits.includes(t)) c.hits.push(t);
      if (m.treeChopper) c.mark('chop');
      if (m.kickToward || m.liveKicks) c.mark('kick');
      // Kick in a random direction (or toward the basket with Lucky Kicks), keep 20–40% of the speed.
      const s = Math.hypot(v[0], v[1], v[2]) * Math.min(0.95, (0.2 + rng() * 0.2) * m.kickKeep);
      const yaw = m.kickToward
        ? Math.atan2(c.basket[1] - p[1], c.basket[0] - p[0]) + (rng() - 0.5) * 0.6
        : Math.atan2(v[1], v[0]) + (rng() - 0.5) * 2 * 2.2;
      const vz = v[2];
      v[0] = Math.cos(yaw) * s;
      v[1] = Math.sin(yaw) * s;
      v[2] = (rng() - 0.6) * s;
      if (m.liveKicks) {
        // Bounced, not knocked down: same climb or fall, now heading for the basket.
        v[2] = vz * 0.9;
        c.lastKick = [p[0], p[1], p[2]];
      }
      return true;
    }
  }
  return false;
}

function trunkCollide(p: Vec3, v: Vec3, world: DiscWorld, near: Tree[], c: TreeCtx, restitution: number): boolean {
  for (const t of world.trees.near(p[0], p[1], near)) {
    // The trunk here: a slice of a branched model's (bent) trunk, or the plain trunk cylinder.
    let cx = t.x, cy = t.y, R = t.t + DISC_RADIUS;
    const zg = p[2] - world.terrain.heightAt(t.x, t.y);
    const shape = world.treeShape?.(t);
    if (shape) {
      const s = shape.trunk.find((q) => zg >= q.z0 - DISC_RADIUS && zg < q.z1 + DISC_RADIUS) ?? (zg < 0 ? shape.trunk[0] : undefined);
      if (!s) continue;
      cx = s.x; cy = s.y; R = s.r + DISC_RADIUS;
    } else if (zg > t.h * 0.9) continue;
    const dx = p[0] - cx, dy = p[1] - cy;
    const d = Math.hypot(dx, dy);
    if (d >= R) continue;
    if (phases(t, c)) continue;
    const nx = dx / (d || 1), ny = dy / (d || 1);
    const vn = v[0] * nx + v[1] * ny;
    if (vn < 0) {
      const keep = Math.min(0.95, 0.5 * c.m.trunkKeep);
      v[0] -= (1 + restitution) * vn * nx;
      v[1] -= (1 + restitution) * vn * ny;
      v[0] *= keep; v[1] *= keep; v[2] *= keep;
    }
    p[0] = cx + nx * R;
    p[1] = cy + ny * R;
    c.events.push('trunk');
    if (!c.hits.includes(t)) c.hits.push(t);
    if (c.m.treeChopper) c.mark('chop');
    return true;
  }
  return false;
}

interface BasketOpts {
  B: typeof BASKET;
  catchBonus: number;
  cutToCatch: number;
  /** Chance a band, tray or pole hit drops in anyway (Rattle Trap). */
  metalIn: number;
}

/** Basket with radii scaled (Wide Basket etc.); heights unchanged. */
function scaledBasket(k: number): typeof BASKET {
  if (k === 1) return BASKET;
  return { ...BASKET, poleR: BASKET.poleR, trayR: BASKET.trayR * k, chainR: BASKET.chainR * k, bandR: BASKET.bandR * k };
}

/** Basket contact. Returns holed / hit, and whether the disc is inside the chain zone (to detect entry). */
function basketCollide(prev: Vec3, p: Vec3, v: Vec3, basket: Vec2, rng: Rng, events: ThrowEvent[], wasInChains: boolean, o: BasketOpts): { holed: boolean; hit: boolean; inChains: boolean } {
  const dx = p[0] - basket[0], dy = p[1] - basket[1];
  const d = Math.hypot(dx, dy);
  const none = { holed: false, hit: false, inChains: false };
  if (d > 1) return none;
  const z = p[2];
  const B = o.B;
  /**
   * Bounce off a vertical surface of radius R around the pole: push the disc back outside it and
   * reflect the inward part of its velocity. Pushing out matters: without it the disc stays inside
   * the surface, gets damped again every step, and sticks to the basket.
   */
  const bounce = (keep: number, ev: ThrowEvent, R: number) => {
    const nx = d > 1e-6 ? dx / d : -v[0] / (Math.hypot(v[0], v[1]) || 1);
    const ny = d > 1e-6 ? dy / d : -v[1] / (Math.hypot(v[0], v[1]) || 1);
    const vn = v[0] * nx + v[1] * ny;
    if (d < R) { p[0] = basket[0] + nx * (R + 0.005); p[1] = basket[1] + ny * (R + 0.005); }
    if (vn >= 0) return { holed: false, hit: false, inChains: false }; // already moving away
    if (o.metalIn > 0 && rng() < o.metalIn) { events.push(ev); return { holed: true, hit: false, inChains: false }; } // rattled in off the metal
    v[0] -= 1.4 * vn * nx; v[1] -= 1.4 * vn * ny;
    v[0] *= keep; v[1] *= keep; v[2] = Math.min(v[2], 0) * keep;
    events.push(ev);
    return { holed: false, hit: true, inChains: false };
  };

  // Lid / top band.
  if (z > B.chainTop && z < B.bandTop + DISC_RADIUS * 0.5 && d < B.bandR + DISC_RADIUS) return bounce(0.3, 'band', B.bandR + DISC_RADIUS);
  // Chains.
  const inChains = z >= B.trayTop && z <= B.chainTop && d < B.chainR + DISC_RADIUS * 0.6;
  if (inChains && !wasInChains) {
    const sh = Math.hypot(v[0], v[1]) || 1e-6;
    // How centered the line of travel is: perpendicular distance from the pole to the path.
    const offset = Math.abs((v[0] * (basket[1] - prev[1]) - v[1] * (basket[0] - prev[0])) / sh);
    const s = Math.hypot(v[0], v[1], v[2]);
    const edge = Math.min(1, offset / (B.chainR + DISC_RADIUS * 0.6));
    const pCatch = Math.min(0.99, Math.max(CATCH.min, CATCH.base + o.catchBonus - CATCH.edgePenalty * edge ** 3 - CATCH.speedPenalty * Math.max(0, s - CATCH.fastSpeed)));
    events.push('chains');
    if (rng() < pCatch) return { holed: true, hit: false, inChains: true };
    if (edge > CATCH.cutEdge && o.cutToCatch > 0 && rng() < o.cutToCatch) return { holed: true, hit: false, inChains: true };
    if (edge <= CATCH.cutEdge && rng() < CATCH.rattle - CATCH.rattlePerSpeed * Math.max(0, s - CATCH.rattleSpeed)) {
      return { holed: true, hit: false, inChains: true }; // rattled in
    }
    if (edge > CATCH.cutEdge) {
      // Cut through the edge of the chains: keep going, slower, pushed away from the pole.
      const side = Math.sign(v[0] * dy - v[1] * dx) || 1;
      const yaw = Math.atan2(v[1], v[0]) + side * (0.2 + rng() * 0.35);
      const keep = sh * 0.5;
      v[0] = Math.cos(yaw) * keep; v[1] = Math.sin(yaw) * keep; v[2] *= 0.5;
      events.push('cut');
    } else {
      // Spit out backward.
      v[0] = -v[0] * (0.15 + rng() * 0.2) + (rng() - 0.5) * 1.5;
      v[1] = -v[1] * (0.15 + rng() * 0.2) + (rng() - 0.5) * 1.5;
      v[2] = Math.min(0, v[2]) * 0.3;
      events.push('spit');
    }
    return { holed: false, hit: true, inChains: true };
  }
  if (inChains) return { holed: false, hit: false, inChains: true };
  // Tray. Coming down inside its footprint (a spit-out or band hit dropping straight down, or a
  // disc sliding off the chains) lands in the tray, which counts as holed. Arriving from outside
  // at tray height hits the cage and bounces off.
  if (z >= B.trayBottom - DISC_RADIUS * 0.3 && z < B.trayTop && d < B.trayR + DISC_RADIUS) {
    const prevD = Math.hypot(prev[0] - basket[0], prev[1] - basket[1]);
    if (d < B.trayR && prevD < B.trayR && v[2] <= 0) return { holed: true, hit: false, inChains: false };
    return bounce(0.3, 'tray', B.trayR + DISC_RADIUS);
  }
  // Pole below the tray.
  if (z < B.trayBottom && d < B.poleR + DISC_RADIUS) return bounce(0.25, 'pole', B.poleR + DISC_RADIUS);
  return none;
}
