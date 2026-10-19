// Tunable club table, docs/05-gameplay.md.
export const YD = 0.9144;

export interface Club {
  id: string;
  name: string;
  /** Full-power carry, meters. 0 for the putter (ground only). */
  carry: number;
  /** Full-power apex height, meters. */
  apex: number;
  /** Roll distance as a fraction of carry on a roll-factor-1 surface. */
  roll: number;
  /** 1-sigma direction error, degrees, from a perfect lie. */
  dispersionDeg: number;
}

const c = (id: string, name: string, carryYd: number, apex: number, roll: number, dispersionDeg: number): Club =>
  ({ id, name, carry: carryYd * YD, apex, roll, dispersionDeg });

export const CLUBS: Club[] = [
  c('D', 'Driver', 230, 30, 0.12, 3.5),
  c('3W', '3-wood', 210, 28, 0.1, 3.2),
  c('5W', '5-wood', 195, 27, 0.08, 3.0),
  c('4i', '4-iron', 180, 26, 0.07, 2.8),
  c('5i', '5-iron', 170, 26, 0.06, 2.6),
  c('6i', '6-iron', 160, 27, 0.05, 2.4),
  c('7i', '7-iron', 150, 28, 0.045, 2.2),
  c('8i', '8-iron', 140, 29, 0.04, 2.0),
  c('9i', '9-iron', 130, 30, 0.035, 1.9),
  c('PW', 'Pitching wedge', 115, 30, 0.03, 1.8),
  c('SW', 'Sand wedge', 90, 28, 0.02, 1.8),
  c('P', 'Putter', 0, 0, 0, 0.6),
];

export const PUTTER = CLUBS[CLUBS.length - 1];
/** Distance a full-power putt rolls on the green, meters. */
export const PUTT_MAX_M = 30;

/** Smallest club that reaches `distM` at full power (or the longest club), never the putter. */
export function suggestClub(distM: number, allowDriver: boolean): Club {
  const full = CLUBS.filter((k) => k.carry > 0 && (allowDriver || k.id !== 'D'));
  let best = full[0];
  for (const k of full) if (k.carry >= distM * 0.95) best = k;
  return best;
}
