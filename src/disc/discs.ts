// Disc bag. Flight numbers are the standard four (speed, glide, turn, fade); `maxDist` is a
// typical amateur's full-power flat throw. Tunable, docs/08-level-editor-and-disc-golf.md.
export interface Disc {
  id: string;
  name: string;
  speed: number;
  glide: number;
  /** Negative = drifts right early in flight (right-hand backhand). */
  turn: number;
  /** Positive = hooks left at the end (RHBH). */
  fade: number;
  /** Full-power release speed, m/s. */
  v0: number;
  /**
   * Default launch angle, rad. Near each disc's best; for the distance driver a little above it
   * (pure max distance wants a 0.02 rad line drive that lands before it can fade).
   */
  launch: number;
  /**
   * Measured distance fraction at release-speed fractions [0.15, 0.3, 0.4 … 1] (flat throw at the
   * disc's best launch). The power meter inverts it so meter fill ≈ fraction of max distance.
   */
  curve: number[];
  color: string;
}

export const DISCS: Disc[] = [
  { id: 'DD', name: 'Distance driver', speed: 12, glide: 5, turn: -1, fade: 3, v0: 23.6, launch: 0.09, curve: [0.018, 0.047, 0.077, 0.13, 0.235, 0.419, 0.671, 0.873, 1], color: '#e8452c' },
  { id: 'FD', name: 'Fairway driver', speed: 7, glide: 5, turn: -1, fade: 2, v0: 21.6, launch: 0.09, curve: [0.02, 0.05, 0.079, 0.125, 0.204, 0.344, 0.547, 0.791, 1], color: '#f2a03d' },
  { id: 'MR', name: 'Midrange', speed: 5, glide: 5, turn: 0, fade: 1, v0: 20.1, launch: 0.1, curve: [0.023, 0.056, 0.089, 0.137, 0.213, 0.348, 0.55, 0.782, 1], color: '#3fa7f2' },
  { id: 'PT', name: 'Putter', speed: 2, glide: 3, turn: 0, fade: 1, v0: 19.6, launch: 0.13, curve: [0.028, 0.069, 0.109, 0.166, 0.253, 0.39, 0.58, 0.793, 1], color: '#f4f4f4' },
];

export const PUTTER_DISC = DISCS[DISCS.length - 1];
export const DISC_RADIUS = 0.105;

/** Shortest disc expected to reach `d` meters (or the longest). Expected range is calibrated in tests. */
export function suggestDisc(d: number, ranges: Record<string, number>): Disc {
  if (d < 20) return PUTTER_DISC;
  let best = DISCS[0];
  for (const k of DISCS) if (ranges[k.id] >= d * 1.05) best = k;
  return best;
}
