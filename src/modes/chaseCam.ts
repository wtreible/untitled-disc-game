// The chase camera's steering, behind a disc in flight: used for replays and for riding along with
// a friend's throw. It follows the disc's direction of travel, eased so bounces and tree kicks
// don't whip it around.
import type { Vec3 } from '../game/terrain';
import { sampleAt } from './discKit';

export interface Chase {
  /** Direction of travel, and the camera's eased heading. */
  heading: number;
  smooth: number;
  /** False until the first frame (which cuts to the disc instead of easing). */
  started: boolean;
  /** performance.now() of the last frame. */
  last: number;
}

/** Start behind the disc, looking along its first few meters (the thrower's aim). */
export function newChase(s: Vec3[]): Chase {
  const k = Math.min(8, s.length - 1);
  const h0 = Math.atan2(s[k][1] - s[0][1], s[k][0] - s[0][0]);
  return { heading: h0, smooth: h0, started: false, last: performance.now() };
}

/** Direction of travel at sample k. */
export function headingAt(s: Vec3[], k: number): number {
  const a = s[Math.max(0, k - 1)], b = s[Math.min(s.length - 1, k + 1)];
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

/**
 * One frame of the chase at fractional sample t: where the disc is, its sample index, and the frame
 * time. Updates the camera's heading.
 */
export function stepChase(c: Chase, s: Vec3[], t: number, now: number): { pos: Vec3; kk: number; dt: number } {
  const kk = Math.min(Math.floor(t), s.length - 1);
  // Interpolate between samples: at 1.25× the frame advances 1 or 2 samples unevenly, which shook.
  const pos = sampleAt(s, t);
  const a = s[Math.max(0, kk - 2)], b = s[Math.min(s.length - 1, kk + 2)];
  // Keep the last real direction of travel once the disc stops (atan2(0, 0) would swing to east).
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.02) c.heading = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const dt = Math.min(0.1, (now - c.last) / 1000);
  c.last = now;
  const dh = Math.atan2(Math.sin(c.heading - c.smooth), Math.cos(c.heading - c.smooth));
  c.smooth += dh * (c.started ? 1 - Math.exp(-dt * 5) : 1);
  return { pos, kk, dt };
}
