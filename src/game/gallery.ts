// Spectators around the basket: where they stand, and where they run to when a throw comes their
// way. Plain geometry here; src/render/gallery.ts draws and animates them. Spectators are scenery:
// the flight model never sees them, so a throw can't hit one, and they get out of its way in time.
import type { Vec2 } from '../course/geo';
import type { Vec3 } from './terrain';

export interface Spot {
  at: Vec2;
  /** Heading they face (CCW from +x): toward the basket. */
  face: number;
}

/** Spectators stand this far from the basket. */
const RING: [number, number] = [7, 12];
/** Never in front of the basket: within this angle of the line throws come in on. */
const FRONT_HALF_ANGLE = (50 * Math.PI) / 180;
/** Elbow room: where people stand, and where they step to. */
export const APART = 1.6;
/** Closer than this, two people are inside each other: they're pushed apart (separate). */
export const BODY = 0.8;
/** Disc lower than this can reach someone standing. */
const HEAD = 2.6;
/** Closer to a flight path than this, move… */
export const CLEAR = 3;
/** …to at least this far from it. */
export const SAFE = 4.5;

/**
 * Up to n places around the basket: 7–12 m out, behind and beside it (not in the cone the
 * throws come in through), on open ground. `incoming` is the direction throws travel toward the
 * basket (unit vector). Fewer than n if the ground is crowded.
 */
export function gallerySpots(pin: Vec2, incoming: Vec2, n: number, free: (p: Vec2) => boolean, rng: () => number): Spot[] {
  const out: Spot[] = [];
  const back = Math.atan2(incoming[1], incoming[0]);
  const span = Math.PI - FRONT_HALF_ANGLE;
  for (let tries = 0; tries < n * 40 && out.length < n; tries++) {
    const a = back + (rng() * 2 - 1) * span;
    const r = RING[0] + rng() * (RING[1] - RING[0]);
    const p: Vec2 = [pin[0] + Math.cos(a) * r, pin[1] + Math.sin(a) * r];
    if (!free(p) || out.some((s) => Math.hypot(s.at[0] - p[0], s.at[1] - p[1]) < APART)) continue;
    out.push({ at: p, face: Math.atan2(pin[1] - p[1], pin[0] - p[0]) });
  }
  return out;
}

/** Nearest horizontal distance from p to the low part of a path, and where along it. */
function closest(p: Vec2, path: Vec3[]): { d: number; i: number } {
  let d = Infinity, i = -1;
  for (let k = 0; k < path.length; k++) {
    if (path[k][2] > HEAD) continue;
    const dk = Math.hypot(path[k][0] - p[0], path[k][1] - p[1]);
    if (dk < d) { d = dk; i = k; }
  }
  return { d, i };
}

/**
 * Where someone standing at p should step so a throw along `path` (60 Hz samples, flight and
 * roll) misses them by SAFE, or null if it already misses by CLEAR. Sideways off the path, the
 * nearer side first; failing that, farther out. Spots must be `free`.
 */
export function dodge(p: Vec2, path: Vec3[], free: (q: Vec2) => boolean): Vec2 | null {
  const { d, i } = closest(p, path);
  if (i < 0 || d >= CLEAR) return null;
  // Path direction there, and the side of it they're on.
  const a = path[Math.max(0, i - 3)], b = path[Math.min(path.length - 1, i + 3)];
  let tx = b[0] - a[0], ty = b[1] - a[1];
  const L = Math.hypot(tx, ty);
  if (L < 1e-6) { tx = 1; ty = 0; } else { tx /= L; ty /= L; }
  const nx = -ty, ny = tx;
  const side = (p[0] - path[i][0]) * nx + (p[1] - path[i][1]) * ny >= 0 ? 1 : -1;
  let best: Vec2 | null = null, bestD = -1;
  for (const extra of [0, 2, 4, 7]) {
    for (const s of [side, -side]) {
      const q: Vec2 = [path[i][0] + nx * s * (SAFE + extra), path[i][1] + ny * s * (SAFE + extra)];
      const dq = closest(q, path).d;
      if (!free(q)) continue;
      if (dq >= SAFE - 0.5) return q;
      if (dq > bestD) { bestD = dq; best = q; }
    }
  }
  return best;
}

/**
 * People closer than `min` pushed apart, half each, along the line between them (a few passes, so a
 * crowd settles). Who may move where is up to `canStand`: a push onto ground they can't stand on
 * isn't made.
 */
export function separate(at: Vec2[], min = BODY, canStand: (p: Vec2) => boolean = () => true): Vec2[] {
  const out = at.map((p): Vec2 => [p[0], p[1]]);
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      let dx = out[j][0] - out[i][0], dy = out[j][1] - out[i][1];
      let d = Math.hypot(dx, dy);
      if (d >= min) continue;
      if (d < 1e-6) { dx = Math.cos(i + j); dy = Math.sin(i + j); d = 1; } // on the same spot: any way
      const push = (min - d) / 2 + 1e-3;
      const a: Vec2 = [out[i][0] - (dx / d) * push, out[i][1] - (dy / d) * push];
      const b: Vec2 = [out[j][0] + (dx / d) * push, out[j][1] + (dy / d) * push];
      if (canStand(a)) out[i] = a;
      if (canStand(b)) out[j] = b;
      moved = true;
    }
    if (!moved) break;
  }
  return out;
}

/** The sample of a flight path (its low part) that comes nearest p, or -1 if it's all overhead. */
export function approachAt(p: Vec2, path: Vec3[]): number {
  return closest(p, path).i;
}

/** Spare time a spectator leaves themselves, s: they're clear this long before the disc arrives. */
const DODGE_SPARE_S = 0.6;

/**
 * Time to run? `samplesLeft` until the disc's nearest pass, flown at `samplesPerS` (60 times the
 * playback speed), and `runM` to their safe spot at `speed` m/s. Not before they must: a disc
 * still far off doesn't send anyone running.
 */
export function dodgeDue(samplesLeft: number, samplesPerS: number, runM: number, speed: number): boolean {
  return samplesLeft / samplesPerS <= runM / speed + DODGE_SPARE_S;
}

/** A straight path from a lie to the basket at head height, for clearing the line before a throw. */
export function lineOfPlay(from: Vec2, to: Vec2): Vec3[] {
  const n = Math.max(2, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1])));
  return Array.from({ length: n + 1 }, (_, k): Vec3 => [from[0] + ((to[0] - from[0]) * k) / n, from[1] + ((to[1] - from[1]) * k) / n, 1]);
}
