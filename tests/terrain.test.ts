// Real ground (src/game/terrain.ts HeightmapTerrain) and what it does to a flight.
import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../src/course/geo';
import { DISCS, PUTTER_DISC } from '../src/disc/discs';
import { simulateThrow, type DiscWorld, type ThrowInput } from '../src/disc/flight';
import { TreeIndex } from '../src/disc/trees';
import { mulberry32 } from '../src/game/physics';
import { SurfaceGrid } from '../src/game/surfaces';
import { FlatTerrain, HeightmapTerrain, type Terrain } from '../src/game/terrain';

/** A heightmap over ±150 m at 2 m cells from a height function. */
function ground(f: (x: number, y: number) => number): HeightmapTerrain {
  const cell = 2, n = 151, h = new Float32Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) h[r * n + c] = f(-150 + c * cell, -150 + r * cell);
  return new HeightmapTerrain(h, n, n, [-150, -150], cell);
}
const sq = (r: number): Vec2[][] => [[[-r, -r], [r, -r], [r, r], [-r, r]]];
const grid = SurfaceGrid.fromHole({ bounds: [[-200, -200], [200, 200]], boundary: [sq(150)], features: [], trees: [] }, 0.5);
const world = (terrain: Terrain, basket: Vec2 = [0, 400]): DiscWorld => ({ grid, terrain, trees: new TreeIndex([]), basket });
const NORTH = Math.PI / 2;
const MR = DISCS.find((d) => d.id === 'MR')!;
const shot = (o: Partial<ThrowInput> = {}): ThrowInput => ({ start: [0, -100], aim: NORTH, power: 0.7, disc: MR, hyzer: 0, ...o });

describe('heightmap terrain', () => {
  it('reads heights between cells, flat past the edges, and points the normal downhill', () => {
    const t = HeightmapTerrain.fromCentimeters(new Uint16Array([0, 100, 200, 300]).buffer, { cols: 2, rows: 2, min: [0, 0], cell: 2 });
    expect(t.heightAt(0, 0)).toBeCloseTo(0, 5);
    expect(t.heightAt(2, 0)).toBeCloseTo(1, 5);
    expect(t.heightAt(1, 1)).toBeCloseTo(1.5, 5);
    expect(t.heightAt(-50, 99)).toBeCloseTo(2, 5);
    const slope = ground((x) => x * 0.1); // rises to the east
    const n = slope.normalAt(0, 0);
    expect(n[0]).toBeLessThan(0);
    expect(n[2]).toBeCloseTo(1 / Math.hypot(0.1, 1), 4);
    expect(() => HeightmapTerrain.fromCentimeters(new Uint16Array(3).buffer, { cols: 2, rows: 2, min: [0, 0], cell: 2 })).toThrow();
  });
});

describe('flights over real ground', () => {
  it('downhill carries farther and uphill comes up short', () => {
    const carry = (t: Terrain) => simulateThrow(shot(), world(t), mulberry32(4)).rest[1] + 100;
    const flat = carry(new FlatTerrain()), down = carry(ground((_, y) => -y * 0.15)), up = carry(ground((_, y) => y * 0.15));
    expect(down).toBeGreaterThan(flat + 8);
    expect(up).toBeLessThan(flat - 8);
  });

  it('lands on the ground, not at sea level', () => {
    const hill = ground(() => 20);
    const r = simulateThrow(shot(), world(hill), mulberry32(4));
    expect(r.samples.at(-1)![2]).toBeCloseTo(20, 1);
    expect(r.samples[0][2]).toBeCloseTo(21, 1); // released 1 m above the ground
  });

  it('a roller runs away down a side slope', () => {
    const roll = (t: Terrain) => simulateThrow(shot({ shot: 'roller', power: 0.5 }), world(t), mulberry32(2)).rest[0];
    const flat = roll(new FlatTerrain()), tilted = roll(ground((x) => -x * 0.12)); // falls away to the east
    expect(tilted).toBeGreaterThan(flat + 5);
  });

  it('a basket up on a ridge still catches: its chains are where it stands', () => {
    const ridge = ground((_, y) => (y > 0 ? 6 : 0));
    let made = 0;
    for (let s = 1; s <= 20; s++) {
      const r = simulateThrow({ start: [0, 4], aim: NORTH, power: 0.5, disc: PUTTER_DISC, hyzer: 0, style: 'putt', launch: 0.12 }, world(ridge, [0, 10]), mulberry32(s));
      if (r.holed) { made++; expect(r.samples.at(-1)![2]).toBeGreaterThan(6.5); } // dropped into the raised tray
    }
    expect(made).toBeGreaterThan(5);
  });
});
