// Player stats and rating, kept per name in this browser: every finished round (not Crazy mode,
// teams, the range or training) is recorded hole by hole, throw by throw.

/** One throw: how far from the basket it started and ended (m), and what happened. */
export interface ThrowRec {
  d: number;
  rest: number;
  holed: boolean;
  penalty: number;
  /** The first throw of the hole. */
  tee: boolean;
  /** The surface it came to rest on. */
  lie: string;
}
export interface HoleRec { par: number; strokes: number; throws: ThrowRec[] }
export interface RoundRec {
  /** ISO date. */
  at: string;
  course: string;
  holes: HoleRec[];
  rating: number;
}

const KEY = 'untitled-disc-game:stats';
type Store = Record<string, RoundRec[]>;
const load = (): Store => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Store; } catch { return {}; } };
const save = (s: Store) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ } };
/** Rounds kept per player. */
const KEEP = 60;

/** Circle 1 is 10 m, circle 2 is 20 m; "C1X" is circle 1 outside 3.3 m (tap-ins don't count). */
export const C1 = 10, C2 = 20, C1X_FROM = 3.3, PARKED = 3.3;
/** Rounds the rating averages, and the fewest holes a round needs to count. */
export const RATING_ROUNDS = 10, RATING_MIN_HOLES = 6;

/**
 * A round's rating, par-based: 1000 is playing to par, and each stroke is 10 points over 18 holes
 * (so 20 over 9). Not a PDGA rating: there's no scratch scoring average behind it, only par.
 */
export function roundRating(holes: HoleRec[]): number {
  const toPar = holes.reduce((a, h) => a + h.strokes - h.par, 0);
  return Math.round(1000 - (10 * toPar * 18) / Math.max(1, holes.length));
}

/** The player's rating: the average of their last RATING_ROUNDS rounds of RATING_MIN_HOLES holes or more. */
export function playerRating(rounds: RoundRec[]): number | null {
  const r = rounds.filter((x) => x.holes.length >= RATING_MIN_HOLES).slice(-RATING_ROUNDS);
  return r.length ? Math.round(r.reduce((a, x) => a + x.rating, 0) / r.length) : null;
}

/** made / tries pairs and averages over a set of rounds. */
export interface Summary {
  rounds: number;
  holes: number;
  /** Strokes to par per 18 holes. */
  toPar18: number;
  c1x: [number, number];
  c2: [number, number];
  /** Tee shots that land in the clear (not the trees, OB or water). */
  fairway: [number, number];
  /** Tee shots that end within PARKED m (or in). */
  parked: [number, number];
  /** Inside circle 1 (or in) with two strokes to spare for par. */
  c1r: [number, number];
  /** Par or better after missing circle 1 in regulation. */
  scramble: [number, number];
  /** Throws that went OB or in the water. */
  ob: [number, number];
  birdies: number;
}

export function summarize(rounds: RoundRec[]): Summary {
  const s: Summary = { rounds: rounds.length, holes: 0, toPar18: 0, c1x: [0, 0], c2: [0, 0], fairway: [0, 0], parked: [0, 0], c1r: [0, 0], scramble: [0, 0], ob: [0, 0], birdies: 0 };
  let toPar = 0;
  const add = (p: [number, number], hit: boolean) => { p[1]++; if (hit) p[0]++; };
  for (const r of rounds) {
    for (const h of r.holes) {
      s.holes++;
      toPar += h.strokes - h.par;
      if (h.strokes < h.par) s.birdies++;
      // Throws taken before each throw: penalties count as strokes.
      let taken = 0, inReg = false;
      for (const t of h.throws) {
        if (t.d > C1X_FROM && t.d <= C1) add(s.c1x, t.holed);
        else if (t.d > C1 && t.d <= C2) add(s.c2, t.holed);
        if (t.tee && !t.holed) add(s.fairway, t.penalty === 0 && t.lie !== 'trees');
        if (t.tee) add(s.parked, t.holed || (t.penalty === 0 && t.rest <= PARKED));
        add(s.ob, t.penalty > 0);
        taken += 1 + t.penalty;
        if (taken <= h.par - 2 && (t.holed || (t.penalty === 0 && t.rest <= C1))) inReg = true;
      }
      add(s.c1r, inReg);
      if (!inReg) add(s.scramble, h.strokes <= h.par);
    }
  }
  s.toPar18 = s.holes ? (toPar * 18) / s.holes : 0;
  return s;
}

export function roundsOf(name: string): RoundRec[] {
  return load()[name] ?? [];
}

export function statNames(): string[] {
  const s = load();
  return Object.keys(s).filter((n) => s[n].length > 0);
}

/** Record a finished round for a player; their rating before and after. */
export function recordRound(name: string, course: string, holes: HoleRec[], at = new Date()): { before: number | null; after: number | null; round: RoundRec } {
  const s = load();
  const list = s[name] ?? [];
  const before = playerRating(list);
  const round: RoundRec = { at: at.toISOString(), course, holes, rating: roundRating(holes) };
  // The same round again (its final card shown again after rejoining): already counted.
  const last = list.at(-1);
  if (last && last.course === course && JSON.stringify(last.holes) === JSON.stringify(holes)) return { before: playerRating(list.slice(0, -1)), after: before, round: last };
  s[name] = [...list, round].slice(-KEEP);
  save(s);
  return { before, after: playerRating(s[name]), round };
}

export function clearStats(name: string): void {
  const s = load();
  delete s[name];
  save(s);
}
