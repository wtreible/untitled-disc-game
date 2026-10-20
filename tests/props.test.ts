import { describe, expect, it } from 'vitest';
import type { Rings } from '../src/course/types';
import { DISCS } from '../src/disc/discs';
import { simulateThrow, type DiscWorld, type ThrowInput } from '../src/disc/flight';
import { castleColliders, windmillColliders, type Collider } from '../src/disc/props';
import { TreeIndex } from '../src/disc/trees';
import { mulberry32 } from '../src/game/physics';
import { SurfaceGrid } from '../src/game/surfaces';
import { FlatTerrain } from '../src/game/terrain';

const sq = (n: number): Rings => [[[-n, -n], [n, -n], [n, n], [-n, n]]];
const NORTH = Math.PI / 2;
const MR = DISCS.find((d) => d.id === 'MR')!;
const world = (props: Collider[], clock0 = 0): DiscWorld => ({
  grid: SurfaceGrid.fromHole({ bounds: [[-200, -200], [200, 200]], boundary: [sq(150)], trees: [], features: [] }, 1),
  terrain: new FlatTerrain(), trees: new TreeIndex([]), basket: [0, 999], props, clock0,
});
const fly = (props: Collider[], o: Partial<ThrowInput> = {}, clock0 = 0) =>
  simulateThrow({ start: [0, 0], aim: NORTH, power: 1, disc: MR, hyzer: 0, perfect: true, ...o }, world(props, clock0), mulberry32(1));

// Windmill 40 m north, facing the thrower (yaw π: its forward axis points −y, blades on our side).
const S = 15;
const mill = (omega = 0.6, phase = 0) => windmillColliders([0, 40], Math.PI, S, omega, phase);

describe('windmill', () => {
  it('a low, flat throw threads the arched tunnel and keeps going', () => {
    // Launch flat from 1 m at full power: ~1.1 m high through the 34–46 m tunnel (arch 2.1 m).
    const r = fly(mill(), { launch: 0.0, power: 1 });
    expect(r.propHits ?? []).toEqual([]);
    expect(r.rest[1]).toBeGreaterThan(50);
  });

  it('a throw off the tunnel line hits the tower', () => {
    const r = fly(mill(), { start: [4, 0], launch: 0.0, power: 1 });
    expect(r.propHits).toContain('windmill');
    expect(r.rest[1]).toBeLessThan(40);
  });

  it('blades: whether a throw through the blade disc is hit depends on when it arrives', () => {
    // A throw 3 m right of the hub line, ~7 m up where it crosses the blade plane. Sweep the clock.
    const hits = [0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.4].map((t) => {
      const r = fly(mill(), { start: [3, 0], launch: 0.32, power: 0.8 }, t);
      return (r.propHits ?? [])[0] === 'blades'; // (if the blades miss, it hits the tower behind them)
    });
    expect(hits.some((h) => h)).toBe(true);
    expect(hits.some((h) => !h)).toBe(true);
  });

  it('a blade swat changes the disc direction (adds the blade velocity)', () => {
    const still = mill(0);
    let swatted: number | null = null, base: number | null = null;
    for (let t = 0; t < 3 && swatted === null; t += 0.1) {
      const r = fly(mill(2.5), { start: [3, 0], launch: 0.32, power: 0.8 }, t);
      if ((r.propHits ?? [])[0] === 'blades') { swatted = r.rest[0]; base = fly(still, { start: [3, 0], launch: 0.32, power: 0.8 }, t).rest[0]; }
    }
    expect(swatted).not.toBeNull();
    expect(Math.abs(swatted! - base!)).toBeGreaterThan(0.5);
  });
});

describe('castle and animals', () => {
  it('a low throw passes through the castle gate; one aimed at a tower stops', () => {
    const castle = castleColliders([0, 40], 0, 30);
    expect(fly(castle, { launch: 0.02, power: 0.75 }).propHits ?? []).toEqual([]);
    const blocked = fly(castle, { start: [8, 0], launch: 0.02, power: 0.75 });
    expect(blocked.propHits).toContain('castle');
  });

  it('a giant cow on the line stops the disc', () => {
    const cow: Collider = { kind: 'cyl', c: [0, 30], r: 2.6, z0: 0, z1: 6, tag: 'cow' };
    const r = fly([cow], { launch: 0.05, power: 0.75 });
    expect(r.propHits).toEqual(['cow']);
    expect(r.rest[1]).toBeLessThan(31);
  });

  it('a disc sliding along the ground bounces off a low wall instead of passing through', () => {
    const wall: Collider = { kind: 'box', c: [0, 8], yaw: 0, hx: 10, hy: 0.3, z0: 0, z1: 1 };
    const r = fly([wall], { launch: -0.2, power: 0.6 });
    const crossed = r.samples.some((q) => q[1] > 8.5);
    expect(crossed).toBe(false);
  });
});

describe('collider geometry', () => {
  it('windmill tunnel opening is ~4.5 m wide and ~2.1 m tall at scale 15', () => {
    const [l, r, lintel] = mill() as Extract<Collider, { kind: 'box' }>[];
    const gap = Math.abs(l.c[0] - r.c[0]) - l.hx - r.hx;
    expect(gap).toBeCloseTo(4.5, 1);
    expect(lintel.z0).toBeCloseTo(2.1, 1);
  });
});
