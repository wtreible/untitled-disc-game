// Shot analysis: what a throw did, read off its flight samples (60 a second, src/disc/flight.ts).
import type { Vec2 } from '../course/geo';
import type { Vec3 } from './terrain';

export interface ShotShape {
  /** Start to rest, horizontally (m). */
  total: number;
  /** Start to where it first came down (m). */
  carry: number;
  /** Highest it got above the ground it was thrown from (m). */
  peak: number;
  /** Release speed (m/s). */
  speed: number;
  /** Furthest right and left of its starting line (m), and which way it went first. */
  right: number;
  left: number;
  firstRight: boolean;
  /** Where it finished, left (+) or right (−) of the starting line (m). */
  final: number;
}

const HZ = 60;

export function shotShape(samples: Vec3[], rest: Vec2, ground: (x: number, y: number) => number): ShotShape {
  const s0 = samples[0];
  const g0 = ground(s0[0], s0[1]);
  // The starting line: where it was headed over its first tenth of a second.
  const a = samples[Math.min(6, samples.length - 1)];
  const hl = Math.hypot(a[0] - s0[0], a[1] - s0[1]) || 1;
  const h: Vec2 = [(a[0] - s0[0]) / hl, (a[1] - s0[1]) / hl];
  const side = (x: number, y: number) => h[0] * (y - s0[1]) - h[1] * (x - s0[0]); // left of the line: +
  let peak = 0, right = 0, left = 0, iRight = -1, iLeft = -1, landed = -1;
  samples.forEach((s, k) => {
    peak = Math.max(peak, s[2] - g0);
    const d = side(s[0], s[1]);
    if (-d > right) { right = -d; iRight = k; }
    if (d > left) { left = d; iLeft = k; }
    if (landed < 0 && k > 0 && s[2] - ground(s[0], s[1]) <= 0.05) landed = k;
  });
  const end = landed < 0 ? rest : [samples[landed][0], samples[landed][1]];
  const s1 = samples[1] ?? s0;
  return {
    total: Math.hypot(rest[0] - s0[0], rest[1] - s0[1]),
    carry: Math.hypot(end[0] - s0[0], end[1] - s0[1]),
    peak,
    speed: Math.hypot(s1[0] - s0[0], s1[1] - s0[1], s1[2] - s0[2]) * HZ,
    right, left, firstRight: iRight >= 0 && (iLeft < 0 || iRight < iLeft),
    final: side(rest[0], rest[1]),
  };
}

/** "9 ft right, then 14 ft left" (only the moves of a meter or more), or "dead straight". */
export function shapeText(s: ShotShape, len: (m: number) => string): string {
  const r = s.right >= 1 ? `${len(s.right)} right` : '', l = s.left >= 1 ? `${len(s.left)} left` : '';
  const moves = (s.firstRight ? [r, l] : [l, r]).filter(Boolean);
  return moves.length ? moves.join(', then ') : 'dead straight';
}
