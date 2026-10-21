// Disc bag. Flight numbers are the standard four (speed, glide, turn, fade); `maxDist` is a
// typical amateur's full-power flat throw. Tunable, docs/08-level-editor-and-disc-golf.md.
export interface Disc {
  id: string;
  name: string;
  /** One word for the disc picker. */
  short: string;
  /** Offered as a suggestion for the distance at hand (the everyday four, not the specialty discs). */
  suggest?: boolean;
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
  { id: 'DD', name: 'Distance driver', short: 'Driver', suggest: true, speed: 12, glide: 5, turn: -1, fade: 3, v0: 23.6, launch: 0.09, curve: [0.018, 0.047, 0.077, 0.13, 0.235, 0.419, 0.671, 0.873, 1], color: '#e8452c' },
  // Specialty discs (2026-10-21), fitted with scripts/calibrate-disc.ts.
  { id: 'OD', name: 'Overstable driver', short: 'Overstable', speed: 11, glide: 4, turn: 0, fade: 4, v0: 23.1, launch: 0.09, curve: [0.021, 0.053, 0.085, 0.133, 0.216, 0.366, 0.589, 0.816, 1], color: '#8a5cff' },
  { id: 'FD', name: 'Fairway driver', short: 'Fairway', suggest: true, speed: 7, glide: 5, turn: -1, fade: 2, v0: 21.6, launch: 0.09, curve: [0.02, 0.05, 0.079, 0.125, 0.204, 0.344, 0.547, 0.791, 1], color: '#f2a03d' },
  { id: 'TF', name: 'Turnover fairway', short: 'Turnover', speed: 7, glide: 5, turn: -1, fade: 1, v0: 20.8, launch: 0.09, curve: [0.02, 0.05, 0.079, 0.122, 0.195, 0.331, 0.546, 0.789, 1], color: '#2fd28a' },
  { id: 'MR', name: 'Midrange', short: 'Midrange', suggest: true, speed: 5, glide: 5, turn: 0, fade: 1, v0: 20.1, launch: 0.1, curve: [0.023, 0.056, 0.089, 0.137, 0.213, 0.348, 0.55, 0.782, 1], color: '#3fa7f2' },
  { id: 'AP', name: 'Approach', short: 'Approach', speed: 4, glide: 3, turn: 0, fade: 3, v0: 18.5, launch: 0.11, curve: [0.028, 0.068, 0.105, 0.154, 0.225, 0.335, 0.513, 0.749, 1], color: '#ffd23f' },
  { id: 'PT', name: 'Putter', short: 'Putter', suggest: true, speed: 2, glide: 3, turn: 0, fade: 1, v0: 19.6, launch: 0.13, curve: [0.028, 0.069, 0.109, 0.166, 0.253, 0.39, 0.58, 0.793, 1], color: '#f4f4f4' },
];

export const PUTTER_DISC = DISCS.find((d) => d.id === 'PT')!;
export const DISC_RADIUS = 0.105;

/** Shortest disc expected to reach `d` meters (or the longest). Expected range is calibrated in tests. */
/** The shortest everyday disc expected to reach `d` meters (or the longest). Specialty discs are picked by hand. */
export function suggestDisc(d: number, ranges: Record<string, number>): Disc {
  if (d < 20) return PUTTER_DISC;
  const core = DISCS.filter((k) => k.suggest).sort((a, b) => ranges[b.id] - ranges[a.id]);
  let best = core[0];
  for (const k of core) if (ranges[k.id] >= d * 1.05) best = k;
  return best;
}
