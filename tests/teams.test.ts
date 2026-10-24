// Best shot (src/modes/discRound.ts teamSize): volleys, the team's best throw, one stroke a volley.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeTrees, type DiscCourseFile } from '../src/course/disc-types';
import { dist, type Vec2 } from '../src/course/geo';
import { DISCS, PUTTER_DISC } from '../src/disc/discs';
import { simulateThrow, type DiscWorld } from '../src/disc/flight';
import { TreeIndex } from '../src/disc/trees';
import { mulberry32 } from '../src/game/physics';
import { SurfaceGrid } from '../src/game/surfaces';
import { FlatTerrain } from '../src/game/terrain';
import { DiscRound, bestThrow, type RoundEvent, type RoundOptions, type WireResult } from '../src/modes/discRound';

const course: DiscCourseFile = JSON.parse(readFileSync('public/courses/tali-simple.json', 'utf8'));
const trees = decodeTrees(course.trees);
const grid = SurfaceGrid.fromHole({ bounds: course.bounds, boundary: course.boundary, features: course.features, ob: course.ob, trees: [] }, 1);
const blocked = (q: Vec2) => { const c = grid.classAt(q[0], q[1]); return c === 'oob' || c === 'water'; };
const index = new TreeIndex(trees);

/** The current player throws at the basket, as the game does, through JSON. */
function throwTurn(r: DiscRound, seed: number): RoundEvent {
  const i = r.game.current, p = r.game.players[i], pin = r.game.pins[i];
  const w: DiscWorld = { grid, terrain: new FlatTerrain(), basket: pin, branchDensity: course.branch_density, wind: r.wind, trees: index };
  const d = dist(p.ball, pin);
  const res = simulateThrow({ start: p.ball, aim: Math.atan2(pin[1] - p.ball[1], pin[0] - p.ball[0]), power: Math.min(1, d / 90 + 0.15), disc: d < 20 ? PUTTER_DISC : DISCS[1], hyzer: 0, style: d < 20 ? 'putt' : 'drive' }, w, mulberry32(seed));
  const e: RoundEvent = { t: 'throw', player: i, perfect: false, result: r.wire(res) };
  r.apply(JSON.parse(JSON.stringify(e)));
  return e;
}

const wr = (rest: Vec2, extra: Partial<WireResult> = {}): WireResult => ({ samples: [], banks: [], rest, restSurface: 'fairway', holed: false, penalty: 0, events: [], treesHit: [], ...extra });

describe('best shot', () => {
  it('the best throw: holed, then fewer penalty strokes, then nearest; ties to the first', () => {
    const pin: Vec2 = [100, 0];
    expect(bestThrow([{ player: 0, result: wr([90, 0]) }, { player: 1, result: wr([95, 0]) }], pin)).toBe(1);
    expect(bestThrow([{ player: 0, result: wr([99, 0], { penalty: 1 }) }, { player: 1, result: wr([60, 0]) }], pin)).toBe(1);
    expect(bestThrow([{ player: 0, result: wr([99.9, 0]) }, { player: 1, result: wr([100, 0], { holed: true }) }], pin)).toBe(1);
    expect(bestThrow([{ player: 0, result: wr([90, 0]) }, { player: 1, result: wr([110, 0]) }], pin)).toBe(0);
  });

  it("2v2: a volley doesn't move anyone until the team has all thrown, then everyone plays the best", () => {
    const opts: RoundOptions = { names: ['A', 'B', 'C', 'D'], first: 0, count: 2, rogue: false, teams: [0, 0, 1, 1] };
    const r = new DiscRound(course.holes, trees, opts, blocked);
    expect(r.teams).toEqual([[0, 1], [2, 3]]);
    r.apply({ t: 'hole-start', wind: [0.5, -0.5] });
    const tee = r.game.players[0].ball;
    expect(r.game.current).toBe(0);
    throwTurn(r, 1);
    // A threw: still on the tee (a pending volley), and it's B's turn from the same spot.
    expect(r.game.players[0].ball).toEqual(tee);
    expect(r.game.players[0].strokes).toBe(0);
    expect(r.game.current).toBe(1);
    expect(r.volley.get(0)?.length).toBe(1);
    throwTurn(r, 2);
    // The volley's done: A and B both on the best throw, one stroke each; team 2 is away.
    const [a, b] = r.game.players;
    expect(a.ball).toEqual(b.ball);
    expect([a.strokes, b.strokes]).toEqual([1, 1]);
    expect(r.resolved?.team).toBe(0);
    expect(r.game.current).toBe(2);
    // Play the hole out: teammates always together, the team's strokes = its volleys.
    for (let k = 0; k < 80 && !r.game.finished; k++) throwTurn(r, 10 + k);
    expect(r.game.finished).toBe(true);
    for (const [x, y] of r.teams!) {
      expect(r.game.players[x].strokes).toBe(r.game.players[y].strokes);
      expect(r.game.players[x].ball).toEqual(r.game.players[y].ball);
      expect(r.round.scores[x][0]).toBe(r.round.scores[y][0]);
    }
    // Replaying the log (as a joining player does) gives the same round.
    const again = DiscRound.replay(course.holes, trees, opts, blocked, JSON.parse(JSON.stringify(r.log)));
    expect(again.game.players.map((p) => [p.ball, p.strokes])).toEqual(r.game.players.map((p) => [p.ball, p.strokes]));
  });

  it('3v3, uneven teams (1 v 2, 1 v 1 v 2, 2 v 3 not by seat), and no match when it isn\u2019t one; Crazy mode plays teams too', () => {
    const r = (names: number, teams: number[] | undefined, rogue = false) => new DiscRound(course.holes, trees, { names: ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, names), first: 0, count: 1, rogue, teams }, blocked).teams;
    expect(r(6, [0, 0, 0, 1, 1, 1])).toEqual([[0, 1, 2], [3, 4, 5]]);
    expect(r(3, [0, 1, 1])).toEqual([[0], [1, 2]]);
    expect(r(4, [0, 1, 2, 2])).toEqual([[0], [1], [2, 3]]);
    expect(r(5, [0, 1, 0, 1, 1])).toEqual([[0, 2], [1, 3, 4]]);
    expect(r(4, [0, 0, 0, 0])).toBeNull(); // one team
    expect(r(4, [0, 0, 1, 1], true)).toEqual([[0, 1], [2, 3]]); // Crazy mode too
  });

  it('1 v 2: the lone player plays every throw; the pair plays its best; non-adjacent teammates take turns', () => {
    const opts: RoundOptions = { names: ['A', 'B', 'C'], first: 0, count: 1, rogue: false, teams: [1, 0, 1] }; // B alone; A and C a pair
    const r = new DiscRound(course.holes, trees, opts, blocked);
    r.apply({ t: 'hole-start', wind: [0, 0] });
    expect(r.game.current).toBe(0); // A (tee order)
    throwTurn(r, 3);
    expect(r.game.current).toBe(2); // A's teammate C throws next, from the tee
    throwTurn(r, 4);
    expect(r.game.players[0].strokes).toBe(1);
    expect(r.game.players[2].ball).toEqual(r.game.players[0].ball);
    expect(r.game.current).toBe(1); // B, alone and away, is up
    throwTurn(r, 5);
    expect(r.game.players[1].strokes).toBe(1); // B's throw counts at once
    expect(r.volley.size).toBe(0);
  });
});
