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
  /** Release angle for hyzer = ±1. */
  maxReleaseBank: 0.35,
  /** Putts use this fraction of the meter, so a full putt meter reaches ~25 m. */
  puttScale: 0.42,
  /** Branch hits per meter traveled inside a crown. */
  branchDensity: 0.25,
  /** Skid deceleration after landing, m/s², by surface. */
  skid: { default: 7, trees: 11, path: 3.5, tee: 4, fairway: 6 } as Record<string, number>,
};

/** Standard basket dimensions (m). */
export const BASKET = {
  poleR: 0.024,
  trayBottom: 0.58,
  trayTop: 0.8,
  trayR: 0.33,
  chainR: 0.28,
  chainTop: 1.32,
  bandTop: 1.4,
  bandR: 0.32,
};

export interface DiscWorld {
  grid: SurfaceGrid;
  terrain: Terrain;
  trees: TreeIndex;
  basket: Vec2;
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
}

export type ThrowEvent = 'trunk' | 'branch' | 'chains' | 'spit' | 'cut' | 'band' | 'tray' | 'pole' | 'water' | 'oob' | 'holed';

export interface ThrowResult {
  samples: Vec3[];
  /** Bank angle per sample, for rendering the disc's tilt. */
  banks: number[];
  rest: Vec2;
  restSurface: SurfaceClass;
  holed: boolean;
  penalty: number;
  events: ThrowEvent[];
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
  const { disc } = input;
  const putt = input.style === 'putt';
  const noise = opt.ghost ? () => 0 : () => gaussian(rng);
  const mirror = input.mirror ? -1 : 1;

  // Release, with execution error (bigger when muscling past ~90%).
  const over = Math.max(0, input.power - 0.9) * 10;
  const yaw = input.aim + (noise() * (putt ? 0.5 : 1.4 + over * 2) * Math.PI) / 180;
  const power = meterToSpeed(input.power * (putt ? FLIGHT.puttScale : 1)) * (1 + noise() * (putt ? 0.015 : 0.02));
  const launch = (input.launch ?? (putt ? 0.12 : 0.11)) + noise() * 0.01;
  let bank = mirror * (input.hyzer * FLIGHT.maxReleaseBank + noise() * 0.04);
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
  if (!opt.ghost && putt && Math.hypot(input.start[0] - world.basket[0], input.start[1] - world.basket[1]) < TAP_IN) {
    // Tap-in: inside a meter you just drop it in.
    const [bx, by] = world.basket;
    for (let k = 1; k <= 20; k++) samples.push([p[0] + (bx - p[0]) * (k / 20), p[1] + (by - p[1]) * (k / 20), p[2] + (BASKET.trayBottom + 0.05 - p[2]) * (k / 20)]);
    return { samples, banks: samples.map(() => 0), rest: world.basket, restSurface: 'green', holed: true, penalty: 0, events: ['holed'] };
  }
  const events: ThrowEvent[] = [];
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
      const decel = FLIGHT.skid[surf] ?? FLIGHT.skid.default;
      const ns = Math.max(0, sh - decel * DT);
      v = [(v[0] / sh) * ns, (v[1] / sh) * ns, 0];
      p = [p[0] + v[0] * DT, p[1] + v[1] * DT, ground];
      if (!opt.ghost) trunkCollide(p, v, world, near, events, 0.2);
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
      v = [v[0] + a[0] * DT, v[1] + a[1] * DT, v[2] + a[2] * DT];
      const prev: Vec3 = p;
      p = [p[0] + v[0] * DT, p[1] + v[1] * DT, p[2] + v[2] * DT];

      if (state === 'flight') {
        // Turn needs speed (> ~60% of full release); fade grows as the disc slows.
        const hs = Math.min(1, Math.max(0, (q - 0.6) / 0.4));
        const ls = Math.min(1, Math.max(0, (0.8 - q) / 0.8));
        bank += mirror * (FLIGHT.turnRate * disc.turn * hs * turnK + FLIGHT.fadeRate * disc.fade * ls) * DT;
      }

      if (!opt.ghost) {
        const hitTree = treeCollide(prev, p, v, world, near, rng, events);
        if (hitTree) { state = 'dead'; bank = (rng() - 0.5) * 1.2; }
        const b = basketCollide(prev, p, v, world.basket, rng, events, inChains);
        inChains = b.inChains;
        if (b.holed) { holedAt = p; break; }
        if (b.hit) { state = 'dead'; }
      }

      if (p[2] <= ground) {
        // Landing: keep a fraction of horizontal speed as a skid.
        p = [p[0], p[1], ground];
        const keep = state === 'dead' ? 0.25 : 0.4;
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

  if (holedAt) {
    // Drop into the tray.
    const [bx, by] = world.basket;
    const z0 = holedAt[2];
    for (let k = 1; k <= 18; k++) {
      const t = k / 18;
      samples.push([holedAt[0] + (bx - holedAt[0]) * t * 0.6, holedAt[1] + (by - holedAt[1]) * t * 0.6, z0 + (BASKET.trayBottom + 0.05 - z0) * t]);
      banks.push(0);
    }
    events.push('holed');
    return { samples, banks, rest: world.basket, restSurface: 'green', holed: true, penalty: 0, events };
  }

  samples.push([...p]);
  banks.push(0);
  const rest: Vec2 = [p[0], p[1]];
  const surf = world.grid.classAt(rest[0], rest[1]);
  if (surf === 'water' || surf === 'oob') {
    events.push(surf);
    // Play from where it last crossed into OB (casual, D19): last in-bounds point on the path.
    let drop: Vec2 = input.start;
    for (let i = samples.length - 1; i >= 0; i--) {
      const c = world.grid.classAt(samples[i][0], samples[i][1]);
      if (c !== 'water' && c !== 'oob') { drop = [samples[i][0], samples[i][1]]; break; }
    }
    return { samples, banks, rest: drop, restSurface: world.grid.classAt(drop[0], drop[1]), holed: false, penalty: 1, events };
  }
  return { samples, banks, rest, restSurface: surf, holed: false, penalty: 0, events };
}

/** Trunk cylinders (hard) and crown ellipsoids (probabilistic branch hits). Mutates p and v. */
function treeCollide(prev: Vec3, p: Vec3, v: Vec3, world: DiscWorld, near: Tree[], rng: Rng, events: ThrowEvent[]): boolean {
  if (trunkCollide(p, v, world, near, events, 0.35)) return true;
  const ds = Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
  for (const t of world.trees.near(p[0], p[1], near)) {
    const g = world.terrain.heightAt(t.x, t.y);
    const zc = g + (t.b + t.h) / 2;
    const hz = Math.max(0.3, (t.h - t.b) / 2);
    const dx = p[0] - t.x, dy = p[1] - t.y, dz = p[2] - zc;
    const k = (dx * dx + dy * dy) / ((t.r + DISC_RADIUS) ** 2) + (dz * dz) / (hz * hz);
    if (k >= 1) continue;
    // Denser toward the crown's middle.
    const lambda = FLIGHT.branchDensity * (1.4 - k);
    if (rng() < 1 - Math.exp(-lambda * ds)) {
      events.push('branch');
      // Kick in a random direction, mostly sideways/back, keep a third of the speed.
      const s = Math.hypot(v[0], v[1], v[2]) * (0.2 + rng() * 0.2);
      const yaw = Math.atan2(v[1], v[0]) + (rng() - 0.5) * 2 * 2.2;
      v[0] = Math.cos(yaw) * s;
      v[1] = Math.sin(yaw) * s;
      v[2] = (rng() - 0.6) * s;
      return true;
    }
  }
  return false;
}

function trunkCollide(p: Vec3, v: Vec3, world: DiscWorld, near: Tree[], events: ThrowEvent[], restitution: number): boolean {
  for (const t of world.trees.near(p[0], p[1], near)) {
    const dx = p[0] - t.x, dy = p[1] - t.y;
    const d = Math.hypot(dx, dy);
    const R = t.t + DISC_RADIUS;
    if (d >= R || p[2] > world.terrain.heightAt(t.x, t.y) + t.h * 0.9) continue;
    const nx = dx / (d || 1), ny = dy / (d || 1);
    const vn = v[0] * nx + v[1] * ny;
    if (vn < 0) {
      v[0] -= (1 + restitution) * vn * nx;
      v[1] -= (1 + restitution) * vn * ny;
      v[0] *= 0.5; v[1] *= 0.5; v[2] *= 0.5;
    }
    p[0] = t.x + nx * R;
    p[1] = t.y + ny * R;
    events.push('trunk');
    return true;
  }
  return false;
}

/** Basket contact. Returns holed / hit, and whether the disc is inside the chain zone (to detect entry). */
function basketCollide(prev: Vec3, p: Vec3, v: Vec3, basket: Vec2, rng: Rng, events: ThrowEvent[], wasInChains: boolean): { holed: boolean; hit: boolean; inChains: boolean } {
  const dx = p[0] - basket[0], dy = p[1] - basket[1];
  const d = Math.hypot(dx, dy);
  const none = { holed: false, hit: false, inChains: false };
  if (d > 1) return none;
  const z = p[2];
  const B = BASKET;
  const bounce = (keep: number, ev: ThrowEvent) => {
    const nx = dx / (d || 1), ny = dy / (d || 1);
    const vn = v[0] * nx + v[1] * ny;
    if (vn < 0) { v[0] -= 1.4 * vn * nx; v[1] -= 1.4 * vn * ny; }
    v[0] *= keep; v[1] *= keep; v[2] = Math.min(v[2], 0) * keep;
    events.push(ev);
    return { holed: false, hit: true, inChains: false };
  };

  // Lid / top band.
  if (z > B.chainTop && z < B.bandTop + DISC_RADIUS * 0.5 && d < B.bandR + DISC_RADIUS) return bounce(0.3, 'band');
  // Chains.
  const inChains = z >= B.trayTop && z <= B.chainTop && d < B.chainR + DISC_RADIUS * 0.6;
  if (inChains && !wasInChains) {
    const sh = Math.hypot(v[0], v[1]) || 1e-6;
    // How centered the line of travel is: perpendicular distance from the pole to the path.
    const offset = Math.abs((v[0] * (basket[1] - prev[1]) - v[1] * (basket[0] - prev[0])) / sh);
    const s = Math.hypot(v[0], v[1], v[2]);
    const edge = Math.min(1, offset / (B.chainR + DISC_RADIUS * 0.6));
    const pCatch = Math.min(0.98, Math.max(0.04, 0.97 - 0.85 * edge ** 2.5 - 0.05 * Math.max(0, s - 9)));
    events.push('chains');
    if (rng() < pCatch) return { holed: true, hit: false, inChains: true };
    if (edge > 0.65) {
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
  // Tray side / rim.
  if (z >= B.trayBottom - DISC_RADIUS * 0.3 && z < B.trayTop && d < B.trayR + DISC_RADIUS) {
    // Falling in from directly above the tray (rare, between chains and rim) counts.
    if (prev[2] >= B.trayTop && d < B.trayR - DISC_RADIUS) return { holed: true, hit: false, inChains: false };
    return bounce(0.3, 'tray');
  }
  // Pole below the tray.
  if (z < B.trayBottom && d < B.poleR + DISC_RADIUS) return bounce(0.25, 'pole');
  return none;
}
