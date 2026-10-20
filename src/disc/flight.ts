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
import type { Vec2 } from '../course/geo';
import type { SurfaceClass } from '../course/types';
import type { Rng } from '../game/physics';
import type { SurfaceGrid } from '../game/surfaces';
import type { Terrain, Vec3 } from '../game/terrain';
import { DISC_RADIUS, type Disc } from './discs';
import type { TreeIndex } from './trees';
import { NEUTRAL, type Mods } from './mods';

const G = 9.81;
/** Putts from closer than this are dropped in. */
export const TAP_IN = 1.0;
const DT = 1 / 240;
const SAMPLE_EVERY = 4; // 240 / 4 = 60 Hz
const MAX_T = 14;

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
  cda: 1.2,
  alpha0: -0.07,
  /** Nose angle relative to launch angle at release (slightly nose-up). */
  nose: 0.03,
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
  /** Branch hits per meter traveled inside a crown. */
  branchDensity: 0.25,
  /** Skid deceleration after landing, m/s², by surface. */
  skid: { default: 7, trees: 11, path: 3.5, tee: 4, fairway: 6 } as Record<string, number>,
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
  speedPenalty: 0.03,
  fastSpeed: 11,
  min: 0.08,
  /** Misses with the line this far out (0 center … 1 edge) cut through instead of spitting out. */
  cutEdge: 0.8,
};

export interface DiscWorld {
  grid: SurfaceGrid;
  terrain: Terrain;
  trees: TreeIndex;
  basket: Vec2;
  /** Branch hits per meter inside a crown; defaults to FLIGHT.branchDensity. */
  branchDensity?: number;
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
  /** Mirror the curve for left-handed backhand / right-handed forehand. */
  mirror?: boolean;
  /** Player modifiers (roguelike powerups). Omitted = base game. */
  mods?: Mods;
  /** First throw of the hole (tee-only modifiers). */
  fromTee?: boolean;
  /** Zero execution error: fly exactly the ghost line (Perfect Form). */
  perfect?: boolean;
}

export type ThrowEvent = 'trunk' | 'branch' | 'chains' | 'spit' | 'cut' | 'band' | 'tray' | 'pole' | 'water' | 'oob' | 'holed' | 'phased' | 'saved' | 'gimme' | 'magnet';

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
}

// Distance fraction → release speed fraction, measured from this model (a midrange, flat, full
// glide). Distance grows ~v^3.7 because lift collapses at low speed, so a linear meter would make
// the bottom half useless. Interpolating the inverse makes the meter ~linear in distance.
const METER_CURVE: [number, number][] = [
  [0, 0.15], [0.06, 0.3], [0.1, 0.4], [0.14, 0.5], [0.24, 0.6], [0.38, 0.7], [0.58, 0.8], [0.8, 0.9], [1, 1],
];

export function meterToSpeed(m: number): number {
  const x = Math.min(1, Math.max(0, m));
  for (let i = 1; i < METER_CURVE.length; i++) {
    const [x1, y1] = METER_CURVE[i];
    if (x <= x1) {
      const [x0, y0] = METER_CURVE[i - 1];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return 1;
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
  const disc: Disc = { ...input.disc, glide: input.disc.glide + m.glide, turn: input.disc.turn + m.turn, fade: input.disc.fade + m.fade };
  const putt = input.style === 'putt';
  const err = putt ? m.puttAimError : m.aimError;
  const noise = opt.ghost || input.perfect ? () => 0 : () => gaussian(rng) * err;
  const mirror = input.mirror ? -1 : 1;

  // Release, with execution error (bigger when muscling past ~90%).
  const over = m.noOverpowerWobble ? 0 : Math.max(0, input.power - 0.9) * 10;
  const yaw = input.aim + (noise() * (putt ? 0.5 : 1.4 + over * 2) * Math.PI) / 180;
  // Distance bonuses scale the meter, which maps ~linearly to distance; past full power, release
  // speed grows with the measured full-power sensitivity (distance ∝ v^~1.8 there).
  const meter = input.power * (putt ? FLIGHT.puttScale * m.puttRange : m.distance * (input.fromTee ? m.teeDistance : 1));
  const power = (meter <= 1 ? meterToSpeed(meter) : meter ** 0.55) * (1 + noise() * (putt ? 0.015 : 0.02));
  const launch = (input.launch ?? (putt ? 0.12 : 0.11)) + noise() * 0.01;
  let bank = mirror * (input.hyzer * FLIGHT.maxReleaseBank * m.shape + noise() * 0.04);
  const speed0 = disc.v0 * power;
  let p: Vec3 = [input.start[0], input.start[1], world.terrain.heightAt(input.start[0], input.start[1]) + (input.releaseZ ?? 1.0)];
  let v: Vec3 = [Math.cos(yaw) * Math.cos(launch) * speed0, Math.sin(yaw) * Math.cos(launch) * speed0, Math.sin(launch) * speed0];

  const cl0 = FLIGHT.cl0 + FLIGHT.cl0PerGlide * (disc.glide - 5);
  const cd0 = Math.max(0.02, FLIGHT.cd0 + FLIGHT.cd0PerSpeed * disc.speed);
  const nose = launch + FLIGHT.nose;
  // Putts get a fraction of the spin-driven roll: push putts are thrown flat and slow.
  const turnK = putt ? 0.3 : 1;

  const samples: Vec3[] = [[...p]];
  const banks: number[] = [bank];
  if (!opt.ghost && putt && Math.hypot(input.start[0] - world.basket[0], input.start[1] - world.basket[1]) < Math.max(TAP_IN, m.tapIn)) {
    // Tap-in: inside a meter you just drop it in.
    const [bx, by] = world.basket;
    for (let k = 1; k <= 20; k++) samples.push([p[0] + (bx - p[0]) * (k / 20), p[1] + (by - p[1]) * (k / 20), p[2] + (BASKET.trayBottom + 0.05 - p[2]) * (k / 20)]);
    return { samples, banks: samples.map(() => 0), rest: world.basket, restSurface: 'green', holed: true, penalty: 0, events: ['holed'], treesHit: [] };
  }
  const events: ThrowEvent[] = [];
  const tctx: TreeCtx = { m, phaseLeft: m.phaseTrees, passed: new Set(), hits: [], basket: world.basket, rng, events };
  const bopt: BasketOpts = {
    B: scaledBasket(m.basketScale),
    catchBonus: m.catchBonus + (input.fromTee ? m.teeCatchBonus : 0),
    cutToCatch: m.cutToCatch,
  };
  let state: 'flight' | 'dead' | 'ground' = 'flight';
  let holedAt: Vec3 | null = null;
  const near: Tree[] = [];
  let inChains = false;

  for (let step = 1; step * DT < MAX_T; step++) {
    const s = Math.hypot(v[0], v[1], v[2]);
    const ground = world.terrain.heightAt(p[0], p[1]);

    if (state === 'ground') {
      const sh = Math.hypot(v[0], v[1]);
      if (sh < 0.05) break;
      const surf = world.grid.classAt(p[0], p[1]);
      const decel = (FLIGHT.skid[surf] ?? FLIGHT.skid.default) / m.skid;
      const ns = Math.max(0, sh - decel * DT);
      v = [(v[0] / sh) * ns, (v[1] / sh) * ns, 0];
      p = [p[0] + v[0] * DT, p[1] + v[1] * DT, ground];
      if (!opt.ghost) trunkCollide(p, v, world, near, tctx, 0.2);
    } else {
      // Forces.
      const q = s / disc.v0; // speed relative to this disc's full-power release
      const f: Vec3 = [v[0] / s, v[1] / s, v[2] / s];
      const hl = Math.hypot(f[0], f[1]) || 1e-6;
      const r: Vec3 = [f[1] / hl, -f[0] / hl, 0]; // horizontal right of travel
      const u: Vec3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]]; // up, ⟂ f
      // Angle of attack: fixed nose angle minus the flight path angle. A tumbling (dead) disc
      // gets a fraction of the lift and extra drag.
      const alpha = Math.max(-0.5, Math.min(0.6, nose - Math.atan2(v[2], Math.hypot(v[0], v[1]))));
      const dead = state === 'dead';
      const CL = (cl0 + FLIGHT.cla * alpha) * (dead ? 0.2 : 1);
      const CD = cd0 + FLIGHT.cda * (alpha - FLIGHT.alpha0) ** 2 + (dead ? 0.3 : 0);
      const L = FLIGHT.K * s * s * CL;
      const D = FLIGHT.K * s * CD; // × v below gives K·s²·CD along −v
      const n: Vec3 = [u[0] * Math.cos(bank) - r[0] * Math.sin(bank), u[1] * Math.cos(bank) - r[1] * Math.sin(bank), u[2] * Math.cos(bank) - r[2] * Math.sin(bank)];
      const a: Vec3 = [L * n[0] - D * v[0], L * n[1] - D * v[1], L * n[2] - D * v[2] - G];
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
      v = [v[0] + a[0] * DT, v[1] + a[1] * DT, v[2] + a[2] * DT];
      const prev: Vec3 = p;
      p = [p[0] + v[0] * DT, p[1] + v[1] * DT, p[2] + v[2] * DT];

      if (state === 'flight') {
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
        if (hitTree) { state = 'dead'; bank = (rng() - 0.5) * 1.2; }
        const b = basketCollide(prev, p, v, world.basket, rng, events, inChains, bopt);
        inChains = b.inChains;
        if (b.holed) { holedAt = p; break; }
        if (b.hit) { state = 'dead'; }
      }

      if (p[2] <= ground) {
        // Landing: keep a fraction of horizontal speed as a skid.
        p = [p[0], p[1], ground];
        const keep = m.sticky ? 0 : state === 'dead' ? 0.25 : 0.4;
        v = [v[0] * keep, v[1] * keep, 0];
        state = 'ground';
        const surf = world.grid.classAt(p[0], p[1]);
        if (surf === 'water' || surf === 'oob') break;
      }
    }

    if (step % SAMPLE_EVERY === 0) {
      samples.push([...p]);
      banks.push(state === 'ground' ? 0 : bank);
    }
  }

  const treesHit = tctx.hits;
  const holedResult = (from: Vec3, ev: ThrowEvent): ThrowResult => {
    // Drop into the tray.
    const [bx, by] = world.basket;
    const z0 = from[2];
    for (let k = 1; k <= 18; k++) {
      const t = k / 18;
      samples.push([from[0] + (bx - from[0]) * t * 0.6, from[1] + (by - from[1]) * t * 0.6, z0 + (BASKET.trayBottom + 0.05 - z0) * t]);
      banks.push(0);
    }
    if (ev !== 'holed') events.push(ev);
    events.push('holed');
    return { samples, banks, rest: world.basket, restSurface: 'green', holed: true, penalty: 0, events, treesHit };
  };
  if (holedAt) return holedResult(holedAt, 'holed');

  samples.push([...p]);
  banks.push(0);
  let rest: Vec2 = [p[0], p[1]];
  const surf = world.grid.classAt(rest[0], rest[1]);
  if (surf === 'water' || surf === 'oob') {
    // Play from where it last crossed into OB (casual, D19): last in-bounds point on the path.
    let drop: Vec2 = input.start;
    for (let i = samples.length - 1; i >= 0; i--) {
      const c = world.grid.classAt(samples[i][0], samples[i][1]);
      if (c !== 'water' && c !== 'oob') { drop = [samples[i][0], samples[i][1]]; break; }
    }
    // Sticky Plastic: a near miss (within 2 m of the edge) is saved, no penalty.
    if (m.sticky && Math.hypot(drop[0] - rest[0], drop[1] - rest[1]) <= 2) {
      events.push('saved');
      return { samples, banks, rest: drop, restSurface: world.grid.classAt(drop[0], drop[1]), holed: false, penalty: 0, events, treesHit };
    }
    events.push(surf);
    return { samples, banks, rest: drop, restSurface: world.grid.classAt(drop[0], drop[1]), holed: false, penalty: m.obInsurance ? 0 : 1, events, treesHit };
  }
  if (!opt.ghost) {
    const d = Math.hypot(rest[0] - world.basket[0], rest[1] - world.basket[1]);
    if (d < m.gimme) return holedResult([...p], 'gimme');
    if (m.magnet > 0 && d < m.magnet && d > 0.4) {
      // Magnet Basket: slide up to 1.5 m toward the basket.
      const slide = Math.min(1.5, d - 0.3);
      const ux = (world.basket[0] - rest[0]) / d, uy = (world.basket[1] - rest[1]) / d;
      for (let k = 1; k <= 30; k++) {
        const t = (k / 30) * slide;
        samples.push([rest[0] + ux * t, rest[1] + uy * t, p[2]]);
        banks.push(0);
      }
      rest = [rest[0] + ux * slide, rest[1] + uy * slide];
      events.push('magnet');
    }
  }
  return { samples, banks, rest, restSurface: world.grid.classAt(rest[0], rest[1]), holed: false, penalty: 0, events, treesHit };
}

interface TreeCtx {
  m: Mods;
  /** Trees left to pass through this throw (Ghost/Phase Disc), and ones already passed. */
  phaseLeft: number;
  passed: Set<Tree>;
  hits: Tree[];
  basket: Vec2;
  rng: Rng;
  events: ThrowEvent[];
}

/** True if the disc should ignore this tree (phasing through it). */
function phases(t: Tree, c: TreeCtx): boolean {
  if (c.passed.has(t)) return true;
  if (c.phaseLeft > 0) {
    c.phaseLeft--;
    c.passed.add(t);
    c.events.push('phased');
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
    const zc = g + (t.b + t.h) / 2;
    const hz = Math.max(0.3, (t.h - t.b) / 2);
    const dx = p[0] - t.x, dy = p[1] - t.y, dz = p[2] - zc;
    const k = (dx * dx + dy * dy) / ((t.r + DISC_RADIUS) ** 2) + (dz * dz) / (hz * hz);
    if (k >= 1) continue;
    // Denser toward the crown's middle.
    const lambda = (world.branchDensity ?? FLIGHT.branchDensity) * m.branch * (1.4 - k);
    if (rng() < 1 - Math.exp(-lambda * ds)) {
      if (phases(t, c)) continue;
      if (m.branchPass > 0 && rng() < m.branchPass) continue;
      events.push('branch');
      if (!c.hits.includes(t)) c.hits.push(t);
      // Kick in a random direction (or toward the basket with Lucky Kicks), keep 20–40% of the speed.
      const s = Math.hypot(v[0], v[1], v[2]) * (0.2 + rng() * 0.2);
      const yaw = m.kickToward
        ? Math.atan2(c.basket[1] - p[1], c.basket[0] - p[0]) + (rng() - 0.5) * 0.6
        : Math.atan2(v[1], v[0]) + (rng() - 0.5) * 2 * 2.2;
      v[0] = Math.cos(yaw) * s;
      v[1] = Math.sin(yaw) * s;
      v[2] = (rng() - 0.6) * s;
      return true;
    }
  }
  return false;
}

function trunkCollide(p: Vec3, v: Vec3, world: DiscWorld, near: Tree[], c: TreeCtx, restitution: number): boolean {
  for (const t of world.trees.near(p[0], p[1], near)) {
    const dx = p[0] - t.x, dy = p[1] - t.y;
    const d = Math.hypot(dx, dy);
    const R = t.t + DISC_RADIUS;
    if (d >= R || p[2] > world.terrain.heightAt(t.x, t.y) + t.h * 0.9) continue;
    if (phases(t, c)) continue;
    const nx = dx / (d || 1), ny = dy / (d || 1);
    const vn = v[0] * nx + v[1] * ny;
    if (vn < 0) {
      const keep = Math.min(0.95, 0.5 * c.m.trunkKeep);
      v[0] -= (1 + restitution) * vn * nx;
      v[1] -= (1 + restitution) * vn * ny;
      v[0] *= keep; v[1] *= keep; v[2] *= keep;
    }
    p[0] = t.x + nx * R;
    p[1] = t.y + ny * R;
    c.events.push('trunk');
    if (!c.hits.includes(t)) c.hits.push(t);
    return true;
  }
  return false;
}

interface BasketOpts {
  B: typeof BASKET;
  catchBonus: number;
  cutToCatch: number;
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
