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
  color: string;
}

export const DISCS: Disc[] = [
  { id: 'DD', name: 'Distance driver', speed: 12, glide: 5, turn: -1, fade: 3, v0: 27, color: '#e8452c' },
  { id: 'FD', name: 'Fairway driver', speed: 7, glide: 5, turn: -1, fade: 2, v0: 22.5, color: '#f2a03d' },
  { id: 'MR', name: 'Midrange', speed: 5, glide: 5, turn: 0, fade: 1, v0: 20.5, color: '#3fa7f2' },
  { id: 'PT', name: 'Putter', speed: 2, glide: 3, turn: 0, fade: 1, v0: 20, color: '#f4f4f4' },
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
