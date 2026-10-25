// Round formats: how a round is won. Stroke play (fewest throws) is the base game; skins, match
// play and Bounty score the same holes differently. Sides are the leaderboard's rows: players, or
// teams in team play. Team play itself is best shot (everyone throws, the team plays the best) or
// alternate shot (teammates take turns with one disc).
import type { Mods } from '../disc/mods';

export type Format = 'stroke' | 'skins' | 'match' | 'bounty';
export type TeamPlay = 'best' | 'alternate';

export const FORMATS: [Format, string, string][] = [
  ['stroke', 'Stroke', 'Fewest throws over the round'],
  ['skins', 'Skins', 'Each hole is worth a skin to whoever wins it outright; ties carry it to the next hole'],
  ['match', 'Match', 'Two sides, hole by hole: win more holes than the other side'],
  ['bounty', 'Bounty', 'Stroke play, but whoever leads plays the next hole with a handicap'],
];

/** A side's strokes on each hole (course hole index), undefined where it hasn't finished it. */
export type Card = (number | undefined)[];

export interface Skins {
  /** Skins each side has won. */
  won: number[];
  /** Each finished hole: who took the pot (null: tied, carried), and what it was worth. */
  holes: { hole: number; winner: number | null; worth: number }[];
  /** Skins riding on the next hole. */
  carry: number;
}

/** Skins over the holes played (in order): the lowest score alone takes the pot; a tie carries it. */
export function skinsOf(cards: Card[], holes: number[]): Skins {
  const won = cards.map(() => 0);
  const out: Skins['holes'] = [];
  let pot = 0;
  for (const h of holes) {
    const s = cards.map((c) => c[h]);
    if (s.some((x) => x === undefined)) break; // not everyone's finished it
    pot++;
    const best = Math.min(...(s as number[]));
    const at = s.flatMap((x, i) => (x === best ? [i] : []));
    if (at.length === 1) { won[at[0]] += pot; out.push({ hole: h, winner: at[0], worth: pot }); pot = 0; } else out.push({ hole: h, winner: null, worth: pot });
  }
  return { won, holes: out, carry: pot };
}

export interface Match {
  /** Holes side 0 is up on side 1 (negative: down). */
  up: number;
  /** Holes still to play. */
  left: number;
  /** One side can't be caught. */
  decided: boolean;
  /** Who won each finished hole: 0, 1, or null (halved). */
  holes: (0 | 1 | null)[];
}

/** Match play between two sides over `holes` (in order). */
export function matchOf(a: Card, b: Card, holes: number[]): Match {
  let up = 0, left = holes.length;
  const won: Match['holes'] = [];
  for (const h of holes) {
    if (a[h] === undefined || b[h] === undefined) break;
    left--;
    const w = a[h]! < b[h]! ? 0 : a[h]! > b[h]! ? 1 : null;
    won.push(w);
    up += w === 0 ? 1 : w === 1 ? -1 : 0;
  }
  return { up, left, decided: Math.abs(up) > left, holes: won };
}

/** "2 UP", "All square", "Won 3 & 2" from side 0's point of view (`names`: both sides). */
export function matchText(m: Match, names: [string, string]): string {
  if (m.up === 0) return m.left ? 'All square' : 'Halved';
  const who = names[m.up > 0 ? 0 : 1], n = Math.abs(m.up);
  if (m.decided && m.left > 0) return `${who} wins ${n} & ${m.left}`;
  if (m.left === 0) return `${who} wins ${n} up`;
  return `${who} ${n} up`;
}

/** Bounty: the handicaps a leader can be given for the next hole. */
export type BountyHex = 'shaky' | 'heavy' | 'headwind' | 'tight';
export const BOUNTY: Record<BountyHex, { name: string; text: string; apply: (m: Mods) => void }> = {
  shaky: { name: 'Shaky hands', text: '35% more wobble', apply: (m) => { m.aimError *= 1.35; m.puttAimError *= 1.35; } },
  heavy: { name: 'Heavy arm', text: '10% less distance', apply: (m) => { m.distance *= 0.9; } },
  headwind: { name: 'In the wind', text: 'the wind moves your disc 60% more', apply: (m) => { m.windScale *= 1.6; } },
  tight: { name: 'Small basket', text: 'the basket is 15% smaller', apply: (m) => { m.basketScale *= 0.85; } },
};
export const BOUNTY_HEXES = Object.keys(BOUNTY) as BountyHex[];

/** Bounty: the side leading outright (lowest score to par), or null when the lead is shared. */
export function bountyLeader(toPar: number[]): number | null {
  const best = Math.min(...toPar);
  const at = toPar.flatMap((x, i) => (x === best ? [i] : []));
  return at.length === 1 ? at[0] : null;
}
