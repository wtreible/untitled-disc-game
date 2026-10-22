import { describe, expect, it } from 'vitest';
import { decodeTrees } from '../src/course/disc-types';
import { DEFAULT_BASKETS, FT, LANE_HALF, RANGE_MARKS, isMajor, rangeCourse, rangeTree } from '../src/course/range';
import { PUTTER_DISC } from '../src/disc/discs';
import { simulateThrow } from '../src/disc/flight';
import { TreeIndex } from '../src/disc/trees';
import { mulberry32 } from '../src/game/physics';
import { SurfaceGrid } from '../src/game/surfaces';
import { FlatTerrain } from '../src/game/terrain';

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
});
