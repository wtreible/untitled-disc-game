// Simple shot model, docs/05-gameplay.md: parabolic flight, tree blocking, surface-dependent roll.
// The whole shot is simulated up front; the renderer just plays back `samples`.
import { distToSegment, type Vec2 } from '../course/geo';
import type { SurfaceClass } from '../course/types';
import { PUTT_MAX_M, type Club } from './clubs';
import type { SurfaceGrid } from './surfaces';
import type { Terrain, Vec3 } from './terrain';

export interface SurfaceProps {
  /** Multiplier on the next shot's carry. */
  lie: number;
  /** Multiplier on the next shot's dispersion. */
  dispersion: number;
  /** Roll factor: deceleration is ROLL_DECEL / roll. */
  roll: number;
}

export const SURFACES: Record<SurfaceClass, SurfaceProps> = {
  tee: { lie: 1, dispersion: 1, roll: 1 },
  fairway: { lie: 1, dispersion: 1, roll: 1 },
  rough: { lie: 0.85, dispersion: 1.4, roll: 0.4 },
  trees: { lie: 0.6, dispersion: 2, roll: 0.2 },
  bunker: { lie: 0.6, dispersion: 1.6, roll: 0.05 },
  green: { lie: 1, dispersion: 1, roll: 1.3 },
  path: { lie: 0.95, dispersion: 1.1, roll: 1.5 },
  water: { lie: 0, dispersion: 1, roll: 1 },
  oob: { lie: 0, dispersion: 1, roll: 1 },
};

export const CUP_RADIUS = 0.054;
/** Max ball speed (m/s) at which a ball passing over the cup drops. */
export const CUP_CAPTURE_SPEED = 1.3;
/** Rolling deceleration on a roll-factor-1 surface, m/s². */
export const ROLL_DECEL = 2.0;
const G = 9.81;
const FPS = 60;
const ROLL_DT = 1 / 240;

export function lieMultiplier(surface: SurfaceClass, club: Club): number {
  if (surface === 'bunker' && club.id === 'SW') return 0.9;
  return SURFACES[surface].lie;
}

export interface World {
  grid: SurfaceGrid;
  terrain: Terrain;
  pin: Vec2;
}

export interface ShotInput {
  start: Vec2;
  /** Aim direction, radians, counterclockwise from +x (east). */
  aim: number;
  club: Club;
  /** 0..1 */
  power: number;
}

export type ShotEvent = 'tree' | 'water' | 'oob' | 'bunker' | 'holed' | 'lipout';

export interface ShotResult {
  /** Ball position sampled at 60 Hz, in local meters with z up. */
  samples: Vec3[];
  /** Where the next shot is played from (after any drop). */
  rest: Vec2;
  restSurface: SurfaceClass;
  holed: boolean;
  penalty: number;
  events: ShotEvent[];
}

export type Rng = () => number;

/** Seeded PRNG (mulberry32) so shots are reproducible in tests. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: Rng): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Landing point with no dispersion, for the aim preview. */
export function previewCarry(input: ShotInput, lie: SurfaceClass): number {
  if (input.club.carry === 0) return input.power * PUTT_MAX_M;
  return input.club.carry * input.power * lieMultiplier(lie, input.club);
}

export function simulateShot(input: ShotInput, world: World, rng: Rng = Math.random): ShotResult {
  const { grid, terrain } = world;
  const lie = grid.classAt(input.start[0], input.start[1]);
  const disp = SURFACES[lie].dispersion;
  const club = input.club;
  const dirAngle = input.aim + (gaussian(rng) * club.dispersionDeg * disp * Math.PI) / 180;
  const dir: Vec2 = [Math.cos(dirAngle), Math.sin(dirAngle)];
  const samples: Vec3[] = [];
  const events: ShotEvent[] = [];
  const at = (p: Vec2): Vec3 => [p[0], p[1], terrain.heightAt(p[0], p[1])];

  // Putter: ground roll only. Speed chosen so a putt on the green travels power × PUTT_MAX_M.
  if (club.carry === 0) {
    const decel = ROLL_DECEL / SURFACES.green.roll;
    const v0 = Math.sqrt(2 * decel * input.power * PUTT_MAX_M);
    samples.push(at(input.start));
    return roll(input.start, dir, v0, world, samples, events, input.start);
  }

  // Flight.
  const distFactor = 1 + gaussian(rng) * 0.04 * disp;
  const carry = Math.max(1, club.carry * input.power * lieMultiplier(lie, club) * distFactor);
  const apex = club.apex * Math.max(0.3, input.power);
  const T = 1.2 + carry / 45;
  const n = Math.max(2, Math.ceil(T * FPS));
  const z0 = terrain.heightAt(input.start[0], input.start[1]);
  const land: Vec2 = [input.start[0] + dir[0] * carry, input.start[1] + dir[1] * carry];
  const z1 = terrain.heightAt(land[0], land[1]);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = input.start[0] + dir[0] * carry * t;
    const y = input.start[1] + dir[1] * carry * t;
    const z = z0 + (z1 - z0) * t + 4 * apex * t * (1 - t);
    const canopy = grid.canopyAt(x, y);
    if (i > 0 && canopy > 0 && z < terrain.heightAt(x, y) + canopy) {
      // Tree hit (option B): lose the shot's energy and drop near the contact point.
      events.push('tree');
      const drop: Vec2 = [x + (rng() - 0.5) * 3, y + (rng() - 0.5) * 3];
      const zd = terrain.heightAt(drop[0], drop[1]);
      const fall = Math.ceil(0.5 * FPS);
      for (let k = 1; k <= fall; k++) {
        const s = k / fall;
        samples.push([x + (drop[0] - x) * s, y + (drop[1] - y) * s, z + (zd - z) * s * s]);
      }
      return settle(drop, world, samples, events, input.start);
    }
    samples.push([x, y, z]);
  }

  if (Math.hypot(land[0] - world.pin[0], land[1] - world.pin[1]) < CUP_RADIUS * 2) {
    events.push('holed');
    return { samples, rest: world.pin, restSurface: 'green', holed: true, penalty: 0, events };
  }
  const landSurface = grid.classAt(land[0], land[1]);
  if (landSurface === 'water' || landSurface === 'oob') return settle(land, world, samples, events, input.start);

  // Roll out. v0 chosen so the ball rolls carry × club.roll on a factor-1 surface.
  const v0 = Math.sqrt(2 * ROLL_DECEL * carry * club.roll);
  return roll(land, dir, v0, world, samples, events, input.start);
}

function roll(
  from: Vec2, dir: Vec2, v0: number, world: World, samples: Vec3[], events: ShotEvent[], shotStart: Vec2,
): ShotResult {
  const { grid, terrain, pin } = world;
  let p: Vec2 = [from[0], from[1]];
  let v: Vec2 = [dir[0] * v0, dir[1] * v0];
  let clock = 0;
  for (let step = 0; step < 240 * 30; step++) {
    const speed = Math.hypot(v[0], v[1]);
    if (speed < 0.01) break;
    const surface = grid.classAt(p[0], p[1]);
    if (surface === 'water' || surface === 'oob') return settle(p, world, samples, events, shotStart);
    // Rolling resistance opposes motion; slope pulls downhill (zero on FlatTerrain).
    const decel = ROLL_DECEL / SURFACES[surface].roll;
    const [nx, ny, nz] = terrain.normalAt(p[0], p[1]);
    const newSpeed = Math.max(0, speed - decel * ROLL_DT);
    v = [(v[0] / speed) * newSpeed + G * (nx / nz) * ROLL_DT, (v[1] / speed) * newSpeed + G * (ny / nz) * ROLL_DT];
    const next: Vec2 = [p[0] + v[0] * ROLL_DT, p[1] + v[1] * ROLL_DT];
    if (distToSegment(pin, p, next) <= CUP_RADIUS) {
      if (speed <= CUP_CAPTURE_SPEED) {
        samples.push([pin[0], pin[1], terrain.heightAt(pin[0], pin[1]) - 0.05]);
        events.push('holed');
        return { samples, rest: pin, restSurface: 'green', holed: true, penalty: 0, events };
      }
      if (!events.includes('lipout')) events.push('lipout');
    }
    p = next;
    clock += ROLL_DT;
    if (clock >= 1 / FPS) {
      clock -= 1 / FPS;
      samples.push([p[0], p[1], terrain.heightAt(p[0], p[1])]);
    }
  }
  samples.push([p[0], p[1], terrain.heightAt(p[0], p[1])]);
  return settle(p, world, samples, events, shotStart);
}

/** Ball has stopped at p (or entered water/OOB there). Apply drops and penalties. */
function settle(p: Vec2, world: World, samples: Vec3[], events: ShotEvent[], shotStart: Vec2): ShotResult {
  const { grid } = world;
  const surface = grid.classAt(p[0], p[1]);
  if (surface === 'water' || surface === 'oob') {
    events.push(surface);
    // Water: drop where the ball crossed into the hazard. OOB (casual, D19): drop just inside
    // where it left the course. Both: walk back toward the shot's start, then step 2 m further.
    const rest = walkBackToPlayable(p, shotStart, grid, 2);
    return { samples, rest, restSurface: grid.classAt(rest[0], rest[1]), holed: false, penalty: 1, events };
  }
  if (surface === 'bunker') events.push('bunker');
  return { samples, rest: p, restSurface: surface, holed: false, penalty: 0, events };
}

function walkBackToPlayable(p: Vec2, toward: Vec2, grid: SurfaceGrid, extra: number): Vec2 {
  const L = Math.hypot(toward[0] - p[0], toward[1] - p[1]);
  if (L < 1e-6) return toward;
  const ux = (toward[0] - p[0]) / L;
  const uy = (toward[1] - p[1]) / L;
  const bad = (s: SurfaceClass) => s === 'water' || s === 'oob';
  for (let d = 0; d <= L; d += 0.25) {
    if (!bad(grid.classAt(p[0] + ux * d, p[1] + uy * d))) {
      const e = Math.min(L, d + extra);
      const q: Vec2 = [p[0] + ux * e, p[1] + uy * e];
      return bad(grid.classAt(q[0], q[1])) ? [p[0] + ux * d, p[1] + uy * d] : q;
    }
  }
  return toward;
}
