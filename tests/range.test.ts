import { describe, expect, it } from 'vitest';
import { decodeTrees } from '../src/course/disc-types';
import { DEFAULT_BASKETS, FT, LANE_HALF, RANGE_MARKS, isMajor, rangeCourse, rangeTree, rangeWind, type RangeConditions } from '../src/course/range';
import { PUTTER_DISC } from '../src/disc/discs';
import { simulateThrow } from '../src/disc/flight';
import { TreeIndex } from '../src/disc/trees';
import { mulberry32 } from '../src/game/physics';
import { SurfaceGrid } from '../src/game/surfaces';
import { FlatTerrain } from '../src/game/terrain';
import { DiscRound, type RoundEvent } from '../src/modes/discRound';

describe('driving range', () => {
  const c = rangeCourse();
  const grid = SurfaceGrid.fromHole({ bounds: c.bounds, boundary: c.boundary, features: c.features, ob: c.ob, trees: [] }, 0.5);

  it('has distance lines every 50 ft out to 800 ft, the 100s wider', () => {
    expect(RANGE_MARKS[0]).toBe(50);
    expect(RANGE_MARKS.at(-1)).toBe(800);
    expect(RANGE_MARKS.filter(isMajor)).toEqual([100, 200, 300, 400, 500, 600, 700, 800]);
    const [minor, major] = c.decals!;
    expect(minor.rings).toHaveLength(8);
    expect(major.rings).toHaveLength(8);
    const width = (r: number[][][]) => Math.max(...r[0].map((p) => p[0])) - Math.min(...r[0].map((p) => p[0]));
    expect(width(major.rings[0] as number[][][])).toBeGreaterThan(width(minor.rings[0] as number[][][]));
    const y100 = (major.rings[0][0] as number[][]).reduce((a, p) => a + p[1], 0) / 4;
    expect(y100).toBeCloseTo(100 * FT, 5);
  });

  it('is open in bounds well past the last line, with no trees of its own', () => {
    expect(decodeTrees(c.trees)).toHaveLength(0);
    expect(grid.classAt(0, 0)).toBe('tee');
    expect(grid.classAt(0, 800 * FT)).toBe('fairway');
    expect(grid.classAt(LANE_HALF + 30, 400 * FT)).toBe('rough');
    expect(grid.classAt(0, 800 * FT + 40)).not.toBe('oob');
  });

  it('a putt can go into any of the baskets, not just the first', () => {
    const near: [number, number] = [0, 6];
    let made = 0;
    for (let s = 1; s <= 20; s++) {
      const r = simulateThrow(
        { start: [0, 0], aim: Math.PI / 2, power: 0.55, disc: PUTTER_DISC, hyzer: 0, style: 'putt', launch: 0.12 },
        { grid, terrain: new FlatTerrain(), trees: new TreeIndex([]), basket: DEFAULT_BASKETS[2], extraBaskets: [near] },
        mulberry32(s),
      );
      if (r.holed) { made++; expect(r.rest).toEqual(near); }
    }
    expect(made).toBeGreaterThan(5);
  });

  it('range trees vary but stay a sensible size', () => {
    const rnd = mulberry32(3);
    for (let i = 0; i < 50; i++) {
      const t = rangeTree([0, 50], rnd);
      expect(t.h).toBeGreaterThanOrEqual(7);
      expect(t.h).toBeLessThanOrEqual(13);
      expect(t.b).toBeLessThan(t.h);
    }
  });

  it('wind directions: from the left blows right, a headwind blows back at the tee', () => {
    const [x, y] = rangeWind({ windSpeed: 4, windFrom: 270 });
    expect(x).toBeCloseTo(4, 6); expect(y).toBeCloseTo(0, 6);
    expect(rangeWind({ windSpeed: 4, windFrom: 0 })[1]).toBeCloseTo(-4, 6);
    expect(rangeWind({ windSpeed: 4, windFrom: 180 })[1]).toBeCloseTo(4, 6);
  });

  it('as a round: everyone throws from the tee in turn, and the range event sets baskets and wind', () => {
    const setup: RangeConditions = { baskets: [[0, 40], [5, 80]], trees: [rangeTree([3, 30], mulberry32(1))], windSpeed: 3, windFrom: 90, weather: 'rain' };
    const r = new DiscRound(c.holes, [], { names: ['A', 'B', 'C'], first: 0, count: 1, rogue: false, range: true }, () => false);
    const log: RoundEvent[] = [{ t: 'range', setup }, { t: 'hole-start', wind: rangeWind(setup) }];
    const shot = (player: number, rest: [number, number]): RoundEvent => ({
      t: 'throw', player, perfect: false, disc: 'FD',
      result: { samples: [[0, 0, 1], [rest[0], rest[1], 0]], banks: [0, 0], rest, restSurface: 'fairway', holed: false, penalty: 0, events: [], treesHit: [] },
    });
    log.push(shot(0, [2, 60]), shot(1, [-4, 75]), shot(2, [0, 50]), shot(0, [1, 66]));
    for (const e of log) r.apply(JSON.parse(JSON.stringify(e)));
    expect(r.stage).toBe('playing');
    expect(r.game.current).toBe(1); // A, B, C, A: B is up
    expect(r.rangeThrows).toBe(4);
    for (const p of r.game.players) { expect(p.ball).toEqual(c.holes[0].tee); expect(p.strokes).toBe(0); }
    expect(r.range!.baskets).toEqual(setup.baskets);
    expect(r.wind[0]).toBeCloseTo(-3, 6); // from the right: blows left
    // The thrower changes the wind mid-round.
    r.apply({ t: 'range', setup: { ...setup, windSpeed: 0 } });
    expect(Math.hypot(...r.wind)).toBe(0);
  });

  it('range events do nothing in a normal round', () => {
    const r = new DiscRound(c.holes, [], { names: ['A'], first: 0, count: 1, rogue: false }, () => false);
    r.apply({ t: 'range', setup: { baskets: [], trees: [], windSpeed: 9, windFrom: 0, weather: 'clear' } });
    expect(r.range).toBeNull();
  });
});
