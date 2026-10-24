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
    const opts: RoundOptions = { names: ['A', 'B', 'C', 'D'], first: 0, count: 2, rogue: false, teamSize: 2 };
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

  it("3v3 makes two teams of three; teams that don't fit (or Crazy mode) play alone", () => {
    const six = ['A', 'B', 'C', 'D', 'E', 'F'];
    expect(new DiscRound(course.holes, trees, { names: six, first: 0, count: 1, rogue: false, teamSize: 3 }, blocked).teams).toEqual([[0, 1, 2], [3, 4, 5]]);
    expect(new DiscRound(course.holes, trees, { names: six, first: 0, count: 1, rogue: false, teamSize: 2 }, blocked).teams?.length).toBe(3);
    expect(new DiscRound(course.holes, trees, { names: six.slice(0, 5), first: 0, count: 1, rogue: false, teamSize: 2 }, blocked).teams).toBeNull();
    expect(new DiscRound(course.holes, trees, { names: six.slice(0, 4), first: 0, count: 1, rogue: true, teamSize: 2 }, blocked).teams).toBeNull();
    expect(new DiscRound(course.holes, trees, { names: six.slice(0, 3), first: 0, count: 1, rogue: false, teamSize: 3 }, blocked).teams).toBeNull(); // one team isn't a match
  });
});
