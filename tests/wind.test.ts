// Wind: aerodynamics use the disc's motion through the air (docs/10-disc-golf.md, Wind).
import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../src/course/geo';
import { DISCS } from '../src/disc/discs';
import { simulateThrow, windAt, type DiscWorld } from '../src/disc/flight';
import { TreeIndex } from '../src/disc/trees';
import { mulberry32 } from '../src/game/physics';
import { SurfaceGrid } from '../src/game/surfaces';
import { FlatTerrain } from '../src/game/terrain';

const grid = SurfaceGrid.fromHole({ bounds: [[-300, -300], [300, 300]], boundary: [[[[-250, -250], [250, -250], [250, 250], [-250, 250]]]], trees: [], features: [] }, 2);
const world = (wind?: Vec2): DiscWorld => ({ grid, terrain: new FlatTerrain(), trees: new TreeIndex([]), basket: [999, 999], wind });
const DD = DISCS.find((d) => d.id === 'DD')!;
const MR = DISCS.find((d) => d.id === 'MR')!;
// Throwing north (+y); for a right-hand backhand +x is right.
const fly = (disc = DD, wind?: Vec2, power = 1) => simulateThrow({ start: [0, 0], aim: Math.PI / 2, power, disc, hyzer: 0, perfect: true }, world(wind), mulberry32(1)).rest;

describe('wind', () => {
  it('a calm (zero) wind changes nothing', () => {
    expect(fly(DD, [0, 0])).toEqual(fly(DD));
  });

  it('is weaker near the ground: 40% at the bottom, full strength from 10 m', () => {
    expect(windAt([5, 0], 0)[0]).toBeCloseTo(2, 5);
    expect(windAt([5, 0], 10)[0]).toBeCloseTo(5, 5);
    expect(windAt([5, 0], 30)[0]).toBeCloseTo(5, 5);
    expect(windAt([5, 0], 3)[0]).toBeGreaterThan(2);
  });

  it('a crosswind drifts the disc downwind', () => {
    for (const disc of [DD, MR]) {
      const calm = fly(disc)[0];
      expect(fly(disc, [4, 0])[0]).toBeGreaterThan(calm + 2);
      expect(fly(disc, [-4, 0])[0]).toBeLessThan(calm - 2);
    }
  });

  it('a headwind turns a full-power driver over; a tailwind makes it fade and drop sooner', () => {
    const calm = fly();
    const head = fly(DD, [0, -5]);
    const tail = fly(DD, [0, 5]);
    expect(head[0]).toBeGreaterThan(calm[0] + 15); // turns right (RHBH)
    expect(tail[0]).toBeLessThan(calm[0] - 10); // fades left
    expect(tail[1]).toBeLessThan(calm[1]); // less airspeed, less lift
  });
});
