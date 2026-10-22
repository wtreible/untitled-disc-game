// Sound cues read back off simulated throws (src/audio/cues.ts).
import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../src/course/geo';
import type { Tree } from '../src/course/disc-types';
import type { Rings } from '../src/course/types';
import { throwCues } from '../src/audio/cues';
import { DISCS, PUTTER_DISC } from '../src/disc/discs';
import { simulateThrow, type DiscWorld } from '../src/disc/flight';
import { TreeIndex } from '../src/disc/trees';
import { mulberry32 } from '../src/game/physics';
import { SurfaceGrid } from '../src/game/surfaces';
import { FlatTerrain } from '../src/game/terrain';

const NORTH = Math.PI / 2;
const DD = DISCS.find((d) => d.id === 'DD')!;
const sq = (n: number): Rings => [[[-n, -n], [n, -n], [n, n], [-n, n]]];
function world(trees: Tree[] = [], basket: Vec2 = [999, 999], water: Rings[] = []): DiscWorld {
  const grid = SurfaceGrid.fromHole({
    bounds: [[-200, -200], [200, 200]], boundary: [sq(150)], trees: [],
    features: water.map((rings, i) => ({ class: 'water' as const, osm_id: `w${i}`, rings })),
  }, 0.5);
  return { grid, terrain: new FlatTerrain(), trees: new TreeIndex(trees), basket };
}
const cuesOf = (w: DiscWorld, r: ReturnType<typeof simulateThrow>) => throwCues(r, w.basket, (x, y) => w.grid.classAt(x, y)).map((c) => c.sound);

describe('throw sound cues', () => {
  it('a clean drive just lands, once', () => {
    const w = world();
    const r = simulateThrow({ start: [0, -140], aim: NORTH, power: 1, disc: DD, hyzer: 0 }, w, () => 0.25, { ghost: true });
    expect(cuesOf(w, r)).toEqual(['land']);
  });

  it('a made putt rings the chains, a tap-in too', () => {
    const w = world([], [0, 6]);
    let made = 0;
    for (let s = 1; s <= 20; s++) {
      const r = simulateThrow({ start: [0, 0], aim: NORTH, power: 0.5, disc: PUTTER_DISC, hyzer: 0, style: 'putt', launch: 0.12 }, w, mulberry32(s));
      if (!r.holed) continue;
      made++;
      expect(cuesOf(w, r)).toEqual(['chains']);
    }
    expect(made).toBeGreaterThan(0);
    const tap = simulateThrow({ start: [0, 5.5], aim: NORTH, power: 0.2, disc: PUTTER_DISC, hyzer: 0, style: 'putt' }, w, mulberry32(1));
    expect(tap.holed).toBe(true);
    expect(cuesOf(w, tap)).toEqual(['chains']);
  });

  it('flying into a wall of trees knocks before it lands', () => {
    const wall: Tree[] = [];
    for (let x = -30; x <= 30; x += 2) wall.push({ x, y: 15, h: 8, r: 2.5, b: 0.5, t: 0.3 });
    const w = world(wall);
    let hit = 0;
    for (let s = 1; s <= 20; s++) {
      const r = simulateThrow({ start: [0, 0], aim: NORTH, power: 0.8, disc: DD, hyzer: 0 }, w, mulberry32(s));
      const c = cuesOf(w, r);
      expect(c.filter((x) => x === 'land')).toHaveLength(1);
      if (r.events.includes('trunk') || r.events.includes('branch')) {
        hit++;
        expect(c.indexOf('tree') >= 0 || c.indexOf('branch') >= 0).toBe(true);
        expect(c.findIndex((x) => x === 'tree' || x === 'branch')).toBeLessThan(c.indexOf('land'));
      }
    }
    expect(hit).toBeGreaterThan(10);
  });

  it('landing in water splashes instead', () => {
    const w = world([], [999, 999], [[[[-40, -60], [40, -60], [40, 60], [-40, 60]]]]);
    const r = simulateThrow({ start: [0, -140], aim: NORTH, power: 1, disc: DD, hyzer: 0 }, w, () => 0.25, { ghost: true });
    expect(r.events).toContain('water');
    expect(cuesOf(w, r)).toEqual(['splash']);
  });
});
