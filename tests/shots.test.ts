// Throw styles (src/disc/flight.ts, `shot`): overhand over trees, rollers under them.
import { describe, expect, it } from 'vitest';
import type { Tree } from '../src/course/disc-types';
import { DISCS } from '../src/disc/discs';
import { simulateThrow, type DiscWorld, type Shot } from '../src/disc/flight';
import { TreeIndex } from '../src/disc/trees';
import { mulberry32 } from '../src/game/physics';
import { SurfaceGrid } from '../src/game/surfaces';
import { FlatTerrain } from '../src/game/terrain';

const grid = SurfaceGrid.fromHole({ bounds: [[-300, -300], [300, 300]], boundary: [[[[-250, -250], [250, -250], [250, 250], [-250, 250]]]], trees: [], features: [] }, 2);
const world = (trees: Tree[] = []): DiscWorld => ({ grid, terrain: new FlatTerrain(), trees: new TreeIndex(trees), basket: [999, 999] });
const DD = DISCS.find((d) => d.id === 'DD')!;
const fly = (shot: Shot, trees: Tree[] = [], power = 1, mirror = false) =>
  simulateThrow({ start: [0, 0], aim: Math.PI / 2, power, disc: DD, hyzer: 0, shot, mirror, perfect: true }, world(trees), mulberry32(3));
const apex = (shot: Shot) => Math.max(...fly(shot).samples.map((q) => q[2]));

describe('throw styles', () => {
  it('overhand throws go high and land short; tomahawk and thumber curl opposite ways', () => {
    expect(apex('tomahawk')).toBeGreaterThan(apex('standard') + 3);
    const t = fly('tomahawk').rest, th = fly('thumber').rest;
    expect(t[1]).toBeGreaterThan(30);
    expect(t[1]).toBeLessThan(70);
    expect(Math.sign(t[0])).toBe(-Math.sign(th[0]));
    expect(t[0]).toBeCloseTo(-th[0], 5);
  });
  it('a roller stays low and rolls a long way, curling the other way thrown forehand', () => {
    const r = fly('roller');
    expect(Math.max(...r.samples.slice(60).map((q) => q[2]))).toBeLessThan(0.5);
    expect(Math.hypot(r.rest[0], r.rest[1])).toBeGreaterThan(50);
    expect(fly('roller', [], 1, true).rest[0]).toBeCloseTo(-r.rest[0], 5);
  });
  it('a roller goes under a low canopy that a normal throw flies through; a tomahawk goes over it', () => {
    // A wall of wide, low-crowned trees across the line 15 m out (crowns 1.2–6 m up).
    const wall: Tree[] = [];
    for (let x = -30; x <= 30; x += 3) wall.push({ x, y: 15, h: 6, r: 2.5, b: 1.2, t: 0.15 });
    const touched = (shot: Shot) => { let n = 0; for (let s = 1; s <= 40; s++) { const r = simulateThrow({ start: [0, 0], aim: Math.PI / 2, power: 0.8, disc: DD, hyzer: 0, shot }, world(wall), mulberry32(s)); if (r.events.includes('branch')) n++; } return n; };
    const std = touched('standard');
    expect(std).toBeGreaterThan(10);
    expect(touched('roller')).toBeLessThan(std / 3);
    expect(touched('tomahawk')).toBeLessThan(std / 3);
  });
});
