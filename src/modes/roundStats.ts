// End-of-round highlights from the round's event log (src/modes/discRound.ts): the longest throw,
// the longest make, who hit the most trees; and each player's holes for their stats. Mulligans take
// their throw back out.
import type { Vec2 } from '../course/geo';
import type { HoleRec, ThrowRec } from '../game/playerStats';
import type { RoundEvent } from './discRound';

/** One kept throw: who, on which hole (course index), where in the log, and how far it went. */
export interface ShotRef {
  player: number;
  hole: number;
  /** Index of the throw event in the log (to replay it). */
  at: number;
  /** Start to rest, horizontally (m). */
  dist: number;
}

export interface PlayerStats {
  throws: number;
  longest: number;
  trees: number;
  aces: number;
  /** Out-of-bounds and water penalties. */
  penalties: number;
}

export interface RoundStats {
  longest: ShotRef | null;
  /** The longest throw that went in. */
  bestMake: ShotRef | null;
  players: PlayerStats[];
  shots: ShotRef[];
}

type Throw = Extract<RoundEvent, { t: 'throw' }>;

export function roundStats(log: RoundEvent[], players: number, first: number): RoundStats {
  const kept: (ShotRef & { e: Throw; n: number })[] = [];
  let hole = first - 1;
  // Throws so far this hole, per player (an ace is a make on the first one).
  let count = Array(players).fill(0);
  log.forEach((e, at) => {
    if (e.t === 'hole-start') { hole++; count = Array(players).fill(0); return; }
    if (e.t === 'mulligan') {
      for (let i = kept.length - 1; i >= 0; i--) {
        if (kept[i].player === e.player && kept[i].hole === hole) { kept.splice(i, 1); count[e.player]--; break; }
      }
      return;
    }
    if (e.t !== 'throw' || e.player >= players) return;
    const s = e.result.samples[0], r = e.result.rest;
    const dist = s ? Math.hypot(r[0] - s[0], r[1] - s[1]) : 0;
    kept.push({ player: e.player, hole, at, dist, e, n: ++count[e.player] });
  });
  const stats: PlayerStats[] = Array.from({ length: players }, () => ({ throws: 0, longest: 0, trees: 0, aces: 0, penalties: 0 }));
  let longest: ShotRef | null = null, bestMake: ShotRef | null = null;
  for (const k of kept) {
    const p = stats[k.player], r = k.e.result;
    p.throws++;
    p.trees += r.treesHit.length;
    if (r.penalty > 0) p.penalties++;
    if (r.holed && k.n === 1) p.aces++;
    // A throw that went out isn't a long throw: it's where it was dropped.
    if (r.penalty === 0) {
      p.longest = Math.max(p.longest, k.dist);
      if (!longest || k.dist > longest.dist) longest = k;
    }
    if (r.holed && (!bestMake || k.dist > bestMake.dist)) bestMake = k;
  }
  const ref = (k: ShotRef | null): ShotRef | null => (k ? { player: k.player, hole: k.hole, at: k.at, dist: k.dist } : null);
  return { longest: ref(longest), bestMake: ref(bestMake), players: stats, shots: kept.map(ref) as ShotRef[] };
}

/**
 * Each player's round, hole by hole and throw by throw, for their stats (src/game/playerStats.ts).
 * `holes`: the course's holes (their pins and pars); `scores[p][hole]` the round's own strokes.
 */
export function holeRecords(log: RoundEvent[], holes: { pin: Vec2; par: number }[], players: number, first: number, scores: (number | undefined)[][]): HoleRec[][] {
  const out: HoleRec[][] = Array.from({ length: players }, () => []);
  let hole = first - 1;
  let cur: ThrowRec[][] = [];
  const close = () => {
    if (hole < first) return;
    for (let p = 0; p < players; p++) {
      const strokes = scores[p]?.[hole];
      if (strokes !== undefined) out[p].push({ par: holes[hole].par, strokes, throws: cur[p] });
    }
  };
  for (const e of log) {
    if (e.t === 'hole-start') { close(); hole++; cur = Array.from({ length: players }, () => []); continue; }
    if (e.t === 'mulligan') { cur[e.player]?.pop(); continue; }
    if (e.t !== 'throw' || e.player >= players || hole < first) continue;
    const pin = holes[hole].pin, r = e.result, s = r.samples[0];
    const off = (q: ArrayLike<number>) => Math.hypot(q[0] - pin[0], q[1] - pin[1]);
    cur[e.player].push({ d: s ? off(s) : 0, rest: r.holed ? 0 : off(r.rest), holed: r.holed, penalty: r.penalty, tee: cur[e.player].length === 0, lie: r.restSurface });
  }
  close();
  return out;
}
